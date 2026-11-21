import { memo, useEffect, useMemo, useState } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useReducedMotion } from "./Motion";

/**
 * Sora logo isareti (mikrofon + yorunge), viewBox 0 0 120 120.
 * animate=true iken ses cubuklari nefes alir ve yorunge uzerinde bir isik noktasi doner.
 * Vektor oldugu icin her boyutta keskin kalir.
 */

const TILT = (-18 * Math.PI) / 180;
const ORBIT_STEPS = 32;
const BAR_STEPS = 20;
const TONES = {
  dark: { bar: "#8ED2FF", dot: "#E9F6FF", halo: "rgba(143,219,255,0.28)" },
  light: { bar: "#2F80ED", dot: "#1D5FBF", halo: "rgba(47,128,237,0.22)" },
};
const BARS = [
  { x: 52, h: 12, phase: 0 },
  { x: 60, h: 24, phase: 0.33 },
  { x: 68, h: 12, phase: 0.66 },
];
const BAR_CENTER_Y = 46;

const orbitPoint = (theta) => {
  const x = 52 * Math.cos(theta);
  const y = 18 * Math.sin(theta);
  return {
    x: 60 + x * Math.cos(TILT) - y * Math.sin(TILT),
    y: 58 + x * Math.sin(TILT) + y * Math.cos(TILT),
  };
};

const range = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);

function SoraMarkBase({ size = 120, animate: animateProp = false, tone = "dark", accessibilityLabel = "Sora sesli sohbet logosu" }) {
  const reducedMotion = useReducedMotion();
  const animate = animateProp && !reducedMotion;
  const k = size / 120;
  const colors = TONES[tone] || TONES.dark;
  const [clocks] = useState(() => ({ bars: new Animated.Value(0), orbit: new Animated.Value(0) }));

  useEffect(() => {
    if (!animate) return undefined;
    clocks.bars.setValue(0);
    clocks.orbit.setValue(0);
    const bars = Animated.loop(
      Animated.timing(clocks.bars, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true }),
    );
    const orbit = Animated.loop(
      Animated.timing(clocks.orbit, { toValue: 1, duration: 6800, easing: Easing.linear, useNativeDriver: true }),
    );
    bars.start();
    orbit.start();
    return () => {
      bars.stop();
      orbit.stop();
    };
  }, [animate, clocks]);

  const anim = useMemo(() => {
    if (!animate) return null;
    const ts = range(BAR_STEPS);
    const barScale = (phase) =>
      clocks.bars.interpolate({
        inputRange: ts,
        outputRange: ts.map((t) => 0.3 + 0.7 * (0.5 - 0.5 * Math.cos(2 * Math.PI * ((t + phase) % 1)))),
      });
    const d = 5 * k;
    const halo = 15 * k;
    const os = range(ORBIT_STEPS);
    const pts = os.map((t) => orbitPoint(2 * Math.PI * t));
    const dotX = clocks.orbit.interpolate({ inputRange: os, outputRange: pts.map((p) => p.x * k - d / 2) });
    const dotY = clocks.orbit.interpolate({ inputRange: os, outputRange: pts.map((p) => p.y * k - d / 2) });
    const haloX = clocks.orbit.interpolate({ inputRange: os, outputRange: pts.map((p) => p.x * k - halo / 2) });
    const haloY = clocks.orbit.interpolate({ inputRange: os, outputRange: pts.map((p) => p.y * k - halo / 2) });
    return { barScale, d, halo, dotX, dotY, haloX, haloY };
  }, [animate, clocks, k]);

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id="soraMarkGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8FDBFF" />
            <Stop offset="0.5" stopColor="#2F80ED" />
            <Stop offset="1" stopColor="#1A56B8" />
          </LinearGradient>
        </Defs>

        <Ellipse
          cx="60"
          cy="58"
          rx="52"
          ry="18"
          transform="rotate(-18 60 58)"
          fill="none"
          stroke="url(#soraMarkGradient)"
          strokeWidth="4.5"
          strokeOpacity="0.92"
        />
        <Rect x="44" y="20" width="32" height="50" rx="16" fill="none" stroke="url(#soraMarkGradient)" strokeWidth="7" />
        <Path
          d="M32 56Q32 86 60 86Q88 86 88 56"
          fill="none"
          stroke="url(#soraMarkGradient)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <Path
          d="M60 86V95M46 98H74"
          fill="none"
          stroke="url(#soraMarkGradient)"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </Svg>

      {/* ses cubuklari: SVG'nin ustunde ayri View'lar, boylece nefes alabilirler */}
      {BARS.map((bar) => (
        <Animated.View
          key={`bar-${bar.x}`}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: (bar.x - 2) * k,
            top: (BAR_CENTER_Y - bar.h / 2) * k,
            width: 4 * k,
            height: bar.h * k,
            borderRadius: 2 * k,
            backgroundColor: colors.bar,
            transform: anim ? [{ scaleY: anim.barScale(bar.phase) }] : undefined,
          }}
        />
      ))}

      {anim ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: anim.halo,
              height: anim.halo,
              borderRadius: anim.halo / 2,
              backgroundColor: colors.halo,
              transform: [{ translateX: anim.haloX }, { translateY: anim.haloY }],
            }}
          />
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: anim.d,
              height: anim.d,
              borderRadius: anim.d / 2,
              backgroundColor: colors.dot,
              transform: [{ translateX: anim.dotX }, { translateY: anim.dotY }],
            }}
          />
        </>
      ) : null}
    </View>
  );
}

export const SoraMark = memo(SoraMarkBase);

export default SoraMark;
