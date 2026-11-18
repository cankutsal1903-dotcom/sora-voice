import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  memo,
} from "react";
import {
  Alert,
  Animated,
  ActivityIndicator,
  AppState,
  BackHandler,
  Dimensions,
  Easing,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  FlatList,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AudioModule } from "expo-audio";
import * as Notifications from "expo-notifications";
import { useLiveVoiceRoom } from "./src/voice/useLiveVoiceRoom";
import { AuthScreen } from "./src/auth/AuthScreen";
import { AccountSecuritySheet } from "./src/auth/AccountSecuritySheet";
import { PasswordResetSheet } from "./src/auth/PasswordResetSheet";
import {
  completeAuthRedirect,
  deleteCurrentAccount,
  isHandleAvailable,
  isSupabaseConfigured,
  requestPasswordReset,
  supabase,
  updatePassword,
} from "./src/auth/supabase";
import {
  DAILY_REWARD_COINS,
  claimDailyReward as claimRemoteDailyReward,
  claimSelfGiftBlast,
  computeUserLevelProgress,
  createRoom as createRemoteRoom,
  deactivateStaleHostedRooms,
  deleteRoom as deleteRemoteRoom,
  evenLevelCoinReward,
  getHostedRoom,
  getMyActiveSanction,
  getMyFamily,
  getPublicProfile,
  getRoom,
  getCurrentAdminRole,
  getWallet,
  joinRoomMembership,
  listBlockedUsers,
  listFollowedProfiles,
  listFollowedUserIds,
  getFollowCounts,
  listRoomMembers,
  listRoomMessages,
  listRooms,
  listUserLevelRewardClaims,
  listWalletTransactions,
  sendRoomGift,
  listRoomGiftCatalog,
  listProfileItems,
  purchaseProfileItem,
  activateProfileItem,
  sendRoomMessage,
  setFollowing,
  setRoomHandRaise,
  setUserBlocked,
  startScheduledRoom as startRemoteScheduledRoom,
  setRoomPresence as setRemoteRoomPresence,
  syncMyUserLevel,
  updateRoom as updateRemoteRoom,
} from "./src/data/soraRepository";
import {
  AdminPanelSheet,
  ReportSheet,
  SafetyCenterSheet as SecureSafetyCenterSheet,
} from "./src/security/SafetySheets";
import { createMessageGuard } from "./src/security/contentFilter";
import { moderateLiveParticipant } from "./src/voice/roomModeration";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  COUPLE_SEAT_INDEX,
  DEFAULT_ROOM_ANNOUNCEMENT,
  FIRST_REGULAR_SEAT_INDEX,
  ROOM_BAN_DURATIONS,
  banRoomMember,
  clearRoomBackground,
  deleteRoomMusic,
  describeRoomError,
  getBackgroundUploadsEnabled,
  getLatestBackgroundRequest,
  getSignedRoomFileUrl,
  joinRoomWithPassword,
  leaveRoomMembership,
  listRoomMusic,
  musicTitleFromPath,
  performSeatAction,
  setRoomMusic,
  setRoomPassword,
  updateRoomDetails,
  updateRoomLayout,
  uploadRoomBackground,
  uploadRoomMusic,
  uploadProfileAvatar,
  removeProfileAvatar,
} from "./src/room/roomApi";
import {
  BanDurationSheet,
  MicRequestsSheet,
  RoomAdminsSheet,
  RoomLockSheet,
  RoomMenuSheet,
  RoomMusicSheet,
  RoomPasswordPrompt,
  RoomSeatsSheet,
  RoomSettingsEditorSheet,
  useRequestsFromMembers,
} from "./src/room/RoomOwnerSheets";
import { useRoomMusic } from "./src/room/useRoomMusic";
import {
  configureNotificationChannel,
  registerPushToken,
  unregisterPushToken,
} from "./src/notifications/pushTokenManager";
import {
  cancelReminder,
  clearAllReminders,
  scheduleReminder,
} from "./src/notifications/localReminders";
import { AudioBars, BrandLaunch, LivePulse, Reveal, useReducedMotion } from "./src/ui/Motion";
import { installGlobalErrorReporting } from "./src/observability/errorReporting";
import { InboxScreen } from "./src/screens/InboxScreen";
import { CommunityScreen } from "./src/screens/CommunityScreen";
import { COLORS as APP_COLORS } from "./src/theme/colors";
import {
  DEFAULT_GIFT_CATALOG,
  GIFT_CATEGORIES,
  LEVEL_BADGE_TIERS,
  SoraAchievementBadge,
  SoraGiftArtwork,
  SoraLevelCrest,
  getBadgeTierConfigForLevel,
} from "./src/ui/SoraGiftArtwork";
import { SoraGiftEffect } from "./src/ui/SoraGiftEffect";
import { GiftComboButton } from "./src/ui/GiftComboButton";
import { KeyboardSafeView, useKeyboardInset } from "./src/ui/useKeyboardInset";

const formatCredits = (value) =>
  new Intl.NumberFormat("tr-TR").format(Math.max(0, Math.floor(Number(value) || 0)));

const COLORS = APP_COLORS;

const BRAND_GRADIENT = COLORS.gradients.primary;
// Kartlarda kullanilan yumusak derinlik golgesi (Android'de elevation).
const ELEVATION = {
  card: {
    shadowColor: COLORS.text,
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: COLORS.text,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
};

const SORA_LOGO = require("./assets/images/sora-logo-blue.png");

installGlobalErrorReporting();

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let notificationDispatcher;

const mergeRoomMessages = (currentMessages, incomingMessages) => {
  const messagesById = new Map(currentMessages.map((item) => [item.id, item]));
  incomingMessages.forEach((item) =>
    messagesById.set(item.id, { ...messagesById.get(item.id), ...item }),
  );
  return [...messagesById.values()]
    .sort(
      (first, second) =>
        new Date(first.createdAt || 0).getTime() -
        new Date(second.createdAt || 0).getTime(),
    )
    .slice(-100);
};

const parseScheduledDate = (value) => {
  const input = value.trim().toLocaleLowerCase("tr-TR");
  const clock = input.match(/(\d{1,2}):(\d{2})$/);
  if (!clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;

  const now = new Date();
  const date = new Date(now);
  date.setSeconds(0, 0);
  if (input.startsWith("bugun ") || input.startsWith("bugün ")) {
    date.setHours(hours, minutes, 0, 0);
  } else if (input.startsWith("yarin ") || input.startsWith("yarın ")) {
    date.setDate(date.getDate() + 1);
    date.setHours(hours, minutes, 0, 0);
  } else {
    const dateMatch = input.match(
      /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?\s+\d{1,2}:\d{2}$/,
    );
    if (!dateMatch) return null;
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    date.setFullYear(year, month, day);
    date.setHours(hours, minutes, 0, 0);
    if (!dateMatch[3] && date <= now) date.setFullYear(year + 1);
  }

  return date > now ? date : null;
};

const formatScheduledDate = (date) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

const INITIAL_ROOMS = [
  {
    id: "night",
    title: "Gece Vardiyasi",
    category: "Gece",
    listeners: 128,
    host: "Ece",
    initials: "E",
    colors: ["#345D9C", "#172B49"],
    accent: "#8BB8F5",
    description: "Uykusu kaçanlar için sakin bir köşe.",
  },
  {
    id: "music",
    title: "Bir Sarki Birak",
    category: "Muzik",
    listeners: 86,
    host: "Baran",
    initials: "B",
    colors: ["#1D6EA8", "#173B6C"],
    accent: "#8CC8FF",
    description: "Mikrofon sende, sahne senin.",
  },
  {
    id: "talk",
    title: "Gunluk Muhabbet",
    category: "Sohbet",
    listeners: 54,
    host: "Duru",
    initials: "D",
    colors: ["#2B6095", "#203C60"],
    accent: "#A6C9F5",
    description: "Gunun nasil gecti?",
  },
  {
    id: "game",
    title: "Okey Masasi",
    category: "Oyun",
    listeners: 41,
    host: "Mert",
    initials: "M",
    colors: ["#405F8D", "#1D3455"],
    accent: "#9ABCF0",
    description: "Dorduncu aranıyor.",
  },
  {
    id: "ideas",
    title: "Fikir Kulubu",
    category: "Sohbet",
    listeners: 27,
    host: "Selin",
    initials: "S",
    colors: ["#4D72B5", "#203E70"],
    accent: "#A4CCFF",
    description: "Bugunun sorusu: Mutluluk ne?",
  },
];

const CATEGORIES = [
  { name: "Tumu", label: "Tümü", icon: "apps-outline" },
  { name: "Sohbet", label: "Sohbet", icon: "chatbubbles-outline" },
  { name: "Muzik", label: "Müzik", icon: "musical-notes-outline" },
  { name: "Oyun", label: "Oyun", icon: "game-controller-outline" },
  { name: "Gece", label: "Gece", icon: "moon-outline" },
];

const formatCategoryLabel = (value) => {
  if (value === "Muzik") return "Müzik";
  if (value === "Tumu") return "Tümü";
  return value || "Sohbet";
};

const DEFAULT_COMMUNITIES = [
  {
    id: "night-club",
    name: "Gece Kulubu",
    description: "Gece sohbetleri ve sakin odalar",
    members: "4,2 B uye",
    color: ["#3979D2", "#1D3D70"],
    icon: "moon",
  },
  {
    id: "music-club",
    name: "Sarkini Birak",
    description: "Yeni sesler ve ortak listeler",
    members: "1,8 B uye",
    color: ["#2F80ED", "#1C477E"],
    icon: "musical-notes",
  },
];
const COMMUNITY_COLORS = [
  ["#3979D2", "#1D3D70"],
  ["#2F80ED", "#1C477E"],
  ["#628FD2", "#263F68"],
  ["#244F8F", "#172E4E"],
];
const ROOM_THEMES = [
  { name: "Orman", colors: ["#2B6095", "#203C60"], accent: "#A6C9F5" },
  { name: "Gece", colors: ["#254777", "#111F36"], accent: "#8BB8F5" },
  { name: "Okyanus", colors: ["#1D6EA8", "#173B6C"], accent: "#8CC8FF" },
  { name: "Gul", colors: ["#405F8D", "#1D3455"], accent: "#9ABCF0" },
];
const ROOM_THEME_COLOR_SET = new Set(
  ROOM_THEMES.flatMap((theme) => [...theme.colors, theme.accent]).map((color) => color.toUpperCase()),
);
const resolveRoomBrand = (room = {}) => {
  const seed = String(room.id || room.title || room.name || "sora");
  const themeIndex = [...seed].reduce((value, char) => value + char.charCodeAt(0), 0) % ROOM_THEMES.length;
  const fallback = ROOM_THEMES[themeIndex];
  const colors = Array.isArray(room.colors)
    && room.colors.length >= 2
    && room.colors.every((color) => ROOM_THEME_COLOR_SET.has(String(color).toUpperCase()))
    ? room.colors
    : fallback.colors;
  const accent = ROOM_THEME_COLOR_SET.has(String(room.accent || "").toUpperCase())
    ? room.accent
    : fallback.accent;
  return { colors, accent };
};

const GIFT_CATALOG = DEFAULT_GIFT_CATALOG;
const createRequestUuid = () => {
  return globalThis.crypto?.randomUUID?.() || `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const PROFILE_ITEM_APPEARANCE = {
  frame_sky: { color: "#58A0F0", accent: "#DFF4FF", width: 3, style: "halo", frameScale: 1.46, asset: require("./assets/frames/frame_sky.png") },
  frame_amber: { color: "#2F80ED", accent: "#F5C76B", width: 3, style: "gem", frameScale: 1.53, asset: require("./assets/frames/frame_amber.png") },
  frame_lilac: { color: "#7C9ED4", accent: "#E7D9FF", width: 3, style: "orbit", frameScale: 1.49, asset: require("./assets/frames/frame_lilac.png") },
  frame_family_silver: { color: "#4C9AFF", accent: "#E7F5FF", width: 3.5, style: "crown", frameScale: 1.45, asset: require("./assets/frames/frame_family_silver.png") },
  frame_family_royal: { color: "#1D5FBF", accent: "#FFD978", width: 4, style: "royal", frameScale: 1.52, asset: require("./assets/frames/frame_family_royal.png") },
  frame_flame: { color: "#F04B24", accent: "#FFD166", width: 4, style: "flame", frameScale: 1.66, animated: true, asset: require("./assets/frames/frame_flame.png") },
  theme_ocean: { background: "#E7F2FF", accent: "#258FB8" },
  theme_midnight: { background: "#E8EEF8", accent: "#315FAD" },
  theme_sunrise: { background: "#F2F7FD", accent: "#5388CB" },
};

const ProfileFrame = memo(function ProfileFrame({ appearance, size, children, style }) {
  const reducedMotion = useReducedMotion();
  const phase = useRef(new Animated.Value(0)).current;
  const styleKey = appearance?.style || null;
  useEffect(() => {
    phase.setValue(0);
    if (!appearance || reducedMotion) return undefined;
    const duration =
      styleKey === "flame"
        ? 720
        : styleKey === "gem"
          ? 1950
          : styleKey === "royal"
            ? 2000
            : styleKey === "crown"
              ? 2200
              : styleKey === "orbit"
                ? 2600
                : 2300;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(phase, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [appearance, phase, reducedMotion, styleKey]);

  if (!appearance) return <View style={style}>{children}</View>;
  const frameSize = Math.round(size * (appearance.frameScale || 1.48));
  const offset = (size - frameSize) / 2;
  const animatedTransform = reducedMotion
    ? []
    : styleKey === "flame"
      ? [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.968, 1.048] }) }]
      : styleKey === "orbit"
        ? [
            { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.028] }) },
            { rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ["-4.5deg", "4.5deg"] }) },
          ]
        : styleKey === "gem"
          ? [
              { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.988, 1.032] }) },
              { rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ["-1.5deg", "1.5deg"] }) },
            ]
          : styleKey === "crown" || styleKey === "royal"
            ? [
                { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.988, 1.034] }) },
                { translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [0.8, -1.4] }) },
              ]
            : [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.028] }) }];
  const animatedOpacity = reducedMotion
    ? 1
    : styleKey === "flame"
      ? phase.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })
      : phase.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <View style={[{ alignItems: "center", justifyContent: "center", overflow: "visible" }, style]}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", overflow: "visible" }}>
        {children}
        {appearance.asset ? (
          <Animated.Image
            pointerEvents="none"
            source={appearance.asset}
            resizeMode="contain"
            style={{
              position: "absolute",
              width: frameSize,
              height: frameSize,
              left: offset,
              top: offset,
              opacity: animatedOpacity,
              transform: animatedTransform,
            }}
          />
        ) : (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              width: size + 10,
              height: size + 10,
              left: -5,
              top: -5,
              borderRadius: (size + 10) / 2,
              borderWidth: appearance.width || 3,
              borderColor: appearance.color,
            }}
          />
        )}
      </View>
    </View>
  );
});
const DEFAULT_CHATS = [
  {
    id: "ece",
    name: "Ece",
    text: "Bu gece yine buradayiz.",
    time: "21:42",
    color: "#5F96DF",
    unread: 2,
  },
  {
    id: "duru",
    name: "Duru",
    text: "Odayi sevdin mi?",
    time: "19:18",
    color: "#2F80ED",
  },
  {
    id: "sora",
    name: "Sora Ekibi",
    text: "Topluluk kurallari yenilendi.",
    time: "Dun",
    color: "#739DDC",
    system: true,
  },
];
const CHAT_COLORS = ["#5F96DF", "#2F80ED", "#739DDC", "#7FCBEA", "#254F8A"];

const Avatar = memo(function Avatar({
  label,
  color = "#5F96DF",
  size = 42,
  bordered = false,
  circle = false,
  uri = null,
}) {
  return (
    <View
      style={[
        styles.avatar,
        uri ? { overflow: "hidden" } : null,
        {
          width: size,
          height: size,
          borderRadius: circle ? size / 2 : size * 0.34,
          backgroundColor: color,
        },
        bordered && styles.avatarBorder,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>
          {label}
        </Text>
      )}
    </View>
  );
});

const IconButton = memo(function IconButton({
  icon,
  onPress,
  badge = false,
  subtle = false,
  accessibilityLabel,
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || icon}
      hitSlop={8}
      style={[styles.iconButton, subtle && styles.iconButtonSubtle]}
    >
      <Ionicons name={icon} size={20} color={COLORS.text} />
      {badge && <View style={styles.iconBadge} />}
    </Pressable>
  );
});

const NotificationCenter = memo(function NotificationCenter({
  visible,
  notifications,
  onDismiss,
  onClear,
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.notificationOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={styles.notificationSheet}>
          <View style={styles.notificationHeader}>
            <View>
              <Text style={styles.notificationTitle}>Bildirimler</Text>
              <Text style={styles.notificationSubtitle}>
                {notifications.length
                  ? `${notifications.length} yeni gelişme var`
                  : "Her şey yakalandı"}
              </Text>
            </View>
            <Pressable onPress={notifications.length ? onClear : onDismiss}>
              <Text style={styles.notificationClear}>
                {notifications.length ? "Temizle" : "Kapat"}
              </Text>
            </Pressable>
          </View>
          {notifications.length ? (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.notificationRow}>
                  <View
                    style={[
                      styles.notificationIcon,
                      { backgroundColor: item.color },
                    ]}
                  >
                    <Ionicons name={item.icon} size={16} color="#fff" />
                  </View>
                  <View style={styles.notificationText}>
                    <Text style={styles.notificationMessage}>{item.text}</Text>
                    <Text style={styles.notificationTime}>{item.time}</Text>
                  </View>
                </View>
              )}
              scrollEnabled={false}
              nestedScrollEnabled={false}
              contentContainerStyle={styles.notificationList}
            />
          ) : (
            <View style={styles.notificationEmpty}>
              <Ionicons
                name="notifications-off-outline"
                size={28}
                color={COLORS.muted}
              />
              <Text style={styles.notificationEmptyText}>
                Yeni bildirimin yok.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
});

function Onboarding({ visible, onComplete }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slides = [
    {
      icon: "radio-outline",
      kicker: "SORA'YA HOŞ GELDİN",
      title: "Sesinle bağlan.",
      copy: "Sakin sohbetlerden kalabalık topluluklara, sana iyi gelen odayı bul.",
    },
    {
      icon: "people-outline",
      kicker: "BİRLİKTE DİNLE",
      title: "Kendi çevreni kur.",
      copy: "Sevdiğin konuşmacıları takip et, odalarını planla ve tekrar bir araya gel.",
    },
    {
      icon: "sparkles-outline",
      kicker: "HAZIRSIN",
      title: "İlk odan seni bekliyor.",
      copy: "Mikrofonun hazır olduğunda sahneye çıkabilir veya sadece dinleyebilirsin.",
    },
  ];
  const slide = slides[slideIndex];
  const next = () => {
    if (slideIndex === slides.length - 1) {
      onComplete();
      return;
    }
    setSlideIndex((current) => current + 1);
  };
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onComplete}>
      <LinearGradient
        colors={["#111820", "#1D2E43"]}
        style={styles.onboardingScreen}
      >
        <SafeAreaView style={styles.onboardingSafe}>
          <Pressable
            onPress={onComplete}
            accessibilityRole="button"
            accessibilityLabel="Tanıtımı atla"
            style={styles.onboardingSkip}
          >
            <Text style={styles.onboardingSkipText}>Atla</Text>
          </Pressable>
          <Reveal key={slide.id || slideIndex} style={styles.onboardingContent}>
            <View style={styles.onboardingIcon}>
              {slideIndex === 0 ? (
                <Image
                  source={SORA_LOGO}
                  style={styles.onboardingLogo}
                  fadeDuration={0}
                  accessibilityLabel="Sora logosu"
                />
              ) : (
                <Ionicons name={slide.icon} size={46} color={COLORS.primary} />
              )}
            </View>
            <Text style={styles.onboardingKicker}>{slide.kicker}</Text>
            <Text style={styles.onboardingTitle}>{slide.title}</Text>
            <Text style={styles.onboardingCopy}>{slide.copy}</Text>
          </Reveal>
          <View style={styles.onboardingFooter}>
            <View
              style={styles.onboardingDots}
              accessibilityLabel={`${slideIndex + 1}. tanıtım ekranı`}
              accessibilityRole="progressbar"
            >
              {slides.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.onboardingDot,
                    index === slideIndex && styles.onboardingDotActive,
                  ]}
                />
              ))}
            </View>
            <Pressable
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={
                slideIndex === slides.length - 1
                  ? "Keşfete başla"
                  : "Sonraki tanıtım ekranı"
              }
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                style={styles.onboardingNext}
              >
                <Text style={styles.onboardingNextText}>
                  {slideIndex === slides.length - 1
                    ? "Keşfete başla"
                    : "Devam et"}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={19}
                  color={COLORS.primaryInk}
                />
              </LinearGradient>
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

function Discover({
  rooms,
  profile,
  favoriteRoomIds,
  recentRoomIds,
  notificationCount,
  currentUserId,
  onOpenNotifications,
  onOpenRoom,
  onCreate,
  onToggleFavorite,
}) {
  const [category, setCategory] = useState("Tumu");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const handleToggleSearch = useCallback(() => {
    setSearching((value) => !value);
    setQuery("");
  }, []);

  const handleCategoryChange = useCallback((categoryName) => {
    setCategory(categoryName);
  }, []);

  const handleToggleFavoritesFilter = useCallback(() => {
    setFavoritesOnly((value) => !value);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((room) => {
          const categoryMatches =
            category === "Tumu" || room.category === category;
          const queryMatches =
            !normalizedQuery ||
            room.title.toLowerCase().includes(normalizedQuery);
          const favoriteMatches =
            !favoritesOnly || favoriteRoomIds.includes(room.id);
          return categoryMatches && queryMatches && favoriteMatches;
        })
        .sort((firstRoom, secondRoom) => {
          const firstFavorite = favoriteRoomIds.includes(firstRoom.id) ? 1 : 0;
          const secondFavorite = favoriteRoomIds.includes(secondRoom.id)
            ? 1
            : 0;
          if (firstFavorite !== secondFavorite)
            return secondFavorite - firstFavorite;
          const firstRecentIndex = recentRoomIds.indexOf(firstRoom.id);
          const secondRecentIndex = recentRoomIds.indexOf(secondRoom.id);
          const firstRecent =
            firstRecentIndex === -1
              ? Number.MAX_SAFE_INTEGER
              : firstRecentIndex;
          const secondRecent =
            secondRecentIndex === -1
              ? Number.MAX_SAFE_INTEGER
              : secondRecentIndex;
          if (firstRecent !== secondRecent) return firstRecent - secondRecent;
          return secondRoom.listeners - firstRoom.listeners;
        }),
    [
      category,
      favoriteRoomIds,
      favoritesOnly,
      normalizedQuery,
      recentRoomIds,
      rooms,
    ],
  );

  const handleOpenRoom = useCallback(
    (room) => {
      console.warn("[room-entry] discover room pressed", Boolean(room?.id));
      onOpenRoom(room);
    },
    [onOpenRoom],
  );

  const handleToggleFav = useCallback(
    (roomId) => {
      onToggleFavorite(roomId);
    },
    [onToggleFavorite],
  );

  const featuredRoom = useMemo(
    () =>
      rooms.find((room) => favoriteRoomIds.includes(room.id)) ||
      rooms.find((room) => recentRoomIds.includes(room.id)) ||
      rooms[0],
    [favoriteRoomIds, recentRoomIds, rooms],
  );
  const featuredRoomBrand = resolveRoomBrand(featuredRoom);
  if (!featuredRoom) {
    return (
      <ScrollView
        key="empty"
        style={styles.discoverScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.pageContent}
      >
        <View style={styles.topBar}>
          <View style={styles.discoverHeadingCopy}>
            <Text style={styles.discoverEyebrow}>SORA · SESLİ SOHBET</Text>
            <Text style={styles.discoverHeading}>Keşfet</Text>
          </View>
          <IconButton
            icon="notifications-outline"
            accessibilityLabel="Bildirimleri aç"
            badge={notificationCount > 0}
            onPress={onOpenNotifications}
          />
        </View>
        <LinearGradient
          colors={["#111820", "#1D2E43"]}
          style={styles.discoverEmptyHero}
        >
          <View style={styles.discoverEmptyGlow} />
          <View style={styles.discoverEmptyArt}>
            <View style={styles.discoverEmptySeat}>
              <Ionicons name="mic-outline" size={25} color={COLORS.primary} />
            </View>
            <View
              style={[styles.discoverEmptySeat, styles.discoverEmptySeatSide]}
            >
              <Ionicons name="add" size={22} color={COLORS.textSecondary} />
            </View>
            <View
              style={[styles.discoverEmptySeat, styles.discoverEmptySeatSide]}
            >
              <Ionicons name="add" size={22} color={COLORS.textSecondary} />
            </View>
          </View>
          <View style={styles.discoverEmptyCopy}>
            <Text style={styles.discoverEmptyLabel}>SAHNE HAZIR</Text>
            <Text style={styles.discoverEmptyTitle}>İlk sesi sen başlat.</Text>
            <Text style={styles.discoverEmptyDescription}>
              Şu anda açık oda yok. Bir oda aç, sohbet başladığında burada
              görünsün.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yeni sesli oda aç"
            style={styles.discoverEmptyButton}
            onPress={onCreate}
          >
            <Text style={styles.discoverEmptyButtonText}>Oda aç</Text>
            <Ionicons
              name="arrow-forward"
              size={20}
              color={COLORS.primaryInk}
            />
          </Pressable>
        </LinearGradient>
        <View style={styles.discoverEmptyNote}>
          <Ionicons name="headset-outline" size={18} color={COLORS.primary} />
          <Text style={styles.discoverEmptyNoteText}>
            Odaya herkes dinleyici olarak katılabilir. Konuşmak isteyenler
            koltuğa geçer.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView
        key="rooms"
        style={styles.discoverScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
      >
        <Reveal distance={10}>
          <View style={styles.topBar}>
            <View style={styles.discoverHeadingCopy}>
              <Text style={styles.discoverEyebrow}>SORA · SESLİ SOHBET</Text>
              <Text style={styles.discoverHeading}>Keşfet</Text>
            </View>
            <View style={styles.topActions}>
              <IconButton
                icon={searching ? "close-outline" : "search-outline"}
                accessibilityLabel={searching ? "Oda aramayı kapat" : "Oda ara"}
                onPress={handleToggleSearch}
              />
              <IconButton
                icon="notifications-outline"
                accessibilityLabel="Bildirimleri aç"
                badge={notificationCount > 0}
                onPress={onOpenNotifications}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yeni sesli oda aç"
                onPress={onCreate}
                style={styles.discoverCreateButton}
              >
                <Ionicons name="add" size={23} color={COLORS.primaryInk} />
              </Pressable>
            </View>
          </View>
        </Reveal>

        {searching && (
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color={COLORS.primary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="Oda ara"
              placeholderTextColor={COLORS.muted}
              selectionColor={COLORS.primary}
              style={styles.searchInput}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
              >
                <Ionicons name="close-circle" size={17} color={COLORS.muted} />
              </Pressable>
            )}
          </View>
        )}

        <Reveal delay={50}>
          <Pressable
            onPress={() => handleOpenRoom(featuredRoom)}
            accessibilityRole="button"
            accessibilityLabel={`${featuredRoom.title} öne çıkan canlı odasını aç`}
            style={styles.featurePressable}
          >
            <LinearGradient
              colors={[...featuredRoomBrand.colors, "#111820"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.featureCardModern}
            >
              <View style={styles.featureGlowOne} />
              <View style={styles.featureGlowTwo} />
              <View style={styles.featureTop}>
                <View style={styles.featureLivePill}>
                  <LivePulse size={6} />
                  <Text style={styles.featureLiveLabel}>ŞİMDİ CANLI</Text>
                </View>
                <View style={styles.featureCategoryPill}>
                  <Ionicons name="headset-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.featureCategoryText}>
                    {formatCategoryLabel(featuredRoom.category)}
                  </Text>
                </View>
              </View>
              <View style={styles.featureModernContent}>
                <View>
                  <Text style={styles.featureTitle} numberOfLines={1}>
                    {featuredRoom.title}
                  </Text>
                  <Text style={styles.featureSubtitle} numberOfLines={2}>
                    {featuredRoom.description}
                  </Text>
                  <Text style={styles.featureListenerText}>
                    {featuredRoom.listeners} kişi odada
                  </Text>
                </View>
                <View style={styles.featureFooterModern}>
                  <View style={styles.featureHost}>
                    <Avatar
                      label={
                        featuredRoom.initials?.charAt(0) ||
                        featuredRoom.host.charAt(0)
                      }
                      color={featuredRoomBrand.accent}
                      size={30}
                    />
                    <View>
                      <Text style={styles.featureHostLabel}>SUNAN</Text>
                      <Text style={styles.featureHostName}>
                        {featuredRoom.host}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.featureJoinButton}>
                    <Ionicons
                      name="arrow-forward"
                      size={18}
                      color={COLORS.primaryInk}
                    />
                  </View>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        </Reveal>

        <Text style={styles.sectionTitle}>İlgini çeken sohbetler</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
          data={CATEGORIES}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleCategoryChange(item.name)}
              style={[
                styles.categoryChip,
                category === item.name && styles.categoryChipActive,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={
                  category === item.name ? COLORS.primaryInk : COLORS.muted
                }
              />
              <Text
                style={[
                  styles.categoryText,
                  category === item.name && styles.categoryTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
          scrollEnabled={true}
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={50}
        />

        <View style={styles.discoverListHeading}>
          <View>
            <Text style={[styles.sectionTitle, styles.discoverListTitle]}>
              {favoritesOnly ? "Favori odalar" : "Şimdi canlı"}
            </Text>
            <Text style={styles.listCount}>{visibleRooms.length} oda açık</Text>
          </View>
          <Pressable
            onPress={handleToggleFavoritesFilter}
            accessibilityRole="button"
            accessibilityState={{ selected: favoritesOnly }}
            accessibilityLabel="Favori odaları filtrele"
            style={[
              styles.favoriteFilter,
              favoritesOnly && styles.favoriteFilterActive,
            ]}
          >
            <Ionicons
              name={favoritesOnly ? "heart" : "heart-outline"}
              size={15}
              color={favoritesOnly ? COLORS.primaryInk : COLORS.primary}
            />
            <Text
              style={[
                styles.favoriteFilterText,
                favoritesOnly && styles.favoriteFilterTextActive,
              ]}
            >
              Favoriler
            </Text>
          </Pressable>
        </View>
        <View style={styles.roomGrid}>
          {visibleRooms.map((item, index) => (
            <RoomCard
              key={item.id}
              room={item}
              index={index}
              isFavorite={favoriteRoomIds.includes(item.id)}
              onPress={handleOpenRoom}
              onToggleFavorite={handleToggleFav}
            />
          ))}
        </View>
        {!visibleRooms.length && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="search-outline" size={25} color={COLORS.muted} />
            </View>
            <Text style={styles.emptyTitle}>Oda bulunamadı</Text>
            <Text style={styles.emptyDescription}>
              Farklı bir kategori veya arama deneyebilirsin.
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function ScheduleAgenda({
  visible,
  rooms,
  reminderRoomIds,
  currentUserId,
  onDismiss,
  onToggleReminder,
  onCancel,
  onStart,
  onPlan,
}) {
  const confirmCancel = (room) =>
    Alert.alert(
      "Planlı odayı iptal et?",
      `${room.title} ajandandan kaldırılacak.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "İptal et",
          style: "destructive",
          onPress: () => onCancel(room),
        },
      ],
    );
  const confirmStart = (room) =>
    Alert.alert("Odayı şimdi başlat?", `${room.title} canlı odaya dönüşecek.`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Başlat", onPress: () => onStart(room) },
    ]);
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, styles.agendaSheet]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>SENİN AJANDAN</Text>
          <Text style={styles.sheetTitle}>Yaklaşan odalar</Text>
          <Text style={styles.agendaSummary}>
            {reminderRoomIds.length
              ? `${reminderRoomIds.length} oda için hatırlatıcı açık.`
              : "Hatırlatmak istediklerini seç."}
          </Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.agendaList}
          >
            {rooms.map((room) => {
              const reminderActive = reminderRoomIds.includes(room.id);
              const canManageRoom = room.hostId
                ? room.hostId === currentUserId
                : room.userCreated;
              return (
                <View key={room.id} style={styles.agendaCard}>
                  <View style={styles.agendaCalendar}>
                    <Ionicons
                      name="calendar"
                      size={18}
                      color={COLORS.primary}
                    />
                  </View>
                  <View style={styles.agendaContent}>
                    <Text style={styles.agendaTitle} numberOfLines={1}>
                      {room.title}
                    </Text>
                    <Text style={styles.agendaMeta}>
                      {room.startsAt} · {room.host}
                    </Text>
                    <Text style={styles.agendaCategory}>{room.category}</Text>
                  </View>
                  <View style={styles.agendaActions}>
                    <Pressable
                      onPress={() => onToggleReminder(room.id)}
                      style={[
                        styles.agendaReminder,
                        reminderActive && styles.agendaReminderActive,
                      ]}
                    >
                      <Ionicons
                        name={
                          reminderActive
                            ? "notifications"
                            : "notifications-outline"
                        }
                        size={18}
                        color={
                          reminderActive ? COLORS.primaryInk : COLORS.primary
                        }
                      />
                    </Pressable>
                    {canManageRoom && (
                      <Pressable
                        onPress={() => confirmStart(room)}
                        style={[
                          styles.agendaReminder,
                          { backgroundColor: COLORS.primary },
                        ]}
                      >
                        <Ionicons
                          name="play"
                          size={15}
                          color={COLORS.primaryInk}
                        />
                      </Pressable>
                    )}
                    {canManageRoom && (
                      <Pressable
                        onPress={() => confirmCancel(room)}
                        style={styles.agendaCancel}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={COLORS.pink}
                        />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Pressable onPress={onPlan}>
            <LinearGradient colors={BRAND_GRADIENT} style={styles.createSubmit}>
              <Text style={styles.createSubmitText}>Yeni buluşma planla</Text>
              <Ionicons name="add" size={21} color={COLORS.primaryInk} />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const RoomCard = memo(function RoomCard({
  room,
  isFavorite,
  onPress,
  onToggleFavorite,
  index = 0,
}) {
  const roomBrand = resolveRoomBrand(room);
  const handlePress = useCallback(() => onPress(room), [onPress, room]);
  const handleToggle = useCallback(
    () => onToggleFavorite(room.id),
    [onToggleFavorite, room.id],
  );
  const revealDelay = useMemo(() => Math.min(index, 6) * 55, [index]);

  return (
    <Reveal delay={revealDelay} distance={12} style={styles.roomGridItem}>
      <View style={styles.roomCard}>
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={`${room.title} canlı odasını aç`}
          style={({ pressed }) => [
            styles.roomCardMain,
            pressed && styles.roomCardPressed,
          ]}
        >
          <LinearGradient
            colors={[...roomBrand.colors, "#111820"]}
            style={styles.roomArtwork}
          >
            <View
              style={[styles.roomArtworkOrb, { backgroundColor: roomBrand.accent }]}
            />
            <View style={styles.roomArtworkRing} />
            <View style={styles.roomArtworkTop}>
              <View style={styles.roomArtworkLive}>
                <LivePulse size={5} color={COLORS.primary} />
                <Text style={styles.roomArtworkLiveText}>CANLI</Text>
              </View>
              <View style={styles.roomArtworkCount}>
                <Ionicons name="people" size={12} color="#FFFFFF" />
                <Text style={styles.roomArtworkCountText}>
                  {room.listeners}
                </Text>
              </View>
            </View>
            <View style={styles.roomArtworkMonogram}>
              <Text style={styles.roomArtworkInitial}>
                {room.initials || room.title?.charAt(0) || "S"}
              </Text>
              <AudioBars color="rgba(255,255,255,0.78)" compact />
            </View>
            <Text style={styles.roomArtworkTitle} numberOfLines={2}>
              {room.passwordProtected ? (
                <Ionicons name="lock-closed" size={13} color="#FFFFFF" />
              ) : null}
              {room.passwordProtected ? " " : ""}
              {room.title}
            </Text>
          </LinearGradient>
          <View style={styles.roomDetails}>
            <View style={styles.roomHostRow}>
              <Avatar
                label={room.host?.charAt(0) || "S"}
                color={roomBrand.accent}
                size={25}
              />
              <Text style={styles.roomHostName} numberOfLines={1}>
                {room.host}
              </Text>
              <Ionicons name="arrow-forward" size={15} color={COLORS.primary} />
            </View>
            <Text style={styles.roomCategory}>{formatCategoryLabel(room.category)}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={handleToggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: isFavorite }}
          style={[
            styles.favoriteButton,
            isFavorite && styles.favoriteButtonActive,
          ]}
          accessibilityLabel={
            isFavorite
              ? `${room.title} favorilerden çıkar`
              : `${room.title} favorilere ekle`
          }
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={17}
            color={isFavorite ? COLORS.pink : "#FFFFFF"}
          />
        </Pressable>
      </View>
    </Reveal>
  );
});

function Inbox({ profile }) {
  const [query, setQuery] = useState("");
  const [selectedChat, setSelectedChat] = useState(null);
  const [draft, setDraft] = useState("");
  const [chatMessages, setChatMessages] = useState({});
  const [chats, setChats] = useState(SEEDED_CHATS);
  const [newChatOpen, setNewChatOpen] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem("@sora/custom-chats")
      .then((savedChats) => {
        const parsedChats = JSON.parse(savedChats || "[]");
        if (Array.isArray(parsedChats))
          setChats([...parsedChats, ...SEEDED_CHATS]);
      })
      .catch(() => undefined);
    AsyncStorage.getItem("@sora/chat-messages")
      .then((savedMessages) => {
        const parsedMessages = JSON.parse(savedMessages || "{}");
        if (parsedMessages && typeof parsedMessages === "object")
          setChatMessages(parsedMessages);
      })
      .catch(() => undefined);
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleChats = useMemo(
    () =>
      normalizedQuery
        ? chats.filter((chat) =>
            chat.name.toLowerCase().includes(normalizedQuery),
          )
        : chats,
    [chats, normalizedQuery],
  );
  const selectedMessages = useMemo(
    () =>
      selectedChat
        ? chatMessages[selectedChat.id] || [
            {
              id: "welcome",
              sender: selectedChat.name,
              text: selectedChat.text,
              own: false,
            },
          ]
        : [],
    [chatMessages, selectedChat],
  );
  const sendDirectMessage = () => {
    const text = draft.trim();
    if (!text || !selectedChat) return;
    setChatMessages((current) => {
      const nextMessages = {
        ...current,
        [selectedChat.id]: [
          ...(current[selectedChat.id] || [
            {
              id: "welcome",
              sender: selectedChat.name,
              text: selectedChat.text,
              own: false,
            },
          ]),
          { id: String(Date.now()), sender: profile.name, text, own: true },
        ],
      };
      AsyncStorage.setItem(
        "@sora/chat-messages",
        JSON.stringify(nextMessages),
      ).catch(() => undefined);
      return nextMessages;
    });
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === selectedChat.id
          ? { ...chat, text, time: "Simdi", unread: 0 }
          : chat,
      );
      AsyncStorage.setItem(
        "@sora/custom-chats",
        JSON.stringify(nextChats.filter((item) => item.id.startsWith("dm-"))),
      ).catch(() => undefined);
      return nextChats;
    });
    setDraft("");
  };

  const createChat = ({ name, message }) => {
    const chatId = `dm-${Date.now()}`;
    const chat = {
      id: chatId,
      name,
      text: message || "Yeni bir sohbete basla.",
      time: "Simdi",
      color: CHAT_COLORS[chats.length % CHAT_COLORS.length],
    };
    setChats((currentChats) => {
      const nextChats = [chat, ...currentChats];
      AsyncStorage.setItem(
        "@sora/custom-chats",
        JSON.stringify(nextChats.filter((item) => item.id.startsWith("dm-"))),
      ).catch(() => undefined);
      return nextChats;
    });
    if (message) {
      setChatMessages((currentMessages) => {
        const nextMessages = {
          ...currentMessages,
          [chatId]: [
            {
              id: `first-${chatId}`,
              sender: profile.name,
              text: message,
              own: true,
            },
          ],
        };
        AsyncStorage.setItem(
          "@sora/chat-messages",
          JSON.stringify(nextMessages),
        ).catch(() => undefined);
        return nextMessages;
      });
    }
    setNewChatOpen(false);
    setSelectedChat(chat);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.screenHeading}>
        <View>
          <Text style={styles.kicker}>MESAJLAR</Text>
          <Text style={styles.pageTitle}>Sohbetlerin</Text>
        </View>
        <IconButton
          icon="create-outline"
          onPress={() => setNewChatOpen(true)}
        />
        <NewMessageSheet
          visible={newChatOpen}
          onDismiss={() => setNewChatOpen(false)}
          onCreate={createChat}
        />
      </View>
      <View style={styles.inboxFilter}>
        <Ionicons name="search-outline" size={18} color={COLORS.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Sohbet ara"
          placeholderTextColor={COLORS.muted}
          style={styles.inboxSearchInput}
        />
      </View>
      <Text style={styles.inboxCaption}>{visibleChats.length} SOHBET</Text>
      <FlatList
        data={visibleChats}
        keyExtractor={(item) => item.id}
        renderItem={({ item: chat }) => (
          <Pressable
            style={styles.chatRow}
            onPress={() => setSelectedChat(chat)}
          >
            <Avatar
              label={chat.system ? "s" : chat.name[0]}
              color={chat.color}
              size={52}
            />
            <View style={styles.chatText}>
              <View style={styles.chatTop}>
                <Text style={styles.chatName}>{chat.name}</Text>
                <Text style={styles.chatTime}>{chat.time}</Text>
              </View>
              <View style={styles.chatBottom}>
                <Text style={styles.chatPreview} numberOfLines={1}>
                  {chat.text}
                </Text>
                {chat.unread && (
                  <View style={styles.unreadBubble}>
                    <Text style={styles.unreadText}>{chat.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        )}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
      />
      {!visibleChats.length && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={25}
              color={COLORS.muted}
            />
          </View>
          <Text style={styles.emptyTitle}>Sohbet bulunamadı</Text>
          <Text style={styles.emptyDescription}>
            Arama kelimeni degistirmeyi dene.
          </Text>
        </View>
      )}
      <Modal
        transparent
        visible={Boolean(selectedChat)}
        animationType="slide"
        onRequestClose={() => setSelectedChat(null)}
      >
        <View style={styles.directMessageOverlay}>
          <KeyboardSafeView style={styles.directMessageSheet} offset={0}>
            <View style={styles.directMessageHeader}>
              <Pressable
                onPress={() => setSelectedChat(null)}
                style={styles.directBack}
              >
                <Ionicons name="chevron-back" color={COLORS.text} size={22} />
              </Pressable>
              {selectedChat && (
                <>
                  <Avatar
                    label={selectedChat.system ? "s" : selectedChat.name[0]}
                    color={selectedChat.color}
                    size={36}
                  />
                  <View style={styles.directHeaderText}>
                    <Text style={styles.directName}>{selectedChat.name}</Text>
                    <Text style={styles.directStatus}>
                      {selectedChat.system ? "Resmi hesap" : "Cevrimici"}
                    </Text>
                  </View>
                </>
              )}
            </View>
            <FlatList
              data={selectedMessages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.directBubble,
                    item.own && styles.directBubbleOwn,
                  ]}
                >
                  <Text
                    style={[
                      styles.directBubbleText,
                      item.own && styles.directBubbleTextOwn,
                    ]}
                  >
                    {item.text}
                  </Text>
                </View>
              )}
              contentContainerStyle={styles.directMessages}
              keyboardShouldPersistTaps="handled"
              windowSize={10}
              maxToRenderPerBatch={5}
            />
            <View style={styles.directComposer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={sendDirectMessage}
                placeholder="Mesaj yaz"
                placeholderTextColor={COLORS.muted}
                style={styles.directInput}
                maxLength={300}
              />
              <Pressable onPress={sendDirectMessage} style={styles.directSend}>
                <Ionicons name="send" size={17} color={COLORS.primaryInk} />
              </Pressable>
            </View>
          </KeyboardSafeView>
        </View>
      </Modal>
    </ScrollView>
  );
}

function NewMessageSheet({ visible, onDismiss, onCreate }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const create = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      Alert.alert(
        "Kime yazacaksin?",
        "Sohbet baslatmak icin bir gorunen ad yaz.",
      );
      return;
    }
    onCreate({
      name: cleanName.slice(0, 24),
      message: message.trim().slice(0, 300),
    });
    setName("");
    setMessage("");
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay} offset={0}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, { maxHeight: "88%" }]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.kicker}>YENI MESAJ</Text>
            <Text style={styles.sheetTitle}>Sohbet başlat.</Text>
            <Text style={styles.fieldLabel}>GORUNEN AD</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Orn. Ece"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={24}
              autoFocus
            />
            <Text style={styles.fieldLabel}>ILK MESAJ (ISTEGE BAGLI)</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Merhaba!"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={300}
            />
            <Pressable onPress={create}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                style={styles.createSubmit}
              >
                <Text style={styles.createSubmitText}>Sohbeti başlat</Text>
                <Ionicons name="send" size={19} color={COLORS.primaryInk} />
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
}

function Community({ onNotify }) {
  const [joinedGroupIds, setJoinedGroupIds] = useState([]);
  const [userGroups, setUserGroups] = useState([]);
  const [eventRsvpIds, setEventRsvpIds] = useState([]);
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const groups = [...userGroups, ...SEEDED_COMMUNITIES];
  const visibleGroups = joinedOnly
    ? groups.filter((group) => joinedGroupIds.includes(group.id))
    : groups;
  const notify = (item) => {
    if (onNotify) {
      onNotify(item);
      return;
    }
    if (notificationDispatcher) {
      notificationDispatcher(item);
      return;
    }
    AsyncStorage.getItem(NOTIFICATIONS_KEY)
      .then((savedNotifications) => {
        const currentNotifications = JSON.parse(savedNotifications || "[]");
        const nextNotifications = [
          item,
          ...(Array.isArray(currentNotifications) ? currentNotifications : []),
        ];
        AsyncStorage.setItem(
          NOTIFICATIONS_KEY,
          JSON.stringify(nextNotifications),
        ).catch(() => undefined);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    AsyncStorage.getItem("@sora/joined-groups")
      .then((value) => {
        const parsed = JSON.parse(value || "[]");
        if (Array.isArray(parsed)) setJoinedGroupIds(parsed);
      })
      .catch(() => undefined);
    AsyncStorage.getItem("@sora/user-communities")
      .then((value) => {
        const parsed = JSON.parse(value || "[]");
        if (Array.isArray(parsed)) setUserGroups(parsed);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(COMMUNITY_EVENT_RSVPS_KEY)
      .then((value) => {
        const parsed = JSON.parse(value || "[]");
        if (Array.isArray(parsed)) setEventRsvpIds(parsed);
      })
      .catch(() => undefined);
  }, []);
  const toggleGroup = (groupId) =>
    setJoinedGroupIds((current) => {
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      AsyncStorage.setItem("@sora/joined-groups", JSON.stringify(next)).catch(
        () => undefined,
      );
      return next;
    });
  const createCommunity = (community) => {
    setUserGroups((currentGroups) => {
      const nextGroups = [community, ...currentGroups];
      AsyncStorage.setItem(
        "@sora/user-communities",
        JSON.stringify(nextGroups),
      ).catch(() => undefined);
      return nextGroups;
    });
    setJoinedGroupIds((currentIds) => {
      const nextIds = [...currentIds, community.id];
      AsyncStorage.setItem(
        "@sora/joined-groups",
        JSON.stringify(nextIds),
      ).catch(() => undefined);
      return nextIds;
    });
    setCreateOpen(false);
  };
  const toggleEventRsvp = (group) => {
    const eventId = `event-${group.id}`;
    const isGoing = eventRsvpIds.includes(eventId);
    const nextIds = isGoing
      ? eventRsvpIds.filter((id) => id !== eventId)
      : [...eventRsvpIds, eventId];
    setEventRsvpIds(nextIds);
    AsyncStorage.setItem(
      COMMUNITY_EVENT_RSVPS_KEY,
      JSON.stringify(nextIds),
    ).catch(() => undefined);
    if (!isGoing)
      notify({
        id: `community-event-${Date.now()}`,
        icon: "calendar",
        color: COLORS.purple,
        text: `${group.name} bulusmasi icin yerin ayrildi.`,
        time: "Simdi",
      });
  };
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.screenHeading}>
        <View>
          <Text style={styles.kicker}>TOPLULUK</Text>
          <Text style={styles.pageTitle}>Birlikte daha iyi.</Text>
        </View>
        <IconButton
          icon="add-circle-outline"
          onPress={() => setCreateOpen(true)}
        />
        <CreateCommunitySheet
          visible={createOpen}
          onDismiss={() => setCreateOpen(false)}
          onCreate={createCommunity}
        />
        <CommunityDetailsSheet
          group={selectedGroup}
          joined={
            selectedGroup ? joinedGroupIds.includes(selectedGroup.id) : false
          }
          onDismiss={() => setSelectedGroup(null)}
          onToggleJoin={() => selectedGroup && toggleGroup(selectedGroup.id)}
        />
      </View>
      <LinearGradient
        colors={["#111820", "#1D2E43"]}
        style={styles.communityBanner}
      >
        <Text style={styles.communityIcon}>✦</Text>
        <View style={styles.communityBannerText}>
          <Text style={styles.communityBannerTitle}>Kendi cevrini kur.</Text>
          <Text style={styles.communityBannerCopy}>
            Odan, kurallarin ve birlikte buyuyen toplulugun.
          </Text>
        </View>
      </LinearGradient>
      <View style={styles.communityFilters}>
        <Pressable
          onPress={() => setJoinedOnly(false)}
          style={[
            styles.communityFilter,
            !joinedOnly && styles.communityFilterActive,
          ]}
        >
          <Text
            style={[
              styles.communityFilterText,
              !joinedOnly && styles.communityFilterTextActive,
            ]}
          >
            Kesfet
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setJoinedOnly(true)}
          style={[
            styles.communityFilter,
            joinedOnly && styles.communityFilterActive,
          ]}
        >
          <Text
            style={[
              styles.communityFilterText,
              joinedOnly && styles.communityFilterTextActive,
            ]}
          >
            Katildiklarin ({joinedGroupIds.length})
          </Text>
        </Pressable>
      </View>
      {joinedGroupIds.length > 0 && (
        <View style={styles.communityMeetings}>
          <View style={styles.communityMeetingsHead}>
            <Text style={styles.communityMeetingsTitle}>
              YAKLASAN BULUSMALAR
            </Text>
            <Text style={styles.communityMeetingsCount}>
              {eventRsvpIds.length} kayitli
            </Text>
          </View>
          {groups
            .filter((group) => joinedGroupIds.includes(group.id))
            .slice(0, 2)
            .map((group) => {
              const eventSaved = eventRsvpIds.includes(`event-${group.id}`);
              return (
                <Pressable
                  key={`event-${group.id}`}
                  onPress={() => toggleEventRsvp(group)}
                  style={[
                    styles.communityMeetingRow,
                    eventSaved && styles.communityMeetingRowSaved,
                  ]}
                >
                  <View style={styles.communityMeetingDate}>
                    <Text style={styles.communityMeetingDay}>CMT</Text>
                    <Text style={styles.communityMeetingHour}>20:30</Text>
                  </View>
                  <View style={styles.communityMeetingInfo}>
                    <Text style={styles.communityMeetingName}>
                      {group.name} bulusmasi
                    </Text>
                    <Text style={styles.communityMeetingMeta}>
                      {eventSaved ? "Yerin ayrildi" : "Dokun, yerini ayir"}
                    </Text>
                  </View>
                  <Ionicons
                    name={eventSaved ? "checkmark-circle" : "calendar-outline"}
                    size={20}
                    color={eventSaved ? COLORS.primary : COLORS.muted}
                  />
                </Pressable>
              );
            })}
        </View>
      )}
      <Text style={styles.sectionTitle}>
        {joinedOnly ? "Ailelerin" : "Aileler"}
      </Text>
      {visibleGroups.map((group) => {
        const joined = joinedGroupIds.includes(group.id);
        return (
          <LinearGradient
            key={group.id}
            colors={group.color}
            style={styles.groupCard}
          >
            <View style={styles.groupIcon}>
              <Ionicons name={group.icon} color="#fff" size={21} />
            </View>
            <Pressable
              onPress={() => setSelectedGroup(group)}
              style={styles.groupText}
            >
              <Text style={styles.groupName}>{group.name}</Text>
              <Text style={styles.groupMembers} numberOfLines={1}>
                {group.members} · {group.description}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggleGroup(group.id)}
              style={[styles.joinButton, joined && styles.joinedButton]}
            >
              <Text
                style={[
                  styles.joinButtonText,
                  joined && styles.joinedButtonText,
                ]}
              >
                {joined ? "Katildin" : "Katil"}
              </Text>
            </Pressable>
          </LinearGradient>
        );
      })}
      {!visibleGroups.length && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="people-outline" size={26} color={COLORS.muted} />
          </View>
          <Text style={styles.emptyTitle}>Henüz aile yok</Text>
          <Text style={styles.emptyDescription}>
            Keşfet bölümünden ilgini çeken bir aileye katıl.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function CreateCommunitySheet({ visible, onDismiss, onCreate }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colorIndex, setColorIndex] = useState(0);
  const create = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      Alert.alert(
        "Aile adı gerekli",
        "Devam etmek için ailene bir ad ver.",
      );
      return;
    }
    onCreate({
      id: `community-${Date.now()}`,
      name: cleanName.slice(0, 28),
      description: description.trim().slice(0, 56) || "Yeni bir ses toplulugu.",
      members: "1 uye",
      color: COMMUNITY_COLORS[colorIndex],
      icon: "people",
      userCreated: true,
    });
    setName("");
    setDescription("");
    setColorIndex(0);
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay} offset={0}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, { maxHeight: "88%" }]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.kicker}>YENI TOPLULUK</Text>
            <Text style={styles.sheetTitle}>Cevreni kur.</Text>
            <Text style={styles.fieldLabel}>TOPLULUK ADI</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Orn. Gece muhabbeti"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={28}
            />
            <Text style={styles.fieldLabel}>KISA ACIKLAMA</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Toplulugun ne icin var?"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={56}
            />
            <Text style={styles.fieldLabel}>RENK</Text>
            <View style={styles.communityColorList}>
              {COMMUNITY_COLORS.map((colors, index) => (
                <Pressable
                  key={colors[0]}
                  onPress={() => setColorIndex(index)}
                  style={[
                    styles.communityColorOption,
                    { backgroundColor: colors[0] },
                    colorIndex === index && styles.communityColorSelected,
                  ]}
                />
              ))}
            </View>
            <Pressable onPress={create}>
              <LinearGradient colors={BRAND_GRADIENT} style={styles.createSubmit}>
                <Text style={styles.createSubmitText}>Toplulugu olustur</Text>
                <Ionicons name="people" size={20} color={COLORS.primaryInk} />
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
}

function CommunityDetailsSheet({ group, joined, onDismiss, onToggleJoin }) {
  if (!group) return null;
  const shareCommunity = async () => {
    try {
      await Share.share({
        title: `Sora · ${group.name}`,
        message: `${group.name} topluluguna katil.\n${group.description}`,
      });
    } catch {
      return;
    }
  };
  return (
    <Modal
      transparent
      visible={Boolean(group)}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <LinearGradient
            colors={group.color}
            style={styles.communityDetailHero}
          >
            <View style={styles.communityDetailIcon}>
              <Ionicons name={group.icon} size={25} color="#fff" />
            </View>
            <Text style={styles.communityDetailName}>{group.name}</Text>
            <Text style={styles.communityDetailMembers}>{group.members}</Text>
          </LinearGradient>
          <Text style={styles.communityDetailDescription}>
            {group.description}
          </Text>
          <Text style={styles.settingsCaption}>YAKLASAN BULUSMA</Text>
          <View style={styles.communityEvent}>
            <View style={styles.communityEventDate}>
              <Text style={styles.communityEventDay}>CMT</Text>
              <Text style={styles.communityEventHour}>20:30</Text>
            </View>
            <View style={styles.communityEventText}>
              <Text style={styles.communityEventTitle}>
                {group.name} bulusmasi
              </Text>
              <Text style={styles.communityEventMeta}>
                Canli ses odasi · 45 dk
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </View>
          <View style={styles.communityDetailActions}>
            <Pressable onPress={shareCommunity} style={styles.communityShare}>
              <Ionicons name="share-outline" size={18} color={COLORS.text} />
              <Text style={styles.communityShareText}>Paylas</Text>
            </Pressable>
            <Pressable onPress={onToggleJoin} style={styles.communityJoinWide}>
              <Text style={styles.communityJoinWideText}>
                {joined ? "Ailedesin" : "Aileye katıl"}
              </Text>
              <Ionicons
                name={joined ? "checkmark" : "arrow-forward"}
                size={19}
                color={COLORS.primaryInk}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const USER_EVEN_LEVEL_PREVIEW = Array.from({ length: 30 }, (_, idx) => (idx + 1) * 2);

const UserLevelSheet = memo(function UserLevelSheet({
  visible,
  level = 1,
  userXp = 0,
  syncing = false,
  onSync,
  onDismiss,
}) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const progress = useMemo(
    () => computeUserLevelProgress(userXp, safeLevel),
    [safeLevel, userXp],
  );
  const currentTier = useMemo(
    () => getBadgeTierConfigForLevel(safeLevel),
    [safeLevel],
  );
  const nextEvenLevel = safeLevel % 2 === 0 ? safeLevel + 2 : safeLevel + 1;
  const nextEvenReward = evenLevelCoinReward(nextEvenLevel);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, { maxHeight: "88%" }]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>SEVİYE VE ROZET SİSTEMİ</Text>
          <Text style={styles.sheetTitle}>Seviye {String(safeLevel).padStart(2, "0")}</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20, gap: 14 }}
          >
            <LinearGradient
              colors={["#111C2D", "#1B3358"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.userLevelHeroCard}
            >
              <View style={styles.userLevelHeroTop}>
                <SoraLevelCrest level={safeLevel} size={68} showLevel />
                <View style={{ flex: 1 }}>
                  <Text style={styles.userLevelHeroTitle}>
                    Seviye {String(safeLevel).padStart(2, "0")} · {currentTier.title}
                  </Text>
                  <Text style={styles.userLevelHeroXp}>
                    {formatCredits(progress.gainedInLevel)} / {formatCredits(progress.stepRequiredXp)} XP
                  </Text>
                  <View style={styles.userLevelProgressTrack}>
                    <View
                      style={[
                        styles.userLevelProgressFill,
                        { width: `${Math.max(4, Math.round(progress.ratio * 100))}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.userLevelHeroNext}>
                    Sonraki kredi ödülü: Sv. {nextEvenLevel} · +{formatCredits(nextEvenReward)} kredi
                  </Text>
                </View>
              </View>
              {onSync ? (
                <Pressable
                  disabled={syncing}
                  onPress={onSync}
                  style={[styles.userLevelSyncBtn, syncing && { opacity: 0.6 }]}
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="sync-outline" size={15} color="#FFFFFF" />
                      <Text style={styles.userLevelSyncText}>Seviye ve ödülleri doğrula</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </LinearGradient>

            <View>
              <Text style={styles.settingsCaption}>10 SEVİYEDE BİR YÜKSELEN ROZETLER</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
              >
                {LEVEL_BADGE_TIERS.map((tier) => {
                  const unlocked = safeLevel >= tier.minLevel;
                  const active = currentTier.key === tier.key;
                  return (
                    <View
                      key={tier.key}
                      style={[
                        styles.userTierCard,
                        active && styles.userTierCardActive,
                        !unlocked && { opacity: 0.62 },
                      ]}
                    >
                      <SoraLevelCrest level={tier.minLevel} size={52} locked={!unlocked} />
                      <Text numberOfLines={1} style={styles.userTierRange}>
                        {tier.rangeLabel}
                      </Text>
                      <Text numberOfLines={1} style={styles.userTierTitle}>
                        {tier.title}
                      </Text>
                      <Text style={[styles.userTierState, unlocked && { color: COLORS.primary }]}>
                        {active ? "Aktif rozet" : unlocked ? "Açıldı" : `Sv. ${tier.minLevel}`}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            <View>
              <Text style={styles.settingsCaption}>ÇİFT SEVİYE KREDİ HEDİYELERİ (2, 4, 6...)</Text>
              <View style={{ gap: 8 }}>
                {USER_EVEN_LEVEL_PREVIEW.map((evenLvl) => {
                  const reward = evenLevelCoinReward(evenLvl);
                  const claimed = safeLevel >= evenLvl;
                  const isNext = evenLvl === nextEvenLevel;
                  const badgeMilestone = evenLvl % 10 === 0;
                  return (
                    <View
                      key={evenLvl}
                      style={[
                        styles.evenRewardRow,
                        claimed && styles.evenRewardRowClaimed,
                        isNext && styles.evenRewardRowNext,
                      ]}
                    >
                      <SoraLevelCrest level={evenLvl} size={38} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={styles.evenRewardLevel}>Seviye {evenLvl}</Text>
                          {badgeMilestone ? (
                            <View style={styles.evenRewardMilestoneChip}>
                              <Text style={styles.evenRewardMilestoneText}>Yeni Rozet Kademesi</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.evenRewardCoins}>
                          +{formatCredits(reward)} kredi hediye
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.evenRewardStatusPill,
                          claimed && styles.evenRewardStatusClaimed,
                          isNext && styles.evenRewardStatusNext,
                        ]}
                      >
                        <Text
                          style={[
                            styles.evenRewardStatusText,
                            (claimed || isNext) && { color: COLORS.primary },
                          ]}
                        >
                          {claimed ? "Alındı" : isNext ? "Sıradaki" : `Sv. ${evenLvl}`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

function Profile({
  profile,
  userId = null,
  followedUserIds = [],
  family = null,
  coins,
  favoriteCount,
  hostedRoomCount,
  myRooms = [],
  dailyRewardClaimed,
  onEdit,
  onOpenSettings,
  onOpenWallet,
  onClaimDailyReward,
  onSyncUserLevel,
  onOpenUserProfile,
}) {
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [levelSheetOpen, setLevelSheetOpen] = useState(false);
  const [syncingLevel, setSyncingLevel] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityStreak, setActivityStreak] = useState(1);
  const [followedCount, setFollowedCount] = useState(0);
  const [followedProfiles, setFollowedProfiles] = useState([]);
  const [profileTab, setProfileTab] = useState("rooms");
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const openSafetyCenter = useCallback(() => setSafetyOpen(true), []);
  const openProfileDetails = useCallback(
    () => setProfileDetailsOpen(true),
    [],
  );
  const handleManualLevelSync = useCallback(async () => {
    if (!onSyncUserLevel || syncingLevel) return;
    setSyncingLevel(true);
    try {
      await onSyncUserLevel({ showFeedback: true });
    } finally {
      setSyncingLevel(false);
    }
  }, [onSyncUserLevel, syncingLevel]);
  const actions = useMemo(
    () => [
      [
        "gift-outline",
        dailyRewardClaimed
          ? "Günlük ödül alındı"
          : `Günlük ödül · +${formatCredits(DAILY_REWARD_AMOUNT)}`,
        dailyRewardClaimed ? onOpenWallet : onClaimDailyReward,
      ],
      ["shield-checkmark-outline", "Güvenlik merkezi", openSafetyCenter],
      ["settings-outline", "Ayarlar", onOpenSettings],
    ],
    [
      dailyRewardClaimed,
      onClaimDailyReward,
      onOpenSettings,
      onOpenWallet,
      openSafetyCenter,
    ],
  );
  useEffect(() => {
    AsyncStorage.getItem(ROOM_HISTORY_KEY)
      .then((savedHistory) => {
        const parsedHistory = JSON.parse(savedHistory || "[]");
        if (Array.isArray(parsedHistory))
          setRecentActivity(
            parsedHistory
              .filter(
                (item, index, list) =>
                  list.findIndex(
                    (other) =>
                      (item.roomId && other.roomId === item.roomId) ||
                      other.title === item.title,
                  ) === index,
              )
              .slice(0, 3),
          );
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let active = true;
    if (supabase && userId) {
      setFollowedCount(followedUserIds.length);
      listFollowedProfiles(userId)
        .then((profiles) => {
          if (!active) return;
          setFollowedProfiles(profiles);
          setFollowedCount(profiles.length);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }
    if (!isSupabaseConfigured) {
      AsyncStorage.getItem(FOLLOWED_USERS_KEY)
        .then((savedNames) => {
          if (!active) return;
          const parsedNames = JSON.parse(savedNames || "[]");
          if (Array.isArray(parsedNames)) {
            setFollowedCount(parsedNames.length);
            setFollowedProfiles(
              parsedNames.map((name) => ({
                id: name,
                name,
                handle: "",
                color: COLORS.primaryLight,
                avatarUrl: null,
              })),
            );
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [followedUserIds.length, userId]);
  useEffect(() => {
    const updateStreak = async () => {
      try {
        const today = new Date();
        const todayKey = today.toDateString();
        const savedStreak = JSON.parse(
          (await AsyncStorage.getItem(ACTIVITY_STREAK_KEY)) || "{}",
        );
        if (savedStreak.lastDate === todayKey) {
          setActivityStreak(savedStreak.count || 1);
          return;
        }
        const previousDate = new Date(today);
        previousDate.setDate(today.getDate() - 1);
        const nextCount =
          savedStreak.lastDate === previousDate.toDateString()
            ? (savedStreak.count || 1) + 1
            : 1;
        setActivityStreak(nextCount);
        await AsyncStorage.setItem(
          ACTIVITY_STREAK_KEY,
          JSON.stringify({ lastDate: todayKey, count: nextCount }),
        );
      } catch {
        setActivityStreak(1);
      }
    };
    updateStreak();
  }, []);
  const shareProfile = async () => {
    try {
      await Share.share({
        title: `Sora · ${profile.name}`,
        message: `Sora'da @${profile.handle} profilini takip et.`,
      });
    } catch {
      return;
    }
  };
  const badges = useMemo(
    () => [
      {
        id: "first-listen",
        icon: "headset",
        title: "İlk dinleme",
        hint: "Bir odaya katıl",
        gradient: ["#5AA2FF", "#2F6FE0"],
        tint: "#2F80ED",
        unlocked: recentActivity.length > 0,
      },
      {
        id: "host",
        icon: "mic",
        title: "Ev sahibi",
        hint: "İlk odanı aç",
        gradient: ["#FFC861", "#F08A24"],
        tint: "#F08A24",
        unlocked: hostedRoomCount > 0,
      },
      {
        id: "curator",
        icon: "heart",
        title: "Kaşif",
        hint: `${Math.min(favoriteCount, 3)}/3 favori`,
        gradient: ["#FF7AA8", "#D9417A"],
        tint: "#D9417A",
        unlocked: favoriteCount >= 3,
      },
      {
        id: "family",
        icon: "shield-checkmark",
        title: family ? `Aile Sv. ${family.level}` : "Aile üyesi",
        hint: family ? family.name : "Bir aileye katıl",
        gradient: ["#2F80ED", "#1D4E89"],
        tint: "#2F80ED",
        unlocked: Boolean(family),
      },
    ],
    [recentActivity.length, hostedRoomCount, favoriteCount, family],
  );
  const level = Math.max(1, Math.floor(Number(profile.userLevel) || 1));
  const userXp = Math.max(0, Math.floor(Number(profile.userXp) || 0));
  const badgeTier = getBadgeTierConfigForLevel(level);
  const homeFrameAppearance = PROFILE_ITEM_APPEARANCE[profile.activeFrameId];
  const homeThemeAppearance = PROFILE_ITEM_APPEARANCE[profile.activeProfileThemeId];
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        windowSize={10}
        maxToRenderPerBatch={15}
        updateCellsBatchingPeriod={50}
      >
        <Reveal distance={10}>
          <View style={styles.profileHomeHeaderRow}>
            <Pressable
              onPress={openProfileDetails}
              accessibilityRole="button"
              accessibilityLabel="Profil ayrıntılarını aç"
              style={({ pressed }) => [
                styles.profileHomeIdentity,
                homeThemeAppearance?.background
                  ? { backgroundColor: homeThemeAppearance.background }
                  : null,
                pressed && styles.profileHomePressed,
              ]}
            >
              <ProfileFrame appearance={homeFrameAppearance} size={68} style={styles.profileHomeAvatarWrap}>
                <Avatar
                  label={(profile.name || "S").charAt(0).toUpperCase()}
                  color={profile.color}
                  uri={profile.avatarUrl}
                  size={68}
                  bordered
                  circle
                />
              </ProfileFrame>
              <View style={styles.profileHomeCopy}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.profileHomeName, { flexShrink: 1 }]} numberOfLines={1}>
                    {profile.name}
                  </Text>
                  <SoraLevelCrest level={level} size={24} />
                  <View style={styles.profileLevelInlinePill}>
                    <Text style={styles.profileLevelInlineText}>Sv. {level}</Text>
                  </View>
                </View>
                <Text style={styles.profileHomeHandle} numberOfLines={1}>
                  @{profile.handle}
                  {profile.publicId ? ` · ID: ${profile.publicId}` : ""}
                </Text>
                <Text style={styles.profileHomeBio} numberOfLines={1}>
                  {profile.bio || "Sora ses dünyasındaki profilin"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={21} color={COLORS.muted} />
            </Pressable>
          </View>
        </Reveal>

        <Reveal delay={85} distance={10}>
          <View style={styles.profileBannerRow}>
            <Pressable
              onPress={onEdit}
              style={styles.profileBannerButton}
              accessibilityRole="button"
              accessibilityLabel="Profilini kişiselleştir"
            >
              <LinearGradient
                colors={["#246BC7", "#6AA8F8"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileBanner}
              >
                <View style={styles.profileBannerCopy}>
                  <Text style={styles.profileBannerTitle}>Profilini düzenle</Text>
                  <Text style={styles.profileBannerCaption}>Görünümünü kişiselleştir</Text>
                </View>
                <Ionicons name="color-palette-outline" size={29} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={onOpenWallet}
              style={styles.profileBannerButton}
              accessibilityRole="button"
              accessibilityLabel="Cüzdanı aç"
            >
              <LinearGradient
                colors={["#111820", "#1D2E43"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileBanner}
              >
                <View style={styles.profileBannerCopy}>
                  <Text style={styles.profileBannerTitle}>Cüzdan</Text>
                  <Text style={styles.profileBannerCaption}>Bakiyeni yönet</Text>
                </View>
                <Ionicons name="wallet-outline" size={29} color="#9FC7FF" />
              </LinearGradient>
            </Pressable>
          </View>
        </Reveal>

        <Text style={styles.pfSection}>HESABIN</Text>
        <View style={styles.pfMenu}>
          {actions.map(([icon, title, action]) => (
            <Pressable
              key={title}
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={action}
              style={styles.pfMenuRow}
            >
              <View style={styles.pfMenuIcon}>
                <Ionicons name={icon} size={19} color={COLORS.primary} />
              </View>
              <Text style={styles.pfMenuTitle}>{title}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => setLevelSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Seviye ${String(level).padStart(2, "0")}`}
          style={({ pressed }) => [
            styles.profileLevelSummary,
            pressed && { opacity: 0.86 },
          ]}
        >
          <SoraLevelCrest level={level} size={44} />
          <View style={styles.pfLevelInfo}>
            <Text style={styles.pfLevelTitle}>
              Seviye {String(level).padStart(2, "0")}
            </Text>
          </View>
          <View style={styles.profileBadgeTierChip}>
            <Text style={styles.profileBadgeTierChipText} numberOfLines={1}>
              {badgeTier.title}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>

        <View style={styles.pfTabs}>
          <Pressable
            onPress={() => setProfileTab("rooms")}
            style={[styles.pfTab, profileTab === "rooms" && styles.pfTabActive]}
            accessibilityRole="button"
            accessibilityLabel="Odalarım sekmesi"
          >
            <Text
              style={[
                styles.pfTabText,
                profileTab === "rooms" && styles.pfTabTextActive,
              ]}
            >
              Odalarım
            </Text>
            <View style={styles.pfTabBadge}>
              <Text style={styles.pfTabBadgeText}>{myRooms.length}</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => setProfileTab("following")}
            style={[
              styles.pfTab,
              profileTab === "following" && styles.pfTabActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Takip ettiklerim sekmesi"
          >
            <Text
              style={[
                styles.pfTabText,
                profileTab === "following" && styles.pfTabTextActive,
              ]}
            >
              Takip ettiklerim
            </Text>
            <View style={styles.pfTabBadge}>
              <Text style={styles.pfTabBadgeText}>{followedCount}</Text>
            </View>
          </Pressable>
        </View>
        {profileTab === "rooms" ? (
          myRooms.length ? (
            myRooms.map((item) => (
              <View key={item.id} style={styles.pfActivityRow}>
                <View
                  style={[
                    styles.pfActivityAvatar,
                    { backgroundColor: item.accent || COLORS.purple },
                  ]}
                >
                  <Text style={styles.pfActivityAvatarText}>
                    {item.initials || (item.title || "S").charAt(0)}
                  </Text>
                </View>
                <View style={styles.pfActivityInfo}>
                  <Text style={styles.pfActivityTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.pfActivityMeta}>
                    {formatCategoryLabel(item.category)} · {item.listeners ?? 0} dinleyici
                  </Text>
                </View>
                <Ionicons name="mic-outline" size={18} color={COLORS.muted} />
              </View>
            ))
          ) : (
            <View style={styles.pfEmpty}>
              <Ionicons name="mic-off-outline" size={16} color={COLORS.muted} />
              <Text style={styles.pfEmptyText}>Henüz bir oda açmadın.</Text>
            </View>
          )
        ) : followedProfiles.length ? (
          followedProfiles.map((person) => (
            <Pressable
              key={person.id}
              onPress={() => person.id && supabase && onOpenUserProfile?.(person.id)}
              style={styles.pfActivityRow}
            >
              <Avatar
                label={(person.name || "S").charAt(0).toUpperCase()}
                color={person.color || COLORS.primaryLight}
                uri={person.avatarUrl || null}
                size={42}
                circle
              />
              <View style={styles.pfActivityInfo}>
                <Text style={styles.pfActivityTitle} numberOfLines={1}>
                  {person.name || "Sora kullanıcısı"}
                </Text>
                <Text style={styles.pfActivityMeta} numberOfLines={1}>
                  {person.handle ? `@${person.handle} · Takip ediliyor` : "Takip ediliyor"}
                </Text>
              </View>
              <Ionicons name="heart" size={16} color={COLORS.primary} />
            </Pressable>
          ))
        ) : (
          <View style={styles.pfEmpty}>
            <Ionicons name="heart-outline" size={16} color={COLORS.muted} />
            <Text style={styles.pfEmptyText}>Henüz kimseyi takip etmiyorsun.</Text>
          </View>
        )}

        <Text style={styles.pfSection}>SEVİYE ROZETLERİ</Text>
        <View style={styles.pfBadgeRow}>
          {LEVEL_BADGE_TIERS.map((tier) => {
            const unlocked = level >= tier.minLevel;
            return (
              <Pressable
                key={tier.key}
                onPress={() => setLevelSheetOpen(true)}
                style={[
                  styles.pfBadge,
                  styles.pfBadgeGridLevel,
                  unlocked && { borderColor: `${tier.borderColor}66` },
                  !unlocked && { opacity: 0.62 },
                ]}
              >
                <View style={{ marginBottom: 6 }}>
                  <SoraLevelCrest level={tier.minLevel} size={46} locked={!unlocked} />
                  {!unlocked ? (
                    <View style={styles.pfBadgeLock}>
                      <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.pfBadgeText, !unlocked && { color: COLORS.muted }]}
                  numberOfLines={1}
                >
                  {tier.title}
                </Text>
                <Text style={styles.pfBadgeHint} numberOfLines={1}>
                  {unlocked ? tier.rangeLabel : `Sv. ${tier.minLevel}`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.pfSection}>ETKİNLİK ROZETLERİ</Text>
        <View style={styles.pfBadgeRow}>
          {badges.map((badge) => (
            <View
              key={badge.id}
              style={[
                styles.pfBadge,
                styles.pfBadgeGridAchievement,
                badge.unlocked && { borderColor: `${badge.tint}55` },
              ]}
            >
              <View style={styles.pfBadgeMedal}>
                <SoraAchievementBadge
                  badgeId={badge.id}
                  size={54}
                  locked={!badge.unlocked}
                />
                {!badge.unlocked ? (
                  <View style={styles.pfBadgeLock}>
                    <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <Text
                style={[styles.pfBadgeText, !badge.unlocked && { color: COLORS.muted }]}
                numberOfLines={1}
              >
                {badge.title}
              </Text>
              <Text style={styles.pfBadgeHint} numberOfLines={1}>
                {badge.unlocked ? "Kazanıldı" : badge.hint}
              </Text>
            </View>
          ))}
        </View>
        {recentActivity.length > 0 && (
          <>
            <Text style={styles.pfSection}>GEÇMİŞ</Text>
            {recentActivity.map((item) => (
              <View key={item.id} style={styles.pfActivityRow}>
                <View
                  style={[
                    styles.pfActivityAvatar,
                    { backgroundColor: item.color || COLORS.purple },
                  ]}
                >
                  <Text style={styles.pfActivityAvatarText}>
                    {item.initials || (item.title || "S").charAt(0)}
                  </Text>
                </View>
                <View style={styles.pfActivityInfo}>
                  <Text style={styles.pfActivityTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.pfActivityMeta}>
                    {formatCategoryLabel(item.category)} · {formatHistoryTime(item)}
                  </Text>
                </View>
                <Ionicons name="headset-outline" size={18} color={COLORS.muted} />
              </View>
            ))}
          </>
        )}
      </ScrollView>
      <ProfileDetailSheet
        visible={profileDetailsOpen}
        profile={profile}
        isSelf
        onEdit={onEdit}
        onShare={shareProfile}
        onOpenLevel={() => {
          setProfileDetailsOpen(false);
          setTimeout(() => setLevelSheetOpen(true), 300);
        }}
        onDismiss={() => setProfileDetailsOpen(false)}
      />
      <SecureSafetyCenterSheet
        visible={safetyOpen}
        onDismiss={() => setSafetyOpen(false)}
      />
      <UserLevelSheet
        visible={levelSheetOpen}
        level={level}
        userXp={userXp}
        syncing={syncingLevel}
        onSync={handleManualLevelSync}
        onDismiss={() => setLevelSheetOpen(false)}
      />
    </>
  );
}

const formatHistoryTime = (item) => {
  if (!item?.visitedTs) return item?.visitedAt || "";
  const minutes = Math.floor((Date.now() - item.visitedTs) / 60000);
  if (minutes < 1) return "Şimdi";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
};

const ProfileMetric = memo(function ProfileMetric({ number, label }) {
  return (
    <View style={styles.profileMetric}>
      <Text style={styles.profileMetricNumber}>{number}</Text>
      <Text style={styles.profileMetricLabel}>{label}</Text>
    </View>
  );
});

function ProfileDetailSheet({
  visible,
  profile,
  userId,
  isSelf = false,
  roomContext,
  isFollowing = false,
  canBlock = false,
  onDismiss,
  onEdit,
  onShare,
  onOpenLevel,
  onToggleFollow,
  onBlock,
  onReport,
  staffActions = [],
  onStaffAction,
}) {
  const insets = useSafeAreaInsets();
  const [remoteProfile, setRemoteProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("profile");

  useEffect(() => {
    if (!visible || !userId || profile?.handle) {
      setRemoteProfile(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    getPublicProfile(userId)
      .then((result) => {
        if (active) setRemoteProfile(result);
      })
      .catch(() => {
        if (active) setRemoteProfile(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile?.handle, userId, visible]);

  useEffect(() => {
    if (visible) setDetailTab("profile");
  }, [visible]);

  const [followCounts, setFollowCounts] = useState(null);
  useEffect(() => {
    if (!visible || !isSelf || !supabase) return undefined;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const selfId = data?.session?.user?.id;
        return selfId ? getFollowCounts(selfId) : null;
      })
      .then((counts) => {
        if (active && counts) setFollowCounts(counts);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isSelf, visible]);

  const person = remoteProfile || profile || {};
  const name = person.name || person.display_name || "Sora kullanıcısı";
  const handle = person.handle ? `@${person.handle.replace(/^@+/, "")}` : "Sora kullanıcısı";
  const color = person.color || person.avatar_color || COLORS.primaryLight;
  const personLevel = Math.max(1, Math.floor(Number(person.userLevel || person.user_level || 1)));
  const personXp = Math.max(0, Math.floor(Number(person.userXp || person.user_xp || 0)));
  const personBadgeTier = getBadgeTierConfigForLevel(personLevel);
  const personLevelProgress = computeUserLevelProgress(personXp, personLevel);
  const frameAppearance = PROFILE_ITEM_APPEARANCE[person.activeFrameId];
  const themeAppearance = PROFILE_ITEM_APPEARANCE[person.activeProfileThemeId];
  const role = person.role;
  const roleLabel =
    role === "host"
      ? "Oda sahibi"
      : role === "moderator"
        ? "Yönetici"
        : profile?.seat !== null && profile?.seat !== undefined
          ? "Mikrofonda"
          : "Dinleyici";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.profileDetailScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#111820" />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          <View
            style={[
              styles.profileDetailCover,
              { paddingTop: insets.top + 10 },
            ]}
          >
            <LinearGradient
              colors={COLORS.gradients.dark}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.profileDetailOrb, { backgroundColor: `${color}55` }]} />
            <View style={styles.profileDetailTopRow}>
              <Pressable
                onPress={onDismiss}
                style={styles.profileDetailIconButton}
                accessibilityRole="button"
                accessibilityLabel="Profile geri dön"
              >
                <Ionicons name="arrow-back" size={21} color="#FFFFFF" />
              </Pressable>
              <View style={styles.profileDetailTopActions}>
                {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                {false && onShare ? (
                  <Pressable
                    onPress={onShare}
                    style={styles.profileDetailIconButton}
                    accessibilityLabel="Profili paylaş"
                  >
                    <Ionicons name="share-social-outline" size={19} color="#FFFFFF" />
                  </Pressable>
                ) : null}
                {isSelf && onEdit ? (
                  <Pressable
                    onPress={() => {
                      onDismiss();
                      setTimeout(() => onEdit(), 300);
                    }}
                    style={styles.profileDetailIconButton}
                    accessibilityLabel="Profili düzenle"
                  >
                    <Ionicons name="create-outline" size={19} color="#FFFFFF" />
                  </Pressable>
                ) : null}
              </View>
            </View>
            <View style={styles.profileDetailBrand} pointerEvents="none">
              <Ionicons
                name="radio-outline"
                size={34}
                color="rgba(255,255,255,0.28)"
              />
              <View>
                <Text style={styles.profileDetailBrandTitle}>SORA</Text>
                <Text style={styles.profileDetailBrandCaption}>SESİNİ PAYLAŞ</Text>
              </View>
            </View>
            <View style={styles.profileDetailCoverBottom}>
              <ProfileFrame
                appearance={frameAppearance}
                size={88}
                style={[
                  styles.profileDetailAvatarRing,
                  frameAppearance?.asset && { backgroundColor: "transparent", borderWidth: 0 },
                ]}
              >
                <Avatar
                  label={name.charAt(0).toUpperCase()}
                  color={color}
                  uri={person.avatarUrl || person.avatar_url || null}
                  size={88}
                  bordered
                  circle
                />
              </ProfileFrame>
              <View style={styles.profileDetailStatus}>
                <View style={styles.profileDetailStatusDot} />
                <Text style={styles.profileDetailStatusText}>
                  {roomContext ? "Bu odada" : "Sora profili"}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.profileDetailIdentity,
              themeAppearance?.background
                ? { backgroundColor: themeAppearance.background }
                : null,
            ]}
          >
            <View style={styles.profileDetailNameRow}>
              <Text style={styles.profileDetailName} numberOfLines={1}>
                {name}
              </Text>
              <SoraLevelCrest level={personLevel} size={28} />
              <View style={styles.profileLevelInlinePill}>
                <Text style={styles.profileLevelInlineText}>Sv. {personLevel}</Text>
              </View>
            </View>
            <Text style={styles.profileDetailHandle}>
              {handle}
              {person.publicId ? ` · ID: ${person.publicId}` : ""}
            </Text>
            {isSelf ? (
              <View style={styles.profileFollowRow}>
                <View style={styles.profileFollowItem}>
                  <Text style={styles.profileFollowNumber}>{followCounts?.following ?? "–"}</Text>
                  <Text style={styles.profileFollowLabel}>Takip</Text>
                </View>
                <View style={styles.profileFollowDivider} />
                <View style={styles.profileFollowItem}>
                  <Text style={styles.profileFollowNumber}>{followCounts?.followers ?? "–"}</Text>
                  <Text style={styles.profileFollowLabel}>Takipçi</Text>
                </View>
              </View>
            ) : null}
            {roomContext ? (
              <View style={styles.profileDetailRoleRow}>
                <Ionicons name="mic-outline" size={16} color={COLORS.primary} />
                <Text style={styles.profileDetailRoleText}>{roleLabel} · {roomContext.title}</Text>
              </View>
            ) : null}
          </View>

          {roomContext ? (
            <View style={styles.profileDetailTabs}>
              <Pressable
                onPress={() => setDetailTab("profile")}
                style={[
                  styles.profileDetailTab,
                  detailTab === "profile" && styles.profileDetailTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.profileDetailTabText,
                    detailTab === "profile" && styles.profileDetailTabTextActive,
                  ]}
                >
                  Profil
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDetailTab("room")}
                style={[
                  styles.profileDetailTab,
                  detailTab === "room" && styles.profileDetailTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.profileDetailTabText,
                    detailTab === "room" && styles.profileDetailTabTextActive,
                  ]}
                >
                  Bu oda
                </Text>
              </Pressable>
            </View>
          ) : null}

          {detailTab === "room" && roomContext ? (
            <View style={styles.profileDetailSection}>
              <Text style={styles.profileDetailSectionTitle}>Odadaki bilgileri</Text>
              <View style={styles.profileDetailInfoRow}>
                <Ionicons name="radio-outline" size={19} color={COLORS.primary} />
                <View style={styles.profileDetailInfoCopy}>
                  <Text style={styles.profileDetailInfoTitle}>{roomContext.title}</Text>
                  <Text style={styles.profileDetailInfoCaption}>{roleLabel}</Text>
                </View>
              </View>
            </View>
          ) : (
            <>
              <Pressable
                disabled={!onOpenLevel}
                onPress={onOpenLevel}
                accessibilityRole={onOpenLevel ? "button" : "summary"}
                style={({ pressed }) => [
                  styles.profileDetailLevelCard,
                  pressed && onOpenLevel && { opacity: 0.88 },
                ]}
              >
                <View style={styles.profileDetailLevelTop}>
                  <SoraLevelCrest level={personLevel} size={52} showLevelTag />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileDetailLevelTitle}>
                      Seviye {String(personLevel).padStart(2, "0")}
                    </Text>
                    <Text style={styles.profileDetailLevelBadgeName}>
                      {personBadgeTier.title}
                    </Text>
                  </View>
                  {onOpenLevel ? (
                    <Ionicons name="chevron-forward" size={19} color={COLORS.muted} />
                  ) : null}
                </View>
                {(isSelf || personXp > 0) ? (
                  <View style={styles.profileDetailLevelTrack}>
                    <View
                      style={[
                        styles.profileDetailLevelFill,
                        {
                          width: `${Math.max(
                            6,
                            Math.min(100, Math.round((personLevelProgress.ratio || 0) * 100)),
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </Pressable>

              <View style={styles.profileDetailSection}>
                <Text style={styles.profileDetailSectionTitle}>Hakkında</Text>
                <Text style={styles.profileDetailBio}>
                  {person.bio || "Henüz bir profil açıklaması eklenmemiş."}
                </Text>
                {loading ? (
                  <Text style={styles.profileDetailLoading}>Profil bilgileri yükleniyor…</Text>
                ) : null}
              </View>
            </>
          )}
          {!isSelf ? (
            <View style={styles.profileDetailActions}>
              <Pressable
                onPress={onToggleFollow}
                style={styles.profileDetailFollowButton}
                accessibilityRole="button"
              >
                <Ionicons
                  name={isFollowing ? "heart-dislike-outline" : "heart-outline"}
                  size={18}
                  color="#FFFFFF"
                />
                <Text style={styles.profileDetailFollowText}>
                  {isFollowing ? "Takipten çık" : "Takip et"}
                </Text>
              </Pressable>
              <View style={styles.profileDetailSafetyActions}>
                <Pressable onPress={onReport} style={styles.profileDetailSafetyButton}>
                  <Ionicons name="flag-outline" size={17} color={COLORS.danger} />
                  <Text style={styles.profileDetailSafetyText}>Raporla</Text>
                </Pressable>
                {canBlock ? (
                  <Pressable onPress={onBlock} style={styles.profileDetailSafetyButton}>
                    <Ionicons name="ban-outline" size={17} color={COLORS.danger} />
                    <Text style={styles.profileDetailSafetyText}>Engelle</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
          {!isSelf && staffActions.length ? (
            <View style={styles.profileStaffSection}>
              <Text style={styles.profileDetailSectionTitle}>Oda yönetimi</Text>
              <View style={styles.profileStaffGrid}>
                {staffActions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={() => onStaffAction?.(action.key)}
                    style={[
                      styles.profileStaffButton,
                      action.danger && styles.profileStaffButtonDanger,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Ionicons
                      name={action.icon}
                      size={18}
                      color={action.danger ? COLORS.danger : COLORS.primary}
                    />
                    <Text
                      style={[
                        styles.profileStaffButtonText,
                        action.danger && { color: COLORS.danger },
                      ]}
                      numberOfLines={2}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const ProfileStat = memo(function ProfileStat({ number, label }) {
  return (
    <View style={styles.profileStat}>
      <Text style={styles.profileStatNumber}>{number}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
});

const BottomTabButton = memo(function BottomTabButton({
  tabKey,
  icon,
  activeIcon,
  label,
  selected,
  reducedMotion,
  onSelect,
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion || !selected) {
      scaleAnim.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.04,
        duration: 95,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 130,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [reducedMotion, scaleAnim, selected]);

  const handlePressIn = useCallback(() => {
    if (reducedMotion) return;
    Animated.timing(scaleAnim, {
      toValue: 0.95,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, scaleAnim]);

  const handlePressOut = useCallback(() => {
    if (reducedMotion) return;
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, scaleAnim]);

  return (
    <Pressable
      onPress={() => onSelect(tabKey)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.tabItem,
        selected && styles.tabItemActive,
        !selected && pressed && styles.tabItemPressed,
      ]}
    >
      <Animated.View
        style={[
          styles.tabItemInner,
          !reducedMotion && { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Ionicons
          name={selected ? activeIcon : icon}
          size={20}
          color={selected ? COLORS.primary : COLORS.muted}
        />
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
          style={[styles.tabLabel, selected && styles.tabLabelActive]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

const BottomNavigation = memo(function BottomNavigation({ active, onChange }) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const reducedMotion = useReducedMotion();
  const items = useMemo(
    () => [
      ["discover", "compass-outline", "compass", "Keşfet"],
      ["inbox", "chatbubble-ellipses-outline", "chatbubble-ellipses", "Mesajlar"],
      ["community", "people-outline", "people", "Aile"],
      ["profile", "person-outline", "person", "Profil"],
    ],
    [],
  );
  const handleTabPress = useCallback((key) => onChange(key), [onChange]);
  if (keyboard.visible) return null;
  return (
    <View
      style={[
        styles.bottomNavigation,
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.tabRow}>
        {items.map(([key, icon, activeIcon, label]) => (
          <BottomTabButton
            key={key}
            tabKey={key}
            icon={icon}
            activeIcon={activeIcon}
            label={label}
            selected={active === key}
            reducedMotion={reducedMotion}
            onSelect={handleTabPress}
          />
        ))}
      </View>
    </View>
  );
});

const RoomSettingsSheet = memo(function RoomSettingsSheet({
  visible,
  isHost,
  roomLocked,
  chatLocked,
  canBlockHost,
  onToggleRoomLock,
  onToggleChatLock,
  onReportRoom,
  onBlockHost,
  onInvite,
  onDismiss,
}) {
  const reportRoom = () => {
    onDismiss();
    onReportRoom();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={18} color={COLORS.text} />
          </Pressable>
          <Text style={styles.sheetTitle}>
            {isHost ? "Oda yonetimi" : "Oda bilgileri"}
          </Text>
          <Pressable onPress={onInvite} style={styles.settingRow}>
            <View style={styles.settingIcon}>
              <Ionicons name="share-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Davet et</Text>
              <Text style={styles.settingDescription}>
                Oda bağlantısını paylaş
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
          {isHost ? (
            <>
              <Text style={styles.settingsCaption}>EV SAHIBI KONTROLLERI</Text>
              <Pressable onPress={onToggleRoomLock} style={styles.settingRow}>
                <View
                  style={[
                    styles.settingIcon,
                    roomLocked && styles.settingIconActive,
                  ]}
                >
                  <Ionicons
                    name={roomLocked ? "mic-off-outline" : "list-outline"}
                    size={18}
                    color={roomLocked ? COLORS.primaryInk : COLORS.primary}
                  />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Mikrofon sırası</Text>
                  <Text style={styles.settingDescription}>
                    {roomLocked
                      ? "Yeni sıra istekleri kapalı"
                      : "Dinleyiciler sıraya girebilir"}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.settingState,
                    roomLocked && styles.settingStateActive,
                  ]}
                >
                  {roomLocked ? "Kapalı" : "Açık"}
                </Text>
              </Pressable>
              <Pressable onPress={onToggleChatLock} style={styles.settingRow}>
                <View
                  style={[
                    styles.settingIcon,
                    chatLocked && styles.settingIconActive,
                  ]}
                >
                  <Ionicons
                    name={
                      chatLocked ? "chatbubble-ellipses" : "chatbubble-outline"
                    }
                    size={18}
                    color={chatLocked ? COLORS.primaryInk : COLORS.primary}
                  />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Oda sohbeti</Text>
                  <Text style={styles.settingDescription}>
                    {chatLocked
                      ? "Sadece sen mesaj yazabilirsin"
                      : "Tum dinleyiciler yazabilir"}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.settingState,
                    chatLocked && styles.settingStateActive,
                  ]}
                >
                  {chatLocked ? "Kapali" : "Acik"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.settingsCaption}>ODA KURALLARI</Text>
              <View style={styles.roomRule}>
                <Ionicons
                  name="heart-outline"
                  size={18}
                  color={COLORS.primary}
                />
                <Text style={styles.roomRuleText}>
                  Saygili kal, sirasini bekle ve topluluk kurallarina uy.
                </Text>
              </View>
              <Pressable onPress={reportRoom} style={styles.reportButton}>
                <Ionicons name="flag-outline" size={17} color={COLORS.pink} />
                <Text style={styles.reportButtonText}>Odayi bildir</Text>
              </Pressable>
              {canBlockHost && (
                <Pressable
                  onPress={() => {
                    onDismiss();
                    onBlockHost();
                  }}
                  style={styles.reportButton}
                >
                  <Ionicons name="ban-outline" size={17} color={COLORS.pink} />
                  <Text style={styles.reportButtonText}>
                    Oda sahibini engelle
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
});

const ROOM_GIFT_QUANTITIES = [1, 5, 10, 50, 100];

const GiftSheet = memo(function GiftSheet({
  visible,
  coins,
  userFamilyLevel = 0,
  gifts = GIFT_CATALOG,
  recipients = [],
  onDismiss,
  onSend,
}) {
  const [recipientId, setRecipientId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedGiftId, setSelectedGiftId] = useState(gifts[0]?.id || null);
  useEffect(() => {
    if (visible) {
      setRecipientId((prev) =>
        recipients.some((item) => item.userId === prev)
          ? prev
          : recipients[0]?.userId || null,
      );
      setQuantity(1);
      setSelectedGiftId((prev) =>
        gifts.some((item) => item.id === prev) ? prev : gifts[0]?.id || null,
      );
    }
  }, [visible, recipients, gifts]);
  const selectedRecipient = recipients.find((item) => item.userId === recipientId) || recipients[0] || null;
  const selectedGift = useMemo(
    () => gifts.find((item) => item.id === selectedGiftId) || gifts[0] || null,
    [gifts, selectedGiftId],
  );
  const handlePressSend = () => {
    if (!selectedGift) return;
    const reqLevel = Number(selectedGift.minFamilyLevel || 0);
    if (reqLevel > 0 && Number(userFamilyLevel || 0) < reqLevel) {
      Alert.alert(
        "Aile seviyesi gerekli",
        `Bu hediyeyi göndermek için en az Seviye ${reqLevel} bir ailede yer almalısın.`,
      );
      return;
    }
    if (!selectedRecipient) {
      Alert.alert("Alıcı seç", "Hediyeyi göndereceğin kişiyi seç.");
      return;
    }
    const totalCost = Number(selectedGift.cost || 0) * quantity;
    if (typeof coins === "number" && coins < totalCost) {
      Alert.alert(
        "Bakiye yetersiz",
        `${quantity}x ${selectedGift.name} için ${formatCredits(totalCost)} kredi gerekiyor.`,
      );
      return;
    }
    onSend(selectedGift, selectedRecipient, quantity);
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, styles.roomGiftSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.roomGiftHeader}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.kicker}>ODA HEDİYELERİ</Text>
              <Text numberOfLines={1} style={styles.roomGiftSheetTitle}>
                Hediye gönder
              </Text>
            </View>
            <View style={styles.roomGiftHeaderRight}>
              <View style={styles.coinPill}>
                <Ionicons name="diamond" size={13} color={COLORS.primary} />
                <Text style={styles.coinPillText}>{formatCredits(coins)}</Text>
              </View>
              <Pressable onPress={onDismiss} style={styles.roomGiftCloseBtn}>
                <Ionicons name="close" size={20} color={COLORS.text} />
              </Pressable>
            </View>
          </View>

          <Text style={styles.fieldLabel}>ALICI SEÇ</Text>
          <View style={styles.roomGiftRecipientWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roomGiftRecipientRow}
              style={{ flexGrow: 0, flexShrink: 0 }}
            >
              {recipients.map((recipient) => {
                const active = selectedRecipient?.userId === recipient.userId;
                return (
                  <Pressable
                    key={recipient.userId}
                    onPress={() => setRecipientId(recipient.userId)}
                    style={[
                      styles.roomGiftRecipientCard,
                      active && styles.roomGiftRecipientCardActive,
                    ]}
                  >
                    <View style={[styles.roomGiftAvatarRing, active && styles.roomGiftAvatarRingActive]}>
                      <Avatar
                        circle
                        size={42}
                        uri={recipient.avatarUrl || null}
                        color={recipient.color || COLORS.primary}
                        label={(recipient.name || "S").charAt(0).toUpperCase()}
                      />
                      {active ? (
                        <View style={styles.roomGiftRecipientCheck}>
                          <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.roomGiftRecipientName,
                        active && styles.roomGiftRecipientNameActive,
                      ]}
                    >
                      {recipient.isSelf ? "Kendim" : recipient.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.roomGiftQtyHeader}>
            <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>ADET</Text>
            <View style={styles.roomGiftQtyRow}>
              {ROOM_GIFT_QUANTITIES.map((qty) => {
                const active = quantity === qty;
                return (
                  <Pressable
                    key={qty}
                    onPress={() => setQuantity(qty)}
                    style={[styles.roomGiftQtyPill, active && styles.roomGiftQtyPillActive]}
                  >
                    <Text
                      style={[
                        styles.roomGiftQtyText,
                        active && styles.roomGiftQtyTextActive,
                      ]}
                    >
                      {qty}x
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            style={{ flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <View style={styles.roomGiftGrid3}>
              {gifts.map((gift) => {
                const active = selectedGift?.id === gift.id;
                const lockedByFamily = Number(gift.minFamilyLevel || 0) > Number(userFamilyLevel || 0);
                const totalCost = Number(gift.cost || 0) * quantity;
                return (
                  <Pressable
                    key={gift.id}
                    onPress={() => setSelectedGiftId(gift.id)}
                    style={({ pressed }) => [
                      styles.roomGiftGridCard,
                      active && styles.roomGiftGridCardActive,
                      lockedByFamily && { opacity: 0.65 },
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                  >
                    <View style={{ marginBottom: 7 }}>
                      <SoraGiftArtwork
                        giftId={gift.id}
                        giftName={gift.name}
                        fallbackIcon={gift.icon}
                        fallbackColor={gift.color}
                        size={70}
                      />
                    </View>
                    <Text numberOfLines={1} style={styles.giftName}>
                      {gift.name}
                    </Text>
                    <View style={styles.giftCost}>
                      <Ionicons
                        name={lockedByFamily ? "lock-closed-outline" : "diamond"}
                        size={11}
                        color="#2F80ED"
                      />
                      <Text numberOfLines={1} style={styles.giftCostText}>
                        {lockedByFamily
                          ? `Sv. ${gift.minFamilyLevel} · ${formatCredits(totalCost)}`
                          : formatCredits(totalCost)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {selectedGift ? (
            <View style={styles.roomGiftSendBar}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.roomGiftSendTitle}>
                  {quantity}x {selectedGift.name}
                </Text>
                <Text numberOfLines={1} style={styles.roomGiftSendSub}>
                  {selectedRecipient
                    ? `${selectedRecipient.isSelf ? "Kendim" : selectedRecipient.name} · `
                    : ""}
                  {formatCredits(Number(selectedGift.cost || 0) * quantity)} kredi
                </Text>
              </View>
              <Pressable
                onPress={handlePressSend}
                accessibilityRole="button"
                accessibilityLabel="Hediyeyi gönder"
                style={({ pressed }) => [
                  styles.roomGiftSendBtn,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <Ionicons name="paper-plane" size={15} color="#FFFFFF" />
                <Text style={styles.roomGiftSendBtnText}>Gönder</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
});

/* Bir koltuga/katilimciya uzun basinca acilan kullanici menusu. */
const ParticipantActionSheet = memo(function ParticipantActionSheet({
  participant,
  isFollowing,
  canBlock,
  onViewProfile,
  onToggleFollow,
  onBlock,
  onReport,
  onDismiss,
}) {
  if (!participant) return null;
  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={18} color={COLORS.text} />
          </Pressable>
          <View style={styles.participantSheetHead}>
            <View
              style={[
                styles.participantSheetAvatar,
                { backgroundColor: participant.color || COLORS.accent, overflow: "hidden" },
              ]}
            >
              {participant.avatarUrl ? (
                <Image source={{ uri: participant.avatarUrl }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <Text style={styles.participantSheetInitial}>
                  {participant.name?.charAt(0)?.toUpperCase() || "?"}
                </Text>
              )}
            </View>
            <View style={styles.participantSheetInfo}>
              <Text style={styles.participantSheetName} numberOfLines={1}>
                {participant.name}
              </Text>
              <Text style={styles.participantSheetRole}>
                {participant.role === "host" ? "Ev sahibi" : "Dinleyici"}
              </Text>
            </View>
          </View>
          <Pressable onPress={onViewProfile} style={styles.participantProfileButton}>
            <Ionicons name="person-circle-outline" size={19} color={COLORS.primary} />
            <Text style={styles.participantProfileButtonText}>Profili görüntüle</Text>
            <Ionicons name="chevron-forward" size={17} color={COLORS.muted} />
          </Pressable>
          <Pressable onPress={onToggleFollow} style={styles.settingRow}>
            <View
              style={[styles.settingIcon, isFollowing && styles.settingIconActive]}
            >
              <Ionicons
                name={isFollowing ? "heart" : "heart-outline"}
                size={18}
                color={isFollowing ? COLORS.primaryInk : COLORS.primary}
              />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>
                {isFollowing ? "Takipten çık" : "Takip et"}
              </Text>
              <Text style={styles.settingDescription}>
                Bu kişinin odalarını takip et
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
          <Pressable onPress={onReport} style={styles.settingRow}>
            <View style={styles.settingIcon}>
              <Ionicons name="flag-outline" size={18} color={COLORS.pink} />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Raporla</Text>
              <Text style={styles.settingDescription}>
                Topluluk kurallarına aykırı davranış
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
          {canBlock ? (
            <Pressable onPress={onBlock} style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="ban-outline" size={18} color={COLORS.danger} />
              </View>
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Engelle</Text>
                <Text style={styles.settingDescription}>
                  Mesajlarını gizle ve takibi kaldır
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
});

const SelfRoomSheet = memo(function SelfRoomSheet({
  visible,
  profile,
  avatarUrl,
  roleLabel,
  canLeaveMic,
  onOpenProfile,
  onLeaveMic,
  onDismiss,
}) {
  if (!visible) return null;
  const name = profile?.name || "Sora kullanıcısı";
  const handle = profile?.handle
    ? `@${String(profile.handle).replace(/^@+/, "")}`
    : "";
  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={18} color={COLORS.text} />
          </Pressable>
          <Pressable
            onPress={onOpenProfile}
            style={styles.selfSheetProfileCard}
            accessibilityRole="button"
            accessibilityLabel="Profilime git"
          >
            <Avatar
              label={name.charAt(0).toUpperCase()}
              color={profile?.color || COLORS.primaryLight}
              uri={avatarUrl || null}
              size={64}
              circle
              bordered
            />
            <View style={styles.participantSheetInfo}>
              <Text style={styles.participantSheetName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.participantSheetRole} numberOfLines={1}>
                {[handle, roleLabel].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View style={styles.selfSheetProfilePill}>
              <Text style={styles.selfSheetProfilePillText}>Profil</Text>
              <Ionicons name="chevron-forward" size={15} color={COLORS.primary} />
            </View>
          </Pressable>
          {canLeaveMic ? (
            <Pressable
              onPress={onLeaveMic}
              style={styles.selfSheetLeaveMicBtn}
              accessibilityRole="button"
              accessibilityLabel="Mikrofondan kalk"
            >
              <Ionicons name="arrow-down-circle-outline" size={20} color={COLORS.danger} />
              <Text style={styles.selfSheetLeaveMicText}>Mikrofondan kalk</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
});

/* Konusan kisinin profil cercevesinden yayilan ses dalgasi. */
const SpeakingRing = memo(function SpeakingRing({
  size = 64,
  color = COLORS.primary,
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.7, 0.25, 0],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.speakingRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
});

/* Oda kucultuldugunde ekranda duran, tasinabilir yuvarlak oda balonu. */
const RoomMiniBubble = memo(function RoomMiniBubble({
  room,
  onExpand,
  onLeave,
}) {
  const insets = useSafeAreaInsets();
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastPosition = useRef({ x: 0, y: 0 });
  const clampBubbleOffset = useCallback(
    (rawX, rawY) => {
      const { width, height } = Dimensions.get("window");
      const minX = -Math.max(0, width - 88);
      const maxX = 4;
      const minY = -Math.max(0, height - (insets.bottom + 96) - (insets.top + 72));
      const maxY = 24;
      return {
        x: Math.min(maxX, Math.max(minX, rawX)),
        y: Math.min(maxY, Math.max(minY, rawY)),
      };
    },
    [insets.bottom, insets.top],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
        onPanResponderMove: (_, gesture) => {
          const next = clampBubbleOffset(
            lastPosition.current.x + gesture.dx,
            lastPosition.current.y + gesture.dy,
          );
          drag.setValue(next);
        },
        onPanResponderRelease: () => {
          drag.stopAnimation((value) => {
            const clamped = clampBubbleOffset(value.x, value.y);
            lastPosition.current = clamped;
            drag.setValue(clamped);
          });
        },
      }),
    [clampBubbleOffset, drag],
  );
  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.roomBubble,
        {
          bottom: insets.bottom + 96,
          transform: drag.getTranslateTransform(),
        },
      ]}
    >
      <Pressable
        onPress={onExpand}
        style={styles.roomBubbleAvatar}
        accessibilityRole="button"
        accessibilityLabel="Odaya dön"
      >
        <View
          style={[
            styles.roomBubbleInner,
            { backgroundColor: resolveRoomBrand(room).accent },
          ]}
        >
          <Text style={styles.roomBubbleInitial}>
            {room.initials || room.host?.charAt(0) || "S"}
          </Text>
        </View>
        <View style={styles.roomBubbleLive}>
          <LivePulse size={5} color="#11131A" />
        </View>
      </Pressable>
      <Pressable
        onPress={onLeave}
        style={styles.roomBubbleClose}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Odadan çık"
      >
        <Ionicons name="close" size={12} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
});

const PollSheet = memo(function PollSheet({
  visible,
  poll,
  isHost,
  hasVoted,
  onDismiss,
  onCreate,
  onVote,
}) {
  const [question, setQuestion] = useState("");
  const [firstOption, setFirstOption] = useState("");
  const [secondOption, setSecondOption] = useState("");
  useEffect(() => {
    if (!visible) return;
    setQuestion("");
    setFirstOption("");
    setSecondOption("");
  }, [visible]);
  const createPoll = () => {
    const cleanQuestion = question.trim();
    const options = [firstOption.trim(), secondOption.trim()].filter(Boolean);
    if (!cleanQuestion || options.length < 2) {
      Alert.alert("Anket eksik", "Bir soru ve iki secenek girmelisin.");
      return;
    }
    onCreate({
      question: cleanQuestion.slice(0, 90),
      options: options.slice(0, 2),
      votes: [0, 0],
    });
  };
  const totalVotes = poll
    ? poll.votes.reduce((total, count) => total + count, 0)
    : 0;
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {poll ? (
            <>
              <Text style={styles.kicker}>CANLI ANKET</Text>
              <Text style={styles.sheetTitle}>{poll.question}</Text>
              <Text style={styles.pollCount}>{totalVotes} oy kullanildi</Text>
              <View style={styles.pollOptions}>
                {poll.options.map((option, index) => {
                  const count = poll.votes[index];
                  const percentage = totalVotes
                    ? Math.round((count / totalVotes) * 100)
                    : 0;
                  return (
                    <Pressable
                      disabled={hasVoted}
                      key={option}
                      onPress={() => onVote(index)}
                      style={[
                        styles.pollOption,
                        hasVoted && styles.pollOptionVoted,
                      ]}
                    >
                      <View
                        style={[
                          styles.pollProgress,
                          { width: `${percentage}%` },
                        ]}
                      />
                      <Text style={styles.pollOptionText}>{option}</Text>
                      <Text style={styles.pollOptionValue}>{percentage}%</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.pollHint}>
                {hasVoted
                  ? "Oyun kaydedildi. Sonuclar anlik guncellenir."
                  : "Secenegine dokunarak oy kullan."}
              </Text>
            </>
          ) : isHost ? (
            <>
              <Text style={styles.kicker}>YENI ANKET</Text>
              <Text style={styles.sheetTitle}>Odaya sor.</Text>
              <Text style={styles.fieldLabel}>SORU</Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Orn. Bir sonraki konu ne olsun?"
                placeholderTextColor={COLORS.muted}
                style={styles.sheetInput}
                maxLength={90}
              />
              <Text style={styles.fieldLabel}>BIRINCI SECENEK</Text>
              <TextInput
                value={firstOption}
                onChangeText={setFirstOption}
                placeholder="Secenek 1"
                placeholderTextColor={COLORS.muted}
                style={styles.sheetInput}
                maxLength={32}
              />
              <Text style={styles.fieldLabel}>IKINCI SECENEK</Text>
              <TextInput
                value={secondOption}
                onChangeText={setSecondOption}
                placeholder="Secenek 2"
                placeholderTextColor={COLORS.muted}
                style={styles.sheetInput}
                maxLength={32}
              />
              <Pressable onPress={createPoll}>
                <LinearGradient
                  colors={BRAND_GRADIENT}
                  style={styles.createSubmit}
                >
                  <Text style={styles.createSubmitText}>Anketi başlat</Text>
                  <Ionicons
                    name="bar-chart-outline"
                    size={20}
                    color={COLORS.primaryInk}
                  />
                </LinearGradient>
              </Pressable>
            </>
          ) : (
            <View style={styles.pollEmpty}>
              <Ionicons
                name="bar-chart-outline"
                size={31}
                color={COLORS.muted}
              />
              <Text style={styles.pollEmptyTitle}>Henüz anket yok</Text>
              <Text style={styles.pollHint}>
                Ev sahibi yeni bir anket baslattiginda burada gorunecek.
              </Text>
            </View>
          )}
          </ScrollView>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
});

const WalletSheet = memo(function WalletSheet({
  visible,
  coins,
  promoCoins = 0,
  paidCoins = 0,
  dailyRewardClaimed,
  onDismiss,
  onClaimDailyReward,
  onRefresh,
  activities = [],
}) {
  const [storedActivities, setStoredActivities] = useState([]);
  useEffect(() => {
    if (!visible || isSupabaseConfigured) return;
    AsyncStorage.getItem(WALLET_ACTIVITY_KEY)
      .then((savedActivities) => {
        const parsedActivities = JSON.parse(savedActivities || "[]");
        if (Array.isArray(parsedActivities))
          setStoredActivities(parsedActivities.slice(0, 3));
      })
      .catch(() => undefined);
  }, [visible, coins]);
  useEffect(() => {
    if (visible) onRefresh?.();
  }, [visible]);
  const visibleActivities = isSupabaseConfigured
    ? activities
    : activities.length
      ? activities
      : storedActivities;
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, styles.walletSheet]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.walletScroll}
          >
            <Text style={styles.kicker}>KREDİ CÜZDANI</Text>
            <LinearGradient
              colors={["#111820", "#1D2E43"]}
              style={styles.walletBalanceCard}
            >
              <View>
                <Text style={styles.walletBalanceLabel}>
                  KULLANILABİLİR BAKİYE
                </Text>
                <Text style={styles.walletBalanceAmount}>
                  {formatCredits(coins)} <Text style={styles.walletBalanceUnit}>kredi</Text>
                </Text>
                <Text style={styles.walletActivityTime}>
                  Promosyon {formatCredits(promoCoins)} · Satın alınan {formatCredits(paidCoins)}
                </Text>
              </View>
              <View style={styles.walletBalanceIcon}>
                <Ionicons name="diamond" size={28} color="#6AA8F5" />
              </View>
            </LinearGradient>
            <Text style={styles.settingsCaption}>GÜNLÜK ÖDÜL</Text>
            <View style={styles.walletRewardRow}>
              <View
                style={[
                  styles.walletRewardIcon,
                  dailyRewardClaimed && {
                    backgroundColor: COLORS.primary,
                    borderColor: COLORS.primary,
                  },
                ]}
              >
                <Ionicons
                  name={dailyRewardClaimed ? "checkmark" : "gift-outline"}
                  size={19}
                  color={dailyRewardClaimed ? COLORS.primaryInk : "#6AA8F5"}
                />
              </View>
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>
                  {dailyRewardClaimed
                    ? "Bugünün ödülü alındı"
                    : "Her gün giriş ödülü"}
                </Text>
                <Text style={styles.settingDescription}>
                  {dailyRewardClaimed
                    ? `Yarın yeniden ${formatCredits(DAILY_REWARD_AMOUNT)} kredi kazanabilirsin.`
                    : `Tek dokunuşla ${formatCredits(DAILY_REWARD_AMOUNT)} kredi kazan.`}
                </Text>
              </View>
              <Pressable
                disabled={dailyRewardClaimed}
                onPress={onClaimDailyReward}
                style={[
                  styles.walletClaimButton,
                  dailyRewardClaimed && styles.walletClaimButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.walletClaimText,
                    dailyRewardClaimed && styles.walletClaimTextDisabled,
                  ]}
                >
                  {dailyRewardClaimed ? "Alındı" : `+${formatCredits(DAILY_REWARD_AMOUNT)} al`}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.settingsCaption}>MAĞAZA İLE KREDİ YÜKLE</Text>
            <View style={styles.transferCard}>
              <Text style={styles.transferTitle}>
                {Platform.OS === "android"
                  ? "Google Play üzerinden kredi yükleme"
                  : Platform.OS === "ios"
                    ? "App Store üzerinden kredi yükleme"
                    : "Mağaza satın alımları"}
              </Text>
              <Text style={styles.transferHint}>
                {Platform.OS === "web"
                  ? "Kredi paketleri web sürümünde satılmaz. Android'de Google Play, iOS'ta App Store kullanılacaktır."
                  : "Mağaza ürünleri ve sunucu doğrulaması yapılandırılana kadar satın alma kapalıdır. Ürün adı ve yerel fiyat mağazadan alınacaktır."}
              </Text>
            </View>
            {visibleActivities.length > 0 && (
              <>
                <Text style={styles.settingsCaption}>SON HAREKETLER</Text>
                <View style={styles.walletActivityList}>
                  {visibleActivities.map((activity) => (
                    <View key={activity.id} style={styles.walletActivityRow}>
                      <View
                        style={[
                          styles.walletActivityIcon,
                          { backgroundColor: activity.color },
                        ]}
                      >
                        <Ionicons
                          name={activity.icon}
                          size={15}
                          color="#FFFFFF"
                        />
                      </View>
                      <View style={styles.settingContent}>
                        <Text style={styles.walletActivityText}>
                          {activity.text}
                        </Text>
                        <Text style={styles.walletActivityTime}>
                          {activity.time}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.walletActivityAmount,
                          activity.amount > 0 && styles.walletActivityPositive,
                        ]}
                      >
                        {activity.amount > 0
                          ? `+${activity.amount}`
                          : activity.amount}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            <Text style={styles.walletFootnote}>
              Kredilerini odalardaki hediyeleri göndermek için kullanabilirsin.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const RoomLobby = memo(function RoomLobby({
  room,
  profile,
  onJoin,
  onLeave,
  autoJoinMuted = true,
}) {
  const [microphoneEnabled, setMicrophoneEnabled] = useState(
    () => !autoJoinMuted,
  );
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("checking");
  const [checkingConnection, setCheckingConnection] = useState(false);
  const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(
    /\/$/,
    "",
  );

  const checkVoiceService = async () => {
    if (!tokenServerUrl) {
      setVoiceStatus("demo");
      return;
    }
    setCheckingConnection(true);
    setVoiceStatus("checking");
    try {
      const response = await fetch(`${tokenServerUrl}/health`);
      setVoiceStatus(response.ok ? "ready" : "offline");
    } catch {
      setVoiceStatus("offline");
    } finally {
      setCheckingConnection(false);
    }
  };

  useEffect(() => {
    checkVoiceService();
  }, [tokenServerUrl]);
  const checkMicrophone = async () => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (permission.granted) {
      Alert.alert(
        "Mikrofon hazır",
        "İzin verildi. Odaya girince mikrofonunu açabilirsin.",
      );
      return;
    }
    Alert.alert(
      "Mikrofon izni gerekli",
      "Android ayarlarından Sora için mikrofon iznini açmalısın.",
    );
  };
  const voiceInfo =
    voiceStatus === "ready"
      ? {
          icon: "cloud-done",
          title: "Bağlantı servisi hazır",
          description:
            "Token servisine ulaşıldı. Ses altyapısı bağlanmaya hazır.",
          style: styles.voiceReadinessReady,
        }
      : voiceStatus === "offline"
        ? {
            icon: "cloud-offline-outline",
            title: "Bağlantı servisi çevrimdışı",
            description: "Sunucu erişilemedi; canlı ses bağlantısı kurulamaz.",
            style: styles.voiceReadinessOffline,
          }
        : voiceStatus === "demo"
          ? {
              icon: "mic-outline",
              title: "Mikrofon hazır",
              description:
                "Canlı odaya bağlanmak için ses sunucusu yapılandırılmalı.",
              style: styles.voiceReadinessDemo,
            }
          : {
              icon: "sync-outline",
              title: "Bağlantı kontrol ediliyor",
              description: "Sunucu durumu hazırlanıyor.",
              style: styles.voiceReadinessDemo,
            };
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.lobbyScreen}>
        <View style={styles.lobbyHeader}>
          <IconButton icon="chevron-back" onPress={onLeave} />
          <Text style={styles.lobbyHeaderTitle}>Odaya katıl</Text>
          <View style={styles.lobbyHeaderSpacer} />
        </View>
        <View style={styles.lobbyContent}>
          <LinearGradient colors={resolveRoomBrand(room).colors} style={styles.lobbyArtwork}>
            <View style={styles.lobbyOrb} />
            <Text style={styles.lobbyLive}>
              <Text style={styles.liveDot}>●</Text> {room.listeners} kişi
              dinliyor
            </Text>
            <Avatar label={room.initials} color="#679DE8" size={82} bordered />
            <Text style={styles.lobbyHost}>{room.host}</Text>
            <Text style={styles.lobbyHostRole}>EV SAHİBİ</Text>
          </LinearGradient>
          <Text style={styles.lobbyTitle}>{room.title}</Text>
          <Text style={styles.lobbyDescription}>{room.description}</Text>
          <View style={styles.lobbyNotice}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={COLORS.primary}
            />
            <Text style={styles.lobbyNoticeText}>
              Dinleyici olarak katılabilir, istediğin zaman konuşma isteği
              gönderebilirsin.
            </Text>
          </View>
          <View style={[styles.voiceReadiness, voiceInfo.style]}>
            <Ionicons name={voiceInfo.icon} size={18} color={COLORS.primary} />
            <View style={styles.voiceReadinessText}>
              <Text style={styles.voiceReadinessTitle}>{voiceInfo.title}</Text>
              <Text style={styles.voiceReadinessDescription}>
                {voiceInfo.description}
              </Text>
            </View>
          </View>
          <View style={styles.lobbyCheckRow}>
            <Pressable
              onPress={checkMicrophone}
              style={styles.lobbyCheckButton}
            >
              <Ionicons name="mic-outline" size={16} color={COLORS.primary} />
              <Text style={styles.lobbyCheckText}>Mikrofonu test et</Text>
            </Pressable>
            <Pressable
              onPress={checkVoiceService}
              disabled={checkingConnection}
              style={styles.lobbyCheckButton}
            >
              <Ionicons
                name={checkingConnection ? "sync" : "refresh-outline"}
                size={16}
                color={COLORS.primary}
              />
              <Text style={styles.lobbyCheckText}>
                {checkingConnection ? "Kontrol ediliyor" : "Bağlantıyı yenile"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.lobbyControls}>
            <Pressable
              onPress={() => setMicrophoneEnabled((value) => !value)}
              style={[
                styles.lobbyControl,
                microphoneEnabled && styles.lobbyControlActive,
              ]}
            >
              <Ionicons
                name={microphoneEnabled ? "mic" : "mic-off"}
                size={21}
                color={microphoneEnabled ? COLORS.primaryInk : COLORS.text}
              />
              <Text
                style={[
                  styles.lobbyControlText,
                  microphoneEnabled && styles.lobbyControlTextActive,
                ]}
              >
                {microphoneEnabled ? "Mikrofon açık" : "Mikrofon kapalı"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSpeakerEnabled((value) => !value)}
              style={[
                styles.lobbyControl,
                speakerEnabled && styles.lobbyControlActive,
              ]}
            >
              <Ionicons
                name={speakerEnabled ? "volume-high" : "volume-mute"}
                size={21}
                color={speakerEnabled ? COLORS.primaryInk : COLORS.text}
              />
              <Text
                style={[
                  styles.lobbyControlText,
                  speakerEnabled && styles.lobbyControlTextActive,
                ]}
              >
                {speakerEnabled ? "Hoparlör açık" : "Sessiz"}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.lobbyFooter}>
          <Text style={styles.lobbyProfile}>
            @{profile.handle} olarak katılıyorsun
          </Text>
          <Pressable
            onPress={() => onJoin({ microphoneEnabled, speakerEnabled })}
          >
            <LinearGradient colors={BRAND_GRADIENT} style={styles.lobbyJoin}>
              <View>
                <Text style={styles.lobbyJoinTitle}>Odaya katıl</Text>
                <Text style={styles.lobbyJoinSubtitle}>
                  {microphoneEnabled
                    ? "Mikrofon izni istenebilir"
                    : "Dinleyici modunda"}
                </Text>
              </View>
              <Ionicons
                name="arrow-forward"
                size={22}
                color={COLORS.primaryInk}
              />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
});

const ParticipantList = memo(function ParticipantList({ room }) {
  const [visible, setVisible] = useState(false);
  const [followedNames, setFollowedNames] = useState([]);
  const [blockedNames, setBlockedNames] = useState([]);
  // Katilimcilar LiveKit'ten gelmelidir; sabit demo isimleri kullanilmaz.
  const participants = [
    { name: room.host, initial: room.initials, color: "#679DE8", host: true },
  ];

  useEffect(() => {
    AsyncStorage.getItem(FOLLOWED_USERS_KEY)
      .then((savedNames) => {
        const parsedNames = JSON.parse(savedNames || "[]");
        if (Array.isArray(parsedNames)) setFollowedNames(parsedNames);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(BLOCKED_USERS_KEY)
      .then((savedNames) => {
        const parsedNames = JSON.parse(savedNames || "[]");
        if (Array.isArray(parsedNames)) setBlockedNames(parsedNames);
      })
      .catch(() => undefined);
  }, []);

  const toggleFollow = (name) =>
    setFollowedNames((currentNames) => {
      const nextNames = currentNames.includes(name)
        ? currentNames.filter((item) => item !== name)
        : [...currentNames, name];
      AsyncStorage.setItem(FOLLOWED_USERS_KEY, JSON.stringify(nextNames)).catch(
        () => undefined,
      );
      return nextNames;
    });

  const toggleBlock = (name) =>
    setBlockedNames((currentNames) => {
      const nextNames = currentNames.includes(name)
        ? currentNames.filter((item) => item !== name)
        : [...currentNames, name];
      AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(nextNames)).catch(
        () => undefined,
      );
      return nextNames;
    });

  return (
    <>
      <Pressable onPress={() => setVisible(true)} style={styles.audienceBar}>
        <View style={styles.audienceAvatars}>
          {participants.slice(0, 4).map((participant, index) => (
            <View
              key={`${participant.name}-${index}`}
              style={[
                styles.audienceAvatar,
                {
                  backgroundColor: participant.color,
                  marginLeft: index ? -8 : 0,
                },
              ]}
            >
              <Text style={styles.audienceInitial}>{participant.initial}</Text>
            </View>
          ))}
        </View>
        <View style={styles.audienceCopy}>
          <Text style={styles.audienceTitle}>
            Sahnede {participants.length} kisi
          </Text>
          <Text style={styles.audienceSubtitle}>Katilimcilari gor</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      </Pressable>
      <Modal
        transparent
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalDismiss}
            onPress={() => setVisible(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Pressable
              onPress={() => setVisible(false)}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={18} color={COLORS.text} />
            </Pressable>
            <Text style={styles.sheetTitle}>Katilimcilar</Text>
            <Text style={styles.settingsCaption}>
              {room.listeners} DINLEYICI · {participants.length} KONUSMACI
            </Text>
            {participants.map((participant, index) => {
              const followed = followedNames.includes(participant.name);
              const blocked = blockedNames.includes(participant.name);
              return (
                <View
                  key={`${participant.name}-${index}`}
                  style={styles.participantRow}
                >
                  <Avatar
                    label={participant.initial}
                    color={participant.color}
                    size={43}
                  />
                  <View style={styles.participantInfo}>
                    <Text style={styles.participantName}>
                      {participant.name}
                    </Text>
                    <Text style={styles.participantRole}>
                      {participant.host
                        ? "Ev sahibi"
                        : blocked
                          ? "Engellendi"
                          : "Konusmaci"}
                    </Text>
                  </View>
                  {!participant.host && (
                    <View style={styles.participantActions}>
                      <Pressable
                        onPress={() => toggleFollow(participant.name)}
                        style={[
                          styles.followButton,
                          followed && styles.followButtonActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.followButtonText,
                            followed && styles.followButtonTextActive,
                          ]}
                        >
                          {followed ? "Takiptesin" : "Takip et"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleBlock(participant.name)}
                        style={[
                          styles.participantBlockButton,
                          blocked && styles.participantBlockButtonActive,
                        ]}
                      >
                        <Ionicons
                          name={blocked ? "shield-checkmark" : "shield-outline"}
                          size={16}
                          color={blocked ? COLORS.primaryInk : COLORS.pink}
                        />
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
});

const LiveParticipantList = memo(function LiveParticipantList({
  participants,
  canModerate,
  isHost,
  currentUserId,
  onModerate,
  onReport,
  onBlock,
  compact = false,
}) {
  const [visible, setVisible] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const roleLabel = {
    host: "Yönetici",
    moderator: "Moderatör",
    speaker: "Konuşmacı",
    listener: "Dinleyici",
  };
  const runAction = async (participant, action) => {
    setWorkingId(`${participant.userId}-${action}`);
    try {
      await onModerate(participant, action);
    } catch (error) {
      Alert.alert(
        "İşlem yapılamadı",
        error instanceof Error ? error.message : "Tekrar dene.",
      );
    } finally {
      setWorkingId(null);
    }
  };
  if (participants.length === 0) return null;
  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${participants.length} katılımcıyı gör`}
        style={compact ? styles.roomAudienceButton : styles.audienceBar}
      >
        {compact ? (
          <>
            <Ionicons name="people-outline" size={17} color={COLORS.primary} />
            <Text style={styles.roomAudienceCount}>{participants.length}</Text>
          </>
        ) : (
          <>
            <View style={styles.audienceAvatars}>
              {participants.slice(0, 4).map((participant, index) => (
                <View
                  key={participant.userId}
                  style={[
                    styles.audienceAvatar,
                    {
                      backgroundColor: participant.color,
                      marginLeft: index ? -8 : 0,
                    },
                  ]}
                >
                  <Text style={styles.audienceInitial}>
                    {participant.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.audienceCopy}>
              <Text style={styles.audienceTitle}>
                Odada {participants.length} kişi
              </Text>
              <Text style={styles.audienceSubtitle}>
                Katılımcıları ve rolleri gör
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </>
        )}
      </Pressable>
      <Modal
        transparent
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalDismiss}
            onPress={() => setVisible(false)}
          />
          <View style={[styles.sheet, styles.memberSheet]}>
            <View style={styles.sheetHandle} />
            <Pressable
              onPress={() => setVisible(false)}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={18} color={COLORS.text} />
            </Pressable>
            <Text style={styles.kicker}>CANLI KATILIMCILAR</Text>
            <Text style={styles.sheetTitle}>
              {participants.length} kişi odada
            </Text>
            <Text style={styles.memberHint}>
              {canModerate
                ? "Rol, mikrofon ve oda erişimini buradan yönetebilirsin."
                : "Canlı odadaki aktif katılımcılar."}
            </Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.memberList}
            >
              {participants.map((participant) => {
                const canAct =
                  canModerate &&
                  participant.userId !== currentUserId &&
                  participant.role !== "host";
                const canUseSafety = participant.userId !== currentUserId;
                const isWorking = workingId?.startsWith(
                  `${participant.userId}-`,
                );
                return (
                  <View key={participant.userId} style={styles.memberRow}>
                    <Avatar
                      label={participant.name.charAt(0).toUpperCase()}
                      color={participant.color}
                      size={42}
                    />
                    <View style={styles.memberInfo}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.participantName}>
                          {participant.name}
                        </Text>
                        {participant.isMuted && (
                          <Ionicons
                            name="mic-off"
                            size={13}
                            color={COLORS.pink}
                          />
                        )}
                      </View>
                      <Text style={styles.memberRole}>
                        {roleLabel[participant.role] || "Dinleyici"}
                        {participant.microphoneEnabled
                          ? " · Mikrofon açık"
                          : ""}
                      </Text>
                    </View>
                    <View style={styles.memberActions}>
                      {canAct && (
                        <>
                          {participant.role === "listener" ? (
                            <Pressable
                              disabled={isWorking}
                              onPress={() =>
                                runAction(participant, "promote_speaker")
                              }
                              style={styles.memberAction}
                            >
                              <Ionicons
                                name="mic"
                                size={14}
                                color={COLORS.primary}
                              />
                            </Pressable>
                          ) : (
                            <Pressable
                              disabled={isWorking}
                              onPress={() =>
                                runAction(
                                  participant,
                                  participant.isMuted ? "unmute" : "mute",
                                )
                              }
                              style={styles.memberAction}
                            >
                              <Ionicons
                                name={participant.isMuted ? "mic" : "mic-off"}
                                size={14}
                                color={COLORS.primary}
                              />
                            </Pressable>
                          )}
                          {participant.role === "speaker" && (
                            <Pressable
                              disabled={isWorking}
                              onPress={() =>
                                runAction(participant, "demote_listener")
                              }
                              style={styles.memberAction}
                            >
                              <Ionicons
                                name="arrow-down"
                                size={14}
                                color={COLORS.primary}
                              />
                            </Pressable>
                          )}
                          {isHost && (
                            <Pressable
                              disabled={isWorking}
                              onPress={() =>
                                runAction(
                                  participant,
                                  participant.role === "moderator"
                                    ? "remove_moderator"
                                    : "make_moderator",
                                )
                              }
                              style={styles.memberAction}
                            >
                              <Ionicons
                                name="shield"
                                size={14}
                                color={COLORS.primary}
                              />
                            </Pressable>
                          )}
                          <Pressable
                            disabled={isWorking}
                            onPress={() => runAction(participant, "remove")}
                            style={[
                              styles.memberAction,
                              styles.memberRemoveAction,
                            ]}
                          >
                            <Ionicons
                              name="exit-outline"
                              size={14}
                              color={COLORS.pink}
                            />
                          </Pressable>
                        </>
                      )}
                      {canUseSafety && (
                        <>
                          <Pressable
                            onPress={() => {
                              setVisible(false);
                              onReport(participant);
                            }}
                            style={styles.memberAction}
                          >
                            <Ionicons
                              name="flag-outline"
                              size={14}
                              color={COLORS.pink}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              setVisible(false);
                              onBlock(participant);
                            }}
                            style={[
                              styles.memberAction,
                              styles.memberRemoveAction,
                            ]}
                          >
                            <Ionicons
                              name="ban-outline"
                              size={14}
                              color={COLORS.pink}
                            />
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
});

function CreateRoomSheet({ visible, onDismiss, onCreate }) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Sohbet");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const create = async () => {
    if (submitting) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      Alert.alert("Oda adı gerekli", "Devam etmek için odana bir ad ver.");
      return;
    }
    const theme = ROOM_THEMES[0];
    setSubmitting(true);
    try {
      const created = await onCreate({
        id: `room-${Date.now()}`,
        title: cleanTitle,
        category,
        listeners: 1,
        colors: theme.colors,
        accent: theme.accent,
        description: description.trim().slice(0, 90),
      });
      if (created) {
        setTitle("");
        setDescription("");
        setCategory("Sohbet");
      }
    } catch {
      Alert.alert("Oda oluşturulamadı", "Bağlantıyı kontrol edip tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <ScrollView
          style={styles.createRoomSheetScroll}
          contentContainerStyle={styles.createRoomSheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.sheet,
              styles.createRoomSheet,
              { paddingBottom: Math.max(insets.bottom, 24) + 16 },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Pressable onPress={onDismiss} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={COLORS.text} />
            </Pressable>
            <Text style={styles.kicker}>YENİ SESLİ ODA</Text>
            <Text style={styles.sheetTitle}>Bir oda aç.</Text>
            <Text style={styles.fieldLabel}>KATEGORİ</Text>
            <View style={styles.sheetCategories}>
              {CATEGORIES.slice(1).map((item) => (
                <Pressable
                  key={item.name}
                  onPress={() => setCategory(item.name)}
                  style={[
                    styles.sheetCategory,
                    category === item.name && styles.sheetCategoryActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetCategoryText,
                      category === item.name && styles.sheetCategoryTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>ODA ADI</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Örn. Kahve arası"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={36}
            />
            <Text style={styles.fieldLabel}>KISA AÇIKLAMA</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Odanın konusunu anlat"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={90}
              multiline
            />
            <Pressable onPress={create} disabled={submitting}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                style={styles.createSubmit}
              >
                <Text style={styles.createSubmitText}>
                  {submitting ? "Oda açılıyor..." : "Odayı oluştur"}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={COLORS.primaryInk}
                />
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardSafeView>
    </Modal>
  );
}

function ScheduleRoomSheet({ visible, onDismiss, onSchedule }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Sohbet");
  const [startsAt, setStartsAt] = useState("");
  const schedule = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      Alert.alert("Oda adi gerekli", "Planlamak icin odana bir ad ver.");
      return;
    }
    const scheduledDate = parseScheduledDate(startsAt);
    if (!scheduledDate) {
      Alert.alert(
        "Gecerli bir zaman gir",
        "Bugun 21:30, Yarin 18:00 veya 07.11.2026 21:30 bicimlerinden birini kullan.",
      );
      return;
    }
    onSchedule({
      id: `scheduled-${Date.now()}`,
      title: cleanTitle,
      category,
      startsAt: formatScheduledDate(scheduledDate),
      startsAtIso: scheduledDate.toISOString(),
    });
    setTitle("");
    setStartsAt("");
    setCategory("Sohbet");
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.kicker}>PLANLI SESLİ ODA</Text>
            <Text style={styles.sheetTitle}>Buluşmayı ayarla.</Text>
            <Text style={styles.fieldLabel}>ODA ADI</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Örn. Hafta sonu sohbeti"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={36}
            />
            <Text style={styles.fieldLabel}>NE ZAMAN?</Text>
            <TextInput
              value={startsAt}
              onChangeText={setStartsAt}
              placeholder="Örn. Bugün 21:30"
              placeholderTextColor={COLORS.muted}
              style={styles.sheetInput}
              maxLength={28}
            />
            <Text style={styles.fieldLabel}>KATEGORİ</Text>
            <View style={styles.sheetCategories}>
              {CATEGORIES.slice(1).map((item) => (
                <Pressable
                  key={item.name}
                  onPress={() => setCategory(item.name)}
                  style={[
                    styles.sheetCategory,
                    category === item.name && styles.sheetCategoryActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetCategoryText,
                      category === item.name && styles.sheetCategoryTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={schedule}>
              <LinearGradient colors={BRAND_GRADIENT} style={styles.createSubmit}>
                <Text style={styles.createSubmitText}>Odayı planla</Text>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={COLORS.primaryInk}
                />
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
}

const USER_ROOMS_KEY = "@sora/user-created-rooms";
const FAVORITE_ROOMS_KEY = "@sora/favorite-room-ids";
const RECENT_ROOMS_KEY = "@sora/recent-room-ids";
const PROFILE_KEY = "@sora/profile";
const NOTIFICATIONS_KEY = "@sora/notifications";
const FOLLOWED_USERS_KEY = "@sora/followed-user-names";
const BLOCKED_USERS_KEY = "@sora/blocked-user-names";
const SCHEDULED_ROOMS_KEY = "@sora/scheduled-rooms";
const REMINDER_ROOM_IDS_KEY = "@sora/reminder-room-ids";
const APP_SETTINGS_KEY = "@sora/app-settings";
const ONBOARDING_KEY = "@sora/onboarding-complete";
const WALLET_BALANCE_KEY = "@sora/wallet-balance";
const WALLET_ACTIVITY_KEY = "@sora/wallet-activity";
const ROOM_HISTORY_KEY = "@sora/room-history";
const ROOM_MESSAGES_KEY = "@sora/room-messages";
const ACTIVITY_STREAK_KEY = "@sora/activity-streak";
const DAILY_REWARD_KEY = "@sora/daily-reward-date";
const COMMUNITY_EVENT_RSVPS_KEY = "@sora/community-event-rsvps";
const CUSTOM_CHATS_KEY = "@sora/custom-chats";
const CHAT_MESSAGES_KEY = "@sora/chat-messages";
const JOINED_GROUPS_KEY = "@sora/joined-groups";
const USER_COMMUNITIES_KEY = "@sora/user-communities";
const DEFAULT_PROFILE = {
  name: "",
  handle: "",
  color: "#80ADE6",
  bio: "",
};
const DEFAULT_NOTIFICATIONS = [
  {
    id: "welcome",
    icon: "sparkles",
    color: "#5D4FC1",
    text: "Sora'ya hos geldin. Ilk odani kesfet.",
    time: "Simdi",
  },
  {
    id: "night",
    icon: "moon",
    color: "#3979D2",
    text: "Gece Vardiyasi odasi canli yayinda.",
    time: "12 dk",
  },
];
const DEFAULT_SCHEDULED_ROOMS = [
  {
    id: "scheduled-weekend",
    title: "Hafta sonu serbest mikrofon",
    category: "Sohbet",
    startsAt: "Cumartesi 20:30",
    host: "Sora Ekibi",
  },
  {
    id: "scheduled-music",
    title: "Yeni sarkilar paylasimi",
    category: "Muzik",
    startsAt: "Pazar 18:00",
    host: "Melis",
  },
];
const DEFAULT_APP_SETTINGS = {
  chatNotifications: true,
  roomReminders: true,
  profilePublic: true,
  autoJoinMuted: true,
};
const DEFAULT_WALLET_BALANCE = 1250;
const DAILY_REWARD_AMOUNT = DAILY_REWARD_COINS;
// Canlı uygulamada örnek oda, kullanıcı ve bildirim hiçbir koşulda gösterilmez.
// Test verisi yalnızca geliştirme aracında özellikle açıldığında kullanılmalıdır.
const DEMO_CONTENT_ENABLED = false;
const SEEDED_ROOMS = DEMO_CONTENT_ENABLED ? INITIAL_ROOMS : [];
const SEEDED_SCHEDULED_ROOMS = DEMO_CONTENT_ENABLED
  ? DEFAULT_SCHEDULED_ROOMS
  : [];
const SEEDED_NOTIFICATIONS = DEMO_CONTENT_ENABLED ? DEFAULT_NOTIFICATIONS : [];
const SEEDED_CHATS = DEMO_CONTENT_ENABLED ? DEFAULT_CHATS : [];
const SEEDED_COMMUNITIES = DEMO_CONTENT_ENABLED ? DEFAULT_COMMUNITIES : [];
const SEEDED_WALLET_BALANCE = DEMO_CONTENT_ENABLED ? DEFAULT_WALLET_BALANCE : 0;
const APP_STORAGE_KEYS = [
  USER_ROOMS_KEY,
  FAVORITE_ROOMS_KEY,
  RECENT_ROOMS_KEY,
  PROFILE_KEY,
  NOTIFICATIONS_KEY,
  FOLLOWED_USERS_KEY,
  BLOCKED_USERS_KEY,
  SCHEDULED_ROOMS_KEY,
  REMINDER_ROOM_IDS_KEY,
  APP_SETTINGS_KEY,
  ONBOARDING_KEY,
  WALLET_BALANCE_KEY,
  WALLET_ACTIVITY_KEY,
  ROOM_HISTORY_KEY,
  ROOM_MESSAGES_KEY,
  ACTIVITY_STREAK_KEY,
  DAILY_REWARD_KEY,
  COMMUNITY_EVENT_RSVPS_KEY,
  CUSTOM_CHATS_KEY,
  CHAT_MESSAGES_KEY,
  JOINED_GROUPS_KEY,
  USER_COMMUNITIES_KEY,
];

const RoomControl = memo(function RoomControl({
  icon,
  label,
  active = false,
  danger = false,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label || icon}
      hitSlop={6}
      style={styles.roomControl}
    >
      <View
        style={[
          styles.roomControlIcon,
          active && styles.roomControlActive,
          danger && styles.roomControlDanger,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={active ? COLORS.primaryInk : COLORS.text}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.roomControlLabel,
          active && styles.roomControlLabelActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const RoomComposer = memo(function RoomComposer({
  onSend,
  onOpenGift,
  sending,
}) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(async () => {
    const clean = value.trim();
    if (!clean) return;
    setValue("");
    const sent = await onSend(clean);
    if (sent === false) {
      // Gönderim başarısız olduysa taslağı geri getir.
      setValue((current) => (current ? current : clean));
    }
  }, [onSend, value]);

  const handleChange = useCallback((next) => setValue(next), []);

  const hasText = Boolean(value.trim());
  return (
    <View style={styles.roomInputPill}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        onSubmitEditing={handleSubmit}
        placeholder="Bir şeyler yaz…"
        placeholderTextColor="#8193AA"
        accessibilityLabel="Oda mesajı"
        style={styles.roomInputField}
        maxLength={160}
        returnKeyType="send"
        blurOnSubmit={false}
      />
      {hasText || sending ? (
        <Pressable
          disabled={sending}
          onPress={handleSubmit}
          style={[styles.roomInputSend, sending && styles.sendButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={sending ? "Mesaj gönderiliyor" : "Mesajı gönder"}
        >
          <Ionicons
            name={sending ? "hourglass-outline" : "send"}
            size={13}
            color="#FFFFFF"
          />
        </Pressable>
      ) : null}
    </View>
  );
});

const RoomMessageRow = memo(function RoomMessageRow({
  item,
  canReport,
  senderAvatarUrl = null,
  senderColor = "#2F80ED",
  onPressSender,
  onReport,
}) {
  const handleReport = useCallback(() => onReport(item), [onReport, item]);
  const handleSenderPress = useCallback(() => {
    if (!item.system && !item.announcement && item.userId) {
      onPressSender?.(item);
    }
  }, [item, onPressSender]);
  const showAvatar = !item.system && !item.announcement;
  const isGiftMsg = item.kind === "gift";
  const giftMeta = item.metadata || {};

  return (
    <View style={styles.messageRow}>
      {showAvatar ? (
        <Pressable
          onPress={handleSenderPress}
          disabled={!item.userId}
          hitSlop={4}
          accessibilityLabel={`${item.user || "Kullanıcı"} profili`}
          style={styles.roomMessageAvatarPress}
        >
          <Avatar
            circle
            size={28}
            uri={senderAvatarUrl}
            color={senderColor || "#2F80ED"}
            label={(item.user || "S").charAt(0).toUpperCase()}
          />
        </Pressable>
      ) : null}
      <View
        style={[
          styles.messageBubble,
          item.system && styles.messageBubbleSystem,
          item.announcement && styles.messageBubbleAnnouncement,
          isGiftMsg && styles.messageBubbleGift,
        ]}
      >
        {item.announcement ? (
          <Ionicons
            name="megaphone"
            size={13}
            color="#9CC6FF"
            style={styles.messageAnnouncementIcon}
          />
        ) : null}
        {isGiftMsg ? (
          <View style={{ marginRight: 7 }}>
            <SoraGiftArtwork
              giftId={giftMeta.gift_id}
              giftName={giftMeta.gift_name}
              fallbackIcon={giftMeta.gift_icon}
              fallbackColor={giftMeta.gift_color}
              size={28}
            />
          </View>
        ) : null}
        <Text
          style={[
            styles.messageText,
            item.system && styles.systemMessage,
            item.announcement && styles.announcementMessage,
            item.pending && styles.pendingMessage,
          ]}
        >
          {item.system ? (
            item.text
          ) : (
            <>
              <Text style={styles.messageUser}>{item.user}</Text> {item.text}
              {item.pending ? " · gönderiliyor" : ""}
            </>
          )}
        </Text>
      </View>
      {canReport ? (
        <Pressable
          accessibilityLabel="Mesajı bildir"
          onPress={handleReport}
          style={styles.messageReportButton}
        >
          <Ionicons name="flag-outline" size={12} color={COLORS.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const RoomMessageList = memo(function RoomMessageList({
  messages,
  canReportBase,
  userId,
  currentProfile,
  participantById,
  onPressSender,
  onReport,
}) {
  return (
    <View style={styles.messageList}>
      {messages.map((item) => {
        const mapped = item.userId ? participantById?.get(item.userId) : null;
        const isSelf = Boolean(userId && item.userId === userId);
        const senderAvatarUrl =
          item.avatarUrl
          || mapped?.avatarUrl
          || (isSelf ? currentProfile?.avatarUrl || null : null);
        const senderColor =
          item.avatarColor
          || mapped?.color
          || (isSelf ? currentProfile?.color || COLORS.primary : "#2F80ED");
        return (
          <RoomMessageRow
            key={item.id}
            item={item}
            senderAvatarUrl={senderAvatarUrl}
            senderColor={senderColor}
            onPressSender={onPressSender}
            canReport={Boolean(
              canReportBase &&
              !item.system &&
              !item.pending &&
              item.userId &&
              item.userId !== userId,
            )}
            onReport={onReport}
          />
        );
      })}
    </View>
  );
});

const roomDetailsFrom = (room) => ({
  title: room.title,
  description: room.description || "",
  announcement: room.announcement || DEFAULT_ROOM_ANNOUNCEMENT,
  passwordProtected: Boolean(room.passwordProtected),
  seatCount: room.seatCount === 13 ? 13 : 9,
  coupleSeat: Boolean(room.coupleSeat),
  backgroundPath: room.backgroundPath || null,
  musicState: room.musicState || null,
});

const roomDetailsFromRow = (row) =>
  row && row.id
    ? {
        title: row.title,
        description: row.description || "",
        announcement: row.announcement || DEFAULT_ROOM_ANNOUNCEMENT,
        passwordProtected: Boolean(row.password_protected),
        seatCount: row.seat_count === 13 ? 13 : 9,
        coupleSeat: Boolean(row.couple_seat),
        backgroundPath: row.background_path || null,
        musicState: row.music_state || null,
      }
    : null;

const isSeatedParticipant = (participant) =>
  Number.isInteger(participant?.seat) && participant.seat > 0;

function Room({
  room,
  profile,
  userId,
  accessToken,
  onLeave,
  onUpdateRoom,
  onSendGift,
  coins,
  initialSpeakerOn = true,
  initialMicrophoneOn = false,
  isFollowingHost = false,
  followedUserIds = [],
  onToggleFollowHost,
  onToggleFollowUser,
  onHostPresenceChange,
  onMinimize,
  onEditProfile,
  userFamilyLevel = 0,
  minimized = false,
}) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    console.warn("[room-entry] Room component mounted");
    return () => console.warn("[room-entry] Room component unmounted");
  }, []);

  const roomBrand = useMemo(
    () => resolveRoomBrand(room),
    [room.accent, room.colors, room.id, room.title],
  );
  const [speakerOn, setSpeakerOn] = useState(initialSpeakerOn);
  const [handRaised, setHandRaised] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [roomGiftCatalog, setRoomGiftCatalog] = useState(GIFT_CATALOG);
  const [giftFlight, setGiftFlight] = useState(null);
  const [roomCombo, setRoomCombo] = useState(null);
  const roomKeyboard = useKeyboardInset();
  const playedGiftIdsRef = useRef(new Set());
  const giftRoomMinimizedRef = useRef(minimized);
  useEffect(() => { giftRoomMinimizedRef.current = minimized; }, [minimized]);
  const playGiftEffect = useCallback((gift) => {
    const eventId = gift?.eventId;
    if (!eventId || playedGiftIdsRef.current.has(eventId)) return;
    playedGiftIdsRef.current.add(eventId);
    if (playedGiftIdsRef.current.size > 160) {
      playedGiftIdsRef.current.delete(playedGiftIdsRef.current.values().next().value);
    }
    if (!giftRoomMinimizedRef.current) setGiftFlight({ ...gift, stamp: Date.now() });
  }, []);
  useEffect(() => {
    playedGiftIdsRef.current.clear();
    setGiftFlight(null);
    setRoomCombo(null);
  }, [room.id]);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [profileParticipant, setProfileParticipant] = useState(null);
  const [selfSheetOpen, setSelfSheetOpen] = useState(false);
  const [selfProfileOpen, setSelfProfileOpen] = useState(false);
  const [followedParticipantNames, setFollowedParticipantNames] = useState([]);
  const [roomLocked, setRoomLocked] = useState(Boolean(room.roomLocked));
  const [chatLocked, setChatLocked] = useState(Boolean(room.chatLocked));
  const [roomDetails, setRoomDetails] = useState(() => roomDetailsFrom(room));
  const [menuSheet, setMenuSheet] = useState(null);
  const [banTarget, setBanTarget] = useState(null);
  useEffect(() => {
    if (!minimized) return;
    setGiftOpen(false);
    setSettingsOpen(false);
    setMenuSheet(null);
    setSelfSheetOpen(false);
    setSelfProfileOpen(false);
    setProfileParticipant(null);
    setSelectedParticipant(null);
    setBanTarget(null);
    setReportTarget(null);
  }, [minimized]);
  const [staffBusy, setStaffBusy] = useState(null);
  const [backgroundUrl, setBackgroundUrl] = useState(null);
  const [backgroundRequest, setBackgroundRequest] = useState(null);
  const [backgroundUploadsEnabled, setBackgroundUploadsEnabled] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [musicTracks, setMusicTracks] = useState([]);
  const [musicTracksLoading, setMusicTracksLoading] = useState(false);
  const [musicTracksError, setMusicTracksError] = useState(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const musicBusyRef = useRef(false);
  const chatScrollRef = useRef(null);
  const chatNearBottomRef = useRef(true);
  const pendingMicRef = useRef(false);
  const selfLeavingSeatRef = useRef(false);
  const previousSeatRef = useRef(null);
  const previousHandRaisedAtRef = useRef(null);
  const handWithdrawnRef = useRef(false);
  useEffect(() => {
    setRoomDetails((current) => ({ ...current, ...roomDetailsFrom(room) }));
  }, [room]);
  const isHost = room.hostId
    ? room.hostId === userId
    : room.host === profile.name;
  const initialMessages = useMemo(
    () =>
      room.persisted
        ? [
            {
              id: `welcome-${room.id}`,
              system: true,
              announcement: true,
              text: room.announcement || DEFAULT_ROOM_ANNOUNCEMENT,
              createdAt: "1970-01-01T00:00:00.000Z",
            },
          ]
        : [
            {
              id: "room",
              system: true,
              announcement: true,
              text: room.announcement || DEFAULT_ROOM_ANNOUNCEMENT,
            },
          ],
    // Duyuru yalnızca odaya girerken gösterilir; sonradan değişmesi sohbeti sıfırlamaz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.id, room.persisted],
  );
  const [messages, setMessages] = useState(initialMessages);
  const [messagesReady, setMessagesReady] = useState(false);
  const [chatAccessReady, setChatAccessReady] = useState(!room.persisted);
  const [chatRealtimeStatus, setChatRealtimeStatus] = useState(
    room.persisted ? "connecting" : "local",
  );
  const [messageSending, setMessageSending] = useState(false);
  const messageGuard = useMemo(() => createMessageGuard(), []);
  const liveVoice = useLiveVoiceRoom({
    roomName: room.id,
    profile,
    userId,
    accessToken,
    startWithMicrophone: initialMicrophoneOn,
  });
  const retryVoiceConnection = async () => {
    if (isHost && room.persisted && onHostPresenceChange) {
      try {
        await onHostPresenceChange(room.id, true);
      } catch (error) {
        console.error("Room voice retry failed", error);
        Alert.alert("Oda açılamadı", "Bağlantıyı kontrol edip tekrar dene.");
        return;
      }
    }
    liveVoice.reconnect();
  };
  const [roomMembers, setRoomMembers] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const myMember = roomMembers.find((member) => member.userId === userId);
  const myRole = isHost ? "host" : myMember?.role || liveVoice.role;
  const canModerate = isHost || myRole === "moderator";
  const menuRole = isHost ? "owner" : canModerate ? "admin" : "member";
  const activeRoomParticipants = useMemo(
    () =>
      liveVoice.participants
        .filter((participant) => !blockedUserIds.includes(participant.id))
        .map((participant) => {
          const member = roomMembers.find(
            (item) => item.userId === participant.id,
          );
          return {
            ...participant,
            userId: participant.id,
            name: member?.name || participant.name,
            color: member?.color || "#7FCBEA",
            avatarUrl:
              (participant.id === userId ? profile?.avatarUrl : null) ||
              member?.avatarUrl ||
              null,
            role:
              participant.id === room.hostId
                ? "host"
                : member?.role || "listener",
            isMuted: Boolean(member?.isMuted),
            seat: participant.id === room.hostId ? 0 : participant.seat ?? member?.seat ?? null,
            handRaisedAt: member?.handRaisedAt || null,
            micBannedUntil: member?.micBannedUntil || null,
          };
        }),
    [blockedUserIds, liveVoice.participants, profile?.avatarUrl, room.hostId, roomMembers, userId],
  );
  useEffect(() => {
    if (!room.persisted || !supabase) return;
    let active = true;
    listRoomGiftCatalog().then((catalog) => {
      if (active && catalog.length) setRoomGiftCatalog(catalog);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [room.persisted]);
  const micOn = liveVoice.enabled && liveVoice.microphoneEnabled;
  const activeSpeakerIds = liveVoice.activeSpeakerIds || [];
  const seatCapacity = roomDetails.seatCount === 13 ? 13 : 9;
  const compactStage = seatCapacity > 9 || roomKeyboard.visible;
  const hostStageParticipant = useMemo(() => {
    const found = activeRoomParticipants.find(
      (participant) => participant.userId === room.hostId,
    );
    const base = found || {
      userId: room.hostId || `host-${room.id}`,
      name: room.host,
      color: roomBrand.accent,
      avatarUrl: (isHost ? profile?.avatarUrl : room.hostAvatarUrl) || null,
      microphoneEnabled: isHost ? micOn : false,
    };
    return {
      ...base,
      avatarUrl:
        base.avatarUrl ||
        (isHost ? profile?.avatarUrl : room.hostAvatarUrl) ||
        null,
      role: "host",
      seat: 0,
      isSpeaking: activeSpeakerIds.includes(base.userId),
    };
  }, [
    activeRoomParticipants,
    activeSpeakerIds,
    isHost,
    micOn,
    profile?.avatarUrl,
    room.host,
    room.hostAvatarUrl,
    room.hostId,
    room.id,
    roomBrand.accent,
  ]);
  const seatedByIndex = useMemo(() => {
    const seats = new Map();
    activeRoomParticipants.forEach((participant) => {
      if (participant.userId === room.hostId || !isSeatedParticipant(participant)) return;
      seats.set(participant.seat, {
        ...participant,
        isSpeaking: activeSpeakerIds.includes(participant.userId),
      });
    });
    return seats;
  }, [activeRoomParticipants, activeSpeakerIds, room.hostId]);
  const regularSeatRows = useMemo(() => {
    const rows = [];
    for (let start = FIRST_REGULAR_SEAT_INDEX; start <= seatCapacity; start += 4) {
      rows.push(
        Array.from({ length: 4 }, (_, offset) => {
          const index = start + offset;
          return { index, participant: seatedByIndex.get(index) || null };
        }),
      );
    }
    return rows;
  }, [seatCapacity, seatedByIndex]);
  const stageParticipants = useMemo(
    () => [hostStageParticipant, ...seatedByIndex.values()],
    [hostStageParticipant, seatedByIndex],
  );
  const mySeat = isHost ? 0 : liveVoice.localSeat ?? null;
  const iAmSeated = isHost || mySeat !== null;
  const micRequests = useRequestsFromMembers(roomMembers, activeRoomParticipants);
  const roomAdminCandidates = useMemo(
    () =>
      activeRoomParticipants.filter(
        (participant) =>
          participant.userId !== room.hostId && participant.userId !== userId,
      ),
    [activeRoomParticipants, room.hostId, userId],
  );
  const adminCount = roomMembers.filter((member) => member.role === "moderator").length;
  const music = useRoomMusic({
    musicState: roomDetails.musicState,
    enabled: Boolean(room.persisted && speakerOn),
  });
  const musicPlaying = Boolean(roomDetails.musicState?.playing);
  const roomVoiceLabel =
    liveVoice.status === "connected"
      ? "CANLI"
      : liveVoice.status === "connecting" || liveVoice.status === "reconnecting"
        ? "SES BAĞLANIYOR"
        : "SES BAĞLANTISI YOK";
  const voiceStatusInfo =
    liveVoice.status === "connected"
      ? {
          icon: "radio",
          title: "Canlı ses bağlantısı aktif",
          description: `${liveVoice.participantCount} kişi bu odada`,
          style: styles.roomVoiceConnected,
        }
      : liveVoice.status === "connecting" || liveVoice.status === "reconnecting"
        ? {
            icon: "sync",
            title:
              liveVoice.status === "reconnecting"
                ? "Bağlantı yenileniyor"
                : "Canlı ses bağlanıyor",
            description: "Güvenli ses oturumu hazırlanıyor",
            style: styles.roomVoiceConnecting,
          }
        : liveVoice.status === "error" || liveVoice.status === "disconnected"
          ? {
              icon: "warning-outline",
              title:
                liveVoice.status === "disconnected"
                  ? "Ses bağlantısı kesildi"
                  : "Ses bağlantısı kurulamadı",
              description: "Bağlantını kontrol et ve yeniden dene.",
              style: styles.roomVoiceError,
            }
          : {
              icon: "mic-outline",
              title: "Ses altyapısı bekleniyor",
              description: "Canlı oda için ses sunucusu yapılandırılmalı.",
              style: styles.roomVoiceLocal,
            };

  useEffect(() => {
    let active = true;
    setMessagesReady(false);
    setChatAccessReady(!room.persisted);
    setChatRealtimeStatus(room.persisted ? "connecting" : "local");
    setMessages(initialMessages);
    const prepareMembership = room.persisted
      ? joinRoomMembership(room.id)
      : Promise.resolve();
    prepareMembership
      .then(() => {
        if (!active) return;
        setChatAccessReady(true);
      })
      .catch(() => {
        if (active) setChatRealtimeStatus("error");
      })
      .finally(() => {
        if (active) setMessagesReady(true);
      });
    return () => {
      active = false;
    };
  }, [initialMessages, room.id, room.persisted]);

  useEffect(() => {
    if (!room.persisted || !userId) return;
    let active = true;
    listBlockedUsers()
      .then((users) => {
        if (active) setBlockedUserIds(users.map((user) => user.userId));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [room.id, room.persisted, userId]);

  useEffect(() => {
    if (!room.persisted || !supabase || !chatAccessReady) return undefined;
    let active = true;
    const channel = supabase
      .channel(`room-messages-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          if (!active) return;
          const row = payload.new;
          const incoming = {
            id: row.id,
            userId: row.sender_id,
            user: row.sender_name || "Sora kullanıcısı",
            avatarUrl: row.sender_avatar_url || null,
            avatarColor: row.sender_avatar_color || null,
            kind: row.kind || "text",
            metadata: row.metadata || null,
            text: row.body,
            system: row.kind === "system",
            createdAt: row.created_at,
          };
          setMessages((current) => mergeRoomMessages(current, [incoming]));
          if (row.kind === "gift" && row.metadata?.gift_id) {
            const meta = row.metadata;
            playGiftEffect({
              id: meta.gift_id,
              name: meta.gift_name || "Hediye",
              color: meta.gift_color,
              recipientName: meta.recipient_name,
              quantity: Number(meta.quantity) || 1,
              eventId: row.id,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          setChatLocked(Boolean(payload.new.chat_locked));
          setRoomLocked(Boolean(payload.new.room_locked));
          const nextDetails = roomDetailsFromRow(payload.new);
          if (nextDetails) setRoomDetails((current) => ({ ...current, ...nextDetails }));
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setChatRealtimeStatus("live");
        } else if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          setChatRealtimeStatus("error");
        } else if (status === "CLOSED") {
          setChatRealtimeStatus("offline");
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [chatAccessReady, playGiftEffect, room.id, room.persisted]);

  const refreshMembers = useCallback(() => {
    if (!room.persisted) return Promise.resolve();
    return listRoomMembers(room.id)
      .then((members) => setRoomMembers(members))
      .catch(() => undefined);
  }, [room.id, room.persisted]);

  useEffect(() => {
    if (!room.persisted || liveVoice.status !== "connected") return undefined;
    refreshMembers();
    const interval = setInterval(refreshMembers, canModerate ? 5000 : 8000);
    return () => clearInterval(interval);
  }, [canModerate, liveVoice.participantCount, liveVoice.status, refreshMembers, room.persisted]);

  const voiceStatusRef = useRef(liveVoice.status);
  const voiceReconnectRef = useRef(liveVoice.reconnect);
  useEffect(() => {
    voiceStatusRef.current = liveVoice.status;
    voiceReconnectRef.current = liveVoice.reconnect;
  }, [liveVoice.reconnect, liveVoice.status]);

  useEffect(() => {
    // Uygulama arka plana alınıp öne geldiğinde bağlantı koptuysa sessizce yeniden bağlan.
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && ["error", "disconnected"].includes(voiceStatusRef.current)) {
        voiceReconnectRef.current?.();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isHost || !room.persisted || !onHostPresenceChange) return undefined;
    const setPresence = (isActive) =>
      onHostPresenceChange(room.id, isActive).catch(() => undefined);
    setPresence(true);
    const heartbeat = setInterval(() => setPresence(true), 20_000);
    // Uygulama arka plana alındığında veya oda küçültüldüğünde oda keşfette kalır;
    // pasifleştirme yalnızca odadan gerçekten çıkıldığında (leaveCurrentRoom) yapılır.
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") setPresence(true);
    });
    return () => {
      clearInterval(heartbeat);
      subscription.remove();
    };
  }, [isHost, onHostPresenceChange, room.id, room.persisted]);

  const handleToggleSpeaker = useCallback(
    () =>
      setSpeakerOn((value) => {
        liveVoice.setSpeakerEnabled?.(!value);
        return !value;
      }),
    [liveVoice.setSpeakerEnabled],
  );
  useEffect(() => {
    if (liveVoice.status === "connected") liveVoice.setSpeakerEnabled?.(speakerOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVoice.status]);
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenGift = useCallback(() => {
    setRoomCombo(null);
    setGiftOpen(true);
  }, []);
  const handleCloseGift = useCallback(() => setGiftOpen(false), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleCloseReport = useCallback(() => setReportTarget(null), []);

  const pendingRoomGiftSpendRef = useRef(0);
  const executeRoomGiftSend = useCallback(
    async ({ gift, recipient, quantity = 1 }) => {
      const cleanQty = Math.max(1, Math.floor(Number(quantity) || 1));
      const reservedCost = Number(gift.cost || 0) * cleanQty;
      pendingRoomGiftSpendRef.current += reservedCost;
      try {
        const requestId = createRequestUuid();
        const sent = await onSendGift({
          gift,
          recipient,
          quantity: cleanQty,
          roomId: room.id,
          requestId,
        });
        if (!sent) {
          setRoomCombo(null);
          return false;
        }
        playGiftEffect({
          ...gift,
          name: sent.gift_name || gift.name,
          recipientName: recipient.name,
          quantity: cleanQty,
          eventId: sent.message_id || requestId,
        });
        if (sent.message_id) {
          setMessages((current) =>
            mergeRoomMessages(current, [
              {
                id: sent.message_id,
                userId,
                user: profile?.name || "Sen",
                avatarUrl: profile?.avatarUrl || null,
                avatarColor: profile?.color || COLORS.primary,
                kind: "gift",
                metadata: {
                  gift_id: gift.id,
                  gift_name: sent.gift_name || gift.name,
                  gift_icon: gift.icon,
                  gift_color: gift.color,
                  quantity: cleanQty,
                  gift_cost: sent.gift_cost,
                  recipient_id: recipient.userId,
                  recipient_name: recipient.name,
                },
                text: sent.message_body,
                system: false,
                createdAt: new Date().toISOString(),
              },
            ]),
          );
        }
        return true;
      } finally {
        pendingRoomGiftSpendRef.current = Math.max(0, pendingRoomGiftSpendRef.current - reservedCost);
      }
    },
    [onSendGift, playGiftEffect, profile?.avatarUrl, profile?.color, profile?.name, room.id, userId],
  );

  const handleSendGiftFromSheet = useCallback(
    (gift, recipient, quantity = 1) => {
      setGiftOpen(false);
      setRoomCombo({
        gift,
        recipient,
        quantity,
        count: 1,
        triggerKey: Date.now(),
      });
      executeRoomGiftSend({ gift, recipient, quantity });
    },
    [executeRoomGiftSend],
  );

  const handleRoomComboPress = useCallback(() => {
    if (!roomCombo?.gift || !roomCombo?.recipient?.userId) return;
    const { gift, recipient, quantity } = roomCombo;
    const totalCost = Number(gift.cost || 0) * quantity;
    const availableCoins = typeof coins === "number" ? coins - pendingRoomGiftSpendRef.current : Infinity;
    if (availableCoins < totalCost) {
      setRoomCombo(null);
      Alert.alert(
        "Bakiye yetersiz",
        `${quantity}x ${gift.name} için ${formatCredits(totalCost)} kredi gerekiyor.`,
      );
      return;
    }
    setRoomCombo((prev) =>
      prev
        ? {
            ...prev,
            count: (prev.count || 1) + 1,
            triggerKey: Date.now() + Math.random(),
          }
        : null,
    );
    executeRoomGiftSend({ gift, recipient, quantity });
  }, [coins, executeRoomGiftSend, roomCombo]);

  const handleExpireRoomCombo = useCallback(() => {
    setRoomCombo(null);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(FOLLOWED_USERS_KEY)
      .then((savedNames) => {
        const parsedNames = JSON.parse(savedNames || "[]");
        if (Array.isArray(parsedNames)) setFollowedParticipantNames(parsedNames);
      })
      .catch(() => undefined);
  }, []);

  const appendSystemMessage = useCallback((text) => {
    setMessages((current) => [
      ...current,
      { id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, system: true, text },
    ]);
  }, []);

  const runSeatAction = useCallback(
    async (action, { seatIndex = null, targetUserId = null, silent = false } = {}) => {
      if (!room.persisted) {
        Alert.alert("Kullanılamıyor", "Örnek odalarda mikrofon yönetimi yok.");
        return null;
      }
      try {
        return await performSeatAction({
          roomId: room.id,
          action,
          seatIndex,
          targetUserId,
          accessToken,
        });
      } catch (error) {
        if (!silent) Alert.alert("İşlem yapılamadı", describeRoomError(error));
        return null;
      }
    },
    [accessToken, room.id, room.persisted],
  );

  const toggleMicrophone = useCallback(async () => {
    if (liveVoice.enabled && !isHost && !liveVoice.canPublish && !micOn) {
      if (liveVoice.status !== "connected") {
        Alert.alert("Bağlantı hazırlanıyor", "Mikrofon için ses odasının bağlanmasını bekle.");
        return;
      }
      if (canModerate) {
        const result = await runSeatAction("take");
        if (result && result.seat !== null && result.seat !== undefined) pendingMicRef.current = true;
        return;
      }
      if (handRaised) {
        Alert.alert(
          "İsteğin bekliyor",
          "Oda sahibi ya da bir yönetici onayladığında mikrofona çıkacaksın.",
          [
            { text: "Tamam", style: "cancel" },
            {
              text: "İsteği geri çek",
              style: "destructive",
              onPress: () => toggleHandRef.current?.(),
            },
          ],
        );
        return;
      }
      toggleHandRef.current?.();
      return;
    }
    if (liveVoice.enabled) {
      if (["idle", "connecting", "reconnecting"].includes(liveVoice.status)) {
        if (isHost || liveVoice.canPublish) {
          pendingMicRef.current = !pendingMicRef.current;
          return;
        }
        Alert.alert(
          "Bağlantı hazırlanıyor",
          "Mikrofonu açmak için ses odasının bağlanmasını bekle.",
        );
        return;
      }
      if (liveVoice.status !== "connected") {
        liveVoice.reconnect?.();
        if (isHost) pendingMicRef.current = true;
        return;
      }
      try {
        let updated = await liveVoice.setMicrophoneEnabled(!micOn);
        if (!updated && !micOn && isHost) {
          await runSeatAction("take").catch(() => undefined);
          updated = await liveVoice.setMicrophoneEnabled(true);
        }
        if (!updated) {
          Alert.alert(
            "Mikrofon yetkisi yenileniyor",
            "Oda ses izni güncelleniyor, bir saniye sonra tekrar dokun.",
          );
        }
      } catch {
        Alert.alert(
          "Mikrofon değiştirilemedi",
          "Bağlantını ve mikrofon iznini kontrol edip tekrar dene.",
        );
      }
      return;
    }
    Alert.alert(
      "Canlı ses hazır değil",
      "Konuşmak için güvenli ses sunucusuna bağlanman gerekiyor.",
    );
  }, [
    canModerate,
    handRaised,
    isHost,
    liveVoice.canPublish,
    liveVoice.enabled,
    liveVoice.setMicrophoneEnabled,
    liveVoice.status,
    micOn,
    runSeatAction,
  ]);
  const toggleHandRef = useRef(null);

  // Koltuğa oturtulunca (ya da indirilince) kullanıcıyı bilgilendir.
  useEffect(() => {
    if (isHost) return;
    const previous = previousSeatRef.current;
    const next = liveVoice.localSeat ?? null;
    previousSeatRef.current = next;
    if (previous === next) return;
    if (previous === null && next !== null) {
      setHandRaised(false);
      if (!pendingMicRef.current) {
        appendSystemMessage("Mikrofona alındın. Konuşmak için mikrofon düğmesine dokun.");
      }
    } else if (previous !== null && next === null) {
      appendSystemMessage(
        selfLeavingSeatRef.current ? "Mikrofondan indin." : "Mikrofondan indirildin.",
      );
      selfLeavingSeatRef.current = false;
    }
  }, [appendSystemMessage, isHost, liveVoice.localSeat]);

  useEffect(() => {
    if (pendingMicRef.current && liveVoice.status === "connected" && liveVoice.canPublish) {
      pendingMicRef.current = false;
      liveVoice.setMicrophoneEnabled(true).catch(() => undefined);
    }
  }, [liveVoice.canPublish, liveVoice.setMicrophoneEnabled, liveVoice.status]);

  // İstek onaylanınca / reddedilince el kaldırma durumunu eşitle.
  useEffect(() => {
    const previous = previousHandRaisedAtRef.current;
    const next = myMember?.handRaisedAt || null;
    previousHandRaisedAtRef.current = next;
    if (previous && !next) {
      setHandRaised(false);
      if (handWithdrawnRef.current) {
        handWithdrawnRef.current = false;
      } else if (!iAmSeated && liveVoice.localSeat === null) {
        appendSystemMessage("Mikrofon isteğin şu an kabul edilmedi.");
      }
    } else if (!previous && next && !iAmSeated) {
      setHandRaised(true);
    }
  }, [appendSystemMessage, iAmSeated, liveVoice.localSeat, myMember?.handRaisedAt]);

  useEffect(() => {
    if (!liveVoice.removedByModerator) return;
    Alert.alert("Odadan çıkarıldın", "Bir yönetici seni bu odadan uzaklaştırdı.");
    onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVoice.removedByModerator]);

  const leaveSeat = useCallback(async () => {
    selfLeavingSeatRef.current = true;
    await liveVoice.setMicrophoneEnabled(false).catch(() => undefined);
    const result = await runSeatAction("leave");
    if (!result) selfLeavingSeatRef.current = false;
  }, [liveVoice.setMicrophoneEnabled, runSeatAction]);

  const leaveRoom = async () => {
    if (room.persisted) leaveRoomMembership(room.id).catch(() => undefined);
    await liveVoice.disconnect().catch(() => undefined);
    try {
      const savedHistory = await AsyncStorage.getItem(ROOM_HISTORY_KEY);
      const currentHistory = JSON.parse(savedHistory || "[]");
      const history = Array.isArray(currentHistory) ? currentHistory : [];
      const entry = {
        id: `${room.id}-${Date.now()}`,
        roomId: room.id,
        title: room.title,
        category: room.category,
        initials: room.initials,
        color: roomBrand.accent,
        visitedAt: "Şimdi",
        visitedTs: Date.now(),
      };
      const nextHistory = [
        entry,
        ...history.filter(
          (item) => item.roomId !== room.id && item.title !== room.title,
        ),
      ].slice(0, 6);
      await AsyncStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {}
    onLeave();
  };

  const sendMessage = useCallback(
    async (rawText) => {
      const cleanMessage = String(rawText ?? "").trim();
      if (!cleanMessage || messageSending) return false;
      if (chatLocked && !canModerate) {
        Alert.alert(
          "Sohbet kapalı",
          "Ev sahibi oda sohbetini geçici olarak kapattı.",
        );
        return false;
      }
      const messageCheck = messageGuard.check(cleanMessage);
      if (!messageCheck.allowed) {
        if (messageCheck.reason === "empty") return false;
        const warning =
          messageCheck.reason === "blocked_language"
            ? "Mesajın topluluk kurallarına aykırı bir ifade içeriyor."
            : messageCheck.reason === "duplicate"
              ? "Aynı mesajı art arda gönderemezsin."
              : "Çok hızlı mesaj gönderiyorsun. Biraz bekleyip tekrar dene.";
        Alert.alert("Mesaj gönderilemedi", warning);
        return false;
      }
      if (room.persisted && userId) {
        if (!chatAccessReady) {
          Alert.alert(
            "Sohbet hazırlanıyor",
            "Oda bağlantısının kurulmasını bekle.",
          );
          return false;
        }
        const pendingId = `pending-${Date.now()}`;
        const pendingMessage = {
          id: pendingId,
          userId,
          user: profile.name,
          avatarUrl: profile?.avatarUrl || null,
          avatarColor: profile?.color || COLORS.primary,
          text: cleanMessage,
          pending: true,
          createdAt: new Date().toISOString(),
        };
        setMessageSending(true);
        setMessages((current) => mergeRoomMessages(current, [pendingMessage]));
        try {
          const savedMessage = await sendRoomMessage({
            roomId: room.id,
            userId,
            text: cleanMessage,
          });
          messageGuard.record(cleanMessage);
          setMessages((current) =>
            mergeRoomMessages(
              current.filter((item) => item.id !== pendingId),
              [savedMessage],
            ),
          );
          return true;
        } catch (error) {
          setMessages((current) =>
            current.filter((item) => item.id !== pendingId),
          );
          const errorMessage = error?.message || "";
          const warning = errorMessage.includes("blocked language")
            ? "Mesajın topluluk kurallarına aykırı bir ifade içeriyor."
            : errorMessage.includes("Duplicate message")
              ? "Aynı mesajı art arda gönderemezsin."
              : errorMessage.includes("Too many messages") ||
                  errorMessage.includes("limit exceeded")
                ? "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle."
                : errorMessage.includes("Messaging is restricted")
                  ? "Hesabının mesaj gönderme yetkisi geçici olarak sınırlandırıldı."
                  : "Bağlantını ve oda erişimini kontrol edip tekrar dene.";
          Alert.alert("Mesaj gönderilemedi", warning);
          return false;
        } finally {
          setMessageSending(false);
        }
      }
      messageGuard.record(cleanMessage);
      setMessages((current) => [
        ...current,
        {
          id: String(Date.now()),
          userId,
          user: profile.name,
          avatarUrl: profile?.avatarUrl || null,
          avatarColor: profile?.color || COLORS.primary,
          text: cleanMessage,
        },
      ]);
      return true;
    },
    [
      canModerate,
      chatAccessReady,
      chatLocked,
      messageGuard,
      messageSending,
      profile?.avatarUrl,
      profile?.color,
      profile.name,
      room.id,
      room.persisted,
      userId,
    ],
  );

  const toggleHand = async () => {
    if (roomLocked && !isHost) {
      Alert.alert(
        "Mikrofon sırası kapalı",
        "Ev sahibi şu an yeni sıra isteklerini kapattı.",
      );
      return;
    }
    const nextState = !handRaised;
    setHandRaised(nextState);
    if (room.persisted) {
      try {
        await setRoomHandRaise({ roomId: room.id, raised: nextState });
        if (!nextState) handWithdrawnRef.current = true;
      } catch (error) {
        setHandRaised(!nextState);
        Alert.alert("İstek gönderilemedi", describeRoomError(error));
        return;
      }
    }
    setMessages((current) => [
      ...current,
      {
        id: `hand-${Date.now()}`,
        system: true,
        text: nextState
          ? "Mikrofon isteğin gönderildi. Onaylanınca mikrofona çıkacaksın."
          : "Mikrofon isteğini geri çektin.",
      },
    ]);
  };
  toggleHandRef.current = toggleHand;

  const handleEmptySeatPress = (seatIndex) => {
    if (!room.persisted) {
      toggleHand();
      return;
    }
    if (isHost) {
      setMenuSheet("requests");
      return;
    }
    if (canModerate) {
      runSeatAction("take", { seatIndex });
      return;
    }
    if (iAmSeated) {
      Alert.alert("Zaten mikrofondasın", "Yer değiştirmek için oda sahibine ya da bir yöneticiye yaz.");
      return;
    }
    if (handRaised) {
      Alert.alert(
        "İsteğin bekliyor",
        "Oda sahibi ya da bir yönetici onayladığında mikrofona çıkacaksın.",
        [
          { text: "Tamam", style: "cancel" },
          { text: "İsteği geri çek", style: "destructive", onPress: toggleHand },
        ],
      );
      return;
    }
    toggleHand();
  };

  const handleOwnSeatPress = useCallback(() => {
    setSelfSheetOpen(true);
  }, []);

  const handleOpenSelfProfile = useCallback(() => {
    setSelfSheetOpen(false);
    setSelfProfileOpen(true);
  }, []);

  const handleSelfLeaveMic = useCallback(() => {
    setSelfSheetOpen(false);
    leaveSeat();
  }, [leaveSeat]);

  const toggleRoomLock = () =>
    setRoomLocked((current) => {
      const nextValue = !current;
      onUpdateRoom?.(room.id, { roomLocked: nextValue });
      return nextValue;
    });

  const toggleChatLock = () =>
    setChatLocked((current) => {
      const nextValue = !current;
      onUpdateRoom?.(room.id, { chatLocked: nextValue });
      return nextValue;
    });

  const reportParticipant = (participant) => {
    if (!room.persisted || !participant?.userId) {
      Alert.alert(
        "Bildirim kullanılamıyor",
        "Örnek odalar güvenlik sistemine bağlı değil. Canlı bir kullanıcı odasında tekrar dene.",
      );
      return;
    }
    setReportTarget({
      name: participant.name,
      userId: participant.userId,
      roomId: room.id,
    });
  };

  const reportRoom = () => {
    if (!room.persisted) {
      Alert.alert(
        "Bildirim kullanılamıyor",
        "Örnek odalar güvenlik sistemine bağlı değil.",
      );
      return;
    }
    setReportTarget({
      name: room.title,
      userId: room.hostId || null,
      roomId: room.id,
    });
  };

  const handleReportMessage = useCallback(
    (item) => {
      if (
        !room.persisted ||
        item.system ||
        item.pending ||
        !item.userId ||
        item.userId === userId
      )
        return;
      setReportTarget({
        name: `${item.user} kullanıcısının mesajı`,
        userId: item.userId,
        roomId: room.id,
        messageId: item.id,
      });
    },
    [room.persisted, room.id, userId],
  );

  const blockParticipant = useCallback(
    (participant) => {
      if (!room.persisted || !participant?.userId) {
        Alert.alert(
          "Engelleme kullanılamıyor",
          "Örnek odalar gerçek kullanıcı hesabına bağlı değil.",
        );
        return;
      }
      Alert.alert(
        "Kullanıcı engellensin mi?",
        `${participant.name} adlı kullanıcının mesajları gizlenecek ve aranızdaki takip bağlantısı kaldırılacak.`,
        [
          { text: "Vazgeç", style: "cancel" },
          {
            text: "Engelle",
            style: "destructive",
            onPress: async () => {
              try {
                await setUserBlocked({
                  targetUserId: participant.userId,
                  blocked: true,
                });
                setBlockedUserIds((current) =>
                  current.includes(participant.userId)
                    ? current
                    : [...current, participant.userId],
                );
                setRoomMembers((current) =>
                  current.filter(
                    (member) => member.userId !== participant.userId,
                  ),
                );
                setMessages((current) =>
                  current.filter((item) => item.userId !== participant.userId),
                );
                if (participant.userId === room.hostId) await leaveRoom();
                else
                  Alert.alert(
                    "Kullanıcı engellendi",
                    "Engeli Güvenlik Merkezi'nden kaldırabilirsin.",
                  );
              } catch {
                Alert.alert(
                  "Engellenemedi",
                  "Bağlantını kontrol edip tekrar dene.",
                );
              }
            },
          },
        ],
      );
    },
    [room.persisted, room.hostId, leaveRoom],
  );

  const handleBlockHost = useCallback(() => {
    blockParticipant({ userId: room.hostId, name: room.host });
  }, [blockParticipant, room.hostId, room.host]);

  const openParticipantMenu = useCallback(
    (participant) => {
      if (!participant?.userId || participant.userId === userId) return;
      setSelectedParticipant(participant);
      setProfileParticipant(participant);
    },
    [userId],
  );
  const closeParticipantMenu = useCallback(
    () => setSelectedParticipant(null),
    [],
  );
  const handleViewSelectedProfile = useCallback(() => {
    if (!selectedParticipant) return;
    setProfileParticipant(selectedParticipant);
    setSelectedParticipant(null);
  }, [selectedParticipant]);
  const activeTargetParticipant = profileParticipant || selectedParticipant;
  const selectedIsHostParticipant = Boolean(
    activeTargetParticipant && activeTargetParticipant.userId === room.hostId,
  );
  const selectedIsFollowing = selectedIsHostParticipant
    ? isFollowingHost
    : activeTargetParticipant?.userId && supabase
      ? followedUserIds.includes(activeTargetParticipant.userId)
      : activeTargetParticipant
        ? followedParticipantNames.includes(activeTargetParticipant.name)
        : false;
  const handleSelectedFollow = useCallback(() => {
    const target = profileParticipant || selectedParticipant;
    if (!target) return;
    if (target.userId === room.hostId) {
      onToggleFollowHost?.();
      return;
    }
    if (target.userId && supabase && onToggleFollowUser) {
      onToggleFollowUser(target.userId);
      return;
    }
    setFollowedParticipantNames((current) => {
      const name = target.name;
      const nextNames = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      AsyncStorage.setItem(
        FOLLOWED_USERS_KEY,
        JSON.stringify(nextNames),
      ).catch(() => undefined);
      return nextNames;
    });
  }, [onToggleFollowHost, onToggleFollowUser, profileParticipant, room.hostId, selectedParticipant]);
  const handleSelectedBlock = useCallback(() => {
    const participant = profileParticipant || selectedParticipant;
    setSelectedParticipant(null);
    setProfileParticipant(null);
    if (participant) blockParticipant(participant);
  }, [blockParticipant, profileParticipant, selectedParticipant]);
  const handleSelectedReport = useCallback(() => {
    const participant = profileParticipant || selectedParticipant;
    setSelectedParticipant(null);
    setProfileParticipant(null);
    if (participant)
      setReportTarget({
        name: `${participant.name} kullanıcısı`,
        userId: participant.userId,
        roomId: room.id,
      });
  }, [profileParticipant, room.id, selectedParticipant]);

  const manageParticipant = useCallback(
    async (participant, action) => {
      if (!room.persisted) throw new Error("Bu örnek oda yönetilemez.");
      const membership = await moderateLiveParticipant({
        roomId: room.id,
        targetUserId: participant.userId,
        action,
        accessToken,
      });
      setRoomMembers((currentMembers) =>
        action === "remove"
          ? currentMembers.filter(
              (member) => member.userId !== participant.userId,
            )
          : currentMembers.map((member) =>
              member.userId === participant.userId
                ? {
                    ...member,
                    role: membership.role,
                    isMuted: membership.is_muted,
                  }
                : member,
            ),
      );
    },
    [room.id, room.persisted, accessToken],
  );

  // ── Yönetici işlemleri ────────────────────────────────────────────────
  const staffActionsFor = (participant) => {
    if (!participant || !canModerate || !room.persisted) return [];
    if (participant.userId === room.hostId || participant.userId === userId) return [];
    if (!isHost && participant.role === "moderator") return [];
    const seated = isSeatedParticipant(participant);
    const actions = [
      seated
        ? { key: "kick", label: "Mikrofondan indir (10 dk)", icon: "arrow-down-circle-outline" }
        : { key: "assign", label: "Mikrofona al", icon: "mic-outline" },
    ];
    if (isHost && roomDetails.coupleSeat && participant.seat !== COUPLE_SEAT_INDEX) {
      actions.push({ key: "couple", label: "Konuk koltuğuna al", icon: "mic-outline" });
    }
    if (isHost) {
      actions.push(
        participant.role === "moderator"
          ? { key: "removeAdmin", label: "Yöneticilikten al", icon: "shield-outline" }
          : { key: "makeAdmin", label: "Yönetici yap", icon: "shield-checkmark-outline" },
      );
    }
    actions.push({ key: "ban", label: "Odadan banla", icon: "ban-outline", danger: true });
    return actions;
  };

  const toggleAdmin = async (participant) => {
    const nextRole = participant.role === "moderator" ? "speaker" : "moderator";
    setStaffBusy(participant.userId);
    try {
      await manageParticipant(
        participant,
        participant.role === "moderator" ? "remove_moderator" : "make_moderator",
      );
      setProfileParticipant((current) =>
        current?.userId === participant.userId ? { ...current, role: nextRole } : current,
      );
      appendSystemMessage(
        nextRole === "moderator"
          ? `${participant.name} artık yönetici.`
          : `${participant.name} yöneticilikten alındı.`,
      );
    } catch (error) {
      Alert.alert("Yetki değiştirilemedi", describeRoomError(error));
    } finally {
      setStaffBusy(null);
    }
  };

  const handleStaffAction = async (key) => {
    const participant = profileParticipant;
    if (!participant) return;
    if (key === "ban") {
      setProfileParticipant(null);
      setSelectedParticipant(null);
      setTimeout(() => setBanTarget(participant), 300);
      return;
    }
    if (key === "makeAdmin" || key === "removeAdmin") {
      await toggleAdmin(participant);
      return;
    }
    const result =
      key === "kick"
        ? await runSeatAction("kick", { targetUserId: participant.userId })
        : await runSeatAction("assign", {
            targetUserId: participant.userId,
            seatIndex: key === "couple" ? COUPLE_SEAT_INDEX : null,
          });
    if (!result) return;
    setProfileParticipant(null);
    setSelectedParticipant(null);
    refreshMembers();
    if (key === "kick") {
      appendSystemMessage(`${participant.name} mikrofondan indirildi. 10 dakika mikrofona çıkamaz.`);
    }
  };

  const approveMicRequest = async (person) => {
    setStaffBusy(person.userId);
    const result = await runSeatAction("assign", { targetUserId: person.userId });
    setStaffBusy(null);
    if (result) {
      setRoomMembers((current) =>
        current.map((member) =>
          member.userId === person.userId ? { ...member, handRaisedAt: null } : member,
        ),
      );
      refreshMembers();
    }
  };

  const rejectMicRequest = async (person) => {
    setStaffBusy(person.userId);
    const result = await runSeatAction("reject", { targetUserId: person.userId });
    setStaffBusy(null);
    if (result) {
      setRoomMembers((current) =>
        current.map((member) =>
          member.userId === person.userId ? { ...member, handRaisedAt: null } : member,
        ),
      );
    }
  };

  const banSelectedTarget = async (minutes) => {
    const target = banTarget;
    if (!target) return;
    setStaffBusy(target.userId);
    try {
      await banRoomMember({
        roomId: room.id,
        targetUserId: target.userId,
        minutes,
        accessToken,
      });
      setRoomMembers((current) => current.filter((member) => member.userId !== target.userId));
      const durationLabel =
        ROOM_BAN_DURATIONS.find((option) => option.minutes === minutes)?.label || "";
      appendSystemMessage(
        minutes
          ? `${target.name} odadan ${durationLabel} uzaklaştırıldı.`
          : `${target.name} odadan kalıcı olarak uzaklaştırıldı.`,
      );
      setBanTarget(null);
    } catch (error) {
      Alert.alert("Banlanamadı", describeRoomError(error));
    } finally {
      setStaffBusy(null);
    }
  };

  // ── Oda sahibi ayarları ───────────────────────────────────────────────
  const applyRoomRow = useCallback((row) => {
    const nextDetails = roomDetailsFromRow(row);
    if (nextDetails) setRoomDetails((current) => ({ ...current, ...nextDetails }));
  }, []);

  useEffect(() => {
    if (menuSheet !== "settings" || !room.persisted) return undefined;
    let active = true;
    getBackgroundUploadsEnabled().then((enabled) => {
      if (active) setBackgroundUploadsEnabled(enabled);
    });
    getLatestBackgroundRequest(room.id).then((request) => {
      if (active) setBackgroundRequest(request);
    });
    return () => {
      active = false;
    };
  }, [menuSheet, room.id, room.persisted]);

  useEffect(() => {
    let active = true;
    if (!roomDetails.backgroundPath || !room.persisted) {
      setBackgroundUrl(null);
      return undefined;
    }
    getSignedRoomFileUrl("room-backgrounds", roomDetails.backgroundPath, 6 * 3600)
      .then((url) => {
        if (active) setBackgroundUrl(url);
      })
      .catch(() => {
        if (active) setBackgroundUrl(null);
      });
    return () => {
      active = false;
    };
  }, [room.persisted, roomDetails.backgroundPath]);

  const saveRoomDetails = async (values) => {
    setSavingSettings(true);
    try {
      const row = await updateRoomDetails({ roomId: room.id, ...values });
      applyRoomRow(row);
      setMenuSheet(null);
    } catch (error) {
      Alert.alert("Kaydedilemedi", describeRoomError(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveRoomPassword = async (pin) => {
    setSavingSettings(true);
    try {
      const row = await setRoomPassword({ roomId: room.id, password: pin });
      applyRoomRow(row);
      setMenuSheet(null);
      Alert.alert(
        pin ? "Oda kilitlendi" : "Kilit kaldırıldı",
        pin
          ? "Yeni gelenler odaya girmek için 4 haneli şifreyi yazmalı."
          : "Oda artık herkese açık.",
      );
    } catch (error) {
      Alert.alert("Kilit değiştirilemedi", describeRoomError(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveRoomLayout = async (layout) => {
    setSavingSettings(true);
    try {
      const row = await updateRoomLayout({ roomId: room.id, ...layout, accessToken });
      applyRoomRow(row);
      setMenuSheet(null);
    } catch (error) {
      Alert.alert("Mikrofon sayısı değiştirilemedi", describeRoomError(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const pickRoomBackground = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 6 * 1024 * 1024) {
        Alert.alert("Görsel çok büyük", "En fazla 6 MB boyutunda bir görsel seç.");
        return;
      }
      setUploadingBackground(true);
      const request = await uploadRoomBackground({ roomId: room.id, asset });
      setBackgroundRequest(request);
      Alert.alert(
        "İncelemeye gönderildi",
        "Arka plan onaylandığında odada herkes için görünecek.",
      );
    } catch (error) {
      Alert.alert("Arka plan gönderilemedi", describeRoomError(error));
    } finally {
      setUploadingBackground(false);
    }
  };

  const removeRoomBackground = () =>
    Alert.alert("Arka plan kaldırılsın mı?", "Oda varsayılan arka plana döner.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Kaldır",
        style: "destructive",
        onPress: async () => {
          try {
            applyRoomRow(await clearRoomBackground(room.id));
          } catch (error) {
            Alert.alert("Kaldırılamadı", describeRoomError(error));
          }
        },
      },
    ]);

  // ── Oda müziği ────────────────────────────────────────────────────────
  const loadMusicTracks = useCallback(async () => {
    if (!room.persisted) return;
    setMusicTracksLoading(true);
    setMusicTracksError(null);
    try {
      setMusicTracks(await listRoomMusic(room.id));
    } catch (error) {
      setMusicTracks([]);
      setMusicTracksError(describeRoomError(error));
    } finally {
      setMusicTracksLoading(false);
    }
  }, [room.id, room.persisted]);

  useEffect(() => {
    if (menuSheet === "music" && canModerate) loadMusicTracks();
  }, [canModerate, loadMusicTracks, menuSheet]);

  const pushMusicState = async (state) => {
    if (!room.persisted) {
      Alert.alert("Kullanılamıyor", "Örnek odalarda müzik çalınamaz.");
      return;
    }
    if (musicBusyRef.current) return false;
    musicBusyRef.current = true;
    setMusicBusy(true);
    try {
      applyRoomRow(await setRoomMusic({ roomId: room.id, state }));
      return true;
    } catch (error) {
      Alert.alert("Müzik güncellenemedi", describeRoomError(error));
      return false;
    } finally {
      musicBusyRef.current = false;
      setMusicBusy(false);
    }
  };

  const currentMusicVolume = roomDetails.musicState?.volume ?? 0.7;

  const addMusicTrack = async () => {
    if (!room.persisted) {
      Alert.alert("Kullanılamıyor", "Örnek odalarda müzik çalınamaz.");
      return;
    }
    if (musicBusyRef.current) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 25 * 1024 * 1024) {
        Alert.alert("Dosya çok büyük", "En fazla 25 MB boyutunda bir müzik dosyası seç.");
        return;
      }
      musicBusyRef.current = true;
      setMusicBusy(true);
      const path = await uploadRoomMusic({ roomId: room.id, asset });
      const title = String(asset.name || "").replace(/\.[^.]+$/, "") || musicTitleFromPath(path);
      setMusicTracks((current) => [{ path, title }, ...current]);
      applyRoomRow(
        await setRoomMusic({
          roomId: room.id,
          state: { path, title, playing: true, position_ms: 0, volume: currentMusicVolume },
        }),
      );
    } catch (error) {
      Alert.alert("Müzik eklenemedi", describeRoomError(error));
    } finally {
      musicBusyRef.current = false;
      setMusicBusy(false);
    }
  };

  const playMusicTrack = (track) =>
    pushMusicState({
      path: track.path,
      title: track.title,
      playing: true,
      position_ms: 0,
      volume: currentMusicVolume,
    });

  const toggleMusicPlay = () => {
    const state = roomDetails.musicState;
    if (!state) return;
    pushMusicState({ ...state, playing: !state.playing, position_ms: music.currentPositionMs() });
  };

  const stopMusic = () => pushMusicState(null);

  const setMusicRoomVolume = (volume) => {
    const state = roomDetails.musicState;
    if (!state) return;
    pushMusicState({ ...state, volume, position_ms: music.currentPositionMs() });
  };

  const removeMusicTrack = (track) =>
    Alert.alert("Müzik silinsin mi?", `${track.title} oda listesinden kaldırılacak.`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          if (musicBusyRef.current) return;
          musicBusyRef.current = true;
          setMusicBusy(true);
          try {
            if (roomDetails.musicState?.path === track.path) {
              const stopped = await setRoomMusic({ roomId: room.id, state: null });
              applyRoomRow(stopped);
            }
            await deleteRoomMusic(track.path);
            setMusicTracks((current) => current.filter((item) => item.path !== track.path));
          } catch (error) {
            Alert.alert("Silinemedi", describeRoomError(error));
          } finally {
            musicBusyRef.current = false;
            setMusicBusy(false);
          }
        },
      },
    ]);

  const handleMenuAction = (key) => {
    if (key === "toggleQueue") {
      toggleRoomLock();
      return;
    }
    if (key === "toggleChat") {
      toggleChatLock();
      return;
    }
    setSettingsOpen(false);
    // Bir modal kapanırken diğerini açmak Android'de takılabildiği için bekle.
    const openLater = (callback) => setTimeout(callback, 320);
    if (["settings", "music", "admins", "requests", "lock", "seats"].includes(key)) {
      if (!room.persisted && key !== "music") {
        openLater(() =>
          Alert.alert("Kullanılamıyor", "Bu ayar yalnızca gerçek odalarda kullanılabilir."),
        );
        return;
      }
      openLater(() => setMenuSheet(key));
    } else if (key === "invite") openLater(shareRoom);
    else if (key === "report") openLater(reportRoom);
    else if (key === "blockHost") openLater(handleBlockHost);
  };

  const closeMenuSheet = useCallback(() => setMenuSheet(null), []);

  const shareRoom = async () => {
    try {
      await Share.share({
        title: `Sora · ${room.title}`,
        message: `${room.title} odasına katıl.\nEv sahibi: ${room.host}\nOda kodu: ${room.id}`,
      });
    } catch {
      return;
    }
  };

  const chatStatusText = !messagesReady
    ? "Mesajlar yükleniyor…"
    : chatRealtimeStatus === "error" || chatRealtimeStatus === "offline"
      ? "Sohbet bağlantısı kesildi"
      : chatRealtimeStatus === "connecting"
        ? "Sohbet bağlanıyor…"
        : null;

  const keyboard = useKeyboardInset();

  useEffect(() => {
    if (keyboard.visible) {
      const timer = setTimeout(() => {
        chatScrollRef.current?.scrollToEnd?.({ animated: true });
      }, 90);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [keyboard.visible]);

  const participantById = useMemo(() => {
    const map = new Map();
    for (const member of roomMembers) {
      if (member?.userId) {
        map.set(member.userId, {
          userId: member.userId,
          name: member.name,
          avatarUrl: member.avatarUrl || null,
          color: member.color || COLORS.primary,
          role: member.role,
          seat: member.seat,
          activeFrameId: member.activeFrameId || null,
        });
      }
    }
    for (const participant of activeRoomParticipants) {
      if (participant?.userId) {
        const prev = map.get(participant.userId);
        map.set(participant.userId, {
          ...prev,
          ...participant,
          avatarUrl: participant.avatarUrl || prev?.avatarUrl || null,
          color: participant.color || prev?.color || COLORS.primary,
          activeFrameId: participant.activeFrameId || prev?.activeFrameId || null,
        });
      }
    }
    if (userId) {
      const prev = map.get(userId);
      map.set(userId, {
        ...prev,
        userId,
        name: profile?.name || prev?.name || "Sen",
        avatarUrl: profile?.avatarUrl || prev?.avatarUrl || null,
        color: profile?.color || prev?.color || COLORS.primary,
        activeFrameId: profile?.activeFrameId || prev?.activeFrameId || null,
      });
    }
    return map;
  }, [activeRoomParticipants, profile?.activeFrameId, profile?.avatarUrl, profile?.color, profile?.name, roomMembers, userId]);

  const roomGiftRecipients = useMemo(() => {
    const others = activeRoomParticipants.filter((participant) => participant.userId !== userId);
    const selfEntry = userId
      ? [
          {
            userId,
            name: profile?.name || "Kendim",
            avatarUrl: profile?.avatarUrl || null,
            color: profile?.color || COLORS.primary,
            isSelf: true,
          },
        ]
      : [];
    return [...others, ...selfEntry];
  }, [activeRoomParticipants, profile?.avatarUrl, profile?.color, profile?.name, userId]);

  const handleMessageSenderPress = useCallback(
    (msgItem) => {
      if (!msgItem?.userId) return;
      if (msgItem.userId === userId) {
        handleOwnSeatPress();
        return;
      }
      const found = participantById.get(msgItem.userId) || {
        userId: msgItem.userId,
        name: msgItem.user || "Sora kullanıcısı",
        avatarUrl: msgItem.avatarUrl || null,
        color: msgItem.avatarColor || COLORS.primary,
      };
      openParticipantMenu(found);
    },
    [handleOwnSeatPress, openParticipantMenu, participantById, userId],
  );

  const audienceParticipants = activeRoomParticipants.filter(
    (participant) => !stageParticipants.some((speaker) => speaker.userId === participant.userId),
  );

  const handleChatScroll = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    chatNearBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
  }, []);
  const handleChatContentSize = useCallback(() => {
    if (chatNearBottomRef.current) chatScrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const voiceErrorText =
    liveVoice.status === "error" && liveVoice.error
      ? describeRoomError({ message: liveVoice.error }, roomVoiceLabel)
      : roomVoiceLabel;

  const micButtonIcon = micOn
    ? "mic"
    : iAmSeated
      ? "mic-off"
      : handRaised
        ? "hand-left"
        : "mic-off-outline";
  const micButtonLabel = micOn
    ? "Mikrofonu kapat"
    : iAmSeated
      ? "Mikrofonu aç"
      : handRaised
        ? "Mikrofon isteğin bekliyor"
        : canModerate
          ? "Mikrofona çık"
          : "Mikrofon iste";

  const renderStageSeat = (participant, seatIndex, variant = "regular") => {
    const isHostSeat = variant === "host";
    const isCoupleSeat = variant === "couple";
    const avatarSize = isHostSeat ? 84 : compactStage ? 58 : 66;
    const slotStyle = [
      styles.roomSpeakerSlot,
      isHostSeat && styles.roomHostStageSlot,
      (isHostSeat || isCoupleSeat) && roomDetails.coupleSeat && styles.roomHostPairSlot,
      compactStage && !isHostSeat && styles.roomSpeakerSlotCompact,
    ];
    if (!participant) {
      return (
        <Pressable
          key={`empty-${seatIndex}`}
          style={slotStyle}
          onPress={() => handleEmptySeatPress(seatIndex)}
          accessibilityRole="button"
          accessibilityLabel={isCoupleSeat ? "Boş konuk koltuğu" : `Boş ${seatIndex}. koltuk`}
        >
          <View
            style={[
              styles.roomEmptySeat,
              { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
            ]}
          >
            <Ionicons
              name="mic-outline"
              size={compactStage ? 24 : 28}
              color="rgba(118,175,255,0.78)"
            />
          </View>
          <Text style={styles.roomEmptySeatLabel}>
            {isCoupleSeat ? "Konuk" : seatIndex}
          </Text>
        </Pressable>
      );
    }
    const isSelfSeat = participant.userId === userId || (isHostSeat && isHost);
    const seatFrameAppearance =
      PROFILE_ITEM_APPEARANCE[
        isSelfSeat
          ? profile?.activeFrameId || participant.activeFrameId
          : participant.activeFrameId || participantById.get(participant.userId)?.activeFrameId
      ];
    return (
      <Pressable
        style={slotStyle}
        key={participant.userId}
        delayLongPress={260}
        onPress={() => (isSelfSeat ? handleOwnSeatPress() : openParticipantMenu(participant))}
        onLongPress={() => (isSelfSeat ? handleOwnSeatPress() : openParticipantMenu(participant))}
        accessibilityRole="button"
        accessibilityLabel={`${participant.name} kullanıcı menüsü`}
      >
        <View style={styles.roomAvatarWrap}>
          {participant.isSpeaking ? (
            <SpeakingRing size={avatarSize + 14} color={COLORS.primary} />
          ) : null}
          <ProfileFrame appearance={seatFrameAppearance} size={avatarSize}>
            <View
              style={[
                styles.roomSpeakerAvatar,
                { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
                isHostSeat && styles.roomHostStageAvatar,
                participant.role === "host" && styles.roomSpeakerAvatarHost,
                participant.microphoneEnabled && styles.roomSpeakerAvatarActive,
              ]}
            >
              <LinearGradient
                colors={
                  isHostSeat
                    ? ["#8CC8FF", "#347CE0"]
                    : ["#527DB8", "#203D66"]
                }
                style={[StyleSheet.absoluteFill, { borderRadius: avatarSize / 2 }]}
              />
              {participant.avatarUrl ? (
                <Image
                  source={{ uri: participant.avatarUrl }}
                  style={[StyleSheet.absoluteFill, { borderRadius: (avatarSize - 4) / 2 }]}
                />
              ) : (
                <Text style={[styles.roomSpeakerInitial, isHostSeat && styles.roomHostStageInitial]}>
                  {participant.name?.charAt(0)?.toUpperCase() || "?"}
                </Text>
              )}
              {participant.microphoneEnabled ? (
                <View style={styles.roomMicOnBadge}>
                  <Ionicons name="mic" size={9} color="#11131A" />
                </View>
              ) : (
                <View style={styles.roomMicOffBadge}>
                  <Ionicons name="mic-off" size={9} color="rgba(255,255,255,0.7)" />
                </View>
              )}
            </View>
          </ProfileFrame>
          {participant.role === "host" ? (
            <View style={styles.roomSpeakerCrown}>
              <Ionicons name="sparkles" size={9} color="#11131A" />
            </View>
          ) : participant.role === "moderator" ? (
            <View style={[styles.roomSpeakerCrown, styles.roomAdminBadge]}>
              <Ionicons name="shield-checkmark" size={9} color="#11131A" />
            </View>
          ) : null}
        </View>
        <Text style={styles.roomSpeakerName} numberOfLines={1}>
          {isHostSeat ? `1 · ${participant.name}` : participant.name}
        </Text>
        {!isHostSeat ? (
          <Text style={styles.roomSpeakerRole} numberOfLines={1}>
            {participant.isSpeaking ? "Konuşuyor" : isCoupleSeat ? "Konuk" : `${seatIndex}`}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View collapsable={false} style={styles.roomRootWrap}>
      <SafeAreaView style={styles.roomScreen}>
        <LinearGradient
          colors={["#142746", "#101A2B", "#0A101B"]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {backgroundUrl ? (
        <>
          <Image
            source={{ uri: backgroundUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["rgba(8,13,24,0.45)", "rgba(8,13,24,0.55)", "rgba(8,13,24,0.88)"]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      ) : null}
      {minimized ? null : (
        <StatusBar barStyle="light-content" backgroundColor="#11131A" />
      )}
      <KeyboardSafeView iosOffset={insets.top} style={{ flex: 1 }}>
        {/* ── Üst bar: küçült · oda bilgisi · menü · çıkış ── */}
        <View style={styles.roomTopBar}>
          <Pressable
            onPress={onMinimize}
            style={styles.roomTopBarBack}
            accessibilityLabel="Odayı küçült"
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.roomHeaderRoom}>
            <View style={styles.roomTitleLine}>
              {roomDetails.passwordProtected ? (
                <Ionicons name="lock-closed" size={13} color="#A9C9F4" />
              ) : null}
              <Text style={styles.roomTopBarTitle} numberOfLines={1}>
                {roomDetails.title}
              </Text>
              {!isHost && room.hostId ? (
                <Pressable
                  onPress={onToggleFollowHost}
                  hitSlop={8}
                  style={[
                    styles.roomHeaderFollowPill,
                    isFollowingHost && styles.roomHeaderFollowPillActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isFollowingHost ? "Takipte" : "Takip et"}
                >
                  <Text
                    style={[
                      styles.roomHeaderFollowText,
                      isFollowingHost && styles.roomHeaderFollowTextActive,
                    ]}
                  >
                    {isFollowingHost ? "Takipte" : "Takip et"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.roomHeaderCaption} numberOfLines={1}>
              {formatCategoryLabel(room.category)} · {Math.max(liveVoice.participantCount, activeRoomParticipants.length)} kişi
              {musicPlaying ? " · müzik" : ""}
            </Text>
          </View>
          <Pressable
            onPress={handleOpenSettings}
            style={styles.roomTopBarMore}
            accessibilityLabel="Oda seçenekleri"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
            {canModerate && micRequests.length ? (
              <View style={styles.roomTopBarBadge}>
                <Text style={styles.roomTopBarBadgeText}>
                  {micRequests.length > 9 ? "9+" : micRequests.length}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={leaveRoom}
            style={[styles.roomTopBarMore, styles.roomTopBarLeave]}
            accessibilityLabel="Odadan çık"
          >
            <Ionicons name="power" size={18} color="#F3A9AC" />
          </Pressable>
        </View>

        {liveVoice.status === "error" ? (
          <View style={styles.roomConnectionNotice}>
            <Ionicons name="alert-circle-outline" size={14} color="#A9BEDB" />
            <Text style={styles.roomConnectionText}>{voiceErrorText}</Text>
            <Pressable
              style={styles.roomRetryPill}
              onPress={retryVoiceConnection}
            >
              <Ionicons name="refresh" size={12} color={COLORS.primary} />
              <Text style={styles.roomRetryText}>Yeniden dene</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Sahne sabit kalır, yalnızca sohbet alanı dikey kayar */}
        <View style={styles.roomSurface}>
          {/* Sahne: oda sahibi (+ çift koltuğu) + 4'erli sıralar */}
          <View style={styles.roomStage}>
            <LinearGradient
              colors={["rgba(47,128,237,0.16)", "rgba(82,104,174,0.035)", "rgba(47,128,237,0)"]}
              locations={[0, 0.48, 1]}
              style={styles.roomStageGlow}
              pointerEvents="none"
            />
            <View style={styles.roomHostSeatRow}>
              {renderStageSeat(hostStageParticipant, 0, "host")}
              {roomDetails.coupleSeat
                ? renderStageSeat(seatedByIndex.get(COUPLE_SEAT_INDEX) || null, COUPLE_SEAT_INDEX, "couple")
                : null}
            </View>
            <View style={[styles.roomSpeakerGrid, compactStage && styles.roomSpeakerGridCompact]}>
              {regularSeatRows.flat().map(({ index, participant }) =>
                renderStageSeat(participant, index),
              )}
            </View>
          </View>

          {/* Odadakiler */}
          {audienceParticipants.length > 0 && !roomKeyboard.visible && (
            <View style={styles.roomAudienceSection}>
              <View style={styles.roomChatHead}>
                <Text style={styles.roomChatTitle}>Dinleyiciler</Text>
                <Text style={styles.roomChatCount}>
                  {audienceParticipants.length} kişi
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.roomAudienceRow}
                keyboardShouldPersistTaps="handled"
              >
                {audienceParticipants.map((participant) => (
                  <Pressable
                    key={participant.userId}
                    style={styles.roomAudienceItem}
                    delayLongPress={260}
                    onPress={() =>
                      participant.userId === userId
                        ? handleOwnSeatPress()
                        : openParticipantMenu(participant)
                    }
                    onLongPress={() =>
                      participant.userId === userId
                        ? handleOwnSeatPress()
                        : openParticipantMenu(participant)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${participant.name} kullanıcı menüsü`}
                  >
                    <View style={styles.roomAvatarWrap}>
                      <View
                        style={[
                          styles.roomAudienceAvatar,
                          { backgroundColor: participant.color },
                        ]}
                      >
                        {participant.avatarUrl ? (
                          <Image
                            source={{ uri: participant.avatarUrl }}
                            style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
                          />
                        ) : (
                          <Text style={styles.roomAudienceInitial}>
                            {participant.name?.charAt(0)?.toUpperCase() || "?"}
                          </Text>
                        )}
                        {participant.role === "moderator" ? (
                          <View style={styles.roomAudienceCrown}>
                            <Ionicons name="shield-checkmark" size={8} color="#11131A" />
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.roomAudienceName} numberOfLines={1}>
                      {participant.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <ScrollView
          ref={chatScrollRef}
          style={styles.roomChatScroll}
          contentContainerStyle={styles.roomChatScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          bounces={false}
          onScroll={handleChatScroll}
          scrollEventThrottle={64}
          onContentSizeChange={handleChatContentSize}
        >
          {/* Sohbet: ayrı bir kutu değil, yalnızca burası aşağıya kayar */}
          <View style={styles.roomChatFlow}>
            {chatStatusText ? (
              <Text style={styles.roomChatStatus}>{chatStatusText}</Text>
            ) : null}
            <RoomMessageList
              messages={messages}
              canReportBase={room.persisted}
              userId={userId}
              currentProfile={profile}
              participantById={participantById}
              onPressSender={handleMessageSenderPress}
              onReport={handleReportMessage}
            />
          </View>
        </ScrollView>

        <GiftComboButton
          combo={minimized || giftOpen ? null : roomCombo}
          onPress={handleRoomComboPress}
          onExpire={handleExpireRoomCombo}
          bottomOffset={70}
        />

        {/* Alt bar: mesaj yazma alanı + hemen yanında hediye + mikrofon + ses + müzik */}
        <View style={styles.roomBottomBar}>
          <RoomComposer onSend={sendMessage} sending={messageSending} />
          <Pressable
            style={[styles.roomBarButton, styles.roomBarGift]}
            onPress={handleOpenGift}
            accessibilityRole="button"
            accessibilityLabel="Hediye gönder"
          >
            <Ionicons name="gift" size={19} color="#FFFFFF" />
          </Pressable>
          <Pressable
            style={[
              styles.roomBarButton,
              micOn && styles.roomBarButtonActive,
              !micOn && handRaised && !iAmSeated && styles.roomBarButtonPending,
            ]}
            onPress={toggleMicrophone}
            accessibilityRole="button"
            accessibilityLabel={micButtonLabel}
            accessibilityState={{ selected: micOn }}
          >
            <Ionicons
              name={micButtonIcon}
              size={20}
              color={micOn ? "#FFFFFF" : iAmSeated ? "#DBE8FB" : "#8FA6C4"}
            />
          </Pressable>
          <Pressable
            style={[styles.roomBarButton, !speakerOn && styles.roomBarButtonMuted]}
            onPress={handleToggleSpeaker}
            accessibilityRole="button"
            accessibilityLabel={speakerOn ? "Oda sesini kapat" : "Oda sesini aç"}
            accessibilityState={{ selected: speakerOn }}
          >
            <Ionicons
              name={speakerOn ? "volume-high" : "volume-mute"}
              size={20}
              color={speakerOn ? "#DBE8FB" : "#F3A9AC"}
            />
          </Pressable>
          <Pressable
            style={[styles.roomBarButton, musicPlaying && styles.roomBarButtonOn]}
            onPress={() => setMenuSheet("music")}
            accessibilityRole="button"
            accessibilityLabel="Müzik"
          >
            <Ionicons
              name={musicPlaying ? "musical-notes" : "musical-notes-outline"}
              size={19}
              color={musicPlaying ? COLORS.primaryLight : "#DBE8FB"}
            />
          </Pressable>
        </View>
      </KeyboardSafeView>

      <RoomMenuSheet
        visible={settingsOpen}
        menuRole={room.persisted ? menuRole : isHost ? "owner" : "member"}
        roomLocked={roomLocked}
        chatLocked={chatLocked}
        passwordProtected={roomDetails.passwordProtected}
        seatCount={seatCapacity}
        coupleSeat={roomDetails.coupleSeat}
        requestCount={micRequests.length}
        adminCount={adminCount}
        musicPlaying={musicPlaying}
        canBlockHost={Boolean(room.hostId && room.hostId !== userId)}
        onAction={handleMenuAction}
        onDismiss={handleCloseSettings}
      />
      <RoomSettingsEditorSheet
        visible={menuSheet === "settings"}
        details={roomDetails}
        backgroundUrl={backgroundUrl}
        backgroundRequest={backgroundRequest}
        backgroundUploadsEnabled={backgroundUploadsEnabled}
        saving={savingSettings}
        uploadingBackground={uploadingBackground}
        onSave={saveRoomDetails}
        onPickBackground={pickRoomBackground}
        onClearBackground={removeRoomBackground}
        onOpenMusic={() => {
          setMenuSheet(null);
          setTimeout(() => setMenuSheet("music"), 320);
        }}
        onDismiss={closeMenuSheet}
      />
      <RoomMusicSheet
        visible={menuSheet === "music"}
        canControl={Boolean(room.persisted && canModerate)}
        musicState={roomDetails.musicState}
        music={music}
        tracks={musicTracks}
        loadingTracks={musicTracksLoading}
        tracksError={musicTracksError}
        busy={musicBusy}
        onAddTrack={addMusicTrack}
        onPlayTrack={playMusicTrack}
        onTogglePlay={toggleMusicPlay}
        onStop={stopMusic}
        onRoomVolume={setMusicRoomVolume}
        onDeleteTrack={removeMusicTrack}
        onRetryTracks={loadMusicTracks}
        onDismiss={closeMenuSheet}
      />
      <RoomAdminsSheet
        visible={menuSheet === "admins"}
        participants={roomAdminCandidates}
        busyUserId={staffBusy}
        onToggleAdmin={toggleAdmin}
        onDismiss={closeMenuSheet}
      />
      <MicRequestsSheet
        visible={menuSheet === "requests"}
        requests={micRequests}
        busyUserId={staffBusy}
        onApprove={approveMicRequest}
        onReject={rejectMicRequest}
        onDismiss={closeMenuSheet}
      />
      <RoomLockSheet
        visible={menuSheet === "lock"}
        passwordProtected={roomDetails.passwordProtected}
        saving={savingSettings}
        onSave={saveRoomPassword}
        onDismiss={closeMenuSheet}
      />
      <RoomSeatsSheet
        visible={menuSheet === "seats"}
        seatCount={seatCapacity}
        coupleSeat={roomDetails.coupleSeat}
        saving={savingSettings}
        onSave={saveRoomLayout}
        onDismiss={closeMenuSheet}
      />
      <BanDurationSheet
        participant={banTarget}
        busy={Boolean(banTarget && staffBusy === banTarget.userId)}
        canPermanentBan={isHost}
        onSelect={banSelectedTarget}
        onDismiss={() => setBanTarget(null)}
      />
      <GiftSheet
        visible={giftOpen}
        coins={coins}
        userFamilyLevel={userFamilyLevel}
        gifts={roomGiftCatalog}
        recipients={roomGiftRecipients}
        onDismiss={handleCloseGift}
        onSend={handleSendGiftFromSheet}
      />
      <ReportSheet target={reportTarget} onDismiss={handleCloseReport} />
      <ParticipantActionSheet
        participant={profileParticipant ? null : selectedParticipant}
        isFollowing={selectedIsFollowing}
        canBlock={Boolean(room.persisted && selectedParticipant?.userId)}
        onViewProfile={handleViewSelectedProfile}
        onToggleFollow={handleSelectedFollow}
        onBlock={handleSelectedBlock}
        onReport={handleSelectedReport}
        onDismiss={closeParticipantMenu}
      />
      <SelfRoomSheet
        visible={selfSheetOpen}
        profile={profile}
        avatarUrl={profile?.avatarUrl || myMember?.avatarUrl || null}
        roleLabel={
          isHost
            ? "Oda sahibi"
            : myRole === "moderator"
              ? iAmSeated
                ? "Yönetici · Mikrofonda"
                : "Yönetici"
              : iAmSeated
                ? "Mikrofonda"
                : "Dinleyici"
        }
        canLeaveMic={Boolean(iAmSeated && !isHost)}
        onOpenProfile={handleOpenSelfProfile}
        onLeaveMic={handleSelfLeaveMic}
        onDismiss={() => setSelfSheetOpen(false)}
      />
      <ProfileDetailSheet
        visible={Boolean(selfProfileOpen || profileParticipant)}
        profile={selfProfileOpen ? profile : profileParticipant}
        userId={selfProfileOpen ? userId : profileParticipant?.userId}
        roomContext={selfProfileOpen ? null : { ...room, title: roomDetails.title }}
        isSelf={selfProfileOpen || profileParticipant?.userId === userId}
        onEdit={onEditProfile}
        isFollowing={selectedIsFollowing}
        canBlock={Boolean(!selfProfileOpen && room.persisted && profileParticipant?.userId)}
        onToggleFollow={handleSelectedFollow}
        onBlock={handleSelectedBlock}
        onReport={handleSelectedReport}
        staffActions={selfProfileOpen ? [] : staffActionsFor(profileParticipant)}
        onStaffAction={handleStaffAction}
        onDismiss={() => {
          setSelfProfileOpen(false);
          setProfileParticipant(null);
          setSelectedParticipant(null);
        }}
      />
      </SafeAreaView>
      <SoraGiftEffect gift={minimized ? null : giftFlight} />
    </View>
  );
}

function ProfileEditor({
  visible,
  profile,
  onDismiss,
  onSave,
  onEquipItem,
  onBalanceRefresh,
  onAvatarChange,
}) {
  const [name, setName] = useState(profile.name || "");
  const [handle, setHandle] = useState(profile.handle || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [color, setColor] = useState(profile.color || DEFAULT_PROFILE.color);
  const [profileItems, setProfileItems] = useState([]);
  const [ownedItemIds, setOwnedItemIds] = useState([]);
  const [previewItemId, setPreviewItemId] = useState(null);
  const [itemBusy, setItemBusy] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  useEffect(() => {
    if (visible) setAvatarUrl(profile.avatarUrl || null);
  }, [visible, profile.avatarUrl]);
  const getSelfId = async () => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  };
  const pickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 3 * 1024 * 1024) {
        Alert.alert("Görsel çok büyük", "En fazla 3 MB boyutunda bir görsel seç.");
        return;
      }
      const userId = await getSelfId();
      if (!userId) {
        setAvatarUrl(asset.uri);
        return;
      }
      setAvatarBusy(true);
      const url = await uploadProfileAvatar({ userId, asset });
      setAvatarUrl(url);
      onAvatarChange?.(url);
    } catch (error) {
      console.warn("Avatar upload failed", error);
      Alert.alert("Resim yüklenemedi", "Bağlantını kontrol edip tekrar dene.");
    } finally {
      setAvatarBusy(false);
    }
  };
  const clearAvatar = async () => {
    try {
      setAvatarBusy(true);
      const userId = await getSelfId();
      if (userId) await removeProfileAvatar({ userId });
      setAvatarUrl(null);
      onAvatarChange?.(null);
    } catch {
      Alert.alert("Resim kaldırılamadı", "Bağlantını kontrol edip tekrar dene.");
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setName(profile.name || "");
      setHandle(profile.handle || "");
      setBio(profile.bio || "");
      setColor(profile.color || DEFAULT_PROFILE.color);
      setPreviewItemId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !supabase) return;
    listProfileItems()
      .then(({ items, ownedIds }) => {
        setProfileItems(items || []);
        setOwnedItemIds(ownedIds || []);
      })
      .catch(() => {
        setProfileItems([]);
        setOwnedItemIds([]);
      });
  }, [visible]);

  const activePreview = profileItems.find((item) => item.id === previewItemId);
  const editorFrameId =
    activePreview?.item_type === "frame" ? activePreview.id : profile.activeFrameId;
  const editorFrameAppearance = PROFILE_ITEM_APPEARANCE[editorFrameId];
  const isEquippedItem = (item) =>
    item?.item_type === "frame"
      ? profile.activeFrameId === item.id
      : profile.activeProfileThemeId === item?.id;
  const handleProfileItem = (item) => {
    if (ownedItemIds.includes(item.id)) {
      const unequipping = isEquippedItem(item);
      const patch =
        item.item_type === "frame"
          ? { activeFrameId: unequipping ? null : item.id }
          : { activeProfileThemeId: unequipping ? null : item.id };
      setItemBusy(item.id);
      activateProfileItem(
        unequipping ? (item.item_type === "frame" ? "none_frame" : "none_theme") : item.id,
      )
        .then(() => {
          if (onEquipItem) {
            onEquipItem(patch);
          } else {
            onSave({ ...profile, ...patch });
          }
        })
        .catch(() => Alert.alert("Ürün güncellenemedi", "Biraz sonra yeniden dene."))
        .finally(() => setItemBusy(null));
      return;
    }
    if (item.purchasable === false) {
      Alert.alert(
        "Aile seviye ödülü",
        "Bu çerçeve doğrudan kredi ile satılmaz; aile seviyen yükseldiğinde ücretsiz açılır.",
      );
      return;
    }
    Alert.alert("Önizleme ve satın alma", `${item.name} · ${item.cost} kredi. Satın almak istiyor musun?`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Satın al", onPress: async () => {
        if (itemBusy) return;
        setItemBusy(item.id);
        try {
          await purchaseProfileItem({ itemId: item.id, requestId: createRequestUuid() });
          setOwnedItemIds((ids) => [...ids, item.id]);
          await onBalanceRefresh?.();
          Alert.alert("Ürün alındı", "Profilinden etkinleştirebilirsin.");
        } catch (error) {
          Alert.alert(error?.message?.includes("Insufficient") ? "Bakiye yetersiz" : "Satın alma tamamlanamadı", error?.message?.includes("Insufficient") ? "Bu ürün için yeterli kredin yok." : "Bağlantıyı kontrol edip tekrar dene. Bakiye düşürülmediyse yeniden deneyebilirsin.");
        } finally { setItemBusy(null); }
      } },
    ]);
  };

  const save = () => {
    const nextName = (name || "").trim();
    const nextHandle = (handle || "")
      .trim()
      .replace(/^@+/, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (!nextName || !/^[a-z0-9_]{3,24}$/.test(nextHandle)) {
      Alert.alert(
        "Bilgileri kontrol et",
        "Adını ve 3-24 karakterlik kullanıcı adını yaz. Kullanıcı adında sadece küçük harf, sayı ve alt çizgi kullanabilirsin.",
      );
      return;
    }
    onSave({
      ...profile,
      name: nextName.slice(0, 36),
      handle: nextHandle,
      bio: bio.trim().slice(0, 180),
      color,
      avatarUrl,
    });
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardSafeView style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={[styles.sheet, { maxHeight: "88%" }]}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.kicker}>PROFİLİN</Text>
          <Text style={styles.sheetTitle}>Kendini göster.</Text>
          <View style={styles.avatarEditRow}>
            <Pressable
              onPress={pickAvatar}
              disabled={avatarBusy}
              style={styles.avatarEditPress}
              accessibilityLabel="Profil resmini değiştir"
            >
              <ProfileFrame appearance={editorFrameAppearance} size={84}>
                <Avatar
                  label={(name || profile.name || "S").charAt(0).toUpperCase()}
                  color={profile.color}
                  uri={avatarUrl}
                  size={84}
                  circle
                />
              </ProfileFrame>
              <View style={styles.avatarEditBadge}>
                {avatarBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={16} color="#FFFFFF" />
                )}
              </View>
            </Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <Pressable onPress={pickAvatar} disabled={avatarBusy} style={styles.avatarEditButton}>
                <Ionicons name="image-outline" size={16} color={COLORS.primary} />
                <Text style={styles.avatarEditButtonText}>
                  {avatarUrl ? "Resmi değiştir" : "Profil resmi ekle"}
                </Text>
              </Pressable>
              {avatarUrl ? (
                <Pressable onPress={clearAvatar} disabled={avatarBusy}>
                  <Text style={styles.avatarEditRemove}>Resmi kaldır</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <Text style={styles.fieldLabel}>GÖRÜNEN AD</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Adın"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={36}
          />
          <Text style={styles.fieldLabel}>KULLANICI ADI</Text>
          <TextInput
            value={handle}
            onChangeText={setHandle}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="kullaniciadi"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={24}
          />
          <Text style={styles.fieldLabel}>KISA BİYOGRAFİ</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Seni tanıtan kısa bir not"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={180}
            multiline
          />
          {profileItems.length > 0 ? (
            <>
              <Text style={styles.fieldLabel}>ÇERÇEVE VE PROFİL TEMASI</Text>
              {activePreview ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    padding: 12,
                    marginBottom: 10,
                    borderRadius: 14,
                    backgroundColor:
                      PROFILE_ITEM_APPEARANCE[activePreview.id]?.background ||
                      activePreview.appearance?.background ||
                      "#F1F7FB",
                    borderWidth: 1.5,
                    borderColor:
                      PROFILE_ITEM_APPEARANCE[activePreview.id]?.color ||
                      activePreview.appearance?.color ||
                      COLORS.line,
                  }}
                >
                  {activePreview.item_type === "frame" ? (
                    <ProfileFrame
                      appearance={PROFILE_ITEM_APPEARANCE[activePreview.id]}
                      size={44}
                      style={{ marginHorizontal: 6, marginVertical: 4 }}
                    >
                      <Avatar
                        label={(name || profile.name || "S").charAt(0).toUpperCase()}
                        color={profile.color}
                        uri={avatarUrl}
                        size={44}
                        circle
                      />
                    </ProfileFrame>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.text, fontWeight: "800" }}>
                      Önizleme · {activePreview.name}
                    </Text>
                    <Text style={styles.walletActivityTime}>
                      {isEquippedItem(activePreview)
                        ? "Şu anda profilinde aktif"
                        : ownedItemIds.includes(activePreview.id)
                          ? "Sahipsin · etkinleştirebilirsin"
                          : activePreview.purchasable === false
                            ? "Aile seviye ödülü ile açılır"
                            : `${activePreview.cost.toLocaleString("tr-TR")} kredi`}
                    </Text>
                  </View>
                </View>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {profileItems.map((item) => {
                  const owned = ownedItemIds.includes(item.id);
                  const equipped = isEquippedItem(item);
                  const itemAppearance = PROFILE_ITEM_APPEARANCE[item.id];
                  const subtitle = equipped
                    ? "Aktif · dokun kaldır"
                    : owned
                      ? "Sahipsin · etkinleştir"
                      : item.purchasable === false
                        ? "Aile seviye ödülü"
                        : `${item.cost.toLocaleString("tr-TR")} kredi`;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => setPreviewItemId(item.id)}
                      onLongPress={() => handleProfileItem(item)}
                      style={[
                        styles.transferOption,
                        previewItemId === item.id && styles.transferOptionActive,
                        { marginRight: 8, alignItems: "center", minWidth: 118, paddingVertical: 12 },
                      ]}
                    >
                      {item.item_type === "frame" && itemAppearance ? (
                        <View style={{ marginVertical: 6 }}>
                          <ProfileFrame appearance={itemAppearance} size={36}>
                            <Avatar
                              label={(name || profile.name || "S").charAt(0).toUpperCase()}
                              color={profile.color}
                              uri={avatarUrl}
                              size={36}
                              circle
                            />
                          </ProfileFrame>
                        </View>
                      ) : (
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            marginVertical: 6,
                            backgroundColor: itemAppearance?.background || "#E7F2FF",
                            borderWidth: 2,
                            borderColor: itemAppearance?.accent || COLORS.primary,
                          }}
                        />
                      )}
                      <Text
                        style={[
                          styles.transferOptionText,
                          previewItemId === item.id && styles.transferOptionTextActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={[styles.walletActivityTime, { textAlign: "center" }]}>{subtitle}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {activePreview ? (
                <Pressable
                  disabled={Boolean(itemBusy)}
                  onPress={() => handleProfileItem(activePreview)}
                  style={styles.transferCreateButton}
                >
                  <Text style={styles.transferCreateButtonText}>
                    {isEquippedItem(activePreview)
                      ? activePreview.item_type === "frame"
                        ? "Çerçeveyi kaldır"
                        : "Temayı kaldır"
                      : ownedItemIds.includes(activePreview.id)
                        ? "Profili etkinleştir"
                        : activePreview.purchasable === false
                          ? "Aile seviye ödülü"
                          : `Satın al · ${activePreview.cost.toLocaleString("tr-TR")} kredi`}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          <Pressable onPress={save}>
            <LinearGradient colors={BRAND_GRADIENT} style={styles.createSubmit}>
              <Text style={styles.createSubmitText}>Değişiklikleri kaydet</Text>
              <Ionicons name="checkmark" size={20} color={COLORS.primaryInk} />
            </LinearGradient>
          </Pressable>
          </ScrollView>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
}

const AppSettingsSheet = memo(function AppSettingsSheet({
  visible,
  settings,
  onDismiss,
  onChange,
  onOpenDataControls,
  onOpenAccount,
}) {
  const options = [
    {
      key: "chatNotifications",
      icon: "chatbubble-outline",
      title: "Sohbet bildirimleri",
      description: "Takip ettiğin odalardaki yeni mesajlar",
    },
    {
      key: "profilePublic",
      icon: "eye-outline",
      title: "Herkese açık profil",
      description: "Profilin keşfet bölümünde görünsün",
    },
    {
      key: "autoJoinMuted",
      icon: "mic-off-outline",
      title: "Sessiz katıl",
      description: "Odalar açılırken mikrofonunu kapalı tut",
    },
  ];
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>TERCİHLER</Text>
          <Text style={styles.sheetTitle}>Ayarların.</Text>
          <Text style={styles.settingsCaption}>
            BİLDİRİMLER, GİZLİLİK VE SES
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key, !settings[option.key])}
              style={styles.settingRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: settings[option.key] }}
              accessibilityLabel={option.title}
            >
              <View
                style={[
                  styles.settingIcon,
                  settings[option.key] && styles.settingIconActive,
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={
                    settings[option.key] ? COLORS.primaryInk : COLORS.primary
                  }
                />
              </View>
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>{option.title}</Text>
                <Text style={styles.settingDescription}>
                  {option.description}
                </Text>
              </View>
              <Switch
                value={settings[option.key]}
                pointerEvents="none"
                trackColor={{ false: "#4C5E73", true: "#2F80ED" }}
                thumbColor={settings[option.key] ? COLORS.primary : "#D8DAE5"}
              />
            </Pressable>
          ))}
          <Text style={[styles.settingsCaption, styles.settingsDataCaption]}>
            HESAP VE VERİLER
          </Text>
          <Pressable onPress={onOpenAccount} style={styles.settingsLink}>
            <View style={styles.settingIcon}>
              <Ionicons
                name="person-circle-outline"
                size={18}
                color={COLORS.primary}
              />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Hesap ve güvenlik</Text>
              <Text style={styles.settingDescription}>
                Parola, oturum ve hesap silme işlemleri
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
          <Pressable onPress={onOpenDataControls} style={styles.settingsLink}>
            <View style={styles.settingIcon}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={COLORS.primary}
              />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Cihaz verilerin</Text>
              <Text style={styles.settingDescription}>
                Yerel verilerini dışa aktar veya sıfırla
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const DataControlsSheet = memo(function DataControlsSheet({
  visible,
  profile,
  summary,
  onDismiss,
  onExportData,
  onClearLocalData,
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>VERİ VE DEPOLAMA</Text>
          <Text style={styles.sheetTitle}>Kontrol sende.</Text>
          <View style={styles.dataNotice}>
            <Ionicons
              name="cloud-done-outline"
              size={21}
              color={COLORS.primary}
            />
            <Text style={styles.dataNoticeText}>
              Oda, sohbet, takip ve cüzdan verilerin hesabına bağlı olarak
              güvenli biçimde saklanır.
            </Text>
          </View>
          <View style={styles.dataSummary}>
            <View style={styles.dataSummaryItem}>
              <Text style={styles.dataSummaryValue}>{summary.favorites}</Text>
              <Text style={styles.dataSummaryLabel}>FAVORİ</Text>
            </View>
            <View style={styles.dataSummaryItem}>
              <Text style={styles.dataSummaryValue}>{summary.rooms}</Text>
              <Text style={styles.dataSummaryLabel}>ODAM</Text>
            </View>
            <View style={styles.dataSummaryItem}>
              <Text style={styles.dataSummaryValue}>
                {summary.notifications}
              </Text>
              <Text style={styles.dataSummaryLabel}>BİLDİRİM</Text>
            </View>
          </View>
          <Pressable onPress={onExportData} style={styles.dataAction}>
            <View style={styles.dataActionIcon}>
              <Ionicons
                name="download-outline"
                size={19}
                color={COLORS.primary}
              />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>
                Yerel verilerimi dışa aktar
              </Text>
              <Text style={styles.settingDescription}>
                Cihazında tutulan tercihlerin özetini oluştur
              </Text>
            </View>
            <Ionicons name="share-outline" size={18} color={COLORS.primary} />
          </Pressable>
          <Pressable
            onPress={onClearLocalData}
            style={styles.dataDestructiveAction}
          >
            <View style={styles.dataDestructiveIcon}>
              <Ionicons name="trash-outline" size={19} color={COLORS.pink} />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.dataDestructiveTitle}>
                Cihaz önbelleğini sıfırla
              </Text>
              <Text style={styles.settingDescription}>
                @{profile.handle} için yalnızca bu telefondaki geçici veriler
                silinir
              </Text>
            </View>
          </Pressable>
          <Text style={styles.dataFootnote}>
            Buluta kaydedilmiş odalar, mesajlar, takipler ve cüzdan bakiyen
            etkilenmez.
          </Text>
        </View>
      </View>
    </Modal>
  );
});

function AppContent() {
  const [rooms, setRooms] = useState(SEEDED_ROOMS);
  const [scheduledRooms, setScheduledRooms] = useState(SEEDED_SCHEDULED_ROOMS);
  const [reminderRoomIds, setReminderRoomIds] = useState([]);
  const [favoriteRoomIds, setFavoriteRoomIds] = useState([]);
  const [recentRoomIds, setRecentRoomIds] = useState([]);
  const [notifications, setNotifications] = useState(SEEDED_NOTIFICATIONS);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [walletBalance, setWalletBalance] = useState(SEEDED_WALLET_BALANCE);
  const [promoWalletBalance, setPromoWalletBalance] = useState(0);
  const [paidWalletBalance, setPaidWalletBalance] = useState(0);
  const [walletActivities, setWalletActivities] = useState([]);
  const [dailyRewardClaimed, setDailyRewardClaimed] = useState(false);
  const [followedUserIds, setFollowedUserIds] = useState([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("discover");
  const [room, setRoom] = useState(null);
  const openRoomIdRef = useRef(null);
  openRoomIdRef.current = room?.id || null;
  const [myFamily, setMyFamily] = useState(null);
  const [ownHostedRoom, setOwnHostedRoom] = useState(null);
  const [activeSanction, setActiveSanction] = useState(null);
  const [inspectedUserId, setInspectedUserId] = useState(null);
  const [inspectedReportTarget, setInspectedReportTarget] = useState(null);
  const pendingGiftSpendRef = useRef(0);
  const [roomMinimized, setRoomMinimized] = useState(false);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState(null);
  const [passwordPromptError, setPasswordPromptError] = useState(null);
  const [passwordPromptBusy, setPasswordPromptBusy] = useState(false);
  const [roomPreferences, setRoomPreferences] = useState({
    microphoneEnabled: false,
    speakerEnabled: true,
  });

  useEffect(() => {
    clearAllReminders().catch(() => undefined);
    AsyncStorage.removeItem(REMINDER_ROOM_IDS_KEY).catch(() => undefined);
  }, []);
  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountSecurityOpen, setAccountSecurityOpen] = useState(false);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const [dataControlsOpen, setDataControlsOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminRole, setAdminRole] = useState(null);
  const [authSession, setAuthSession] = useState(
    isSupabaseConfigured ? undefined : null,
  );
  const [brandLaunchVisible, setBrandLaunchVisible] = useState(true);
  const [brandLaunchMinDone, setBrandLaunchMinDone] = useState(false);
  const [brandLaunchClosing, setBrandLaunchClosing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBrandLaunchMinDone(true), 1300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!brandLaunchMinDone) return undefined;
    if (isSupabaseConfigured && authSession === undefined) return undefined;
    setBrandLaunchClosing(true);
    const timer = setTimeout(() => setBrandLaunchVisible(false), 240);
    return () => clearTimeout(timer);
  }, [authSession, brandLaunchMinDone]);

  useEffect(() => {
    notificationDispatcher = (item) =>
      setNotifications((currentNotifications) => {
        const nextNotifications = [item, ...currentNotifications];
        AsyncStorage.setItem(
          NOTIFICATIONS_KEY,
          JSON.stringify(nextNotifications),
        ).catch(() => undefined);
        return nextNotifications;
      });
    return () => {
      notificationDispatcher = undefined;
    };
  }, []);

  useEffect(() => {
    configureNotificationChannel().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    const fallbackTimer = setTimeout(() => {
      if (active) setAuthSession(null);
    }, 8000);
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setAuthSession(data.session);
      })
      .catch(() => {
        if (active) setAuthSession(null);
      })
      .finally(() => clearTimeout(fallbackTimer));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (active) setAuthSession(session);
      if (active && event === "PASSWORD_RECOVERY")
        setPasswordRecoveryOpen(true);
    });
    return () => {
      active = false;
      clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    const handleAuthUrl = async ({ url }) => {
      // Yalnizca uygulamanin kendi auth callback adreslerini isle.
      // Aksi halde acilistaki siradan URL'ler oturum mantigini tetikleyebilir.
      if (!/^sora:\/\/auth\//i.test(String(url || ""))) return;
      try {
        const result = await completeAuthRedirect(url);
        if (active && result.isPasswordRecovery) setPasswordRecoveryOpen(true);
      } catch (error) {
        if (active)
          Alert.alert(
            "Giriş bağlantısı geçersiz",
            error?.message || "Bağlantıyı yeniden isteyip tekrar dene.",
          );
      }
    };
    // getInitialURL, uygulamayi acan URL'yi dondurur. Zaten kullanilmis bir
    // OAuth kodunu/token'ini yeniden islemek Supabase oturumunu temizleyebilir
    // ve kullanici her acilista giris ekranina duser. Bu yuzden:
    //   - yalnizca sora://auth/... adresleri islenir
    //   - zaten gecerli oturum varsa hic dokunulmaz
    //   - hata olursa sessizce yoksayilir (uyari gosterilmez)
    Linking.getInitialURL()
      .then(async (url) => {
        if (!url || !/^sora:\/\/auth\//i.test(url)) return;
        const isResetLink = /^sora:\/\/auth\/reset-password/i.test(url);
        const { data } = await supabase.auth
          .getSession()
          .catch(() => ({ data: {} }));
        if (data?.session && !isResetLink) return;
        try {
          const result = await completeAuthRedirect(url);
          if (active && (isResetLink || result?.isPasswordRecovery)) {
            setPasswordRecoveryOpen(true);
          }
        } catch {
          // Basarisiz/eski callback: yoksay
        }
      })
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", handleAuthUrl);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const previousUserIdRef = useRef(null);
  useEffect(() => {
    const user = authSession?.user;
    if (!user) {
      if (isSupabaseConfigured && previousUserIdRef.current) {
        previousUserIdRef.current = null;
        setRoom(null);
        setRoomMinimized(false);
        setOwnHostedRoom(null);
        setProfile(DEFAULT_PROFILE);
        setWalletBalance(SEEDED_WALLET_BALANCE);
        setPromoWalletBalance(0);
        setPaidWalletBalance(0);
        setWalletActivities([]);
        setDailyRewardClaimed(false);
        setMyFamily(null);
        setFollowedUserIds([]);
        setActiveSanction(null);
        setInspectedUserId(null);
        setInspectedReportTarget(null);
      }
      return;
    }
    const switchedUser = previousUserIdRef.current !== user.id;
    previousUserIdRef.current = user.id;
    const metadata = user.user_metadata || {};
    const fallbackName = user.email?.split("@")[0] || "Sora kullanıcısı";
    // Google/Apple gibi saglayicilar adi full_name veya name alaninda dondurur.
    const displayName =
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user.name ||
      fallbackName;
    const seed = String(displayName || fallbackName)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24);
    const nextProfile = {
      ...DEFAULT_PROFILE,
      name: displayName,
      handle:
        metadata.handle || seed || `sora${String(user.id || "").slice(0, 6)}`,
    };
    setProfile((current) => ({
      ...nextProfile,
      avatarUrl: switchedUser ? null : current?.avatarUrl || null,
    }));
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile)).catch(
      () => undefined,
    );
  }, [authSession?.user?.id]);

  useEffect(() => {
    if (!authSession?.user || !supabase) return;
    registerPushToken(supabase).catch(() => undefined);
  }, [authSession?.user?.id]);

  useEffect(() => {
    const userId = authSession?.user?.id;
    if (!userId || !supabase) {
      setAdminRole(null);
      return;
    }
    let active = true;
    getCurrentAdminRole(userId)
      .then((role) => {
        if (active) setAdminRole(role);
      })
      .catch(() => {
        if (active) setAdminRole(null);
      });
    return () => {
      active = false;
    };
  }, [authSession?.user?.id]);

  useEffect(() => {
    const user = authSession?.user;
    if (!user || !supabase) return undefined;
    let active = true;
    const formatTransaction = (transaction) => ({
      id: transaction.id,
      icon: ["daily_reward", "promo_grant", "level_reward"].includes(transaction.type)
        ? "gift"
        : "diamond",
      color:
        ["daily_reward", "promo_grant", "level_reward"].includes(transaction.type)
          ? "#2F80ED"
          : transaction.type === "bank_transfer"
            ? "#59C5FF"
            : "#5D91D8",
      text: transaction.description,
      amount: transaction.amount,
      time: new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(transaction.created_at)),
    });
    (async () => {
      if (!openRoomIdRef.current) {
        await deactivateStaleHostedRooms(user.id, null).catch(() => undefined);
      }
      const [
        liveRooms,
        plannedRooms,
        follows,
        wallet,
        transactions,
        hostedRoom,
      ] = await Promise.all([
        listRooms("live"),
        listRooms("scheduled"),
        listFollowedUserIds(user.id),
        getWallet(),
        listWalletTransactions(),
        getHostedRoom(user.id).catch(() => null),
      ]);
      if (!active) return;
      const visibleLiveRooms = liveRooms.filter(
        (item) => item.hostId !== user.id || item.id === openRoomIdRef.current,
      );
      setOwnHostedRoom(hostedRoom || null);
      setRooms([...visibleLiveRooms, ...SEEDED_ROOMS]);
      setScheduledRooms([...plannedRooms, ...SEEDED_SCHEDULED_ROOMS]);
      setFollowedUserIds(follows);
      setWalletBalance(wallet.balance);
      setPromoWalletBalance(wallet.promo_balance || 0);
      setPaidWalletBalance(wallet.paid_balance || 0);
      setDailyRewardClaimed(
        wallet.last_daily_reward_at ===
          new Date().toISOString().slice(0, 10),
      );
      setWalletActivities(transactions.map(formatTransaction));
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authSession?.user?.id]);

  useEffect(() => {
    const user = authSession?.user;
    if (!user || !supabase) return undefined;
    let active = true;
    supabase
      .from("profiles")
      .select("handle, display_name, bio, avatar_color, avatar_url, user_level, user_xp")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setProfile((current) => ({
          ...current,
          name: data.display_name || current.name || "Sora kullanıcısı",
          handle:
            data.handle ||
            current.handle ||
            `sora${String(user.id || "").slice(0, 6)}`,
          bio: data.bio ?? "",
          color: data.avatar_color || current.color || DEFAULT_PROFILE.color,
          avatarUrl: data.avatar_url || null,
          userLevel: Math.max(1, Number(data.user_level) || 1),
          userXp: Math.max(0, Number(data.user_xp) || 0),
        }));
      })
      .catch(() => undefined);
    supabase
      .from("profiles")
      .select("active_frame_id, active_profile_theme_id")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setProfile((current) => ({
          ...current,
          activeFrameId: data.active_frame_id || null,
          activeProfileThemeId: data.active_profile_theme_id || null,
        }));
      })
      .catch(() => undefined);
    supabase
      .from("profiles")
      .select("public_id")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || !data?.public_id) return;
        setProfile((current) => ({
          ...current,
          publicId: data.public_id,
        }));
      })
      .catch(() => undefined);
    getMyFamily(user.id)
      .then((family) => {
        if (active) setMyFamily(family);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authSession?.user?.id]);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured) {
      AsyncStorage.getItem(USER_ROOMS_KEY)
        .then((savedRooms) => {
          if (!active || !savedRooms) return;
          const parsedRooms = JSON.parse(savedRooms);
          if (Array.isArray(parsedRooms))
            setRooms([...parsedRooms, ...SEEDED_ROOMS]);
        })
        .catch(() => undefined);
    }
    AsyncStorage.getItem(FAVORITE_ROOMS_KEY)
      .then((savedFavorites) => {
        if (!active || !savedFavorites) return;
        const parsedFavorites = JSON.parse(savedFavorites);
        if (Array.isArray(parsedFavorites)) setFavoriteRoomIds(parsedFavorites);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(RECENT_ROOMS_KEY)
      .then((savedRecentRooms) => {
        if (!active || !savedRecentRooms) return;
        const parsedRecentRooms = JSON.parse(savedRecentRooms);
        if (Array.isArray(parsedRecentRooms))
          setRecentRoomIds(parsedRecentRooms);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(NOTIFICATIONS_KEY)
      .then((savedNotifications) => {
        if (!active || !savedNotifications) return;
        const parsedNotifications = JSON.parse(savedNotifications);
        if (Array.isArray(parsedNotifications))
          setNotifications(parsedNotifications);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(PROFILE_KEY)
      .then((savedProfile) => {
        if (!active || !savedProfile) return;
        const parsedProfile = JSON.parse(savedProfile);
        // Oturum acikken profil Supabase kullanici verisinden gelir; burada
        // yerel kopyayi onun onune gecirme.
        if (isSupabaseConfigured) return;
        if (parsedProfile?.name && parsedProfile?.handle)
          setProfile({ ...DEFAULT_PROFILE, ...parsedProfile });
      })
      .catch(() => undefined);
    if (!isSupabaseConfigured) {
      AsyncStorage.getItem(SCHEDULED_ROOMS_KEY)
        .then((savedRooms) => {
          if (!active || !savedRooms) return;
          const parsedRooms = JSON.parse(savedRooms);
          if (Array.isArray(parsedRooms))
            setScheduledRooms([...parsedRooms, ...SEEDED_SCHEDULED_ROOMS]);
        })
        .catch(() => undefined);
    }
    AsyncStorage.getItem(REMINDER_ROOM_IDS_KEY)
      .then((savedReminderIds) => {
        if (!active || !savedReminderIds) return;
        const parsedReminderIds = JSON.parse(savedReminderIds);
        if (Array.isArray(parsedReminderIds))
          setReminderRoomIds(parsedReminderIds);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(APP_SETTINGS_KEY)
      .then((savedSettings) => {
        if (!active || !savedSettings) return;
        const parsedSettings = JSON.parse(savedSettings);
        if (parsedSettings && typeof parsedSettings === "object")
          setAppSettings({ ...DEFAULT_APP_SETTINGS, ...parsedSettings });
      })
      .catch(() => undefined);
    if (!isSupabaseConfigured) {
      AsyncStorage.getItem(WALLET_BALANCE_KEY)
        .then((savedBalance) => {
          if (!active || savedBalance === null) return;
          const parsedBalance = Number(savedBalance);
          if (Number.isFinite(parsedBalance) && parsedBalance >= 0)
            setWalletBalance(parsedBalance);
        })
        .catch(() => undefined);
      AsyncStorage.getItem(DAILY_REWARD_KEY)
        .then((savedDate) => {
          if (active && savedDate === new Date().toDateString())
            setDailyRewardClaimed(true);
        })
        .catch(() => undefined);
    }
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((completed) => {
        if (active && completed !== "true") setOnboardingOpen(true);
      })
      .catch(() => {
        if (active) setOnboardingOpen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const pushNotification = (item) => {
    setNotifications((currentNotifications) => {
      const nextNotifications = [item, ...currentNotifications].slice(0, 30);
      AsyncStorage.setItem(
        NOTIFICATIONS_KEY,
        JSON.stringify(nextNotifications),
      ).catch(() => undefined);
      return nextNotifications;
    });
  };

  const [hostedRoomPrompt, setHostedRoomPrompt] = useState(null);
  const [resumingHostedRoom, setResumingHostedRoom] = useState(false);

  const resumeHostedRoom = async (existingRoom) => {
    // Oda "inactive" olabilir: önce yeniden canlıya al, sonra gir (aksi halde
    // join_room "Room is unavailable" döner).
    console.warn("[room-entry] resume hosted room pressed", Boolean(existingRoom?.id));
    setResumingHostedRoom(true);
    let liveRoom = existingRoom;
    try {
      if (supabase && authSession?.user) {
        liveRoom = (await setRemoteRoomPresence(existingRoom.id, true)) || existingRoom;
        setOwnHostedRoom(liveRoom);
        setRooms((currentRooms) => [
          liveRoom,
          ...currentRooms.filter((item) => item.id !== liveRoom.id),
        ]);
      }
    } catch (error) {
      console.warn("Room presence sync failed", error);
      setResumingHostedRoom(false);
      Alert.alert("Odana dönülemedi", "Bağlantıyı kontrol edip tekrar dene.");
      return;
    }
    setResumingHostedRoom(false);
    setHostedRoomPrompt(null);
    setCreateOpen(false);
    openRoom(liveRoom);
  };

  const promptHostedRoom = (existingRoom) => {
    setHostedRoomPrompt(existingRoom);
  };

  const createRoom = async (newRoom) => {
    const safeHostName = profile.name || "Sora kullanıcısı";
    const userRoom = {
      ...newRoom,
      host: safeHostName,
      initials: safeHostName.charAt(0).toUpperCase(),
      userCreated: true,
    };
    if (supabase && authSession?.user) {
      try {
        const existingRoom = await getHostedRoom(authSession.user.id);
        if (existingRoom) {
          setOwnHostedRoom(existingRoom);
          promptHostedRoom(existingRoom);
          return false;
        }
        const savedRoom = await createRemoteRoom({
          room: userRoom,
          userId: authSession.user.id,
        });
        setOwnHostedRoom(savedRoom);
        setRooms((currentRooms) => [
          savedRoom,
          ...currentRooms.filter((item) => !item.persisted),
        ]);
        setCreateOpen(false);
        openRoom(savedRoom);
        return true;
      } catch (error) {
        console.error("Room creation failed", error);
        Alert.alert(
          "Oda oluşturulamadı",
          "Bağlantıyı kontrol edip tekrar dene.",
        );
        return false;
      }
    }
    setRooms((currentRooms) => {
      const storedRooms = [
        userRoom,
        ...currentRooms.filter((item) => item.userCreated),
      ];
      AsyncStorage.setItem(USER_ROOMS_KEY, JSON.stringify(storedRooms)).catch(
        () => undefined,
      );
      return [userRoom, ...currentRooms.filter((item) => !item.userCreated)];
    });
    setCreateOpen(false);
    openRoom(userRoom);
    return true;
  };

  const activateReminder = async (scheduledRoom) => {
    const notificationId = await scheduleReminder(scheduledRoom).catch(
      () => null,
    );
    if (!notificationId) return false;
    setReminderRoomIds((currentIds) => {
      const nextIds = currentIds.includes(scheduledRoom.id)
        ? currentIds
        : [...currentIds, scheduledRoom.id];
      AsyncStorage.setItem(
        REMINDER_ROOM_IDS_KEY,
        JSON.stringify(nextIds),
      ).catch(() => undefined);
      return nextIds;
    });
    return true;
  };

  const scheduleRoom = async (newRoom) => {
    const scheduledRoom = {
      ...newRoom,
      host: profile.name,
      hostId: authSession?.user?.id || null,
      userCreated: true,
    };
    if (supabase && authSession?.user) {
      try {
        const savedRoom = await createRemoteRoom({
          room: { ...scheduledRoom, state: "scheduled" },
          userId: authSession.user.id,
        });
        setScheduledRooms((currentRooms) => [
          savedRoom,
          ...currentRooms.filter((item) => !item.persisted),
        ]);
        const reminderCreated =
          appSettings.roomReminders && (await activateReminder(savedRoom));
        pushNotification({
          id: `scheduled-${savedRoom.id}`,
          icon: "calendar",
          color: COLORS.purple,
          text: reminderCreated
            ? `${savedRoom.title} için hatırlatıcı hazır.`
            : `${savedRoom.title} planlandı.`,
          time: "Şimdi",
        });
        setScheduleOpen(false);
      } catch {
        Alert.alert(
          "Planlama kaydedilemedi",
          "Veritabanı bağlantısını ve Supabase şemasını kontrol edip tekrar dene.",
        );
      }
      return;
    }
    const reminderCreated =
      appSettings.roomReminders && (await activateReminder(scheduledRoom));
    setScheduledRooms((currentRooms) => {
      const storedRooms = [
        scheduledRoom,
        ...currentRooms.filter((item) => item.userCreated),
      ];
      AsyncStorage.setItem(
        SCHEDULED_ROOMS_KEY,
        JSON.stringify(storedRooms),
      ).catch(() => undefined);
      return [scheduledRoom, ...currentRooms];
    });
    pushNotification({
      id: `scheduled-${scheduledRoom.id}`,
      icon: "calendar",
      color: COLORS.purple,
      text: reminderCreated
        ? `${scheduledRoom.title} için hatırlatıcı hazır.`
        : `${scheduledRoom.title} planlandı.`,
      time: "Şimdi",
    });
    setScheduleOpen(false);
  };

  const toggleReminder = async (roomId) => {
    if (!appSettings.roomReminders) {
      Alert.alert(
        "Hatırlatmalar kapalı",
        "Profil > Ayarlar bölümünden oda hatırlatmalarını açabilirsin.",
      );
      return;
    }
    const reminderWasActive = reminderRoomIds.includes(roomId);
    const scheduledRoom = scheduledRooms.find((item) => item.id === roomId);
    if (!scheduledRoom) return;
    if (reminderWasActive) {
      await cancelReminder(roomId);
      setReminderRoomIds((currentIds) => {
        const nextIds = currentIds.filter((id) => id !== roomId);
        AsyncStorage.setItem(
          REMINDER_ROOM_IDS_KEY,
          JSON.stringify(nextIds),
        ).catch(() => undefined);
        return nextIds;
      });
      return;
    }
    if (!(await activateReminder(scheduledRoom))) {
      Alert.alert(
        "Hatırlatıcı planlanamadı",
        "Bu oda için gelecekte geçerli bir başlangıç zamanı gerekli.",
      );
      return;
    }
    pushNotification({
      id: `reminder-${roomId}-${Date.now()}`,
      icon: "notifications",
      color: COLORS.primary,
      text: `${scheduledRoom.title} için hatırlatıcı açıldı.`,
      time: "Şimdi",
    });
  };

  const cancelScheduledRoom = async (scheduledRoom) => {
    if (scheduledRoom.persisted) {
      try {
        await deleteRemoteRoom(scheduledRoom.id);
      } catch {
        Alert.alert(
          "Planlı oda iptal edilemedi",
          "Yalnızca kendi odanı iptal edebilirsin. Bağlantını kontrol edip tekrar dene.",
        );
        return;
      }
    }
    await cancelReminder(scheduledRoom.id);
    setScheduledRooms((currentRooms) => {
      const nextRooms = currentRooms.filter(
        (item) => item.id !== scheduledRoom.id,
      );
      AsyncStorage.setItem(
        SCHEDULED_ROOMS_KEY,
        JSON.stringify(nextRooms.filter((item) => item.userCreated)),
      ).catch(() => undefined);
      return nextRooms;
    });
    setReminderRoomIds((currentIds) => {
      const nextIds = currentIds.filter((id) => id !== scheduledRoom.id);
      AsyncStorage.setItem(
        REMINDER_ROOM_IDS_KEY,
        JSON.stringify(nextIds),
      ).catch(() => undefined);
      return nextIds;
    });
    pushNotification({
      id: `schedule-cancelled-${scheduledRoom.id}-${Date.now()}`,
      icon: "close-circle",
      color: COLORS.pink,
      text: `${scheduledRoom.title} planlaması iptal edildi.`,
      time: "Şimdi",
    });
  };

  const startScheduledRoom = async (scheduledRoom) => {
    let liveRoom = { ...scheduledRoom, state: "live" };
    if (scheduledRoom.persisted) {
      try {
        liveRoom = await startRemoteScheduledRoom(scheduledRoom.id);
      } catch {
        Alert.alert(
          "Oda başlatılamadı",
          "Yalnızca kendi planladığın odayı başlatabilirsin. Bağlantını kontrol edip tekrar dene.",
        );
        return;
      }
    }
    await cancelReminder(scheduledRoom.id);
    setScheduledRooms((currentRooms) => {
      const nextRooms = currentRooms.filter(
        (item) => item.id !== scheduledRoom.id,
      );
      if (!scheduledRoom.persisted) {
        AsyncStorage.setItem(
          SCHEDULED_ROOMS_KEY,
          JSON.stringify(nextRooms.filter((item) => item.userCreated)),
        ).catch(() => undefined);
      }
      return nextRooms;
    });
    setReminderRoomIds((currentIds) => {
      const nextIds = currentIds.filter((id) => id !== scheduledRoom.id);
      AsyncStorage.setItem(
        REMINDER_ROOM_IDS_KEY,
        JSON.stringify(nextIds),
      ).catch(() => undefined);
      return nextIds;
    });
    setRooms((currentRooms) => {
      const nextRooms = [
        liveRoom,
        ...currentRooms.filter((item) => item.id !== liveRoom.id),
      ];
      if (!liveRoom.persisted) {
        AsyncStorage.setItem(
          USER_ROOMS_KEY,
          JSON.stringify(nextRooms.filter((item) => item.userCreated)),
        ).catch(() => undefined);
      }
      return nextRooms;
    });
    pushNotification({
      id: `room-started-${liveRoom.id}-${Date.now()}`,
      icon: "radio",
      color: COLORS.primary,
      text: `${liveRoom.title} şimdi canlı.`,
      time: "Şimdi",
    });
    openRoom(liveRoom);
  };

  const updateAppSetting = (key, value) => {
    if (key === "roomReminders" && !value) {
      clearAllReminders().catch(() => undefined);
      setReminderRoomIds([]);
      AsyncStorage.setItem(REMINDER_ROOM_IDS_KEY, JSON.stringify([])).catch(
        () => undefined,
      );
    }
    setAppSettings((currentSettings) => {
      const nextSettings = { ...currentSettings, [key]: value };
      AsyncStorage.setItem(
        APP_SETTINGS_KEY,
        JSON.stringify(nextSettings),
      ).catch(() => undefined);
      return nextSettings;
    });
  };

  const recordWalletActivity = (activity) => {
    AsyncStorage.getItem(WALLET_ACTIVITY_KEY)
      .then((savedActivities) => {
        const parsedActivities = JSON.parse(savedActivities || "[]");
        const currentActivities = Array.isArray(parsedActivities)
          ? parsedActivities
          : [];
        AsyncStorage.setItem(
          WALLET_ACTIVITY_KEY,
          JSON.stringify([activity, ...currentActivities].slice(0, 12)),
        ).catch(() => undefined);
      })
      .catch(() => undefined);
  };

  const syncUserLevelAndNotify = useCallback(
    async ({ showFeedback = false } = {}) => {
      if (!supabase || !authSession?.user) return null;
      try {
        const res = await syncMyUserLevel();
        if (!res) return null;
        setProfile((current) => ({
          ...current,
          userLevel: res.userLevel,
          userXp: res.userXp,
        }));
        if (res.newlyAwardedCoins > 0) {
          if (typeof res.balance === "number") {
            setWalletBalance(res.balance);
          } else {
            setWalletBalance((val) => val + res.newlyAwardedCoins);
          }
          if (typeof res.promoBalance === "number") {
            setPromoWalletBalance(res.promoBalance);
          } else {
            setPromoWalletBalance((val) => val + res.newlyAwardedCoins);
          }
          if (typeof res.paidBalance === "number") {
            setPaidWalletBalance(res.paidBalance);
          }
          pushNotification({
            id: `lvl-reward-${res.userLevel}-${Date.now()}`,
            icon: "ribbon",
            color: "#2F80ED",
            text: `Seviye ${res.userLevel} ödülü: +${formatCredits(res.newlyAwardedCoins)} kredi cüzdanına eklendi.`,
            time: "Şimdi",
          });
          if (showFeedback) {
            Alert.alert(
              "Seviye Ödülü Eklendi",
              `Seviye ${res.userLevel} için +${formatCredits(res.newlyAwardedCoins)} kredi cüzdanına tanımlandı.`,
            );
          }
        } else if (showFeedback) {
          Alert.alert(
            "Seviye Güncel",
            `Mevcut seviyen: Seviye ${res.userLevel} (${formatCredits(res.userXp)} XP).`,
          );
        }
        return res;
      } catch {
        if (showFeedback) {
          Alert.alert("Seviye yenilenemedi", "Bağlantını kontrol edip tekrar dene.");
        }
        return null;
      }
    },
    [authSession?.user],
  );

  useEffect(() => {
    if (!authSession?.user?.id || !supabase) return;
    syncUserLevelAndNotify().catch(() => undefined);
  }, [authSession?.user?.id, syncUserLevelAndNotify]);

  const refreshWalletData = async () => {
    if (!supabase || !authSession?.user) return;
    await syncUserLevelAndNotify().catch(() => undefined);
    const [wallet, transactions] = await Promise.all([
      getWallet(),
      listWalletTransactions(),
    ]);
    setWalletBalance(wallet.balance);
    setPromoWalletBalance(wallet.promo_balance || 0);
    setPaidWalletBalance(wallet.paid_balance || 0);
    setDailyRewardClaimed(
      wallet.last_daily_reward_at === new Date().toISOString().slice(0, 10),
    );
    setWalletActivities(
      transactions.map((transaction) => ({
        id: transaction.id,
        icon: ["daily_reward", "promo_grant", "level_reward"].includes(transaction.type)
          ? "gift"
          : "diamond",
        color:
          ["daily_reward", "promo_grant", "level_reward"].includes(transaction.type)
            ? "#2F80ED"
            : transaction.type === "bank_transfer"
              ? "#59C5FF"
              : "#5D91D8",
        text: transaction.description,
        amount: transaction.amount,
        time: new Intl.DateTimeFormat("tr-TR", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(transaction.created_at)),
      })),
    );
  };

  const sendGift = async ({ gift, recipient, quantity = 1, roomId, requestId }) => {
    if (!supabase || !authSession?.user) {
      Alert.alert("Giriş gerekli", "Hediye göndermek için hesabınla giriş yap.");
      return false;
    }
    if (!recipient?.userId || !roomId) return false;
    const cleanQty = Math.max(1, Math.floor(Number(quantity) || 1));
    const totalCost = Number(gift.cost || 0) * cleanQty;
    if (walletBalance - pendingGiftSpendRef.current < totalCost) {
      Alert.alert(
        "Bakiye yetersiz",
        `${cleanQty > 1 ? `${cleanQty}x ` : ""}${gift.name} hediyesi için ${formatCredits(totalCost)} kredi gerekiyor.`,
      );
      return false;
    }
    pendingGiftSpendRef.current += totalCost;
    try {
      const requestKey = requestId || createRequestUuid();
      const result = await sendRoomGift({
        roomId,
        giftId: gift.id,
        recipientId: recipient.userId,
        quantity: cleanQty,
        requestId: requestKey,
      });
      if (!result) throw new Error("Gift response missing");
      const qtyPrefix = cleanQty > 1 ? `${cleanQty}x ` : "";
      setWalletBalance(result.balance);
      setPromoWalletBalance(result.promo_balance || 0);
      setPaidWalletBalance(result.paid_balance || 0);
      setWalletActivities((items) => [{
        id: `gift-${requestKey}`, icon: "diamond", color: gift.color,
        text: `${recipient.name} kişisine ${qtyPrefix}${gift.name}`, amount: -result.gift_cost,
        time: "Şimdi",
      }, ...items]);
      if (recipient.userId === authSession.user.id) {
        const blast = await claimSelfGiftBlast(requestKey).catch(() => null);
        const reward = Number(blast?.reward_amount || 0);
        if (blast?.balance !== null && blast?.balance !== undefined) setWalletBalance(Number(blast.balance));
        if (reward > 0) {
          const multiplier = Number(blast.multiplier_basis || 0) / 100;
          setWalletActivities((items) => [{
            id: `blast-${requestKey}`, icon: "flame", color: "#F04B24",
            text: `Hediye patlaması · ${multiplier}x geri dönüş`, amount: reward, time: "Şimdi",
          }, ...items]);
          Alert.alert("Hediye patlaması!", `${formatCredits(reward)} kredi geri kazandın.`);
        }
      }
      pushNotification({
        id: `gift-${requestKey}`,
        icon: gift.icon,
        color: gift.color,
        text: `${recipient.name} kişisine ${qtyPrefix}${gift.name} gönderildi.`,
        time: "Şimdi",
      });
      refreshWalletData().catch(() => undefined);
      return result;
    } catch (error) {
      Alert.alert("Hediye gönderilemedi", error?.message?.includes("Insufficient")
        ? "Bakiye yetersiz. Cüzdanındaki kredi miktarı yenileniyor."
        : error?.message?.includes("membership")
          ? "Alıcı artık bu odada değil. Oda listesini yenileyip tekrar dene."
          : "Bağlantı hatası oluştu. Bakiye düşürülmedi; tekrar deneyebilirsin.");
      getWallet().then((wallet) => {
        setWalletBalance(wallet.balance);
        setPromoWalletBalance(wallet.promo_balance || 0);
        setPaidWalletBalance(wallet.paid_balance || 0);
      }).catch(() => undefined);
      return false;
    } finally {
      pendingGiftSpendRef.current = Math.max(0, pendingGiftSpendRef.current - totalCost);
    }
  };

  const claimDailyReward = async () => {
    if (dailyRewardClaimed) {
      Alert.alert(
        "Ödül zaten alındı",
        "Yarın tekrar günlük kredi kazanabilirsin.",
      );
      return;
    }
    if (supabase && authSession?.user) {
      try {
        const wallet = await claimRemoteDailyReward();
        if (!wallet.claimed) {
          setDailyRewardClaimed(true);
          Alert.alert(
            "Ödül zaten alındı",
            "Yarın tekrar günlük kredi kazanabilirsin.",
          );
          return;
        }
        setDailyRewardClaimed(true);
        setWalletBalance(wallet.balance);
        setPromoWalletBalance((value) =>
          wallet.promo_balance > 0 ? wallet.promo_balance : value + DAILY_REWARD_AMOUNT,
        );
        if (wallet.paid_balance >= 0) {
          setPaidWalletBalance(wallet.paid_balance);
        }
        setWalletActivities((currentActivities) => [
          {
            id: `reward-${Date.now()}`,
            icon: "gift",
            color: "#2F80ED",
            text: "Günlük giriş ödülü",
            amount: DAILY_REWARD_AMOUNT,
            time: "Şimdi",
          },
          ...currentActivities,
        ]);
        pushNotification({
          id: `daily-reward-${Date.now()}`,
          icon: "gift",
          color: "#2F80ED",
          text: `${formatCredits(DAILY_REWARD_AMOUNT)} kredi günlük ödülü hesabına eklendi.`,
          time: "Şimdi",
        });
        refreshWalletData().catch(() => undefined);
      } catch {
        Alert.alert("Ödül alınamadı", "Bağlantını kontrol edip tekrar dene.");
      }
      return;
    }
    setDailyRewardClaimed(true);
    AsyncStorage.setItem(DAILY_REWARD_KEY, new Date().toDateString()).catch(
      () => undefined,
    );
    setWalletBalance((currentBalance) => {
      const nextBalance = currentBalance + DAILY_REWARD_AMOUNT;
      AsyncStorage.setItem(WALLET_BALANCE_KEY, String(nextBalance)).catch(
        () => undefined,
      );
      return nextBalance;
    });
    setNotifications((currentNotifications) => {
      const nextNotifications = [
        {
          id: `daily-reward-${Date.now()}`,
          icon: "gift",
          color: "#2F80ED",
          text: `${formatCredits(DAILY_REWARD_AMOUNT)} kredi günlük ödülü hesabına eklendi.`,
          time: "Şimdi",
        },
        ...currentNotifications,
      ];
      AsyncStorage.setItem(
        NOTIFICATIONS_KEY,
        JSON.stringify(nextNotifications),
      ).catch(() => undefined);
      return nextNotifications;
    });
    recordWalletActivity({
      id: `reward-${Date.now()}`,
      icon: "gift",
      color: "#2F80ED",
      text: "Günlük giriş ödülü",
      amount: DAILY_REWARD_AMOUNT,
      time: "Şimdi",
    });
  };

  const completeOnboarding = () => {
    setOnboardingOpen(false);
    AsyncStorage.setItem(ONBOARDING_KEY, "true").catch(() => undefined);
  };

  const toggleFavorite = (roomId) => {
    const wasFavorite = favoriteRoomIds.includes(roomId);
    setFavoriteRoomIds((currentFavorites) => {
      const isFavorite = currentFavorites.includes(roomId);
      const nextFavorites = isFavorite
        ? currentFavorites.filter((id) => id !== roomId)
        : [...currentFavorites, roomId];
      AsyncStorage.setItem(
        FAVORITE_ROOMS_KEY,
        JSON.stringify(nextFavorites),
      ).catch(() => undefined);
      return nextFavorites;
    });
    if (!wasFavorite) {
      const roomToFavorite = rooms.find((item) => item.id === roomId);
      if (roomToFavorite)
        pushNotification({
          id: `favorite-${roomId}-${Date.now()}`,
          icon: "heart",
          color: COLORS.pink,
          text: `${roomToFavorite.title} favorilerine eklendi.`,
          time: "Şimdi",
        });
    }
  };

  const openRoom = async (nextRoom, { skipPasswordCheck = false } = {}) => {
    if (!nextRoom || typeof nextRoom.id !== "string" || !nextRoom.id) {
      console.warn("[room-entry] open rejected: invalid room");
      Alert.alert("Oda açılamadı", "Oda bilgisi geçersiz. Tekrar dene.");
      return;
    }

    if (room?.id === nextRoom.id) {
      setRoomMinimized(false);
      return;
    }

    // Odayı ekranda açmadan önce sunucuda üyelik, ban ve şifre denetimini yap.
    // Bağlantı veya yetki hatasında kapalı davran; aksi halde token çağrısına
    // kadar hatalı bir oda ekranı kısa süreliğine görünebiliyordu.
    if (!skipPasswordCheck && nextRoom.persisted && room?.id !== nextRoom.id) {
      try {
        if (authSession?.user?.id && nextRoom.hostId === authSession.user.id) {
          // Kendi odası listede "canlı" görünse de pasif kalmış olabilir.
          await setRemoteRoomPresence(nextRoom.id, true, { resetListeners: true }).catch(() => undefined);
        }
        await joinRoomWithPassword(nextRoom.id, null);
      } catch (error) {
        const message = String(error?.message || "");
        if (message.includes("Room password required")) {
          setPasswordPromptError(null);
          setPasswordPromptRoom(nextRoom);
          return;
        }
        Alert.alert("Odaya girilemiyor", describeRoomError(error));
        return;
      }
    }

    if (room?.persisted && room.id !== nextRoom.id) {
      leaveRoomMembership(room.id).catch(() => undefined);
      if (room.hostId === authSession?.user?.id) {
        setHostRoomPresence(room.id, false).catch(() => undefined);
      }
    }

    console.warn("[room-entry] open requested", Boolean(nextRoom.id));
    setRoom(nextRoom);
    setRoomPreferences({
      microphoneEnabled: !appSettings.autoJoinMuted,
      speakerEnabled: true,
    });
    setRoomMinimized(false);

    const currentRecentRooms = Array.isArray(recentRoomIds)
      ? recentRoomIds
      : [];
    const nextRecentRooms = [
      nextRoom.id,
      ...currentRecentRooms.filter((roomId) => roomId !== nextRoom.id),
    ].slice(0, 8);
    setRecentRoomIds(nextRecentRooms);
    AsyncStorage.setItem(
      RECENT_ROOMS_KEY,
      JSON.stringify(nextRecentRooms),
    ).catch((error) => console.warn("Recent room history save failed", error));
  };

  const setHostRoomPresence = useCallback(
    async (roomId, isActive) => {
      if (!supabase || !authSession?.user) return;
      const updatedRoom = await setRemoteRoomPresence(roomId, isActive);
      if (updatedRoom) setOwnHostedRoom(updatedRoom);
      setRooms((currentRooms) =>
        isActive
          ? [updatedRoom, ...currentRooms.filter((item) => item.id !== roomId)]
          : currentRooms.filter((item) => item.id !== roomId),
      );
      setRoom((currentRoom) =>
        currentRoom?.id === roomId ? updatedRoom : currentRoom,
      );
    },
    [authSession?.user],
  );

  useEffect(() => {
    console.warn(
      `[room-entry] app state room=${Boolean(room)} minimized=${roomMinimized}`,
    );
  }, [room, roomMinimized]);

  useEffect(() => {
    if (!supabase || !authSession?.user) return undefined;
    let active = true;
    const refreshLiveRooms = () =>
      listRooms("live")
        .then((liveRooms) => {
          if (!active) return;
          const selfId = authSession?.user?.id;
          const staleOwnRoom = selfId
            ? liveRooms.find((item) => item.hostId === selfId && item.id !== openRoomIdRef.current)
            : null;
          if (staleOwnRoom && selfId) {
            deactivateStaleHostedRooms(selfId, openRoomIdRef.current).catch(() => undefined);
          }
          const filtered = selfId
            ? liveRooms.filter((item) => item.hostId !== selfId || item.id === openRoomIdRef.current)
            : liveRooms;
          setRooms(filtered);
        })
        .catch(() => undefined);
    const channel = supabase
      .channel("live-room-discovery")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms" },
        refreshLiveRooms,
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [authSession?.user?.id]);

  useEffect(() => {
    if (Platform.OS === "web" || !authSession?.user) return undefined;
    let active = true;
    let handledRequestId;
    const handleResponse = async (response) => {
      const request = response?.notification?.request;
      if (!request || request.identifier === handledRequestId) return;
      handledRequestId = request.identifier;
      const roomId = request.content.data?.roomId;
      if (typeof roomId !== "string") return;
      try {
        const nextRoom = await getRoom(roomId);
        if (!active || nextRoom.state !== "live") return;
        openRoom(nextRoom);
      } catch {
        if (active)
          Alert.alert(
            "Oda artık açık değil",
            "Bildirimdeki oda kapatılmış veya henüz başlamamış olabilir.",
          );
      }
    };
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponse(response);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      responseSubscription.remove();
    };
  }, [authSession?.user?.id]);

  const leaveCurrentRoom = () => {
    const leavingRoom = room;
    setRoomMinimized(false);
    setRoom(null);
    if (leavingRoom?.id) {
      AsyncStorage.getItem(ROOM_MESSAGES_KEY)
        .then((savedMessages) => {
          const parsed = JSON.parse(savedMessages || "{}");
          if (parsed && typeof parsed === "object" && leavingRoom.id in parsed) {
            delete parsed[leavingRoom.id];
            return AsyncStorage.setItem(ROOM_MESSAGES_KEY, JSON.stringify(parsed));
          }
          return undefined;
        })
        .catch(() => undefined);
    }
    if (leavingRoom?.persisted) {
      leaveRoomMembership(leavingRoom.id).catch(() => undefined);
      if (leavingRoom.hostId === authSession?.user?.id) {
        setHostRoomPresence(leavingRoom.id, false).catch(() => undefined);
      }
    }
  };

  useEffect(() => {
    if (!room || roomMinimized) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setRoomMinimized(true);
      return true;
    });
    return () => sub.remove();
  }, [room, roomMinimized]);

  const clearNotifications = () => {
    setNotifications([]);
    AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify([])).catch(
      () => undefined,
    );
  };

  const updateRoomSettings = async (roomId, updates) => {
    if (supabase && authSession?.user && room?.persisted) {
      try {
        const updatedRoom = await updateRemoteRoom(roomId, updates);
        if (updatedRoom?.hostId === authSession.user.id) {
          setOwnHostedRoom(updatedRoom);
        }
        setRooms((currentRooms) =>
          currentRooms.map((item) => (item.id === roomId ? updatedRoom : item)),
        );
        setRoom((currentRoom) =>
          currentRoom?.id === roomId ? updatedRoom : currentRoom,
        );
      } catch {
        Alert.alert(
          "Oda ayarı kaydedilemedi",
          "Bağlantını kontrol edip tekrar dene.",
        );
      }
      return;
    }
    setRooms((currentRooms) => {
      const nextRooms = currentRooms.map((item) =>
        item.id === roomId ? { ...item, ...updates } : item,
      );
      const storedRooms = nextRooms.filter((item) => item.userCreated);
      AsyncStorage.setItem(USER_ROOMS_KEY, JSON.stringify(storedRooms)).catch(
        () => undefined,
      );
      return nextRooms;
    });
    setRoom((currentRoom) =>
      currentRoom?.id === roomId ? { ...currentRoom, ...updates } : currentRoom,
    );
  };

  const toggleFollowUser = useCallback(
    async (targetUserId) => {
      if (
        !targetUserId ||
        !authSession?.user ||
        targetUserId === authSession.user.id
      )
        return;
      const currentlyFollowing = followedUserIds.includes(targetUserId);
      setFollowedUserIds((currentIds) =>
        currentlyFollowing
          ? currentIds.filter((id) => id !== targetUserId)
          : [...currentIds, targetUserId],
      );
      try {
        await setFollowing({
          userId: authSession.user.id,
          targetUserId,
          following: !currentlyFollowing,
        });
      } catch {
        setFollowedUserIds((currentIds) =>
          currentlyFollowing
            ? [...currentIds, targetUserId]
            : currentIds.filter((id) => id !== targetUserId),
        );
        Alert.alert(
          "Takip değiştirilemedi",
          "Bağlantını kontrol edip tekrar dene.",
        );
      }
    },
    [authSession?.user, followedUserIds],
  );

  const toggleFollowHost = async () => {
    if (!room?.hostId) return;
    await toggleFollowUser(room.hostId);
  };

  const equipProfileItem = useCallback((patch) => {
    setProfile((current) => {
      const updated = { ...current, ...patch };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated)).catch(
        () => undefined,
      );
      return updated;
    });
  }, []);

  const saveProfile = async (nextProfile) => {
    if (supabase && authSession?.user) {
      const normalizedHandle = (nextProfile.handle || "").trim().toLowerCase();
      if (normalizedHandle !== (profile.handle || "").trim().toLowerCase()) {
        try {
          const available = await isHandleAvailable(normalizedHandle);
          if (!available) {
            Alert.alert(
              "Kullanıcı adı alınmış",
              "Başka bir kullanıcı adı dene.",
            );
            return;
          }
        } catch {
          Alert.alert(
            "Kullanıcı adı denetlenemedi",
            "Bağlantını kontrol edip tekrar dene.",
          );
          return;
        }
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: (nextProfile.name || "").trim(),
          handle: normalizedHandle,
          bio: (nextProfile.bio || "").trim(),
          avatar_color: nextProfile.color,
        })
        .eq("id", authSession.user.id);
      if (error) {
        Alert.alert(
          "Profil kaydedilemedi",
          error.code === "23505"
            ? "Bu kullanıcı adı alınmış. Başka bir ad dene."
            : "Bağlantını kontrol edip tekrar dene.",
        );
        return;
      }
      if (
        nextProfile.activeFrameId !== profile.activeFrameId ||
        nextProfile.activeProfileThemeId !== profile.activeProfileThemeId
      ) {
        await supabase
          .from("profiles")
          .update({
            active_frame_id: nextProfile.activeFrameId || null,
            active_profile_theme_id: nextProfile.activeProfileThemeId || null,
          })
          .eq("id", authSession.user.id)
          .then(() => undefined, () => undefined);
      }
    }
    setProfile(nextProfile);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile)).catch(
      () => undefined,
    );
    setProfileEditorOpen(false);
  };

  const resetCurrentPassword = async () => {
    const email = authSession?.user?.email;
    if (!email) {
      Alert.alert(
        "E-posta hesabı yok",
        "Telefon, Google veya Apple hesabında parola sıfırlama yerine ilgili sağlayıcıyı kullanmalısın.",
      );
      return;
    }
    try {
      await requestPasswordReset(email);
      Alert.alert(
        "Bağlantı gönderildi",
        "Bu hesap için parola sıfırlama bağlantısı e-postana gönderildi.",
      );
    } catch (error) {
      Alert.alert(
        "İstek gönderilemedi",
        error?.message || "Daha sonra tekrar dene.",
      );
      throw error;
    }
  };

  const finishPasswordRecovery = async (password) => {
    try {
      await updatePassword(password);
      setPasswordRecoveryOpen(false);
      Alert.alert("Parola güncellendi", "Yeni parolanla giriş yapabilirsin.");
    } catch (error) {
      Alert.alert(
        "Parola güncellenemedi",
        error?.message || "Bağlantını kontrol edip tekrar dene.",
      );
      throw error;
    }
  };

  const signOutCurrentAccount = async () => {
    try {
      if (room?.persisted) {
        leaveRoomMembership(room.id).catch(() => undefined);
        if (room.hostId === authSession?.user?.id) {
          setHostRoomPresence(room.id, false).catch(() => undefined);
        }
      }
      await unregisterPushToken(supabase).catch(() => undefined);
      await supabase.auth.signOut();
      setAccountSecurityOpen(false);
    } catch (error) {
      Alert.alert(
        "Çıkış yapılamadı",
        error?.message || "Daha sonra tekrar dene.",
      );
      throw error;
    }
  };

  const permanentlyDeleteCurrentAccount = async () => {
    try {
      await unregisterPushToken(supabase).catch(() => undefined);
      await deleteCurrentAccount();
      await clearAllReminders();
      await AsyncStorage.multiRemove(APP_STORAGE_KEYS);
      await supabase.auth.signOut();
      setAccountSecurityOpen(false);
      Alert.alert(
        "Hesap silindi",
        "Hesabın ve buna bağlı verilerin kalıcı olarak silindi.",
      );
    } catch (error) {
      Alert.alert(
        "Hesap silinemedi",
        error?.message || "Hesap silme servisini daha sonra tekrar dene.",
      );
      throw error;
    }
  };

  const exportLocalData = async () => {
    try {
      const entries = await AsyncStorage.multiGet(APP_STORAGE_KEYS);
      const data = entries.reduce((result, [key, value]) => {
        if (value === null) return result;
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
        return result;
      }, {});
      await Share.share({
        title: "Sora yerel veri özeti",
        message: JSON.stringify(
          {
            format: "sora-local-export-v1",
            exportedAt: new Date().toISOString(),
            data,
          },
          null,
          2,
        ),
      });
    } catch {
      Alert.alert(
        "Dışa aktarma başarısız",
        "Veri özeti şu an oluşturulamadı. Lütfen tekrar dene.",
      );
    }
  };

  const clearLocalData = () => {
    Alert.alert(
      "Cihaz önbelleği sıfırlansın mı?",
      "Bu telefondaki favoriler, geçmiş, hatırlatıcılar ve yerel tercihler temizlenecek. Buluttaki hesabın etkilenmez.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sıfırla",
          style: "destructive",
          onPress: async () => {
            try {
              await clearAllReminders();
              await AsyncStorage.multiRemove(APP_STORAGE_KEYS);
              setReminderRoomIds([]);
              setFavoriteRoomIds([]);
              setRecentRoomIds([]);
              setNotifications(SEEDED_NOTIFICATIONS);
              setAppSettings(DEFAULT_APP_SETTINGS);
              if (!isSupabaseConfigured || !authSession?.user) {
                setRooms(SEEDED_ROOMS);
                setScheduledRooms(SEEDED_SCHEDULED_ROOMS);
                setProfile(DEFAULT_PROFILE);
                setWalletBalance(SEEDED_WALLET_BALANCE);
                setDailyRewardClaimed(false);
                setOnboardingOpen(true);
              }
              leaveCurrentRoom();
              setRoomMinimized(false);
              setActiveTab("discover");
              setSettingsOpen(false);
              setDataControlsOpen(false);
            } catch {
              Alert.alert(
                "Sıfırlama başarısız",
                "Yerel veriler şu an silinemedi. Lütfen tekrar dene.",
              );
            }
          },
        },
      ],
    );
  };

  // DIKKAT: Hook'lar asagida. Erken return'ler bu blogun ALTINDA olmali.
  // Bir donem buradaki ifadeler hook'lardan onceydi; marka ekrani kapanip
  // kosullar degisince hook sayisi degisiyor ve uygulama
  // "Rendered more hooks than during the previous render" ile cokuyordu.
  const myHostedRooms = useMemo(() => {
    if (supabase && authSession?.user?.id) {
      const uid = authSession.user.id;
      const fromLive = rooms.filter((item) => item.hostId === uid);
      if (ownHostedRoom && !fromLive.some((item) => item.id === ownHostedRoom.id)) {
        return [ownHostedRoom, ...fromLive];
      }
      return fromLive;
    }
    return rooms.filter((item) => item.host === profile.name);
  }, [authSession?.user?.id, ownHostedRoom, profile.name, rooms]);
  const hostedRoomCount = myHostedRooms.length;

  const handleOpenNotifications = useCallback(
    () => setNotificationsOpen(true),
    [],
  );
  const handleOpenCreate = async () => {
    if (supabase && authSession?.user) {
      try {
        const existingRoom = await getHostedRoom(authSession.user.id);
        if (existingRoom) {
          promptHostedRoom(existingRoom);
          return;
        }
      } catch (error) {
        console.error("Room lookup failed", error);
        Alert.alert(
          "Odalar yüklenemedi",
          "Bağlantıyı kontrol edip tekrar dene.",
        );
        return;
      }
    }
    setCreateOpen(true);
  };
  const handleOpenSchedule = useCallback(() => setScheduleOpen(true), []);
  const handleOpenProfileEditor = useCallback(
    () => setProfileEditorOpen(true),
    [],
  );
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenWallet = useCallback(() => setWalletOpen(true), []);
  const handleOpenAdmin = useCallback(() => setAdminPanelOpen(true), []);
  const handleCloseCreate = useCallback(() => setCreateOpen(false), []);
  const handleCloseSchedule = useCallback(() => setScheduleOpen(false), []);
  const handleCloseProfileEditor = useCallback(
    () => setProfileEditorOpen(false),
    [],
  );
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleCloseAccountSecurity = useCallback(
    () => setAccountSecurityOpen(false),
    [],
  );
  const handleClosePasswordReset = useCallback(
    () => setPasswordRecoveryOpen(false),
    [],
  );
  const handleCloseDataControls = useCallback(
    () => setDataControlsOpen(false),
    [],
  );
  const handleCloseWallet = useCallback(() => setWalletOpen(false), []);
  const handleCloseNotifications = useCallback(
    () => setNotificationsOpen(false),
    [],
  );
  const handleCloseAdminPanel = useCallback(() => setAdminPanelOpen(false), []);
  const handleOpenAccountSecurity = useCallback(() => {
    setSettingsOpen(false);
    setTimeout(() => setAccountSecurityOpen(true), 300);
  }, []);
  const handleOpenDataControls = useCallback(() => {
    setSettingsOpen(false);
    setTimeout(() => setDataControlsOpen(true), 300);
  }, []);
  const handleRefreshWallet = useCallback(
    () =>
      refreshWalletData().catch(() =>
        Alert.alert("Yenilenemedi", "Bağlantını kontrol edip tekrar dene."),
      ),
    [refreshWalletData],
  );

  const refreshMySanction = useCallback(async () => {
    if (!supabase || !authSession?.user?.id) {
      setActiveSanction(null);
      return null;
    }
    const sanction = await getMyActiveSanction().catch(() => null);
    setActiveSanction(sanction);
    if (sanction) {
      setRoom(null);
      setRoomMinimized(false);
    }
    return sanction;
  }, [authSession?.user?.id]);

  useEffect(() => {
    const uid = authSession?.user?.id;
    if (!supabase || !uid) {
      setActiveSanction(null);
      return undefined;
    }
    refreshMySanction();
    const channel = supabase
      .channel(`self-admin-sync-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_sanctions", filter: `user_id=eq.${uid}` },
        () => {
          refreshMySanction();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${uid}` },
        (payload) => {
          const next = payload?.new;
          if (!next) return;
          if (typeof next.balance === "number") setWalletBalance(next.balance);
          if (typeof next.promo_balance === "number") setPromoWalletBalance(next.promo_balance);
          if (typeof next.paid_balance === "number") setPaidWalletBalance(next.paid_balance);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authSession?.user?.id, refreshMySanction]);

  // --- Kosullu ekranlar (tum hook'lar yukarida cagrildi) ---
  if (brandLaunchVisible || (isSupabaseConfigured && authSession === undefined))
    return (
      <BrandLaunch
        logoSource={SORA_LOGO}
        waiting={isSupabaseConfigured && authSession === undefined}
        closing={brandLaunchClosing}
      />
    );
  if (isSupabaseConfigured && !authSession)
    return (
      <View style={styles.app}>
        <AuthScreen />
        <PasswordResetSheet
          visible={passwordRecoveryOpen}
          onDismiss={() => setPasswordRecoveryOpen(false)}
          onUpdatePassword={finishPasswordRecovery}
        />
      </View>
    );

  if (activeSanction) {
    const expiryLabel = activeSanction.expiresAt
      ? new Intl.DateTimeFormat("tr-TR", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(activeSanction.expiresAt))
      : null;
    return (
      <SafeAreaView style={[styles.app, { justifyContent: "center", paddingHorizontal: 24 }]}>
        <StatusBar barStyle="dark-content" />
        <View
          style={{
            padding: 24,
            borderRadius: 24,
            backgroundColor: COLORS.surface,
            borderWidth: 1,
            borderColor: COLORS.line,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "rgba(217,79,92,0.12)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <Ionicons name="ban-outline" size={32} color={COLORS.danger} />
          </View>
          <Text style={{ color: COLORS.text, fontSize: 21, fontWeight: "900", textAlign: "center" }}>
            {expiryLabel ? "Hesabın Geçici Olarak Kısıtlandı" : "Hesabın Süresiz Yasaklandı"}
          </Text>
          <Text
            style={{
              color: COLORS.danger,
              fontSize: 13,
              fontWeight: "800",
              marginTop: 8,
              textAlign: "center",
            }}
          >
            {expiryLabel ? `Bitiş tarihi: ${expiryLabel}` : "Süre: Süresiz"}
          </Text>
          <Text
            style={{
              color: COLORS.textSecondary,
              fontSize: 13,
              lineHeight: 20,
              marginTop: 12,
              textAlign: "center",
            }}
          >
            Sebep: {activeSanction.reason}
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 22, width: "100%" }}>
            <Pressable
              onPress={() => refreshMySanction()}
              style={{
                flex: 1,
                minHeight: 46,
                borderRadius: 14,
                backgroundColor: COLORS.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}>
                Durumu Kontrol Et
              </Text>
            </Pressable>
            <Pressable
              onPress={() => signOutCurrentAccount().catch(() => undefined)}
              style={{
                flex: 1,
                minHeight: 46,
                borderRadius: 14,
                backgroundColor: COLORS.surfaceRaised,
                borderWidth: 1,
                borderColor: COLORS.line,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: "800" }}>
                Çıkış Yap
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const screens = {
    discover: (
      <Discover
        rooms={rooms}
        profile={profile}
        favoriteRoomIds={favoriteRoomIds}
        recentRoomIds={recentRoomIds}
        notificationCount={notifications.length}
        currentUserId={authSession?.user?.id}
        onOpenNotifications={handleOpenNotifications}
        onOpenRoom={openRoom}
        onCreate={handleOpenCreate}
        onToggleFavorite={toggleFavorite}
      />
    ),
    inbox: (
      <InboxScreen currentUserId={authSession?.user?.id} profile={profile} />
    ),
    community: (
      <CommunityScreen
        currentUserId={authSession?.user?.id}
        profile={profile}
        coins={walletBalance}
        onBalanceRefresh={refreshWalletData}
        onFamilyChange={setMyFamily}
        onOpenUserProfile={setInspectedUserId}
      />
    ),
    profile: (
      <Profile
        profile={profile}
        userId={authSession?.user?.id}
        followedUserIds={followedUserIds}
        family={myFamily}
        coins={walletBalance}
        favoriteCount={favoriteRoomIds.length}
        hostedRoomCount={hostedRoomCount}
        myRooms={myHostedRooms}
        dailyRewardClaimed={dailyRewardClaimed}
        onEdit={handleOpenProfileEditor}
        onOpenSettings={handleOpenSettings}
        onOpenWallet={handleOpenWallet}
        onClaimDailyReward={claimDailyReward}
        onSyncUserLevel={syncUserLevelAndNotify}
        onOpenUserProfile={setInspectedUserId}
      />
    ),
  };
  return (
    <View style={styles.app}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        {screens[activeTab]}
        <BottomNavigation active={activeTab} onChange={setActiveTab} />
      </SafeAreaView>
      {room ? (
        <>
          <View
            pointerEvents={roomMinimized ? "none" : "auto"}
            style={[
              StyleSheet.absoluteFill,
              styles.roomOverlay,
              roomMinimized && styles.roomOverlayMinimized,
            ]}
          >
            <Room
              room={room}
              profile={profile}
              userId={authSession?.user?.id}
              accessToken={authSession?.access_token}
              coins={walletBalance}
              userFamilyLevel={myFamily?.level || 0}
              onSendGift={sendGift}
              onLeave={leaveCurrentRoom}
              onUpdateRoom={updateRoomSettings}
              isFollowingHost={followedUserIds.includes(room.hostId)}
              followedUserIds={followedUserIds}
              onToggleFollowHost={toggleFollowHost}
              onToggleFollowUser={toggleFollowUser}
              initialSpeakerOn={roomPreferences.speakerEnabled}
              initialMicrophoneOn={roomPreferences.microphoneEnabled}
              onHostPresenceChange={setHostRoomPresence}
              onMinimize={() => setRoomMinimized(true)}
              onEditProfile={handleOpenProfileEditor}
              minimized={roomMinimized}
            />
          </View>
          {roomMinimized ? (
            <RoomMiniBubble
              room={room}
              onExpand={() => setRoomMinimized(false)}
              onLeave={leaveCurrentRoom}
            />
          ) : null}
        </>
      ) : null}
      <ProfileDetailSheet
        visible={Boolean(inspectedUserId)}
        userId={inspectedUserId}
        profile={inspectedUserId === authSession?.user?.id ? profile : null}
        isSelf={Boolean(inspectedUserId && inspectedUserId === authSession?.user?.id)}
        isFollowing={Boolean(inspectedUserId && followedUserIds.includes(inspectedUserId))}
        canBlock={Boolean(
          supabase &&
          inspectedUserId &&
          authSession?.user?.id &&
          inspectedUserId !== authSession.user.id,
        )}
        onToggleFollow={() => inspectedUserId && toggleFollowUser(inspectedUserId)}
        onBlock={() => {
          const targetId = inspectedUserId;
          if (!targetId) return;
          Alert.alert(
            "Kullanıcıyı engelle",
            "Bu kullanıcıyı engellediğinde mesajlarını göremezsin.",
            [
              { text: "Vazgeç", style: "cancel" },
              {
                text: "Engelle",
                style: "destructive",
                onPress: async () => {
                  try {
                    await setUserBlocked({ targetUserId: targetId, blocked: true });
                    setInspectedUserId(null);
                    Alert.alert(
                      "Kullanıcı engellendi",
                      "Engeli Güvenlik Merkezi'nden kaldırabilirsin.",
                    );
                  } catch {
                    Alert.alert("Engellenemedi", "Bağlantını kontrol edip tekrar dene.");
                  }
                },
              },
            ],
          );
        }}
        onReport={() => {
          const targetId = inspectedUserId;
          if (!targetId) return;
          setInspectedUserId(null);
          setTimeout(() => {
            setInspectedReportTarget({
              name: "Sora kullanıcısı",
              userId: targetId,
            });
          }, 300);
        }}
        onEdit={() => {
          setInspectedUserId(null);
          setTimeout(() => handleOpenProfileEditor(), 300);
        }}
        onDismiss={() => setInspectedUserId(null)}
      />
      <ReportSheet
        target={inspectedReportTarget}
        onDismiss={() => setInspectedReportTarget(null)}
      />
      <CreateRoomSheet
        visible={createOpen}
        onDismiss={handleCloseCreate}
        onCreate={createRoom}
      />
      <Modal
        visible={Boolean(hostedRoomPrompt)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !resumingHostedRoom && setHostedRoomPrompt(null)}
      >
        <Pressable
          style={styles.resumeBackdrop}
          onPress={() => !resumingHostedRoom && setHostedRoomPrompt(null)}
        >
          <Pressable style={styles.resumeCard} onPress={() => undefined}>
            <LinearGradient
              colors={["#1E3A6B", "#13233F", "#0D1726"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.resumeHero}
            >
              <View style={styles.resumeGlow} pointerEvents="none" />
              <View style={styles.resumeAvatarRing}>
                <View style={styles.resumeAvatar}>
                  <Text style={styles.resumeAvatarText}>
                    {(profile?.name || "S").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.resumeMicBadge}>
                  <Ionicons name="mic" size={13} color="#FFFFFF" />
                </View>
              </View>
              <Text style={styles.resumeKicker}>SENİN ODAN</Text>
              <Text style={styles.resumeTitle} numberOfLines={1}>
                {hostedRoomPrompt?.title || "Odan"}
              </Text>
              <Text style={styles.resumeSub} numberOfLines={2}>
                Sahne seni bekliyor. Aynı anda yalnızca bir odan olabilir.
              </Text>
            </LinearGradient>
            <View style={styles.resumeActions}>
              <Pressable
                style={({ pressed }) => [styles.resumePrimary, pressed && { opacity: 0.85 }]}
                disabled={resumingHostedRoom}
                onPress={() => hostedRoomPrompt && resumeHostedRoom(hostedRoomPrompt)}
              >
                {resumingHostedRoom ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="enter-outline" size={19} color="#FFFFFF" />
                    <Text style={styles.resumePrimaryText}>Odana dön</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={styles.resumeSecondary}
                disabled={resumingHostedRoom}
                onPress={() => setHostedRoomPrompt(null)}
              >
                <Text style={styles.resumeSecondaryText}>Vazgeç</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <ProfileEditor
        visible={profileEditorOpen}
        profile={profile}
        onDismiss={handleCloseProfileEditor}
        onSave={saveProfile}
        onEquipItem={equipProfileItem}
        onAvatarChange={(url) => setProfile((current) => ({ ...current, avatarUrl: url }))}
        onBalanceRefresh={refreshWalletData}
      />
      <AppSettingsSheet
        visible={settingsOpen}
        settings={appSettings}
        onDismiss={handleCloseSettings}
        onChange={updateAppSetting}
        onOpenAccount={handleOpenAccountSecurity}
        onOpenDataControls={handleOpenDataControls}
      />
      <AccountSecuritySheet
        visible={accountSecurityOpen}
        email={authSession?.user?.email}
        onDismiss={handleCloseAccountSecurity}
        onResetPassword={resetCurrentPassword}
        onSignOut={signOutCurrentAccount}
        onDeleteAccount={permanentlyDeleteCurrentAccount}
      />
      <PasswordResetSheet
        visible={passwordRecoveryOpen}
        onDismiss={handleClosePasswordReset}
        onUpdatePassword={finishPasswordRecovery}
      />
      <RoomPasswordPrompt
        room={passwordPromptRoom}
        error={passwordPromptError}
        busy={passwordPromptBusy}
        onSubmit={async (pin) => {
          const target = passwordPromptRoom;
          if (!target) return;
          setPasswordPromptBusy(true);
          setPasswordPromptError(null);
          try {
            await joinRoomWithPassword(target.id, pin);
            setPasswordPromptRoom(null);
            openRoom(target, { skipPasswordCheck: true });
          } catch (error) {
            setPasswordPromptError(describeRoomError(error));
          } finally {
            setPasswordPromptBusy(false);
          }
        }}
        onDismiss={() => setPasswordPromptRoom(null)}
      />
      <DataControlsSheet
        visible={dataControlsOpen}
        profile={profile}
        summary={{
          favorites: favoriteRoomIds.length,
          rooms: hostedRoomCount,
          notifications: notifications.length,
        }}
        onDismiss={handleCloseDataControls}
        onExportData={exportLocalData}
        onClearLocalData={clearLocalData}
      />
      <WalletSheet
        visible={walletOpen}
        coins={walletBalance}
        promoCoins={promoWalletBalance}
        paidCoins={paidWalletBalance}
        activities={walletActivities}
        dailyRewardClaimed={dailyRewardClaimed}
        onDismiss={handleCloseWallet}
        onClaimDailyReward={claimDailyReward}
        onRefresh={handleRefreshWallet}
      />
      <NotificationCenter
        visible={notificationsOpen}
        notifications={notifications}
        onDismiss={handleCloseNotifications}
        onClear={clearNotifications}
      />
      <Onboarding visible={onboardingOpen} onComplete={completeOnboarding} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  avatarEditRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 6, marginBottom: 8 },
  avatarEditPress: { position: "relative" },
  avatarEditBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEditButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "#EAF2FE",
  },
  avatarEditButtonText: { color: COLORS.primary, fontWeight: "800", fontSize: 14 },
  avatarEditRemove: { color: "#D14B54", fontWeight: "700", fontSize: 13, paddingLeft: 4 },
  profileFollowRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 14,
    gap: 18,
  },
  profileFollowItem: { alignItems: "flex-start" },
  profileFollowNumber: { color: COLORS.text, fontSize: 19, fontWeight: "800" },
  profileFollowLabel: { color: COLORS.muted, fontSize: 13, fontWeight: "600", marginTop: 1 },
  profileFollowDivider: { width: 1, height: 26, backgroundColor: COLORS.line },
  resumeBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5,10,20,0.72)",
    justifyContent: "center",
    paddingHorizontal: 26,
  },
  resumeCard: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#0D1726",
    borderWidth: 1,
    borderColor: "rgba(118,175,255,0.18)",
  },
  resumeHero: {
    alignItems: "center",
    paddingTop: 30,
    paddingBottom: 22,
    paddingHorizontal: 22,
  },
  resumeGlow: {
    position: "absolute",
    top: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(47,128,237,0.22)",
  },
  resumeAvatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: "rgba(118,175,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resumeAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#2F80ED",
    alignItems: "center",
    justifyContent: "center",
  },
  resumeAvatarText: { color: "#FFFFFF", fontSize: 34, fontWeight: "800" },
  resumeMicBadge: {
    position: "absolute",
    right: -2,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#22C55E",
    borderWidth: 2,
    borderColor: "#13233F",
    alignItems: "center",
    justifyContent: "center",
  },
  resumeKicker: {
    color: "#76AFFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 6,
  },
  resumeTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "800" },
  resumeSub: {
    color: "#A9BEDB",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  resumeActions: { padding: 18, gap: 10 },
  resumePrimary: {
    height: 54,
    borderRadius: 18,
    backgroundColor: "#2F80ED",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  resumePrimaryText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  resumeSecondary: { height: 44, alignItems: "center", justifyContent: "center" },
  resumeSecondaryText: { color: "#A9BEDB", fontSize: 15, fontWeight: "700" },
  app: { flex: 1, backgroundColor: COLORS.background },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? 8 : 0,
  },
  discoverScroll: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 104 },
  topBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.text,
  },
  brandMarkText: {
    color: COLORS.primary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: -1,
  },
  brandText: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  topActions: { flexDirection: "row", gap: 8 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
    position: "relative",
  },
  iconButtonSubtle: { backgroundColor: "rgba(26,20,16,0.06)" },
  iconBadge: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.pink,
    borderWidth: 1.5,
    borderColor: COLORS.surfaceRaised,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 18,
  },
  searchBoxFocused: {
    borderColor: "rgba(47,128,237,0.60)",
    backgroundColor: COLORS.surface,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  greetingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 24,
  },
  kicker: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  heroHeading: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -1.2,
    lineHeight: 34,
  },
  newRoomButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.text,
    borderRadius: 24,
  },
  newRoomText: { color: COLORS.primary, fontSize: 13, fontWeight: "900" },
  featureCard: {
    height: 210,
    overflow: "hidden",
    borderRadius: 22,
    padding: 20,
    position: "relative",
    backgroundColor: COLORS.text,
  },
  featureGlowOne: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: COLORS.primary,
    opacity: 0.18,
    top: -60,
    right: -30,
  },
  featureGlowTwo: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.primary,
    bottom: -20,
    right: 50,
    opacity: 0.28,
  },
  featureContent: { flex: 1, justifyContent: "space-between" },
  liveText: {
    color: COLORS.primary,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "900",
  },
  liveDot: { color: COLORS.pink },
  featureTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    letterSpacing: -0.8,
    fontWeight: "900",
    marginBottom: 4,
  },
  featureSubtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    maxWidth: 220,
  },
  featureFooter: { flexDirection: "row", alignItems: "center", gap: 10 },
  stackAvatars: { flexDirection: "row" },
  featureListeners: { color: "rgba(255,255,255,0.72)", fontSize: 11 },
  featureSound: {
    position: "absolute",
    right: 22,
    bottom: 28,
    height: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  soundBar: {
    width: 4,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    opacity: 0.8,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 28,
    marginBottom: 12,
  },
  categoryList: { gap: 8, paddingRight: 20, paddingBottom: 3 },
  categoryChip: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 14,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  categoryChipActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  categoryText: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
  categoryTextActive: { color: COLORS.primary },
  listHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 24,
    marginBottom: 12,
  },
  listCount: { color: COLORS.muted, fontSize: 12 },
  showAll: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  roomList: { gap: 10 },
  roomCard: {
    minHeight: 96,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    ...ELEVATION.card,
  },
  roomCardPressed: {
    backgroundColor: COLORS.surfaceRaised,
    transform: [{ scale: 0.988 }],
  },
  roomArtwork: {
    width: 68,
    height: 68,
    borderRadius: 34,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  roomArtworkOrb: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    right: -14,
    bottom: -14,
    opacity: 0.7,
  },
  roomArtworkInitial: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  roomDetails: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  roomTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 4,
  },
  roomName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.3,
    maxWidth: 138,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.text,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 10,
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  livePillText: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  roomDescription: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  roomBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  miniPeople: { flexDirection: "row", gap: 3, alignItems: "center" },
  listenerCount: { color: COLORS.muted, fontSize: 11 },
  roomCategory: { color: COLORS.muted, fontSize: 10, fontWeight: "800" },
  roomCategoryPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  emptyState: { alignItems: "center", paddingTop: 44, paddingHorizontal: 24 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center",
  },
  emptyDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center",
    maxWidth: 260,
  },
  tabBadge: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.pink,
    position: "absolute",
    top: 3,
    right: 8,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
  },
  screenHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 30,
    letterSpacing: -1.1,
    fontWeight: "900",
  },
  inboxFilter: {
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  inboxFilterText: { color: COLORS.muted, fontSize: 13 },
  inboxCaption: {
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: "900",
    marginBottom: 8,
  },
  chatRow: {
    minHeight: 76,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  chatText: { flex: 1, minWidth: 0 },
  chatTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  chatName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  chatTime: { color: COLORS.muted, fontSize: 11 },
  chatBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  chatPreview: { flex: 1, color: COLORS.muted, fontSize: 13 },
  unreadBubble: {
    backgroundColor: COLORS.text,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: COLORS.primary, fontWeight: "900", fontSize: 10 },
  communityBanner: {
    borderRadius: 20,
    padding: 18,
    minHeight: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: COLORS.text,
  },
  communityIcon: { color: COLORS.primary, fontSize: 32 },
  communityBannerText: { flex: 1 },
  communityBannerTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  communityBannerCopy: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    lineHeight: 17,
  },
  groupCard: {
    height: 100,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  groupIcon: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  groupText: { marginLeft: 12, flex: 1 },
  groupName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  groupMembers: { color: "rgba(255,255,255,0.72)", fontSize: 12 },
  joinButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: COLORS.primary,
    borderRadius: 20,
  },
  joinedButton: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  joinButtonText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },
  joinedButtonText: { color: "#fff" },
  profileCover: {
    marginHorizontal: -20,
    height: 150,
    overflow: "hidden",
    alignItems: "flex-end",
    paddingRight: 20,
    paddingTop: 13,
    backgroundColor: COLORS.text,
  },
  profileSummary: { marginTop: -50, alignItems: "center" },
  avatar: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  avatarBorder: {
    borderWidth: 4,
    borderColor: COLORS.background,
  },
  profileName: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 10,
    letterSpacing: -0.5,
  },
  handle: { color: COLORS.muted, fontSize: 13, marginTop: 3 },
  profileStats: {
    flexDirection: "row",
    marginTop: 22,
    width: "100%",
    justifyContent: "space-evenly",
  },
  profileStat: { alignItems: "center" },
  profileStatNumber: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  profileStatLabel: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  profileLevel: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  levelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.text,
    justifyContent: "center",
    alignItems: "center",
  },
  levelText: { flex: 1 },
  levelTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 3,
  },
  levelDescription: { color: COLORS.muted, fontSize: 11 },
  profileSection: {
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "900",
    marginTop: 28,
    marginBottom: 9,
  },
  actionList: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  actionRow: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTitle: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
  roomScreen: { flex: 1, backgroundColor: COLORS.background },
  roomHeader: {
    height: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  roomHeaderText: { alignItems: "center", flex: 1, marginHorizontal: 9 },
  roomHeaderEyebrow: {
    color: COLORS.muted,
    fontSize: 9,
    letterSpacing: 1.1,
    fontWeight: "900",
    marginBottom: 2,
  },
  roomHeaderTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  roomScroll: { paddingHorizontal: 16, paddingBottom: 10 },
  roomHero: { borderRadius: 24, overflow: "hidden" },
  roomHeroGradient: {
    minHeight: 420,
    padding: 18,
    overflow: "hidden",
    position: "relative",
    backgroundColor: COLORS.text,
  },
  roomHeroOrb: {
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(47,128,237,0.15)",
    position: "absolute",
    top: -90,
    left: "13%",
  },
  roomLive: {
    textAlign: "center",
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  hostArea: { alignItems: "center", marginTop: 20 },
  hostCrown: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: -8,
    marginLeft: 56,
    zIndex: 1,
  },
  hostName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 10,
  },
  hostRole: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
    letterSpacing: 1.1,
    fontWeight: "900",
    marginTop: 3,
  },
  voiceMeter: {
    height: 29,
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    marginTop: 8,
  },
  meterBar: { width: 3, borderRadius: 3, backgroundColor: COLORS.primary },
  seatGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    rowGap: 17,
    marginTop: 20,
  },
  seat: { width: "22%", alignItems: "center" },
  seatAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.12)",
    position: "relative",
  },
  seatAvatarSpeaking: { borderWidth: 3, borderColor: COLORS.primary },
  seatInitial: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  seatName: { color: "rgba(255,255,255,0.88)", fontSize: 10, marginTop: 6 },
  seatMuted: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  raiseHand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "center",
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
  },
  raiseHandText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  chatPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  chatPanelHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  chatPanelTitle: {
    color: COLORS.muted,
    fontSize: 9,
    letterSpacing: 1.3,
    fontWeight: "900",
  },
  clearChat: { color: COLORS.text, fontSize: 10, fontWeight: "800" },
  messageList: { minHeight: 60, gap: 5 },
  messageText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  systemMessage: { color: COLORS.muted, fontStyle: "italic" },
  messageUser: { color: COLORS.text, fontWeight: "900" },
  composer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  composerGift: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  composerInput: {
    flex: 1,
    paddingVertical: 6,
    color: COLORS.text,
    fontSize: 13,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.text,
  },
  roomControls: {
    height: 72,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  roomControl: { width: 66, alignItems: "center" },
  roomControlIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceRaised,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  roomControlActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  roomControlDanger: {
    backgroundColor: "rgba(217,79,79,0.12)",
    borderColor: "rgba(217,79,79,0.30)",
  },
  roomControlLabel: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
  roomControlLabelActive: { color: COLORS.primary },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(5,6,11,0.68)",
    justifyContent: "flex-end",
  },
  modalDismiss: { flex: 1 },
  sheet: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 22,
    paddingTop: 29,
    // Modal pencereleri SafeAreaView'in dışında açılır; Android gezinme
    // çubuğunun üstünde içerik için sabit bir güvenlik payı bırak.
    paddingBottom: Platform.OS === "ios" ? 35 : 52,
    borderTopLeftRadius: 29,
    borderTopRightRadius: 29,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 4,
    backgroundColor: COLORS.line,
    position: "absolute",
    alignSelf: "center",
    top: 10,
  },
  sheetClose: {
    width: 31,
    height: 31,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceRaised,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    right: 17,
    top: 15,
  },
  sheetTitle: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginBottom: 23,
  },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  sheetInput: {
    height: 50,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.text,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 18,
  },
  sheetCategories: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  sheetCategory: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  sheetCategoryActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  sheetCategoryText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  sheetCategoryTextActive: { color: COLORS.primary },
  createSubmit: {
    height: 54,
    borderRadius: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    backgroundColor: COLORS.text,
  },
  createSubmitText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  favoriteFilter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  liveActionBar: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  recentHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  recentHint: { color: COLORS.text, fontSize: 10, fontWeight: "900" },
  recentList: { gap: 11, paddingBottom: 2 },
  recentRoom: { width: 124 },
  recentArtwork: {
    height: 92,
    borderRadius: 18,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  recentInitial: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    zIndex: 1,
  },
  recentOrb: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    right: -19,
    bottom: -21,
    opacity: 0.72,
  },
  recentName: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
  recentMeta: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  inboxSearchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  directMessageOverlay: { flex: 1, backgroundColor: COLORS.background },
  directMessageSheet: { flex: 1, paddingTop: Platform.OS === "ios" ? 54 : 19 },
  directMessageHeader: {
    height: 66,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.surface,
  },
  directBack: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
  },
  directHeaderText: { flex: 1 },
  directName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  directStatus: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  directMessages: {
    flexGrow: 1,
    padding: 17,
    gap: 8,
    justifyContent: "flex-end",
  },
  directBubble: {
    alignSelf: "flex-start",
    maxWidth: "80%",
    backgroundColor: COLORS.surfaceRaised,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  directBubbleOwn: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  directBubbleText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  directBubbleTextOwn: { color: COLORS.primary },
  directComposer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 28 : 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  directInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    fontSize: 14,
  },
  directSend: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.text,
  },
  handStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surfaceRaised,
  },
  handStatusActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  handStatusText: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  handStatusTextActive: { color: COLORS.primary },
  reactionTray: { flexDirection: "row", alignItems: "center", gap: 5 },
  reactionButton: {
    minWidth: 38,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { color: COLORS.text, fontSize: 10, fontWeight: "900" },
  favoriteFilterActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  favoriteFilterText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  favoriteFilterTextActive: { color: COLORS.primary },
  roomCardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  favoriteButton: {
    width: 30,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  profileColors: { flexDirection: "row", gap: 12, marginBottom: 25 },
  profileColorOption: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: "transparent",
  },
  profileColorSelected: { borderColor: COLORS.text },
  notificationOverlay: {
    flex: 1,
    paddingTop: Platform.OS === "ios" ? 61 : 27,
    paddingHorizontal: 14,
    backgroundColor: "rgba(26,20,16,0.42)",
  },
  notificationSheet: {
    maxHeight: "70%",
    borderRadius: 22,
    padding: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  notificationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  notificationTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  notificationSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  notificationClear: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
  notificationList: { paddingTop: 4 },
  notificationRow: {
    flexDirection: "row",
    gap: 11,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  notificationText: { flex: 1 },
  notificationMessage: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  notificationTime: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  notificationEmpty: { alignItems: "center", paddingVertical: 37, gap: 9 },
  notificationEmptyText: { color: COLORS.muted, fontSize: 13 },
  settingsCaption: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginBottom: 9,
  },
  settingsDataCaption: { marginTop: 20 },
  settingRow: {
    minHeight: 72,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  settingIconActive: {
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(245,196,52,0.45)",
  },
  settingContent: { flex: 1 },
  settingTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  settingDescription: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  settingState: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  settingStateActive: { color: COLORS.pink },
  settingsLink: {
    minHeight: 62,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  dataNotice: {
    minHeight: 64,
    padding: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginTop: -8,
    marginBottom: 14,
  },
  dataNoticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  dataSummary: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  dataSummaryItem: {
    flex: 1,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: COLORS.line,
  },
  dataSummaryValue: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  dataSummaryLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginTop: 4,
  },
  dataAction: {
    minHeight: 69,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  dataActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  dataDestructiveAction: {
    minHeight: 69,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dataDestructiveIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(217,79,79,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,79,79,0.22)",
  },
  dataDestructiveTitle: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  dataFootnote: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 7,
  },
  roomRule: {
    flexDirection: "row",
    gap: 11,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceRaised,
  },
  roomRuleText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  reportButton: {
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 45,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(217,79,79,0.30)",
    backgroundColor: "rgba(217,79,79,0.06)",
  },
  reportButtonText: { color: COLORS.danger, fontSize: 12, fontWeight: "800" },
  audienceBar: {
    minHeight: 61,
    marginTop: 15,
    paddingHorizontal: 13,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  audienceAvatars: { flexDirection: "row", alignItems: "center", width: 94 },
  audienceAvatar: {
    width: 29,
    height: 29,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  audienceInitial: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  audienceCopy: { flex: 1 },
  audienceTitle: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  audienceSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  participantRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  participantInfo: { flex: 1 },
  participantName: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  participantRole: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  followButton: {
    minWidth: 72,
    height: 31,
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  followButtonActive: {
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: "#4C5E73",
  },
  followButtonText: {
    color: COLORS.primaryInk,
    fontSize: 10,
    fontWeight: "800",
  },
  followButtonTextActive: { color: COLORS.text },
  upcomingHeading: {
    marginTop: 27,
    marginBottom: 11,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  upcomingAdd: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
    paddingVertical: 5,
    paddingLeft: 12,
  },
  upcomingList: { gap: 9 },
  upcomingCard: {
    minHeight: 70,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  upcomingTime: { width: 86, alignItems: "flex-start", gap: 5 },
  upcomingTimeText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  upcomingContent: { flex: 1, minWidth: 0 },
  upcomingTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  upcomingMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  reminderButton: {
    width: 37,
    height: 37,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#4C5E73",
    borderRadius: 12,
  },
  reminderButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  onboardingScreen: { flex: 1, backgroundColor: COLORS.text },
  onboardingSafe: { flex: 1, paddingHorizontal: 24, paddingVertical: 18 },
  onboardingSkip: {
    alignSelf: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  onboardingSkipText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: "800",
  },
  onboardingContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 25,
  },
  onboardingIcon: {
    width: 108,
    height: 108,
    borderRadius: 54,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(47,128,237,0.14)",
    borderWidth: 2,
    borderColor: "rgba(47,128,237,0.40)",
    marginBottom: 32,
  },
  onboardingKicker: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 14,
  },
  onboardingTitle: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1.3,
    textAlign: "center",
  },
  onboardingCopy: {
    maxWidth: 290,
    color: "rgba(255,255,255,0.65)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 14,
  },
  onboardingFooter: { gap: 22, paddingBottom: 12 },
  onboardingDots: { flexDirection: "row", justifyContent: "center", gap: 7 },
  onboardingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  onboardingDotActive: { width: 24, backgroundColor: COLORS.primary },
  onboardingNext: {
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  onboardingNextText: {
    color: COLORS.primaryInk,
    fontSize: 15,
    fontWeight: "900",
  },
  lobbyScreen: { flex: 1, backgroundColor: COLORS.background },
  lobbyHeader: {
    height: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  lobbyHeaderTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
  lobbyHeaderSpacer: { width: 39 },
  lobbyContent: { flex: 1, paddingHorizontal: 20, paddingTop: 11 },
  lobbyArtwork: {
    minHeight: 250,
    borderRadius: 27,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  lobbyOrb: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: "rgba(236,211,255,0.18)",
    bottom: -90,
    right: -27,
  },
  lobbyLive: {
    position: "absolute",
    top: 18,
    color: "#E8EEF8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.75,
  },
  lobbyHost: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 10,
  },
  lobbyHostRole: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
    letterSpacing: 1.1,
    fontWeight: "900",
    marginTop: 3,
  },
  lobbyTitle: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.75,
    marginTop: 23,
  },
  lobbyDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  lobbyNotice: {
    marginTop: 20,
    padding: 13,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: COLORS.surface,
  },
  lobbyNoticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  lobbyCheckRow: { flexDirection: "row", gap: 9, marginTop: 10 },
  lobbyCheckButton: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 13,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  lobbyCheckText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  lobbyControls: { flexDirection: "row", gap: 10, marginTop: 18 },
  lobbyControl: {
    flex: 1,
    minHeight: 70,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    borderRadius: 17,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  lobbyControlActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  lobbyControlText: { color: COLORS.text, fontSize: 10, fontWeight: "800" },
  lobbyControlTextActive: { color: COLORS.primaryInk },
  lobbyFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 24 : 17,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  lobbyProfile: {
    color: COLORS.muted,
    fontSize: 10,
    textAlign: "center",
    marginBottom: 10,
  },
  lobbyJoin: {
    height: 62,
    paddingHorizontal: 17,
    borderRadius: 31,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.text,
  },
  lobbyJoinTitle: { color: COLORS.primary, fontSize: 15, fontWeight: "900" },
  lobbyJoinSubtitle: {
    color: "rgba(47,128,237,0.70)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  communityColorList: { flexDirection: "row", gap: 12, marginBottom: 25 },
  communityColorOption: {
    width: 37,
    height: 37,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: "transparent",
  },
  communityColorSelected: { borderColor: COLORS.text },
  communityDetailHero: {
    minHeight: 145,
    borderRadius: 20,
    padding: 18,
    justifyContent: "flex-end",
    overflow: "hidden",
    marginBottom: 17,
  },
  communityDetailIcon: {
    position: "absolute",
    top: 17,
    left: 17,
    width: 45,
    height: 45,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.17)",
  },
  communityDetailName: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  communityDetailMembers: { color: "#E8EEF8", fontSize: 11, marginTop: 4 },
  communityDetailDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 22,
  },
  communityEvent: {
    minHeight: 67,
    marginBottom: 20,
    padding: 10,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: COLORS.surfaceRaised,
  },
  communityEventDate: {
    width: 47,
    height: 47,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  communityEventDay: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  communityEventHour: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  communityEventText: { flex: 1 },
  communityEventTitle: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  communityEventMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  communityDetailActions: { flexDirection: "row", gap: 10 },
  communityShare: {
    width: 94,
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.surfaceRaised,
  },
  communityShareText: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  communityJoinWide: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.primary,
  },
  communityJoinWideText: {
    color: COLORS.primaryInk,
    fontSize: 12,
    fontWeight: "900",
  },
  giftSheetHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  coinPill: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.35)",
  },
  coinPillText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  giftHint: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: -11,
    marginBottom: 17,
  },
  giftGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  giftCard: {
    width: "47%",
    minHeight: 116,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  giftIcon: {
    width: 43,
    height: 43,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  giftName: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  giftCost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
  },
  giftCostText: { color: "#1D5FBF", fontSize: 10, fontWeight: "800" },
  dailyRewardCard: {
    minHeight: 76,
    marginTop: 12,
    padding: 13,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "rgba(47,128,237,0.10)",
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.26)",
  },
  streakCard: {
    minHeight: 76,
    marginTop: 12,
    padding: 14,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  streakIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  streakCopy: { flex: 1 },
  streakTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  streakDescription: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  streakDots: { flexDirection: "row", gap: 3 },
  streakDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.line,
  },
  streakDotActive: { backgroundColor: COLORS.primary },
  dailyRewardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  dailyRewardCopy: { flex: 1 },
  dailyRewardTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  dailyRewardDescription: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  dailyRewardAmount: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  walletBalanceCard: {
    minHeight: 130,
    padding: 20,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 25,
    backgroundColor: COLORS.text,
  },
  walletBalanceLabel: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  walletBalanceAmount: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.9,
    marginTop: 7,
  },
  walletBalanceUnit: { color: "rgba(255,255,255,0.60)", fontSize: 13 },
  walletBalanceIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(47,128,237,0.14)",
  },
  walletRewardRow: {
    minHeight: 74,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  walletRewardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  walletClaimButton: {
    minWidth: 60,
    height: 34,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 17,
    backgroundColor: COLORS.text,
  },
  walletClaimButtonDisabled: {
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  walletClaimText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  walletClaimTextDisabled: { color: COLORS.muted },
  walletFootnote: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 17,
  },
  walletSheet: { maxHeight: "90%" },
  walletScroll: { paddingBottom: 8 },
  transferCard: {
    borderRadius: 17,
    padding: 14,
    marginBottom: 17,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  transferCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  transferTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
  transferSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  transferStatus: {
    backgroundColor: "rgba(47,128,237,0.14)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  transferStatusText: { color: "#1D5FBF", fontSize: 9, fontWeight: "900" },
  transferHint: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  transferLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 15,
    marginBottom: 5,
  },
  transferValue: { color: COLORS.text, fontSize: 12, fontWeight: "700" },
  transferIban: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  transferReference: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  transferActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  transferAction: {
    flex: 1,
    minHeight: 36,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceHigh,
  },
  transferActionText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
  },
  transferOptionRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  transferOption: {
    minWidth: 59,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
  },
  transferOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  transferOptionText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "800",
  },
  transferOptionTextActive: { color: COLORS.primaryInk },
  transferQuickAmount: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceHigh,
  },
  transferQuickAmountText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "800",
  },
  transferInput: {
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceHigh,
    color: COLORS.text,
    paddingHorizontal: 12,
    marginTop: 9,
    fontSize: 13,
  },
  transferCreateButton: {
    minHeight: 47,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transferCreateButtonDisabled: { opacity: 0.6 },
  transferCreateButtonText: {
    color: COLORS.primaryInk,
    fontSize: 12,
    fontWeight: "900",
  },
  walletHistoryHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 1,
  },
  transferHistoryRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  transferHistoryIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceHigh,
  },
  transferHistoryStatus: {
    maxWidth: 78,
    fontSize: 9,
    fontWeight: "900",
    textAlign: "right",
  },
  communityFilters: { flexDirection: "row", gap: 8, marginTop: 17 },
  communityFilter: {
    height: 36,
    paddingHorizontal: 13,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  communityFilterActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  communityFilterText: { color: COLORS.muted, fontSize: 11, fontWeight: "800" },
  communityFilterTextActive: { color: COLORS.primaryInk },
  communityMeetings: {
    marginTop: 20,
    padding: 13,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  communityMeetingsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  communityMeetingsTitle: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  communityMeetingsCount: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
  },
  communityMeetingRow: {
    minHeight: 57,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  communityMeetingRowSaved: { backgroundColor: "rgba(47,128,237,0.05)" },
  communityMeetingDate: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  communityMeetingDay: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  communityMeetingHour: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  communityMeetingInfo: { flex: 1 },
  communityMeetingName: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  communityMeetingMeta: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  participantActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  participantBlockButton: {
    width: 31,
    height: 31,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 15,
    backgroundColor: "rgba(217,79,79,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,79,79,0.22)",
  },
  participantBlockButtonActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  safetyNotice: {
    padding: 14,
    marginBottom: 22,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  safetyNoticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  blockedUserRow: {
    minHeight: 58,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  blockedUserName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
  },
  unblockButton: {
    height: 32,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  unblockButtonText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  safetyEmpty: { alignItems: "center", paddingVertical: 24, gap: 8 },
  safetyEmptyText: { color: COLORS.muted, fontSize: 12 },
  safetyFootnote: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 16,
  },
  activityList: {
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  activityRow: {
    minHeight: 61,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  activityAvatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  activityAvatarText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  activityInfo: { flex: 1, minWidth: 0 },
  activityTitle: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  activityMeta: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  profileCoverActions: { flexDirection: "row", gap: 8 },
  badgeList: { flexDirection: "row", gap: 9 },
  badgeCard: {
    flex: 1,
    minHeight: 104,
    padding: 10,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    opacity: 0.72,
  },
  badgeCardUnlocked: {
    backgroundColor: COLORS.primarySoft,
    borderColor: "rgba(47,128,237,0.35)",
    opacity: 1,
  },
  badgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  badgeIconUnlocked: { backgroundColor: COLORS.primary },
  badgeTitle: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 8,
  },
  badgeTitleUnlocked: { color: COLORS.text },
  badgeStatus: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  profileBio: {
    maxWidth: 280,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 9,
  },
  pollCount: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: -15,
    marginBottom: 17,
  },
  pollOptions: { gap: 9 },
  pollOption: {
    minHeight: 51,
    paddingHorizontal: 13,
    borderRadius: 14,
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceRaised,
    position: "relative",
  },
  pollOptionVoted: { borderColor: "#537497" },
  pollProgress: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(47,128,237,0.16)",
  },
  pollOptionText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
    zIndex: 1,
    paddingRight: 42,
  },
  pollOptionValue: {
    position: "absolute",
    right: 13,
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  pollHint: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 16,
  },
  pollEmpty: { alignItems: "center", paddingVertical: 26 },
  pollEmptyTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 10,
  },
  walletActivityList: { marginBottom: 4 },
  walletActivityRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  walletActivityIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  walletActivityText: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  walletActivityTime: { color: COLORS.muted, fontSize: 9, marginTop: 2 },
  walletActivityAmount: { color: COLORS.pink, fontSize: 12, fontWeight: "900" },
  walletActivityPositive: { color: COLORS.primary },
  roomThemeList: { flexDirection: "row", gap: 8, marginBottom: 22 },
  roomThemeOption: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  roomThemeOptionSelected: {
    backgroundColor: COLORS.surfaceHigh,
    borderColor: COLORS.primary,
  },
  roomThemePreview: {
    width: "100%",
    height: 38,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  roomThemeDot: { width: 12, height: 12, borderRadius: 6 },
  roomThemeName: { color: COLORS.muted, fontSize: 9, fontWeight: "800" },
  roomThemeNameSelected: { color: COLORS.primary },
  agendaSheet: { maxHeight: "82%" },
  agendaSummary: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -14,
    marginBottom: 18,
  },
  agendaList: { gap: 10, paddingBottom: 16 },
  agendaCard: {
    minHeight: 78,
    padding: 12,
    borderRadius: 17,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  agendaCalendar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(47,128,237,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  agendaContent: { flex: 1, minWidth: 0 },
  agendaTitle: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
  agendaMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  agendaCategory: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    marginTop: 4,
  },
  agendaReminder: {
    width: 39,
    height: 39,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#4C5E73",
    alignItems: "center",
    justifyContent: "center",
  },
  agendaReminderActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  agendaActions: { alignItems: "center", gap: 7 },
  agendaCancel: {
    width: 32,
    height: 25,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,79,79,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,79,79,0.22)",
  },
  levelTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  levelPoints: { color: "#1D5FBF", fontSize: 9, fontWeight: "900" },
  levelProgressTrack: {
    height: 4,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: COLORS.line,
    marginTop: 8,
  },
  levelProgressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  followedHeading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  followedList: { gap: 10, paddingBottom: 2 },
  followedRoom: {
    width: 176,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  followedArtwork: {
    height: 98,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  followedLive: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(12,14,23,0.30)",
  },
  followedLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  followedLiveText: {
    color: "#FFFFFF",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  followedDetails: { paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11 },
  followedName: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
  followedTitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  followedMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  followedMetaText: { color: COLORS.primary, fontSize: 10, fontWeight: "900" },
  profileSocialSummary: {
    minHeight: 48,
    marginTop: 17,
    paddingHorizontal: 12,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.30)",
  },
  profileSocialIcon: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  profileSocialText: {
    flex: 1,
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "900",
  },
  profileSocialHint: {
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: "700",
  },
  chatHistoryHint: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  voiceReadiness: {
    minHeight: 58,
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  voiceReadinessDemo: {
    backgroundColor: COLORS.surfaceRaised,
    borderColor: COLORS.line,
  },
  voiceReadinessReady: {
    backgroundColor: "rgba(80,160,100,0.10)",
    borderColor: "rgba(80,160,100,0.28)",
  },
  voiceReadinessOffline: {
    backgroundColor: "rgba(217,79,79,0.08)",
    borderColor: "rgba(217,79,79,0.22)",
  },
  voiceReadinessText: { flex: 1 },
  voiceReadinessTitle: { color: COLORS.text, fontSize: 11, fontWeight: "900" },
  voiceReadinessDescription: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  featurePressable: { marginTop: 2 },
  featureCardModern: {
    minHeight: 234,
    overflow: "hidden",
    borderRadius: 27,
    padding: 18,
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  featureTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 1,
  },
  featureLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(20,13,34,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  featureLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  featureLiveLabel: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  featureCategoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  featureCategoryText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  featureModernContent: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: 17,
    zIndex: 1,
  },
  featureHost: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureHostLabel: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  featureHostName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  featureFooterModern: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 3,
  },
  featureJoinButton: {
    width: 37,
    height: 37,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  featureListenerBadge: {
    position: "absolute",
    right: 19,
    bottom: 19,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(10,11,24,0.30)",
    zIndex: 2,
  },
  featureSound: {
    position: "absolute",
    right: 20,
    bottom: 69,
    height: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    opacity: 0.82,
  },
  roomHeader: {
    minHeight: 72,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  roomIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  roomIdentityAvatar: {
    width: 42,
    height: 42,
    padding: 3,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  roomHeaderText: {
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    marginRight: 8,
  },
  roomHeaderEyebrow: {
    color: "#91BCFA",
    fontSize: 8,
    letterSpacing: 1.15,
    fontWeight: "900",
    marginBottom: 3,
  },
  roomHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 14.5,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  roomHeaderActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  roomAudienceButton: {
    minWidth: 42,
    height: 38,
    paddingHorizontal: 9,
    gap: 4,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(185,255,122,0.08)",
    borderWidth: 1,
    borderColor: "rgba(185,255,122,0.20)",
  },
  roomAudienceCount: { color: "#E6F0FF", fontSize: 11, fontWeight: "900" },
  liveActionBar: {
    minHeight: 55,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  handStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#46596F",
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: COLORS.surfaceRaised,
  },
  reactionTray: { flexDirection: "row", alignItems: "center", gap: 6 },
  reactionButton: {
    minWidth: 38,
    height: 32,
    paddingHorizontal: 7,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  roomScroll: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 116 },
  roomHero: {
    borderRadius: 30,
    overflow: "hidden",
    ...ELEVATION.card,
  },
  roomHeroGradient: {
    minHeight: 440,
    padding: 17,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  roomHeroGradientEmpty: { minHeight: 420 },
  roomHeroOrb: {
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: "rgba(207,255,143,0.14)",
    position: "absolute",
    top: -155,
    left: "-12%",
  },
  roomHeroHalo: {
    width: 235,
    height: 235,
    borderRadius: 118,
    backgroundColor: "rgba(119,101,255,0.21)",
    position: "absolute",
    right: -92,
    bottom: 64,
  },
  roomStageTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roomLive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(10,13,25,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  roomLiveText: {
    color: "#F5F5FA",
    fontSize: 9,
    letterSpacing: 0.9,
    fontWeight: "900",
  },
  roomStageSignature: {
    height: 32,
    minWidth: 62,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: "center",
    backgroundColor: "rgba(10,13,25,0.18)",
  },
  hostArea: { alignItems: "center", marginTop: 12, paddingBottom: 6 },
  hostCrown: {
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: -9,
    marginLeft: 59,
    zIndex: 1,
    borderWidth: 2,
    borderColor: COLORS.text,
  },
  hostName: {
    color: "#F5F5FA",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 10,
  },
  hostRole: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 9,
    letterSpacing: 1.25,
    fontWeight: "900",
    marginTop: 4,
  },
  voiceMeter: {
    height: 30,
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(15,16,27,0.21)",
  },
  meterBar: { width: 3, borderRadius: 3, backgroundColor: COLORS.primary },
  stageFollowButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: "rgba(8,11,23,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  stageFollowButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  stageFollowText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  stageFollowTextActive: { color: COLORS.primaryInk },
  seatGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: 10,
    rowGap: 15,
    marginTop: 10,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.16)",
  },
  seat: { width: "22%", alignItems: "center" },
  seatAvatar: {
    width: 53,
    height: 53,
    borderRadius: 27,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(16,18,32,0.44)",
    position: "relative",
  },
  seatAvatarSpeaking: {
    borderWidth: 3,
    borderColor: "#B4D0F5",
  },
  seatName: {
    color: "#F3F7FC",
    fontSize: 9.5,
    fontWeight: "800",
    marginTop: 7,
  },
  emptyStage: {
    alignItems: "center",
    marginTop: 18,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  emptyStageIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(13,15,27,0.22)",
    borderWidth: 1,
    borderColor: "rgba(212,255,137,0.25)",
  },
  emptyStageTitle: {
    color: "#F3F7FC",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 10,
  },
  emptyStageText: {
    color: "#D9E3EF",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 5,
    maxWidth: 230,
  },
  raiseHand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    marginTop: 13,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  raiseHandText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
  raiseHandActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  raiseHandTextActive: { color: COLORS.primary },
  chatPanel: {
    backgroundColor: COLORS.text,
    borderRadius: 23,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chatPanelHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 11,
  },
  chatPanelTitle: {
    color: "#BFC4D2",
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: "900",
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  composerGift: {
    width: 34,
    height: 34,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  roomControls: {
    minHeight: 96,
    paddingHorizontal: 7,
    paddingTop: 9,
    paddingBottom: Platform.OS === "ios" ? 14 : 21,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  roomControl: { width: 61, alignItems: "center" },
  roomControlIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.surfaceRaised,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  roomControlDanger: {
    backgroundColor: "rgba(217,79,79,0.10)",
    borderColor: "rgba(217,79,79,0.26)",
  },
  roomControlLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 5,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: COLORS.text,
    borderWidth: 0,
  },
  brandLogo: { width: "100%", height: "100%" },
  onboardingLogo: { width: 92, height: 92, borderRadius: 28 },
  roomVoiceStatus: {
    minHeight: 54,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 13,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  roomVoiceConnected: {
    backgroundColor: "rgba(80,160,100,0.12)",
    borderColor: "rgba(80,160,100,0.30)",
  },
  roomVoiceConnecting: {
    backgroundColor: COLORS.surfaceRaised,
    borderColor: COLORS.line,
  },
  roomVoiceError: {
    backgroundColor: "rgba(217,79,79,0.08)",
    borderColor: "rgba(217,79,79,0.26)",
  },
  roomVoiceLocal: {
    backgroundColor: COLORS.surfaceRaised,
    borderColor: COLORS.line,
  },
  roomVoiceStatusCopy: { flex: 1 },
  roomVoiceStatusTitle: { color: COLORS.text, fontSize: 11, fontWeight: "900" },
  roomVoiceStatusDescription: { color: "#B9BDCA", fontSize: 10, marginTop: 3 },
  roomVoiceRetry: {
    minHeight: 32,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: "rgba(47,128,237,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  roomVoiceRetryText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  followHostButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surfaceRaised,
  },
  followHostButtonActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  followHostText: { color: COLORS.text, fontSize: 11, fontWeight: "900" },
  followHostTextActive: { color: COLORS.primary },
  memberSheet: { maxHeight: "82%" },
  memberHint: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -14,
    marginBottom: 16,
  },
  memberList: { gap: 8, paddingBottom: 8 },
  memberRow: {
    minHeight: 62,
    padding: 10,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberInfo: { flex: 1, minWidth: 0 },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  memberRole: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  memberActions: { flexDirection: "row", gap: 5 },
  memberAction: {
    width: 31,
    height: 31,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.18)",
  },
  memberRemoveAction: {
    backgroundColor: "rgba(255,123,167,0.13)",
    borderColor: "rgba(255,123,167,0.26)",
  },
  messageRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  messageBody: { flex: 1 },
  messageReportButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  pendingMessage: { opacity: 0.58 },
  sendButtonDisabled: { opacity: 0.55 },
  topBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  discoverHeadingCopy: { flex: 1, minWidth: 0, justifyContent: "center" },
  discoverEyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 3,
  },
  discoverHeading: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 30,
  },
  discoverCreateButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  discoverEmptyHero: {
    minHeight: 390,
    borderRadius: 28,
    padding: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    justifyContent: "flex-end",
  },
  discoverEmptyGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(47,128,237,0.12)",
    top: -112,
    right: -92,
  },
  discoverEmptyArt: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 37,
  },
  discoverEmptySeat: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,128,237,0.14)",
    borderWidth: 2,
    borderColor: "rgba(47,128,237,0.45)",
    transform: [{ rotate: "-5deg" }],
  },
  discoverEmptySeatSide: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.20)",
    transform: [{ rotate: "5deg" }],
  },
  discoverEmptyCopy: { marginBottom: 22 },
  discoverEmptyLabel: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 9,
  },
  discoverEmptyTitle: {
    color: "#F3F7FC",
    fontSize: 30,
    lineHeight: 35,
    fontWeight: "900",
    letterSpacing: -0.9,
    marginBottom: 8,
  },
  discoverEmptyDescription: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 21,
  },
  discoverEmptyButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  discoverEmptyButtonText: {
    color: COLORS.primaryInk,
    fontSize: 15,
    fontWeight: "900",
  },
  discoverEmptyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 18,
    paddingHorizontal: 6,
  },
  discoverEmptyNoteText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    position: "relative",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  kicker: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginBottom: 8,
  },
  heroHeading: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1.3,
    lineHeight: 37,
  },
  newRoomButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  newRoomText: {
    color: COLORS.primaryInk,
    fontSize: 14,
    fontWeight: "900",
  },
  discoverLiveSummary: {
    minHeight: 94,
    marginTop: 22,
    paddingVertical: 16,
    paddingLeft: 17,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderRadius: 23,
    backgroundColor: COLORS.text,
    borderWidth: 0,
    ...ELEVATION.card,
  },
  discoverLiveCopy: { flex: 1, minWidth: 0 },
  discoverLiveLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 7,
  },
  discoverLiveLabelText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  discoverLiveTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: -0.35,
  },
  discoverLiveCount: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,128,237,0.14)",
  },
  discoverLiveNumber: {
    color: COLORS.primary,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "900",
  },
  discoverLiveCountText: {
    color: "rgba(47,128,237,0.80)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginTop: 1,
  },
  featurePressable: { marginTop: 3 },
  featureCardModern: {
    minHeight: 210,
    overflow: "hidden",
    borderRadius: 26,
    padding: 20,
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  featureTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    letterSpacing: -0.8,
    fontWeight: "900",
    marginBottom: 6,
    maxWidth: "100%",
  },
  featureSubtitle: {
    color: "#EDF3FA",
    fontSize: 14,
    lineHeight: 19,
    maxWidth: "100%",
  },
  featureListenerText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 10,
  },
  featureSound: {
    position: "absolute",
    right: 23,
    bottom: 25,
    height: 48,
    justifyContent: "center",
  },
  featureListeners: { color: "#F3F7FC", fontSize: 12, fontWeight: "800" },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 23,
    marginBottom: 12,
  },
  categoryChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 15,
    paddingHorizontal: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  categoryText: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },
  listCount: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  roomList: { gap: 13 },
  discoverListHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 16,
  },
  discoverListTitle: { marginTop: 0, marginBottom: 2 },
  roomGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    marginTop: 14,
  },
  roomGridItem: { width: "48.2%" },
  roomCard: {
    borderRadius: 22,
    backgroundColor: COLORS.surfaceRaised,
    padding: 7,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
    position: "relative",
    ...ELEVATION.card,
  },
  roomCardPressed: { opacity: 0.82, transform: [{ scale: 0.987 }] },
  roomCardMain: { flex: 1 },
  roomArtwork: {
    width: "100%",
    height: 166,
    borderRadius: 17,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  roomArtworkOrb: {
    position: "absolute",
    width: 155,
    height: 155,
    borderRadius: 78,
    right: -59,
    bottom: -54,
    opacity: 0.57,
  },
  roomArtworkRing: {
    position: "absolute",
    width: 123,
    height: 123,
    borderRadius: 62,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    top: 20,
    right: -22,
  },
  roomArtworkTop: {
    position: "absolute",
    top: 9,
    left: 9,
    right: 9,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  roomArtworkLive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(13,17,25,0.65)",
  },
  roomArtworkLiveText: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  roomArtworkCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(13,17,25,0.65)",
  },
  roomArtworkCountText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  roomArtworkMonogram: { alignItems: "center", marginBottom: 13 },
  roomArtworkInitial: {
    color: "rgba(255,255,255,0.91)",
    fontSize: 37,
    fontWeight: "900",
    letterSpacing: -1,
  },
  roomArtworkTitle: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 11,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 5,
  },
  roomDetails: { paddingHorizontal: 3, paddingTop: 10, paddingBottom: 4 },
  roomHostRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  roomHostName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },
  roomTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 5,
  },
  roomName: {
    flexShrink: 1,
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  livePill: {
    minHeight: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.primarySoft,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.30)",
  },
  livePillText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  roomDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  listenerCount: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  roomCategoryPill: {
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.18)",
  },
  roomCategory: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 6,
    marginLeft: 1,
  },
  roomJoinIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    marginLeft: 3,
  },
  favoriteButton: {
    position: "absolute",
    right: 15,
    top: 45,
    width: 31,
    height: 31,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "rgba(13,17,25,0.68)",
    zIndex: 2,
  },
  favoriteButtonActive: { backgroundColor: "rgba(255,123,167,0.22)" },
  bottomNavigation: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    ...ELEVATION.raised,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 6,
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemInner: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },
  tabItemActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: "rgba(47,128,237,0.20)",
  },
  tabItemPressed: {
    backgroundColor: "rgba(47,128,237,0.06)",
  },
  tabLabel: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    marginTop: 3,
    textAlign: "center",
  },
  tabLabelActive: {
    color: COLORS.primary,
    fontWeight: "900",
  },
  profileCover: {
    marginHorizontal: -20,
    height: 188,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 15,
    justifyContent: "space-between",
  },
  profileCoverOrbOne: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    top: -118,
    right: -52,
    backgroundColor: "rgba(47,128,237,0.16)",
  },
  profileCoverOrbTwo: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    bottom: -93,
    left: 58,
    backgroundColor: "rgba(166,105,255,0.36)",
  },
  profileCoverBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 47,
  },
  profileCoverLogo: {
    width: 47,
    height: 47,
    borderRadius: 16,
    backgroundColor: "#050509",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  profileCoverBrandText: {
    color: "#FFFFFF",
    fontSize: 13,
    letterSpacing: 1.2,
    fontWeight: "900",
  },
  profileCoverBrandSubtext: { color: "#D5D1EA", fontSize: 12, marginTop: 3 },
  profileCoverActions: {
    position: "absolute",
    right: 20,
    top: 14,
    flexDirection: "row",
    gap: 8,
  },
  profileSummary: { marginTop: -49, alignItems: "center" },
  profileAvatarShell: {
    padding: 4,
    borderRadius: 34,
    backgroundColor: COLORS.background,
  },
  profileNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  profileName: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  profileVerified: {
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  handle: { color: COLORS.muted, fontSize: 14, marginTop: 4 },
  profileBio: {
    maxWidth: 310,
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 10,
  },
  profileStats: {
    flexDirection: "row",
    marginTop: 23,
    width: "100%",
    gap: 10,
    justifyContent: "center",
  },
  profileStat: {
    minWidth: 88,
    minHeight: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileStatNumber: { color: COLORS.text, fontSize: 19, fontWeight: "900" },
  profileStatLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  profileLevel: {
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.22)",
  },
  levelTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 5,
  },
  levelDescription: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  profileSection: {
    color: COLORS.muted,
    fontSize: 12,
    letterSpacing: 1.15,
    fontWeight: "900",
    marginTop: 29,
    marginBottom: 10,
  },
  actionList: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  actionRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceHigh,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTitle: { flex: 1, color: COLORS.text, fontSize: 15, fontWeight: "800" },
  authBoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
  },
  authBootLogo: { width: 120, height: 120, borderRadius: 38 },
  authBootText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 14,
  },
  roomHeaderActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  roomFloatingControls: {
    position: "absolute",
    right: 18,
    bottom: 22,
    gap: 8,
    alignItems: "center",
  },
  roomFloatingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,21,37,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    ...ELEVATION.card,
  },
  roomFloatingButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  emptySeat: { justifyContent: "flex-start" },
  emptySeatAvatar: {
    width: 53,
    height: 53,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,128,237,0.10)",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(47,128,237,0.55)",
  },
  stageHint: {
    color: "rgba(255,255,255,0.79)",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: 14,
  },
  createRoomSheetScroll: { flexGrow: 0, maxHeight: "92%", width: "100%" },
  createRoomSheetContent: { flexGrow: 1, justifyContent: "flex-end" },
  createRoomSheet: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderColor: COLORS.line,
  },


  roomHeaderRoom: {
    flex: 1,
    minWidth: 0,
  },
  roomHostStageSlot: {
    width: "100%",
    minHeight: 106,
    paddingTop: 0,
    paddingBottom: 0,
  },
  roomHostStageAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
  },
  roomHostStageInitial: {
    fontSize: 28,
  },
  roomConnectionNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 4,
    flexWrap: "wrap",
  },
  roomConnectionText: {
    color: "#A9BEDB",
    fontSize: 9,
    fontWeight: "600",
  },
  roomComposerDock: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: "rgba(11,15,23,0.92)",
  },
  roomAtmosphereSparkle: {
    position: "absolute",
    right: "16%",
    top: "30%",
  },
  /* ══ WePlay / Hazan tarzı oda ekranı (koyu tema) ══════════════════ */
  roomHeaderBrand: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  roomHeaderBrandText: {
    color: "#F3F7FF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  roomHeaderDivider: {
    width: 1,
    height: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginHorizontal: 2,
  },
  roomHeaderCaption: {
    color: "#A9BEDB",
    fontSize: 11,
    fontWeight: "500",
  },
  roomRoomMeta: { flex: 1, minWidth: 0 },
  roomInlineTitle: {
    color: "#F5F8FF",
    fontSize: 15,
    fontWeight: "800",
  },
  roomInlineDetails: {
    color: "#A9BEDB",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  roomPeoplePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  roomPeopleText: {
    color: "#C5D4E8",
    fontSize: 11,
    fontWeight: "600",
  },
  roomStageGlow: {
    position: "absolute",
    top: 4,
    alignSelf: "center",
    width: "92%",
    height: 240,
    borderRadius: 150,
    opacity: 0.9,
  },
  roomSectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  roomSpeakerRole: {
    color: "#A9C9F4",
    fontSize: 9,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(47,128,237,0.13)",
  },
  roomEmptySeatLabel: {
    color: "#C6D9F4",
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(47,128,237,0.16)",
  },
  roomSpeakerSlotHost: {
    backgroundColor: "rgba(47,128,237,0.045)",
  },
  roomChatHeading: {
    flex: 1,
  },
  roomChatIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,128,237,0.12)",
  },
  roomChatClear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  roomMicControl: {
    flex: 1.8,
  },
  roomSpeakerControlOn: {
    backgroundColor: "rgba(47,128,237,0.18)",
  },
  roomLeaveLabel: {
    color: "#F3A9AC",
    fontSize: 9,
    fontWeight: "700",
  },
  roomScreen: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  roomTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  roomTopBarBack: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roomTopBarMore: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roomTopBarCategory: {

    color: "#76AFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  roomTopBarTitle: {
    flexShrink: 1,
    color: "#F3F7FF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0,
  },
  roomLiveBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  roomRetryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(47,128,237,0.16)",
  },
  roomRetryText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  speakingRing: {
    position: "absolute",
    borderWidth: 2,
  },
  roomIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
  },
  roomIdAvatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(118,175,255,0.28)",
  },
  roomIdAvatarGrad: {
    ...StyleSheet.absoluteFill,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  roomIdInitial: {
    color: "#F4F7ED",
    fontSize: 24,
    fontWeight: "900",
  },
  roomIdLiveDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: "#11131A",
  },
  roomIdCopy: { flex: 1 },
  roomIdTopic: {
    color: "#A9BEDB",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  roomSurface: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  roomChatScroll: {
    flex: 1,
    minHeight: 72,
  },
  roomChatScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 10,
  },
  roomBody: {
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 8,
    gap: 10,
  },
  roomStage: {
    width: "100%",
  },
  roomAvatarWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  roomSpeakerAvatarHost: { borderColor: "rgba(118,175,255,0.9)" },
  roomSpeakerCrown: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#76AFFF",
  },
  roomStageActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  roomAudienceSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  roomChatSection: {

    marginTop: 12,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 104,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  roomHostSlot: { alignItems: "center", marginBottom: 22 },
  roomHostAvatarWrap: { alignItems: "center", justifyContent: "center" },
  roomSpeakingRing: {
    position: "absolute",
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 2,
    borderColor: "#76AFFF",
  },
  roomHostAvatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(118,175,255,0.9)",
  },
  roomHostInitial: { color: "#11131A", fontSize: 30, fontWeight: "900" },
  roomHostCrown: {
    position: "absolute",
    top: -6,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B1E27",
    borderWidth: 1,
    borderColor: "rgba(118,175,255,0.7)",
  },
  roomStageHostName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 10,
  },
  roomHostTag: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  roomFollowBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    minHeight: 44,
    justifyContent: "center",
  },
  roomFollowBtnActive: {
    backgroundColor: "rgba(47,128,237,0.16)",
    borderColor: "rgba(118,175,255,0.6)",
  },
  roomFollowBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  roomFollowBtnTextActive: { color: COLORS.primary },
  roomSpeakerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: 0,
    rowGap: 10,
    width: "100%",
  },
  roomSpeakerSlot: {
    width: "25%",
    minHeight: 84,
    alignItems: "center",
    paddingVertical: 4,
    gap: 5,
  },
  roomSpeakerAvatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(118,175,255,0.42)",
  },
  roomSpeakerAvatarActive: { borderColor: COLORS.primary },
  roomSpeakerInitial: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  roomMicOnBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  roomMicOffBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D2E43",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  roomSpeakerName: {
    color: "#F1F2EE",
    fontSize: 11,
    fontWeight: "700",
    maxWidth: "100%",
  },

  roomEmptySeat: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37,62,98,0.75)",
    borderWidth: 1.5,
    borderColor: "rgba(118,175,255,0.3)",
    shadowColor: "#2F80ED",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  roomHandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 13,
    flex: 1,
    backgroundColor: "rgba(47,128,237,0.15)",
    borderWidth: 1,
    borderColor: "rgba(118,175,255,0.28)",
  },
  roomHandBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  roomHandBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  roomChatBox: {
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  roomChatHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  roomChatTitle: {
    color: "#F3F5F1",
    fontSize: 15,
    fontWeight: "800",
  },
  roomChatCount: {
    flex: 1,
    color: "#A2AFB9",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  roomControlBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "rgba(11,16,28,0.96)",
    borderTopWidth: 1,
    borderColor: "rgba(118,175,255,0.1)",
  },
  roomCtrlBtn: {
    flex: 1,
    minHeight: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  roomCtrlIconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.055)",
  },
  roomCtrlIconBubbleActive: {
    backgroundColor: COLORS.primary,
    borderColor: "rgba(118,175,255,0.75)",
  },
  roomCtrlIconBubbleOn: {
    backgroundColor: "rgba(47,128,237,0.22)",
    borderColor: "rgba(118,175,255,0.24)",
  },
  roomLeaveIconBubble: {
    backgroundColor: "rgba(227,102,108,0.11)",
    borderColor: "rgba(227,102,108,0.17)",
  },
  roomCtrlLabel: {
    color: "#AFC0D6",
    fontSize: 9,
    fontWeight: "700",
  },
  roomCtrlLabelActive: { color: "#8BB8F5" },
  roomLeaveBtn: {
    flex: 1,
    minHeight: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  roomTopic: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  roomAudienceCard: {
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  roomAudienceRow: { gap: 14, paddingRight: 8 },
  roomAudienceItem: { alignItems: "center", gap: 6, width: 56 },
  roomAudienceAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
  },
  roomAudienceInitial: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  roomAudienceCrown: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  roomAudienceName: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontWeight: "700",
  },
  roomOverlay: {
    flex: 1,
    backgroundColor: "#11131A",
    zIndex: 200,
    elevation: 200,
  },
  roomOverlayMinimized: {
    opacity: 0,
    zIndex: -1,
    elevation: 0,
  },
  roomBubble: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    zIndex: 60,
  },
  roomBubbleAvatar: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  roomBubbleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  roomBubbleInitial: { color: "#11131A", fontSize: 20, fontWeight: "900" },
  roomBubbleLive: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  roomBubbleClose: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,79,79,0.95)",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  participantSheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    marginBottom: 12,
  },
  participantSheetAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  participantSheetInitial: { color: "#11131A", fontSize: 20, fontWeight: "900" },
  participantSheetInfo: { flex: 1 },
  participantSheetName: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
  participantSheetRole: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  participantProfileButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
  },
  participantProfileButtonText: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
  },
  // Koyu oda içinde sohbet metinleri okunur olsun.
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 10,
  },
  messageList: { minHeight: 44, gap: 8, paddingBottom: 10 },
  systemMessage: { color: "#9AAEB2", fontStyle: "normal", fontSize: 11, lineHeight: 18 },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  composerGift: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#10171E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    color: "#F3F5F1",
    fontSize: 13,
  },
  messageText: { color: "#D3DCDF", fontSize: 13, lineHeight: 20 },
  messageUser: { color: "#FFFFFF", fontWeight: "900" },
  messageReportButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  /* ══ WePlay / Hazan tarzı profil ekranı ══════════════════════════ */
  profileHomeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 4,
  },
  profileHomeIdentity: {
    flex: 1,
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileHomePressed: { opacity: 0.82 },
  profileHomeAvatarWrap: { position: "relative" },
  profileHomeLevelBadge: {
    position: "absolute",
    right: -3,
    bottom: -2,
    minWidth: 28,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  profileHomeLevelText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  profileHomeCopy: { flex: 1, gap: 2 },
  profileHomeName: { color: COLORS.text, fontSize: 17, fontWeight: "900" },
  profileHomeHandle: { color: COLORS.mutedDark, fontSize: 12, fontWeight: "700" },
  profileHomeBio: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  profileShareButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileMetricsRow: {
    flexDirection: "row",
    marginTop: 13,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileMetric: { flex: 1, alignItems: "center", paddingVertical: 7 },
  profileMetricNumber: { color: COLORS.text, fontSize: 20, fontWeight: "900" },
  profileMetricLabel: { color: COLORS.muted, fontSize: 10, fontWeight: "700", marginTop: 2 },
  profileBannerRow: { flexDirection: "row", gap: 10, marginTop: 13 },
  profileBannerButton: { flex: 1 },
  profileBanner: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 17,
    overflow: "hidden",
  },
  profileBannerCopy: { flex: 1 },
  profileBannerTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  profileBannerCaption: { color: "rgba(255,255,255,0.78)", fontSize: 10, fontWeight: "700", marginTop: 4 },
  profileLevelSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginTop: 12,
    padding: 13,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailScreen: { flex: 1, backgroundColor: COLORS.background },
  profileDetailCover: {
    height: 284,
    paddingHorizontal: 18,
    paddingBottom: 24,
    justifyContent: "space-between",
    overflow: "visible",
    zIndex: 2,
    elevation: 2,
  },
  profileDetailOrb: {
    position: "absolute",
    width: 290,
    height: 290,
    borderRadius: 145,
    right: -112,
    top: -110,
  },
  profileDetailTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileDetailTopActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  profileDetailBrand: {
    position: "absolute",
    left: 24,
    top: 112,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    opacity: 0.72,
  },
  profileDetailBrandTitle: {
    color: "rgba(255,255,255,0.32)",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 4,
  },
  profileDetailBrandCaption: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: 1,
  },
  profileDetailIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  profileDetailCoverBottom: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: -18,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    zIndex: 3,
    elevation: 3,
  },
  profileDetailAvatarRing: {
    padding: 5,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 24,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  profileDetailStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#FFFFFF" },
  profileDetailStatusText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  profileDetailIdentity: {
    marginHorizontal: 12,
    marginTop: -3,
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 18,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  profileDetailName: { color: COLORS.text, fontSize: 22, fontWeight: "900", flexShrink: 1 },
  profileLevelInlinePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(47,128,237,0.12)",
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.28)",
  },
  profileLevelInlineText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  profileBadgeTierChip: {
    maxWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(47,128,237,0.10)",
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.24)",
  },
  profileBadgeTierChipText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  profileDetailLevelCard: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailLevelTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileDetailLevelTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "900",
  },
  profileDetailLevelBadgeName: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  profileDetailLevelTrack: {
    height: 7,
    borderRadius: 99,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
    marginTop: 12,
  },
  profileDetailLevelFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: COLORS.primary,
  },
  profileDetailHandle: { color: COLORS.mutedDark, fontSize: 13, fontWeight: "700", marginTop: 5 },
  profileDetailRoleRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  profileDetailRoleText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  profileDetailTabs: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  profileDetailTab: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center" },
  profileDetailTabActive: { borderBottomWidth: 3, borderBottomColor: COLORS.primary },
  profileDetailTabText: { color: COLORS.muted, fontSize: 14, fontWeight: "800" },
  profileDetailTabTextActive: { color: COLORS.text },
  profileDetailSection: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 18,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailSectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900", marginBottom: 12 },
  profileDetailBio: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21 },
  profileDetailLoading: { color: COLORS.muted, fontSize: 12, marginTop: 10 },
  profileDetailInfoRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  profileDetailInfoCopy: { flex: 1 },
  profileDetailInfoTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  profileDetailInfoCaption: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  profileDetailActions: { marginHorizontal: 16, marginTop: 14, gap: 9 },
  profileDetailFollowButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
  },
  profileDetailFollowText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  profileDetailSafetyActions: { flexDirection: "row", gap: 9 },
  profileDetailSafetyButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailSafetyText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "800" },
  /* ══ WePlay / Hazan tarzı profil ekranı ══════════════════════════ */
  pfCover: {
    height: 178,
    borderRadius: 26,
    overflow: "hidden",
    padding: 16,
    justifyContent: "space-between",
  },
  pfCoverOrbOne: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(47,128,237,0.22)",
  },
  pfCoverOrbTwo: {
    position: "absolute",
    bottom: -50,
    left: -20,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(124,92,191,0.26)",
  },
  pfCoverTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pfBrandChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pfBrandLogo: { width: 20, height: 20, borderRadius: 6 },
  pfBrandChipText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  pfCoverActions: { flexDirection: "row", gap: 8 },
  pfCoverBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pfCoverStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pfCoverStatText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  pfIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  pfIdentity: { alignItems: "center", marginTop: -46, paddingHorizontal: 12 },
  pfAvatarWrap: { position: "relative" },
  pfAvatarRing: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  pfLevelBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    minWidth: 32,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderWidth: 3,
    borderColor: COLORS.background,
  },
  pfLevelBadgeText: {
    color: COLORS.primaryInk,
    fontSize: 10,
    fontWeight: "900",
  },
  pfName: { color: COLORS.text, fontSize: 22, fontWeight: "900", marginTop: 12 },
  pfHandle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  pfBio: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 10,
  },
  pfIdentityActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  pfPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  pfPrimaryBtnText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },
  pfSecondaryBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.text,
  },
  pfStatsStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    ...ELEVATION.card,
  },
  pfStatDivider: { width: 1, height: 28, backgroundColor: COLORS.line },
  pfLevelCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    ...ELEVATION.card,
  },
  pfLevelHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  pfLevelIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(236,208,109,0.18)",
  },
  pfLevelInfo: { flex: 1 },
  pfLevelTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
  pfLevelDesc: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  pfLevelPoints: { color: "#1D5FBF", fontSize: 12, fontWeight: "900" },
  pfProgressTrack: {
    height: 8,
    borderRadius: 999,
    marginTop: 12,
    backgroundColor: COLORS.surfaceHigh,
    overflow: "hidden",
  },
  pfProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  pfChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  pfChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  pfChipAccent: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pfChipText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  pfChipTextAccent: { color: COLORS.primaryInk },
  pfSection: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 26,
    marginBottom: 10,
  },
  pfBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    gap: 8,
  },
  pfBadgeGridLevel: {
    flexGrow: 0,
    flexShrink: 0,
    width: "31.5%",
  },
  pfBadgeGridAchievement: {
    flexGrow: 0,
    flexShrink: 0,
    width: "48.2%",
  },
  pfBadge: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  pfBadgeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceHigh,
  },
  pfBadgeIconOn: { backgroundColor: COLORS.primary },
  pfBadgeMedal: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  pfBadgeMedalInner: {
    width: "100%",
    height: "100%",
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.45)",
  },
  pfBadgeLock: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#8190A2",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pfBadgeHint: { color: COLORS.muted, fontSize: 10, fontWeight: "600", marginTop: -4 },
  pfBadgeText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  pfActivityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  pfActivityAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  pfActivityAvatarText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  pfActivityInfo: { flex: 1 },
  pfActivityTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  pfActivityMeta: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  pfTabs: {
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
    padding: 5,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceHigh,
  },
  pfTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 14,
  },
  pfTabActive: {
    backgroundColor: COLORS.surface,
    ...ELEVATION.card,
  },
  pfTabText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "800" },
  pfTabTextActive: { color: COLORS.text },
  pfTabBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primarySoft,
  },
  pfTabBadgeText: { color: COLORS.primary, fontSize: 11, fontWeight: "900" },
  pfEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  pfEmptyText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  pfMenu: {
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    overflow: "hidden",
  },
  pfMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
  },
  pfMenuIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceRaised,
  },
  pfMenuTitle: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "800" },

  /* ══ Oda: bütünleşik sohbet, alt bar ve oda sahibi kontrolleri ═════ */
  roomTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  roomHeaderFollowPill: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: "rgba(156,198,255,0.45)",
  },
  roomHeaderFollowPillActive: {
    backgroundColor: "rgba(118,175,255,0.16)",
    borderColor: "rgba(118,175,255,0.38)",
  },
  roomHeaderFollowText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  roomHeaderFollowTextActive: {
    color: "#9CC6FF",
  },
  selfSheetProfileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    marginBottom: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  selfSheetProfilePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.primarySoft,
  },
  selfSheetProfilePillText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  selfSheetLeaveMicBtn: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 2,
    borderRadius: 14,
    backgroundColor: "rgba(217,79,92,0.1)",
    borderWidth: 1,
    borderColor: "rgba(217,79,92,0.24)",
  },
  selfSheetLeaveMicText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: "800",
  },
  roomTopBarLeave: {
    backgroundColor: "rgba(227,102,108,0.12)",
    borderColor: "rgba(227,102,108,0.2)",
  },
  roomTopBarBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.danger,
    borderWidth: 2,
    borderColor: "#0B0F17",
  },
  roomTopBarBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  roomHostSeatRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    width: "100%",
    marginBottom: 10,
  },
  roomHostPairSlot: { width: "36%" },
  roomSpeakerGridCompact: { rowGap: 4 },
  roomSpeakerSlotCompact: { minHeight: 76, paddingVertical: 2, gap: 4 },
  roomAdminBadge: { backgroundColor: "#9CD3FF" },
  roomChatFlow: {
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 6,
  },
  roomChatStatus: {
    color: "#8FA6C4",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 6,
  },
  messageList: { gap: 6, paddingBottom: 4 },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  messageBubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    maxWidth: "88%",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(6,11,22,0.42)",
  },
  messageBubbleSystem: { backgroundColor: "rgba(47,128,237,0.13)" },
  messageBubbleAnnouncement: {
    backgroundColor: "rgba(47,128,237,0.2)",
    borderWidth: 1,
    borderColor: "rgba(118,175,255,0.28)",
  },
  messageAnnouncementIcon: { marginTop: 3, marginRight: 6 },
  messageText: { flexShrink: 1, color: "#DCE5F0", fontSize: 13, lineHeight: 19 },
  systemMessage: { color: "#A9C3E4", fontStyle: "normal", fontSize: 12, lineHeight: 18 },
  announcementMessage: { color: "#E6F0FF", fontWeight: "700" },
  messageReportButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  roomBottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: "rgba(9,14,25,0.94)",
    borderTopWidth: 1,
    borderColor: "rgba(118,175,255,0.08)",
  },
  roomInputPill: {
    flex: 1,
    minWidth: 0,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  roomInputField: {
    flex: 1,
    minWidth: 0,
    height: 42,
    paddingVertical: 0,
    color: "#F3F5F1",
    fontSize: 13,
  },
  roomInputSend: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  roomBarButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  roomBarButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: "rgba(118,175,255,0.75)",
  },
  roomBarButtonPending: {
    backgroundColor: "rgba(47,128,237,0.22)",
    borderColor: "rgba(118,175,255,0.45)",
  },
  roomBarButtonMuted: {
    backgroundColor: "rgba(227,102,108,0.12)",
    borderColor: "rgba(227,102,108,0.2)",
  },
  roomBarButtonOn: {
    backgroundColor: "rgba(47,128,237,0.2)",
    borderColor: "rgba(118,175,255,0.35)",
  },
  roomBarGift: {
    backgroundColor: "#3D7FE0",
    borderColor: "rgba(156,198,255,0.45)",
  },
  profileStaffSection: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileStaffGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  profileStaffButton: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
  },
  profileStaffButtonDanger: { backgroundColor: "rgba(217,79,92,0.08)" },
  profileStaffButtonText: { flex: 1, color: COLORS.text, fontSize: 12, fontWeight: "800" },
  userLevelHeroCard: {
    padding: 18,
    borderRadius: 22,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(120,175,255,0.28)",
  },
  userLevelHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  userLevelHeroTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  userLevelHeroXp: {
    color: "#BFD6F6",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  userLevelProgressTrack: {
    height: 9,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    marginTop: 15,
  },
  userLevelProgressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "#63B3FF",
  },
  userLevelHeroNext: {
    color: "#D8E7FC",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
  },
  userLevelSyncBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  userLevelSyncText: {
    color: "#EAF3FF",
    fontSize: 11,
    fontWeight: "800",
  },
  userTierCard: {
    width: 112,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  userTierCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: "#EDF4FF",
  },
  userTierRange: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 8,
  },
  userTierTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "center",
  },
  userTierState: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },
  evenRewardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  evenRewardRowClaimed: {
    backgroundColor: "#F0F6FF",
    borderColor: "rgba(47,128,237,0.28)",
  },
  evenRewardRowNext: {
    backgroundColor: "#EDF4FF",
    borderColor: COLORS.primary,
  },
  evenRewardLevel: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
  },
  evenRewardMilestoneChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(47,128,237,0.14)",
  },
  evenRewardMilestoneText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
  },
  evenRewardCoins: {
    color: "#3F5876",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  evenRewardStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  evenRewardStatusClaimed: {
    backgroundColor: "rgba(47,128,237,0.12)",
    borderColor: "rgba(47,128,237,0.32)",
  },
  evenRewardStatusNext: {
    backgroundColor: "rgba(47,128,237,0.16)",
    borderColor: COLORS.primary,
  },
  evenRewardStatusText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  roomGiftSheet: {
    maxHeight: "86%",
    paddingHorizontal: 18,
    paddingTop: 22,
  },
  roomGiftHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    flexShrink: 0,
  },
  roomGiftSheetTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  roomGiftHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  roomGiftCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  roomGiftRecipientWrap: {
    flexShrink: 0,
    minHeight: 84,
    marginBottom: 12,
  },
  roomGiftRecipientRow: {
    gap: 10,
    paddingVertical: 2,
    paddingRight: 6,
  },
  roomGiftRecipientCard: {
    width: 78,
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  roomGiftRecipientCardActive: {
    backgroundColor: "#EDF4FF",
    borderColor: COLORS.primary,
  },
  roomGiftAvatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  roomGiftAvatarRingActive: {
    borderColor: COLORS.primary,
  },
  roomGiftRecipientCheck: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  roomGiftRecipientName: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 5,
    textAlign: "center",
  },
  roomGiftRecipientNameActive: {
    color: COLORS.primary,
  },
  roomGiftCategoryRow: {
    gap: 8,
    paddingVertical: 6,
    marginBottom: 6,
  },
  roomGiftCategoryPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  roomGiftCategoryPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roomGiftCategoryText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  roomGiftCategoryTextActive: {
    color: "#FFFFFF",
  },
  roomGiftGrid3: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  roomGiftGridCard: {
    width: "31.6%",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1.5,
    borderColor: COLORS.line,
  },
  roomGiftGridCardActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primary,
  },
  roomGiftQtyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    flexShrink: 0,
  },
  roomGiftQtyRow: {
    flexDirection: "row",
    gap: 5,
  },
  roomGiftQtyPill: {
    paddingHorizontal: 9,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
  },
  roomGiftQtyPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roomGiftQtyText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  roomGiftQtyTextActive: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  roomGiftSendBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    flexShrink: 0,
  },
  roomGiftSendTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
  },
  roomGiftSendSub: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  roomGiftSendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 42,
    paddingHorizontal: 20,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
  },
  roomGiftSendBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  roomRootWrap: {
    flex: 1,
    position: "relative",
  },
  roomMessageAvatarPress: {
    marginTop: 2,
    marginRight: 7,
  },
  messageBubbleGift: {
    borderColor: "rgba(99,179,255,0.38)",
    backgroundColor: "rgba(23,46,84,0.78)",
  },
});
