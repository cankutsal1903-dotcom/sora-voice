import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "../theme/colors";
import { useReducedMotion } from "../ui/Motion";

export const QUICK_REACTIONS = [
  { id: "heart", emoji: "❤️", label: "Kalp", tint: "#FF4D79" },
  { id: "fire", emoji: "🔥", label: "Ateş", tint: "#FF8A2B" },
  { id: "clap", emoji: "👏", label: "Alkış", tint: "#F6C86E" },
  { id: "laugh", emoji: "😂", label: "Kahkaha", tint: "#5CE1E6" },
  { id: "party", emoji: "🎉", label: "Kutlama", tint: "#A78BFA" },
  { id: "hundred", emoji: "💯", label: "Harika", tint: "#38BDF8" },
];

const REACTION_BY_ID = new Map(QUICK_REACTIONS.map((item) => [item.id, item]));

const TRUTH_PROMPTS = [
  "Şu an telefonda en son dinlediğin şarkı hangisiydi?",
  "Hayatında verdiğin en spontane karar neydi?",
  "Bugün seni en çok gülümseten küçük şey ne oldu?",
  "Bu odada ilk kez dikkatini çeken detay neydi?",
  "Bir günlüğüne görünmez olsaydın ilk nereye giderdin?",
  "En çok hangi diziyi veya filmi bitirdiğine üzüldün?",
  "Gece yarısı aklına gelen en garip fikir neydi?",
  "Sabah insanı mısın yoksa tam bir gece kuşu mu?",
  "En son kime uzun bir sesli mesaj attın ve konusu neydi?",
  "Sence iyi bir sohbeti unutulmaz yapan şey nedir?",
  "Çocukken büyüyünce ne olmak istiyordun?",
  "Şu an bir ülkeye tek yön biletin olsa nereyi seçerdin?",
  "Telefonunda en çok vakit geçirdiğin saat aralığı hangisi?",
  "En gurur duyduğun küçük alışkanlığın nedir?",
  "Bir şarkıyı ömür boyu sadece tek bir kişiyle dinleyebilsen hangi şarkı olurdu?",
  "İlk tanıştığın birinde en çok neye dikkat edersin?",
  "Şu ana kadar yaptığın en iyi yemek hangisi?",
  "Bir süper gücün olsaydı uçmak mı, zamanı durdurmak mı seçerdin?",
  "Son bir ayda öğrendiğin en ilginç bilgi neydi?",
  "Bu haftaya 10 üzerinden kaç puan veriyorsun, neden?",
];

const DARE_PROMPTS = [
  "Mikrofonu aç ve 5 saniye boyunca radyo spikeri sesiyle odayı tanıt!",
  "En sevdiğin şarkının nakaratından 10 saniye mırıldan!",
  "Oda sohbetine bugünü anlatan tek bir yaratıcı cümle yaz!",
  "Odadaki bir kişiye içten, güzel bir iltifat et!",
  "3 saniye boyunca hiç durmadan en hızlı tekerlemeyi söylemeyi dene!",
  "En sevdiğin film repliğini dramatik bir tonda seslendir!",
  "Mikrofonda odaya özel mini bir alkış temposu tut!",
  "Bir sonraki 1 dakika boyunca her cümlenin sonuna 'kaptan' ekle!",
  "Odadaki herkese bugün için bir şarkı önerisi ver!",
  "Telefonundaki en son çektiğin fotoğrafın hikayesini 15 saniyede anlat!",
  "Sadece 3 kelimeyle kendini odaya yeniden tanıt!",
  "En iyi kahkaha veya neşeli ses tonunla odaya 'Hoş geldiniz' de!",
  "Odadaki rastgele birine bir sonraki soruyu sorma hakkını devret!",
  "Şu an yanındaki ilk nesneyi sanki milyonluk sanat eseri gibi 10 saniye öv!",
  "Bir futbol spikeri heyecanıyla şu an odada olanları 10 saniye anlat!",
  "En sevdiğin şehri adını söylemeden 3 ipucuyla odaya tahmin ettir!",
  "Aklındaki 1 ile 10 arasındaki sayıyı seç, oda 3 denemede bulsun!",
  "Odaya bu akşamın resmi sloganını bul ve söyle!",
  "En sevdiğin çocukluk çizgi filmini 10 saniyede özetle!",
  "Hızlıca 3 saniyede en sevdiğin 3 yemeği say!",
];

