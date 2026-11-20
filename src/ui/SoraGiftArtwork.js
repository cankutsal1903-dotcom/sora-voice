import { memo, useEffect, useMemo } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "./Motion";

export const GIFT_CATEGORIES = [
  { key: "all", label: "Tümü" },
  { key: "affordable", label: "Uygun fiyatlı" },
  { key: "room", label: "Oda temalı" },
  { key: "mid", label: "Orta seviye" },
  { key: "luxury", label: "Gösterişli" },
];

export const DEFAULT_GIFT_CATALOG = [
  // Uygun fiyatlı (8)
  { id: "minik_kalp", name: "Minik Kalp", icon: "heart", color: "#FF5E8A", cost: 10_000, category: "affordable", minFamilyLevel: 0, sortOrder: 10 },
  { id: "gulumseme", name: "Gülümseme", icon: "happy", color: "#FFB02E", cost: 15_000, category: "affordable", minFamilyLevel: 0, sortOrder: 11 },
  { id: "kahve_molasi", name: "Kahve Molası", icon: "cafe", color: "#B87444", cost: 25_000, category: "affordable", minFamilyLevel: 0, sortOrder: 12 },
  { id: "renkli_balon", name: "Renkli Balon", icon: "balloon", color: "#4DA6FF", cost: 35_000, category: "affordable", minFamilyLevel: 0, sortOrder: 13 },
  { id: "sans_kurabiyesi", name: "Şans Kurabiyesi", icon: "sparkles", color: "#E89B2D", cost: 45_000, category: "affordable", minFamilyLevel: 0, sortOrder: 14 },
  { id: "parilti", name: "Parıltı", icon: "sparkles", color: "#38B6FF", cost: 60_000, category: "affordable", minFamilyLevel: 0, sortOrder: 15 },
  { id: "ucan_opucuk", name: "Uçan Öpücük", icon: "heart", color: "#F24976", cost: 75_000, category: "affordable", minFamilyLevel: 0, sortOrder: 16 },
  { id: "tatli_kedi", name: "Tatlı Kedi", icon: "happy", color: "#8B6CEF", cost: 90_000, category: "affordable", minFamilyLevel: 0, sortOrder: 17 },

  // Oda temalı (8)
  { id: "dinleyici_destegi", name: "Dinleyici Desteği", icon: "headset", color: "#2F80ED", cost: 50_000, category: "room", minFamilyLevel: 0, sortOrder: 20 },
  { id: "soz_sende", name: "Söz Sende", icon: "mic", color: "#2596FF", cost: 80_000, category: "room", minFamilyLevel: 0, sortOrder: 21 },
  { id: "alkis_yagmuru", name: "Alkış Yağmuru", icon: "sparkles", color: "#36A2EB", cost: 120_000, category: "room", minFamilyLevel: 0, sortOrder: 22 },
  { id: "sahne_isigi", name: "Sahne Işığı", icon: "sunny", color: "#F5A623", cost: 175_000, category: "room", minFamilyLevel: 0, sortOrder: 23 },
  { id: "mikrofon_yildizi", name: "Mikrofon Yıldızı", icon: "mic", color: "#4E7BFF", cost: 240_000, category: "room", minFamilyLevel: 0, sortOrder: 24 },
  { id: "dj_seti", name: "DJ Seti", icon: "musical-notes", color: "#7B5CFF", cost: 320_000, category: "room", minFamilyLevel: 0, sortOrder: 25 },
  { id: "konusma_taci", name: "Konuşma Tacı", icon: "trophy", color: "#D99B1E", cost: 400_000, category: "room", minFamilyLevel: 0, sortOrder: 26 },
  { id: "oda_yildizi", name: "Oda Yıldızı", icon: "star", color: "#1D6FE8", cost: 500_000, category: "room", minFamilyLevel: 0, sortOrder: 27 },

  // Orta seviye (10)
  { id: "gul_buketi", name: "Gül Buketi", icon: "rose", color: "#E03E65", cost: 150_000, category: "mid", minFamilyLevel: 0, sortOrder: 30 },
  { id: "neon_mikrofon", name: "Neon Mikrofon", icon: "mic", color: "#00B4FF", cost: 220_000, category: "mid", minFamilyLevel: 0, sortOrder: 31 },
  { id: "disko_topu", name: "Disko Topu", icon: "sparkles", color: "#8E54E9", cost: 300_000, category: "mid", minFamilyLevel: 0, sortOrder: 32 },
  { id: "ay_isigi", name: "Ay Işığı", icon: "moon", color: "#4B6CB7", cost: 400_000, category: "mid", minFamilyLevel: 0, sortOrder: 33 },
  { id: "yildiz_yagmuru", name: "Yıldız Yağmuru", icon: "star", color: "#2B5876", cost: 520_000, category: "mid", minFamilyLevel: 0, sortOrder: 34 },
  { id: "gokkusagi", name: "Gökkuşağı", icon: "sunny", color: "#3A8DFF", cost: 650_000, category: "mid", minFamilyLevel: 0, sortOrder: 35 },
  { id: "kristal_kelebek", name: "Kristal Kelebek", icon: "diamond", color: "#26C6DA", cost: 800_000, category: "mid", minFamilyLevel: 0, sortOrder: 36 },
  { id: "altin_tac", name: "Altın Taç", icon: "trophy", color: "#D49A1A", cost: 1_000_000, category: "mid", minFamilyLevel: 0, sortOrder: 37 },
  { id: "ferrari", name: "Ferrari", icon: "car-sport", color: "#D92534", cost: 1_250_000, category: "mid", minFamilyLevel: 0, sortOrder: 38 },
  { id: "lamborghini", name: "Lamborghini", icon: "car-sport", color: "#E09F1F", cost: 1_500_000, category: "mid", minFamilyLevel: 0, sortOrder: 39 },

  // Gösterişli (8)
  { id: "isik_selalesi", name: "Işık Şelalesi", icon: "water", color: "#1CA7EC", cost: 2_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 40 },
  { id: "gokyuzu_treni", name: "Gökyüzü Treni", icon: "train", color: "#2F6FE0", cost: 3_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 41 },
  { id: "kraliyet_arabasi", name: "Kraliyet Arabası", icon: "car-sport", color: "#B8860B", cost: 4_200_000, category: "luxury", minFamilyLevel: 0, sortOrder: 42 },
  { id: "kozmik_balina", name: "Kozmik Balina", icon: "water", color: "#1B3B82", cost: 5_500_000, category: "luxury", minFamilyLevel: 0, sortOrder: 43 },
  { id: "efsanevi_anka", name: "Efsanevi Anka", icon: "flame", color: "#E65C00", cost: 7_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 44 },
  { id: "elmas_aslan", name: "Elmas Aslan", icon: "diamond", color: "#1E56B5", cost: 8_500_000, category: "luxury", minFamilyLevel: 0, sortOrder: 45 },
  { id: "yildiz_gemisi", name: "Yıldız Gemisi", icon: "rocket", color: "#183468", cost: 10_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 46 },
  { id: "kraliyet_sahnesi", name: "Kraliyet Sahnesi", icon: "trophy", color: "#142952", cost: 12_000_000, category: "luxury", minFamilyLevel: 0, sortOrder: 47 },
];

