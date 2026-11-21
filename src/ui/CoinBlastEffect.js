import { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "./Motion";

const TR_NUM_FMT = new Intl.NumberFormat("tr-TR");
const formatBlastAmount = (value) =>
  TR_NUM_FMT.format(Math.max(0, Math.round(Number(value) || 0)));

// Göz yormayan 6 küçük altın kıvılcım — sadece üst hapın çevresinde yumuşakça süzülür.
const SOFT_SPARKS = [
  { id: 0, dx: -92, dy: -16, size: 5, color: "#FDE68A" },
  { id: 1, dx: -56, dy: 20, size: 4, color: "#F6C86E" },
  { id: 2, dx: 58, dy: -18, size: 5, color: "#FEF3C7" },
  { id: 3, dx: 96, dy: 14, size: 4.5, color: "#F59E0B" },
  { id: 4, dx: -18, dy: -22, size: 4, color: "#FDE68A" },
  { id: 5, dx: 24, dy: 22, size: 4, color: "#F6C86E" },
];

const BlastToastPill = memo(function BlastToastPill({ event, onComplete, reducedMotion }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: reducedMotion ? 1300 : 2100,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onCompleteRef.current?.(event.key);
    });
    return () => anim.stop();
  }, [event.key, progress, reducedMotion]);

  const opacity = progress.interpolate({
    inputRange: [0, 0.1, 0.82, 1],
    outputRange: [0, 1, 1, 0],
    extrapolate: "clamp",
  });
  const translateY = progress.interpolate({
    inputRange: [0, 0.14, 0.82, 1],
    outputRange: [-14, 0, 0, -10],
    extrapolate: "clamp",
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.12, 0.22, 0.85, 1],
    outputRange: [0.92, 1.03, 1, 1, 0.96],
    extrapolate: "clamp",
  });

  const multiplier = Number(event.multiplier || 0);
  const multiplierLabel = useMemo(() => {
    if (!(multiplier > 0)) return null;
    const rounded = Math.round(multiplier * 100) / 100;
    return `${rounded}x`;
  }, [multiplier]);

  return (
    <View
      style={[styles.overlay, { paddingTop: Math.max(insets.top, 24) + 64 }]}
      pointerEvents="none"
    >
      <View style={styles.anchorBox}>
        {!reducedMotion
          ? SOFT_SPARKS.map((s) => {
              const sx = progress.interpolate({
                inputRange: [0, 0.4, 1],
                outputRange: [s.dx * 0.45, s.dx * 0.9, s.dx],
                extrapolate: "clamp",
              });
              const sy = progress.interpolate({
                inputRange: [0, 0.4, 1],
                outputRange: [0, s.dy * 0.8, s.dy + 6],
                extrapolate: "clamp",
              });
              const sOpacity = progress.interpolate({
                inputRange: [0, 0.14, 0.65, 1],
                outputRange: [0, 0.62, 0.32, 0],
                extrapolate: "clamp",
              });
              return (
                <Animated.View
                  key={s.id}
                  style={[
                    styles.sparkDot,
                    {
                      width: s.size,
                      height: s.size,
                      borderRadius: s.size / 2,
                      backgroundColor: s.color,
                      opacity: sOpacity,
                      transform: [{ translateX: sx }, { translateY: sy }],
                    },
                  ]}
                />
              );
            })
          : null}

        <Animated.View
          style={[
            styles.pillOuter,
            { opacity, transform: [{ translateY }, { scale }] },
          ]}
        >
          <LinearGradient
            colors={["rgba(28, 22, 14, 0.92)", "rgba(20, 17, 13, 0.90)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.pillInner}
          >
            <View style={styles.iconBadge}>
              <Ionicons name="sparkles" size={12} color="#FDE68A" />
            </View>
            <Text style={styles.label}>Patlama</Text>
            {multiplierLabel ? (
              <View style={styles.multPill}>
                <Text style={styles.multText}>{multiplierLabel}</Text>
              </View>
            ) : null}
            <View style={styles.divider} />
            <Ionicons name="diamond" size={12} color="#F6C86E" />
            <Text style={styles.amountText} numberOfLines={1}>
              +{formatBlastAmount(event.reward)}
            </Text>
          </LinearGradient>
        </Animated.View>
      </View>
    </View>
  );
});

export const CoinBlastEffect = memo(function CoinBlastEffect({ event, onComplete }) {
  const reducedMotion = useReducedMotion();
  if (!event?.key || !(Number(event.reward) > 0)) return null;
  return (
    <BlastToastPill
      key={event.key}
      event={event}
      onComplete={onComplete}
      reducedMotion={reducedMotion}
    />
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 999,
    elevation: 240,
  },
  anchorBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  sparkDot: {
    position: "absolute",
  },
  pillOuter: {
    maxWidth: "86%",
    borderRadius: 999,
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7.5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(246, 200, 110, 0.42)",
  },
  iconBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(245, 158, 11, 0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "#FDE68A",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  multPill: {
    backgroundColor: "rgba(234, 88, 12, 0.78)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
  },
  multText: {
    color: "#FFFBEB",
    fontSize: 10,
    fontWeight: "900",
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: "rgba(253, 230, 138, 0.24)",
    marginHorizontal: 1,
  },
  amountText: {
    color: "#FFFFFF",
    fontSize: 13.5,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
});
