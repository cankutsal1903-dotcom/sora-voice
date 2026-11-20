import { memo, useEffect, useMemo } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useReducedMotion } from "./Motion";

/**
 * Sora profil çerçeveleri.
 *
 * Geometri: Her PNG 512x512 tuval üzerinde. `hole` = avatarın göründüğü iç
 * boşluğun merkezi ve yarıçapı (PIL ile alfa kanalından ölçüldü: iç kenara
 * 360 ışın atılıp aykırı değerler elendikten sonra daire uydurma).
 * `bbox` = çizimin opak sınırları (x0, y0, x1, y1; x1/y1 hariç).
 * Çerçeve, hole dairesi avatar dairesiyle (çap = size) çakışacak şekilde
 * ölçeklenir; halka avatar kenarını ~%6 örter.
 */

const CANVAS = 512;
const AVATAR_RING_OVERLAP = 0.06;

const FRAME_BASE = {
  frame_sky: {
    color: "#58A0F0",
    accent: "#DFF4FF",
    glowColor: "rgba(88,160,240,0.34)",
    sparkColor: "#E0F7FF",
    width: 3,
    style: "halo",
    tier: 1,
    hole: { cx: 255.8, cy: 256.7, r: 174.5 },
    bbox: [7, 7, 507, 507],
    asset: require("../../assets/frames/frame_sky.png"),
  },
  frame_family_silver: {
    color: "#4C9AFF",
    accent: "#E7F5FF",
    glowColor: "rgba(96,165,250,0.36)",
    sparkColor: "#E8F6FF",
    width: 3.5,
    style: "crown",
    tier: 1,
    hole: { cx: 255.8, cy: 256.0, r: 172.6 },
    bbox: [21, 11, 492, 508],
    asset: require("../../assets/frames/frame_family_silver.png"),
  },
  frame_amber: {
    color: "#E89B1E",
    accent: "#FFE082",
    glowColor: "rgba(255,168,24,0.48)",
    sparkColor: "#FFF5BA",
    width: 3,
    style: "gem",
    tier: 2,
    animated: true,
    hole: { cx: 256.2, cy: 256.9, r: 166.6 },
    bbox: [12, 9, 504, 507],
    asset: require("../../assets/frames/frame_amber.png"),
  },
  frame_lilac: {
    color: "#9B6BFF",
    accent: "#F3E5FF",
    glowColor: "rgba(168,85,247,0.52)",
    sparkColor: "#FAE8FF",
    width: 3,
    style: "orbit",
    tier: 3,
    animated: true,
    hole: { cx: 254.7, cy: 256.4, r: 171.8 },
    bbox: [9, 5, 511, 507],
    asset: require("../../assets/frames/frame_lilac.png"),
  },
  frame_family_royal: {
    color: "#1D5FBF",
    accent: "#FFD978",
    glowColor: "rgba(245,180,32,0.50)",
    sparkColor: "#FFF4B8",
    width: 4,
    style: "royal",
    tier: 3,
    animated: true,
    hole: { cx: 256.1, cy: 256.3, r: 150.0 },
    bbox: [28, 8, 486, 466],
    // Tacın tepesindeki parıltı noktası (512 tuval birimi)
    crownTip: { x: 256, y: 26 },
    asset: require("../../assets/frames/frame_family_royal.png"),
  },
  frame_flame: {
    color: "#F04B24",
    accent: "#FFD166",
    glowColor: "rgba(255,72,16,0.62)",
    sparkColor: "#FFE885",
    width: 4,
    style: "flame",
    tier: 4,
    animated: true,
    hole: { cx: 256.0, cy: 256.1, r: 133.3 },
    bbox: [36, 5, 478, 450],
    asset: require("../../assets/frames/frame_flame.png"),
  },
};

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Geriye dönük uyumluluk: frameScale / overhang alanları hole verisinden türetilir. */
export const PROFILE_ITEM_APPEARANCE = Object.fromEntries(
  Object.entries(FRAME_BASE).map(([key, item]) => {
    const kRel = (1 - AVATAR_RING_OVERLAP) / 2 / item.hole.r; // size başına px / tuval birimi
    const [x0, y0, x1, y1] = item.bbox;
    return [
      key,
      {
        ...item,
        frameScale: round3(CANVAS * kRel),
        overhang: {
          top: round3(Math.max(0, (item.hole.cy - y0) * kRel - 0.5)),
          bottom: round3(Math.max(0, (y1 - item.hole.cy) * kRel - 0.5)),
          side: round3(Math.max(0, Math.max(item.hole.cx - x0, x1 - item.hole.cx) * kRel - 0.5)),
        },
      },
    ];
  }),
);

