import { memo, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "../theme/colors";

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
  const translateY = useRef(
    progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
  ).current;
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
  const shellStyle = useRef({ width: size * 2.3, height: size * 2.3 }).current;
  const dotStyle = useRef({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  }).current;

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
  const scales = useRef(
    heights.map((_, index) =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: index % 2 ? [0.48, 1] : [1, 0.55],
      }),
    ),
  ).current;

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
  logoSource,
  waiting = false,
}) {
  const intro = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const orbitRotate = useRef(
    orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
  ).current;
  const introScale = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] }),
  ).current;
  const introTranslate = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
  ).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      intro.setValue(1);
      orbit.setValue(0.12);
      return undefined;
    }
    const entrance = Animated.timing(intro, {
      toValue: 1,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    const rotation = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    entrance.start();
    rotation.start();
    return () => {
      entrance.stop();
      rotation.stop();
    };
  }, [intro, orbit, reducedMotion]);

  return (
    <LinearGradient
      colors={["#060D18", "#0E1A2A", "#070D16"]}
      style={motionStyles.launch}
    >
      <View style={motionStyles.launchGlow} />
      <Animated.View
        style={[motionStyles.orbit, { transform: [{ rotate: orbitRotate }] }]}
      >
        <View style={motionStyles.orbitSpark} />
      </Animated.View>
      <Animated.View
        style={[
          motionStyles.launchInner,
          {
            opacity: intro,
            transform: [{ scale: introScale }, { translateY: introTranslate }],
          },
        ]}
      >
        <View style={motionStyles.logoShell}>
          <Image
            source={logoSource}
            style={motionStyles.logo}
            resizeMode="contain"
            fadeDuration={0}
            accessibilityLabel="Sora sesli sohbet logosu"
          />
        </View>
        <Text style={motionStyles.wordmark} maxFontSizeMultiplier={1.4}>
          SORA
        </Text>
        <Text style={motionStyles.tagline} maxFontSizeMultiplier={1.6}>
          SESİN · ÇEVREN · ANIN
        </Text>
      </Animated.View>
      <View style={motionStyles.launchStatus}>
        <View style={motionStyles.loadingTrack}>
          <Animated.View
            style={[motionStyles.loadingFill, { opacity: intro }]}
          />
        </View>
        <Text style={motionStyles.loadingText}>
          {waiting ? "Hesabın hazırlanıyor" : "Sora açılıyor"}
        </Text>
      </View>
    </LinearGradient>
  );
});

const motionStyles = StyleSheet.create({
  launch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  launchGlow: {
    position: "absolute",
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: "rgba(47,128,237,0.15)",
  },
  launchInner: { alignItems: "center" },
  orbit: {
    position: "absolute",
    width: 254,
    height: 254,
    borderRadius: 127,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.22)",
  },
  orbitSpark: {
    position: "absolute",
    top: 24,
    right: 27,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BRAND_BLUE,
    shadowColor: BRAND_BLUE,
    shadowOpacity: 0.8,
    shadowRadius: 9,
    elevation: 8,
  },
  logoShell: {
    width: 184,
    height: 184,
    borderRadius: 58,
    overflow: "hidden",
    backgroundColor: "#060D18",
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.2)",
    shadowColor: BRAND_BLUE_LIGHT,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
  },
  logo: { width: "100%", height: "100%" },
  wordmark: {
    color: "#FFFFFF",
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: 8,
    marginTop: 22,
    marginLeft: 8,
  },
  tagline: {
    color: "#AEB2C5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.1,
    marginTop: 9,
  },
  launchStatus: {
    position: "absolute",
    left: 42,
    right: 42,
    bottom: 52,
    alignItems: "center",
  },
  loadingTrack: {
    width: 112,
    height: 3,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  loadingFill: {
    width: "72%",
    height: "100%",
    borderRadius: 3,
    backgroundColor: BRAND_BLUE,
  },
  loadingText: {
    color: "#8F93A5",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 12,
  },
  pulseShell: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute" },
  audioBars: { height: 46, flexDirection: "row", alignItems: "center", gap: 5 },
  audioBarsCompact: { height: 25, gap: 3 },
  audioBar: { width: 4, borderRadius: 4 },
});
