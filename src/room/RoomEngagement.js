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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../ui/Motion";
import { playSfx } from "../audio/SoraSfx";

// ── 1) Sohbet Kıvılcımı (Buz Kırıcılar) ──────────────────────────────────────

const ICEBREAKER_CATEGORIES = [
  { id: "all", label: "Tümü" },
  { id: "fun", label: "Eğlence" },
  { id: "music", label: "Müzik" },
  { id: "night", label: "Gece" },
  { id: "social", label: "Tanışma" },
];

export const ROOM_ICEBREAKERS = [
  { id: "ib-01", cat: "music", text: "🎵 Şu an odada çalması gereken tek şarkı hangisi?" },
  { id: "ib-02", cat: "fun", text: "😂 Bu hafta en çok neye kahkaha attın?" },
  { id: "ib-03", cat: "night", text: "🍕 Gece yarısı canın aniden en çok ne çeker?" },
  { id: "ib-04", cat: "social", text: "✨ Odaya ilk kez girenler tek cümleyle kendini tanıtsın!" },
  { id: "ib-05", cat: "fun", text: "🎬 Tekrar tekrar sıkılmadan izlediğin film veya dizi hangisi?" },
  { id: "ib-06", cat: "social", text: "✈️ Yarın ücretsiz biletin olsa ilk hangi şehre uçarsın?" },
  { id: "ib-07", cat: "fun", text: "☕ Çay mı kahve mi? Tarafını seç!" },
  { id: "ib-08", cat: "fun", text: "🎮 Çocukluğunun efsane oyunu hangisiydi?" },
  { id: "ib-09", cat: "night", text: "🌙 Gece kuşu musun yoksa sabah erken kalkanlardan mı?" },
  { id: "ib-10", cat: "social", text: "🏆 Hayatta en gurur duyduğun küçük başarını paylaş!" },
  { id: "ib-11", cat: "fun", text: "📱 Telefonunda en çok vakit geçirdiğin uygulama (Sora hariç 😉)?" },
  { id: "ib-12", cat: "music", text: "🎤 Karaoke gecesi olsa sahnede hangi şarkıyı söylersin?" },
  { id: "ib-13", cat: "night", text: "🔮 10 yıl sonraki kendine tek bir cümle bırak." },
  { id: "ib-14", cat: "fun", text: "🍜 En iddialı olduğun yemek hangisi — yapmakta mı yemekte mi?" },
  { id: "ib-15", cat: "social", text: "💬 Hiç tanımadığın birine vereceğin en iyi hayat tavsiyesi?" },
  { id: "ib-16", cat: "fun", text: "⚡ Süper gücün olsa uçmak mı, zamanı durdurmak mı?" },
  { id: "ib-17", cat: "music", text: "🎧 Kulaklığı taktığında modunu anında yükselten parça?" },
  { id: "ib-18", cat: "social", text: "🏖️ Deniz tatili mi, doğada kamp tatili mi?" },
  { id: "ib-19", cat: "night", text: "📚 Son zamanlarda seni en çok etkileyen söz veya kitap?" },
  { id: "ib-20", cat: "music", text: "🥁 Eski Türkçe pop mu, rap mi, yoksa arabesk gecesi mi?" },
  { id: "ib-21", cat: "fun", text: "🐱 Kedi mi köpek mi — yoksa ikisi birden mi?" },
  { id: "ib-22", cat: "night", text: "🕰️ Geçmişe gidip tek bir günü tekrar yaşayabilsen hangisi olurdu?" },
  { id: "ib-23", cat: "social", text: "🎯 Bu ay mutlaka yapmak istediğin bir hedef ne?" },
  { id: "ib-24", cat: "social", text: "🔥 Şu an modun 1'den 10'a kaç? Neden?" },
];

const getTodayDateKey = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const storageKeyForDay = (dayKey) => `sora_icebreakers_used_v1_${dayKey}`;

let cachedDayKey = null;
let cachedUsedSet = null;
const usedListeners = new Set();

const notifyUsedListeners = () => {
  const snap = cachedUsedSet ? new Set(cachedUsedSet) : new Set();
  usedListeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      // yoksay
    }
  });
};

export async function loadUsedIcebreakersToday() {
  const day = getTodayDateKey();
  if (cachedDayKey === day && cachedUsedSet) return cachedUsedSet;
  cachedDayKey = day;
  try {
    const raw = await AsyncStorage.getItem(storageKeyForDay(day));
    const parsed = raw ? JSON.parse(raw) : [];
    cachedUsedSet = new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    cachedUsedSet = new Set();
  }
  notifyUsedListeners();
  return cachedUsedSet;
}

