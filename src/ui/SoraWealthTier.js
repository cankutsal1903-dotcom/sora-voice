/**
 * SoraWealthTier — Sora "Cömertlik Seviyesi" (hediye zenginlik seviyesi).
 *
 * Kullanici hediye GONDERDIKCE (toplam harcanan kredi) yukselir ve profil,
 * oda sohbet satiri, koltuk gibi yerlerde prestij rozeti olarak gorunur.
 *
 * Performans notlari:
 *  - Tum rozetler/amblemler iki adet modul seviyesi Animated.Value (hizli +
 *    yavas saat) paylasir. Saatler ref-sayimli; ilk animasyonlu bilesen
 *    mount oldugunda baslar, son bilesen unmount oldugunda durur.
 *  - Sadece transform / opacity, useNativeDriver: true. JS tarafinda kare
 *    dongusu, setInterval vb. yok.
 *  - Azaltilmis hareket aciksa her sey statik cizilir.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "./Motion";

/* -------------------------------------------------------------------------- */
/*                                   Palette                                  */
/* -------------------------------------------------------------------------- */

const BRAND = {
  blue: "#1C5FB8",
  blueLight: "#2F80ED",
  ink: "#101820",
  inkSoft: "#1D2E43",
  white: "#FFFFFF",
  gold: "#F6C86E",
  goldLight: "#FFD978",
};

const GOLD_GRADIENT = ["#FFF1C1", "#FFD978", "#F6C86E", "#C8923A"];
const GOLD_WING = ["#FFF6D8", "#FFD978", "#C8923A"];
const VIOLET_WING = ["#FFF0C2", "#C59BFF", "#5B2FA6"];

const withAlpha = (hex, alpha) => {
  const raw = String(hex || "#000000").replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/* -------------------------------------------------------------------------- */
/*                                 Tier ladder                                */
/* -------------------------------------------------------------------------- */

const FAMILY_META = {
  none: { title: "Başlangıç", motto: "İlk hediyeni gönder" },
  isilti: { title: "Işıltı", motto: "Parlayan yıldız" },
  safir: { title: "Safir", motto: "Safir asaleti" },
  hukumdar: { title: "Hükümdar", motto: "Hükümdar sınıfı" },
  efsane: { title: "Efsane", motto: "Efsanevi cömertlik" },
};

// [level, short, family, minSpent, colors, accent, glow, icon, ornate, ink, iconColor, deep, perk]
const RAW_TIERS = [
  [0, "Çaylak", "none", 0, ["#3A4A5E", "#2A384A", "#1F2B3A"], "#A9B7C8", "rgba(169,183,200,0.18)", "star-four-points-outline", 0, "#DCE4EE", "#C9D4E2", "#18222E", "Henüz hediye gönderilmedi"],
  [1, "Işıltı I", "isilti", 1000000, ["#DCE6F3", "#A8BAD2", "#7A90AE"], "#F2F7FF", "rgba(168,196,232,0.40)", "star-four-points", 1, "#11253F", "#FFFFFF", "#3E536F", "Gümüş yıldız rozeti"],
  [2, "Işıltı II", "isilti", 5000000, ["#E4EEFA", "#A9C3E6", "#6D8FBF"], "#FFFFFF", "rgba(150,190,240,0.45)", "star-four-points", 1, "#0E2340", "#FFFFFF", "#34507A", "Parlak gümüş rozet"],
  [3, "Işıltı III", "isilti", 15000000, ["#F1F7FF", "#B6D3F5", "#5E88C2"], "#FFFFFF", "rgba(140,190,255,0.50)", "star-four-points", 1, "#0B2142", "#FFFFFF", "#2C4C7E", "Buz mavisi ışıltı"],
  [4, "Safir I", "safir", 40000000, ["#5CD2FF", "#2F80ED", "#1C5FB8"], "#BFF1FF", "rgba(64,190,255,0.45)", "diamond-stone", 2, "#FFFFFF", "#FFFFFF", "#0F3470", "Parlama efektli safir rozet"],
  [5, "Safir II", "safir", 80000000, ["#7FE6FF", "#2F9BEF", "#1748A8"], "#D6F8FF", "rgba(80,210,255,0.50)", "diamond-stone", 2, "#FFFFFF", "#FFFFFF", "#0D2C66", "Derin safir parıltısı"],
  [6, "Safir III", "safir", 150000000, ["#B4F6FF", "#3AB4F5", "#1D4FC4", "#112F80"], "#E9FDFF", "rgba(110,230,255,0.55)", "diamond-stone", 2, "#FFFFFF", "#FFFFFF", "#0A2459", "Kristal safir çerçeve"],
  [7, "Hükümdar I", "hukumdar", 300000000, ["#3C8CF0", "#1C5FB8", "#0F3478"], "#F6C86E", "rgba(246,200,110,0.40)", "crown", 3, "#FFFFFF", "#FFD978", "#0A2457", "Altın taç, nabız gibi atan ışık"],
  [8, "Hükümdar II", "hukumdar", 500000000, ["#4A97F5", "#1F5EC0", "#0C2C6E"], "#F8D07A", "rgba(248,208,122,0.45)", "crown", 3, "#FFFFFF", "#FFD978", "#09204F", "Çift altın çerçeve"],
  [9, "Hükümdar III", "hukumdar", 800000000, ["#5AA2FA", "#2160C9", "#0B2763", "#071A45"], "#FFD978", "rgba(255,217,120,0.50)", "crown", 4, "#FFFFFF", "#FFE29A", "#071C48", "Altın kanatlı amblem"],
  [10, "Hükümdar IV", "hukumdar", 1200000000, ["#2F80ED", "#1A4FB0", "#0A1F55"], "#FFD978", "rgba(255,217,120,0.55)", "crown", 5, "#FFFFFF", "#FFE29A", "#061740", "Dönen kraliyet aurası"],
  [11, "Hükümdar V", "hukumdar", 2000000000, ["#3B7CF0", "#1C3FA0", "#0A1747", "#060F30"], "#FFE29A", "rgba(255,226,154,0.60)", "crown", 5, "#FFFFFF", "#FFF1C1", "#050F2E", "Yörüngede altın kıvılcımlar"],
  [12, "Efsane I", "efsane", 3500000000, ["#3A2466", "#1D1438", "#101820"], "#FFD978", "rgba(160,110,255,0.50)", "shield-crown", 6, "#FFE7A8", "#FFD978", "#0B0F18", "Siyah-altın efsane kalkanı"],
  [13, "Efsane II", "efsane", 6000000000, ["#4B2A86", "#22164A", "#0E1220"], "#FFD978", "rgba(170,115,255,0.55)", "shield-crown", 6, "#FFE7A8", "#FFE29A", "#0A0D16", "Mor efsane aurası"],
  [14, "Efsane III", "efsane", 10000000000, ["#5B2FA6", "#2A1658", "#120E22", "#0A0C14"], "#FFE7A8", "rgba(190,130,255,0.60)", "crown-circle", 7, "#FFF0C2", "#FFE7A8", "#080A12", "Yükselen altın parçacıklar"],
  [15, "Efsane IV", "efsane", 20000000000, ["#7A3FE0", "#3A1A7A", "#140C2A", "#08080F"], "#FFF0C2", "rgba(255,215,120,0.65)", "crown-circle", 7, "#FFF0C2", "#FFF6D8", "#06060C", "Zirve: Sora efsanesi"],
];

export const WEALTH_TIERS = RAW_TIERS.map(
  ([level, short, family, minSpent, colors, accent, glow, icon, ornate, ink, iconColor, deep, perk]) => ({
    level,
    name: level === 0 ? "Çaylak" : `${short}`,
    short,
    family,
    familyTitle: FAMILY_META[family].title,
    motto: FAMILY_META[family].motto,
    minSpent,
    colors,
    accent,
    glow,
    icon,
    ornate,
    ink,
    iconColor,
    deep,
    perk,
  }),
);

export const WEALTH_MAX_LEVEL = WEALTH_TIERS[WEALTH_TIERS.length - 1].level;

const clampLevel = (level) => {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(WEALTH_MAX_LEVEL, n));
};

