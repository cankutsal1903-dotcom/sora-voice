import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "../theme/colors";
import { SoraMark } from "./SoraMark";

const BRAND_BLUE = COLORS.primary;
const BRAND_BLUE_LIGHT = COLORS.primaryLight;

/**
 * Azaltilmis hareket tercihi tek bir kez dinlenir ve tum bilesenlerle paylasilir.
 * Onceden her LivePulse / AudioBars / Reveal kendi AccessibilityInfo aboneligini
 * aciyordu; yuzlerce kart oldugunda bu ciddi bir yuk olusturuyordu.
 */
let reducedMotionValue = false;
let reducedMotionResolved = false;
let reducedMotionWatcher = null;
const reducedMotionListeners = new Set();

const publishReducedMotion = (enabled) => {
  reducedMotionValue = Boolean(enabled);
  reducedMotionResolved = true;
  reducedMotionListeners.forEach((listener) => listener(reducedMotionValue));
};

const ensureReducedMotionWatcher = () => {
  if (reducedMotionWatcher) return;
  reducedMotionWatcher =
    AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      publishReducedMotion,
    ) || null;
  AccessibilityInfo.isReduceMotionEnabled()
    .then(publishReducedMotion)
    .catch(() => undefined);
};

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(reducedMotionValue);

  useEffect(() => {
    ensureReducedMotionWatcher();
    reducedMotionListeners.add(setReducedMotion);
    if (reducedMotionResolved) setReducedMotion(reducedMotionValue);
    return () => {
      reducedMotionListeners.delete(setReducedMotion);
    };
  }, []);

  return reducedMotion;
}

/**
 * Tum animasyonlu bilesenler (LivePulse, AudioBars) tek bir Animated.Value
 * uzerinden calisir. Boylece ekranda 40 kart olsa da native thread'de yalnizca
 * tek bir dongu doner; her kart icin ayri loop baslatilmaz.
 */
const createSharedDriver = ({ duration, sequence, restValue }) => {
  const value = new Animated.Value(0);
  let refCount = 0;
  let animation = null;

  const build = () => {
    if (sequence) {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
    }
    return Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
  };

  return {
    value,
    start() {
      refCount += 1;
      if (refCount === 1 && !animation) {
        animation = build();
        animation.start();
      }
    },
    stop() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0 && animation) {
        animation.stop();
        animation = null;
        value.setValue(restValue);
      }
    },
  };
};

const pulseDriver = createSharedDriver({
  duration: 1350,
  sequence: false,
  restValue: 0.35,
});
const barsDriver = createSharedDriver({
  duration: 700,
  sequence: true,
  restValue: 0.45,
});

const useSharedDriver = (driver, reducedMotion) => {
  useEffect(() => {
    if (reducedMotion) {
      driver.value.setValue(driver === pulseDriver ? 0.35 : 0.45);
      return undefined;
    }
    driver.start();
    return () => driver.stop();
  }, [driver, reducedMotion]);

  return driver.value;
};

export const Reveal = memo(function Reveal({
  children,
  delay = 0,
  distance = 18,
  style,
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const translateY = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    [distance, progress],
  );
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reducedMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
});

export const LivePulse = memo(function LivePulse({
  color = "#6AA8F5",
  size = 8,
}) {
  const pulse = useSharedDriver(pulseDriver, useReducedMotion());
  const opacity = useRef(
    pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
  ).current;
  const scale = useRef(
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }),
  ).current;
  const shellStyle = useMemo(
    () => ({ width: size * 2.3, height: size * 2.3 }),
    [size],
  );
  const dotStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
    }),
    [color, size],
  );

  return (
    <View
      style={[motionStyles.pulseShell, shellStyle]}
      accessibilityElementsHidden
    >
      <Animated.View
        style={[
          motionStyles.pulseRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity,
            transform: [{ scale }],
          },
        ]}
      />
      <View style={dotStyle} />
    </View>
  );
});

const AUDIO_HEIGHTS = [18, 34, 25, 42, 21];
const AUDIO_HEIGHTS_COMPACT = [12, 20, 15, 23];

export const AudioBars = memo(function AudioBars({
  color = BRAND_BLUE,
  compact = false,
}) {
  const progress = useSharedDriver(barsDriver, useReducedMotion());
  const heights = compact ? AUDIO_HEIGHTS_COMPACT : AUDIO_HEIGHTS;
  const scales = useMemo(
    () =>
      heights.map((_, index) =>
        progress.interpolate({
          inputRange: [0, 1],
          outputRange: index % 2 ? [0.48, 1] : [1, 0.55],
        }),
      ),
    [heights, progress],
  );

  return (
    <View
      style={[motionStyles.audioBars, compact && motionStyles.audioBarsCompact]}
      accessibilityElementsHidden
    >
      {heights.map((height, index) => (
        <Animated.View
          key={`${height}-${index}`}
          style={[
            motionStyles.audioBar,
            {
              height,
              backgroundColor: color,
              transform: [{ scaleY: scales[index] }],
            },
          ]}
        />
      ))}
    </View>
  );
});

// Yumusak parilti: ust uste konmus, giderek acilan halkalar (sert kenarli disk yok).
const SOFT_GLOW_BOX = 280;
const GLOW_LAYERS = [
  { size: 260, color: "rgba(47,128,237,0.05)" },
  { size: 210, color: "rgba(47,128,237,0.07)" },
  { size: 160, color: "rgba(78,150,255,0.10)" },
  { size: 110, color: "rgba(120,177,255,0.12)" },
];

