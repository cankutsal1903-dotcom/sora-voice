import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer } from "expo-audio";

const SFX_PREF_KEY = "sora.audio.sfxEnabled";

const SFX_ASSETS = {
  pop: require("../../assets/sfx/pop.wav"),
  dice: require("../../assets/sfx/dice.wav"),
  coin: require("../../assets/sfx/coin.wav"),
  fanfare: require("../../assets/sfx/fanfare.wav"),
  chime: require("../../assets/sfx/chime.wav"),
};

const SFX_VOLUMES = {
  pop: 0.42,
  dice: 0.48,
  coin: 0.56,
  fanfare: 0.55,
  chime: 0.5,
};

let sfxEnabledCache = true;
let sfxLoaded = false;
const listeners = new Set();
const lastPlayedAt = {};
const activePlayers = new Map(); // player -> timeoutId
const MAX_CONCURRENT_SFX = 4;

const releasePlayer = (player) => {
  const timerId = activePlayers.get(player);
  if (timerId) clearTimeout(timerId);
  activePlayers.delete(player);
  try {
    player.pause?.();
    player.remove?.();
  } catch {}
};

const notify = () => {
  listeners.forEach((fn) => {
    try {
      fn(sfxEnabledCache);
    } catch {}
  });
};

const ensurePrefLoaded = () => {
  if (sfxLoaded) return;
  sfxLoaded = true;
  AsyncStorage.getItem(SFX_PREF_KEY)
    .then((raw) => {
      if (raw === "false" || raw === "0") {
        sfxEnabledCache = false;
        notify();
      }
    })
    .catch(() => undefined);
};

export function setSfxEnabled(next) {
  sfxEnabledCache = Boolean(next);
  sfxLoaded = true;
  AsyncStorage.setItem(SFX_PREF_KEY, sfxEnabledCache ? "true" : "false").catch(() => undefined);
  notify();
}

export function isSfxEnabled() {
  ensurePrefLoaded();
  return sfxEnabledCache;
}

export function useSfxEnabled() {
  const [enabled, setEnabled] = useState(sfxEnabledCache);

  useEffect(() => {
    ensurePrefLoaded();
    listeners.add(setEnabled);
    setEnabled(sfxEnabledCache);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  const toggle = useCallback(() => {
    setSfxEnabled(!sfxEnabledCache);
  }, []);

  return { sfxEnabled: enabled, setSfxEnabled, toggleSfx: toggle };
}

export function playSfx(name) {
  ensurePrefLoaded();
  if (!sfxEnabledCache) return;
  const asset = SFX_ASSETS[name];
  if (!asset) return;

  const now = Date.now();
  if (now - (lastPlayedAt[name] || 0) < 95) return;
  lastPlayedAt[name] = now;

  try {
    while (activePlayers.size >= MAX_CONCURRENT_SFX) {
      const oldest = activePlayers.keys().next().value;
      if (!oldest) break;
      releasePlayer(oldest);
    }
    const player = createAudioPlayer(asset);
    player.volume = SFX_VOLUMES[name] ?? 0.5;
    const cleanupMs = name === "fanfare" ? 1300 : 850;
    const timerId = setTimeout(() => releasePlayer(player), cleanupMs);
    activePlayers.set(player, timerId);
    player.play();
  } catch {
    // Ses cihazı meşgulse sessizce geç
  }
}