const WHEEL_TOPICS = [
  "Gece yarısı muhabbeti",
  "En iyi şarkı önerisi kapışması",
  "Unutamadığın bir yol hikayesi",
  "Film ve dizi tavsiyeleri",
  "Tek kelimeyle haftanın özeti",
  "En komik yanlış anlaşılma",
  "Hayalindeki tatil rotası",
  "Çocukluk nostaljisi",
  "Kahve mi çay mı büyük tartışması",
  "Müzik tahmini oyunu",
  "Günün en güzel haberi",
  "Bir süper güç seçsen hangisi?",
  "En çok güldüğün anı",
  "Sürpriz soru turu",
];

const DICE_DOTS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const pickRandom = (list, excludeValue = null) => {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length === 1) return list[0];
  let candidate = list[Math.floor(Math.random() * list.length)];
  for (let i = 0; i < 4 && candidate === excludeValue; i += 1) {
    candidate = list[Math.floor(Math.random() * list.length)];
  }
  return candidate;
};

// ── 1) Uçuşan Tepki Balonları ────────────────────────────────────────────────
const FloatingReactionBubble = memo(function FloatingReactionBubble({ item, onDone, reducedMotion }) {
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const duration = reducedMotion ? 900 : item.duration || 1850;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDoneRef.current?.(item.key);
    });
    return () => anim.stop();
  }, [item.duration, item.key, progress, reducedMotion]);

  const sway = item.sway || 18;
  const rise = reducedMotion ? -90 : -(item.rise || 245);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, rise],
  });
  const translateX = progress.interpolate({
    inputRange: [0, 0.32, 0.68, 1],
    outputRange: [item.startX || 0, (item.startX || 0) - sway, (item.startX || 0) + sway * 0.75, (item.startX || 0) - sway * 0.35],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.14, 0.35, 0.85, 1],
    outputRange: [0.35, 1.2, 1.0, 0.96, 0.82],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.1, 0.72, 1],
    outputRange: [0, 1, 0.96, 0],
  });

  const meta = REACTION_BY_ID.get(item.reactionId) || QUICK_REACTIONS[0];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingBubbleWrap,
        {
          bottom: item.bottomBase || 118,
          right: item.rightBase || 16,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
        },
      ]}
    >
      <View style={[styles.floatingBubbleOrb, { borderColor: `${meta.tint}99` }]}>
        <Text style={styles.floatingBubbleEmoji}>{meta.emoji}</Text>
      </View>
      {item.showSender && item.senderName ? (
        <View style={styles.floatingSenderChip}>
          <Text style={styles.floatingSenderText} numberOfLines={1}>
            {item.senderName}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
});

