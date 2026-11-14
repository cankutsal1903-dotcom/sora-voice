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
  Easing,
  Image,
  KeyboardAvoidingView,
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
  claimDailyReward as claimRemoteDailyReward,
  createRoom as createRemoteRoom,
  deleteRoom as deleteRemoteRoom,
  getHostedRoom,
  getPublicProfile,
  getRoom,
  getCurrentAdminRole,
  getWallet,
  joinRoomMembership,
  listBlockedUsers,
  listFollowedUserIds,
  listRoomMembers,
  listRoomMessages,
  listRooms,
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
  updateRoom as updateRemoteRoom,
} from "./src/data/soraRepository";
import {
  AdminPanelSheet,
  ReportSheet,
  SafetyCenterSheet as SecureSafetyCenterSheet,
} from "./src/security/SafetySheets";
import { createMessageGuard } from "./src/security/contentFilter";
import { moderateLiveParticipant } from "./src/voice/roomModeration";
import {
  configureNotificationChannel,
  registerPushToken,
} from "./src/notifications/pushTokenManager";
import {
  cancelReminder,
  clearAllReminders,
  scheduleReminder,
} from "./src/notifications/localReminders";
import { AudioBars, BrandLaunch, LivePulse, Reveal } from "./src/ui/Motion";
import { installGlobalErrorReporting } from "./src/observability/errorReporting";
import { InboxScreen } from "./src/screens/InboxScreen";
import { CommunityScreen } from "./src/screens/CommunityScreen";
import { COLORS as APP_COLORS } from "./src/theme/colors";

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
  { name: "Tumu", label: "Tumu", icon: "apps-outline" },
  { name: "Sohbet", label: "Sohbet", icon: "chatbubbles-outline" },
  { name: "Muzik", label: "Muzik", icon: "musical-notes-outline" },
  { name: "Oyun", label: "Oyun", icon: "game-controller-outline" },
  { name: "Gece", label: "Gece", icon: "moon-outline" },
];

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