/* ------------------------------------------------------------------ */
/* Kilit kuralları                                                     */
/* ------------------------------------------------------------------ */

export const FRAME_UNLOCK_RULES = {
  frame_sky: { minUserLevel: 10, cost: 25000000 },
  frame_amber: { minUserLevel: 25, minWealthLevel: 4, cost: 120000000 },
  frame_lilac: { minUserLevel: 40, minWealthLevel: 6, cost: 350000000 },
  frame_flame: { minUserLevel: 60, minWealthLevel: 9, cost: 1500000000 },
  frame_family_silver: { familyOnly: true },
  frame_family_royal: { familyOnly: true },
};

const ROMAN = ["I", "II", "III", "IV", "V"];
const WEALTH_BANDS = [
  { name: "Işıltı", from: 1, to: 3 },
  { name: "Safir", from: 4, to: 6 },
  { name: "Hükümdar", from: 7, to: 11 },
  { name: "Efsane", from: 12, to: 15 },
];

/** 1-3 Işıltı I-III, 4-6 Safir I-III, 7-11 Hükümdar I-V, 12-15 Efsane I-IV */
export const getWealthLevelName = (rawLevel) => {
  const lvl = Math.max(1, Math.min(15, Math.floor(Number(rawLevel) || 1)));
  const band = WEALTH_BANDS.find((b) => lvl >= b.from && lvl <= b.to) || WEALTH_BANDS[0];
  return `${band.name} ${ROMAN[lvl - band.from] || ""}`.trim();
};

export const describeFrameRequirement = (itemId) => {
  const rule = FRAME_UNLOCK_RULES[itemId];
  if (!rule) return "";
  if (rule.familyOnly) return "Yalnızca aile üyelerine özel";
  const parts = [];
  if (rule.minUserLevel) parts.push(`Seviye ${rule.minUserLevel}`);
  if (rule.minWealthLevel) parts.push(`${getWealthLevelName(rule.minWealthLevel)} cömertlik`);
  return parts.length ? `${parts.join(" + ")} gerekir` : "";
};

/* ------------------------------------------------------------------ */
/* Paylaşılan animasyon saati                                          */
/* ------------------------------------------------------------------ */
/*
 * Tek bir Animated.Value, native driver ile 12 sn'lik doğrusal döngüde döner.
 * Tüm efektler (nefes, titreme, yörünge, parıltı, köz) bu tek değerden
 * modül seviyesinde oluşturulan interpolasyonlarla türetilir; böylece ekranda
 * 10 çerçeve olsa bile JS tarafında kare başına iş yapılmaz.
 */
const CLOCK_MS = 12000;
const frameClock = new Animated.Value(0);
let frameClockRefs = 0;
let frameClockAnim = null;

