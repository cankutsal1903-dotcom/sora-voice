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

const parseSeat = (participant) => {
  const value = Number.parseInt(participant?.attributes?.seat || "", 10);
  return Number.isInteger(value) ? value : null;
};

export function useLiveVoiceRoom({ roomName, profile, userId, accessToken, startWithMicrophone }) {
  const liveKitRoomRef = useRef(null);
  const speakerEnabledRef = useRef(true);
  const [state, setState] = useState(initialState);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");
  const enabled = Boolean(tokenServerUrl);

  useEffect(() => {
    let active = true;
    let connectedRoom;
    let tokenFetchController;

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

      setState({ ...initialState, status: "connecting" });
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
          throw new Error(payload.error || "Ses oturumu oluşturulamadı.");
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
          if (active) setState((current) => ({ ...current, status: "reconnecting" }));
        });
        connectedRoom.on(RoomEvent.Reconnected, () => {
          if (active) setState((current) => ({ ...current, status: "connected" }));
        });
        connectedRoom.on(RoomEvent.Disconnected, (reason) => {
          if (active) {
            setState((current) => ({
              ...current,
              status: "disconnected",
              microphoneEnabled: false,
              canPublish: false,
              localSeat: null,
              activeSpeakerIds: [],
              removedByModerator: reason === DisconnectReason.PARTICIPANT_REMOVED,
            }));
          }
        });

        await AudioSession.startAudioSession();
        await connectedRoom.connect(payload.serverUrl, payload.token);
        console.warn("[room-entry] LiveKit connected");
        if (!active) {
          await connectedRoom.disconnect();
          return;
        }

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
        if (active) {
          const aborted = error?.name === "AbortError";
          setState({
            ...initialState,
            status: "error",
            error: aborted
              ? "Ses sunucusuna ulaşılamadı. Bağlantını kontrol edip yeniden dene."
              : error instanceof Error
                ? error.message
                : "Ses bağlantısı kurulamadı.",
          });
        }
      } finally {
        clearTimeout(tokenFetchTimeout);
      }
    };

    connect();
    return () => {
      active = false;
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
    const room = liveKitRoomRef.current;
    if (!room) return;
    await room.disconnect();
  }, []);

  const reconnect = useCallback(() => {
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