const GIFT_CATALOG = [
  { id: "clap", icon: "sparkles", name: "Alkis", cost: 15, color: "#6AA8F5" },
  { id: "heart", icon: "heart", name: "Kalp", cost: 40, color: "#2F80ED" },
  { id: "crown", icon: "crown", name: "Tac", cost: 120, color: "#1D5FBF" },
  { id: "rocket", icon: "rocket", name: "Roket", cost: 300, color: "#8CC8FF" },
];
const createRequestUuid = () => {
  return globalThis.crypto?.randomUUID?.() || `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const PROFILE_ITEM_APPEARANCE = {
  frame_sky: { color: "#58A0F0", width: 3 },
  frame_amber: { color: "#2F80ED", width: 3 },
  frame_lilac: { color: "#7C9ED4", width: 3 },
  theme_ocean: { background: "#E7F2FF", accent: "#258FB8" },
  theme_midnight: { background: "#E8EEF8", accent: "#315FAD" },
  theme_sunrise: { background: "#F2F7FD", accent: "#5388CB" },
};
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
}) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: circle ? size / 2 : size * 0.34,
          backgroundColor: color,
        },
        bordered && styles.avatarBorder,
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>
        {label}
      </Text>
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
                  ? `${notifications.length} yeni gelisme var`
                  : "Her sey yakalandi"}
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
      title: "Sesinle baglan.",
      copy: "Sakin sohbetlerden kalabalik topluluklara, sana iyi gelen odayi bul.",
    },
    {
      icon: "people-outline",
      kicker: "BIRLIKTE DINLE",
      title: "Kendi cevrini kur.",
      copy: "Sevdigin konusmacilari takip et, odalarini planla ve tekrar bir araya gel.",
    },
    {
      icon: "sparkles-outline",
      kicker: "HAZIRSIN",
      title: "Ilk odan seni bekliyor.",
      copy: "Mikrofonun hazir oldugunda sahneye cikabilir veya sadece dinleyebilirsin.",
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
                  <Text style={styles.featureLiveLabel}>SIMDI CANLI</Text>
                </View>
                <View style={styles.featureCategoryPill}>
                  <Ionicons name="headset-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.featureCategoryText}>
                    {featuredRoom.category}
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
      "Planli odayi iptal et?",
      `${room.title} ajandandan kaldirilacak.`,
      [
        { text: "Vazgec", style: "cancel" },
        {
          text: "Iptal et",
          style: "destructive",
          onPress: () => onCancel(room),
        },
      ],
    );
  const confirmStart = (room) =>
    Alert.alert("Odayi simdi baslat?", `${room.title} canli odaya donusecek.`, [
      { text: "Vazgec", style: "cancel" },
      { text: "Baslat", onPress: () => onStart(room) },
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
          <Text style={styles.kicker}>SENIN AJANDAN</Text>
          <Text style={styles.sheetTitle}>Yaklasan odalar</Text>
          <Text style={styles.agendaSummary}>
            {reminderRoomIds.length
              ? `${reminderRoomIds.length} oda icin hatirlatici acik.`
              : "Hatirlatmak istediklerini sec."}
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
                    )}{" "}
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
              <Text style={styles.createSubmitText}>Yeni bulusma planla</Text>
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
            <Text style={styles.roomCategory}>{room.category}</Text>
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
          <KeyboardAvoidingView
            style={styles.directMessageSheet}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
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
          </KeyboardAvoidingView>
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
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Pressable onPress={onDismiss} style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={COLORS.text} />
            </Pressable>
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
          </View>
        </KeyboardAvoidingView>
      </View>
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
        {joinedOnly ? "Topluluklarin" : "Topluluklar"}
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
          <Text style={styles.emptyTitle}>Henüz topluluk yok</Text>
          <Text style={styles.emptyDescription}>
            Keşfet bölümünden ilgini çeken bir topluluğa katıl.
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
        "Topluluk adi gerekli",
        "Devam etmek icin topluluguna bir ad ver.",
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
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
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
        </View>
      </View>
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
                {joined ? "Topluluktasin" : "Topluluga katil"}
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

function Profile({
  profile,
  coins,
  favoriteCount,
  hostedRoomCount,
  myRooms = [],
  dailyRewardClaimed,
  adminRole,
  onEdit,
  onOpenSettings,
  onOpenWallet,
  onOpenAdmin,
  onClaimDailyReward,
}) {
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityStreak, setActivityStreak] = useState(1);
  const [followedCount, setFollowedCount] = useState(0);
  const [followedNames, setFollowedNames] = useState([]);
  const [profileTab, setProfileTab] = useState("rooms");
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const openSafetyCenter = useCallback(() => setSafetyOpen(true), []);
  const openProfileDetails = useCallback(
    () => setProfileDetailsOpen(true),
    [],
  );
  const actions = useMemo(
    () => [
      ["person-circle-outline", "Profili görüntüle", openProfileDetails],
      [
        "gift-outline",
        dailyRewardClaimed ? "Günlük ödül alındı" : "Günlük ödül",
        dailyRewardClaimed ? onOpenWallet : onClaimDailyReward,
      ],
      ["shield-checkmark-outline", "Guvenlik merkezi", openSafetyCenter],
      ...(adminRole
        ? [["shield-half-outline", "Yonetim paneli", onOpenAdmin]]
        : []),
      ["settings-outline", "Ayarlar", onOpenSettings],
    ],
    [
      adminRole,
      dailyRewardClaimed,
      onClaimDailyReward,
      onOpenAdmin,
      onOpenSettings,
      onOpenWallet,
      openSafetyCenter,
      openProfileDetails,
    ],
  );
  useEffect(() => {
    AsyncStorage.getItem(ROOM_HISTORY_KEY)
      .then((savedHistory) => {
        const parsedHistory = JSON.parse(savedHistory || "[]");
        if (Array.isArray(parsedHistory))
          setRecentActivity(parsedHistory.slice(0, 3));
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(FOLLOWED_USERS_KEY)
      .then((savedNames) => {
        const parsedNames = JSON.parse(savedNames || "[]");
        if (Array.isArray(parsedNames)) {
          setFollowedCount(parsedNames.length);
          setFollowedNames(parsedNames);
        }
      })
      .catch(() => undefined);
  }, []);
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
        title: "Ilk dinleme",
        unlocked: recentActivity.length > 0,
      },
      {
        id: "host",
        icon: "mic",
        title: "Ev sahibi",
        unlocked: hostedRoomCount > 0,
      },
      {
        id: "curator",
        icon: "heart",
        title: "Kesifci",
        unlocked: favoriteCount >= 3,
      },
    ],
    [recentActivity.length, hostedRoomCount, favoriteCount],
  );
  const experiencePoints =
    favoriteCount * 10 +
    hostedRoomCount * 25 +
    recentActivity.length * 5 +
    Math.min(activityStreak, 7) * 4;
  const level = Math.max(
    1,
    Math.min(12, Math.floor(experiencePoints / 50) + 1),
  );
  const levelProgress = experiencePoints % 50;
  const levelName =
    level >= 7 ? "Topluluk sesi" : level >= 4 ? "Oda kurucusu" : "Yeni ses";
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
              <View
                style={[
                  styles.profileHomeAvatarWrap,
                  homeFrameAppearance
                    ? {
                        padding: 3,
                        borderRadius: 999,
                        borderWidth: homeFrameAppearance.width || 3,
                        borderColor: homeFrameAppearance.color || COLORS.primary,
                      }
                    : null,
                ]}
              >
                <Avatar
                  label={profile.name.charAt(0).toUpperCase()}
                  color={profile.color}
                  size={68}
                  bordered
                  circle
                />
                <View style={styles.profileHomeLevelBadge}>
                  <Text style={styles.profileHomeLevelText}>L{level}</Text>
                </View>
              </View>
              <View style={styles.profileHomeCopy}>
                <Text style={styles.profileHomeName} numberOfLines={1}>
                  {profile.name}
                </Text>
                <Text style={styles.profileHomeHandle} numberOfLines={1}>
                  @{profile.handle}
                </Text>
                <Text style={styles.profileHomeBio} numberOfLines={1}>
                  {profile.bio || "Sora ses topluluğundaki profilin"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={21} color={COLORS.muted} />
            </Pressable>
            <Pressable
              onPress={shareProfile}
              style={styles.profileShareButton}
              accessibilityRole="button"
              accessibilityLabel="Profili paylaş"
            >
              <Ionicons name="share-social-outline" size={18} color={COLORS.primary} />
            </Pressable>
          </View>
        </Reveal>

        <Reveal delay={45} distance={10}>
          <View style={styles.profileMetricsRow}>
            <ProfileMetric number={String(followedCount)} label="Takip" />
            <ProfileMetric number={String(favoriteCount)} label="Favori" />
            <ProfileMetric number={String(hostedRoomCount)} label="Oda" />
            <ProfileMetric number={String(coins)} label="Kredi" />
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
                  <Text style={styles.profileBannerCaption}>{coins} kredi</Text>
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

        <View style={styles.profileLevelSummary}>
          <View style={styles.pfLevelIcon}>
            <Ionicons name="medal-outline" size={18} color={COLORS.primary} />
          </View>
          <View style={styles.pfLevelInfo}>
            <Text style={styles.pfLevelTitle}>
              Seviye {String(level).padStart(2, "0")} · {levelName}
            </Text>
            <Text style={styles.pfLevelDesc} numberOfLines={1}>
              {activityStreak} günlük seri · {badges.filter((badge) => badge.unlocked).length} rozet
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </View>

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
              <Text style={styles.pfTabBadgeText}>{followedNames.length}</Text>
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
                    {item.initials || item.title.charAt(0)}
                  </Text>
                </View>
                <View style={styles.pfActivityInfo}>
                  <Text style={styles.pfActivityTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.pfActivityMeta}>
                    {item.category} · {item.listeners ?? 0} dinleyici
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
        ) : followedNames.length ? (
          followedNames.map((name) => (
            <View key={name} style={styles.pfActivityRow}>
              <View
                style={[
                  styles.pfActivityAvatar,
                  { backgroundColor: COLORS.primaryLight },
                ]}
              >
                <Text style={styles.pfActivityAvatarText}>
                  {name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.pfActivityInfo}>
                <Text style={styles.pfActivityTitle} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.pfActivityMeta}>Takip ediliyor</Text>
              </View>
              <Ionicons name="heart" size={16} color={COLORS.primary} />
            </View>
          ))
        ) : (
          <View style={styles.pfEmpty}>
            <Ionicons name="heart-outline" size={16} color={COLORS.muted} />
            <Text style={styles.pfEmptyText}>Henüz kimseyi takip etmiyorsun.</Text>
          </View>
        )}

        <Text style={styles.pfSection}>ROZETLER</Text>
        <View style={styles.pfBadgeRow}>
          {badges.map((badge) => (
            <View key={badge.id} style={styles.pfBadge}>
              <View
                style={[
                  styles.pfBadgeIcon,
                  badge.unlocked && styles.pfBadgeIconOn,
                ]}
              >
                <Ionicons
                  name={badge.unlocked ? badge.icon : "lock-closed"}
                  size={18}
                  color={badge.unlocked ? COLORS.primary : COLORS.muted}
                />
              </View>
              <Text style={styles.pfBadgeText} numberOfLines={1}>
                {badge.title}
              </Text>
            </View>
          ))}
        </View>
        {recentActivity.length > 0 && (
          <>
            <Text style={styles.pfSection}>SON DİNLEDİKLERİN</Text>
            {recentActivity.map((item) => (
              <View key={item.id} style={styles.pfActivityRow}>
                <View
                  style={[
                    styles.pfActivityAvatar,
                    { backgroundColor: item.color || COLORS.purple },
                  ]}
                >
                  <Text style={styles.pfActivityAvatarText}>
                    {item.initials || item.title.charAt(0)}
                  </Text>
                </View>
                <View style={styles.pfActivityInfo}>
                  <Text style={styles.pfActivityTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.pfActivityMeta}>
                    {item.category} · {item.visitedAt}
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
        onDismiss={() => setProfileDetailsOpen(false)}
      />
      <SecureSafetyCenterSheet
        visible={safetyOpen}
        onDismiss={() => setSafetyOpen(false)}
      />
    </>
  );
}

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
  onToggleFollow,
  onBlock,
  onReport,
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

  const person = remoteProfile || profile || {};
  const name = person.name || person.display_name || "Sora kullanıcısı";
  const handle = person.handle ? `@${person.handle.replace(/^@+/, "")}` : "Sora kullanıcısı";
  const color = person.color || person.avatar_color || COLORS.primaryLight;
  const frameAppearance = PROFILE_ITEM_APPEARANCE[person.activeFrameId];
  const themeAppearance = PROFILE_ITEM_APPEARANCE[person.activeProfileThemeId];
  const role = person.role;
  const roleLabel =
    role === "host"
      ? "Oda sahibi"
      : role === "moderator"
        ? "Moderatör"
        : role === "speaker"
          ? "Konuşmacı"
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
                {isSelf && onShare ? (
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
                      onEdit();
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
              <View
                style={[
                  styles.profileDetailAvatarRing,
                  frameAppearance
                    ? {
                        borderColor: frameAppearance.color || COLORS.primary,
                        borderWidth: frameAppearance.width || 3,
                      }
                    : null,
                ]}
              >
                <Avatar
                  label={name.charAt(0).toUpperCase()}
                  color={color}
                  size={88}
                  bordered
                  circle
                />
              </View>
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
            <Text style={styles.profileDetailName}>{name}</Text>
            <Text style={styles.profileDetailHandle}>{handle}</Text>
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
            <View style={styles.profileDetailSection}>
              <Text style={styles.profileDetailSectionTitle}>Hakkında</Text>
              <Text style={styles.profileDetailBio}>
                {person.bio || "Henüz bir profil açıklaması eklenmemiş."}
              </Text>
              {loading ? (
                <Text style={styles.profileDetailLoading}>Profil bilgileri yükleniyor…</Text>
              ) : null}
            </View>
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

const BottomNavigation = memo(function BottomNavigation({ active, onChange }) {
  const insets = useSafeAreaInsets();
  const items = useMemo(
    () => [
      ["discover", "compass-outline", "Keşfet"],
      ["inbox", "chatbubble-ellipses-outline", "Mesajlar"],
      ["community", "people-outline", "Topluluk"],
      ["profile", "person-outline", "Profil"],
    ],
    [],
  );
  const handleTabPress = useCallback((key) => onChange(key), [onChange]);
  return (
    <View
      style={[
        styles.bottomNavigation,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
    >
      <View style={styles.tabRow}>
        {items.map(([key, icon, label]) => (
          <Pressable
            key={key}
            onPress={() => handleTabPress(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active === key }}
            style={[styles.tabItem, active === key && styles.tabItemActive]}
          >
            <View
              style={[
                styles.tabIconWrap,
                active === key && styles.tabIconWrapActive,
              ]}
            >
              <Ionicons
                name={icon}
                size={21}
                color={active === key ? COLORS.primary : COLORS.muted}
              />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.tabLabel, active === key && styles.tabLabelActive]}
            >
              {label}
            </Text>
          </Pressable>
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
                    name={roomLocked ? "lock-closed" : "lock-open-outline"}
                    size={18}
                    color={roomLocked ? COLORS.primaryInk : COLORS.primary}
                  />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Konusma istekleri</Text>
                  <Text style={styles.settingDescription}>
                    {roomLocked
                      ? "Yeni istekler kapali"
                      : "Dinleyiciler el kaldirabilir"}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.settingState,
                    roomLocked && styles.settingStateActive,
                  ]}
                >
                  {roomLocked ? "Kapali" : "Acik"}
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

const GiftSheet = memo(function GiftSheet({
  visible,
  coins,
  gifts = GIFT_CATALOG,
  recipients = [],
  onDismiss,
  onSend,
}) {
  const [recipientId, setRecipientId] = useState(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const requestIdRef = useRef(null);
  const requestFingerprintRef = useRef(null);
  useEffect(() => {
    if (visible) setRecipientId(recipients[0]?.userId || null);
  }, [visible, recipients]);
  const selectedRecipient = recipients.find((item) => item.userId === recipientId);
  const confirmSend = (gift) => {
    if (!selectedRecipient) {
      Alert.alert("Alıcı seç", "Hediyeyi göndereceğin kişiyi seç.");
      return;
    }
    Alert.alert("Hediyeyi onayla", `${selectedRecipient.name} kişisine ${gift.name} · ${gift.cost} kredi gönderilsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Gönder", onPress: async () => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        const fingerprint = `${gift.id}:${selectedRecipient.userId}`;
        if (requestFingerprintRef.current !== fingerprint) {
          requestIdRef.current = createRequestUuid();
          requestFingerprintRef.current = fingerprint;
        }
        setSending(true);
        try {
          const sent = await onSend(gift, selectedRecipient, requestIdRef.current);
          if (sent) { requestIdRef.current = null; requestFingerprintRef.current = null; }
        } finally { sendingRef.current = false; setSending(false); }
      } },
    ]);
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
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>ODA HEDIYELERI</Text>
          <View style={styles.giftSheetHeading}>
            <Text style={styles.sheetTitle}>Bir iz birak.</Text>
            <View style={styles.coinPill}>
              <Ionicons name="diamond" size={14} color="#6AA8F5" />
              <Text style={styles.coinPillText}>{coins}</Text>
            </View>
          </View>
          <Text style={styles.giftHint}>Önce odadaki alıcıyı seç. Göndermeden önce hediye ve toplam kredi için onay istenir.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {recipients.map((recipient) => (
              <Pressable key={recipient.userId} onPress={() => setRecipientId(recipient.userId)} style={[styles.transferOption, recipientId === recipient.userId && styles.transferOptionActive]}>
                <Text style={[styles.transferOptionText, recipientId === recipient.userId && styles.transferOptionTextActive]}>{recipient.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.giftGrid}>
            {gifts.map((gift) => (
              <Pressable
                key={gift.id}
                disabled={sending}
                onPress={() => confirmSend(gift)}
                style={styles.giftCard}
              >
                <View
                  style={[styles.giftIcon, { backgroundColor: gift.color }]}
                >
                  <Ionicons name={gift.icon} size={24} color="#FFFFFF" />
                </View>
                <Text style={styles.giftName}>{gift.name}</Text>
                <View style={styles.giftCost}>
                  <Ionicons name="diamond" size={11} color="#6AA8F5" />
                  <Text style={styles.giftCostText}>{gift.cost}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
});

const GIFT_FLIGHT_LANES = [0, 1, 2, 3, 4];

/* Odaya hediye gonderildiginde yukari dogru ucan hediye animasyonu. */
const GiftFlight = memo(function GiftFlight({ gift }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [activeGift, setActiveGift] = useState(null);

  useEffect(() => {
    if (!gift) return undefined;
    setActiveGift(gift);
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setActiveGift(null);
    });
    return () => animation.stop();
  }, [gift, progress]);

  if (!activeGift) return null;

  const bannerOpacity = progress.interpolate({
    inputRange: [0, 0.15, 0.7, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <View pointerEvents="none" style={styles.giftFlightLayer}>
      {GIFT_FLIGHT_LANES.map((lane) => {
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [240, -320],
        });
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [(lane - 2) * 16, (lane - 2) * 70],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.12, 0.8, 1],
          outputRange: [0, 1, 1, 0],
        });
        const scale = progress.interpolate({
          inputRange: [0, 0.25, 1],
          outputRange: [0.5, 1.15, 0.85],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", `${(lane - 2) * 20}deg`],
        });
        return (
          <Animated.View
            key={`gift-lane-${lane}`}
            style={[
              styles.giftFlyer,
              {
                backgroundColor: activeGift.color || COLORS.purple,
                opacity,
                transform: [
                  { translateY },
                  { translateX },
                  { scale },
                  { rotate },
                ],
              },
            ]}
          >
            <Ionicons name={activeGift.icon} size={22} color="#FFFFFF" />
          </Animated.View>
        );
      })}
      <Animated.View
        style={[styles.giftFlyerBanner, { opacity: bannerOpacity }]}
      >
        <Ionicons name="sparkles" size={14} color="#76AFFF" />
        <Text style={styles.giftFlyerBannerText}>
          {activeGift.name} gönderildi
        </Text>
      </Animated.View>
    </View>
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
                { backgroundColor: participant.color || COLORS.accent },
              ]}
            >
              <Text style={styles.participantSheetInitial}>
                {participant.name?.charAt(0)?.toUpperCase() || "?"}
              </Text>
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
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
        onPanResponderMove: (_, gesture) => {
          const next = {
            x: lastPosition.current.x + gesture.dx,
            y: lastPosition.current.y + gesture.dy,
          };
          drag.setValue(next);
        },
        onPanResponderRelease: () => {
          drag.stopAnimation((value) => {
            lastPosition.current = value;
          });
        },
      }),
    [drag],
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
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
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
        </View>
      </View>
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
    if (!visible) return;
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
  const visibleActivities = activities.length ? activities : storedActivities;
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
                  {coins} <Text style={styles.walletBalanceUnit}>kredi</Text>
                </Text>
                <Text style={styles.walletActivityTime}>Promosyon {promoCoins} · Satın alınan {paidCoins}</Text>
              </View>
              <View style={styles.walletBalanceIcon}>
                <Ionicons name="diamond" size={28} color="#6AA8F5" />
              </View>
            </LinearGradient>
            <Text style={styles.settingsCaption}>GÜNLÜK ÖDÜL</Text>
            <View style={styles.walletRewardRow}>
              <View style={styles.walletRewardIcon}>
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
                    ? "Yarın yeniden 75 kredi kazanabilirsin."
                    : "Tek dokunuşla 75 kredi kazan."}
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
                  {dailyRewardClaimed ? "Alındı" : "+75 al"}
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
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
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
      </KeyboardAvoidingView>
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
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismiss} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Pressable onPress={onDismiss} style={styles.sheetClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>PLANLI SESLI ODA</Text>
          <Text style={styles.sheetTitle}>Bulusmayi ayarla.</Text>
          <Text style={styles.fieldLabel}>ODA ADI</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Orn. Hafta sonu sohbeti"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={36}
          />
          <Text style={styles.fieldLabel}>NE ZAMAN?</Text>
          <TextInput
            value={startsAt}
            onChangeText={setStartsAt}
            placeholder="Orn. Bugun 21:30"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={28}
          />
          <Text style={styles.fieldLabel}>KATEGORI</Text>
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
              <Text style={styles.createSubmitText}>Odayi planla</Text>
              <Ionicons
                name="calendar-outline"
                size={20}
                color={COLORS.primaryInk}
              />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
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
  profilePublic: true,
  autoJoinMuted: true,
};
const DEFAULT_WALLET_BALANCE = 1250;
const DAILY_REWARD_AMOUNT = 75;
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

  return (
    <View style={styles.composer}>
      <Pressable onPress={onOpenGift} style={styles.composerGift}>
        <Ionicons name="gift-outline" size={17} color="#6AA8F5" />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={handleChange}
        onSubmitEditing={handleSubmit}
        placeholder="Mesaj yaz"
        placeholderTextColor={COLORS.muted}
        style={styles.composerInput}
        maxLength={160}
      />
      <Pressable
        disabled={sending}
        onPress={handleSubmit}
        style={[styles.sendButton, sending && styles.sendButtonDisabled]}
      >
        <Ionicons
          name={sending ? "hourglass-outline" : "send"}
          size={15}
          color={COLORS.primaryInk}
        />
      </Pressable>
    </View>
  );
});