export const BrandLaunch = memo(function BrandLaunch({
  waiting = false,
  closing = false,
}) {
  const intro = useRef(new Animated.Value(0)).current;
  const textIntro = useRef(new Animated.Value(0)).current;
  const outro = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  const introScale = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
  ).current;
  const introTranslate = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
  ).current;
  const textTranslate = useRef(
    textIntro.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
  ).current;
  const glowScale = useRef(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.08] }),
  ).current;
  const glowOpacity = useRef(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] }),
  ).current;
  const outroScale = useRef(
    outro.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1] }),
  ).current;
  const shimmerTranslate = useRef(
    shimmer.interpolate({ inputRange: [0, 1], outputRange: [-56, 152] }),
  ).current;

  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      intro.setValue(1);
      textIntro.setValue(1);
      breathe.setValue(0.5);
      shimmer.setValue(0.45);
      return undefined;
    }
    const entrance = Animated.parallel([
      Animated.spring(intro, {
        toValue: 1,
        damping: 18,
        stiffness: 110,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(textIntro, {
        toValue: 1,
        duration: 520,
        delay: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const sweep = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1350,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    entrance.start();
    breathing.start();
    sweep.start();
    return () => {
      entrance.stop();
      breathing.stop();
      sweep.stop();
    };
  }, [breathe, intro, reducedMotion, shimmer, textIntro]);

  useEffect(() => {
    if (!closing) return undefined;
    if (reducedMotion) {
      outro.setValue(0);
      return undefined;
    }
    const exit = Animated.timing(outro, {
      toValue: 0,
      duration: 240,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    exit.start();
    return () => exit.stop();
  }, [closing, outro, reducedMotion]);

  return (
    <Animated.View
      style={[
        motionStyles.launchRoot,
        { opacity: outro, transform: [{ scale: outroScale }] },
      ]}
    >
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />
      <LinearGradient
        colors={["#040A16", "#081529", "#040A16"]}
        locations={[0, 0.5, 1]}
        style={motionStyles.launch}
      >
        <View style={motionStyles.logoStage}>
          <Animated.View
            pointerEvents="none"
            style={[
              motionStyles.glowStack,
              { opacity: glowOpacity, transform: [{ scale: glowScale }] },
            ]}
          >
            {GLOW_LAYERS.map((layer) => (
              <View
                key={`glow-${layer.size}`}
                style={[
                  motionStyles.glowLayer,
                  {
                    width: layer.size,
                    height: layer.size,
                    borderRadius: layer.size / 2,
                    backgroundColor: layer.color,
                    left: (SOFT_GLOW_BOX - layer.size) / 2,
                    top: (SOFT_GLOW_BOX - layer.size) / 2,
                  },
                ]}
              />
            ))}
          </Animated.View>
          <Animated.View
            style={{
              opacity: intro,
              transform: [{ scale: introScale }, { translateY: introTranslate }],
            }}
          >
            <SoraMark size={124} />
          </Animated.View>
        </View>

        <Animated.View
          style={[
            motionStyles.brandCopy,
            {
              opacity: textIntro,
              transform: [{ translateY: textTranslate }],
            },
          ]}
        >
          <View style={motionStyles.livePill}>
            <AudioBars compact color="#7CC0FF" />
            <Text style={motionStyles.livePillText}>CANLI SES TOPLULUĞU</Text>
          </View>
          <Text style={motionStyles.wordmark} maxFontSizeMultiplier={1.4}>
            SORA
          </Text>
          <Text style={motionStyles.tagline} maxFontSizeMultiplier={1.5}>
            SESİN · ÇEVREN · ANIN
          </Text>
        </Animated.View>

        <Animated.View
          style={[motionStyles.launchStatus, { opacity: textIntro }]}
        >
          <View style={motionStyles.loadingTrack}>
            <Animated.View
              style={[
                motionStyles.loadingShuttle,
                { transform: [{ translateX: shimmerTranslate }] },
              ]}
            >
              <LinearGradient
                colors={["rgba(47,128,237,0)", "#63B0FF", "rgba(47,128,237,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <Text style={motionStyles.loadingText}>
            {waiting
              ? "Hesabın senkronize ediliyor…"
              : "Ses odaları hazırlanıyor…"}
          </Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
});

const motionStyles = StyleSheet.create({
  launchRoot: {
    flex: 1,
    backgroundColor: "#030711",
  },
  launch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glowStack: {
    position: "absolute",
    width: SOFT_GLOW_BOX,
    height: SOFT_GLOW_BOX,
  },
  glowLayer: {
    position: "absolute",
  },
  logoStage: {
    width: SOFT_GLOW_BOX,
    height: SOFT_GLOW_BOX,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  brandCopy: {
    alignItems: "center",
    marginTop: 6,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(47,128,237,0.14)",
    borderWidth: 1,
    borderColor: "rgba(124,192,255,0.28)",
  },
  livePillText: {
    color: "#B9DCFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  wordmark: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 9,
    marginTop: 16,
    marginLeft: 9,
  },
  tagline: {
    color: "#9FB3CE",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 2.6,
    marginTop: 8,
  },
  launchStatus: {
    position: "absolute",
    left: 42,
    right: 42,
    bottom: 50,
    alignItems: "center",
  },
  loadingTrack: {
    width: 152,
    height: 3.5,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.09)",
  },
  loadingShuttle: {
    width: 64,
    height: "100%",
    borderRadius: 4,
  },
  loadingText: {
    color: "#859BB8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    marginTop: 12,
  },
  pulseShell: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute" },
  audioBars: { height: 46, flexDirection: "row", alignItems: "center", gap: 5 },
  audioBarsCompact: { height: 16, gap: 2.5 },
  audioBar: { width: 3.5, borderRadius: 4 },
});