// Original transparent collectible illustrations, bundled locally for offline use.
export const GIFT_ARTWORK_SOURCES = {
  minik_kalp: require("../../assets/gifts/v2/minik_kalp.png"),
  gulumseme: require("../../assets/gifts/v2/gulumseme.png"),
  kahve_molasi: require("../../assets/gifts/v2/kahve_molasi.png"),
  renkli_balon: require("../../assets/gifts/v2/renkli_balon.png"),
  sans_kurabiyesi: require("../../assets/gifts/v2/sans_kurabiyesi.png"),
  parilti: require("../../assets/gifts/v2/parilti.png"),
  ucan_opucuk: require("../../assets/gifts/v2/ucan_opucuk.png"),
  tatli_kedi: require("../../assets/gifts/v2/tatli_kedi.png"),
  dinleyici_destegi: require("../../assets/gifts/v2/dinleyici_destegi.png"),
  soz_sende: require("../../assets/gifts/v2/soz_sende.png"),
  alkis_yagmuru: require("../../assets/gifts/v2/alkis_yagmuru.png"),
  sahne_isigi: require("../../assets/gifts/v2/sahne_isigi.png"),
  mikrofon_yildizi: require("../../assets/gifts/v2/mikrofon_yildizi.png"),
  dj_seti: require("../../assets/gifts/v2/dj_seti.png"),
  konusma_taci: require("../../assets/gifts/v2/konusma_taci.png"),
  oda_yildizi: require("../../assets/gifts/v2/oda_yildizi.png"),
  gul_buketi: require("../../assets/gifts/v2/gul_buketi.png"),
  neon_mikrofon: require("../../assets/gifts/v2/neon_mikrofon.png"),
  disko_topu: require("../../assets/gifts/v2/disko_topu.png"),
  ay_isigi: require("../../assets/gifts/v2/ay_isigi.png"),
  yildiz_yagmuru: require("../../assets/gifts/v2/yildiz_yagmuru.png"),
  gokkusagi: require("../../assets/gifts/v2/gokkusagi.png"),
  kristal_kelebek: require("../../assets/gifts/v2/kristal_kelebek.png"),
  altin_tac: require("../../assets/gifts/v2/altin_tac.png"),
  ferrari: require("../../assets/gifts/v2/ferrari.png"),
  lamborghini: require("../../assets/gifts/v2/lamborghini.png"),
  isik_selalesi: require("../../assets/gifts/v2/isik_selalesi.png"),
  gokyuzu_treni: require("../../assets/gifts/v2/gokyuzu_treni.png"),
  kraliyet_arabasi: require("../../assets/gifts/v2/kraliyet_arabasi.png"),
  kozmik_balina: require("../../assets/gifts/v2/kozmik_balina.png"),
  efsanevi_anka: require("../../assets/gifts/v2/efsanevi_anka.png"),
  elmas_aslan: require("../../assets/gifts/v2/elmas_aslan.png"),
  yildiz_gemisi: require("../../assets/gifts/v2/yildiz_gemisi.png"),
  kraliyet_sahnesi: require("../../assets/gifts/v2/kraliyet_sahnesi.png"),
};

