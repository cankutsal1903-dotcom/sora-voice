import { useCallback, useEffect, useRef, useState } from "react";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import { supabase } from "../auth/supabase";

registerGlobals();

const initialState = {
  status: "idle",
  provider: "livekit",
  participantCount: 0,
  participants: [],
  activeSpeakerIds: [],
  role: "listener",
  mutedByModerator: false,
  microphoneEnabled: false,
  canPublish: false,
  localSeat: null,
  removedByModerator: false,
  error: null,
};

const AUTO_RETRY_DELAYS_MS = [1200, 2500, 5000, 8000];
const HEARTBEAT_INTERVAL_MS = 60_000;

const NON_RETRYABLE_REASONS = new Set([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
]);

const parseSeat = (participant) => {
  const value = Number.parseInt(participant?.attributes?.seat || "", 10);
  return Number.isInteger(value) ? value : null;
};

const roomRoleCanPublish = (role, muted, seat) =>
  role === "host" || (Number.isInteger(seat) && !muted);

let cachedAgoraModule = undefined;
const loadAgoraModule = () => {
  if (cachedAgoraModule !== undefined) return cachedAgoraModule;
  try {
    // eslint-disable-next-line global-require
    cachedAgoraModule = require("react-native-agora");
  } catch {
    cachedAgoraModule = null;
  }
  return cachedAgoraModule;
};

