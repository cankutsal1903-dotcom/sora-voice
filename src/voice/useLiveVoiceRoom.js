import { useCallback, useEffect, useRef, useState } from "react";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";

registerGlobals();

const initialState = {
  status: "idle",
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

export function useLiveVoiceRoom({ roomName, profile, userId, accessToken, startWithMicrophone }) {
  const liveKitRoomRef = useRef(null);
  const speakerEnabledRef = useRef(true);
  const autoRetryCountRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const [state, setState] = useState(initialState);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");
  const enabled = Boolean(tokenServerUrl);

  useEffect(() => {
    autoRetryCountRef.current = 0;
    intentionalDisconnectRef.current = false;
  }, [roomName]);

  useEffect(() => {
    let active = true;
    let connectedRoom;
    let tokenFetchController;
    let retryTimer;

    const scheduleAutoRetry = (fallbackErrorMessage) => {
      if (!active || intentionalDisconnectRef.current) return false;
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

    const applySpeakerState = () => {
      if (!connectedRoom) return;
      connectedRoom.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          const mediaTrack = publication.track?.mediaStreamTrack;
          if (publication.kind === "audio" && mediaTrack) mediaTrack.enabled = speakerEnabledRef.current;
        });
      });
    };

    const updateParticipants = () => {
      if (!active || !connectedRoom) return;
      const local = connectedRoom.localParticipant;
      const everyone = [local, ...connectedRoom.remoteParticipants.values()];
      const participants = everyone.map((participant) => {
        const microphonePublication = [...participant.trackPublications.values()].find((publication) => publication.kind === "audio" && publication.source === "microphone");
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
      if (!active || !connectedRoom) return;
      const local = connectedRoom.localParticipant;
      if ((!participant || participant === local) && !local.permissions?.canPublish && local.isMicrophoneEnabled) {
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
      const tokenFetchTimeout = setTimeout(
        () => tokenFetchController.abort(),
        12_000,
      );
      try {
        const response = await fetch(`${tokenServerUrl}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            name: profile.name,
            roomName,
          }),
          signal: tokenFetchController.signal,
        });
        console.warn("[room-entry] token response received", response.status);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.token || !payload.serverUrl) {
          const authOrPolicyError = new Error(payload.error || "Ses oturumu oluşturulamadı.");
          authOrPolicyError.httpStatus = response.status;
          throw authOrPolicyError;
        }
        console.warn("[room-entry] token payload accepted");

        connectedRoom = new Room({ adaptiveStream: false, dynacast: true });
        liveKitRoomRef.current = connectedRoom;
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
          scheduleAutoRetry("Ses bağlantısı kesildi. Yeniden deneyebilirsin.");
        });

        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ["speaker", "headset", "bluetooth", "earpiece"],
            audioTypeOptions: {
              manageAudioFocus: false,
            },
          },
        }).catch(() => undefined);
        await AudioSession.startAudioSession();
        await connectedRoom.connect(payload.serverUrl, payload.token);
        console.warn("[room-entry] LiveKit connected");
        if (!active) {
          await connectedRoom.disconnect();
          return;
        }

        autoRetryCountRef.current = 0;
        const canPublishNow = Boolean(connectedRoom.localParticipant.permissions?.canPublish ?? payload.canPublish);
        if (startWithMicrophone && canPublishNow) {
          await connectedRoom.localParticipant.setMicrophoneEnabled(true);
        }
        setState({
          ...initialState,
          status: "connected",
          role: payload.role || "listener",
          mutedByModerator: Boolean(payload.muted),
          canPublish: canPublishNow,
          microphoneEnabled: Boolean(startWithMicrophone && canPublishNow),
          error: null,
        });
        applySpeakerState();
        updateParticipants();
      } catch (error) {
        console.warn(
          "[room-entry] voice connection failed",
          error?.name || "Error",
        );
        if (active && !intentionalDisconnectRef.current) {
          const httpStatus = error?.httpStatus || 0;
          const aborted = error?.name === "AbortError";
          const friendlyMessage = aborted
            ? "Ses sunucusuna ulaşılamadı. Bağlantını kontrol edip yeniden dene."
            : error instanceof Error
              ? error.message
              : "Ses bağlantısı kurulamadı.";
          const nonRetryableHttp = httpStatus === 401 || httpStatus === 403 || httpStatus === 404;
          if (nonRetryableHttp || !scheduleAutoRetry(friendlyMessage)) {
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
      tokenFetchController?.abort();
      if (connectedRoom) {
        participantEvents.forEach((event) => connectedRoom.off(event, updateParticipants));
        connectedRoom.off(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
        connectedRoom.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
        connectedRoom.disconnect().catch(() => undefined);
      }
      if (liveKitRoomRef.current === connectedRoom) liveKitRoomRef.current = null;
      AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [accessToken, connectionAttempt, profile.name, roomName, startWithMicrophone, tokenServerUrl, userId]);

  const setMicrophoneEnabled = useCallback(async (enabled) => {
    const room = liveKitRoomRef.current;
    if (!room || state.status !== "connected") return false;
    if (enabled && !room.localParticipant.permissions?.canPublish) return false;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    setState((current) => ({ ...current, microphoneEnabled: enabled }));
    return true;
  }, [state.status]);

  // Hoparlör: odadaki diğer seslerin bu cihazda çalınmasını açar / kapatır.
  const setSpeakerEnabled = useCallback((enabled) => {
    speakerEnabledRef.current = Boolean(enabled);
    const room = liveKitRoomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        const mediaTrack = publication.track?.mediaStreamTrack;
        if (publication.kind === "audio" && mediaTrack) mediaTrack.enabled = speakerEnabledRef.current;
      });
    });
  }, []);

  const disconnect = useCallback(async () => {
    intentionalDisconnectRef.current = true;
    const room = liveKitRoomRef.current;
    if (!room) return;
    await room.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    autoRetryCountRef.current = 0;
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
