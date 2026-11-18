import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer } from "expo-audio";
import { getSignedRoomFileUrl } from "./roomApi";

const LOCAL_VOLUME_KEY = "sora.room.musicLocalVolume";

export const musicPositionMs = (musicState, durationSeconds = 0) => {
  if (!musicState) return 0;
  const base = Number(musicState.position_ms) || 0;
  if (!musicState.playing) return base;
  const startedAt = Date.parse(musicState.started_at || "") || Date.now();
  let position = base + Math.max(0, Date.now() - startedAt);
  const durationMs = durationSeconds * 1000;
  if (durationMs > 1000) position %= durationMs;
  return position;
};

export function useRoomMusic({ musicState, enabled = true }) {
  const playerRef = useRef(null);
  const loadedPathRef = useRef(null);
  const loadedNonceRef = useRef(0);
  const statusSubRef = useRef(null);
  const [localVolume, setLocalVolumeState] = useState(1);
  const [status, setStatus] = useState("idle");
  const [duration, setDuration] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);

  const destroyPlayer = useCallback(() => {
    try {
      statusSubRef.current?.remove?.();
    } catch {}
    statusSubRef.current = null;
    try {
      playerRef.current?.pause?.();
      playerRef.current?.remove?.();
    } catch {}
    playerRef.current = null;
    loadedPathRef.current = null;
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(LOCAL_VOLUME_KEY)
      .then((value) => {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) setLocalVolumeState(Math.min(1, Math.max(0, parsed)));
      })
      .catch(() => undefined);
  }, []);

  const setLocalVolume = useCallback((value) => {
    const next = Math.min(1, Math.max(0, Number(value) || 0));
    setLocalVolumeState(next);
    AsyncStorage.setItem(LOCAL_VOLUME_KEY, String(next)).catch(() => undefined);
  }, []);

  useEffect(() => () => destroyPlayer(), [destroyPlayer]);

  const roomVolume = Math.min(1, Math.max(0, Number(musicState?.volume ?? 0.7)));
  const effectiveVolumeRef = useRef(roomVolume * localVolume);
  effectiveVolumeRef.current = roomVolume * localVolume;
  const path = enabled ? musicState?.path || null : null;
  const playing = Boolean(musicState?.playing);
  const startedAt = musicState?.started_at || null;
  const positionMs = Number(musicState?.position_ms) || 0;

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (!path) {
        destroyPlayer();
        setStatus("idle");
        setDuration(0);
        return;
      }
      try {
        const forceReload = loadedNonceRef.current !== retryNonce;
        if (loadedPathRef.current !== path || !playerRef.current || forceReload) {
          setStatus("loading");
          const url = await getSignedRoomFileUrl("room-music", path, 6 * 3600, { forceRefresh: forceReload });
          if (cancelled || !url) return;

          destroyPlayer();
          const created = createAudioPlayer({ uri: url }, { updateInterval: 1000 });
          if (cancelled) {
            try {
              created.pause();
              created.remove();
            } catch {}
            return;
          }
          created.loop = true;
          created.volume = effectiveVolumeRef.current;
          statusSubRef.current = created.addListener?.("playbackStatusUpdate", (st) => {
            if (!cancelled && st?.error) {
              setStatus("error");
            }
          }) || null;
          playerRef.current = created;
          loadedPathRef.current = path;
          loadedNonceRef.current = retryNonce;
        }
        const player = playerRef.current;
        if (!player || cancelled) return;
        player.volume = effectiveVolumeRef.current;
        if (playing) {
          player.play();
          setStatus("playing");
        }
        for (let attempt = 0; attempt < 15 && !player.isLoaded && !(player.duration > 0); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (cancelled || playerRef.current !== player) return;
        }
        if (cancelled || playerRef.current !== player) return;
        if (player.duration > 0) setDuration(player.duration);
        const target = musicPositionMs(
          { position_ms: positionMs, playing, started_at: startedAt },
          player.duration || 0,
        );
        const currentMs = Number.isFinite(player.currentTime) ? player.currentTime * 1000 : 0;
        if (Math.abs(target - currentMs) > 1500) {
          await player.seekTo(target / 1000).catch(() => undefined);
        }
        if (cancelled || playerRef.current !== player) return;
        if (playing) {
          player.play();
          setStatus("playing");
        } else {
          player.pause();
          setStatus("paused");
        }
      } catch (error) {
        console.warn("[room-music] playback failed", error?.message || error);
        if (!cancelled) setStatus("error");
      }
    };
    sync();
    return () => {
      cancelled = true;
    };
  }, [destroyPlayer, path, playing, positionMs, retryNonce, startedAt]);

  useEffect(() => {
    if (playerRef.current) playerRef.current.volume = roomVolume * localVolume;
  }, [localVolume, roomVolume, status]);

  useEffect(() => {
    if (!path || !playing) return undefined;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player || loadedPathRef.current !== path) return;
      if (player.duration > 0) setDuration((prev) => (prev === player.duration ? prev : player.duration));
      player.volume = effectiveVolumeRef.current;
      if (player.isLoaded && !player.playing) {
        try {
          player.play();
        } catch {}
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [path, playing]);

  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);

  const currentPositionMs = useCallback(() => {
    const player = playerRef.current;
    if (player && loadedPathRef.current === path && Number.isFinite(player.currentTime)) {
      return Math.max(0, Math.round(player.currentTime * 1000));
    }
    return musicPositionMs(musicState, duration);
  }, [duration, musicState, path]);

  return {
    status,
    duration,
    localVolume,
    setLocalVolume,
    retry,
    currentPositionMs,
  };
}