export const FloatingReactionsOverlay = memo(function FloatingReactionsOverlay({
  reactions,
  onExpire,
  minimized = false,
}) {
  const reducedMotion = useReducedMotion();
  if (minimized || !reactions || reactions.length === 0) return null;
  return (
    <View style={styles.floatingLayer} pointerEvents="none">
      {reactions.map((item) => (
        <FloatingReactionBubble
          key={item.key}
          item={item}
          onDone={onExpire}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
});

// ── 2) Sağ Alt Hızlı Tepki + Mini Oyun Dock'u ────────────────────────────────
export const RoomQuickDock = memo(function RoomQuickDock({
  visible = true,
  bottomOffset = 74,
  onSendReaction,
  onOpenGames,
}) {
  const [trayOpen, setTrayOpen] = useState(false);
  const autoCloseRef = useRef(null);
  const trayAnim = useRef(new Animated.Value(0)).current;

  const scheduleAutoClose = useCallback(() => {
    clearTimeout(autoCloseRef.current);
    autoCloseRef.current = setTimeout(() => setTrayOpen(false), 3200);
  }, []);

  useEffect(() => {
    Animated.spring(trayAnim, {
      toValue: trayOpen ? 1 : 0,
      friction: 7,
      tension: 120,
      useNativeDriver: true,
    }).start();
    if (!trayOpen) clearTimeout(autoCloseRef.current);
  }, [trayAnim, trayOpen]);

  useEffect(() => () => clearTimeout(autoCloseRef.current), []);

  useEffect(() => {
    if (!visible && trayOpen) setTrayOpen(false);
  }, [trayOpen, visible]);

  if (!visible) return null;

  const handleToggleTray = () => {
    setTrayOpen((current) => {
      const next = !current;
      if (next) scheduleAutoClose();
      return next;
    });
  };

  const handlePickReaction = (reactionId) => {
    onSendReaction?.(reactionId);
    scheduleAutoClose();
  };

  const trayTranslateX = trayAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 0],
  });
  const trayScale = trayAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1],
  });

  return (
    <View style={[styles.dockRoot, { bottom: bottomOffset }]} pointerEvents="box-none">
      {trayOpen ? (
        <Animated.View
          style={[
            styles.reactionTray,
            {
              opacity: trayAnim,
              transform: [{ translateX: trayTranslateX }, { scale: trayScale }],
            },
          ]}
        >
          {QUICK_REACTIONS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handlePickReaction(item.id)}
              style={({ pressed }) => [
                styles.reactionTrayItem,
                pressed && styles.reactionTrayItemPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} tepkisi gönder`}
            >
              <Text style={styles.reactionTrayEmoji}>{item.emoji}</Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}

      <View style={styles.dockColumn}>
        <Pressable
          onPress={onOpenGames}
          style={({ pressed }) => [
            styles.dockButton,
            styles.dockGameButton,
            pressed && styles.dockButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Oda mini oyunlarını aç"
        >
          <Ionicons name="dice" size={19} color="#FDE68A" />
        </Pressable>
        <Pressable
          onPress={handleToggleTray}
          onLongPress={() => onSendReaction?.("heart")}
          delayLongPress={220}
          style={({ pressed }) => [
            styles.dockButton,
            trayOpen ? styles.dockReactionButtonOpen : styles.dockReactionButton,
            pressed && styles.dockButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Hızlı tepki gönder"
        >
          <Ionicons
            name={trayOpen ? "close" : "heart"}
            size={19}
            color={trayOpen ? "#FFFFFF" : "#FF6B93"}
          />
        </Pressable>
      </View>
    </View>
  );
});

// ── 3) Odaya Giriş Efekti Şeridi ─────────────────────────────────────────────
export const RoomEntranceBanner = memo(function RoomEntranceBanner({
  entry,
  onComplete,
  minimized = false,
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const slideX = useRef(new Animated.Value(280)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!entry?.key || minimized) return undefined;
    slideX.setValue(reducedMotion ? 0 : 280);
    opacity.setValue(0);

    const anim = Animated.sequence([
      Animated.parallel([
        Animated.spring(slideX, {
          toValue: 0,
          friction: 7,
          tension: 90,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(2750),
      Animated.parallel([
        Animated.timing(slideX, {
          toValue: reducedMotion ? 0 : -260,
          duration: 320,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]),
    ]);

    anim.start(({ finished }) => {
      if (finished) onCompleteRef.current?.(entry.key);
    });
    return () => anim.stop();
  }, [entry?.key, minimized, opacity, reducedMotion, slideX]);

  if (!entry || minimized) return null;

  const level = Math.max(1, Math.floor(Number(entry.level) || 1));
  const isHost = entry.role === "host";
  const isVip = !isHost && (level >= 10 || Number(entry.familyLevel || 0) >= 3);

  const gradientColors = isHost
    ? ["rgba(246,200,110,0.95)", "rgba(196,130,36,0.94)", "rgba(88,52,14,0.92)"]
    : isVip
      ? ["rgba(124,92,255,0.95)", "rgba(47,128,237,0.93)", "rgba(16,35,70,0.92)"]
      : ["rgba(47,128,237,0.92)", "rgba(25,68,136,0.92)", "rgba(12,24,48,0.9)"];

  const badgeIcon = isHost ? "sparkles" : isVip ? "diamond" : "flash";
  const badgeTint = isHost ? "#FFF5D6" : isVip ? "#E9D5FF" : "#BAE6FD";
  const subtitle = isHost
    ? "Oda sahibi sahneye geldi"
    : isVip
      ? "Odaya ışınlandı"
      : "Odaya katıldı";

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.entranceWrap,
        {
          top: insets.top + 58,
          opacity,
          transform: [{ translateX: slideX }],
        },
      ]}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[
          styles.entranceCard,
          isHost && styles.entranceCardHost,
          isVip && styles.entranceCardVip,
        ]}
      >
        <View style={[styles.entranceAvatar, { backgroundColor: entry.color || "#2F80ED" }]}>
          {entry.avatarUrl ? (
            <Image source={{ uri: entry.avatarUrl }} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={styles.entranceInitial}>
              {(entry.name || "S").charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.entranceBody}>
          <View style={styles.entranceNameRow}>
            <View style={[styles.entranceLevelPill, isHost && styles.entranceLevelPillHost]}>
              <Text style={[styles.entranceLevelText, isHost && styles.entranceLevelTextHost]}>
                {isHost ? "HOST" : `Lv.${level}`}
              </Text>
            </View>
            <Text style={styles.entranceName} numberOfLines={1}>
              {entry.name || "Sora kullanıcısı"}
            </Text>
          </View>
          <Text style={styles.entranceSub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.entranceSpark}>
          <Ionicons name={badgeIcon} size={17} color={badgeTint} />
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

// ── 4) Oda İçi Canlı Oyun Sonucu Kartı ───────────────────────────────────────
export const RoomGameResultBanner = memo(function RoomGameResultBanner({
  event,
  onDismiss,
  minimized = false,
}) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!event?.key || minimized) return undefined;
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      friction: 7,
      tension: 100,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      onDismissRef.current?.();
    }, 6000);
    return () => clearTimeout(timer);
  }, [anim, event?.key, minimized]);

  if (!event || minimized) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 0],
  });

  const accent =
    event.gameType === "dice"
      ? "#F6C86E"
      : event.gameType === "truth_dare"
        ? event.mode === "dare"
          ? "#FF6B93"
          : "#38BDF8"
        : "#A78BFA";

  const iconName =
    event.gameType === "dice"
      ? "dice"
      : event.gameType === "truth_dare"
        ? event.mode === "dare"
          ? "flame"
          : "chatbubble-ellipses"
        : "aperture";

  return (
    <Animated.View
      style={[
        styles.gameToastWrap,
        {
          top: insets.top + 114,
          opacity: anim,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.gameToastCard, { borderColor: `${accent}88` }]}>
        <View style={[styles.gameToastIcon, { backgroundColor: `${accent}24` }]}>
          <Ionicons name={iconName} size={18} color={accent} />
        </View>
        <View style={styles.gameToastBody}>
          <Text style={styles.gameToastMeta} numberOfLines={1}>
            {event.actorName || "Oyuncu"} · {event.title || "Mini Oyun"}
          </Text>
          <Text style={styles.gameToastResult} numberOfLines={3}>
            {event.summary}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          style={styles.gameToastClose}
          accessibilityRole="button"
          accessibilityLabel="Oyun sonucunu kapat"
        >
          <Ionicons name="close" size={15} color="#B7CBE4" />
        </Pressable>
      </View>
    </Animated.View>
  );
});

// ── 5) Oda İçi Mini Oyunlar Paneli (Zar / D-C / Şans Çarkı) ──────────────────
function DieFace({ value, rolling }) {
  const dots = DICE_DOTS[value] || DICE_DOTS[1];
  return (
    <View style={[styles.dieBox, rolling && styles.dieBoxRolling]}>
      <View style={styles.dieGrid}>
        {Array.from({ length: 9 }).map((_, idx) => (
          <View key={idx} style={styles.dieCell}>
            {dots.includes(idx) ? <View style={styles.diePip} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export const RoomMiniGamesSheet = memo(function RoomMiniGamesSheet({
  visible,
  participants = [],
  actorName = "Sora kullanıcısı",
  onBroadcastGame,
  onShareToChat,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState("dice"); // "dice" | "truth_dare" | "wheel"
  // Zar state
  const [diceCount, setDiceCount] = useState(2);
  const [diceValues, setDiceValues] = useState([6, 4]);
  const [diceRolling, setDiceRolling] = useState(false);
  // Doğruluk / Cesaret state
  const [tdMode, setTdMode] = useState("truth");
  const [tdPrompt, setTdPrompt] = useState(null);
  const [tdTarget, setTdTarget] = useState(null);
  const [pickSeatForTd, setPickSeatForTd] = useState(true);
  // Şans çarkı state
  const [wheelMode, setWheelMode] = useState("seat"); // "seat" | "topic"
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelDisplay, setWheelDisplay] = useState(null);
  const [wheelWinner, setWheelWinner] = useState(null);
  // Son paylaşılabilecek özet
  const [lastShareText, setLastShareText] = useState(null);
  const [sharedFeedback, setSharedFeedback] = useState(false);

  const timersRef = useRef([]);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!visible) {
      clearTimers();
      setDiceRolling(false);
      setWheelSpinning(false);
      setSharedFeedback(false);
    }
    return clearTimers;
  }, [clearTimers, visible]);

  const activeNames = useMemo(() => {
    const names = participants
      .map((p) => String(p?.name || "").trim())
      .filter(Boolean);
    return [...new Set(names)];
  }, [participants]);

  const rollDice = () => {
    if (diceRolling) return;
    clearTimers();
    setDiceRolling(true);
    setSharedFeedback(false);

    const steps = 8;
    for (let i = 0; i < steps; i += 1) {
      const timer = setTimeout(() => {
        const nextVals = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
        setDiceValues(nextVals);
        if (i === steps - 1) {
          setDiceRolling(false);
          const total = nextVals.reduce((acc, v) => acc + v, 0);
          let callout = "";
          if (diceCount === 2 && nextVals[0] === 6 && nextVals[1] === 6) callout = " · DÜŞEŞ!";
          else if (diceCount === 2 && nextVals[0] === 1 && nextVals[1] === 1) callout = " · HEP YEK!";
          else if (diceCount === 2 && nextVals[0] === nextVals[1]) callout = " · ÇİFT GELDİ!";
          const summary =
            diceCount === 2
              ? `🎲 ${nextVals[0]} + ${nextVals[1]} = ${total}${callout}`
              : `🎲 ${nextVals[0]} geldi!`;
          setLastShareText(`🎲 Zar attı: ${diceCount === 2 ? `${nextVals[0]} + ${nextVals[1]} = ${total}${callout}` : `${nextVals[0]}`}`);
          onBroadcastGame?.({
            gameType: "dice",
            title: diceCount === 2 ? "Çift Zar" : "Şans Zarı",
            summary,
          });
        }
      }, i * 75);
      timersRef.current.push(timer);
    }
  };

  const drawTruthOrDare = (requestedMode) => {
    setSharedFeedback(false);
    const chosenMode =
      requestedMode === "random"
        ? Math.random() < 0.5
          ? "truth"
          : "dare"
        : requestedMode;
    const pool = chosenMode === "dare" ? DARE_PROMPTS : TRUTH_PROMPTS;
    const prompt = pickRandom(pool, tdPrompt);
    const target = pickSeatForTd && activeNames.length > 0 ? pickRandom(activeNames) : null;
    setTdMode(chosenMode);
    setTdPrompt(prompt);
    setTdTarget(target);

    const modeLabel = chosenMode === "dare" ? "Cesaret" : "Doğruluk";
    const summary = target ? `Sıra ${target}: ${prompt}` : prompt;
    setLastShareText(`${chosenMode === "dare" ? "🔥" : "💬"} ${modeLabel}${target ? ` (${target})` : ""}: ${prompt}`);
    onBroadcastGame?.({
      gameType: "truth_dare",
      mode: chosenMode,
      title: modeLabel,
      summary,
    });
  };

  const spinWheel = () => {
    if (wheelSpinning) return;
    clearTimers();
    setSharedFeedback(false);

    const effectiveMode = wheelMode === "seat" && activeNames.length > 0 ? "seat" : "topic";
    const pool = effectiveMode === "seat" ? activeNames : WHEEL_TOPICS;
    const finalPick = pickRandom(pool, wheelWinner);
    setWheelSpinning(true);
    setWheelWinner(null);

    const ticks = 12;
    let elapsed = 0;
    for (let i = 0; i < ticks; i += 1) {
      elapsed += 55 + i * 16;
      const timer = setTimeout(() => {
        const isLast = i === ticks - 1;
        const val = isLast ? finalPick : pool[Math.floor(Math.random() * pool.length)];
        setWheelDisplay(val);
        if (isLast) {
          setWheelSpinning(false);
          setWheelWinner(finalPick);
          const title = effectiveMode === "seat" ? "Koltuk Çarkı" : "Konu Çarkı";
          const summary =
            effectiveMode === "seat"
              ? `🎯 Sıra ${finalPick} kişisinde!`
              : `🎯 Yeni sohbet konusu: ${finalPick}`;
          setLastShareText(summary);
          onBroadcastGame?.({
            gameType: "wheel",
            title,
            summary,
          });
        }
      }, elapsed);
      timersRef.current.push(timer);
    }
  };

  const handleShare = async () => {
    if (!lastShareText || !onShareToChat) return;
    const ok = await onShareToChat(lastShareText);
    if (ok !== false) {
      setSharedFeedback(true);
      const t = setTimeout(() => setSharedFeedback(false), 1800);
      timersRef.current.push(t);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetDismiss} onPress={onDismiss} accessibilityLabel="Kapat" />
        <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 14) + 12 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Oda Mini Oyunları</Text>
              <Text style={styles.sheetSubtitle}>
                Sonuçlar odadaki herkese canlı olarak görünür
              </Text>
            </View>
            <Pressable
              onPress={onDismiss}
              style={styles.sheetClose}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={18} color="#DCE8FA" />
            </Pressable>
          </View>

          <View style={styles.tabRow}>
            {[
              { id: "dice", label: "Şans Zarı", icon: "dice" },
              { id: "truth_dare", label: "Doğruluk / Cesaret", icon: "flame" },
              { id: "wheel", label: "Şans Çarkı", icon: "aperture" },
            ].map((item) => {
              const active = tab === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setTab(item.id);
                    setSharedFeedback(false);
                  }}
                  style={[styles.tabPill, active && styles.tabPillActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={item.icon}
                    size={15}
                    color={active ? "#FFFFFF" : "#9BB2D1"}
                  />
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {tab === "dice" ? (
              <View style={styles.gamePanel}>
                <View style={styles.segmentRow}>
                  {[1, 2].map((cnt) => (
                    <Pressable
                      key={cnt}
                      onPress={() => {
                        setDiceCount(cnt);
                        setDiceValues(cnt === 2 ? [6, 4] : [6]);
                      }}
                      style={[styles.segmentBtn, diceCount === cnt && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentText, diceCount === cnt && styles.segmentTextActive]}>
                        {cnt === 1 ? "Tek Zar (1–6)" : "Çift Zar (2–12)"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.diceStage}>
                  {diceValues.slice(0, diceCount).map((val, idx) => (
                    <DieFace key={idx} value={val} rolling={diceRolling} />
                  ))}
                </View>

                <Text style={styles.diceTotalText}>
                  {diceRolling
                    ? "Zarlar dönüyor..."
                    : diceCount === 2
                      ? `Toplam: ${diceValues[0] + (diceValues[1] || 0)}`
                      : `Sonuç: ${diceValues[0]}`}
                </Text>

                <Pressable
                  onPress={rollDice}
                  disabled={diceRolling}
                  style={[styles.primaryCta, diceRolling && styles.ctaDisabled]}
                >
                  <Ionicons name="dice" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryCtaText}>
                    {diceRolling ? "Atılıyor..." : "Zar At"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {tab === "truth_dare" ? (
              <View style={styles.gamePanel}>
                <Pressable
                  onPress={() => setPickSeatForTd((v) => !v)}
                  style={styles.toggleRow}
                >
                  <Ionicons
                    name={pickSeatForTd ? "checkbox" : "square-outline"}
                    size={18}
                    color={pickSeatForTd ? "#5EA2FF" : "#8FA6C4"}
                  />
                  <Text style={styles.toggleLabel}>
                    Odadan rastgele kişi seç ({activeNames.length} katılımcı)
                  </Text>
                </Pressable>

                <View style={styles.tdCard}>
                  {tdPrompt ? (
                    <>
                      <View style={styles.tdHeaderRow}>
                        <View
                          style={[
                            styles.tdBadge,
                            tdMode === "dare" ? styles.tdBadgeDare : styles.tdBadgeTruth,
                          ]}
                        >
                          <Text style={styles.tdBadgeText}>
                            {tdMode === "dare" ? "CESARET" : "DOĞRULUK"}
                          </Text>
                        </View>
                        {tdTarget ? (
                          <Text style={styles.tdTargetText} numberOfLines={1}>
                            Sıra: {tdTarget}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.tdPromptText}>{tdPrompt}</Text>
                    </>
                  ) : (
                    <Text style={styles.tdPlaceholder}>
                      Doğruluk veya Cesaret seçerek odaya eğlenceli bir görev aç.
                    </Text>
                  )}
                </View>

                <View style={styles.tdActions}>
                  <Pressable
                    onPress={() => drawTruthOrDare("truth")}
                    style={[styles.tdBtn, styles.tdBtnTruth]}
                  >
                    <Ionicons name="chatbubble-ellipses" size={16} color="#FFFFFF" />
                    <Text style={styles.tdBtnText}>Doğruluk</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => drawTruthOrDare("dare")}
                    style={[styles.tdBtn, styles.tdBtnDare]}
                  >
                    <Ionicons name="flame" size={16} color="#FFFFFF" />
                    <Text style={styles.tdBtnText}>Cesaret</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => drawTruthOrDare("random")}
                    style={[styles.tdBtn, styles.tdBtnRandom]}
                  >
                    <Ionicons name="shuffle" size={16} color="#FFFFFF" />
                    <Text style={styles.tdBtnText}>Şans</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {tab === "wheel" ? (
              <View style={styles.gamePanel}>
                <View style={styles.segmentRow}>
                  <Pressable
                    onPress={() => setWheelMode("seat")}
                    style={[styles.segmentBtn, wheelMode === "seat" && styles.segmentBtnActive]}
                  >
                    <Text style={[styles.segmentText, wheelMode === "seat" && styles.segmentTextActive]}>
                      Kişi Seç ({activeNames.length})
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setWheelMode("topic")}
                    style={[styles.segmentBtn, wheelMode === "topic" && styles.segmentBtnActive]}
                  >
                    <Text style={[styles.segmentText, wheelMode === "topic" && styles.segmentTextActive]}>
                      Sohbet Konusu
                    </Text>
                  </Pressable>
                </View>

                <View style={[styles.wheelStage, wheelWinner && styles.wheelStageWinner]}>
                  <Ionicons
                    name={wheelMode === "seat" && activeNames.length > 0 ? "person-circle" : "sparkles"}
                    size={28}
                    color={wheelWinner ? "#F6C86E" : "#7CB3FF"}
                  />
                  <Text style={styles.wheelValue} numberOfLines={2}>
                    {wheelDisplay
                      ? wheelDisplay
                      : wheelMode === "seat" && activeNames.length > 0
                        ? "Çarkı çevir, sıradaki kişiyi seç"
                        : "Çarkı çevir, sohbete yeni konu bul"}
                  </Text>
                  {wheelWinner ? (
                    <Text style={styles.wheelWinnerLabel}>Seçilen sonuç odaya yayınlandı</Text>
                  ) : null}
                </View>

                <Pressable
                  onPress={spinWheel}
                  disabled={wheelSpinning}
                  style={[styles.primaryCta, styles.wheelCta, wheelSpinning && styles.ctaDisabled]}
                >
                  <Ionicons name="aperture" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryCtaText}>
                    {wheelSpinning ? "Çark dönüyor..." : "Çarkı Çevir"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {lastShareText && onShareToChat ? (
              <Pressable
                onPress={handleShare}
                style={[styles.shareChatBtn, sharedFeedback && styles.shareChatBtnDone]}
              >
                <Ionicons
                  name={sharedFeedback ? "checkmark-circle" : "send"}
                  size={15}
                  color={sharedFeedback ? "#86EFAC" : "#93C5FD"}
                />
                <Text style={styles.shareChatText}>
                  {sharedFeedback
                    ? "Sohbete paylaşıldı"
                    : `${actorName} olarak sohbete de yaz`}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  floatingLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 35,
    elevation: 14,
  },
  floatingBubbleWrap: {
    position: "absolute",
    alignItems: "center",
  },
  floatingBubbleOrb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(12, 22, 42, 0.72)",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingBubbleEmoji: {
    fontSize: 23,
  },
  floatingSenderChip: {
    marginTop: 2,
    maxWidth: 88,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    backgroundColor: "rgba(8, 14, 26, 0.78)",
  },
  floatingSenderText: {
    color: "#E2EEFF",
    fontSize: 10,
    fontWeight: "600",
  },

  dockRoot: {
    position: "absolute",
    right: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    zIndex: 28,
    elevation: 12,
  },
  dockColumn: {
    gap: 8,
    alignItems: "center",
  },
  dockButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  dockGameButton: {
    backgroundColor: "rgba(24, 38, 68, 0.88)",
    borderColor: "rgba(246, 200, 110, 0.45)",
  },
  dockReactionButton: {
    backgroundColor: "rgba(24, 38, 68, 0.88)",
    borderColor: "rgba(255, 107, 147, 0.5)",
  },
  dockReactionButtonOpen: {
    backgroundColor: COLORS.primary,
    borderColor: "rgba(186, 230, 253, 0.75)",
  },
  dockButtonPressed: {
    transform: [{ scale: 0.92 }],
  },
  reactionTray: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(11, 20, 38, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(124, 179, 255, 0.35)",
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginRight: 8,
    gap: 2,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  reactionTrayItem: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionTrayItemPressed: {
    backgroundColor: "rgba(255,255,255,0.14)",
    transform: [{ scale: 1.18 }],
  },
  reactionTrayEmoji: {
    fontSize: 20,
  },

  entranceWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 45,
    elevation: 18,
  },
  entranceCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(186, 230, 253, 0.45)",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  entranceCardHost: {
    borderColor: "rgba(255, 237, 179, 0.8)",
  },
  entranceCardVip: {
    borderColor: "rgba(216, 180, 254, 0.75)",
  },
  entranceAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
  },
  entranceInitial: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
  entranceBody: {
    flex: 1,
    marginLeft: 10,
  },
  entranceNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  entranceLevelPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    backgroundColor: "rgba(8, 16, 32, 0.45)",
  },
  entranceLevelPillHost: {
    backgroundColor: "rgba(38, 22, 4, 0.55)",
  },
  entranceLevelText: {
    color: "#E0F2FE",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  entranceLevelTextHost: {
    color: "#FEF08A",
  },
  entranceName: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  entranceSub: {
    color: "rgba(241, 245, 255, 0.88)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  entranceSpark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },

  gameToastWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 44,
    elevation: 17,
  },
  gameToastCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(12, 22, 40, 0.94)",
    borderRadius: 16,
    borderWidth: 1.2,
    paddingVertical: 10,
    paddingHorizontal: 11,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  gameToastIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  gameToastBody: {
    flex: 1,
    marginHorizontal: 10,
  },
  gameToastMeta: {
    color: "#9BB8DE",
    fontSize: 11,
    fontWeight: "700",
  },
  gameToastResult: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
    lineHeight: 18,
  },
  gameToastClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(4, 10, 20, 0.65)",
    justifyContent: "flex-end",
  },
  sheetDismiss: {
    flex: 1,
  },
  sheetCard: {
    backgroundColor: "#0F1B2E",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(124, 179, 255, 0.22)",
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "78%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148, 176, 212, 0.35)",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  sheetSubtitle: {
    color: "#93AECB",
    fontSize: 12,
    marginTop: 2,
  },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  tabPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 5,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  tabPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: "rgba(186, 230, 253, 0.5)",
  },
  tabLabel: {
    color: "#9BB2D1",
    fontSize: 10.5,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: "#FFFFFF",
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  gamePanel: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 184, 230, 0.14)",
    padding: 14,
    gap: 14,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  segmentBtnActive: {
    backgroundColor: "rgba(47, 128, 237, 0.28)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.7)",
  },
  segmentText: {
    color: "#9DB4D4",
    fontSize: 12,
    fontWeight: "700",
  },
  segmentTextActive: {
    color: "#FFFFFF",
  },
  diceStage: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    paddingVertical: 10,
  },
  dieBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderWidth: 2,
    borderColor: "#CBD5E1",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dieBoxRolling: {
    borderColor: "#F6C86E",
    transform: [{ rotate: "-6deg" }, { scale: 1.04 }],
  },
  dieGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dieCell: {
    width: "33.333%",
    height: "33.333%",
    alignItems: "center",
    justifyContent: "center",
  },
  diePip: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#0F172A",
  },
  diceTotalText: {
    textAlign: "center",
    color: "#E2EEFF",
    fontSize: 14,
    fontWeight: "700",
  },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 13,
  },
  wheelCta: {
    backgroundColor: "#6D28D9",
  },
  ctaDisabled: {
    opacity: 0.65,
  },
  primaryCtaText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    color: "#C5D8F0",
    fontSize: 12.5,
    fontWeight: "600",
  },
  tdCard: {
    minHeight: 110,
    borderRadius: 16,
    backgroundColor: "rgba(9, 17, 32, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(124, 179, 255, 0.22)",
    padding: 14,
    justifyContent: "center",
  },
  tdHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  },
  tdBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tdBadgeTruth: {
    backgroundColor: "rgba(56, 189, 248, 0.22)",
  },
  tdBadgeDare: {
    backgroundColor: "rgba(255, 107, 147, 0.24)",
  },
  tdBadgeText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tdTargetText: {
    flex: 1,
    textAlign: "right",
    color: "#F6C86E",
    fontSize: 12,
    fontWeight: "700",
  },
  tdPromptText: {
    color: "#F8FAFC",
    fontSize: 14.5,
    fontWeight: "700",
    lineHeight: 21,
  },
  tdPlaceholder: {
    color: "#8EA9CB",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  tdActions: {
    flexDirection: "row",
    gap: 8,
  },
  tdBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 12,
    borderRadius: 13,
  },
  tdBtnTruth: {
    backgroundColor: "#0284C7",
  },
  tdBtnDare: {
    backgroundColor: "#E11D48",
  },
  tdBtnRandom: {
    backgroundColor: "#4F46E5",
  },
  tdBtnText: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "800",
  },
  wheelStage: {
    minHeight: 112,
    borderRadius: 16,
    backgroundColor: "rgba(9, 17, 32, 0.78)",
    borderWidth: 1.5,
    borderColor: "rgba(124, 179, 255, 0.24)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  wheelStageWinner: {
    borderColor: "rgba(246, 200, 110, 0.8)",
    backgroundColor: "rgba(42, 30, 14, 0.45)",
  },
  wheelValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  wheelWinnerLabel: {
    color: "#F6C86E",
    fontSize: 11,
    fontWeight: "700",
  },
  shareChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: "rgba(47, 128, 237, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
  },
  shareChatBtnDone: {
    backgroundColor: "rgba(22, 163, 74, 0.2)",
    borderColor: "rgba(134, 239, 172, 0.45)",
  },
  shareChatText: {
    color: "#DBEAFE",
    fontSize: 12.5,
    fontWeight: "700",
  },
});