export function getWealthTier(spent) {
  const value = Math.max(0, Number(spent) || 0);
  let index = 0;
  for (let i = WEALTH_TIERS.length - 1; i >= 0; i -= 1) {
    if (value >= WEALTH_TIERS[i].minSpent) {
      index = i;
      break;
    }
  }
  const tier = WEALTH_TIERS[index];
  const next = WEALTH_TIERS[index + 1] || null;
  if (!next) {
    return { tier, next: null, progress: 1, remaining: 0 };
  }
  const span = next.minSpent - tier.minSpent;
  const progress = span > 0 ? Math.max(0, Math.min(1, (value - tier.minSpent) / span)) : 1;
  return { tier, next, progress, remaining: Math.max(0, next.minSpent - value) };
}

const resolveTier = (spent, level) =>
  level !== undefined && level !== null && level !== ""
    ? WEALTH_TIERS[clampLevel(level)]
    : getWealthTier(spent).tier;

/* -------------------------------------------------------------------------- */
/*                                  Formatting                                */
/* -------------------------------------------------------------------------- */

let trFormatter = null;
try {
  trFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
} catch (error) {
  trFormatter = null;
}

const groupThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const formatCredits = (value) => {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (trFormatter) {
    try {
      return trFormatter.format(n);
    } catch (error) {
      // fall through
    }
  }
  return groupThousands(n);
};

const trimDecimal = (n) => {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
};

export const formatCreditsCompact = (value) => {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1e9) return `${trimDecimal(n / 1e9)} Milyar`;
  if (n >= 1e6) return `${trimDecimal(n / 1e6)} Milyon`;
  if (n >= 1e3) return `${trimDecimal(n / 1e3)} Bin`;
  return formatCredits(n);
};

/* -------------------------------------------------------------------------- */
/*                          Shared ref-counted clocks                         */
/* -------------------------------------------------------------------------- */

const createSharedClock = (duration) => {
  const value = new Animated.Value(0);
  let refs = 0;
  let loop = null;
  return {
    value,
    acquire() {
      refs += 1;
      if (refs === 1) {
        value.setValue(0);
        loop = Animated.loop(
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        );
        loop.start();
      }
    },
    release() {
      refs = Math.max(0, refs - 1);
      if (refs === 0 && loop) {
        loop.stop();
        loop = null;
      }
    },
  };
};

// Hizli saat: parlama süpürmesi, nabiz, parcaciklar. Yavas saat: donen aura.
const FAST_CLOCK = createSharedClock(2600);
const SLOW_CLOCK = createSharedClock(9000);

function useSharedClock(clock, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    clock.acquire();
    return () => clock.release();
  }, [clock, enabled]);
}

// frac(t + phase) olarak calisan testere disi sinyal (0..1).
const sawtooth = (value, phase) => {
  const p = ((phase % 1) + 1) % 1;
  if (p === 0) return value;
  const cut = 1 - p;
  return value.interpolate({
    inputRange: [0, cut, cut + 0.0001, 1],
    outputRange: [p, 1, 0, p],
    extrapolate: "clamp",
  });
};

const SHINE_COLORS = ["rgba(255,255,255,0)", "rgba(255,255,255,0.65)", "rgba(255,255,255,0)"];
const SQRT3 = Math.sqrt(3);

/* -------------------------------------------------------------------------- */
/*                                  Hexagon                                   */
/* -------------------------------------------------------------------------- */