const NAME_TO_GIFT_ID = Object.fromEntries(
  DEFAULT_GIFT_CATALOG.map((item) => [item.name.toLocaleLowerCase("tr-TR"), item.id]),
);

export const resolveGiftRecipeKey = (giftId, giftName) => {
  if (giftId && Object.hasOwn(GIFT_ARTWORK_SOURCES, giftId)) return giftId;
  const normalizedName = String(giftName || "").trim().toLocaleLowerCase("tr-TR");
  return Object.hasOwn(NAME_TO_GIFT_ID, normalizedName) ? NAME_TO_GIFT_ID[normalizedName] : null;
};

/** Shared original illustration for catalog, chat receipt, and the animated gift scene. */
export const SoraGiftArtwork = memo(function SoraGiftArtwork({
  giftId,
  giftName,
  fallbackIcon = "gift",
  fallbackColor = "#2F80ED",
  size = 54,
  onLoad,
  onError,
}) {
  const key = resolveGiftRecipeKey(giftId, giftName);
  const source = GIFT_ARTWORK_SOURCES[key];
  if (source) {
    return (
      <Image
        source={source}
        resizeMode="contain"
        resizeMethod="resize"
        accessible={false}
        fadeDuration={0}
        onLoad={onLoad}
        onError={onError}
        style={{ width: size, height: size }}
      />
    );
  }
  // Future server-only catalog items remain usable until their illustration is shipped.
  const icon = Ionicons.glyphMap?.[fallbackIcon] ? fallbackIcon : "gift";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={Math.round(size * 0.58)} color={fallbackColor} />
    </View>
  );
});

