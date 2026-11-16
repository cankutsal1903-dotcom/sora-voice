import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SoraGiftArtwork, resolveGiftRecipeKey } from "./SoraGiftArtwork";
import { useReducedMotion } from "./Motion";
import { FALLBACK_GIFT_EFFECT, GIFT_EFFECT_PHASES, GIFT_EFFECT_RECIPES } from "./giftEffectRecipes";

const MAX_WAITING = 3;
const interpolate = (progress, outputRange, inputRange = GIFT_EFFECT_PHASES) =>
  progress.interpolate({ inputRange, outputRange, extrapolate: "clamp" });
const radians = (degrees) => degrees * Math.PI / 180;

// Small, font-independent silhouettes stay crisp over both light and dark rooms.
function ParticleMark({ type, size, color }) {
  const round = { backgroundColor: color, borderRadius: size };
  if (type === "hearts") return (
    <View style={{ width: size, height: size, transform: [{ rotate: "-45deg" }] }}>
      <View style={{ position: "absolute", width: size * 0.72, height: size * 0.72, backgroundColor: color, bottom: 0, left: 0 }} />
      <View style={{ position: "absolute", width: size * 0.72, height: size * 0.72, ...round, top: -size * 0.08, left: 0 }} />
      <View style={{ position: "absolute", width: size * 0.72, height: size * 0.72, ...round, bottom: 0, right: -size * 0.08 }} />
    </View>
  );
  if (type === "notes") return (
    <View style={{ width: size, height: size * 1.2 }}>
      <View style={{ position: "absolute", left: size * 0.6, width: size * 0.16, height: size, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: "absolute", left: size * 0.6, top: 0, width: size * 0.4, height: size * 0.22, backgroundColor: color, transform: [{ rotate: "20deg" }] }} />
      <View style={{ position: "absolute", left: size * 0.15, bottom: 0, width: size * 0.62, height: size * 0.45, ...round, transform: [{ rotate: "-20deg" }] }} />
    </View>
  );
  if (type === "paws") return (
    <View style={{ width: size * 1.1, height: size * 1.1 }}>
      <View style={{ position: "absolute", left: size * 0.22, top: size * 0.42, width: size * 0.65, height: size * 0.6, ...round }} />
      {[0, 1, 2, 3].map((toe) => <View key={toe} style={{ position: "absolute", left: size * toe * 0.27, top: toe === 0 || toe === 3 ? size * 0.25 : 0, width: size * 0.24, height: size * 0.32, ...round }} />)}
    </View>
  );
  if (type === "steam") return <View style={{ width: size * 0.8, height: size * 2.2, borderRadius: size, borderLeftWidth: 2, borderTopWidth: 1, borderColor: color, transform: [{ rotate: "14deg" }] }} />;
  if (type === "speed") return <LinearGradient colors={["transparent", color, "#FFFFFF"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: size * 6, height: 2, borderRadius: 2 }} />;
  if (type === "petals") return <View style={{ width: size, height: size * 1.6, borderTopLeftRadius: size, borderBottomRightRadius: size, borderTopRightRadius: size * 0.3, borderBottomLeftRadius: size * 0.3, backgroundColor: color }} />;
  if (type === "droplets" || type === "embers") return <View style={{ width: size * 0.65, height: size * 1.7, backgroundColor: color, borderRadius: size, borderTopLeftRadius: 0, transform: [{ rotate: "35deg" }] }} />;
  if (type === "bubbles") return <View style={{ width: size * 1.1, height: size * 1.1, borderRadius: size, borderColor: color, borderWidth: 1.5, backgroundColor: `${color}18` }} />;
  if (type === "clouds") return (
    <View style={{ width: size * 2.6, height: size * 1.2 }}>
      {[0, 1, 2].map((n) => <View key={n} style={{ position: "absolute", left: n * size * 0.65, bottom: 0, width: size * (n === 1 ? 1.4 : 1), height: size * (n === 1 ? 1.4 : 1), ...round }} />)}
    </View>
  );
  if (type === "confetti") return <View style={{ width: size * 0.45, height: size, backgroundColor: color, borderRadius: 2 }} />;
  if (type === "diamonds") return <View style={{ width: size * 0.75, height: size, borderWidth: 1.5, borderColor: "#FFFFFF", backgroundColor: `${color}C0`, transform: [{ rotate: "45deg" }] }} />;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", left: size * 0.42, width: size * 0.16, height: size, backgroundColor: color, borderRadius: size }} />
      <View style={{ position: "absolute", top: size * 0.42, width: size, height: size * 0.16, backgroundColor: color, borderRadius: size }} />
      <View style={{ position: "absolute", left: size * 0.3, top: size * 0.3, width: size * 0.4, height: size * 0.4, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
    </View>
  );
}

// Authored trajectories are deterministic; no JS animation loops or random layout per frame.
export function getGiftParticlePath(recipe, index, count) {
  const lane = index / Math.max(1, count - 1);
  const side = index % 2 ? 1 : -1;
  const angle = radians(index * 137.5 - 90);
  const radius = 0.2 + (index % 4) * 0.047;
  let x = [0, Math.cos(angle) * 0.08, Math.cos(angle) * radius, Math.cos(angle) * (radius + 0.05), Math.cos(angle) * (radius + 0.08), Math.cos(angle) * (radius + 0.1)];
  let y = [0.04, Math.sin(angle) * 0.08, Math.sin(angle) * radius, Math.sin(angle) * radius - 0.04, Math.sin(angle) * radius - 0.08, Math.sin(angle) * radius - 0.12];
  const mode = recipe.motion;
  if (["steam", "balloons", "kiss", "listening", "speech", "voicecrown", "decks", "neon", "moon"].includes(mode)) {
    const start = (lane - 0.5) * 0.5;
    x = [start, start + side * 0.03, start - side * 0.025, start + side * 0.04, start, start + side * 0.04];
    y = [0.27, 0.12, -0.02, -0.18, -0.34, -0.5];
    if (mode === "steam") { x = x.map((n) => n * 0.42); y = y.map((n) => n - 0.12); }
  } else if (["redrace", "goldrace", "skytrain", "carriage"].includes(mode)) {
    const direction = mode === "goldrace" ? -1 : 1;
    x = [0.48, 0.24, 0.03, -0.23, -0.5, -0.85].map((n) => n * direction);
    y = Array(6).fill((lane - 0.5) * 0.47 + 0.12);
  } else if (["bouquet", "applause", "waterfall", "royalstage"].includes(mode)) {
    x = Array.from({ length: 6 }, (_, phase) => (lane - 0.5) * 0.85 + Math.sin(phase + index) * 0.07);
    y = [-0.5, -0.28, -0.08, 0.13, 0.32, 0.55];
  } else if (mode === "meteor") {
    x = [-0.62, -0.4, -0.17, 0.08, 0.34, 0.65].map((n) => n + (lane - 0.5) * 0.4);
    y = [-0.5, -0.3, -0.08, 0.12, 0.33, 0.55];
  } else if (["butterfly", "whale", "rainbow"].includes(mode)) {
    x = [-0.5, -0.28, -0.08, 0.12, 0.35, 0.62];
    y = [0.23, -0.03, -0.19, -0.17, -0.06, 0.15].map((n) => n + (lane - 0.5) * 0.35);
  } else if (["phoenix", "spaceship"].includes(mode)) {
    x = [side * 0.05, side * 0.09, side * 0.15, side * 0.24, side * 0.31, side * 0.37].map((n) => n * (0.7 + lane));
    y = [0.37, 0.22, 0.08, -0.06, -0.23, -0.47];
  } else if (mode === "kitten") {
    x = [side * 0.3, side * 0.24, side * 0.18, side * 0.12, side * 0.06, 0];
    y = [0.3, 0.2, 0.1, 0, -0.1, -0.2].map((n) => n + (lane - 0.5) * 0.2);
  }
  return { x, y };
}

const GiftScene = memo(function GiftScene({ gift, onComplete }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const key = resolveGiftRecipeKey(gift.id || gift.giftId, gift.name || gift.giftName);
  const [artworkReady, setArtworkReady] = useState(!key);
  const handleArtworkLoad = useCallback(() => setArtworkReady(true), []);
  const handleArtworkError = useCallback(() => {
    console.warn("[gift-effect] artwork failed to load", key || "unknown");
    onComplete();
  }, [key, onComplete]);
  const recipe = GIFT_EFFECT_RECIPES[key] || FALLBACK_GIFT_EFFECT;
  const unit = Math.min(width, 440);
  const artworkSize = Math.round(Math.min(unit * (recipe.wide ? 0.63 : 0.52), height * 0.34));
  const count = Math.min(recipe.count || 12, 18);

  useEffect(() => {
    progress.setValue(0);
    // Decoding a cold bundled PNG can take longer than the animation on a slow
    // emulator. Keep time at zero until the actual hero image has loaded.
    if (!artworkReady) {
      const timeout = setTimeout(onComplete, 8000);
      return () => clearTimeout(timeout);
    }
    if (reducedMotion) {
      const timer = setTimeout(onComplete, 1400);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(progress, { toValue: 1, duration: recipe.duration, easing: Easing.linear, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) onComplete(); });
    return () => animation.stop();
  }, [artworkReady, onComplete, progress, recipe.duration, reducedMotion]);

  const opacity = reducedMotion ? (artworkReady ? 1 : 0) : interpolate(progress, [0, 1, 1, 1, 1, 0]);
  const transform = reducedMotion ? [] : [
    { translateX: interpolate(progress, recipe.hero.x.map((n) => n * unit)) },
    { translateY: interpolate(progress, recipe.hero.y.map((n) => n * unit)) },
    { scale: interpolate(progress, recipe.hero.scale) },
    { rotate: interpolate(progress, recipe.hero.rotate.map((n) => `${n}deg`)) },
    ...(["butterfly", "phoenix"].includes(recipe.motion) ? [{ scaleX: interpolate(progress, [0.7, 1, 0.78, 1.06, 0.82, 1]) }] : []),
  ];
  const quantity = Math.max(1, Math.floor(Number(gift.quantity) || 1));
  const title = gift.name || gift.giftName || "Hediye";

  return (
    <View collapsable={false} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.overlay}>
      <View style={[styles.scene, { width: unit, height: Math.min(height * 0.62, 470), bottom: Math.max(88, height * 0.15) }]}>
        {!reducedMotion ? <>
          <Animated.View style={[styles.aura, { width: artworkSize * 1.5, height: artworkSize * 1.5, borderRadius: artworkSize, opacity: interpolate(progress, [0, 0.5, 0.28, 0.42, 0.2, 0]), transform: [{ scale: interpolate(progress, [0.3, 0.9, 1.2, 1, 1.1, 1.5]) }] }]}>
            <LinearGradient colors={[`${recipe.color}42`, `${recipe.color}06`, "transparent"]} style={StyleSheet.absoluteFillObject} />
          </Animated.View>
          {Array.from({ length: recipe.rings || 0 }, (_, ring) => (
            <Animated.View key={`ring-${ring}`} style={[styles.ring, { width: artworkSize, height: artworkSize, borderRadius: artworkSize, borderColor: ring % 2 ? recipe.accent : recipe.color, opacity: interpolate(progress, [0, 0.7 - ring * 0.1, 0.4, 0.22, 0.08, 0]), transform: [{ scale: interpolate(progress, [0.15 + ring * 0.15, 0.6 + ring * 0.2, 1 + ring * 0.25, 1.35 + ring * 0.3, 1.7 + ring * 0.35, 2 + ring * 0.4]) }, { scaleY: recipe.motion === "waterfall" ? 0.35 : 1 }] }]} />
          ))}
          {recipe.rainbow ? ["#FF7FA9", "#FFD680", "#87E7A9", "#86D5FF", "#C5ACFF"].map((color, index) => (
            <Animated.View key={color} style={[styles.rainbow, { width: artworkSize * (1.6 - index * 0.15), height: artworkSize * (1.6 - index * 0.15), borderColor: color, borderRadius: artworkSize, opacity, transform: [{ scale: interpolate(progress, [0.1, 0.6, 1, 1.06, 1.1, 1.2]) }, { rotate: "-45deg" }, { translateY: artworkSize * 0.2 }] }]} />
          )) : null}
          {recipe.beams ? [-1, 1].map((side) => (
            <Animated.View key={`beam-${side}`} style={[styles.beam, { width: artworkSize * 0.55, height: artworkSize * 1.65, opacity: interpolate(progress, [0, 0.1, 0.35, 0.18, 0.3, 0]), transform: [{ rotate: interpolate(progress, [side * 55, side * 27, side * 12, side * 32, side * 17, side * 45].map((n) => `${n}deg`)) }] }]}>
              <LinearGradient colors={[`${recipe.accent}D0`, `${recipe.color}38`, "transparent"]} style={StyleSheet.absoluteFillObject} />
            </Animated.View>
          )) : null}
          {recipe.curtains ? [-1, 1].map((side) => (
            <Animated.View key={`curtain-${side}`} style={[styles.curtain, { width: unit * 0.42, height: artworkSize * 1.3, opacity, transform: [{ translateX: interpolate(progress, [side * unit * 0.1, side * unit * 0.17, side * unit * 0.37, side * unit * 0.4, side * unit * 0.4, side * unit * 0.45]) }] }]}>
              <LinearGradient colors={["#1C3C82", "#4B73CC", "#152957", "#3E61B5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFillObject, { borderBottomWidth: 2, borderBottomColor: recipe.color }]} />
            </Animated.View>
          )) : null}
          {Array.from({ length: count }, (_, index) => {
            const path = getGiftParticlePath(recipe, index, count);
            const size = 7 + index % 4 * 3;
            const delay = (index % 5) * 0.035;
            return (
              <Animated.View key={`particle-${index}`} style={[styles.particle, {
                opacity: progress.interpolate({ inputRange: [0, delay + 0.08, delay + 0.23, 0.8, 1], outputRange: [0, 0, 0.9, 0.7, 0], extrapolate: "clamp" }),
                transform: [
                  { translateX: interpolate(progress, path.x.map((n) => n * unit)) },
                  { translateY: interpolate(progress, path.y.map((n) => n * unit)) },
                  { rotate: interpolate(progress, [index * 20, index * 20 + 10, index * 20 + 60, index * 20 + 100, index * 20 + 150, index * 20 + 190].map((n) => `${n}deg`)) },
                  { scale: interpolate(progress, [0.2, 0.7, 1, 1, 0.8, 0.3]) },
                ],
              }]}>
                <ParticleMark type={recipe.particles} size={size} color={index % 3 ? recipe.color : recipe.accent} />
              </Animated.View>
            );
          })}
          {recipe.equalizer ? <View style={[styles.equalizer, { top: "66%" }]}>
            {Array.from({ length: 13 }, (_, bar) => <Animated.View key={bar} style={{ width: 5, height: 20 + (bar % 4) * 9, borderRadius: 3, backgroundColor: bar % 2 ? recipe.accent : recipe.color, opacity, transform: [{ scaleY: interpolate(progress, [0.1, bar % 2 ? 0.45 : 1, bar % 2 ? 1 : 0.4, bar % 3 ? 0.5 : 1.2, bar % 2 ? 0.8 : 0.45, 0.1]) }] }} />)}
          </View> : null}
        </> : null}
        <Animated.View style={[styles.hero, { opacity, transform }]}>
          <SoraGiftArtwork giftId={gift.id || gift.giftId} giftName={title} size={reducedMotion ? Math.min(artworkSize, 126) : artworkSize} onLoad={handleArtworkLoad} onError={handleArtworkError} />
        </Animated.View>
        <Animated.View style={[styles.caption, { bottom: reducedMotion ? 42 : 12, borderColor: `${recipe.color}70`, opacity }]}>
          <Text numberOfLines={1} style={styles.title}>{title}{quantity > 1 ? ` ×${quantity}` : ""}</Text>
          <Text numberOfLines={1} style={styles.recipient}>{gift.recipientName ? `${gift.recipientName} için` : "Hediye gönderildi"}</Text>
        </Animated.View>
      </View>
    </View>
  );
});

/** Feed only confirmed successful gifts. New events need an eventId or stamp. */
export const SoraGiftEffect = memo(function SoraGiftEffect({ gift }) {
  const [activeGift, setActiveGift] = useState(null);
  const activeRef = useRef(false);
  const queueRef = useRef([]);
  const seenRef = useRef(new Set());
  const seenObjectsRef = useRef(new WeakSet());
  const serialRef = useRef(0);
  const mountedRef = useRef(true);

  const playNext = useCallback(() => {
    if (!mountedRef.current) return;
    const next = queueRef.current.shift() || null;
    activeRef.current = Boolean(next);
    setActiveGift(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; queueRef.current = []; };
  }, []);

  useEffect(() => {
    if (!gift || typeof gift !== "object") {
      queueRef.current = [];
      activeRef.current = false;
      setActiveGift(null);
      return;
    }
    const explicitId = gift.eventId ?? gift.requestId ?? gift.messageId ?? gift.stamp;
    const eventKey = explicitId != null ? `${gift.id || gift.giftId}:${explicitId}` : null;
    if (eventKey ? seenRef.current.has(eventKey) : seenObjectsRef.current.has(gift)) return;
    seenObjectsRef.current.add(gift);
    if (eventKey) {
      seenRef.current.add(eventKey);
      if (seenRef.current.size > 80) seenRef.current.delete(seenRef.current.values().next().value);
    }
    const next = { ...gift, _effectKey: ++serialRef.current };
    if (queueRef.current.length >= MAX_WAITING) queueRef.current.shift();
    queueRef.current.push(next);
    if (!activeRef.current) playNext();
  }, [gift, playNext]);

  // A hidden/minimized room cancels its scene immediately, including queued gifts.
  // The child unmount stops the native animation and its reduced-motion timer.
  return gift && activeGift ? <GiftScene key={activeGift._effectKey} gift={activeGift} onComplete={playNext} /> : null;
});

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 45, elevation: 45, alignItems: "center", overflow: "hidden" },
  scene: { position: "absolute", alignItems: "center", justifyContent: "center" },
  hero: { position: "absolute", alignItems: "center", justifyContent: "center" },
  aura: { position: "absolute", overflow: "hidden" },
  particle: { position: "absolute", alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 1.3 },
  beam: { position: "absolute", bottom: "49%", borderTopLeftRadius: 100, borderTopRightRadius: 100, overflow: "hidden" },
  curtain: { position: "absolute", borderRadius: 9, overflow: "hidden" },
  rainbow: { position: "absolute", borderWidth: 3, borderBottomColor: "transparent", borderLeftColor: "transparent", transform: [{ rotate: "-45deg" }] },
  equalizer: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 5 },
  caption: { position: "absolute", maxWidth: "87%", minWidth: 154, paddingHorizontal: 19, paddingVertical: 10, borderRadius: 18, borderWidth: 1, backgroundColor: "rgba(12,22,43,0.94)", alignItems: "center", gap: 3 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },
  recipient: { color: "#B6C7E3", fontSize: 11, fontWeight: "500" },
});
