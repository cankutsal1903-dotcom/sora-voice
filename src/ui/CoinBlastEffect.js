import { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "./Motion";

const TR_NUM_FMT = new Intl.NumberFormat("tr-TR");
const formatBlastAmount = (value) =>
  TR_NUM_FMT.format(Math.max(0, Math.round(Number(value) || 0)));

const PARTICLE_SPECS = Array.from({ length: 16 }, (_, idx) => {
  const angle = (idx / 16) * Math.PI * 2 + (idx % 2 === 0 ? 0.12 : -0.08);
  const distFactor = 0.24 + (idx % 4) * 0.065;
  const isCoin = idx % 3 !== 2;
  const size = isCoin ? 20 + (idx % 3) * 5 : 10 + (idx % 3) * 3;
  const spinDir = idx % 2 === 0 ? 1 : -1;
  return {
    id: idx,
    angle,
    distFactor,
    isCoin,
    size,
    spinDeg: `${spinDir * (220 + (idx % 4) * 70)}deg`,
    color: idx % 4 === 0 ? "#FFF4B8" : idx % 4 === 1 ? "#F6C86E" : idx % 4 === 2 ? "#FF9F43" : "#38BDF8",
  };
});

const BlastBurstScene = memo(function BlastBurstScene({ event, onComplete, reducedMotion }) {
  const progress = useRef(new Animated.Value(0)).current;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: reducedMotion ? 1600 : 2650,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onCompleteRef.current?.(event.key);
    });
    return () => anim.stop();
  }, [event.key, progress, reducedMotion]);

  const cardScale = progress.interpolate({
    inputRange: [0, 0.1, 0.2, 0.82, 1],
    outputRange: [0.45, 1.12, 1, 1.02, 0.88],
    extrapolate: "clamp",
  });
  const cardOpacity = progress.interpolate({
    inputRange: [0, 0.08, 0.82, 1],
    outputRange: [0, 1, 1, 0],
    extrapolate: "clamp",
  });
  const cardTranslateY = progress.interpolate({
    inputRange: [0, 0.14, 0.82, 1],
    outputRange: [26, 0, -6, -24],
    extrapolate: "clamp",
  });

  const ringOneScale = progress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0.25, 1.85, 2.25],
    extrapolate: "clamp",
  });
  const ringOneOpacity = progress.interpolate({
    inputRange: [0, 0.08, 0.42, 0.65],
    outputRange: [0, 0.85, 0.22, 0],
    extrapolate: "clamp",
  });

  const ringTwoScale = progress.interpolate({
    inputRange: [0.06, 0.58, 1],
    outputRange: [0.2, 1.55, 1.95],
    extrapolate: "clamp",
  });
  const ringTwoOpacity = progress.interpolate({
    inputRange: [0.06, 0.16, 0.55, 0.78],
    outputRange: [0, 0.72, 0.18, 0],
    extrapolate: "clamp",
  });

  const maxRadius = Math.min(width, height) * 0.48;
  const multiplier = Number(event.multiplier || 0);
  const multiplierLabel = useMemo(() => {
    if (!(multiplier > 0)) return null;
    const rounded = Math.round(multiplier * 100) / 100;
    return `${rounded}x`;
  }, [multiplier]);

  return (
    <View style={styles.overlay} pointerEvents="none">
      {!reducedMotion ? (
        <>
          <Animated.View
            style={[
              styles.shockwaveRing,
              styles.shockwaveOuter,
              {
                opacity: ringOneOpacity,
                transform: [{ scale: ringOneScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.shockwaveRing,
              styles.shockwaveInner,
              {
                opacity: ringTwoOpacity,
                transform: [{ scale: ringTwoScale }],
              },
            ]}
          />
          {PARTICLE_SPECS.map((p) => {
            const dx = Math.cos(p.angle) * maxRadius * p.distFactor * 2.15;
            const dyBase = Math.sin(p.angle) * maxRadius * p.distFactor * 1.95;
            const translateX = progress.interpolate({
              inputRange: [0, 0.25, 0.65, 1],
              outputRange: [0, dx * 0.68, dx * 1.02, dx * 1.12],
              extrapolate: "clamp",
            });
            const translateY = progress.interpolate({
              inputRange: [0, 0.25, 0.65, 1],
              outputRange: [0, dyBase * 0.72 - 18, dyBase * 0.95 + 16, dyBase + 78],
              extrapolate: "clamp",
            });
            const scale = progress.interpolate({
              inputRange: [0, 0.14, 0.6, 1],
              outputRange: [0.2, 1.15, 0.95, 0.45],
              extrapolate: "clamp",
            });
            const opacity = progress.interpolate({
              inputRange: [0, 0.08, 0.72, 1],
              outputRange: [0, 1, 0.92, 0],
              extrapolate: "clamp",
            });
            const rotate = progress.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", p.spinDeg],
            });
            return (
              <Animated.View
                key={p.id}
                style={[
                  styles.particleWrap,
                  {
                    opacity,
                    transform: [{ translateX }, { translateY }, { scale }, { rotate }],
                  },
                ]}
              >
                {p.isCoin ? (
                  <LinearGradient
                    colors={["#FFF7C2", "#F7C443", "#C77D10"]}
                    style={[
                      styles.coinDisc,
                      {
                        width: p.size,
                        height: p.size,
                        borderRadius: p.size / 2,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.coinInnerRing,
                        {
                          width: p.size * 0.66,
                          height: p.size * 0.66,
                          borderRadius: (p.size * 0.66) / 2,
                        },
                      ]}
                    />
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      styles.sparkDiamond,
                      {
                        width: p.size,
                        height: p.size,
                        backgroundColor: p.color,
                      },
                    ]}
                  />
                )}
              </Animated.View>
            );
          })}
        </>
      ) : null}

      <Animated.View
        style={[
          styles.cardOuter,
          {
            opacity: cardOpacity,
            transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
          },
        ]}
      >
        <LinearGradient
          colors={["#FFF1A6", "#F7B733", "#D97706"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardBorder}
        >
          <LinearGradient
            colors={["rgba(28, 19, 8, 0.96)", "rgba(44, 27, 8, 0.95)", "rgba(18, 14, 10, 0.97)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardInner}
          >
            <View style={styles.topRow}>
              <View style={styles.flameCircle}>
                <Ionicons name="flame" size={18} color="#FFF4B8" />
              </View>
              <Text style={styles.kicker}>HEDİYE PATLAMASI!</Text>
              {multiplierLabel ? (
                <View style={styles.multPill}>
                  <Text style={styles.multText}>{multiplierLabel}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.amountRow}>
              <Ionicons name="diamond" size={22} color="#FDE047" />
              <Text style={styles.amountText} numberOfLines={1} adjustsFontSizeToFit>
                +{formatBlastAmount(event.reward)}
              </Text>
            </View>

            <Text style={styles.subtitle}>kredi hesabına eklendi</Text>
          </LinearGradient>
        </LinearGradient>
      </Animated.View>
    </View>
  );
});

export const CoinBlastEffect = memo(function CoinBlastEffect({ event, onComplete }) {
  const reducedMotion = useReducedMotion();
  if (!event?.key || !(Number(event.reward) > 0)) return null;
  return (
    <BlastBurstScene
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
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 260,
  },
  shockwaveRing: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
  },
  shockwaveOuter: {
    borderColor: "rgba(254, 240, 138, 0.85)",
  },
  shockwaveInner: {
    borderColor: "rgba(249, 115, 22, 0.78)",
  },
  particleWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  coinDisc: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFBEB",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  coinInnerRing: {
    borderWidth: 1.2,
    borderColor: "rgba(146, 64, 14, 0.45)",
    backgroundColor: "rgba(255, 251, 235, 0.25)",
  },
  sparkDiamond: {
    borderRadius: 3,
    transform: [{ rotate: "45deg" }],
  },
  cardOuter: {
    maxWidth: "84%",
    minWidth: 236,
    shadowColor: "#F59E0B",
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  cardBorder: {
    borderRadius: 24,
    padding: 2,
  },
  cardInner: {
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 16,
    alignItems: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  flameCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(245, 158, 11, 0.28)",
    borderWidth: 1,
    borderColor: "rgba(254, 240, 138, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    color: "#FDE68A",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  multPill: {
    backgroundColor: "#EA580C",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  multText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  amountText: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: "rgba(254, 243, 199, 0.85)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
});