const retainFrameClock = () => {
  frameClockRefs += 1;
  if (!frameClockAnim) {
    frameClockAnim = Animated.loop(
      Animated.timing(frameClock, {
        toValue: 1,
        duration: CLOCK_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    frameClockAnim.start();
  }
  return () => {
    frameClockRefs = Math.max(0, frameClockRefs - 1);
    if (frameClockRefs === 0 && frameClockAnim) {
      frameClockAnim.stop();
      frameClockAnim = null;
    }
  };
};

/**
 * Periyodik anahtar kareleri (u ∈ [0,1], değer) saatin [0,1] aralığına
 * `cycles` kez yayar. Native interpolasyon easing desteklemediği için
 * yumuşaklık yoğun örnekleme ile sağlanır.
 */
const periodicRange = (cycles, keys, offset = 0) => {
  const pts = [];
  for (let c = -1; c <= cycles; c += 1) {
    for (let i = 0; i < keys.length; i += 1) {
      pts.push([(c + keys[i][0] + offset) / cycles, keys[i][1]]);
    }
  }
  const valueAt = (t) => {
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (t >= a[0] && t <= b[0]) {
        if (b[0] === a[0]) return b[1];
        return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
      }
    }
    return pts[0][1];
  };
  const inputRange = [0];
  const outputRange = [valueAt(0)];
  for (let i = 0; i < pts.length; i += 1) {
    let t = pts[i][0];
    if (t <= 0 || t >= 1) continue;
    const prev = inputRange[inputRange.length - 1];
    if (t <= prev) t = prev + 0.0001;
    if (t >= 0.9999) continue;
    inputRange.push(t);
    outputRange.push(pts[i][1]);
  }
  inputRange.push(1);
  outputRange.push(valueAt(1));
  return { inputRange, outputRange, extrapolate: "clamp" };
};

const sineKeys = (lo, hi, samples = 8) =>
  Array.from({ length: samples + 1 }, (_, i) => [
    i / samples,
    lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / samples)),
  ]);

const clockNode = (cycles, keys, offset = 0) =>
  frameClock.interpolate(periodicRange(cycles, keys, offset));

// 0..1 yumuşak nefes (2 sn) ve yavaş nefes (3 sn)
const BREATH = clockNode(6, sineKeys(0, 1));
const BREATH_SLOW = clockNode(4, sineKeys(0, 1), 0.35);
// Düzensiz alev titremesi (0.75 sn), iki faz
const FLICKER_KEYS = [
  [0, 0],
  [0.16, 0.82],
  [0.3, 0.38],
  [0.48, 1],
  [0.66, 0.22],
  [0.82, 0.64],
  [1, 0],
];
const FLICKER_A = clockNode(16, FLICKER_KEYS);
const FLICKER_B = clockNode(16, FLICKER_KEYS, 0.5);
// Yörüngeler
const ROT_CW_1 = frameClock.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
const ROT_CW_2 = frameClock.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] });
const ROT_CCW_1 = frameClock.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
// Işık süpürmesi: 0 → 1 kısa sürede geçer, sonra bekler (bant ekran dışında)
const SWEEP_SLOW = clockNode(2, [[0, 0], [0.2, 1], [1, 1]], 0.1); // her 6 sn
const SWEEP_MID = clockNode(3, [[0, 0], [0.28, 1], [1, 1]], 0.2); // her 4 sn
// Yıldız göz kırpmaları (3 sn, farklı fazlar)
const TWINKLE_KEYS = [[0, 0.18], [0.38, 0.22], [0.5, 1], [0.62, 0.22], [1, 0.18]];
const TWINKLE = [0, 0.23, 0.47, 0.71, 0.89].map((o) => clockNode(4, TWINKLE_KEYS, o));
const TWINKLE_SCALE = TWINKLE.map((n) =>
  n.interpolate({ inputRange: [0.18, 1], outputRange: [0.55, 1.15] }),
);
// Kraliyet taç parıltısı (her 4 sn)
const GLINT = clockNode(3, [[0, 0], [0.62, 0], [0.72, 1], [0.86, 0], [1, 0]], 0.05);
const GLINT_SCALE = GLINT.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.2] });
const GLINT_ROTATE = GLINT.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });
// Yükselen közler: 2 sn testere dişi, kademeli fazlar
const EMBER_OFFSETS = [0, 0.52, 0.17, 0.69, 0.34, 0.86];
const EMBERS = EMBER_OFFSETS.map((o) => clockNode(6, [[0, 0], [1, 1]], o));
const EMBER_OPACITY = EMBERS.map((n) =>
  n.interpolate({ inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 0.7, 0] }),
);
const EMBER_SCALE = EMBERS.map((n) =>
  n.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
);