export function useLiveVoiceRoom({
  roomName,
  profile,
  userId,
  accessToken,
  startWithMicrophone,
}) {
  const adapterRef = useRef(null);
  const speakerEnabledRef = useRef(true);
  const autoRetryCountRef = useRef(0);
  const excludeProvidersRef = useRef([]);
  const intentionalDisconnectRef = useRef(false);
  const [state, setState] = useState(initialState);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");
  const enabled = Boolean(tokenServerUrl);

  useEffect(() => {
    autoRetryCountRef.current = 0;
    excludeProvidersRef.current = [];
    intentionalDisconnectRef.current = false;
  }, [roomName]);

  const sendHeartbeat = useCallback(
    async ({ ended = false, failedProvider = null, errorText = null } = {}) => {
      if (!tokenServerUrl || !accessToken || !roomName) return;
      try {
        await fetch(`${tokenServerUrl}/voice/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            roomId: roomName,
            ended,
            failedProvider,
            errorText,
          }),
        });
      } catch {
        // Kalp atışı ağ hatası ses akışını kesmez.
      }
    },
    [accessToken, roomName, tokenServerUrl],
  );

  useEffect(() => {
    let active = true;
    let tokenFetchController;
    let retryTimer;
    let heartbeatTimer;
    let cleanupAdapter = () => Promise.resolve();

    const startHeartbeatLoop = () => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (active && !intentionalDisconnectRef.current) {
          sendHeartbeat({ ended: false });
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    const scheduleAutoRetry = (fallbackErrorMessage, failedProvider = null) => {
      if (!active || intentionalDisconnectRef.current) return false;
      if (failedProvider && !excludeProvidersRef.current.includes(failedProvider)) {
        excludeProvidersRef.current = [...excludeProvidersRef.current, failedProvider];
        sendHeartbeat({
          ended: false,
          failedProvider,
          errorText: fallbackErrorMessage || "provider_connect_failed",
        });
      }
      const attemptIndex = autoRetryCountRef.current;
      if (attemptIndex >= AUTO_RETRY_DELAYS_MS.length) {
        setState((current) => ({
          ...current,
          status: "error",
          microphoneEnabled: false,
          canPublish: false,
          localSeat: null,
          activeSpeakerIds: [],
          error: fallbackErrorMessage || "Ses bağlantısı kurulamadı. Yeniden deneyebilirsin.",
        }));
        return false;
      }
      const delayMs = AUTO_RETRY_DELAYS_MS[attemptIndex];
      autoRetryCountRef.current = attemptIndex + 1;
      setState((current) => ({
        ...current,
        status: "reconnecting",
        microphoneEnabled: false,
        activeSpeakerIds: [],
        error: null,
      }));
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (active && !intentionalDisconnectRef.current) {
          setConnectionAttempt((attempt) => attempt + 1);
        }
      }, delayMs);
      return true;
    };

    const fetchSessionPayload = async (signal) => {
      const response = await fetch(`${tokenServerUrl}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: profile.name,
          roomName,
          excludeProviders: excludeProvidersRef.current,
        }),
        signal,
      });
      console.warn("[room-entry] token response received", response.status);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.token) {
        const authOrPolicyError = new Error(payload.error || "Ses oturumu oluşturulamadı.");
        authOrPolicyError.httpStatus = response.status;
        throw authOrPolicyError;
      }
      return payload;
    };

    // ── 1) LiveKit / LiveKit Yedek Adaptörü ──────────────────────────────────
    const connectLiveKitProvider = async (payload) => {
      if (!payload.serverUrl) {
        throw new Error("LiveKit sunucu adresi eksik.");
      }
      const connectedRoom = new Room({ adaptiveStream: false, dynacast: true });

      const applySpeakerState = () => {
        connectedRoom.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            const mediaTrack = publication.track?.mediaStreamTrack;
            if (publication.kind === "audio" && mediaTrack) {
              mediaTrack.enabled = speakerEnabledRef.current;
            }
          });
        });
      };

      const updateParticipants = () => {
        if (!active) return;
        const local = connectedRoom.localParticipant;
        const everyone = [local, ...connectedRoom.remoteParticipants.values()];
        const participants = everyone.map((participant) => {
          const microphonePublication = [...participant.trackPublications.values()].find(
            (publication) => publication.kind === "audio" && publication.source === "microphone",
          );
          return {
            id: participant.identity,
            name: participant.name || "Sora kullanıcısı",
            isLocal: participant === local,
            seat: parseSeat(participant),
            microphoneEnabled: Boolean(microphonePublication && !microphonePublication.isMuted),
          };
        });
        const canPublish = Boolean(local.permissions?.canPublish);
        setState((current) => ({
          ...current,
          participantCount: participants.length,
          participants,
          canPublish,
          localSeat: parseSeat(local),
          microphoneEnabled: canPublish ? current.microphoneEnabled : false,
        }));
      };

      const handlePermissionsChanged = (_previous, participant) => {
        if (!active) return;
        const local = connectedRoom.localParticipant;
        if (
          (!participant || participant === local) &&
          !local.permissions?.canPublish &&
          local.isMicrophoneEnabled
        ) {
          local.setMicrophoneEnabled(false).catch(() => undefined);
        }
        updateParticipants();
      };

      const handleTrackSubscribed = () => {
        applySpeakerState();
        updateParticipants();
      };

      const participantEvents = [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ParticipantAttributesChanged,
        RoomEvent.ParticipantNameChanged,
      ].filter(Boolean);

      participantEvents.forEach((event) => connectedRoom.on(event, updateParticipants));
      connectedRoom.on(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
      connectedRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      connectedRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          activeSpeakerIds: speakers.map((speaker) => speaker.identity),
        }));
      });
      connectedRoom.on(RoomEvent.Reconnecting, () => {
        if (active) setState((current) => ({ ...current, status: "reconnecting", error: null }));
      });
      connectedRoom.on(RoomEvent.Reconnected, () => {
        autoRetryCountRef.current = 0;
        if (active) setState((current) => ({ ...current, status: "connected", error: null }));
      });
      connectedRoom.on(RoomEvent.Disconnected, (reason) => {
        if (!active) return;
        if (intentionalDisconnectRef.current || NON_RETRYABLE_REASONS.has(reason)) {
          setState((current) => ({
            ...current,
            status: "disconnected",
            microphoneEnabled: false,
            canPublish: false,
            localSeat: null,
            activeSpeakerIds: [],
            removedByModerator: reason === DisconnectReason.PARTICIPANT_REMOVED,
          }));
          return;
        }
        scheduleAutoRetry("Ses bağlantısı kesildi. Yeniden deneyebilirsin.", payload.provider);
      });

      adapterRef.current = {
        provider: payload.provider || "livekit",
        setMicrophoneEnabled: async (nextEnabled) => {
          if (!connectedRoom.localParticipant.permissions?.canPublish && nextEnabled) {
            return false;
          }
          await connectedRoom.localParticipant.setMicrophoneEnabled(nextEnabled);
          return true;
        },
        setSpeakerEnabled: (nextSpeaker) => {
          speakerEnabledRef.current = Boolean(nextSpeaker);
          applySpeakerState();
        },
        disconnect: async () => {
          await connectedRoom.disconnect().catch(() => undefined);
        },
      };

      cleanupAdapter = async () => {
        participantEvents.forEach((event) => connectedRoom.off(event, updateParticipants));
        connectedRoom.off(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
        connectedRoom.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
        await connectedRoom.disconnect().catch(() => undefined);
        AudioSession.stopAudioSession().catch(() => undefined);
      };

      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ["speaker", "headset", "bluetooth", "earpiece"],
          audioTypeOptions: { manageAudioFocus: false },
        },
      }).catch(() => undefined);
      await AudioSession.startAudioSession();
      await connectedRoom.connect(payload.serverUrl, payload.token);
      console.warn(`[room-entry] ${payload.provider || "livekit"} connected`);
      if (!active) {
        await connectedRoom.disconnect();
        return;
      }

      autoRetryCountRef.current = 0;
      excludeProvidersRef.current = [];
      const canPublishNow = Boolean(
        connectedRoom.localParticipant.permissions?.canPublish ?? payload.canPublish,
      );
      if (startWithMicrophone && canPublishNow) {
        await connectedRoom.localParticipant.setMicrophoneEnabled(true);
      }
      setState({
        ...initialState,
        provider: payload.provider || "livekit",
        status: "connected",
        role: payload.role || "listener",
        mutedByModerator: Boolean(payload.muted),
        canPublish: canPublishNow,
        localSeat: typeof payload.seat === "number" ? payload.seat : parseSeat(connectedRoom.localParticipant),
        microphoneEnabled: Boolean(startWithMicrophone && canPublishNow),
        error: null,
      });
      applySpeakerState();
      updateParticipants();
      startHeartbeatLoop();
    };

    // ── Ortak Veritabanı + Realtime Üye / Koltuk Senkronu (Agora & Cloudflare) ─
    const attachRealtimeRosterSync = ({
      initialRole,
      initialMuted,
      initialSeat,
      onPermissionUpdate,
      onRemoved,
      getExtraParticipantAudioState,
    }) => {
      let rosterMembers = [];
      let activeSessions = [];
      let localMicEnabled = false;
      let canPublishFlag = roomRoleCanPublish(initialRole, initialMuted, initialSeat);

      const rebuildRoster = () => {
        if (!active) return;
        const myRow = rosterMembers.find((m) => m.user_id === userId);
        if (myRow?.removed_at) {
          onRemoved?.();
          return;
        }
        const effectiveRole = myRow?.role || initialRole || "listener";
        const effectiveMuted = effectiveRole === "host" ? false : Boolean(myRow?.is_muted);
        const effectiveSeat =
          effectiveRole === "host"
            ? 0
            : typeof myRow?.seat_index === "number"
              ? myRow.seat_index
              : null;
        const nextCanPublish = roomRoleCanPublish(effectiveRole, effectiveMuted, effectiveSeat);
        if (nextCanPublish !== canPublishFlag) {
          canPublishFlag = nextCanPublish;
          if (!nextCanPublish) localMicEnabled = false;
          onPermissionUpdate?.({
            canPublish: nextCanPublish,
            muted: effectiveMuted,
            role: effectiveRole,
            seat: effectiveSeat,
          });
        }

        const activeUidByUser = new Map(
          activeSessions.map((s) => [s.user_id, s.agora_uid]),
        );
        const connectedSet = new Set([userId, ...activeUidByUser.keys()]);
        const visibleMembers = rosterMembers.filter(
          (m) => !m.removed_at && connectedSet.has(m.user_id),
        );
        if (!visibleMembers.some((m) => m.user_id === userId)) {
          visibleMembers.unshift({
            user_id: userId,
            role: effectiveRole,
            is_muted: effectiveMuted,
            seat_index: effectiveSeat,
            profiles: { display_name: profile?.name || "Sen" },
          });
        }

        const participants = visibleMembers.map((m) => {
          const pInfo = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          const isMe = m.user_id === userId;
          const seatVal =
            m.role === "host"
              ? 0
              : typeof m.seat_index === "number"
                ? m.seat_index
                : null;
          const remoteAudioOn = !isMe
            ? Boolean(
                getExtraParticipantAudioState?.({
                  userId: m.user_id,
                  agoraUid: activeUidByUser.get(m.user_id),
                }),
              )
            : localMicEnabled && canPublishFlag;
          return {
            id: m.user_id,
            name: pInfo?.display_name || (isMe ? profile?.name : "Sora kullanıcısı"),
            isLocal: isMe,
            seat: seatVal,
            microphoneEnabled: remoteAudioOn && !m.is_muted,
          };
        });

        setState((current) => ({
          ...current,
          role: effectiveRole,
          mutedByModerator: effectiveMuted,
          canPublish: canPublishFlag,
          localSeat: effectiveSeat,
          microphoneEnabled: canPublishFlag ? localMicEnabled : false,
          participantCount: participants.length,
          participants,
        }));
      };

      const fetchSnapshot = async () => {
        if (!supabase || !active) return;
        const twoMinAgo = new Date(Date.now() - 130_000).toISOString();
        const [membersRes, sessionsRes] = await Promise.all([
          supabase
            .from("room_members")
            .select("user_id, role, is_muted, seat_index, removed_at, profiles!room_members_user_id_fkey(display_name)")
            .eq("room_id", roomName),
          supabase
            .from("voice_active_sessions")
            .select("user_id, agora_uid, last_heartbeat_at")
            .eq("room_id", roomName)
            .gte("last_heartbeat_at", twoMinAgo),
        ]);
        if (!active) return;
        if (Array.isArray(membersRes.data)) rosterMembers = membersRes.data;
        if (Array.isArray(sessionsRes.data)) activeSessions = sessionsRes.data;
        rebuildRoster();
      };

      fetchSnapshot().catch(() => undefined);

      const channel = supabase
        ? supabase
            .channel(`voice-roster-${roomName}-${userId}`)
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomName}` },
              () => { fetchSnapshot().catch(() => undefined); },
            )
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "voice_active_sessions", filter: `room_id=eq.${roomName}` },
              () => { fetchSnapshot().catch(() => undefined); },
            )
            .subscribe()
        : null;

      return {
        setLocalMicFlag: (val) => {
          localMicEnabled = Boolean(val);
          rebuildRoster();
        },
        getCanPublish: () => canPublishFlag,
        resolveUserIdByAgoraUid: (uid) => {
          if (!uid) return userId;
          const hit = activeSessions.find((s) => Number(s.agora_uid) === Number(uid));
          return hit?.user_id || null;
        },
        refresh: () => fetchSnapshot().catch(() => undefined),
        dispose: () => {
          if (channel && supabase) supabase.removeChannel(channel);
        },
      };
    };

    // ── 2) Agora RTC Adaptörü (10.000 ücretsiz dk/ay) ────────────────────────
    const connectAgoraProvider = async (payload) => {
      const agoraMod = loadAgoraModule();
      if (!agoraMod?.createAgoraRtcEngine || !payload.appId) {
        throw new Error("Agora ses motoru kullanılamıyor.");
      }

      const engine = agoraMod.createAgoraRtcEngine();
      const remoteSpeakingUids = new Set();
      let joinedResolve;
      let joinedReject;
      const joinedPromise = new Promise((resolve, reject) => {
        joinedResolve = resolve;
        joinedReject = reject;
      });

      const rosterSync = attachRealtimeRosterSync({
        initialRole: payload.role || "listener",
        initialMuted: Boolean(payload.muted),
        initialSeat: typeof payload.seat === "number" ? payload.seat : null,
        getExtraParticipantAudioState: ({ agoraUid }) =>
          agoraUid ? remoteSpeakingUids.has(Number(agoraUid)) : false,
        onPermissionUpdate: ({ canPublish: nextPub }) => {
          try {
            engine.setClientRole(nextPub ? 1 : 2);
            if (!nextPub) {
              engine.muteLocalAudioStream(true);
              engine.enableLocalAudio(false);
            }
          } catch {
            // Motor kapandıysa yoksay.
          }
        },
        onRemoved: () => {
          intentionalDisconnectRef.current = true;
          try {
            engine.leaveChannel();
          } catch {
            // yoksay
          }
          setState((current) => ({
            ...current,
            status: "disconnected",
            microphoneEnabled: false,
            canPublish: false,
            localSeat: null,
            activeSpeakerIds: [],
            removedByModerator: true,
          }));
        },
      });

      const eventHandler = {
        onJoinChannelSuccess: () => {
          joinedResolve?.();
        },
        onUserJoined: (_conn, remoteUid) => {
          remoteSpeakingUids.add(Number(remoteUid));
          rosterSync.refresh();
        },
        onUserOffline: (_conn, remoteUid) => {
          remoteSpeakingUids.delete(Number(remoteUid));
          rosterSync.refresh();
        },
        onUserMuteAudio: (_conn, remoteUid, muted) => {
          if (muted) remoteSpeakingUids.delete(Number(remoteUid));
          else remoteSpeakingUids.add(Number(remoteUid));
          rosterSync.refresh();
        },
        onAudioVolumeIndication: (_conn, speakers) => {
          if (!active || !Array.isArray(speakers)) return;
          const activeIds = [];
          for (const sp of speakers) {
            if ((sp?.volume || 0) > 12) {
              const resolved =
                sp.uid === 0 ? userId : rosterSync.resolveUserIdByAgoraUid(sp.uid);
              if (resolved && !activeIds.includes(resolved)) activeIds.push(resolved);
            }
          }
          setState((current) => ({ ...current, activeSpeakerIds: activeIds }));
        },
        onTokenPrivilegeWillExpire: async () => {
          try {
            const refreshed = await fetchSessionPayload();
            if (refreshed?.provider === "agora" && refreshed.token) {
              engine.renewToken(refreshed.token);
            }
          } catch {
            // Süre dolarsa bağlantı yeniden kurulur.
          }
        },
        onError: (err, msg) => {
          joinedReject?.(new Error(msg || `Agora error ${err}`));
        },
      };

      cleanupAdapter = async () => {
        rosterSync.dispose();
        try {
          engine.unregisterEventHandler(eventHandler);
          engine.leaveChannel();
          engine.release();
        } catch {
          // yoksay
        }
      };

      engine.initialize({
        appId: payload.appId,
        channelProfile: 1, // ChannelProfileLiveBroadcasting
      });
      engine.registerEventHandler(eventHandler);
      engine.enableAudio();
      engine.setDefaultAudioRouteToSpeakerphone(true);
      engine.setEnableSpeakerphone(speakerEnabledRef.current);
      engine.enableAudioVolumeIndication(250, 3, true);

      const canPublishNow = Boolean(payload.canPublish);
      const wantMic = Boolean(startWithMicrophone && canPublishNow);
      engine.setClientRole(canPublishNow ? 1 : 2);
      engine.enableLocalAudio(wantMic);
      engine.muteLocalAudioStream(!wantMic);

      const joinCode = engine.joinChannel(
        payload.token,
        roomName,
        Number(payload.agoraUid) || 0,
        {
          clientRoleType: canPublishNow ? 1 : 2,
          publishMicrophoneTrack: canPublishNow,
          autoSubscribeAudio: true,
        },
      );
      if (typeof joinCode === "number" && joinCode < 0) {
        throw new Error(`Agora kanalına katılınamadı (${joinCode}).`);
      }

      await Promise.race([
        joinedPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Agora bağlantı zaman aşımı.")), 10_000),
        ),
      ]);

      if (!active) return;

      adapterRef.current = {
        provider: "agora",
        setMicrophoneEnabled: async (nextEnabled) => {
          if (nextEnabled && !rosterSync.getCanPublish()) return false;
          engine.setClientRole(rosterSync.getCanPublish() ? 1 : 2);
          engine.enableLocalAudio(Boolean(nextEnabled));
          engine.muteLocalAudioStream(!nextEnabled);
          rosterSync.setLocalMicFlag(Boolean(nextEnabled));
          return true;
        },
        setSpeakerEnabled: (nextSpeaker) => {
          speakerEnabledRef.current = Boolean(nextSpeaker);
          engine.setEnableSpeakerphone(speakerEnabledRef.current);
          engine.muteAllRemoteAudioStreams(!speakerEnabledRef.current);
        },
        disconnect: async () => {
          engine.leaveChannel();
        },
      };

      autoRetryCountRef.current = 0;
      excludeProvidersRef.current = [];
      rosterSync.setLocalMicFlag(wantMic);
      setState((current) => ({
        ...current,
        provider: "agora",
        status: "connected",
        role: payload.role || "listener",
        mutedByModerator: Boolean(payload.muted),
        canPublish: canPublishNow,
        localSeat: typeof payload.seat === "number" ? payload.seat : null,
        microphoneEnabled: wantMic,
        error: null,
      }));
      startHeartbeatLoop();
    };

    // ── 3) Cloudflare Realtime SFU Adaptörü (@livekit/react-native-webrtc) ───
    const connectCloudflareProvider = async (payload) => {
      const PeerConn = globalThis.RTCPeerConnection;
      const getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia;
      if (!PeerConn || !payload.cfSessionId) {
        throw new Error("Cloudflare WebRTC oturumu başlatılamadı.");
      }

      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ["speaker", "headset", "bluetooth", "earpiece"],
          audioTypeOptions: { manageAudioFocus: false },
        },
      }).catch(() => undefined);
      await AudioSession.startAudioSession();

      const pc = new PeerConn({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
      });
      let localStream = null;
      const remoteTracks = new Set();

      pc.ontrack = (event) => {
        const track = event?.track;
        if (track && track.kind === "audio") {
          track.enabled = speakerEnabledRef.current;
          remoteTracks.add(track);
        }
      };

      const canPublishNow = Boolean(payload.canPublish);
      const wantMic = Boolean(startWithMicrophone && canPublishNow);

      if (getUserMedia) {
        localStream = await getUserMedia({ audio: true, video: false }).catch(() => null);
      }
      const audioTrack = localStream?.getAudioTracks?.()?.[0] || null;
      if (audioTrack) {
        audioTrack.enabled = wantMic;
        pc.addTransceiver(audioTrack, { direction: "sendonly" });
      } else {
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const negRes = await fetch(`${tokenServerUrl}/voice/cloudflare/negotiate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          roomId: roomName,
          sessionId: payload.cfSessionId,
          op: "tracks_new",
          payload: {
            sessionDescription: {
              type: offer.type,
              sdp: offer.sdp,
            },
            tracks: audioTrack
              ? [{ location: "local", mid: "0", trackName: `audio-${userId}` }]
              : [],
          },
        }),
      });
      const negJson = await negRes.json().catch(() => ({}));
      if (!negRes.ok || !negJson?.sessionDescription?.sdp) {
        throw new Error(negJson?.error || "Cloudflare SDP el sıkışması başarısız.");
      }
      await pc.setRemoteDescription(negJson.sessionDescription);

      const rosterSync = attachRealtimeRosterSync({
        initialRole: payload.role || "listener",
        initialMuted: Boolean(payload.muted),
        initialSeat: typeof payload.seat === "number" ? payload.seat : null,
        onPermissionUpdate: ({ canPublish: nextPub }) => {
          if (!nextPub && audioTrack) {
            audioTrack.enabled = false;
          }
        },
        onRemoved: () => {
          intentionalDisconnectRef.current = true;
          pc.close();
          setState((current) => ({
            ...current,
            status: "disconnected",
            microphoneEnabled: false,
            canPublish: false,
            localSeat: null,
            activeSpeakerIds: [],
            removedByModerator: true,
          }));
        },
      });

      cleanupAdapter = async () => {
        rosterSync.dispose();
        localStream?.getTracks?.()?.forEach((t) => t.stop());
        try {
          pc.close();
        } catch {
          // yoksay
        }
        AudioSession.stopAudioSession().catch(() => undefined);
      };

      adapterRef.current = {
        provider: "cloudflare",
        setMicrophoneEnabled: async (nextEnabled) => {
          if (nextEnabled && !rosterSync.getCanPublish()) return false;
          if (!audioTrack && nextEnabled && getUserMedia) {
            localStream = await getUserMedia({ audio: true, video: false });
          }
          const track = localStream?.getAudioTracks?.()?.[0];
          if (!track) return false;
          track.enabled = Boolean(nextEnabled);
          rosterSync.setLocalMicFlag(Boolean(nextEnabled));
          return true;
        },
        setSpeakerEnabled: (nextSpeaker) => {
          speakerEnabledRef.current = Boolean(nextSpeaker);
          remoteTracks.forEach((t) => {
            t.enabled = speakerEnabledRef.current;
          });
        },
        disconnect: async () => {
          pc.close();
        },
      };

      autoRetryCountRef.current = 0;
      excludeProvidersRef.current = [];
      rosterSync.setLocalMicFlag(wantMic);
      setState((current) => ({
        ...current,
        provider: "cloudflare",
        status: "connected",
        role: payload.role || "listener",
        mutedByModerator: Boolean(payload.muted),
        canPublish: canPublishNow,
        localSeat: typeof payload.seat === "number" ? payload.seat : null,
        microphoneEnabled: wantMic,
        error: null,
      }));
      startHeartbeatLoop();
    };

    const connect = async () => {
      if (!tokenServerUrl) {
        console.warn("[room-entry] token server URL missing");
        setState({ ...initialState, status: "local" });
        return;
      }
      if (!userId || !accessToken) {
        console.warn("[room-entry] voice connection missing session");
        setState({
          ...initialState,
          status: "error",
          error: "Canlı odaya katılmak için oturum açmalısın.",
        });
        return;
      }

      intentionalDisconnectRef.current = false;
      setState((current) => ({
        ...initialState,
        status: autoRetryCountRef.current > 0 ? "reconnecting" : "connecting",
        participants: current.participants,
        participantCount: current.participantCount,
      }));

      tokenFetchController = new AbortController();
      console.warn("[room-entry] token request started");
      const tokenFetchTimeout = setTimeout(() => tokenFetchController.abort(), 12_000);
      let attemptedProvider = null;

      try {
        const payload = await fetchSessionPayload(tokenFetchController.signal);
        attemptedProvider = payload.provider || "livekit";
        console.warn(`[room-entry] session assigned provider=${attemptedProvider}`);

        if (attemptedProvider === "agora") {
          await connectAgoraProvider(payload);
        } else if (attemptedProvider === "cloudflare") {
          await connectCloudflareProvider(payload);
        } else {
          await connectLiveKitProvider(payload);
        }
      } catch (error) {
        console.warn(
          "[room-entry] voice connection failed",
          attemptedProvider || "none",
          error?.message || error?.name || "Error",
        );
        if (active && !intentionalDisconnectRef.current) {
          const httpStatus = error?.httpStatus || 0;
          const aborted = error?.name === "AbortError";
          const friendlyMessage = aborted
            ? "Ses sunucusuna ulaşılamadı. Bağlantını kontrol edip yeniden dene."
            : error instanceof Error
              ? error.message
              : "Ses bağlantısı kurulamadı.";
          const nonRetryableHttp =
            httpStatus === 401 || httpStatus === 403 || httpStatus === 404;
          if (
            nonRetryableHttp ||
            !scheduleAutoRetry(friendlyMessage, attemptedProvider)
          ) {
            setState({
              ...initialState,
              status: "error",
              error: friendlyMessage,
            });
          }
        }
      } finally {
        clearTimeout(tokenFetchTimeout);
      }
    };

    connect();
    return () => {
      active = false;
      clearTimeout(retryTimer);
      clearInterval(heartbeatTimer);
      tokenFetchController?.abort();
      sendHeartbeat({ ended: true });
      cleanupAdapter().catch(() => undefined);
      adapterRef.current = null;
    };
  }, [
    accessToken,
    connectionAttempt,
    profile.name,
    roomName,
    sendHeartbeat,
    startWithMicrophone,
    tokenServerUrl,
    userId,
  ]);

  const setMicrophoneEnabled = useCallback(
    async (nextEnabled) => {
      const adapter = adapterRef.current;
      if (!adapter || state.status !== "connected") return false;
      const ok = await adapter.setMicrophoneEnabled(Boolean(nextEnabled));
      if (!ok) return false;
      setState((current) => ({
        ...current,
        microphoneEnabled: Boolean(nextEnabled),
      }));
      return true;
    },
    [state.status],
  );

  const setSpeakerEnabled = useCallback((nextSpeaker) => {
    speakerEnabledRef.current = Boolean(nextSpeaker);
    adapterRef.current?.setSpeakerEnabled?.(speakerEnabledRef.current);
  }, []);

  const disconnect = useCallback(async () => {
    intentionalDisconnectRef.current = true;
    sendHeartbeat({ ended: true });
    await adapterRef.current?.disconnect?.();
  }, [sendHeartbeat]);

  const reconnect = useCallback(() => {
    autoRetryCountRef.current = 0;
    excludeProvidersRef.current = [];
    intentionalDisconnectRef.current = false;
    setConnectionAttempt((attempt) => attempt + 1);
  }, []);

  return {
    ...state,
    enabled,
    reconnect,
    setMicrophoneEnabled,
    setSpeakerEnabled,
    disconnect,
  };
}