export async function markIcebreakerUsedToday(promptId) {
  if (!promptId) return;
  const day = getTodayDateKey();
  if (cachedDayKey !== day || !cachedUsedSet) {
    await loadUsedIcebreakersToday();
  }
  if (!cachedUsedSet) cachedUsedSet = new Set();
  cachedUsedSet.add(promptId);
  if (cachedUsedSet.size >= ROOM_ICEBREAKERS.length) {
    cachedUsedSet = new Set([promptId]);
  }
  notifyUsedListeners();
  try {
    await AsyncStorage.setItem(storageKeyForDay(day), JSON.stringify([...cachedUsedSet]));
  } catch {
    // depolama yazılamazsa bellek içi devam eder
  }
}

function useUsedIcebreakers() {
  const [used, setUsed] = useState(() => (cachedUsedSet ? new Set(cachedUsedSet) : new Set()));
  useEffect(() => {
    let active = true;
    const onChange = (nextSet) => {
      if (active) setUsed(nextSet);
    };
    usedListeners.add(onChange);
    loadUsedIcebreakersToday().then((loaded) => {
      if (active && loaded) setUsed(new Set(loaded));
    });
    return () => {
      active = false;
      usedListeners.delete(onChange);
    };
  }, []);
  return used;
}

export const RoomIcebreakerStrip = memo(function RoomIcebreakerStrip({
  visible = false,
  onSendPrompt,
  onOpenAll,
  onDismiss,
}) {
  const usedIds = useUsedIcebreakers();
  const [offset, setOffset] = useState(() => Math.floor(Math.random() * ROOM_ICEBREAKERS.length));
  const [sending, setSending] = useState(false);

  const available = useMemo(() => {
    const fresh = ROOM_ICEBREAKERS.filter((item) => !usedIds.has(item.id));
    return fresh.length > 0 ? fresh : ROOM_ICEBREAKERS;
  }, [usedIds]);

  const currentPrompt = available[offset % available.length] || ROOM_ICEBREAKERS[0];

  const handleShuffle = useCallback(() => {
    playSfx("tap");
    setOffset((prev) => prev + 1);
  }, []);

  const handleSend = useCallback(async () => {
    if (!currentPrompt || sending) return;
    setSending(true);
    playSfx("pop");
    try {
      const sent = await onSendPrompt?.(currentPrompt.text);
      if (sent !== false) {
        await markIcebreakerUsedToday(currentPrompt.id);
        setOffset((prev) => prev + 1);
      }
    } finally {
      setSending(false);
    }
  }, [currentPrompt, onSendPrompt, sending]);

  if (!visible || !currentPrompt) return null;

  return (
    <View style={styles.sparkStrip}>
      <LinearGradient
        colors={["rgba(20,39,76,0.92)", "rgba(31,56,105,0.88)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
      />
      <Pressable
        onPress={onOpenAll}
        hitSlop={6}
        style={styles.sparkTag}
        accessibilityRole="button"
        accessibilityLabel="Tüm sohbet kıvılcımlarını gör"
      >
        <Ionicons name="sparkles" size={12} color="#FDE047" />
        <Text style={styles.sparkTagText}>Kıvılcım</Text>
      </Pressable>
      <Pressable
        onPress={handleSend}
        disabled={sending}
        style={styles.sparkBodyPress}
        accessibilityRole="button"
        accessibilityLabel={`Sohbete gönder: ${currentPrompt.text}`}
      >
        <Text numberOfLines={1} style={styles.sparkPromptText}>
          {currentPrompt.text}
        </Text>
      </Pressable>
      <Pressable
        onPress={handleShuffle}
        hitSlop={6}
        style={({ pressed }) => [styles.sparkIconBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Başka soru getir"
      >
        <Ionicons name="refresh" size={14} color="#BFD9FF" />
      </Pressable>
      <Pressable
        onPress={handleSend}
        disabled={sending}
        hitSlop={6}
        style={({ pressed }) => [styles.sparkSendBtn, pressed && { transform: [{ scale: 0.92 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Soruyu sohbete gönder"
      >
        <Ionicons name="arrow-up" size={14} color="#FFFFFF" />
      </Pressable>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={6}
          style={({ pressed }) => [styles.sparkCloseBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="Kıvılcım çubuğunu gizle"
        >
          <Ionicons name="close" size={13} color="rgba(203,213,225,0.75)" />
        </Pressable>
      ) : null}
    </View>
  );
});

export const RoomIcebreakerSheet = memo(function RoomIcebreakerSheet({
  visible = false,
  onSendPrompt,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const usedIds = useUsedIcebreakers();
  const [category, setCategory] = useState("all");
  const [seed, setSeed] = useState(0);
  const [sendingId, setSendingId] = useState(null);

  const visiblePrompts = useMemo(() => {
    const filtered =
      category === "all"
        ? ROOM_ICEBREAKERS
        : ROOM_ICEBREAKERS.filter((item) => item.cat === category);
    const fresh = filtered.filter((item) => !usedIds.has(item.id));
    const pool = fresh.length > 0 ? fresh : filtered;
    if (!pool.length) return [];
    const shift = seed % pool.length;
    const rotated = [...pool.slice(shift), ...pool.slice(0, shift)];
    return rotated.slice(0, 6);
  }, [category, seed, usedIds]);

  const handleSend = useCallback(
    async (item) => {
      if (!item || sendingId) return;
      setSendingId(item.id);
      playSfx("pop");
      try {
        const sent = await onSendPrompt?.(item.text);
        if (sent !== false) {
          await markIcebreakerUsedToday(item.id);
          onDismiss?.();
        }
      } finally {
        setSendingId(null);
      }
    },
    [onDismiss, onSendPrompt, sendingId],
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <View style={styles.sheetSparkBadge}>
                <Ionicons name="sparkles" size={16} color="#FDE047" />
              </View>
              <View>
                <Text style={styles.sheetTitle}>Sohbet Kıvılcımı</Text>
                <Text style={styles.sheetSubtitle}>
                  Tek dokunuşla odaya eğlenceli bir konu at
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => {
                playSfx("tap");
                setSeed((s) => s + 3);
              }}
              style={({ pressed }) => [styles.shufflePill, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="Soruları karıştır"
            >
              <Ionicons name="shuffle" size={14} color="#93C5FD" />
              <Text style={styles.shufflePillText}>Karıştır</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catRow}
          >
            {ICEBREAKER_CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => setCategory(cat.id)}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            style={styles.promptScroll}
            contentContainerStyle={styles.promptList}
            showsVerticalScrollIndicator={false}
          >
            {visiblePrompts.map((item) => {
              const busy = sendingId === item.id;
              return (
                <Pressable
                  key={item.id}
                  disabled={Boolean(sendingId)}
                  onPress={() => handleSend(item)}
                  style={({ pressed }) => [
                    styles.promptCard,
                    pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.promptText}>{item.text}</Text>
                  <LinearGradient
                    colors={["#38BDF8", "#2F80ED"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.promptSendPill}
                  >
                    <Ionicons name={busy ? "hourglass-outline" : "send"} size={12} color="#FFFFFF" />
                    <Text style={styles.promptSendText}>{busy ? "..." : "At"}</Text>
                  </LinearGradient>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

// ── 2) Toplu Alkış / Coşku Dalgası (Room Hype Wave) ──────────────────────────

const WAVE_EMOJIS = ["🔥", "👏", "✨", "❤️", "🎉", "⚡", "💫", "🌟"];

const WaveParticle = memo(function WaveParticle({ index, emoji, triggerId, reducedMotion }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion || !triggerId) return undefined;
    progress.setValue(0);
    const delay = (index % 5) * 90 + Math.floor(index / 5) * 140;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 1850 + (index % 3) * 260,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [index, progress, reducedMotion, triggerId]);

  if (reducedMotion) return null;

  const leftPct = 8 + ((index * 11) % 84);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [40, -290 - (index % 3) * 55],
  });
  const translateX = progress.interpolate({
    inputRange: [0, 0.4, 0.75, 1],
    outputRange: [0, index % 2 === 0 ? 18 : -18, index % 2 === 0 ? -12 : 12, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.14, 0.76, 1],
    outputRange: [0, 1, 0.95, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.25, 0.85, 1],
    outputRange: [0.45, 1.25, 1.05, 0.75],
  });

  return (
    <Animated.Text
      style={[
        styles.waveParticle,
        {
          left: `${leftPct}%`,
          opacity,
          transform: [{ translateY }, { translateX }, { scale }],
        },
      ]}
    >
      {emoji}
    </Animated.Text>
  );
});

export const RoomHypeWaveOverlay = memo(function RoomHypeWaveOverlay({
  wave = null,
  minimized = false,
  onComplete,
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!wave?.id || minimized) return undefined;
    bannerAnim.setValue(0);
    glowAnim.setValue(0);
    const anim = Animated.parallel([
      Animated.sequence([
        Animated.spring(bannerAnim, {
          toValue: 1,
          tension: 90,
          friction: 9,
          useNativeDriver: true,
        }),
        Animated.delay(2350),
        Animated.timing(bannerAnim, {
          toValue: 0,
          duration: 360,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.35,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.9,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start(({ finished }) => {
      if (finished) onCompleteRef.current?.(wave.id);
    });
    const fallbackTimer = setTimeout(() => {
      onCompleteRef.current?.(wave.id);
    }, 3400);
    return () => {
      anim.stop();
      clearTimeout(fallbackTimer);
    };
  }, [bannerAnim, glowAnim, minimized, wave?.id]);

  if (!wave?.id || minimized) return null;

  const count = Math.max(4, Number(wave.count) || 6);
  const uniqueReactors = Math.max(1, Number(wave.reactors) || 1);
  const headline =
    uniqueReactors >= 2
      ? `ALKIŞ DALGASI! · ${uniqueReactors} kişi coştu`
      : `ODA COŞTU! · ×${count} tepki dalgası`;

  const bannerScale = bannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.84, 1],
  });
  const bannerTranslateY = bannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 0],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.waveEdgeGlow, { opacity: glowAnim }]}>
        <LinearGradient
          colors={["rgba(249,115,22,0.34)", "rgba(236,72,153,0.16)", "rgba(139,92,246,0.0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.waveBannerAnchor,
          {
            top: insets.top + 60,
            opacity: bannerAnim,
            transform: [{ translateY: bannerTranslateY }, { scale: bannerScale }],
          },
        ]}
      >
        <LinearGradient
          colors={["#F97316", "#EC4899", "#7C3AED"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.waveBanner}
        >
          <Text style={styles.waveBannerEmoji}>{wave.emoji || "🔥"}</Text>
          <Text numberOfLines={1} style={styles.waveBannerText}>
            {headline}
          </Text>
          <View style={styles.waveCountBadge}>
            <Text style={styles.waveCountText}>×{count}</Text>
          </View>
        </LinearGradient>
      </Animated.View>

      <View style={styles.waveParticleField}>
        {WAVE_EMOJIS.map((em, idx) => (
          <WaveParticle
            key={`${wave.id}-${idx}`}
            index={idx}
            emoji={idx === 0 && wave.emoji ? wave.emoji : em}
            triggerId={wave.id}
            reducedMotion={reducedMotion}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Spark Strip
  sparkStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.28)",
    overflow: "hidden",
  },
  sparkTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: "rgba(250,204,21,0.16)",
  },
  sparkTagText: {
    color: "#FDE047",
    fontSize: 10,
    fontWeight: "900",
  },
  sparkBodyPress: {
    flex: 1,
    paddingVertical: 2,
  },
  sparkPromptText: {
    color: "#F1F5F9",
    fontSize: 12,
    fontWeight: "700",
  },
  sparkIconBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.09)",
    alignItems: "center",
    justifyContent: "center",
  },
  sparkSendBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#2F80ED",
    alignItems: "center",
    justifyContent: "center",
  },
  sparkCloseBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  // Spark Sheet
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(4,9,20,0.62)",
  },
  sheetCard: {
    backgroundColor: "#0F1B33",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(147,197,253,0.22)",
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "76%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,163,184,0.4)",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  sheetSparkBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(250,204,21,0.16)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.34)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  sheetSubtitle: {
    color: "rgba(203,213,225,0.78)",
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 1,
  },
  shufflePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(59,130,246,0.18)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.34)",
  },
  shufflePillText: {
    color: "#93C5FD",
    fontSize: 12,
    fontWeight: "800",
  },
  catRow: {
    gap: 8,
    paddingBottom: 12,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  catChipActive: {
    backgroundColor: "rgba(47,128,237,0.28)",
    borderColor: "#60A5FA",
  },
  catChipText: {
    color: "rgba(203,213,225,0.82)",
    fontSize: 12,
    fontWeight: "700",
  },
  catChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  promptScroll: {
    maxHeight: 340,
  },
  promptList: {
    gap: 9,
    paddingBottom: 8,
  },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.16)",
  },
  promptText: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 13.5,
    fontWeight: "700",
    lineHeight: 19,
  },
  promptSendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 11,
  },
  promptSendText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },

  // Hype Wave Overlay
  waveEdgeGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 190,
  },
  waveBannerAnchor: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  waveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
    shadowColor: "#EC4899",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  waveBannerEmoji: {
    fontSize: 16,
  },
  waveBannerText: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 0.4,
    maxWidth: 220,
  },
  waveCountBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.34)",
  },
  waveCountText: {
    color: "#FEF08A",
    fontSize: 11.5,
    fontWeight: "900",
  },
  waveParticleField: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 92,
    height: 360,
    overflow: "hidden",
  },
  waveParticle: {
    position: "absolute",
    bottom: 0,
    fontSize: 24,
  },
});
