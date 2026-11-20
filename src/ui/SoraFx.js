import { memo, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "./Motion";

// Kartların üzerinden periyodik geçen ışık şeridi (native driver).
export const ShimmerSweep = memo(function ShimmerSweep({
  width = 320,
  duration = 2600,
  delay = 900,
  bandWidth = 90,
  color = "rgba(255,255,255,0.22)",
  borderRadius = 0,
  style,
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(delay),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, progress, reducedMotion]);
  if (reducedMotion) return null;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-bandWidth * 1.6, width + bandWidth],
  });
  return (
    <View pointerEvents="none" style={[fxStyles.clip, { borderRadius }, style]}>
      <Animated.View
        style={[
          fxStyles.band,
          { width: bandWidth, transform: [{ translateX }, { skewX: "-20deg" }] },
        ]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0)", color, "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={fxStyles.fill}
        />
      </Animated.View>
    </View>
  );
});

// Yavaşça süzülen dekoratif ışık küresi.
export const FloatingGlow = memo(function FloatingGlow({
  size = 160,
  color = "rgba(120,177,255,0.35)",
  drift = 14,
  duration = 4200,
  style,
}) {
  const reducedMotion = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, duration, reducedMotion]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -drift] });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  // Sert kenarlı tek daire yerine iç içe, düşük opaklıklı halkalar:
  // RN'de blur olmadığı için yumuşak bir ışıma etkisi verir.
  const layers = [1, 0.86, 0.72, 0.58, 0.44, 0.3];
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ translateY }, { scale }],
        },
        style,
      ]}
    >
      {layers.map((f) => (
        <View
          key={f}
          style={{
            position: "absolute",
            width: size * f,
            height: size * f,
            borderRadius: (size * f) / 2,
            backgroundColor: color,
            opacity: 0.17,
          }}
        />
      ))}
    </Animated.View>
  );
});

// Basıldığında yaylanarak küçülen dokunma alanı.
export const PressableScale = memo(function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.95,
  accessibilityLabel,
  accessibilityRole = "button",
  hitSlop,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animateTo = (value) =>
    Animated.spring(scale, {
      toValue: value,
      friction: 6,
      tension: 220,
      useNativeDriver: true,
    }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.55 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
});

// Parlak degrade birincil buton.
export const GradientButton = memo(function GradientButton({
  label,
  icon,
  iconRight,
  onPress,
  disabled,
  colors = ["#2F80ED", "#1C5FB8"],
  style,
  textStyle,
  height = 50,
  shimmer = true,
  accessibilityLabel,
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel || label}
      style={[fxStyles.buttonShadow, { borderRadius: height / 2 }, style]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[fxStyles.button, { height, borderRadius: height / 2 }]}
      >
        {shimmer ? <ShimmerSweep width={260} bandWidth={70} borderRadius={height / 2} /> : null}
        {icon ? <Ionicons name={icon} size={18} color="#FFFFFF" /> : null}
        {label ? <Text style={[fxStyles.buttonText, textStyle]}>{label}</Text> : null}
        {iconRight ? <Ionicons name={iconRight} size={18} color="#FFFFFF" /> : null}
      </LinearGradient>
    </PressableScale>
  );
});

// Nefes alan halka (canlı rozetler, yeni etkinlik noktası vb.).
export const BreathingRing = memo(function BreathingRing({ size = 12, color = "#FF5C8A", style }) {
  const reducedMotion = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, reducedMotion]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      {!reducedMotion ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity,
            transform: [{ scale }],
          }}
        />
      ) : null}
      <View style={{ width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: color }} />
    </View>
  );
});

const fxStyles = StyleSheet.create({
  clip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  band: {
    position: "absolute",
    top: -20,
    bottom: -20,
    left: 0,
  },
  fill: {
    flex: 1,
  },
  buttonShadow: {
    shadowColor: "#1C5FB8",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    overflow: "hidden",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});