export const LEVEL_BADGE_TIERS = [
  {
    tier: 0,
    minLevel: 1,
    maxLevel: 9,
    code: "sora_crest_t0",
    name: "Başlangıç Arması",
    rangeLabel: "Sv. 1 – 9",
    grad: ["#3A7BD5", "#1F4B8E", "#12284C"],
    border: "#8EC5FF",
    accent: "#DCEEFF",
    centerIcon: "shield-star",
    wings: false,
    crown: false,
    diamondBack: false,
    octagramBack: false,
    gems: 0,
  },
  {
    tier: 1,
    minLevel: 10,
    maxLevel: 19,
    code: "sora_crest_t1",
    name: "Gümüş Kanat Rozeti",
    rangeLabel: "Sv. 10 – 19",
    grad: ["#60A5FA", "#2563EB", "#172554"],
    border: "#E2E8F0",
    accent: "#F8FAFC",
    centerIcon: "medal",
    wings: true,
    wingColor: "#CBD5E1",
    crown: false,
    diamondBack: false,
    octagramBack: false,
    gems: 2,
  },
  {
    tier: 2,
    minLevel: 20,
    maxLevel: 29,
    code: "sora_crest_t2",
    name: "Altın Hare Rozeti",
    rangeLabel: "Sv. 20 – 29",
    grad: ["#F59E0B", "#2563EB", "#132347"],
    border: "#FDE047",
    accent: "#FEF08A",
    centerIcon: "shield-sun",
    wings: true,
    wingColor: "#FCD34D",
    crown: false,
    diamondBack: true,
    octagramBack: false,
    gems: 3,
  },
  {
    tier: 3,
    minLevel: 30,
    maxLevel: 39,
    code: "sora_crest_t3",
    name: "Kristal Taç Rozeti",
    rangeLabel: "Sv. 30 – 39",
    grad: ["#38BDF8", "#1D4ED8", "#0F172A"],
    border: "#67E8F9",
    accent: "#FDE047",
    centerIcon: "shield-crown",
    wings: true,
    wingColor: "#7DD3FC",
    crown: true,
    crownColor: "#FDE047",
    diamondBack: true,
    octagramBack: false,
    gems: 4,
  },
  {
    tier: 4,
    minLevel: 40,
    maxLevel: 49,
    code: "sora_crest_t4",
    name: "Asil Hükümran Rozeti",
    rangeLabel: "Sv. 40 – 49",
    grad: ["#FBBF24", "#1E40AF", "#090D24"],
    border: "#FDE68A",
    accent: "#67E8F9",
    centerIcon: "trophy-award",
    wings: true,
    doubleWings: true,
    wingColor: "#FBBF24",
    crown: true,
    crownColor: "#FEF08A",
    diamondBack: true,
    octagramBack: true,
    gems: 6,
  },
  {
    tier: 5,
    minLevel: 50,
    maxLevel: 999,
    code: "sora_crest_t5",
    name: "İmparatorluk Zirve Rozeti",
    rangeLabel: "Sv. 50+",
    grad: ["#FFE066", "#2563EB", "#060B1E"],
    border: "#FFF3B0",
    accent: "#72EFDD",
    centerIcon: "chess-king",
    wings: true,
    doubleWings: true,
    imperialAura: true,
    wingColor: "#FFE066",
    crown: true,
    crownColor: "#FFF8DC",
    diamondBack: true,
    octagramBack: true,
    gems: 8,
  },
].map((tier) => ({
  ...tier,
  key: tier.code,
  title: tier.name,
  borderColor: tier.border,
}));

const LEVEL_BADGE_ARTWORK = {
  sora_crest_t0: require("../../assets/badges/v1/sora_crest_t0.png"),
  sora_crest_t1: require("../../assets/badges/v1/sora_crest_t1.png"),
  sora_crest_t2: require("../../assets/badges/v1/sora_crest_t2.png"),
  sora_crest_t3: require("../../assets/badges/v1/sora_crest_t3.png"),
  sora_crest_t4: require("../../assets/badges/v1/sora_crest_t4.png"),
  sora_crest_t5: require("../../assets/badges/v1/sora_crest_t5.png"),
};

const ACHIEVEMENT_BADGE_ARTWORK = {
  "first-listen": require("../../assets/badges/v1/achievement_first_listen.png"),
  host: require("../../assets/badges/v1/achievement_host.png"),
  curator: require("../../assets/badges/v1/achievement_explorer.png"),
  family: require("../../assets/badges/v1/achievement_family.png"),
};

export const getBadgeTierConfigForLevel = (rawLevel = 1) => {
  const lvl = Math.max(1, Math.floor(Number(rawLevel) || 1));
  const tierIndex = Math.min(5, Math.floor(lvl / 10));
  return LEVEL_BADGE_TIERS[tierIndex] || LEVEL_BADGE_TIERS[0];
};

/* ---- Rozet efektleri: tek paylaşılan native saat (12 sn döngü) ---- */
const CREST_CLOCK_MS = 12000;
const crestClock = new Animated.Value(0);
let crestClockRefs = 0;
let crestClockAnim = null;

