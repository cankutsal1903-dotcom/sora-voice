import { memo, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SoraGiftArtwork } from "./SoraGiftArtwork";

const formatComboCoins = (value) =>
  new Intl.NumberFormat("tr-TR").format(Math.max(0, Math.floor(Number(value) || 0)));

const COMBO_DURATION_MS = 5000;
const RING_SIZE = 80;
const HALF = RING_SIZE / 2;
const RING_STROKE = 4;
const CORE_SIZE = 64;

export const GiftComboButton = memo(function GiftComboButton({
  combo,
  coins = null,
  onPress,
  onExpire,
  bottomOffset = 82,
  rightOffset = 14,
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const popScale = useRef(new Animated.Value(1)).current;
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!combo?.triggerKey) return undefined;

    progress.stopAnimation();
    progress.setValue(0);

    popScale.stopAnimation();
    popScale.setValue(0.88);
    Animated.spring(popScale, {
      toValue: 1,
      friction: 5,
      tension: 160,
      useNativeDriver: true,
    }).start();

    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: COMBO_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();

    const timer = setTimeout(() => {
      onExpireRef.current?.();
    }, COMBO_DURATION_MS);

    return () => {
      clearTimeout(timer);
      anim.stop();
    };
  }, [combo?.triggerKey, popScale, progress]);

  if (!combo?.gift) return null;

  const rightRotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["180deg", "360deg", "360deg"],
    extrapolate: "clamp",
  });

  const leftRotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["180deg", "180deg", "360deg"],
    extrapolate: "clamp",
  });

  const orbitRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
    extrapolate: "clamp",
  });

  const comboCount = Math.max(1, Number(combo.count) || 1);
  const qty = Math.max(1, Number(combo.quantity) || 1);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.anchor,
        {
          bottom: bottomOffset,
          right: rightOffset,
          transform: [{ scale: popScale }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Kombo hediye gönder (${combo.gift.name})`}
        style={({ pressed }) => [
          styles.touchWrap,
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        {/* 5 saniyelik kırmızı dönen geri sayım halkası */}
        <View style={styles.ringContainer} pointerEvents="none">
          <View style={styles.ringTrack} />

          {/* Sağ yarı yay */}
          <View style={styles.rightClip}>
            <Animated.View
              style={[
                styles.rotatorFromRight,
                { transform: [{ rotate: rightRotate }] },
              ]}
            >
              <View style={styles.leftHalfPaintClip}>
                <View style={styles.ringArc} />
              </View>
            </Animated.View>
          </View>

          {/* Sol yarı yay */}
          <View style={styles.leftClip}>
            <Animated.View
              style={[
                styles.rotatorFromLeft,
                { transform: [{ rotate: leftRotate }] },
              ]}
            >
              <View style={styles.rightHalfPaintClip}>
                <View style={[styles.ringArc, { left: -HALF }]} />
              </View>
            </Animated.View>
          </View>

          {/* Çerçevede dönen parlak kırmızı uç nokta */}
          <Animated.View
            style={[
              styles.orbitLayer,
              { transform: [{ rotate: orbitRotate }] },
            ]}
          >
            <View style={styles.orbitDot} />
          </Animated.View>
        </View>

        {/* Merkez yuvarlak kombo butonu */}
        <LinearGradient
          colors={["#2B1424", "#151E34"]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.coreCircle}
        >
          <SoraGiftArtwork
            giftId={combo.gift.id}
            giftName={combo.gift.name}
            fallbackIcon={combo.gift.icon || "gift"}
            fallbackColor={combo.gift.color || "#FF3B53"}
            size={28}
          />
          <Text style={styles.comboLabel}>KOMBO</Text>
          {qty > 1 ? (
            <Text style={styles.qtySubLabel}>{qty}x</Text>
          ) : null}
        </LinearGradient>

        {/* Kombo sayacı rozeti */}
        <View style={styles.counterBadge} pointerEvents="none">
          <Text style={styles.counterText}>x{comboCount}</Text>
        </View>
      </Pressable>
      {typeof coins === "number" ? (
        <View style={styles.liveCoinPill} pointerEvents="none">
          <Ionicons name="diamond" size={10} color="#60A5FA" />
          <Text style={styles.liveCoinText} numberOfLines={1}>
            {formatComboCoins(coins)}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    alignItems: "center",
    zIndex: 95,
    elevation: 14,
  },
  liveCoinPill: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: "rgba(9, 16, 30, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.45)",
  },
  liveCoinText: {
    color: "#F8FAFC",
    fontSize: 10.5,
    fontWeight: "800",
  },
  touchWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
  },
  ringTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: HALF,
    borderWidth: RING_STROKE,
    borderColor: "rgba(255, 45, 70, 0.2)",
    backgroundColor: "rgba(10, 15, 28, 0.55)",
  },
  rightClip: {
    position: "absolute",
    top: 0,
    left: HALF,
    width: HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  leftClip: {
    position: "absolute",
    top: 0,
    left: 0,
    width: HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  rotatorFromRight: {
    position: "absolute",
    top: 0,
    left: -HALF,
    width: RING_SIZE,
    height: RING_SIZE,
  },
  rotatorFromLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
  },
  leftHalfPaintClip: {
    position: "absolute",
    top: 0,
    left: 0,
    width: HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  rightHalfPaintClip: {
    position: "absolute",
    top: 0,
    left: HALF,
    width: HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  ringArc: {
    position: "absolute",
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: HALF,
    borderWidth: RING_STROKE,
    borderColor: "#FF2D46",
  },
  orbitLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
  },
  orbitDot: {
    position: "absolute",
    top: -2.5,
    left: HALF - 4.5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "#FF4D63",
    borderWidth: 1.5,
    borderColor: "#FFD6DC",
    shadowColor: "#FF2D46",
    shadowOpacity: 0.95,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  coreCircle: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 114, 0.42)",
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    paddingTop: 2,
  },
  comboLabel: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 1,
  },
  qtySubLabel: {
    color: "#FF8FA0",
    fontSize: 8.5,
    fontWeight: "900",
    marginTop: -1,
  },
  counterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 26,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: "#FF2D46",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
});
