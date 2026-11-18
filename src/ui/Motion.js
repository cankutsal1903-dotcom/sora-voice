import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StatusBar,
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
  logoSource,
  waiting = false,
  closing = false,
}) {
  const intro = useRef(new Animated.Value(0)).current;
  const textIntro = useRef(new Animated.Value(0)).current;
  const outro = useRef(new Animated.Value(1)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const waveA = useRef(new Animated.Value(0)).current;
  const waveB = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  const orbitRotate = useRef(
    orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
  ).current;
  const innerOrbitRotate = useRef(
    orbit.interpolate({ inputRange: [0, 1], outputRange: ["360deg", "0deg"] }),
  ).current;
  const introScale = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }),
  ).current;
  const introTranslate = useRef(
    intro.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
  ).current;
  const textTranslate = useRef(
    textIntro.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
  ).current;
  const outroScale = useRef(
    outro.interpolate({ inputRange: [0, 1], outputRange: [1.035, 1] }),
  ).current;
  const waveAScale = useRef(
    waveA.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.72] }),
  ).current;
  const waveAOpacity = useRef(
    waveA.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.42, 0] }),
  ).current;
  const waveBScale = useRef(
    waveB.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.72] }),
  ).current;
  const waveBOpacity = useRef(
    waveB.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.34, 0] }),
  ).current;
  const shimmerTranslate = useRef(
    shimmer.interpolate({ inputRange: [0, 1], outputRange: [-56, 152] }),
  ).current;

  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      intro.setValue(1);
      textIntro.setValue(1);
      orbit.setValue(0.12);
      shimmer.setValue(0.45);
      return undefined;
    }
    const entrance = Animated.parallel([
      Animated.spring(intro, {
        toValue: 1,
        damping: 15,
        stiffness: 120,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(textIntro, {
        toValue: 1,
        duration: 620,
        delay: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    const rotation = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 11000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseA = Animated.loop(
      Animated.timing(waveA, {
        toValue: 1,
        duration: 2400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    let pulseB = null;
    const waveDelay = setTimeout(() => {
      pulseB = Animated.loop(
        Animated.timing(waveB, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      );
      pulseB.start();
    }, 1200);
    const sweep = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1350,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    entrance.start();
    rotation.start();
    pulseA.start();
    sweep.start();
    return () => {
      clearTimeout(waveDelay);
      entrance.stop();
      rotation.stop();
      pulseA.stop();
      pulseB?.stop();
      sweep.stop();
    };
  }, [intro, orbit, reducedMotion, shimmer, textIntro, waveA, waveB]);

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
        colors={["#030711", "#081428", "#0D203E", "#040913"]}
        locations={[0, 0.42, 0.74, 1]}
        style={motionStyles.launch}
      >
        <View style={motionStyles.auroraTop} />
        <View style={motionStyles.auroraBottom} />
        <View style={motionStyles.launchGlow} />

        <View style={motionStyles.stageCenter}>
          <Animated.View
            style={[
              motionStyles.sonicWave,
              {
                opacity: waveAOpacity,
                transform: [{ scale: waveAScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              motionStyles.sonicWave,
              {
                opacity: waveBOpacity,
                transform: [{ scale: waveBScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              motionStyles.orbitOuter,
              { transform: [{ rotate: orbitRotate }] },
            ]}
          >
            <View style={motionStyles.orbitSparkPrimary} />
            <View style={motionStyles.orbitSparkSecondary} />
          </Animated.View>
          <Animated.View
            style={[
              motionStyles.orbitInner,
              { transform: [{ rotate: innerOrbitRotate }] },
            ]}
          >
            <View style={motionStyles.orbitInnerDot} />
          </Animated.View>

          <Animated.View
            style={{
              opacity: intro,
              transform: [{ scale: introScale }, { translateY: introTranslate }],
            }}
          >
            <LinearGradient
              colors={[
                "rgba(156,210,255,0.68)",
                "rgba(47,128,237,0.22)",
                "rgba(120,177,255,0.52)",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={motionStyles.logoRim}
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
            </LinearGradient>
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
  auroraTop: {
    position: "absolute",
    top: -110,
    right: -70,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(47,128,237,0.16)",
  },
  auroraBottom: {
    position: "absolute",
    bottom: -120,
    left: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(86,180,255,0.09)",
  },
  launchGlow: {
    position: "absolute",
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: "rgba(47,128,237,0.14)",
  },
  stageCenter: {
    width: 276,
    height: 276,
    alignItems: "center",
    justifyContent: "center",
  },
  sonicWave: {
    position: "absolute",
    width: 154,
    height: 154,
    borderRadius: 77,
    borderWidth: 1.5,
    borderColor: "rgba(120,185,255,0.55)",
  },
  orbitOuter: {
    position: "absolute",
    width: 268,
    height: 268,
    borderRadius: 134,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.2)",
  },
  orbitInner: {
    position: "absolute",
    width: 204,
    height: 204,
    borderRadius: 102,
    borderWidth: 1,
    borderColor: "rgba(148,197,255,0.14)",
  },
  orbitSparkPrimary: {
    position: "absolute",
    top: 28,
    right: 30,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#63B0FF",
    shadowColor: "#63B0FF",
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  orbitSparkSecondary: {
    position: "absolute",
    bottom: 34,
    left: 26,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#A6D4FF",
  },
  orbitInnerDot: {
    position: "absolute",
    top: 16,
    left: 34,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND_BLUE,
  },
  logoRim: {
    padding: 2.5,
    borderRadius: 42,
    shadowColor: BRAND_BLUE_LIGHT,
    shadowOpacity: 0.42,
    shadowRadius: 26,
    elevation: 18,
  },
  logoShell: {
    width: 132,
    height: 132,
    borderRadius: 39.5,
    overflow: "hidden",
    backgroundColor: "#060D1A",
  },
  logo: { width: "100%", height: "100%" },
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