// Paylaşılan türev düğümler (boyuttan bağımsız)
const AURA_T1 = {
  opacity: BREATH_SLOW.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.95] }),
  scale: BREATH_SLOW.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] }),
};
const AURA_T2 = {
  opacity: BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
  scale: BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.07] }),
};
const AURA_T3 = {
  opacity: BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
  scale: BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.1] }),
};
const AURA_FLAME = {
  opacity: FLICKER_A.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
  scale: FLICKER_B.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.09] }),
};
const FRAME_BREATH_SCALE = BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.994, 1.018] });
const ORBIT_OPACITY = BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
const FLAME_BACK = {
  opacity: FLICKER_A.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
  scale: FLICKER_A.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.075] }),
  rotate: FLICKER_B.interpolate({ inputRange: [0, 1], outputRange: ["-2.4deg", "2.4deg"] }),
};
const FLAME_FRONT = {
  scale: FLICKER_B.interpolate({ inputRange: [0, 1], outputRange: [0.992, 1.03] }),
  rotate: FLICKER_A.interpolate({ inputRange: [0, 1], outputRange: ["1.2deg", "-1.2deg"] }),
};
const HEAT_SCALE_Y = FLICKER_B.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });

/* ------------------------------------------------------------------ */
/* Geometri                                                            */
/* ------------------------------------------------------------------ */

const computeFrameGeometry = (appearance, size, compactHorizontal, padMode) => {
  const hole = appearance.hole || { cx: 256, cy: 256, r: 166 };
  const bbox = appearance.bbox || [0, 0, CANVAS, CANVAS];
  const half = size / 2;
  const k = (half * (1 - AVATAR_RING_OVERLAP)) / hole.r; // px / tuval birimi
  const imgSize = CANVAS * k;
  const imgLeft = half - hole.cx * k;
  const imgTop = half - hole.cy * k;
  const over = {
    top: Math.max(0, (hole.cy - bbox[1]) * k - half),
    bottom: Math.max(0, (bbox[3] - hole.cy) * k - half),
    left: Math.max(0, (hole.cx - bbox[0]) * k - half),
    right: Math.max(0, (bbox[2] - hole.cx) * k - half),
  };
  const vMax = Math.ceil(Math.max(over.top, over.bottom));
  const padTop = padMode === "tight" ? Math.ceil(over.top) : vMax;
  const padBottom = padMode === "tight" ? Math.ceil(over.bottom) : vMax;
  const padHorizontal = compactHorizontal ? 2 : Math.ceil(Math.max(over.left, over.right));
  const holeR = hole.r * k;
  const ringOuterR = Math.min(hole.cx - bbox[0], bbox[2] - hole.cx) * k;
  return {
    k,
    imgSize,
    imgLeft,
    imgTop,
    padTop,
    padBottom,
    padHorizontal,
    holeR,
    ringOuterR,
    ringMidR: (holeR + ringOuterR) / 2,
  };
};

/**
 * Çerçevenin dış kutu ölçüleri (grid / dükkan hücresi rezerve etmek için).
 * padMode: "symmetric" (varsayılan; avatar merkezi kutu merkezinde) | "tight".
 */
export const getProfileFrameLayout = (
  appearance,
  size,
  compactHorizontal = false,
  padMode = "symmetric",
) => {
  if (!appearance) {
    return { width: size, height: size, padTop: 0, padBottom: 0, padHorizontal: 0 };
  }
  const g = computeFrameGeometry(appearance, size, compactHorizontal, padMode);
  return {
    width: size + g.padHorizontal * 2,
    height: size + g.padTop + g.padBottom,
    padTop: g.padTop,
    padBottom: g.padBottom,
    padHorizontal: g.padHorizontal,
  };
};

const ORBIT_ANGLES_4 = [20, 110, 200, 290];
const ORBIT_ANGLES_6 = [10, 70, 130, 190, 250, 310];
const TWINKLE_ANGLES = [-58, 28, 148, 212, 102];
const EMBER_X = [-0.32, 0.18, -0.08, 0.34, -0.22, 0.06];
const EMBER_COLORS = ["#FFD166", "#FF7A1A", "#FFF3B0", "#FF9F1C", "#FFE885", "#FF5A1F"];