const RoomMessageRow = memo(function RoomMessageRow({
  item,
  canReport,
  onReport,
}) {
  const handleReport = useCallback(() => onReport(item), [onReport, item]);

  return (
    <View style={styles.messageRow}>
      <Text
        style={[
          styles.messageText,
          styles.messageBody,
          item.system && styles.systemMessage,
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
  onReport,
}) {
  return (
    <View style={styles.messageList}>
      {messages.map((item) => (
        <RoomMessageRow
          key={item.id}
          item={item}
          canReport={Boolean(
            canReportBase &&
            !item.system &&
            !item.pending &&
            item.userId &&
            item.userId !== userId,
          )}
          onReport={onReport}
        />
      ))}
    </View>
  );
});

const ROOM_STAGE_CAPACITY = 9;

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
  onToggleFollowHost,
  onHostPresenceChange,
  onMinimize,
  minimized = false,
}) {
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
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [profileParticipant, setProfileParticipant] = useState(null);
  const [followedParticipantNames, setFollowedParticipantNames] = useState([]);
  const [roomLocked, setRoomLocked] = useState(Boolean(room.roomLocked));
  const [chatLocked, setChatLocked] = useState(Boolean(room.chatLocked));
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
              text: `${room.title} odasına hoş geldin.`,
              createdAt: "1970-01-01T00:00:00.000Z",
            },
          ]
        : [
            {
              id: "room",
              system: true,
              text: `${room.title} odasına hoş geldin.`,
            },
          ],
    [room.id, room.persisted, room.title],
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
  const canModerate = isHost || ["host", "moderator"].includes(liveVoice.role);
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
            role:
              member?.role ||
              (participant.id === userId && isHost ? "host" : "listener"),
            isMuted: Boolean(member?.isMuted),
          };
        }),
    [blockedUserIds, isHost, liveVoice.participants, roomMembers, userId],
  );
  useEffect(() => {
    if (!room.persisted || !supabase) return;
    let active = true;
    listRoomGiftCatalog().then((catalog) => {
      if (active && catalog.length) setRoomGiftCatalog(catalog);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [room.persisted]);
  const roomSeatParticipants = useMemo(() => {
    const participants = activeRoomParticipants
      .filter((participant) => participant.userId !== room.hostId)
      .slice(0, 8);
    if (
      handRaised &&
      !isHost &&
      !participants.some((participant) => participant.userId === userId)
    ) {
      participants.push({
        userId,
        name: profile.name,
        color: profile.color,
        microphoneEnabled: false,
        pendingSeat: true,
      });
    }
    return participants;
  }, [
    activeRoomParticipants,
    handRaised,
    isHost,
    profile.color,
    profile.name,
    room.hostId,
    userId,
  ]);
  const micOn = liveVoice.enabled && liveVoice.microphoneEnabled;
  const activeSpeakerIds = liveVoice.activeSpeakerIds || [];
  const stageParticipants = useMemo(() => {
    const hostParticipant = activeRoomParticipants.find(
      (participant) => participant.userId === room.hostId,
    ) || {
      userId: room.hostId || `host-${room.id}`,
      name: room.host,
      color: roomBrand.accent,
      role: "host",
      microphoneEnabled: isHost ? micOn : false,
    };
    const seats = [hostParticipant, ...roomSeatParticipants];
    return seats.map((participant) => ({
      ...participant,
      isSpeaking: activeSpeakerIds.includes(participant.userId),
    }));
  }, [
    activeRoomParticipants,
    activeSpeakerIds,
    isHost,
    micOn,
    roomBrand.accent,
    room.host,
    room.hostId,
    room.id,
    roomSeatParticipants,
  ]);
  const stageGrid = useMemo(() => {
    const seats = stageParticipants.slice(0, ROOM_STAGE_CAPACITY);
    return [
      ...seats,
      ...Array.from({ length: Math.max(0, ROOM_STAGE_CAPACITY - seats.length) }),
    ];
  }, [stageParticipants]);
  const stageSeatRows = useMemo(
    () => [stageGrid.slice(0, 1), stageGrid.slice(1, 5), stageGrid.slice(5, 9)],
    [stageGrid],
  );
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
    const loadMessages = room.persisted
      ? joinRoomMembership(room.id).then(() => listRoomMessages(room.id))
      : AsyncStorage.getItem(ROOM_MESSAGES_KEY).then((savedMessages) => {
          const roomMessages = JSON.parse(savedMessages || "{}");
          return Array.isArray(roomMessages[room.id]) &&
            roomMessages[room.id].length
            ? roomMessages[room.id]
            : initialMessages;
        });
    loadMessages
      .then((loadedMessages) => {
        if (!active) return;
        setMessages(
          room.persisted
            ? mergeRoomMessages(initialMessages, loadedMessages || [])
            : loadedMessages,
        );
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
          const row = payload.new;
          const incoming = {
            id: row.id,
            userId: row.sender_id,
            user: row.sender_name || "Sora kullanıcısı",
            text: row.body,
            system: row.kind === "system",
            createdAt: row.created_at,
          };
          setMessages((current) => mergeRoomMessages(current, [incoming]));
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
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setChatRealtimeStatus("live");
          listRoomMessages(room.id)
            .then((latestMessages) => {
              if (active)
                setMessages((current) =>
                  mergeRoomMessages(current, latestMessages),
                );
            })
            .catch(() => undefined);
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
  }, [chatAccessReady, room.id, room.persisted]);

  useEffect(() => {
    if (!room.persisted || liveVoice.status !== "connected") return undefined;
    let active = true;
    const refreshMembers = () =>
      listRoomMembers(room.id)
        .then((members) => {
          if (active) setRoomMembers(members);
        })
        .catch(() => undefined);
    refreshMembers();
    const interval = setInterval(refreshMembers, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [liveVoice.participantCount, liveVoice.status, room.id, room.persisted]);

  useEffect(() => {
    if (!isHost || !room.persisted || !onHostPresenceChange) return undefined;
    const setPresence = (isActive) =>
      onHostPresenceChange(room.id, isActive).catch(() => undefined);
    if (liveVoice.status !== "connected") {
      if (["error", "disconnected", "local"].includes(liveVoice.status)) {
        setPresence(false);
      }
      return undefined;
    }
    setPresence(true);
    const heartbeat = setInterval(() => setPresence(true), 20_000);
    const subscription = AppState.addEventListener("change", (nextState) => {
      setPresence(nextState === "active");
    });
    return () => {
      clearInterval(heartbeat);
      subscription.remove();
      setPresence(false);
    };
  }, [isHost, liveVoice.status, onHostPresenceChange, room.id, room.persisted]);

  useEffect(() => {
    if (!messagesReady || room.persisted) return;
    AsyncStorage.getItem(ROOM_MESSAGES_KEY)
      .then((savedMessages) => {
        const currentMessages = JSON.parse(savedMessages || "{}");
        const nextMessages = {
          ...(currentMessages && typeof currentMessages === "object"
            ? currentMessages
            : {}),
          [room.id]: messages.slice(-100),
        };
        return AsyncStorage.setItem(
          ROOM_MESSAGES_KEY,
          JSON.stringify(nextMessages),
        );
      })
      .catch(() => undefined);
  }, [messages, messagesReady, room.id]);

  const handleToggleSpeaker = useCallback(
    () => setSpeakerOn((value) => !value),
    [],
  );
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenGift = useCallback(() => setGiftOpen(true), []);
  const handleCloseGift = useCallback(() => setGiftOpen(false), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleCloseReport = useCallback(() => setReportTarget(null), []);
  const handleSendGiftFromSheet = useCallback(
    async (gift, recipient, requestId) => {
      const sent = await onSendGift({ gift, recipient, roomId: room.id, requestId });
      if (!sent) return;
      setGiftOpen(false);
      setGiftFlight({ ...gift, recipientName: recipient.name, stamp: Date.now() });
    },
    [onSendGift, room.id],
  );

  useEffect(() => {
    AsyncStorage.getItem(FOLLOWED_USERS_KEY)
      .then((savedNames) => {
        const parsedNames = JSON.parse(savedNames || "[]");
        if (Array.isArray(parsedNames)) setFollowedParticipantNames(parsedNames);
      })
      .catch(() => undefined);
  }, []);

  const toggleMicrophone = useCallback(async () => {
    if (liveVoice.enabled) {
      try {
        const updated = await liveVoice.setMicrophoneEnabled(!micOn);
        if (!updated)
          Alert.alert(
            "Bağlantı hazırlanıyor",
            "Mikrofonu açmak için ses odasının bağlanmasını bekle.",
          );
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
  }, [liveVoice.enabled, liveVoice.setMicrophoneEnabled, micOn]);

  const leaveRoom = async () => {
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
        visitedAt: "Simdi",
      };
      const nextHistory = [
        entry,
        ...history.filter((item) => item.roomId !== room.id),
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
          "Sohbet kapali",
          "Ev sahibi oda sohbetini gecici olarak kapatti.",
        );
        return false;
      }
      const messageCheck = messageGuard.check(cleanMessage);
      if (!messageCheck.allowed) {
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
        { id: String(Date.now()), user: profile.name, text: cleanMessage },
      ]);
      return true;
    },
    [
      canModerate,
      chatAccessReady,
      chatLocked,
      messageGuard,
      messageSending,
      profile.name,
      room.id,
      room.persisted,
      userId,
    ],
  );

  const toggleHand = async () => {
    if (roomLocked && !isHost) {
      Alert.alert(
        "Oda kilitli",
        "Ev sahibi su an yeni konusma isteklerini kapatti.",
      );
      return;
    }
    const nextState = !handRaised;
    setHandRaised(nextState);
    if (room.persisted) {
      try {
        await setRoomHandRaise({ roomId: room.id, raised: nextState });
      } catch {
        setHandRaised(!nextState);
        Alert.alert(
          "İstek gönderilemedi",
          "Bağlantını kontrol edip tekrar dene.",
        );
        return;
      }
    }
    setMessages((current) => [
      ...current,
      {
        id: `hand-${Date.now()}`,
        system: true,
        text: nextState
          ? "Koltuk isteğin ev sahibine iletildi."
          : "Koltuk isteğin geri çekildi.",
      },
    ]);
  };

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
  const selectedIsHostParticipant = Boolean(
    selectedParticipant && selectedParticipant.userId === room.hostId,
  );
  const selectedIsFollowing = selectedIsHostParticipant
    ? isFollowingHost
    : selectedParticipant
      ? followedParticipantNames.includes(selectedParticipant.name)
      : false;
  const handleSelectedFollow = useCallback(() => {
    if (!selectedParticipant) return;
    if (selectedParticipant.userId === room.hostId) {
      onToggleFollowHost?.();
      return;
    }
    setFollowedParticipantNames((current) => {
      const name = selectedParticipant.name;
      const nextNames = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      AsyncStorage.setItem(
        FOLLOWED_USERS_KEY,
        JSON.stringify(nextNames),
      ).catch(() => undefined);
      return nextNames;
    });
  }, [onToggleFollowHost, room.hostId, selectedParticipant]);
  const handleSelectedBlock = useCallback(() => {
    const participant = selectedParticipant;
    setSelectedParticipant(null);
    setProfileParticipant(null);
    if (participant) blockParticipant(participant);
  }, [blockParticipant, selectedParticipant]);
  const handleSelectedReport = useCallback(() => {
    const participant = selectedParticipant;
    setSelectedParticipant(null);
    setProfileParticipant(null);
    if (participant)
      setReportTarget({
        name: `${participant.name} kullanıcısı`,
        userId: participant.userId,
        roomId: room.id,
      });
  }, [room.id, selectedParticipant]);

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

  const shareRoom = async () => {
    try {
      await Share.share({
        title: `Sora · ${room.title}`,
        message: `${room.title} odasina katil.\nEv sahibi: ${room.host}\nOda kodu: ${room.id}`,
      });
    } catch {
      return;
    }
  };

  const clearRoomChat = () =>
    Alert.alert(
      "Sohbet görünümü temizlensin mi?",
      "Mesajlar veritabanından silinmez; yalnızca bu ekrandan gizlenir.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Gizle",
          onPress: () =>
            setMessages([
              {
                id: `clean-${Date.now()}`,
                system: true,
                text: "Sohbet görünümü temizlendi.",
              },
            ]),
        },
      ],
    );
  const chatStatusText = !messagesReady
    ? "Mesajlar yükleniyor"
    : chatRealtimeStatus === "live"
      ? `${messages.length} mesaj · Canlı`
      : chatRealtimeStatus === "error" || chatRealtimeStatus === "offline"
        ? `${messages.length} mesaj · Bağlantı kesildi`
        : `${messages.length} mesaj · Bağlanıyor`;

  const renderStageSeat = (participant, index) => {
    const seatNumber = index + 1;
    if (!participant) {
      return (
        <Pressable
          key={`empty-${index}`}
          style={styles.roomSpeakerSlot}
          onPress={toggleHand}
          accessibilityRole="button"
          accessibilityLabel={`${seatNumber} numaralı boş koltuğa otur`}
        >
          <View style={styles.roomEmptySeat}>
            <Text style={styles.roomEmptySeatNumber}>{seatNumber}</Text>
          </View>
          <Text style={styles.roomSpeakerName}>Boş</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        style={styles.roomSpeakerSlot}
        key={participant.userId}
        delayLongPress={260}
        onLongPress={() => openParticipantMenu(participant)}
        accessibilityRole="button"
        accessibilityLabel={`${seatNumber}. koltuk: ${participant.name}`}
      >
        <View style={styles.roomAvatarWrap}>
          {participant.isSpeaking ? (
            <SpeakingRing size={64} color="#76AFFF" />
          ) : null}
          <View
            style={[
              styles.roomSpeakerAvatar,
              { backgroundColor: participant.color },
              participant.role === "host" && styles.roomSpeakerAvatarHost,
              participant.microphoneEnabled && styles.roomSpeakerAvatarActive,
            ]}
          >
            <Text style={styles.roomSpeakerInitial}>
              {participant.name?.charAt(0)?.toUpperCase() || "?"}
            </Text>
            {participant.microphoneEnabled ? (
              <View style={styles.roomMicOnBadge}>
                <Ionicons name="mic" size={9} color="#11131A" />
              </View>
            ) : (
              <View style={styles.roomMicOffBadge}>
                <Ionicons
                  name="mic-off"
                  size={9}
                  color="rgba(255,255,255,0.7)"
                />
              </View>
            )}
          </View>
          {participant.role === "host" ? (
            <View style={styles.roomSpeakerCrown}>
              <Ionicons name="sparkles" size={9} color="#11131A" />
            </View>
          ) : null}
          <View style={styles.roomSeatNumberBadge}>
            <Text style={styles.roomSeatNumberText}>{seatNumber}</Text>
          </View>
        </View>
        <Text style={styles.roomSpeakerName} numberOfLines={1}>
          {participant.pendingSeat ? "Bekliyor" : participant.name}
        </Text>
      </Pressable>
    );
  };

  /* ── WePlay / Hazan tarzı oda düzeni ─────────────────────────── */
  return (
    <SafeAreaView style={styles.roomScreen}>
      {minimized ? null : (
        <StatusBar barStyle="light-content" backgroundColor="#11131A" />
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Üst bar: küçült (sol) + seçenekler (sağ) ── */}
        <View style={styles.roomTopBar}>
          <Pressable
            onPress={onMinimize}
            style={styles.roomTopBarBack}
            accessibilityLabel="Odayı küçült"
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={handleOpenSettings}
            style={styles.roomTopBarMore}
            accessibilityLabel="Oda seçenekleri"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Canlı bant ── */}
        <View style={styles.roomLiveBand}>
          <View style={styles.roomLivePill}>
            {liveVoice.status === "connected" ? (
              <LivePulse size={5} color={COLORS.primary} />
            ) : null}
            <Text style={styles.roomLivePillText}>
              {liveVoice.status === "connected"
                ? `CANLI · ${Math.max(liveVoice.participantCount, activeRoomParticipants.length)} kişi`
                : roomVoiceLabel}
            </Text>
          </View>
          {["error", "disconnected", "local"].includes(liveVoice.status) && (
            <Pressable
              style={styles.roomRetryPill}
              onPress={retryVoiceConnection}
            >
              <Ionicons name="refresh" size={12} color={COLORS.primary} />
              <Text style={styles.roomRetryText}>Yeniden bağlan</Text>
            </Pressable>
          )}
        </View>

        {/* ── Birleşik yüzey: sahne + odadakiler + sohbet ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.roomBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Sahne + sohbet tek yüzeyde birleşik */}
          <View style={styles.roomSurface}>
            {/* Oda profili + adı — sahneyle birleşik, sol üstte */}
            <View style={styles.roomIdentity}>
              <View style={styles.roomIdAvatar}>
                <LinearGradient
                  colors={roomBrand.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.roomIdAvatarGrad}
                >
                  <Text style={styles.roomIdInitial}>
                    {room.initials || room.title?.charAt(0) || "S"}
                  </Text>
                </LinearGradient>
                {liveVoice.status === "connected" ? (
                  <View style={styles.roomIdLiveDot}>
                    <LivePulse size={4} color="#11131A" />
                  </View>
                ) : null}
              </View>
              <View style={styles.roomIdCopy}>
                <Text style={styles.roomTopBarCategory} numberOfLines={1}>
                  {room.category.toUpperCase()}
                </Text>
                <Text style={styles.roomTopBarTitle} numberOfLines={1}>
                  {room.title}
                </Text>
                {room.description ? (
                  <Text style={styles.roomIdTopic} numberOfLines={1}>
                    {room.description}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Sahne: ev sahibi + konuşmacılar */}
            <View style={styles.roomStage}>
              <View style={styles.roomSectionRow}>
                <Text style={styles.roomSectionTitle}>SAHNEDEKİLER</Text>
                <Text style={styles.roomSectionCount}>
                  {Math.min(stageParticipants.length, ROOM_STAGE_CAPACITY)}/
                  {ROOM_STAGE_CAPACITY}
                </Text>
              </View>
              <View style={styles.roomSpeakerGrid}>
                {stageSeatRows.map((row, rowIndex) => (
                  <View
                    key={`room-seat-row-${rowIndex}`}
                    style={styles.roomSpeakerGridRow}
                  >
                    {row.map((participant, offset) => {
                      const index =
                        rowIndex === 0
                          ? 0
                          : rowIndex === 1
                            ? offset + 1
                            : offset + 5;
                      return renderStageSeat(participant, index);
                    })}
                  </View>
                ))}
              </View>

              {/* Takip / el kaldır */}
              {!isHost && (
                <View style={styles.roomStageActions}>
                  {room.hostId ? (
                    <Pressable
                      onPress={onToggleFollowHost}
                      style={[
                        styles.roomFollowBtn,
                        isFollowingHost && styles.roomFollowBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roomFollowBtnText,
                          isFollowingHost && styles.roomFollowBtnTextActive,
                        ]}
                      >
                        {isFollowingHost ? "Takipte" : "Takip et"}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={toggleHand}
                    style={[
                      styles.roomHandBtn,
                      handRaised && styles.roomHandBtnActive,
                    ]}
                    accessibilityLabel={
                      handRaised
                        ? "El kaldırma isteğini geri çek"
                        : "El kaldır, konuş"
                    }
                  >
                    <Text style={styles.roomHandBtnEmoji}>✋</Text>
                    <Text
                      style={[
                        styles.roomHandBtnText,
                        handRaised && { color: "#11131A" },
                      ]}
                    >
                      {handRaised ? "İsteğin iletildi" : "El kaldır"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Odadakiler */}
            {activeRoomParticipants.length > 0 && (
              <View style={styles.roomAudienceSection}>
                <View style={styles.roomChatHead}>
                  <Text style={styles.roomChatTitle}>Odadakiler</Text>
                  <Text style={styles.roomChatCount}>
                    {Math.max(
                      liveVoice.participantCount,
                      activeRoomParticipants.length,
                    )}{" "}
                    kişi
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.roomAudienceRow}
                  keyboardShouldPersistTaps="handled"
                >
                  {activeRoomParticipants.map((participant) => (
                    <Pressable
                      key={participant.userId}
                      style={styles.roomAudienceItem}
                      delayLongPress={260}
                      onPress={() => openParticipantMenu(participant)}
                      onLongPress={() => openParticipantMenu(participant)}
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
                          <Text style={styles.roomAudienceInitial}>
                            {participant.name?.charAt(0)?.toUpperCase() || "?"}
                          </Text>
                          {participant.role === "host" ? (
                            <View style={styles.roomAudienceCrown}>
                              <Ionicons name="star" size={8} color="#11131A" />
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

            {/* Sohbet — sahneyle aynı yüzeyde */}
            <View style={styles.roomChatSection}>
              <View style={styles.roomChatHead}>
                <Text style={styles.roomChatTitle}>Sohbet</Text>
                <Text style={styles.roomChatCount}>{chatStatusText}</Text>
                <Pressable onPress={clearRoomChat} hitSlop={8}>
                  <Ionicons
                    name="trash-outline"
                    size={15}
                    color="rgba(255,255,255,0.4)"
                  />
                </Pressable>
              </View>
              <RoomMessageList
                messages={messages}
                canReportBase={room.persisted}
                userId={userId}
                onReport={handleReportMessage}
              />
              <RoomComposer
                onSend={sendMessage}
                onOpenGift={handleOpenGift}
                sending={messageSending}
              />
            </View>
          </View>
        </ScrollView>

        {/* ── Alt kontrol barı (WePlay tarzı) ── */}
        <View style={styles.roomControlBar}>
          {/* Mikrofon */}
          <Pressable
            style={[styles.roomCtrlBtn, micOn && styles.roomCtrlBtnOn]}
            onPress={toggleMicrophone}
            accessibilityLabel="Mikrofon"
          >
            <Ionicons
              name={micOn ? "mic" : "mic-off"}
              size={22}
              color={micOn ? "#11131A" : "#FFFFFF"}
            />
            <Text style={[styles.roomCtrlLabel, micOn && { color: "#11131A" }]}>
              Mikrofon
            </Text>
          </Pressable>

          {/* Hoparlör */}
          <Pressable
            style={[styles.roomCtrlBtn, speakerOn && styles.roomCtrlBtnOn]}
            onPress={handleToggleSpeaker}
            accessibilityLabel="Hoparlör"
          >
            <Ionicons
              name={speakerOn ? "volume-high" : "volume-mute"}
              size={22}
              color={speakerOn ? "#11131A" : "#FFFFFF"}
            />
            <Text
              style={[styles.roomCtrlLabel, speakerOn && { color: "#11131A" }]}
            >
              Ses
            </Text>
          </Pressable>

          {/* Hediye */}
          <Pressable
            style={styles.roomCtrlBtn}
            onPress={handleOpenGift}
            accessibilityLabel="Hediye gönder"
          >
            <Ionicons name="gift-outline" size={22} color="#76AFFF" />
            <Text style={styles.roomCtrlLabel}>Hediye</Text>
          </Pressable>

          {/* Paylaş */}
          <Pressable
            style={styles.roomCtrlBtn}
            onPress={shareRoom}
            accessibilityLabel="Odayı paylaş"
          >
            <Ionicons name="share-social-outline" size={22} color="#FFFFFF" />
            <Text style={styles.roomCtrlLabel}>Paylaş</Text>
          </Pressable>

          {/* Çıkış — büyük kırmızı */}
          <Pressable
            style={styles.roomLeaveBtn}
            onPress={leaveRoom}
            accessibilityLabel="Odadan çık"
          >
            <Ionicons name="exit-outline" size={22} color="#FFFFFF" />
            <Text style={styles.roomCtrlLabel}>Çık</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <GiftFlight gift={giftFlight} />

      <RoomSettingsSheet
        visible={settingsOpen}
        isHost={canModerate}
        roomLocked={roomLocked}
        chatLocked={chatLocked}
        canBlockHost={Boolean(room.hostId && room.hostId !== userId)}
        onToggleRoomLock={toggleRoomLock}
        onToggleChatLock={toggleChatLock}
        onReportRoom={reportRoom}
        onBlockHost={handleBlockHost}
        onInvite={shareRoom}
        onDismiss={handleCloseSettings}
      />
      <GiftSheet
        visible={giftOpen}
        coins={coins}
        gifts={roomGiftCatalog}
        recipients={activeRoomParticipants.filter((participant) => participant.userId !== userId)}
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
      <ProfileDetailSheet
        visible={Boolean(profileParticipant)}
        profile={profileParticipant}
        userId={profileParticipant?.userId}
        roomContext={room}
        isSelf={profileParticipant?.userId === userId}
        isFollowing={selectedIsFollowing}
        canBlock={Boolean(room.persisted && profileParticipant?.userId)}
        onToggleFollow={handleSelectedFollow}
        onBlock={handleSelectedBlock}
        onReport={handleSelectedReport}
        onDismiss={() => {
          setProfileParticipant(null);
          setSelectedParticipant(null);
        }}
      />
    </SafeAreaView>
  );
}

function ProfileEditor({ visible, profile, onDismiss, onSave, onBalanceRefresh }) {
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio || "");
  const [color, setColor] = useState(profile.color);
  const [profileItems, setProfileItems] = useState([]);
  const [ownedItemIds, setOwnedItemIds] = useState([]);
  const [previewItemId, setPreviewItemId] = useState(null);
  const [itemBusy, setItemBusy] = useState(null);
  const colors = ["#80ADE6", "#8FC7EF", "#6EA1E8", "#7FAEEB", "#5F90D0"];

  useEffect(() => {
    if (visible) {
      setName(profile.name);
      setHandle(profile.handle);
      setBio(profile.bio || "");
      setColor(profile.color);
    }
  }, [profile, visible]);

  useEffect(() => {
    if (!visible || !supabase) return;
    listProfileItems().then(({ items, ownedIds }) => {
      setProfileItems(items);
      setOwnedItemIds(ownedIds);
    }).catch(() => Alert.alert("Ürünler yüklenemedi", "Bağlantını kontrol edip yeniden dene."));
  }, [visible]);

  const activePreview = profileItems.find((item) => item.id === previewItemId);
  const handleProfileItem = (item) => {
    if (ownedItemIds.includes(item.id)) {
      setItemBusy(item.id);
      activateProfileItem(item.id).then(() => {
        onSave({ ...profile, ...(item.item_type === "frame" ? { activeFrameId: item.id } : { activeProfileThemeId: item.id }) });
        onDismiss();
      }).catch(() => Alert.alert("Ürün etkinleştirilemedi", "Biraz sonra yeniden dene.")).finally(() => setItemBusy(null));
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
    const nextName = name.trim();
    const nextHandle = handle
      .trim()
      .replace(/^@+/, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (!nextName || !/^[a-z0-9_]{3,24}$/.test(nextHandle)) {
      Alert.alert(
        "Bilgileri kontrol et",
        "Adini ve 3-24 karakterlik kullanici adini yaz. Kullanici adinda sadece kucuk harf, sayi ve alt cizgi kullanabilirsin.",
      );
      return;
    }
    onSave({
      ...profile,
      name: nextName.slice(0, 36),
      handle: nextHandle,
      bio: bio.trim().slice(0, 180),
      color,
    });
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
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.kicker}>PROFILIN</Text>
          <Text style={styles.sheetTitle}>Kendini goster.</Text>
          <Text style={styles.fieldLabel}>GORUNEN AD</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Adin"
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
          <Text style={styles.fieldLabel}>KISA BIYOGRAFI</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Seni tanitan kisa bir not"
            placeholderTextColor={COLORS.muted}
            style={styles.sheetInput}
            maxLength={180}
            multiline
          />
          <Text style={styles.fieldLabel}>PROFIL RENGI</Text>
          <View style={styles.profileColors}>
            {colors.map((item) => (
              <Pressable
                key={item}
                onPress={() => setColor(item)}
                style={[
                  styles.profileColorOption,
                  { backgroundColor: item },
                  color === item && styles.profileColorSelected,
                ]}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>ÇERÇEVE VE PROFİL TEMASI</Text>
          {activePreview ? (
            <View style={{ padding: 12, marginBottom: 10, borderRadius: 14, backgroundColor: activePreview.appearance?.background || "#F1F7FB", borderWidth: activePreview.item_type === "frame" ? 3 : 0, borderColor: activePreview.appearance?.color || "transparent" }}>
              <Text style={{ color: activePreview.appearance?.accent || COLORS.text, fontWeight: "800" }}>Önizleme · {activePreview.name}</Text>
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            {profileItems.map((item) => {
              const owned = ownedItemIds.includes(item.id);
              return <Pressable key={item.id} onPress={() => setPreviewItemId(item.id)} onLongPress={() => handleProfileItem(item)} style={[styles.transferOption, previewItemId === item.id && styles.transferOptionActive, { marginRight: 8 }]}>
                <Text style={[styles.transferOptionText, previewItemId === item.id && styles.transferOptionTextActive]}>{item.name}</Text>
                <Text style={[styles.walletActivityTime, { textAlign: "center" }]}>{owned ? "Sahipsin · dokun etkinleştir" : `${item.cost} kredi · basılı tut satın al`}</Text>
              </Pressable>;
            })}
          </ScrollView>
          {activePreview ? <Pressable disabled={Boolean(itemBusy)} onPress={() => handleProfileItem(activePreview)} style={styles.transferCreateButton}><Text style={styles.transferCreateButtonText}>{ownedItemIds.includes(activePreview.id) ? "Profili etkinleştir" : `Önizle · ${activePreview.cost} kredi`}</Text></Pressable> : null}
          <Pressable onPress={save}>
            <LinearGradient colors={BRAND_GRADIENT} style={styles.createSubmit}>
              <Text style={styles.createSubmitText}>Degisiklikleri kaydet</Text>
              <Ionicons name="checkmark" size={20} color={COLORS.primaryInk} />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
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
      description: "Takip ettigin odalardaki yeni mesajlar",
    },
    {
      key: "profilePublic",
      icon: "eye-outline",
      title: "Herkese acik profil",
      description: "Profilin kesfet bolumunde gorunsun",
    },
    {
      key: "autoJoinMuted",
      icon: "mic-off-outline",
      title: "Sessiz katil",
      description: "Odalar acilirken mikrofonunu kapali tut",
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
          <Text style={styles.kicker}>TERCIHLER</Text>
          <Text style={styles.sheetTitle}>Ayarlarin.</Text>
          <Text style={styles.settingsCaption}>
            BILDIRIMLER, GIZLILIK VE SES
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
            HESAP VE VERILER
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
              <Text style={styles.settingTitle}>Hesap ve guvenlik</Text>
              <Text style={styles.settingDescription}>
                Parola, oturum ve hesap silme islemleri
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
                Yerel verilerini disa aktar veya sifirla
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
  const [roomMinimized, setRoomMinimized] = useState(false);
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

  useEffect(() => {
    const timer = setTimeout(() => setBrandLaunchVisible(false), 1100);
    return () => clearTimeout(timer);
  }, []);

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
        const { data } = await supabase.auth
          .getSession()
          .catch(() => ({ data: {} }));
        if (data?.session) return;
        try {
          await completeAuthRedirect(url);
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

  useEffect(() => {
    const user = authSession?.user;
    if (!user) return;
    const metadata = user.user_metadata || {};
    const fallbackName = user.email?.split("@")[0] || "Sora kullanicisi";
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
    setProfile(nextProfile);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile)).catch(
      () => undefined,
    );
  }, [authSession]);

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
      icon: ["daily_reward", "promo_grant"].includes(transaction.type) ? "gift" : "diamond",
      color:
        ["daily_reward", "promo_grant"].includes(transaction.type)
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
    Promise.all([
      listRooms("live"),
      listRooms("scheduled"),
      listFollowedUserIds(user.id),
      getWallet(),
      listWalletTransactions(),
    ])
      .then(
        ([
          liveRooms,
          plannedRooms,
          follows,
          wallet,
          transactions,
        ]) => {
          if (!active) return;
          setRooms([...liveRooms, ...SEEDED_ROOMS]);
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
        },
      )
      .catch(() => undefined);
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
      .select("handle, display_name, bio, avatar_color, active_frame_id, active_profile_theme_id")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setProfile({
          name: data.display_name,
          handle: data.handle,
          bio: data.bio,
          color: data.avatar_color,
          activeFrameId: data.active_frame_id,
          activeProfileThemeId: data.active_profile_theme_id,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authSession]);

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

  const resumeHostedRoom = (existingRoom) => {
    // Odayı ağ çağrısını beklemeden hemen aç; "canlı" durumu arka planda güncellenir.
    console.warn("[room-entry] resume hosted room pressed", Boolean(existingRoom?.id));
    setCreateOpen(false);
    openRoom(existingRoom);
    setHostRoomPresence(existingRoom.id, true).catch((error) => {
      console.warn("Room presence sync failed", error);
    });
  };

  const promptHostedRoom = (existingRoom) => {
    Alert.alert(
      "Zaten bir odan var",
      `“${existingRoom.title}” odana dönebilirsin. Aynı anda yalnızca bir odan olabilir.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Odama dön",
          onPress: () => {
            resumeHostedRoom(existingRoom);
          },
        },
      ],
    );
  };

  const createRoom = async (newRoom) => {
    const userRoom = {
      ...newRoom,
      host: profile.name,
      initials: profile.name.charAt(0).toUpperCase(),
      userCreated: true,
    };
    if (supabase && authSession?.user) {
      try {
        const existingRoom = await getHostedRoom(authSession.user.id);
        if (existingRoom) {
          promptHostedRoom(existingRoom);
          return false;
        }
        const savedRoom = await createRemoteRoom({
          room: userRoom,
          userId: authSession.user.id,
        });
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

  const refreshWalletData = async () => {
    if (!supabase || !authSession?.user) return;
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
        icon: ["daily_reward", "promo_grant"].includes(transaction.type) ? "gift" : "diamond",
        color:
          ["daily_reward", "promo_grant"].includes(transaction.type)
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

  const sendGift = async ({ gift, recipient, roomId, requestId }) => {
    if (!supabase || !authSession?.user) {
      Alert.alert("Giriş gerekli", "Hediye göndermek için hesabınla giriş yap.");
      return false;
    }
    if (!recipient?.userId || !roomId) return false;
    if (walletBalance < gift.cost) {
      Alert.alert(
        "Bakiye yetersiz",
        `${gift.name} hediyesi için ${gift.cost} kredi gerekiyor.`,
      );
      return false;
    }
    try {
      const requestKey = requestId || createRequestUuid();
      const result = await sendRoomGift({ roomId, giftId: gift.id, recipientId: recipient.userId, requestId: requestKey });
      if (!result) throw new Error("Gift response missing");
      setWalletBalance(result.balance);
      setPromoWalletBalance(result.promo_balance || 0);
      setPaidWalletBalance(result.paid_balance || 0);
      setWalletActivities((items) => [{
        id: `gift-${requestKey}`, icon: "diamond", color: gift.color,
        text: `${recipient.name} kişisine ${gift.name}`, amount: -result.gift_cost,
        time: "Şimdi",
      }, ...items]);
      pushNotification({ id: `gift-${requestKey}`, icon: gift.icon, color: gift.color, text: `${recipient.name} kişisine hediye gönderildi.`, time: "Şimdi" });
      return true;
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
    }
  };

  const claimDailyReward = async () => {
    if (dailyRewardClaimed) {
      Alert.alert(
        "Odul zaten alindi",
        "Yarin tekrar gunluk kredi kazanabilirsin.",
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
        setPromoWalletBalance((value) => value + DAILY_REWARD_AMOUNT);
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
          text: `${DAILY_REWARD_AMOUNT} kredi günlük ödülü hesabına eklendi.`,
          time: "Şimdi",
        });
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
          text: `${DAILY_REWARD_AMOUNT} kredi gunluk odulu hesabina eklendi.`,
          time: "Simdi",
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
      text: "Gunluk giris odulu",
      amount: DAILY_REWARD_AMOUNT,
      time: "Simdi",
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
          time: "Simdi",
        });
    }
  };

  const openRoom = (nextRoom) => {
    if (!nextRoom || typeof nextRoom.id !== "string" || !nextRoom.id) {
      console.warn("[room-entry] open rejected: invalid room");
      Alert.alert("Oda açılamadı", "Oda bilgisi geçersiz. Tekrar dene.");
      return;
    }

    console.warn("[room-entry] open requested", Boolean(nextRoom.id));
    setRoom(nextRoom);
    setRoomPreferences({ microphoneEnabled: false, speakerEnabled: true });
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
          if (active) setRooms(liveRooms);
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
    if (room?.persisted && room.hostId === authSession?.user?.id) {
      setHostRoomPresence(room.id, false).catch(() => undefined);
    }
    setRoomMinimized(false);
    setRoom(null);
  };

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

  const toggleFollowHost = async () => {
    if (
      !room?.hostId ||
      !authSession?.user ||
      room.hostId === authSession.user.id
    )
      return;
    const targetUserId = room.hostId;
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
  };

  const saveProfile = async (nextProfile) => {
    if (supabase && authSession?.user) {
      const normalizedHandle = nextProfile.handle.trim().toLowerCase();
      if (normalizedHandle !== profile.handle.trim().toLowerCase()) {
        try {
          const available = await isHandleAvailable(normalizedHandle);
          if (!available) {
            Alert.alert(
              "Kullanici adi alinmis",
              "Baska bir kullanici adi dene.",
            );
            return;
          }
        } catch {
          Alert.alert(
            "Kullanici adi denetlenemedi",
            "Baglantini kontrol edip tekrar dene.",
          );
          return;
        }
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: nextProfile.name.trim(),
          handle: normalizedHandle,
          bio: nextProfile.bio.trim(),
          avatar_color: nextProfile.color,
          active_frame_id: nextProfile.activeFrameId || null,
          active_profile_theme_id: nextProfile.activeProfileThemeId || null,
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
        title: "Sora yerel veri ozeti",
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
        "Disa aktarma basarisiz",
        "Veri ozeti su an olusturulamadi. Lutfen tekrar dene.",
      );
    }
  };

  const clearLocalData = () => {
    Alert.alert(
      "Cihaz verileri silinsin mi?",
      "Profilin, mesajlarin, odalarin ve tercihlerin bu cihazdan kaldirilacak. Bu islem geri alinamaz.",
      [
        { text: "Vazgec", style: "cancel" },
        {
          text: "Verileri sil",
          style: "destructive",
          onPress: async () => {
            try {
              await clearAllReminders();
              await AsyncStorage.multiRemove(APP_STORAGE_KEYS);
              setRooms(SEEDED_ROOMS);
              setScheduledRooms(SEEDED_SCHEDULED_ROOMS);
              setReminderRoomIds([]);
              setFavoriteRoomIds([]);
              setRecentRoomIds([]);
              setNotifications(SEEDED_NOTIFICATIONS);
              setProfile(DEFAULT_PROFILE);
              setAppSettings(DEFAULT_APP_SETTINGS);
              setWalletBalance(SEEDED_WALLET_BALANCE);
              setDailyRewardClaimed(false);
              setRoom(null);
              setRoomJoined(false);
              setActiveTab("discover");
              setSettingsOpen(false);
              setDataControlsOpen(false);
              setOnboardingOpen(true);
            } catch {
              Alert.alert(
                "Silme basarisiz",
                "Yerel veriler su an silinemedi. Lutfen tekrar dene.",
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
  const myHostedRooms = useMemo(
    () => rooms.filter((item) => item.host === profile.name),
    [rooms, profile.name],
  );
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
    setAccountSecurityOpen(true);
  }, []);
  const handleOpenDataControls = useCallback(() => {
    setSettingsOpen(false);
    setDataControlsOpen(true);
  }, []);
  const handleRefreshWallet = useCallback(
    () =>
      refreshWalletData().catch(() =>
        Alert.alert("Yenilenemedi", "Bağlantını kontrol edip tekrar dene."),
      ),
    [refreshWalletData],
  );

  // --- Kosullu ekranlar (tum hook'lar yukarida cagrildi) ---
  if (brandLaunchVisible || (isSupabaseConfigured && authSession === undefined))
    return (
      <BrandLaunch
        logoSource={SORA_LOGO}
        waiting={isSupabaseConfigured && authSession === undefined}
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
    community: <CommunityScreen currentUserId={authSession?.user?.id} />,
    profile: (
      <Profile
        profile={profile}
        coins={walletBalance}
        favoriteCount={favoriteRoomIds.length}
        hostedRoomCount={hostedRoomCount}
        myRooms={myHostedRooms}
        dailyRewardClaimed={dailyRewardClaimed}
        adminRole={adminRole}
        onEdit={handleOpenProfileEditor}
        onOpenSettings={handleOpenSettings}
        onOpenWallet={handleOpenWallet}
        onOpenAdmin={handleOpenAdmin}
        onClaimDailyReward={claimDailyReward}
      />
    ),
  };
  return (
    <View style={styles.app}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        {screens[activeTab]}
        <BottomNavigation active={activeTab} onChange={setActiveTab} />
      </SafeAreaView>
      {room ? (
        <>
          <Modal
            visible={!roomMinimized}
            animationType="none"
            statusBarTranslucent
            onRequestClose={() => setRoomMinimized(true)}
          >
            <View style={styles.roomOverlay}>
              <Room
                room={room}
                profile={profile}
                userId={authSession?.user?.id}
                accessToken={authSession?.access_token}
                coins={walletBalance}
                onSendGift={sendGift}
                onLeave={leaveCurrentRoom}
                onUpdateRoom={updateRoomSettings}
                isFollowingHost={followedUserIds.includes(room.hostId)}
                onToggleFollowHost={toggleFollowHost}
                initialSpeakerOn={roomPreferences.speakerEnabled}
                initialMicrophoneOn={roomPreferences.microphoneEnabled}
                onHostPresenceChange={setHostRoomPresence}
                onMinimize={() => setRoomMinimized(true)}
                minimized={roomMinimized}
              />
            </View>
          </Modal>
          {roomMinimized ? (
            <RoomMiniBubble
              room={room}
              onExpand={() => setRoomMinimized(false)}
              onLeave={leaveCurrentRoom}
            />
          ) : null}
        </>
      ) : null}
      <CreateRoomSheet
        visible={createOpen}
        onDismiss={handleCloseCreate}
        onCreate={createRoom}
      />
      <ProfileEditor
        visible={profileEditorOpen}
        profile={profile}
        onDismiss={handleCloseProfileEditor}
        onSave={saveProfile}
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
      <AdminPanelSheet
        visible={adminPanelOpen && Boolean(adminRole)}
        role={adminRole}
        onDismiss={handleCloseAdminPanel}
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
  bottomNavigation: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "android" ? 24 : 0,
    height: 77,
    paddingHorizontal: 9,
    paddingTop: 9,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  tabItem: { width: 70, alignItems: "center" },
  tabIconWrap: {
    height: 31,
    width: 45,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
    position: "relative",
  },
  tabIconWrapActive: { backgroundColor: COLORS.primarySoft },
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
  tabLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  tabLabelActive: { color: COLORS.text },
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
    paddingBottom: Platform.OS === "ios" ? 35 : 26,
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
  settingIconActive: { backgroundColor: COLORS.text },
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
    color: "#C7C9D5",
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
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 10,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    ...ELEVATION.raised,
  },
  tabRow: { flexDirection: "row", alignItems: "center", width: "100%" },
  tabItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 51,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    borderRadius: 14,
  },
  tabItemActive: {
    backgroundColor: COLORS.primarySoft,
  },
  tabLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
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

  /* ══ WePlay / Hazan tarzı oda ekranı (koyu tema) ══════════════════ */
  roomScreen: { flex: 1, backgroundColor: "#11131A" },
  roomTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roomTopBarBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  roomTopBarMore: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  roomTopBarCategory: {
    color: "#76AFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  roomTopBarTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 2,
  },
  roomLiveBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  roomLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  roomLivePillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
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
    gap: 10,
    marginBottom: 20,
  },
  roomIdAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  roomIdAvatarGrad: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  roomIdInitial: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
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
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  roomSurface: {
    borderRadius: 26,
    paddingVertical: 22,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  roomBody: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 28,
    gap: 16,
  },
  roomStage: {
    width: "100%",
  },
  roomAvatarWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  roomSpeakerAvatarHost: { borderColor: "rgba(255,216,107,0.9)" },
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
    marginTop: 20,
  },
  roomAudienceSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  roomChatSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
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
    borderColor: "rgba(255,216,107,0.9)",
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
    borderColor: "rgba(255,216,107,0.7)",
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
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  roomFollowBtnActive: {
    backgroundColor: "rgba(255,216,107,0.16)",
    borderColor: "rgba(255,216,107,0.6)",
  },
  roomFollowBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  roomFollowBtnTextActive: { color: "#76AFFF" },
  roomSpeakerGrid: {
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    width: "100%",
  },
  roomSpeakerGridRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    width: "100%",
  },
  roomSpeakerSlot: { width: 62, alignItems: "center", gap: 6 },
  roomSpeakerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
  },
  roomSpeakerAvatarActive: { borderColor: "#76AFFF" },
  roomSpeakerInitial: { color: "#11131A", fontSize: 20, fontWeight: "900" },
  roomMicOnBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#76AFFF",
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
    color: "rgba(255,255,255,0.75)",
    fontSize: 10,
    fontWeight: "700",
  },
  roomSeatNumberBadge: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2F80ED",
    borderWidth: 1,
    borderColor: "#11131A",
  },
  roomSeatNumberText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  roomEmptySeatNumber: { color: "#76AFFF", fontSize: 17, fontWeight: "900" },
  roomEmptySeat: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.22)",
  },
  roomHandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  roomHandBtnActive: { backgroundColor: "#76AFFF", borderColor: "#76AFFF" },
  roomHandBtnEmoji: { fontSize: 14 },
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
    gap: 8,
    marginBottom: 6,
  },
  roomChatTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  roomChatCount: {
    flex: 1,
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "700",
  },
  roomControlBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#171A22",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roomCtrlBtn: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
  },
  roomCtrlBtnOn: { backgroundColor: "rgba(255,216,107,0.16)" },
  roomCtrlLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontWeight: "800",
  },
  roomLeaveBtn: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(217,79,79,0.9)",
  },
  roomTopic: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  roomSectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  roomSectionTitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  roomSectionCount: { color: "#76AFFF", fontSize: 10, fontWeight: "900" },
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
  roomAudienceInitial: { color: "#11131A", fontSize: 16, fontWeight: "900" },
  roomAudienceCrown: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#76AFFF",
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
  giftFlightLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 40,
  },
  giftFlyer: {
    position: "absolute",
    bottom: 168,
    left: "50%",
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  giftFlyerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 196,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(17,19,26,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,216,107,0.4)",
  },
  giftFlyerBannerText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
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
  composerGift: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  composerInput: {
    flex: 1,
    paddingVertical: 6,
    color: "#FFFFFF",
    fontSize: 13,
  },
  messageText: { color: "rgba(255,255,255,0.78)", fontSize: 12, lineHeight: 16 },
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
    paddingTop: 56,
    paddingBottom: 18,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  profileDetailName: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
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
  pfBadgeRow: { flexDirection: "row", gap: 10 },
  pfBadge: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
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
  pfBadgeText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: "800" },
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
  pfTabBadgeText: { color: COLORS.primaryInk, fontSize: 11, fontWeight: "900" },
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
});