const retainCrestClock = () => {
  crestClockRefs += 1;
  if (!crestClockAnim) {
    crestClockAnim = Animated.loop(
      Animated.timing(crestClock, {
        toValue: 1,
        duration: CREST_CLOCK_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    crestClockAnim.start();
  }
  return () => {
    crestClockRefs = Math.max(0, crestClockRefs - 1);
    if (crestClockRefs === 0 && crestClockAnim) {
      crestClockAnim.stop();
      crestClockAnim = null;
    }
  };
};

// Periyodik anahtar kareleri saatin [0,1] aralığına yayar (native interpolasyon easing desteklemez).
const crestPeriodic = (cycles, keys, offset = 0) => {
  const pts = [];
  for (let c = -1; c <= cycles; c += 1) {
    for (let i = 0; i < keys.length; i += 1) pts.push([(c + keys[i][0] + offset) / cycles, keys[i][1]]);
  }
  const valueAt = (t) => {
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (t >= a[0] && t <= b[0]) {
        return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
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
  return crestClock.interpolate({ inputRange, outputRange, extrapolate: "clamp" });
};
const crestSine = (samples = 8) =>
  Array.from({ length: samples + 1 }, (_, i) => [i / samples, 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / samples)]);

const C_BREATH = crestPeriodic(4, crestSine()); // 3 sn
const C_FLOAT = crestPeriodic(3, crestSine(), 0.25); // 4 sn
const C_SWEEP = crestPeriodic(3, [[0, 0], [0.26, 1], [1, 1]], 0.4); // her 4 sn
const C_ROT = crestClock.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
const C_TWINKLE_A = crestPeriodic(6, [[0, 0.35], [0.5, 1], [1, 0.35]]);
const C_TWINKLE_B = crestPeriodic(6, [[0, 1], [0.5, 0.35], [1, 1]]);
const C_GLOW_OPACITY = C_BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
const C_GLOW_SCALE = C_BREATH.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.06] });
const CREST_RING_ANGLES = [-90, -30, 30, 90, 150, 210];

// Kademeye göre hale rengi/büyüklüğü, seviye hapı gradyanı, parıltı rengi
const CREST_FX = [
  { glow: "rgba(96,165,250,0.20)", glowScale: 0.92, pill: ["#2E63B0", "#132A55"], sweep: "rgba(255,255,255,0.32)", spark: "#BFE0FF" },
  { glow: "rgba(191,219,254,0.26)", glowScale: 1.0, pill: ["#6383B8", "#1D2D55"], sweep: "rgba(255,255,255,0.38)", spark: "#E2E8F0" },
  { glow: "rgba(255,196,64,0.32)", glowScale: 1.06, pill: ["#E6A51F", "#6E4205"], sweep: "rgba(255,246,210,0.5)", spark: "#FDE047" },
  { glow: "rgba(103,232,249,0.34)", glowScale: 1.1, pill: ["#25B9E3", "#1C3C9E"], sweep: "rgba(230,252,255,0.52)", spark: "#A5F3FC" },
  { glow: "rgba(255,200,60,0.40)", glowScale: 1.15, pill: ["#F2B620", "#1E3A9E"], sweep: "rgba(255,248,215,0.55)", spark: "#FDE68A" },
  { glow: "rgba(255,226,110,0.46)", glowScale: 1.22, pill: ["#F7C948", "#8A4B08"], sweep: "rgba(255,252,230,0.6)", spark: "#72EFDD" },
];

const ACHIEVEMENT_FX = {
  "first-listen": { glow: "rgba(96,165,250,0.30)", sweep: "rgba(255,255,255,0.42)" },
  host: { glow: "rgba(255,196,64,0.32)", sweep: "rgba(255,246,210,0.5)" },
  curator: { glow: "rgba(45,212,191,0.30)", sweep: "rgba(230,255,250,0.45)" },
  family: { glow: "rgba(192,132,252,0.32)", sweep: "rgba(250,240,255,0.48)" },
};

const crestAbsCenter = (cx, cy, w, h = w) => ({
  position: "absolute",
  left: cx - w / 2,
  top: cy - h / 2,
  width: w,
  height: h,
});

/**
 * Her 10 seviyede bir (1, 10, 20, 30, 40, 50+) giderek daha şahşahlı hale gelen özel kullanıcı seviye rozeti.
 */
export const SoraLevelCrest = memo(function SoraLevelCrest({
  level = 1,
  size = 44,
  showLevel = false,
  showLevelTag = false,
  locked = false,
}) {
  const tier = getBadgeTierConfigForLevel(level);
  const artwork = LEVEL_BADGE_ARTWORK[tier.code];
  const reducedMotion = useReducedMotion();
  const fx = CREST_FX[tier.tier] || CREST_FX[0];
  const animate = Boolean(artwork && !locked && !reducedMotion && size >= 28 && tier.tier >= 1);

  useEffect(() => {
    if (!animate) return undefined;
    return retainCrestClock();
  }, [animate]);

  const floatY = useMemo(
    () =>
      animate && tier.tier >= 4
        ? C_FLOAT.interpolate({ inputRange: [0, 1], outputRange: [size * 0.025, -size * 0.035] })
        : null,
    [animate, tier.tier, size],
  );
  const sweepX = useMemo(
    () =>
      animate && tier.tier >= 2
        ? C_SWEEP.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.62, size * 0.62] })
        : null,
    [animate, tier.tier, size],
  );

  if (artwork) {
    const glowD = size * fx.glowScale;
    const shimmerD = size * 0.64;
    const ringR = size * 0.56;
    const showRing = animate && tier.tier >= 5 && size >= 34;
    const pillFont = Math.max(8, Math.min(11, Math.round(size * 0.19)));
    return (
      <View style={[artStyles.crestArtRoot, { width: size, height: size }]}>
        {!locked ? (
          <Animated.View
            pointerEvents="none"
            style={[
              crestAbsCenter(size / 2, size / 2, glowD),
              animate ? { opacity: C_GLOW_OPACITY, transform: [{ scale: C_GLOW_SCALE }] } : artStyles.crestGlowStatic,
            ]}
          >
            <View style={[artStyles.crestFill, { borderRadius: glowD / 2, backgroundColor: fx.glow, opacity: 0.5 }]} />
            <View
              style={{
                position: "absolute",
                left: glowD * 0.14,
                top: glowD * 0.14,
                width: glowD * 0.72,
                height: glowD * 0.72,
                borderRadius: glowD * 0.36,
                backgroundColor: fx.glow,
              }}
            />
          </Animated.View>
        ) : null}

        {showRing ? (
          <Animated.View
            pointerEvents="none"
            style={[crestAbsCenter(size / 2, size / 2, ringR * 2), { transform: [{ rotate: C_ROT }] }]}
          >
            {CREST_RING_ANGLES.map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              const s = Math.max(6, Math.round(size * (i % 2 ? 0.1 : 0.14)));
              return (
                <Animated.View
                  key={deg}
                  style={[
                    crestAbsCenter(ringR + Math.cos(rad) * ringR, ringR + Math.sin(rad) * ringR, s),
                    artStyles.crestCenter,
                    { opacity: i % 2 ? C_TWINKLE_B : C_TWINKLE_A },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="star-four-points"
                    size={s}
                    color={i % 2 ? fx.spark : "#FFFFFF"}
                  />
                </Animated.View>
              );
            })}
          </Animated.View>
        ) : null}

        <Animated.View
          style={[
            artStyles.crestArtBody,
            { width: size, height: size },
            floatY ? { transform: [{ translateY: floatY }] } : null,
          ]}
        >
          <Image
            source={artwork}
            resizeMode="contain"
            resizeMethod="resize"
            accessible={false}
            fadeDuration={0}
            style={{ width: size, height: size, opacity: locked ? 0.34 : 1 }}
          />
          {sweepX ? (
            <View
              pointerEvents="none"
              style={[
                crestAbsCenter(size / 2, size * 0.5, shimmerD),
                { borderRadius: shimmerD / 2, overflow: "hidden" },
              ]}
            >
              <Animated.View
                style={{
                  position: "absolute",
                  left: shimmerD * 0.36,
                  top: -shimmerD * 0.25,
                  width: shimmerD * 0.28,
                  height: shimmerD * 1.5,
                  transform: [{ translateX: sweepX }, { rotate: "24deg" }],
                }}
              >
                <LinearGradient
                  colors={["rgba(255,255,255,0)", fx.sweep, "rgba(255,255,255,0)"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={artStyles.crestFill}
                />
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>

        {showLevel || showLevelTag ? (
          <View style={[artStyles.crestPillWrap, { borderColor: tier.border, opacity: locked ? 0.6 : 1 }]}>
            <LinearGradient
              colors={fx.pill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={artStyles.crestPillGrad}
            >
              <View style={artStyles.crestPillGloss} />
              <Text style={[artStyles.crestPillText, { fontSize: pillFont }]}>Sv.{level}</Text>
            </LinearGradient>
          </View>
        ) : null}
      </View>
    );
  }
  const wingSize = Math.max(11, Math.round(size * 0.34));
  const crownSize = Math.max(10, Math.round(size * 0.3));
  const coreSize = Math.round(size * 0.78);
  const plateSize = Math.round(size * 0.66);

  return (
    <View
      style={[
        artStyles.crestRoot,
        {
          width: tier.wings ? Math.round(size * 1.28) : size,
          height: tier.crown ? Math.round(size * 1.16) : size,
          opacity: locked ? 0.45 : 1,
        },
      ]}
    >
      {/* İmparatorluk dış ışık halesi (Sv. 50+) */}
      {tier.imperialAura ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.imperialHalo,
            {
              width: Math.round(size * 1.08),
              height: Math.round(size * 1.08),
              borderRadius: size,
              borderColor: "rgba(255,224,102,0.55)",
            },
          ]}
        />
      ) : null}

      {/* Sekiz köşeli şahşahlı arka yıldız plakası (Sv. 40+ ve 50+) */}
      {tier.octagramBack ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.crestBackPlate,
            {
              width: plateSize,
              height: plateSize,
              borderRadius: Math.max(4, Math.round(size * 0.1)),
              borderColor: tier.border,
              backgroundColor: "rgba(37,99,235,0.28)",
              transform: [{ rotate: "22.5deg" }],
            },
          ]}
        />
      ) : null}

      {/* Elmas arka plaka (Sv. 20+) */}
      {tier.diamondBack ? (
        <View
          pointerEvents="none"
          style={[
            artStyles.crestBackPlate,
            {
              width: plateSize,
              height: plateSize,
              borderRadius: Math.max(4, Math.round(size * 0.12)),
              borderColor: tier.border,
              backgroundColor: "rgba(29,78,216,0.34)",
              transform: [{ rotate: "45deg" }],
            },
          ]}
        />
      ) : null}

      {/* Yan kanatlar (Sv. 10+ tek kanat, Sv. 40+ çift katmanlı kanat) */}
      {tier.wings ? (
        <>
          <View
            pointerEvents="none"
            style={[
              artStyles.wingLeft,
              { left: 0, transform: [{ rotate: "-24deg" }, { scaleX: -1 }] },
            ]}
          >
            <MaterialCommunityIcons name="feather" size={wingSize} color={tier.wingColor} />
          </View>
          <View
            pointerEvents="none"
            style={[
              artStyles.wingRight,
              { right: 0, transform: [{ rotate: "-24deg" }] },
            ]}
          >
            <MaterialCommunityIcons name="feather" size={wingSize} color={tier.wingColor} />
          </View>
          {tier.doubleWings ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  artStyles.wingLeft,
                  {
                    left: Math.round(size * 0.04),
                    bottom: Math.round(size * 0.08),
                    transform: [{ rotate: "-48deg" }, { scaleX: -1 }],
                  },
                ]}
              >
                <MaterialCommunityIcons name="feather" size={Math.round(wingSize * 0.82)} color={tier.accent} />
              </View>
              <View
                pointerEvents="none"
                style={[
                  artStyles.wingRight,
                  {
                    right: Math.round(size * 0.04),
                    bottom: Math.round(size * 0.08),
                    transform: [{ rotate: "-48deg" }],
                  },
                ]}
              >
                <MaterialCommunityIcons name="feather" size={Math.round(wingSize * 0.82)} color={tier.accent} />
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {/* Merkez madalyon */}
      <LinearGradient
        colors={tier.grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          artStyles.crestCore,
          {
            width: coreSize,
            height: coreSize,
            borderRadius: coreSize / 2,
            borderColor: tier.border,
            borderWidth: tier.tier >= 4 ? 2.2 : tier.tier >= 2 ? 1.8 : 1.4,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            artStyles.crestInnerRing,
            {
              width: Math.round(coreSize * 0.78),
              height: Math.round(coreSize * 0.78),
              borderRadius: coreSize,
              borderColor: "rgba(255,255,255,0.34)",
            },
          ]}
        />
        <MaterialCommunityIcons
          name={tier.centerIcon}
          size={Math.max(12, Math.round(coreSize * 0.5))}
          color={tier.tier >= 4 ? "#FFF8DC" : "#FFFFFF"}
        />
      </LinearGradient>

      {/* Üst taç (Sv. 30+) */}
      {tier.crown ? (
        <View pointerEvents="none" style={[artStyles.crestCrown, { top: 0 }]}>
          <MaterialCommunityIcons name="crown" size={crownSize} color={tier.crownColor} />
        </View>
      ) : null}

      {/* Köşe mücevher parıltıları (Sv. 20+) */}
      {tier.gems >= 3 ? (
        <>
          <View pointerEvents="none" style={[artStyles.gemTopLeft, { top: Math.round(size * 0.1), left: Math.round(size * 0.16) }]}>
            <MaterialCommunityIcons name="star-four-points" size={Math.max(8, Math.round(size * 0.2))} color={tier.accent} />
          </View>
          <View pointerEvents="none" style={[artStyles.gemTopRight, { top: Math.round(size * 0.1), right: Math.round(size * 0.16) }]}>
            <MaterialCommunityIcons name="star-four-points" size={Math.max(8, Math.round(size * 0.2))} color={tier.accent} />
          </View>
        </>
      ) : null}

      {showLevelTag ? (
        <View style={[artStyles.crestLevelPill, { borderColor: tier.border }]}>
          <Text style={artStyles.crestLevelText}>Sv.{level}</Text>
        </View>
      ) : null}
    </View>
  );
});