const absCenter = (cx, cy, w, h = w) => ({
  position: "absolute",
  left: cx - w / 2,
  top: cy - h / 2,
  width: w,
  height: h,
});

/* ------------------------------------------------------------------ */
/* ProfileFrame                                                        */
/* ------------------------------------------------------------------ */

export const ProfileFrame = memo(function ProfileFrame({
  appearance,
  size,
  children,
  overlay = null,
  compactHorizontal = false,
  style,
  padMode = "symmetric",
}) {
  const reducedMotion = useReducedMotion();
  const tier = appearance?.tier || 0;
  const styleKey = appearance?.style || null;
  const animate = Boolean(appearance && tier >= 1 && !reducedMotion && size >= 30);

  useEffect(() => {
    if (!animate) return undefined;
    return retainFrameClock();
  }, [animate]);

  const geo = useMemo(
    () => (appearance ? computeFrameGeometry(appearance, size, compactHorizontal, padMode) : null),
    [appearance, size, compactHorizontal, padMode],
  );

  const isFlame = styleKey === "flame";
  const isRoyal = styleKey === "royal";

  // Boyuta bağlı (px) interpolasyonlar — yalnızca boyut değişince yeniden kurulur.
  const sized = useMemo(() => {
    if (!geo || !animate) return null;
    const shimmerD = geo.ringOuterR * 2;
    const sweep = tier <= 1 ? SWEEP_SLOW : SWEEP_MID;
    const shimmerX = sweep.interpolate({
      inputRange: [0, 1],
      outputRange: [-shimmerD * 0.85, shimmerD * 0.85],
    });
    let embers = null;
    if (isFlame && size >= 40) {
      const rise = size * 0.5;
      const count = size >= 56 ? 6 : 3;
      embers = EMBERS.slice(0, count).map((node, i) => ({
        translateY: node.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }),
        translateX: node.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, size * (i % 2 ? 0.07 : -0.07), size * (i % 2 ? 0.02 : -0.03)],
        }),
      }));
    }
    return { shimmerD, shimmerX, embers };
  }, [geo, animate, tier, isFlame, size]);

  if (!appearance || !geo) {
    return (
      <View style={[styles.plainOuter, style]}>
        <View style={[styles.box, { width: size, height: size }]}>
          {children}
          {overlay}
        </View>
      </View>
    );
  }

  const half = size / 2;
  const aura = isFlame ? AURA_FLAME : tier >= 3 ? AURA_T3 : tier === 2 ? AURA_T2 : AURA_T1;
  const auraD = geo.ringOuterR * 2 * (isFlame ? 1.06 : tier >= 3 ? 1.04 : 1.0);
  const showShimmer = animate && sized && size >= 36;
  const orbitCount = tier >= 3 ? 6 : tier === 2 ? 4 : 0;
  const showOrbit = animate && !isFlame && orbitCount > 0 && size >= 34;
  const showSecondOrbit = animate && tier >= 3 && !isFlame && size >= 44;
  const showTwinkle = animate && tier >= 3 && !isFlame && size >= 40;
  const showGlint = animate && isRoyal && size >= 40;
  const sparkD = Math.max(4, Math.round(size * (tier >= 3 ? 0.075 : 0.07)));
  const orbitR = geo.ringMidR;
  const orbit2R = geo.ringOuterR * 1.02;
  const sparkColor = appearance.sparkColor || "#FFFFFF";
  const shimmerPeak =
    isFlame
      ? "rgba(255,240,200,0.5)"
      : tier >= 3
        ? "rgba(255,255,255,0.5)"
        : tier === 2
          ? "rgba(255,248,220,0.46)"
          : "rgba(255,255,255,0.36)";

  const frameTransform = !animate
    ? undefined
    : isFlame
      ? [{ scale: FLAME_FRONT.scale }, { rotate: FLAME_FRONT.rotate }]
      : tier >= 2
        ? [{ scale: FRAME_BREATH_SCALE }]
        : undefined;

  const imageBox = {
    position: "absolute",
    left: geo.imgLeft,
    top: geo.imgTop,
    width: geo.imgSize,
    height: geo.imgSize,
  };

  let crownTip = null;
  if (showGlint && appearance.crownTip) {
    crownTip = {
      x: geo.imgLeft + appearance.crownTip.x * geo.k,
      y: geo.imgTop + appearance.crownTip.y * geo.k,
    };
  }

  return (
    <View
      style={[
        styles.outer,
        {
          paddingTop: geo.padTop,
          paddingBottom: geo.padBottom,
          paddingHorizontal: geo.padHorizontal,
        },
        style,
      ]}
    >
      <View style={[styles.box, { width: size, height: size }]}>
        {/* Aura / ısı halesi (avatarın arkasında) */}
        <Animated.View
          pointerEvents="none"
          style={[
            absCenter(half, half, auraD),
            animate ? { opacity: aura.opacity, transform: [{ scale: aura.scale }] } : styles.staticAura,
          ]}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: auraD / 2, backgroundColor: appearance.glowColor, opacity: 0.16 },
            ]}
          />
          <View
            style={{
              position: "absolute",
              left: auraD * 0.12,
              top: auraD * 0.12,
              width: auraD * 0.76,
              height: auraD * 0.76,
              borderRadius: auraD * 0.38,
              backgroundColor: appearance.glowColor,
              opacity: 0.28,
            }}
          />
        </Animated.View>

        {isFlame && animate ? (
          <Animated.View
            pointerEvents="none"
            style={[
              absCenter(half, half - size * 0.32, geo.ringOuterR * 1.5, geo.ringOuterR * 1.4),
              { transform: [{ scaleY: HEAT_SCALE_Y }] },
            ]}
          >
            <LinearGradient
              colors={["rgba(255,70,10,0)", "rgba(255,120,30,0.38)", "rgba(255,60,10,0)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: geo.ringOuterR * 0.75 }]}
            />
          </Animated.View>
        ) : null}

        {children}

        {/* Alev arka katmanı: ana katmanla ters fazda titrer */}
        {isFlame && animate ? (
          <Animated.Image
            pointerEvents="none"
            source={appearance.asset}
            resizeMode="contain"
            fadeDuration={0}
            style={[
              imageBox,
              {
                opacity: FLAME_BACK.opacity,
                transform: [
                  { translateY: -size * 0.03 },
                  { scale: FLAME_BACK.scale },
                  { rotate: FLAME_BACK.rotate },
                ],
              },
            ]}
          />
        ) : null}

        {appearance.asset ? (
          <Animated.Image
            pointerEvents="none"
            source={appearance.asset}
            resizeMode="contain"
            fadeDuration={0}
            style={[imageBox, frameTransform ? { transform: frameTransform } : null]}
          />
        ) : (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: -5,
              top: -5,
              width: size + 10,
              height: size + 10,
              borderRadius: (size + 10) / 2,
              borderWidth: appearance.width || 3,
              borderColor: appearance.color,
            }}
          />
        )}

        {/* Işık süpürmesi — daireye kırpılmış */}
        {showShimmer ? (
          <View
            pointerEvents="none"
            style={[
              absCenter(half, half, sized.shimmerD),
              { borderRadius: sized.shimmerD / 2, overflow: "hidden" },
            ]}
          >
            <Animated.View
              style={{
                position: "absolute",
                left: sized.shimmerD * 0.36,
                top: -sized.shimmerD * 0.25,
                width: sized.shimmerD * 0.28,
                height: sized.shimmerD * 1.5,
                transform: [{ translateX: sized.shimmerX }, { rotate: "22deg" }],
              }}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0)", shimmerPeak, "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        ) : null}

        {/* Birincil yörünge */}
        {showOrbit ? (
          <Animated.View
            pointerEvents="none"
            style={[
              absCenter(half, half, orbitR * 2),
              { opacity: ORBIT_OPACITY, transform: [{ rotate: tier >= 3 ? ROT_CW_2 : ROT_CW_1 }] },
            ]}
          >
            {(orbitCount === 6 ? ORBIT_ANGLES_6 : ORBIT_ANGLES_4).map((deg, idx) => {
              const rad = (deg * Math.PI) / 180;
              const x = orbitR + Math.cos(rad) * orbitR;
              const y = orbitR + Math.sin(rad) * orbitR;
              const primary = idx % 2 === 0;
              const d = primary ? sparkD : Math.max(3, Math.round(sparkD * 0.7));
              return (
                <View key={deg} style={absCenter(x, y, d * 2.4)}>
                  <View
                    style={[
                      styles.sparkHalo,
                      { borderRadius: d * 1.2, backgroundColor: appearance.glowColor },
                    ]}
                  />
                  <View
                    style={{
                      position: "absolute",
                      left: d * 0.7,
                      top: d * 0.7,
                      width: d,
                      height: d,
                      borderRadius: d / 2,
                      backgroundColor: sparkColor,
                    }}
                  />
                  {primary && size >= 52 ? (
                    <View style={styles.sparkIconWrap}>
                      <MaterialCommunityIcons
                        name="star-four-points"
                        size={Math.round(d * 1.9)}
                        color="#FFFFFF"
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Animated.View>
        ) : null}

        {/* Ters yönde dönen ikinci yörünge */}
        {showSecondOrbit ? (
          <Animated.View
            pointerEvents="none"
            style={[absCenter(half, half, orbit2R * 2), { transform: [{ rotate: ROT_CCW_1 }] }]}
          >
            {ORBIT_ANGLES_4.map((deg) => {
              const rad = ((deg + 45) * Math.PI) / 180;
              const d = Math.max(3, Math.round(sparkD * 0.6));
              return (
                <View
                  key={deg}
                  style={[
                    absCenter(orbit2R + Math.cos(rad) * orbit2R, orbit2R + Math.sin(rad) * orbit2R, d),
                    { borderRadius: d / 2, backgroundColor: appearance.accent || "#FFFFFF" },
                  ]}
                />
              );
            })}
          </Animated.View>
        ) : null}

        {/* Göz kırpan yıldızlar */}
        {showTwinkle
          ? TWINKLE_ANGLES.slice(0, size >= 56 ? 5 : 3).map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              const r = geo.ringOuterR * 0.97;
              const s = Math.max(7, Math.round(size * 0.13));
              return (
                <Animated.View
                  key={deg}
                  pointerEvents="none"
                  style={[
                    absCenter(half + Math.cos(rad) * r, half + Math.sin(rad) * r, s),
                    styles.center,
                    { opacity: TWINKLE[i], transform: [{ scale: TWINKLE_SCALE[i] }] },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="star-four-points"
                    size={s}
                    color={i % 2 ? appearance.accent || "#FFFFFF" : "#FFFFFF"}
                  />
                </Animated.View>
              );
            })
          : null}

        {/* Taç tepesi parıltısı (royal) */}
        {crownTip ? (
          <Animated.View
            pointerEvents="none"
            style={[
              absCenter(crownTip.x, crownTip.y, Math.max(14, size * 0.3)),
              styles.center,
              { opacity: GLINT, transform: [{ scale: GLINT_SCALE }, { rotate: GLINT_ROTATE }] },
            ]}
          >
            <View
              style={[
                styles.sparkHalo,
                { borderRadius: Math.max(14, size * 0.3) / 2, backgroundColor: "rgba(255,226,140,0.45)" },
              ]}
            />
            <MaterialCommunityIcons
              name="star-four-points"
              size={Math.max(12, Math.round(size * 0.24))}
              color="#FFF8DC"
            />
          </Animated.View>
        ) : null}

        {/* Yükselen közler */}
        {sized?.embers
          ? sized.embers.map((em, i) => {
              const d = Math.max(3, Math.round(size * (i % 3 === 0 ? 0.06 : 0.045)));
              return (
                <Animated.View
                  key={i}
                  pointerEvents="none"
                  style={[
                    absCenter(half + EMBER_X[i] * size, half - geo.holeR * 0.9, d),
                    {
                      borderRadius: d / 2,
                      backgroundColor: EMBER_COLORS[i],
                      opacity: EMBER_OPACITY[i],
                      transform: [
                        { translateY: em.translateY },
                        { translateX: em.translateX },
                        { scale: EMBER_SCALE[i] },
                      ],
                    },
                  ]}
                />
              );
            })
          : null}

        {overlay}
      </View>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/* Dükkan önizleme kutucuğu                                            */
/* ------------------------------------------------------------------ */

export const FramePreviewTile = memo(function FramePreviewTile({
  itemId,
  appearance,
  size = 56,
  locked = false,
  requirementText,
  selected = false,
  onPress,
  name,
  priceText,
  style,
}) {
  const app = appearance || PROFILE_ITEM_APPEARANCE[itemId] || null;
  const tileWidth = Math.max(98, Math.round(size * 2.45));
  const stageHeight = Math.round(size * 1.56);
  const accent = app?.color || "#7CC4FF";
  const reqText = requirementText ?? describeFrameRequirement(itemId);
  const cleanName = typeof name === "string"
    ? name.replace(/\s*[çÇ]er[çc]evesi$/i, "").replace(/\s*[çÇ]er[çc]eve$/i, "").trim()
    : name;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: false }}
      accessibilityLabel={[name, locked ? reqText : null, priceText].filter(Boolean).join(", ")}
      style={({ pressed }) => [
        styles.tile,
        { width: tileWidth },
        selected && { borderColor: accent, borderWidth: 1.5 },
        pressed && styles.tilePressed,
        style,
      ]}
    >
      <LinearGradient
        colors={["#1B2042", "#0C0F22"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[app?.glowColor || "rgba(124,196,255,0.25)", "rgba(0,0,0,0)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
        style={styles.tileTint}
      />
      <View style={[styles.tileStage, { height: stageHeight }]}>
        <ProfileFrame appearance={app} size={size} padMode="tight">
          <LinearGradient
            colors={["#4A5A8E", "#1E2748"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.center, { width: size, height: size, borderRadius: size / 2 }]}
          >
            <Ionicons name="person" size={Math.round(size * 0.5)} color="rgba(255,255,255,0.72)" />
          </LinearGradient>
        </ProfileFrame>
      </View>
      {cleanName ? (
        <Text style={styles.tileName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {cleanName}
        </Text>
      ) : null}
      {priceText ? (
        <View style={styles.tilePriceRow}>
          <Ionicons name="diamond" size={10} color="#FFD66B" />
          <Text style={styles.tilePrice} numberOfLines={1}>
            {priceText}
          </Text>
        </View>
      ) : null}

      {locked ? (
        <View style={styles.lockOverlay} pointerEvents="none">
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={14} color="#FFFFFF" />
          </View>
          {reqText ? (
            <Text style={styles.lockText} numberOfLines={3}>
              {reqText}
            </Text>
          ) : null}
        </View>
      ) : null}

      {selected ? (
        <View style={[styles.selectedBadge, { backgroundColor: accent }]} pointerEvents="none">
          <Ionicons name="checkmark" size={11} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  plainOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  outer: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  box: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  staticAura: {
    opacity: 0.7,
  },
  sparkHalo: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.8,
  },
  sparkIconWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  tile: {
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0C0F22",
  },
  tilePressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  tileTint: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "70%",
    opacity: 0.6,
  },
  tileStage: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  tileName: {
    marginTop: 6,
    color: "#F4F6FF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
    maxWidth: "100%",
  },
  tilePriceRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  tilePrice: {
    color: "#FFD66B",
    fontSize: 11,
    fontWeight: "800",
  },
  lockOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(6,8,20,0.66)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  lockBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  lockText: {
    marginTop: 6,
    color: "#E6E9F8",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 13,
  },
  selectedBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#0C0F22",
  },
});