const Hexagon = memo(function Hexagon({ size, color, left, top, rotate = "0deg" }) {
  const r = size / 2;
  const w = SQRT3 * r;
  const h = r;
  const rect = { width: w, height: h, left: (size - w) / 2, top: (size - h) / 2, backgroundColor: color };
  return (
    <View
      pointerEvents="none"
      style={[styles.hexBox, { width: size, height: size, left, top, transform: [{ rotate }] }]}
    >
      <View style={[styles.hexRect, rect]} />
      <View style={[styles.hexRect, rect, styles.rot60]} />
      <View style={[styles.hexRect, rect, styles.rotNeg60]} />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*                               SoraWealthBadge                              */
/* -------------------------------------------------------------------------- */

const BADGE_SIZES = {
  sm: { h: 18, icon: 10, font: 10.5, nameFont: 9.5, pad: 6, med: 14, gap: 3 },
  md: { h: 22, icon: 12, font: 12, nameFont: 11, pad: 7, med: 18, gap: 4 },
  lg: { h: 28, icon: 16, font: 14.5, nameFont: 13, pad: 9, med: 23, gap: 5 },
};

function SoraWealthBadgeBase({
  spent = 0,
  level,
  size = "sm",
  showName = false,
  showZero = false,
  animated = true,
  style,
}) {
  const tier = resolveTier(spent, level);
  const reducedMotion = useReducedMotion();
  const dims = BADGE_SIZES[size] || BADGE_SIZES.sm;
  const lvl = tier.level;
  const canAnimate = animated && !reducedMotion && lvl >= 4;
  const hasPulse = lvl >= 7;
  const hasAura = lvl >= 10;
  const isLegend = lvl >= 12;
  const isRoyal = lvl >= 7;

  useSharedClock(FAST_CLOCK, canAnimate);
  useSharedClock(SLOW_CLOCK, canAnimate && hasAura);

  const label = String(lvl);
  const estWidth =
    2 +
    dims.med +
    dims.gap +
    label.length * dims.font * 0.64 +
    (showName ? dims.gap + 5 + tier.short.length * dims.nameFont * 0.58 : 0) +
    dims.pad;
  const shineW = dims.h * 0.9;

  const anim = useMemo(() => {
    if (!canAnimate) return null;
    const fast = FAST_CLOCK.value;
    const slow = SLOW_CLOCK.value;
    return {
      shineX: fast.interpolate({
        inputRange: [0, 0.45, 1],
        outputRange: [-shineW * 1.6, estWidth + shineW, estWidth + shineW],
      }),
      haloOpacity: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.25, 0.9, 0.25] }),
      haloScale: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] }),
      auraRotate: slow.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
      sparkOpacity: fast.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0.2, 1, 0.35, 0.2] }),
      sparkScale: fast.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0.6, 1.15, 0.75, 0.6] }),
    };
  }, [canAnimate, estWidth, shineW]);

  if (lvl === 0 && !showZero) return null;

  const radius = dims.h / 2;
  const borderColor = isRoyal ? withAlpha(BRAND.goldLight, 0.95) : withAlpha(tier.accent, lvl === 0 ? 0.35 : 0.8);
  const medBg = lvl >= 4 ? withAlpha(tier.deep, 0.75) : lvl === 0 ? "rgba(0,0,0,0.25)" : withAlpha(tier.deep, 0.9);
  const iconColor = lvl === 0 ? tier.iconColor : isRoyal ? tier.iconColor : "#FFFFFF";
  const auraSize = dims.h - 1;

  return (
    <View
      style={[styles.badgeWrap, { height: dims.h }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Cömertlik seviyesi ${lvl}, ${tier.short}`}
    >
      {lvl > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.badgeHalo,
            {
              borderRadius: radius + 3,
              backgroundColor: tier.glow,
              opacity: anim && hasPulse ? anim.haloOpacity : lvl >= 4 ? 0.7 : 0.5,
              transform: anim && hasPulse ? [{ scale: anim.haloScale }] : undefined,
            },
          ]}
        />
      ) : null}

      <LinearGradient
        colors={tier.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.badgePill,
          {
            height: dims.h,
            borderRadius: radius,
            borderColor,
            paddingRight: dims.pad,
          },
        ]}
      >
        <View pointerEvents="none" style={[styles.badgeGloss, { height: dims.h * 0.48 }]} />

        {anim ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.badgeShine,
              {
                width: shineW,
                height: dims.h * 2,
                top: -dims.h / 2,
                transform: [{ translateX: anim.shineX }, { rotate: "20deg" }],
              },
            ]}
          >
            <LinearGradient
              colors={SHINE_COLORS}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}

        <View
          style={[
            styles.badgeMedal,
            {
              width: dims.med,
              height: dims.med,
              borderRadius: dims.med / 2,
              backgroundColor: medBg,
              borderColor: withAlpha(isRoyal ? BRAND.goldLight : tier.accent, 0.7),
              marginRight: dims.gap,
            },
          ]}
        >
          {hasAura ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.badgeAura,
                {
                  width: auraSize,
                  height: auraSize,
                  borderRadius: auraSize / 2,
                  borderTopColor: tier.accent,
                  borderBottomColor: withAlpha(tier.accent, 0.55),
                  transform: anim ? [{ rotate: anim.auraRotate }] : [{ rotate: "35deg" }],
                },
              ]}
            />
          ) : null}
          <MaterialCommunityIcons name={tier.icon} size={dims.icon} color={iconColor} style={styles.iconShadow} />
        </View>

        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.badgeLevel,
            {
              fontSize: dims.font,
              lineHeight: dims.h - 2,
              color: lvl >= 1 && lvl <= 3 ? tier.ink : isLegend ? tier.ink : "#FFFFFF",
            },
            lvl >= 1 && lvl <= 3 ? styles.badgeTextLight : styles.badgeTextDark,
          ]}
        >
          {label}
        </Text>

        {showName ? (
          <>
            <View
              style={[
                styles.badgeDivider,
                {
                  height: dims.h * 0.5,
                  marginHorizontal: dims.gap,
                  backgroundColor: lvl >= 1 && lvl <= 3 ? withAlpha(tier.ink, 0.35) : "rgba(255,255,255,0.4)",
                },
              ]}
            />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={[
                styles.badgeName,
                {
                  fontSize: dims.nameFont,
                  lineHeight: dims.h - 2,
                  color: lvl >= 1 && lvl <= 3 ? tier.ink : isRoyal ? tier.ink === "#FFFFFF" ? BRAND.goldLight : tier.ink : "#FFFFFF",
                },
                lvl >= 1 && lvl <= 3 ? styles.badgeTextLight : styles.badgeTextDark,
              ]}
            >
              {tier.short}
            </Text>
          </>
        ) : null}
      </LinearGradient>

      {isLegend ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.badgeSpark,
            {
              top: -dims.h * 0.28,
              right: -dims.h * 0.18,
              opacity: anim ? anim.sparkOpacity : 0.9,
              transform: anim ? [{ scale: anim.sparkScale }] : undefined,
            },
          ]}
        >
          <MaterialCommunityIcons name="star-four-points" size={Math.round(dims.h * 0.5)} color={BRAND.goldLight} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export const SoraWealthBadge = memo(SoraWealthBadgeBase);

/* -------------------------------------------------------------------------- */
/*                              SoraWealthEmblem                              */
/* -------------------------------------------------------------------------- */

function EmblemWing({ side, size, wingW, wingH, left, top, feathers, colors, flap }) {
  const isLeft = side === "left";
  const items = [];
  for (let i = 0; i < feathers; i += 1) {
    const length = wingW * (1 - i * 0.15);
    const thick = Math.max(2, size * 0.072 * (1 - i * 0.1));
    const angle = 34 - i * 17;
    items.push(
      <LinearGradient
        key={`f${i}`}
        colors={isLeft ? colors : [...colors].reverse()}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[
          styles.feather,
          {
            width: length,
            height: thick,
            borderRadius: thick / 2,
            top: wingH * 0.18 + i * thick * 1.0,
            transformOrigin: isLeft ? "right center" : "left center",
            transform: [{ rotate: `${isLeft ? angle : -angle}deg` }],
          },
          isLeft ? styles.featherLeft : styles.featherRight,
        ]}
      />,
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wingGroup,
        {
          width: wingW,
          height: wingH,
          left,
          top,
          transformOrigin: isLeft ? "right center" : "left center",
          transform: flap ? [{ rotate: flap }] : undefined,
        },
      ]}
    >
      {items}
    </Animated.View>
  );
}

function SoraWealthEmblemBase({ spent = 0, level, size = 72, animated = true }) {
  const tier = resolveTier(spent, level);
  const reducedMotion = useReducedMotion();
  const S = Math.max(24, Number(size) || 72);
  const lvl = tier.level;
  const ornate = tier.ornate;
  const fam = tier.family;
  const hasWings = ornate >= 4;
  const hasAura = ornate >= 5;
  const hasParticles = ornate >= 6;
  const canAnimate = animated && !reducedMotion && lvl >= 4;

  useSharedClock(FAST_CLOCK, canAnimate);
  useSharedClock(SLOW_CLOCK, canAnimate && hasAura);

  const core = hasWings ? S * 0.64 : S * 0.84;
  const coreLeft = (S - core) / 2;
  const coreTop = (S - core) / 2 - S * 0.03;
  const isHex = fam === "safir" || fam === "hukumdar" || fam === "efsane";
  const disc = isHex ? core * 0.62 : core * 0.78;
  const discLeft = (S - disc) / 2;
  const discTop = coreTop + (core - disc) / 2;
  const b = Math.max(1, core * 0.05);
  const particleCount = ornate >= 7 ? 6 : 4;

  const anim = useMemo(() => {
    if (!canAnimate) return null;
    const fast = FAST_CLOCK.value;
    const slow = SLOW_CLOCK.value;
    const particles = [];
    for (let i = 0; i < particleCount; i += 1) {
      const saw = sawtooth(fast, i / particleCount);
      particles.push({
        translateY: saw.interpolate({ inputRange: [0, 1], outputRange: [0, -S * 0.5] }),
        opacity: saw.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 1, 0.75, 0] }),
        scale: saw.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1, 0.55] }),
      });
    }
    return {
      shineX: fast.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [-disc * 0.7, disc * 1.25, disc * 1.25],
      }),
      haloOpacity: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 1, 0.45] }),
      haloScale: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.94, 1.06, 0.94] }),
      flapLeft: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "7deg", "0deg"] }),
      flapRight: fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "-7deg", "0deg"] }),
      auraRotate: slow.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
      ringRotate: slow.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] }),
      orbitRotate: slow.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] }),
      particles,
    };
  }, [canAnimate, S, disc, particleCount]);

  const pulse = anim && ornate >= 3;

  /* ---- plate layers ---- */
  const plateLayers = [];
  if (fam === "safir") {
    plateLayers.push({ s: core, c: tier.accent });
    plateLayers.push({ s: core - 2 * b, c: tier.deep });
  } else if (fam === "hukumdar") {
    plateLayers.push({ s: core, c: GOLD_GRADIENT[2] });
    plateLayers.push({ s: core - 1.6 * b, c: tier.deep });
    plateLayers.push({ s: core - 2.6 * b, c: GOLD_GRADIENT[1] });
    plateLayers.push({ s: core - 3.4 * b, c: tier.deep });
  } else if (fam === "efsane") {
    plateLayers.push({ s: core, c: GOLD_GRADIENT[1] });
    plateLayers.push({ s: core - 1.6 * b, c: "#2A1650" });
    plateLayers.push({ s: core - 2.8 * b, c: GOLD_GRADIENT[2] });
    plateLayers.push({ s: core - 3.6 * b, c: tier.deep });
  }
  const hexRotate = fam === "efsane" ? "30deg" : "0deg";

  /* ---- wings ---- */
  const wingW = S * 0.34;
  const wingH = S * 0.46;
  const wingTop = coreTop + core * 0.5 - wingH * 0.55;
  const wingLeftX = coreLeft - wingW + core * 0.14;
  const wingRightX = S - wingLeftX - wingW;
  const wingColors = fam === "efsane" ? VIOLET_WING : GOLD_WING;
  const feathers = ornate >= 5 ? 4 : 3;

  /* ---- level plate ---- */
  const plateH = Math.max(10, S * 0.2);
  const plateTop = coreTop + core - plateH * 0.6;
  const plateColors = lvl >= 7 ? GOLD_GRADIENT : lvl === 0 ? ["#46566B", "#2A384A"] : [tier.colors[1], tier.deep];
  const plateText = lvl >= 7 ? "#3A2405" : "#FFFFFF";

  /* ---- orbit sparks ---- */
  const orbitR = S * 0.47;
  const sparkSize = Math.max(3, S * 0.06);

  return (
    <View
      style={[styles.emblem, { width: S, height: S }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Cömertlik amblemi, seviye ${lvl}, ${tier.short}`}
    >
      {/* glow halo */}
      {lvl > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.abs,
            {
              left: 0,
              top: 0,
              width: S,
              height: S,
              opacity: pulse ? anim.haloOpacity : 0.75,
              transform: pulse ? [{ scale: anim.haloScale }] : undefined,
            },
          ]}
        >
          <View
            style={[
              styles.abs,
              {
                width: S * 0.98,
                height: S * 0.98,
                left: S * 0.01,
                top: S * 0.01 - S * 0.03,
                borderRadius: S,
                backgroundColor: tier.glow,
                opacity: 0.45,
              },
            ]}
          />
          <View
            style={[
              styles.abs,
              {
                width: core * 1.08,
                height: core * 1.08,
                left: (S - core * 1.08) / 2,
                top: coreTop - core * 0.04,
                borderRadius: S,
                backgroundColor: tier.glow,
              },
            ]}
          />
        </Animated.View>
      ) : null}

      {/* rotating aura rays + counter ring */}
      {hasAura ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.abs,
              {
                left: 0,
                top: -S * 0.03,
                width: S,
                height: S,
                transform: [{ rotate: anim ? anim.auraRotate : "15deg" }],
              },
            ]}
          >
            {[0, 45, 90, 135].map((deg) => {
              const rayH = Math.max(1.5, S * 0.035);
              return (
                <LinearGradient
                  key={`ray${deg}`}
                  colors={[withAlpha(tier.accent, 0), withAlpha(tier.accent, 0.8), withAlpha(tier.accent, 0)]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[
                    styles.abs,
                    {
                      width: S,
                      height: rayH,
                      left: 0,
                      top: S / 2 - rayH / 2,
                      borderRadius: rayH,
                      transform: [{ rotate: `${deg}deg` }],
                    },
                  ]}
                />
              );
            })}
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.auraRing,
              {
                width: S * 0.96,
                height: S * 0.96,
                left: S * 0.02,
                top: S * 0.02 - S * 0.03,
                borderRadius: S,
                borderWidth: Math.max(1, S * 0.018),
                borderTopColor: tier.accent,
                borderBottomColor: withAlpha(tier.accent, 0.5),
                transform: [{ rotate: anim ? anim.ringRotate : "-20deg" }],
              },
            ]}
          />
        </>
      ) : null}

      {/* wings */}
      {hasWings ? (
        <>
          <EmblemWing
            side="left"
            size={S}
            wingW={wingW}
            wingH={wingH}
            left={wingLeftX}
            top={wingTop}
            feathers={feathers}
            colors={wingColors}
            flap={anim ? anim.flapLeft : null}
          />
          <EmblemWing
            side="right"
            size={S}
            wingW={wingW}
            wingH={wingH}
            left={wingRightX}
            top={wingTop}
            feathers={feathers}
            colors={wingColors}
            flap={anim ? anim.flapRight : null}
          />
        </>
      ) : null}

      {/* plate */}
      {isHex ? (
        plateLayers.map((layer, i) => (
          <Hexagon
            key={`hex${i}`}
            size={layer.s}
            color={layer.c}
            left={(S - layer.s) / 2}
            top={coreTop + (core - layer.s) / 2}
            rotate={hexRotate}
          />
        ))
      ) : (
        <LinearGradient
          colors={lvl === 0 ? ["#5A6B80", "#2A384A"] : ["#FFFFFF", tier.accent, tier.colors[2], tier.deep]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[
            styles.abs,
            { width: core, height: core, left: coreLeft, top: coreTop, borderRadius: core / 2 },
          ]}
        />
      )}

      {/* disc */}
      <LinearGradient
        colors={tier.colors}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[
          styles.disc,
          {
            width: disc,
            height: disc,
            left: discLeft,
            top: discTop,
            borderRadius: disc / 2,
            borderWidth: Math.max(1, disc * 0.045),
            borderColor: lvl >= 7 ? withAlpha(BRAND.goldLight, 0.95) : withAlpha(tier.accent, lvl === 0 ? 0.4 : 0.85),
          },
        ]}
      >
        <View pointerEvents="none" style={[styles.discGloss, { height: disc * 0.48 }]} />
        {anim ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.discShine,
              {
                width: disc * 0.34,
                height: disc * 1.6,
                top: -disc * 0.3,
                transform: [{ translateX: anim.shineX }, { rotate: "20deg" }],
              },
            ]}
          >
            <LinearGradient
              colors={SHINE_COLORS}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
        <MaterialCommunityIcons
          name={tier.icon}
          size={Math.round(disc * 0.58)}
          color={tier.iconColor}
          style={lvl >= 1 && lvl <= 3 ? styles.iconShadowStrong : styles.iconShadow}
        />
      </LinearGradient>

      {/* orbiting sparks */}
      {hasAura ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.abs,
            {
              left: 0,
              top: -S * 0.03,
              width: S,
              height: S,
              transform: [{ rotate: anim ? anim.orbitRotate : "0deg" }],
            },
          ]}
        >
          {[0, 120, 240].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const cx = S / 2 + orbitR * Math.cos(rad);
            const cy = S / 2 + orbitR * Math.sin(rad);
            const halo = sparkSize * 2.4;
            return (
              <View key={`orb${deg}`} style={[styles.abs, { left: cx - halo / 2, top: cy - halo / 2, width: halo, height: halo }]}>
                <View style={[styles.sparkHalo, { borderRadius: halo / 2, backgroundColor: tier.glow }]} />
                <View
                  style={[
                    styles.abs,
                    {
                      width: sparkSize,
                      height: sparkSize,
                      left: (halo - sparkSize) / 2,
                      top: (halo - sparkSize) / 2,
                      borderRadius: sparkSize / 2,
                      backgroundColor: fam === "efsane" ? BRAND.goldLight : "#FFF6D8",
                    },
                  ]}
                />
              </View>
            );
          })}
        </Animated.View>
      ) : null}

      {/* rising legend particles */}
      {hasParticles
        ? Array.from({ length: particleCount }).map((_, i) => {
            const px = S * (0.18 + (0.64 * i) / Math.max(1, particleCount - 1));
            const iconSize = Math.max(5, Math.round(S * (i % 2 === 0 ? 0.1 : 0.075)));
            const p = anim ? anim.particles[i] : null;
            return (
              <Animated.View
                key={`pt${i}`}
                pointerEvents="none"
                style={[
                  styles.abs,
                  {
                    left: px - iconSize / 2,
                    top: S * 0.56,
                    opacity: p ? p.opacity : 0.65,
                    transform: p
                      ? [{ translateY: p.translateY }, { scale: p.scale }]
                      : [{ translateY: -S * (0.12 + 0.1 * (i % 3)) }],
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="star-four-points"
                  size={iconSize}
                  color={i % 2 === 0 ? BRAND.goldLight : "#D9C2FF"}
                />
              </Animated.View>
            );
          })
        : null}

      {/* level plate */}
      <View pointerEvents="none" style={[styles.levelPlateRow, { top: plateTop, height: plateH }]}>
        <LinearGradient
          colors={plateColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[
            styles.levelPlate,
            {
              height: plateH,
              minWidth: S * 0.34,
              borderRadius: plateH / 2,
              paddingHorizontal: plateH * 0.45,
              borderColor: lvl >= 7 ? "#FFF6D8" : withAlpha(tier.accent, lvl === 0 ? 0.4 : 0.9),
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[
              styles.levelPlateText,
              { fontSize: Math.max(7, plateH * 0.66), lineHeight: plateH - 1, color: plateText },
              lvl >= 7 ? null : styles.badgeTextDark,
            ]}
          >
            {lvl}
          </Text>
        </LinearGradient>
      </View>
    </View>
  );
}

export const SoraWealthEmblem = memo(SoraWealthEmblemBase);

/* -------------------------------------------------------------------------- */
/*                               SoraWealthCard                               */
/* -------------------------------------------------------------------------- */

function SoraWealthCardBase({ spent = 0, title = "Cömertlik Seviyesi", onPress, compact = false }) {
  const info = useMemo(() => getWealthTier(spent), [spent]);
  const { tier, next, progress, remaining } = info;
  const reducedMotion = useReducedMotion();
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [trackW, setTrackW] = useState(0);
  const lvl = tier.level;
  const isRoyal = lvl >= 7;
  const canShimmer = !reducedMotion && lvl >= 4;

  useSharedClock(FAST_CLOCK, canShimmer);

  useEffect(() => {
    if (reducedMotion) {
      progressAnim.setValue(progress);
      return undefined;
    }
    const a = Animated.timing(progressAnim, {
      toValue: progress,
      duration: 950,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [progress, reducedMotion, progressAnim]);

  const onTrackLayout = useCallback((e) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setTrackW((prev) => (prev === w ? prev : w));
  }, []);

  const fillX = useMemo(
    () => progressAnim.interpolate({ inputRange: [0, 1], outputRange: [-Math.max(1, trackW), 0] }),
    [progressAnim, trackW],
  );
  const shimmerX = useMemo(
    () =>
      canShimmer
        ? FAST_CLOCK.value.interpolate({
            inputRange: [0, 0.6, 1],
            outputRange: [-60, Math.max(60, trackW) + 20, Math.max(60, trackW) + 20],
          })
        : null,
    [canShimmer, trackW],
  );

  const ladderStart = Math.max(1, Math.min(lvl + 1, WEALTH_TIERS.length - 3));
  const upcoming = WEALTH_TIERS.slice(ladderStart, ladderStart + 3);

  const emblemSize = compact ? 58 : 80;
  const fillColors = isRoyal ? ["#FFF1C1", BRAND.goldLight, BRAND.gold] : lvl >= 4 ? ["#7FE6FF", BRAND.blueLight] : ["#CFE0F5", BRAND.blueLight];
  const nameColor = isRoyal ? BRAND.goldLight : lvl === 0 ? "#DCE4EE" : "#FFFFFF";

  const body = (
    <LinearGradient
      colors={[BRAND.inkSoft, "#14243A", BRAND.ink]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        { borderColor: isRoyal ? withAlpha(BRAND.gold, 0.45) : "rgba(255,255,255,0.08)" },
      ]}
    >
      <View pointerEvents="none" style={[styles.cardGlowBig, { backgroundColor: tier.glow }]} />
      <View pointerEvents="none" style={[styles.cardGlowSmall, { backgroundColor: tier.glow }]} />
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(tier.accent, 0), withAlpha(isRoyal ? BRAND.goldLight : tier.accent, 0.7), withAlpha(tier.accent, 0)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.cardTopLine}
      />

      <View style={styles.cardRow}>
        <SoraWealthEmblem spent={spent} size={emblemSize} />
        <View style={styles.cardInfo}>
          <View style={styles.cardTitleRow}>
            <MaterialCommunityIcons name="gift" size={12} color={isRoyal ? BRAND.gold : "#8FB8F0"} />
            <Text allowFontScaling={false} numberOfLines={1} style={styles.cardTitle}>
              {title.toLocaleUpperCase("tr-TR")}
            </Text>
          </View>
          <View style={styles.cardNameRow}>
            <Text numberOfLines={1} style={[styles.cardName, compact ? styles.cardNameCompact : null, { color: nameColor }]}>
              {tier.short}
            </Text>
            {lvl > 0 ? <SoraWealthBadge level={lvl} size="sm" style={styles.cardBadge} /> : null}
          </View>
          <Text numberOfLines={1} style={styles.cardMotto}>
            {lvl === 0 ? "Hediye gönderdikçe yükselirsin" : `${tier.motto} · ${formatCredits(spent)} kredi`}
          </Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" /> : null}
      </View>

      <View style={styles.progressBlock}>
        <View style={styles.progressLabels}>
          <Text allowFontScaling={false} style={styles.progressLabel}>
            {`Sv. ${lvl}`}
          </Text>
          <Text allowFontScaling={false} style={[styles.progressLabel, next ? null : { color: BRAND.goldLight }]}>
            {next ? `%${Math.floor(progress * 100)}` : "MAKS"}
          </Text>
        </View>
        <View style={styles.progressTrack} onLayout={onTrackLayout}>
          <Animated.View
            style={[styles.progressFill, { width: Math.max(1, trackW), transform: [{ translateX: fillX }] }]}
          >
            <LinearGradient colors={fillColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <View style={styles.progressCap} />
          </Animated.View>
          {shimmerX ? (
            <Animated.View pointerEvents="none" style={[styles.progressShimmer, { transform: [{ translateX: shimmerX }] }]}>
              <LinearGradient colors={SHINE_COLORS} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          ) : null}
        </View>
        {next ? (
          <Text numberOfLines={2} style={styles.progressText}>
            {"Sonraki: "}
            <Text style={styles.progressTextStrong}>{next.short}</Text>
            {` · ${formatCredits(remaining)} kredi kaldı`}
          </Text>
        ) : (
          <View style={styles.peakRow}>
            <MaterialCommunityIcons name="crown" size={14} color={BRAND.goldLight} />
            <Text style={styles.peakText}>Zirve seviyesine ulaştın</Text>
          </View>
        )}
      </View>

      {!compact && upcoming.length ? (
        <View style={styles.upcomingBlock}>
          <Text allowFontScaling={false} style={styles.upcomingTitle}>
            SIRADAKİ SEVİYELER
          </Text>
          <View style={styles.upcomingRow}>
            {upcoming.map((t) => {
              const unlocked = lvl >= t.level;
              return (
                <View key={`up${t.level}`} style={[styles.upcomingItem, unlocked ? null : styles.dimmed]}>
                  <View>
                    <SoraWealthEmblem level={t.level} size={42} animated={false} />
                    {!unlocked ? (
                      <View style={styles.lockDot}>
                        <Ionicons name="lock-closed" size={8} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.upcomingName}>
                    {t.short}
                  </Text>
                  <Text numberOfLines={1} style={styles.upcomingMin}>
                    {formatCreditsCompact(t.minSpent)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </LinearGradient>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${tier.short}`}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}

export const SoraWealthCard = memo(SoraWealthCardBase);

/* -------------------------------------------------------------------------- */
/*                           WealthTierLadderSheet                            */
/* -------------------------------------------------------------------------- */

const ROW_H = 70;
const ROW_GAP = 8;
const GROUP_H = 30;

function WealthTierLadderSheetBase({ visible, spent = 0, onDismiss }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const info = useMemo(() => getWealthTier(spent), [spent]);
  const { tier, next, remaining } = info;
  const lvl = tier.level;
  const slide = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    if (reducedMotion) {
      slide.setValue(1);
      return undefined;
    }
    slide.setValue(0);
    const a = Animated.spring(slide, {
      toValue: 1,
      damping: 18,
      stiffness: 190,
      mass: 0.9,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [visible, reducedMotion, slide]);

  // Satir konumlari (grup basliklari dahil) — mevcut seviyeye otomatik kaydirma.
  const rows = useMemo(() => {
    const out = [];
    let y = 0;
    let lastFamily = null;
    WEALTH_TIERS.forEach((t) => {
      if (t.level === 0) return;
      if (t.family !== lastFamily) {
        out.push({ type: "group", key: `g-${t.family}`, family: t.family, y });
        y += GROUP_H;
        lastFamily = t.family;
      }
      out.push({ type: "tier", key: `t-${t.level}`, tier: t, y });
      y += ROW_H + ROW_GAP;
    });
    return out;
  }, []);

  const handleScrollLayout = useCallback(() => {
    const row = rows.find((r) => r.type === "tier" && r.tier.level === lvl);
    if (row && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, row.y - ROW_H - GROUP_H), animated: false });
    }
  }, [rows, lvl]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });

  return (
    <Modal visible={!!visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.sheetRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Kapat">
          <View style={styles.backdrop} />
        </Pressable>

        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: height * 0.86,
              paddingBottom: insets.bottom + 14,
              opacity: slide,
              transform: [{ translateY }],
            },
          ]}
        >
          <LinearGradient
            colors={[BRAND.inkSoft, "#132235", BRAND.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[styles.sheetGlow, { backgroundColor: tier.glow }]} />
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>Cömertlik Seviyeleri</Text>
              <Text style={styles.sheetSubtitle}>
                Hediye gönderdikçe yükselir. Gönderdiğin her kredi seviyene eklenir.
              </Text>
            </View>
            <Pressable onPress={onDismiss} hitSlop={10} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={18} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={[styles.sheetCurrent, { borderColor: lvl >= 7 ? withAlpha(BRAND.gold, 0.5) : "rgba(255,255,255,0.1)" }]}>
            <SoraWealthEmblem spent={spent} size={62} animated={!!visible} />
            <View style={styles.sheetCurrentInfo}>
              <Text style={styles.sheetCurrentLabel}>MEVCUT SEVİYEN</Text>
              <Text numberOfLines={1} style={[styles.sheetCurrentName, lvl >= 7 ? { color: BRAND.goldLight } : null]}>
                {tier.short}
              </Text>
              <Text numberOfLines={2} style={styles.sheetCurrentMeta}>
                {`${formatCredits(spent)} kredi gönderildi`}
                {next ? ` · ${next.short} için ${formatCredits(remaining)} kaldı` : " · Zirve seviyesine ulaştın"}
              </Text>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.sheetList}
            contentContainerStyle={styles.sheetListContent}
            showsVerticalScrollIndicator={false}
            onLayout={handleScrollLayout}
          >
            {rows.map((row) => {
              if (row.type === "group") {
                return (
                  <View key={row.key} style={styles.groupHeader}>
                    <View style={styles.groupLine} />
                    <Text style={styles.groupTitle}>{FAMILY_META[row.family].title.toLocaleUpperCase("tr-TR")}</Text>
                    <View style={styles.groupLine} />
                  </View>
                );
              }
              const t = row.tier;
              const unlocked = lvl >= t.level;
              const current = lvl === t.level;
              return (
                <View
                  key={row.key}
                  style={[
                    styles.ladderRow,
                    current ? styles.ladderRowCurrent : null,
                    current ? { borderColor: t.level >= 7 ? BRAND.gold : t.accent, backgroundColor: withAlpha(t.colors[1], 0.16) } : null,
                  ]}
                >
                  <View style={[styles.ladderEmblem, unlocked ? null : styles.dimmed]}>
                    <SoraWealthEmblem level={t.level} size={50} animated={current && !!visible} />
                  </View>
                  <View style={styles.ladderInfo}>
                    <View style={styles.ladderNameRow}>
                      <Text numberOfLines={1} style={[styles.ladderName, unlocked ? null : styles.ladderNameLocked]}>
                        {t.short}
                      </Text>
                      {current ? (
                        <View style={styles.currentTag}>
                          <Text style={styles.currentTagText}>MEVCUT</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.ladderPerk}>
                      {t.perk}
                    </Text>
                    <Text numberOfLines={1} style={styles.ladderMin}>
                      {`${formatCreditsCompact(t.minSpent)} kredi`}
                    </Text>
                  </View>
                  {unlocked ? (
                    <View style={[styles.statusChip, styles.statusOpen]}>
                      <Ionicons name="checkmark-circle" size={12} color="#7FE6FF" />
                      <Text style={[styles.statusText, styles.statusTextOpen]}>Açıldı</Text>
                    </View>
                  ) : (
                    <View style={[styles.statusChip, styles.statusLocked]}>
                      <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.6)" />
                      <Text style={[styles.statusText, styles.statusTextLocked]}>Kilitli</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export const WealthTierLadderSheet = memo(WealthTierLadderSheetBase);

/* -------------------------------------------------------------------------- */
/*                                   Styles                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  rot60: { transform: [{ rotate: "60deg" }] },
  rotNeg60: { transform: [{ rotate: "-60deg" }] },
  hexBox: { position: "absolute" },
  hexRect: { position: "absolute" },
  iconShadow: {
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  iconShadowStrong: {
    textShadowColor: "rgba(16,36,72,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  /* badge */
  badgeWrap: {
    alignSelf: "center",
    justifyContent: "center",
  },
  badgeHalo: {
    position: "absolute",
    top: -2,
    bottom: -2,
    left: -3,
    right: -3,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 2,
    borderWidth: 1,
    overflow: "hidden",
  },
  badgeGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  badgeShine: {
    position: "absolute",
    left: 0,
  },
  badgeMedal: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeAura: {
    position: "absolute",
    borderWidth: 1.2,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  badgeLevel: {
    fontWeight: "900",
    includeFontPadding: false,
    textAlignVertical: "center",
    letterSpacing: 0.2,
  },
  badgeName: {
    fontWeight: "800",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  badgeTextDark: {
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  badgeTextLight: {
    textShadowColor: "rgba(255,255,255,0.6)",
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1,
  },
  badgeDivider: {
    width: StyleSheet.hairlineWidth * 2,
  },
  badgeSpark: {
    position: "absolute",
  },

  /* emblem */
  emblem: {
    position: "relative",
  },
  auraRing: {
    position: "absolute",
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  wingGroup: {
    position: "absolute",
  },
  feather: {
    position: "absolute",
  },
  featherLeft: { right: 0 },
  featherRight: { left: 0 },
  disc: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  discGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  discShine: {
    position: "absolute",
    left: 0,
  },
  sparkHalo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  levelPlateRow: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  levelPlate: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  levelPlateText: {
    fontWeight: "900",
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
  },

  /* card */
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    overflow: "hidden",
  },
  cardCompact: {
    padding: 12,
    borderRadius: 18,
  },
  cardGlowBig: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    top: -90,
    right: -60,
    opacity: 0.55,
  },
  cardGlowSmall: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -70,
    left: -40,
    opacity: 0.35,
  },
  cardTopLine: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1.5,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: {
    marginLeft: 5,
    color: "rgba(255,255,255,0.6)",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  cardNameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  cardName: {
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  cardNameCompact: {
    fontSize: 18,
  },
  cardBadge: {
    marginLeft: 8,
  },
  cardMotto: {
    marginTop: 3,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "600",
  },
  progressBlock: {
    marginTop: 14,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "800",
  },
  progressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 5,
    overflow: "hidden",
  },
  progressCap: {
    position: "absolute",
    top: 1,
    bottom: 1,
    right: 1,
    width: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  progressShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 46,
  },
  progressText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.7)",
    fontSize: 12.5,
    fontWeight: "600",
  },
  progressTextStrong: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  peakRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  peakText: {
    marginLeft: 6,
    color: BRAND.goldLight,
    fontSize: 13,
    fontWeight: "900",
  },
  upcomingBlock: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  upcomingTitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  upcomingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  upcomingItem: {
    flex: 1,
    alignItems: "center",
  },
  dimmed: {
    opacity: 0.42,
  },
  lockDot: {
    position: "absolute",
    right: -2,
    bottom: 2,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,24,32,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  upcomingName: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 11.5,
    fontWeight: "800",
  },
  upcomingMin: {
    marginTop: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  /* sheet */
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(4,8,14,0.66)",
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sheetGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -150,
    alignSelf: "center",
    opacity: 0.6,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sheetHeaderText: {
    flex: 1,
    paddingRight: 10,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  sheetSubtitle: {
    marginTop: 4,
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  sheetCurrent: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  sheetCurrentInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  sheetCurrentLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  sheetCurrentName: {
    marginTop: 2,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  sheetCurrentMeta: {
    marginTop: 2,
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "600",
  },
  sheetList: {
    marginTop: 12,
    flexGrow: 0,
  },
  sheetListContent: {
    paddingBottom: 8,
  },
  groupHeader: {
    height: GROUP_H,
    flexDirection: "row",
    alignItems: "center",
  },
  groupLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  groupTitle: {
    marginHorizontal: 10,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  ladderRow: {
    height: ROW_H,
    marginBottom: ROW_GAP,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  ladderRowCurrent: {
    borderWidth: 1.5,
  },
  ladderEmblem: {
    width: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  ladderInfo: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
  },
  ladderNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  ladderName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    flexShrink: 1,
  },
  ladderNameLocked: {
    color: "rgba(255,255,255,0.7)",
  },
  currentTag: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: BRAND.gold,
  },
  currentTagText: {
    color: "#3A2405",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  ladderPerk: {
    marginTop: 2,
    color: "rgba(255,255,255,0.6)",
    fontSize: 11.5,
    fontWeight: "600",
  },
  ladderMin: {
    marginTop: 1,
    color: "#8FB8F0",
    fontSize: 11.5,
    fontWeight: "800",
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginLeft: 8,
  },
  statusOpen: {
    backgroundColor: "rgba(47,128,237,0.22)",
  },
  statusLocked: {
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  statusText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: "800",
  },
  statusTextOpen: {
    color: "#BFF1FF",
  },
  statusTextLocked: {
    color: "rgba(255,255,255,0.6)",
  },
});

export default SoraWealthBadge;