export const SoraAchievementBadge = memo(function SoraAchievementBadge({
  badgeId,
  size = 54,
  locked = false,
}) {
  const artwork = ACHIEVEMENT_BADGE_ARTWORK[badgeId];
  const reducedMotion = useReducedMotion();
  const animate = Boolean(artwork && !locked && !reducedMotion && size >= 28);

  useEffect(() => {
    if (!animate) return undefined;
    return retainCrestClock();
  }, [animate]);

  const sweepX = useMemo(
    () =>
      animate ? C_SWEEP.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.62, size * 0.62] }) : null,
    [animate, size],
  );

  if (!artwork) return null;
  const fx = ACHIEVEMENT_FX[badgeId] || ACHIEVEMENT_FX["first-listen"];
  const glowD = size * 1.04;
  const shimmerD = size * 0.68;
  return (
    <View style={[artStyles.crestArtRoot, { width: size, height: size }]}>
      {!locked ? (
        <Animated.View
          pointerEvents="none"
          style={[
            crestAbsCenter(size / 2, size / 2, glowD),
            animate ? { opacity: C_GLOW_OPACITY, transform: [{ scale: C_GLOW_SCALE }] } : artStyles.crestGlowStatic,
          ]}
        >
          <View style={[artStyles.crestFill, { borderRadius: glowD / 2, backgroundColor: fx.glow, opacity: 0.5 }]} />
          <View
            style={{
              position: "absolute",
              left: glowD * 0.14,
              top: glowD * 0.14,
              width: glowD * 0.72,
              height: glowD * 0.72,
              borderRadius: glowD * 0.36,
              backgroundColor: fx.glow,
            }}
          />
        </Animated.View>
      ) : null}
      <Image
        source={artwork}
        resizeMode="contain"
        resizeMethod="resize"
        accessible={false}
        fadeDuration={0}
        style={{ width: size, height: size, opacity: locked ? 0.34 : 1 }}
      />
      {sweepX ? (
        <View
          pointerEvents="none"
          style={[crestAbsCenter(size / 2, size / 2, shimmerD), { borderRadius: shimmerD / 2, overflow: "hidden" }]}
        >
          <Animated.View
            style={{
              position: "absolute",
              left: shimmerD * 0.36,
              top: -shimmerD * 0.25,
              width: shimmerD * 0.28,
              height: shimmerD * 1.5,
              transform: [{ translateX: sweepX }, { rotate: "24deg" }],
            }}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0)", fx.sweep, "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={artStyles.crestFill}
            />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
});

