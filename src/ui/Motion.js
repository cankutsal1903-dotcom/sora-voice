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

export const BrandLaunch = memo(function BrandLaunch({
  waiting = false,
  closing = false,
}) {
  const intro = useRef(new Animated.Value(0)).current;
  const wordIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const statusIn = useRef(new Animated.Value(0)).current;
  const outro = useRef(new Animated.Value(1)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  const markScale = intro.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const wordTranslate = wordIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const tagTranslate = tagIn.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const outroScale = outro.interpolate({ inputRange: [0, 1], outputRange: [1.015, 1] });
  const shimmerTranslate = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-48, 150] });

  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      [intro, wordIn, tagIn, statusIn].forEach((v) => v.setValue(1));
      shimmer.setValue(0.45);
      return undefined;
    }
    const entrance = Animated.parallel([
      Animated.spring(intro, { toValue: 1, damping: 17, stiffness: 140, mass: 0.9, useNativeDriver: true }),
      Animated.timing(wordIn, { toValue: 1, duration: 460, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tagIn, { toValue: 1, duration: 420, delay: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(statusIn, { toValue: 1, duration: 380, delay: 560, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    const sweep = Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    );
    entrance.start();
    sweep.start();
    return () => {
      entrance.stop();
      sweep.stop();
    };
  }, [intro, reducedMotion, shimmer, statusIn, tagIn, wordIn]);

  useEffect(() => {
    if (!closing) return undefined;
    if (reducedMotion) {
      outro.setValue(0);
      return undefined;
    }
    const exit = Animated.timing(outro, {
      toValue: 0,
      duration: 260,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    exit.start();
    return () => exit.stop();
  }, [closing, outro, reducedMotion]);

  return (
    <Animated.View
      style={[
        motionStyles.lightRoot,
        // Opacity solmaz: arkada koyu pencere zemini var, acik ekrandan acik ekrana dogrudan gecilir.
        { transform: [{ scale: outroScale }] },
      ]}
    >
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <View style={motionStyles.lightCenter}>
        <Animated.View style={{ opacity: intro, transform: [{ scale: markScale }] }}>
          <SoraMark size={112} tone="light" animate={!reducedMotion} />
        </Animated.View>
        <Animated.Text
          style={[
            motionStyles.lightWordmark,
            { opacity: wordIn, transform: [{ translateY: wordTranslate }] },
          ]}
          maxFontSizeMultiplier={1.4}
        >
          SORA
        </Animated.Text>
        <Animated.Text
          style={[
            motionStyles.lightTagline,
            { opacity: tagIn, transform: [{ translateY: tagTranslate }] },
          ]}
          maxFontSizeMultiplier={1.5}
        >
          SESİN · ÇEVREN · ANIN
        </Animated.Text>
      </View>

      <Animated.View style={[motionStyles.lightStatus, { opacity: statusIn }]}>
        <View style={motionStyles.lightTrack}>
          <Animated.View
            style={[
              motionStyles.lightShuttle,
              { transform: [{ translateX: shimmerTranslate }] },
            ]}
          >
            <LinearGradient
              colors={["rgba(47,128,237,0)", COLORS.primary, "rgba(47,128,237,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <Text style={motionStyles.lightStatusText}>
          {waiting ? "Hesabın senkronize ediliyor…" : "Ses odaları hazırlanıyor…"}
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

const motionStyles = StyleSheet.create({
  lightRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  lightCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 48,
  },
  lightWordmark: {
    marginTop: 26,
    color: COLORS.text,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 8,
    marginLeft: 8,
  },
  lightTagline: {
    marginTop: 8,
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 2.4,
  },
  lightStatus: {
    position: "absolute",
    left: 56,
    right: 56,
    bottom: 60,
    alignItems: "center",
  },
  lightTrack: {
    width: 136,
    height: 3,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: COLORS.line,
  },
  lightShuttle: {
    width: 56,
    height: "100%",
    borderRadius: 3,
  },
  lightStatusText: {
    marginTop: 14,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  pulseShell: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute" },
  audioBars: { height: 46, flexDirection: "row", alignItems: "center", gap: 5 },
  audioBarsCompact: { height: 16, gap: 2.5 },
  audioBar: { width: 3.5, borderRadius: 4 },
});
