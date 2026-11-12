import { useCallback, useEffect, useRef, useState } from "react";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { Room, RoomEvent } from "livekit-client";

registerGlobals();

const initialState = {
  status: "idle",
  participantCount: 0,
  participants: [],
  activeSpeakerIds: [],
  role: "listener",
  mutedByModerator: false,
  microphoneEnabled: false,
  error: null,
};

const roomRoleCanPublish = (role, muted) => ["host", "moderator", "speaker"].includes(role) && !muted;

export function useLiveVoiceRoom({ roomName, profile, userId, accessToken, startWithMicrophone }) {
  const liveKitRoomRef = useRef(null);
  const [state, setState] = useState(initialState);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");
  const enabled = Boolean(tokenServerUrl);

  useEffect(() => {
    let active = true;
    let connectedRoom;
    let tokenFetchController;

    const updateParticipants = () => {
      if (!active || !connectedRoom) return;
      const everyone = [connectedRoom.localParticipant, ...connectedRoom.remoteParticipants.values()];
      const participants = everyone.map((participant) => {
        const microphonePublication = [...participant.trackPublications.values()].find((publication) => publication.kind === "audio" && publication.source === "microphone");
        return {
          id: participant.identity,
          name: participant.name || "Sora kullanıcısı",
          isLocal: participant === connectedRoom.localParticipant,
          microphoneEnabled: Boolean(microphonePublication && !microphonePublication.isMuted),
        };
      });
      setState((current) => ({ ...current, participantCount: participants.length, participants }));
    };

    const connect = async () => {
      if (!tokenServerUrl) {
        setState({ ...initialState, status: "local" });
        return;
      }
      if (!userId || !accessToken) {
        setState({
          ...initialState,
          status: "error",
          error: "Canlı odaya katılmak için oturum açmalısın.",
        });
        return;
      }

      setState({ ...initialState, status: "connecting" });
      tokenFetchController = new AbortController();
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.token || !payload.serverUrl) {
          throw new Error(payload.error || "Ses oturumu oluşturulamadı.");
        }

        connectedRoom = new Room({ adaptiveStream: false, dynacast: true });
        liveKitRoomRef.current = connectedRoom;
        connectedRoom.on(RoomEvent.ParticipantConnected, updateParticipants);
        connectedRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);
        connectedRoom.on(RoomEvent.TrackMuted, updateParticipants);
        connectedRoom.on(RoomEvent.TrackUnmuted, updateParticipants);
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
        connectedRoom.on(RoomEvent.Disconnected, () => {
          if (active) setState((current) => ({ ...current, status: "disconnected", microphoneEnabled: false, activeSpeakerIds: [] }));
        });

        await AudioSession.startAudioSession();
        await connectedRoom.connect(payload.serverUrl, payload.token);
        if (!active) {
          await connectedRoom.disconnect();
          return;
        }

        if (startWithMicrophone && roomRoleCanPublish(payload.role, payload.muted)) {
          await connectedRoom.localParticipant.setMicrophoneEnabled(true);
        }
        setState({
          status: "connected",
          participantCount: 0,
          participants: [],
          role: payload.role || "listener",
          mutedByModerator: Boolean(payload.muted),
          microphoneEnabled: Boolean(startWithMicrophone && roomRoleCanPublish(payload.role, payload.muted)),
          error: null,
        });
        updateParticipants();
      } catch (error) {
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
        connectedRoom.off(RoomEvent.ParticipantConnected, updateParticipants);
        connectedRoom.off(RoomEvent.ParticipantDisconnected, updateParticipants);
        connectedRoom.off(RoomEvent.TrackMuted, updateParticipants);
        connectedRoom.off(RoomEvent.TrackUnmuted, updateParticipants);
        connectedRoom.disconnect().catch(() => undefined);
      }
      if (liveKitRoomRef.current === connectedRoom) liveKitRoomRef.current = null;
      AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [accessToken, connectionAttempt, profile.name, roomName, startWithMicrophone, tokenServerUrl, userId]);

  const setMicrophoneEnabled = useCallback(async (enabled) => {
    const room = liveKitRoomRef.current;
    if (!room || state.status !== "connected") return false;
    if (enabled && (!roomRoleCanPublish(state.role, state.mutedByModerator))) return false;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    setState((current) => ({ ...current, microphoneEnabled: enabled }));
    return true;
  }, [state.mutedByModerator, state.role, state.status]);

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
    disconnect,
  };
}