const artStyles = StyleSheet.create({
  crestRoot: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  imperialHalo: {
    position: "absolute",
    borderWidth: 1.5,
    backgroundColor: "rgba(255,224,102,0.12)",
  },
  crestBackPlate: {
    position: "absolute",
    borderWidth: 1.3,
  },
  wingLeft: {
    position: "absolute",
    zIndex: 1,
  },
  wingRight: {
    position: "absolute",
    zIndex: 1,
  },
  crestCore: {
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#09152E",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  crestInnerRing: {
    position: "absolute",
    borderWidth: 1,
  },
  crestCrown: {
    position: "absolute",
    zIndex: 5,
  },
  gemTopLeft: {
    position: "absolute",
    zIndex: 4,
  },
  gemTopRight: {
    position: "absolute",
    zIndex: 4,
  },
  crestLevelPill: {
    position: "absolute",
    bottom: -4,
    zIndex: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 99,
    backgroundColor: "#0F1D38",
    borderWidth: 1,
  },
  crestLevelText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  crestArtRoot: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "visible",
  },
  crestArtBody: {
    alignItems: "center",
    justifyContent: "center",
  },
  crestFill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  crestCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  crestGlowStatic: {
    opacity: 0.8,
  },
  crestPillWrap: {
    position: "absolute",
    bottom: -4,
    zIndex: 6,
    borderRadius: 99,
    borderWidth: 1,
    overflow: "hidden",
  },
  crestPillGrad: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  crestPillGloss: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "50%",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  crestPillText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
