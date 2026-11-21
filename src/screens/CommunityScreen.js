import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  claimFamilyLevelRewards,
  claimSelfGiftBlast,
  computeFamilyLevelProgress,
  createFamily,
  DEFAULT_FAMILY_LEVEL_CONFIGS,
  describeFamilyError,
  FAMILY_COINS_PER_XP,
  FAMILY_CREATION_COST,
  findFamilyByCode,
  getFamilyDetails,
  joinFamily,
  leaveFamily,
  listFamilies,
  listFamilyMembersLite,
  listFamilyMessages,
  listRoomGiftCatalog,
  sendFamilyGift,
  sendFamilyMessage,
  subscribeToCommunities,
  subscribeToFamilyMessages,
  updateFamilyProfile,
} from "../data/soraRepository";
import { describeRoomError, uploadFamilyAvatar, validateFamilyAvatarAsset } from "../room/roomApi";
import { COLORS } from "../theme/colors";
import {
  DEFAULT_GIFT_CATALOG,
  SoraGiftArtwork,
} from "../ui/SoraGiftArtwork";
import { GiftComboButton } from "../ui/GiftComboButton";
import { KeyboardSafeView, useKeyboardInset } from "../ui/useKeyboardInset";
import { SoraGiftEffect } from "../ui/SoraGiftEffect";
import { CoinBlastEffect } from "../ui/CoinBlastEffect";
import { ShimmerSweep } from "../ui/SoraFx";
import { LivePulse } from "../ui/Motion";
import { SoraWealthBadge } from "../ui/SoraWealthTier";
import { useGiftSpentMap } from "../data/wealthStore";

const GIFT_QUANTITIES = [1, 5, 10, 50, 100];
const safeHexAccent = (hex) =>
  typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim() : COLORS.primary;

const resolveGiftIcon = (iconName) => {
  if (!iconName || iconName === "crown") return "trophy";
  if (Ionicons?.glyphMap && !Ionicons.glyphMap[iconName]) return "gift";
  return iconName;
};

const createUuid = () =>
  globalThis.crypto?.randomUUID?.()
  || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16);
    return (ch === "x" ? rand : (rand & 0x3) | 0x8).toString(16);
  });

const TR_NUMBER_FMT = new Intl.NumberFormat("tr-TR");
const TR_TIME_FMT = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

const formatCredits = (value) =>
  TR_NUMBER_FMT.format(Math.max(0, Math.floor(Number(value) || 0)));

const formatMessageTime = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return TR_TIME_FMT.format(date);
};

// Modül seviyesi önbellek — sekme geçişlerinde ve yeniden açılışta 0ms anlık açılış
let cachedFamiliesUserId = null;
let cachedFamiliesList = null;
const familyMessagesCache = new Map();
const familyMembersCache = new Map();
const familyPrefetchInFlight = new Set();

function resetFamilyCachesIfUserChanged(userId) {
  if (userId && cachedFamiliesUserId && cachedFamiliesUserId !== userId) {
    cachedFamiliesList = null;
    familyMessagesCache.clear();
    familyMembersCache.clear();
    familyPrefetchInFlight.clear();
  }
  if (userId) cachedFamiliesUserId = userId;
}

export function prefetchFamilyChat(communityId, currentUserId) {
  if (!communityId || !currentUserId) return;
  resetFamilyCachesIfUserChanged(currentUserId);
  if (familyMessagesCache.has(communityId) || familyPrefetchInFlight.has(communityId)) return;
  familyPrefetchInFlight.add(communityId);
  Promise.all([
    listFamilyMessages({ communityId, currentUserId, limit: 50 })
      .then((rows) => {
        if (Array.isArray(rows)) familyMessagesCache.set(communityId, rows);
      })
      .catch(() => undefined),
    listFamilyMembersLite(communityId)
      .then((members) => {
        if (Array.isArray(members)) familyMembersCache.set(communityId, members);
      })
      .catch(() => undefined),
  ]).finally(() => {
    familyPrefetchInFlight.delete(communityId);
  });
}

const FamilyAvatar = memo(function FamilyAvatar({ uri, name, size = 52, radius = 18 }) {
  const initial = String(name || "A").trim().charAt(0).toUpperCase() || "A";
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: COLORS.primarySoft,
          borderWidth: 1,
          borderColor: COLORS.line,
        }}
      />
    );
  }
  return (
    <LinearGradient
      colors={["#2F80ED", "#1D4E89"]}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: Math.round(size * 0.4), fontWeight: "900" }}>
        {initial}
      </Text>
    </LinearGradient>
  );
});

const MemberAvatar = memo(function MemberAvatar({ uri, name, color = "#2F80ED", size = 38 }) {
  const initial = String(name || "S").trim().charAt(0).toUpperCase() || "S";
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: COLORS.primarySoft,
          borderWidth: 1.5,
          borderColor: "rgba(47,128,237,0.22)",
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color || COLORS.primary,
        borderWidth: 1.5,
        borderColor: "rgba(255,255,255,0.72)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: Math.round(size * 0.38), fontWeight: "900" }}>
        {initial}
      </Text>
    </View>
  );
});

const FamilyMessageRow = memo(function FamilyMessageRow({
  msg,
  knownMember,
  senderSpent,
  profile,
  onOpenUserProfile,
  onOpenGiftSheet,
}) {
  const isGift = msg.kind === "gift";
  const meta = msg.metadata || {};
  const giftColor = meta.gift_color || COLORS.primary;
  const giftIcon = resolveGiftIcon(meta.gift_icon);
  const giftQty = Number(meta.quantity) || 1;
  const giftCost = Number(meta.total_cost) || 0;
  const giftXp = Number(meta.awarded_xp) || 0;

  const resolvedAvatarUrl = msg.own
    ? (profile?.avatarUrl || msg.senderAvatarUrl || knownMember?.avatarUrl || null)
    : (msg.senderAvatarUrl || knownMember?.avatarUrl || null);
  const resolvedSenderName = msg.own
    ? (profile?.name || msg.senderName || "Sen")
    : (msg.senderName || knownMember?.name || "Aile üyesi");
  const resolvedSenderColor = msg.own
    ? (profile?.color || msg.senderColor || COLORS.primary)
    : (msg.senderColor || knownMember?.color || COLORS.primary);

  const handleOpenProfile = useCallback(() => {
    if (msg.userId) onOpenUserProfile?.(msg.userId);
  }, [msg.userId, onOpenUserProfile]);

  const handleLongPressGift = useCallback(() => {
    if (msg.userId) onOpenGiftSheet?.(msg.userId);
  }, [msg.userId, onOpenGiftSheet]);

  const avatarNode = (
    <Pressable
      onPress={handleOpenProfile}
      onLongPress={handleLongPressGift}
      delayLongPress={240}
      style={styles.msgAvatarPress}
      accessibilityRole="button"
      accessibilityLabel={`${resolvedSenderName} profili`}
    >
      <MemberAvatar
        uri={resolvedAvatarUrl}
        name={resolvedSenderName}
        color={resolvedSenderColor}
        size={38}
      />
    </Pressable>
  );

  return (
    <View style={[styles.msgRow, msg.own && styles.msgRowOwn]}>
      {!msg.own ? avatarNode : null}

      <View style={[styles.msgContentCol, msg.own && styles.msgContentColOwn]}>
        {(!msg.own || senderSpent >= 1000000) ? (
          <View
            style={[
              styles.msgSenderRow,
              msg.own && { flexDirection: "row-reverse" },
            ]}
          >
            <Text numberOfLines={1} style={styles.msgSender}>
              {resolvedSenderName}
            </Text>
            {senderSpent >= 1000000 ? (
              <SoraWealthBadge spent={senderSpent} size="sm" animated={false} />
            ) : null}
          </View>
        ) : null}

        {isGift ? (
          <Pressable
            onLongPress={handleLongPressGift}
            delayLongPress={240}
            style={({ pressed }) => [
              styles.giftMsgCard,
              msg.own && styles.giftMsgCardOwn,
              pressed && { opacity: 0.9 },
            ]}
          >
            <SoraGiftArtwork
              giftId={meta.gift_id}
              giftName={meta.gift_name}
              fallbackIcon={giftIcon}
              fallbackColor={giftColor}
              size={42}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.giftMsgTitle}>
                {giftQty > 1 ? `${giftQty}x ` : ""}
                {meta.gift_name || "Aile Hediyesi"}
              </Text>
              <Text style={styles.giftMsgBody}>{msg.text}</Text>
              <View style={styles.giftMsgMetaRow}>
                {giftCost > 0 ? (
                  <Text style={styles.giftMsgMetaChip}>
                    {formatCredits(giftCost)} kredi
                  </Text>
                ) : null}
                {giftXp > 0 ? (
                  <Text style={styles.giftMsgXpChip}>
                    +{formatCredits(giftXp)} XP
                  </Text>
                ) : null}
                <Text style={styles.giftMsgTime}>{formatMessageTime(msg.createdAt)}</Text>
              </View>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onLongPress={handleLongPressGift}
            delayLongPress={240}
            style={({ pressed }) => [
              styles.msgBubble,
              msg.own ? styles.msgBubbleOwn : styles.msgBubbleOther,
              pressed && { opacity: 0.88 },
            ]}
          >
            <View style={styles.msgInlineRow}>
              <Text style={[styles.msgText, msg.own && styles.msgTextOwn]}>
                {msg.text}
              </Text>
              <Text style={[styles.msgTime, msg.own && styles.msgTimeOwn]}>
                {formatMessageTime(msg.createdAt)}
              </Text>
            </View>
          </Pressable>
        )}
      </View>

      {msg.own ? avatarNode : null}
    </View>
  );
});

const FamilyChatComposer = memo(function FamilyChatComposer({
  currentUserId,
  profile,
  sendingMessage,
  onSendText,
  onOpenGiftSheet,
  onOpenUserProfile,
  bottomMargin,
}) {
  const [draft, setDraft] = useState("");
  const canSend = !sendingMessage && !!draft.trim();

  const handleSend = useCallback(async () => {
    const cleanText = draft.trim();
    if (!cleanText || sendingMessage) return;
    const ok = await onSendText(cleanText);
    if (ok) setDraft("");
  }, [draft, onSendText, sendingMessage]);

  const handleAvatarPress = useCallback(() => {
    if (currentUserId) onOpenUserProfile?.(currentUserId);
  }, [currentUserId, onOpenUserProfile]);

  const handleGiftPress = useCallback(() => {
    onOpenGiftSheet?.(null);
  }, [onOpenGiftSheet]);

  return (
    <View style={[styles.composerRow, { marginBottom: bottomMargin }]}>
      <Pressable
        onPress={handleAvatarPress}
        style={styles.composerAvatarWrap}
        accessibilityRole="button"
        accessibilityLabel="Profil fotoğrafın"
      >
        <MemberAvatar
          uri={profile?.avatarUrl || null}
          name={profile?.name || "Sen"}
          color={profile?.color || COLORS.primary}
          size={38}
        />
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Ailene mesaj yaz..."
        placeholderTextColor={COLORS.muted}
        maxLength={1000}
        multiline
        style={styles.composerInput}
      />
      <Pressable
        onPress={handleGiftPress}
        accessibilityLabel="Hediye kutusu"
        style={({ pressed }) => [
          styles.composerGiftBtn,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
      >
        <LinearGradient
          colors={["#52A5FF", "#2F80ED", "#7C3AED"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
        />
        <Ionicons name="gift" size={19} color="#FFFFFF" />
      </Pressable>
      <Pressable
        disabled={!canSend}
        onPress={handleSend}
        accessibilityLabel="Mesaj gönder"
        style={({ pressed }) => [
          styles.sendBtn,
          !canSend && styles.sendBtnDisabled,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
      >
        <LinearGradient
          colors={["#52A5FF", "#2F80ED", "#1D5FBF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
        />
        {sendingMessage ? (
          <ActivityIndicator size="small" color={COLORS.primaryInk} />
        ) : (
          <Ionicons name="send" size={17} color={COLORS.primaryInk} />
        )}
      </Pressable>
    </View>
  );
});

export const CommunityScreen = memo(function CommunityScreen({
  currentUserId,
  profile,
  initialFamily = null,
  rooms = [],
  onOpenRoom,
  coins = 0,
  coinBlastEvent = null,
  onReserveGiftSpend,
  onSettleGiftSpend,
  onRollbackGiftSpend,
  onApplyWalletBalance,
  onCoinBlast,
  onGiftSpent,
  onBalanceRefresh,
  onFamilyChange,
  onOpenUserProfile,
}) {
  resetFamilyCachesIfUserChanged(currentUserId);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const [families, setFamilies] = useState(() => {
    if (Array.isArray(cachedFamiliesList) && cachedFamiliesList.length > 0) {
      return cachedFamiliesList;
    }
    return initialFamily ? [{ ...initialFamily, joined: true }] : [];
  });
  const [loading, setLoading] = useState(
    () => !(Array.isArray(cachedFamiliesList) && cachedFamiliesList.length > 0) && !initialFamily,
  );
  const [error, setError] = useState("");

  // Arama ve keşfet
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingCode, setSearchingCode] = useState(false);
  const [codeLookupResult, setCodeLookupResult] = useState(null);
  const [codeLookupMessage, setCodeLookupMessage] = useState("");
  const [discoverModalOpen, setDiscoverModalOpen] = useState(false);

  // Detay ve yönetim modalı
  const [selectedFamilyId, setSelectedFamilyId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailTab, setDetailTab] = useState("levels");
  const [joiningBusy, setJoiningBusy] = useState(false);
  const [leavingBusy, setLeavingBusy] = useState(false);
  const [syncingRewards, setSyncingRewards] = useState(false);

  // Aile kurma modalı
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createAvatarAsset, setCreateAvatarAsset] = useState(null);
  const [creating, setCreating] = useState(false);
  const createInFlightRef = useRef(false);
  const createAttemptKeyRef = useRef(null);
  const createFingerprintRef = useRef("");

  // Aile düzenleme (kurucu)
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAvatarAsset, setEditAvatarAsset] = useState(null);
  const [editClearAvatar, setEditClearAvatar] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Aile sohbeti ve üyeler
  const initialFamilyId =
    (Array.isArray(cachedFamiliesList) ? cachedFamiliesList.find((item) => item.joined)?.id : null)
    || initialFamily?.id
    || null;
  const [messages, setMessages] = useState(
    () => (initialFamilyId ? familyMessagesCache.get(initialFamilyId) || [] : []),
  );
  const [familyMembers, setFamilyMembers] = useState(
    () => (initialFamilyId ? familyMembersCache.get(initialFamilyId) || [] : []),
  );
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const sendInFlightRef = useRef(false);
  const draftMessageIdRef = useRef(null);
  const draftFingerprintRef = useRef("");
  const chatScrollRef = useRef(null);
  const memberByIdRef = useRef(new Map());

  const scrollToLatest = useCallback((animated = true) => {
    chatScrollRef.current?.scrollToOffset?.({ offset: 0, animated });
  }, []);

  // Aile hediye kutusu
  const [giftCatalog, setGiftCatalog] = useState(DEFAULT_GIFT_CATALOG);
  const [selectedGiftId, setSelectedGiftId] = useState(DEFAULT_GIFT_CATALOG[0]?.id || null);
  const [giftSheetOpen, setGiftSheetOpen] = useState(false);
  const [giftRecipientId, setGiftRecipientId] = useState(null);
  const [giftQuantity, setGiftQuantity] = useState(1);
  const [sendingGift, setSendingGift] = useState(false);
  const [comboState, setComboState] = useState(null);
  const [giftEffect, setGiftEffect] = useState(null);
  const playedGiftIdsRef = useRef(new Set());
  const playGiftEffect = useCallback((gift) => {
    const eventId = gift?.eventId;
    if (!eventId || playedGiftIdsRef.current.has(eventId)) return;
    playedGiftIdsRef.current.add(eventId);
    if (playedGiftIdsRef.current.size > 160) {
      playedGiftIdsRef.current.delete(playedGiftIdsRef.current.values().next().value);
    }
    setGiftEffect({ ...gift, stamp: Date.now() });
  }, []);

  const visibleGiftCatalog = giftCatalog;

  const myFamily = useMemo(
    () => families.find((item) => item.joined) || null,
    [families],
  );
  useEffect(() => {
    playedGiftIdsRef.current.clear();
    setGiftEffect(null);
  }, [myFamily?.id]);

  useEffect(() => {
    if (initialFamily?.id && families.length === 0) {
      setFamilies([{ ...initialFamily, joined: true }]);
      setLoading(false);
    }
  }, [initialFamily, families.length]);

  useEffect(() => {
    if (keyboard.visible && myFamily?.id) {
      const timer = setTimeout(() => {
        scrollToLatest(true);
      }, 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [keyboard.visible, myFamily?.id, scrollToLatest]);

  useEffect(() => {
    onFamilyChange?.(myFamily);
  }, [myFamily, onFamilyChange]);

  const loadFamilies = useCallback(async ({ silent = false } = {}) => {
    if (!currentUserId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const rows = await listFamilies(currentUserId);
      cachedFamiliesUserId = currentUserId;
      cachedFamiliesList = rows;
      setFamilies(rows);
    } catch (loadErr) {
      setError(describeFamilyError(loadErr));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    const hasSeed =
      (Array.isArray(cachedFamiliesList) && cachedFamiliesList.length > 0) || Boolean(initialFamily);
    loadFamilies({ silent: hasSeed });
    if (!currentUserId) return undefined;
    const unsubscribe = subscribeToCommunities(() => {
      loadFamilies({ silent: true });
    });
    return unsubscribe;
  }, [currentUserId, loadFamilies]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    let active = true;
    listRoomGiftCatalog()
      .then((items) => {
        if (active && Array.isArray(items) && items.length > 0) {
          setGiftCatalog(items);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const loadMessages = useCallback(async (communityId, { silent = false } = {}) => {
    if (!communityId || !currentUserId) return;
    const cachedMsgs = familyMessagesCache.get(communityId);
    const cachedMems = familyMembersCache.get(communityId);
    if (cachedMsgs) {
      setMessages(cachedMsgs);
    }
    if (cachedMems) {
      setFamilyMembers(cachedMems);
    }
    const showSpinner = !silent && !cachedMsgs;
    if (showSpinner) setMessagesLoading(true);
    setMessagesError("");

    // Üye listesini sohbeti bekletmeden paralel yükle (tek hafif sorgu)
    listFamilyMembersLite(communityId)
      .then((members) => {
        if (Array.isArray(members)) {
          familyMembersCache.set(communityId, members);
          setFamilyMembers(members);
        }
      })
      .catch(() => undefined);

    try {
      const rows = await listFamilyMessages({ communityId, currentUserId, limit: 50 });
      familyMessagesCache.set(communityId, rows);
      setMessages(rows);
    } catch (msgErr) {
      if (!cachedMsgs) {
        setMessagesError(describeFamilyError(msgErr, "Aile sohbeti yüklenemedi."));
      }
    } finally {
      if (showSpinner) setMessagesLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!myFamily?.id || !currentUserId) {
      setMessages([]);
      setFamilyMembers([]);
      setMessagesError("");
      return undefined;
    }
    loadMessages(myFamily.id);
    const communityId = myFamily.id;
    const unsubscribe = subscribeToFamilyMessages({
      communityId,
      onMessage: (incoming) => {
        if (incoming.kind === "gift" && incoming.metadata?.gift_id) {
          const meta = incoming.metadata;
          playGiftEffect({
            id: meta.gift_id,
            name: meta.gift_name || "Hediye",
            color: meta.gift_color,
            recipientName: meta.recipient_name,
            quantity: Number(meta.quantity) || 1,
            eventId: incoming.id,
          });
        }
        const isOwn = incoming.userId === currentUserId;
        const known = incoming.userId ? memberByIdRef.current.get(incoming.userId) : null;
        setMessages((prev) => {
          if (prev.some((item) => item.id === incoming.id)) return prev;
          const next = [
            ...prev,
            {
              id: incoming.id,
              communityId: incoming.communityId,
              userId: incoming.userId,
              senderName: isOwn ? (profile?.name || "Sen") : (known?.name || null),
              senderHandle: isOwn ? (profile?.handle || "sora") : (known?.handle || "uye"),
              senderColor: isOwn ? (profile?.color || COLORS.primary) : (known?.color || COLORS.primary),
              senderAvatarUrl: isOwn ? (profile?.avatarUrl || null) : (known?.avatarUrl || null),
              text: incoming.text,
              kind: incoming.kind || "text",
              metadata: incoming.metadata || {},
              own: isOwn,
              createdAt: incoming.createdAt,
            },
          ];
          familyMessagesCache.set(communityId, next);
          return next;
        });
        if (!isOwn && !known) {
          listFamilyMembersLite(communityId)
            .then((members) => {
              if (Array.isArray(members)) {
                familyMembersCache.set(communityId, members);
                setFamilyMembers(members);
              }
            })
            .catch(() => undefined);
        }
      },
    });
    return unsubscribe;
  }, [
    currentUserId,
    loadMessages,
    myFamily?.id,
    playGiftEffect,
    profile?.avatarUrl,
    profile?.color,
    profile?.handle,
    profile?.name,
  ]);

  // Hediye alıcıları: önce kullanıcının kendisi (profil fotoğrafıyla), ardından diğer aile üyeleri
  const giftRecipients = useMemo(() => {
    if (!currentUserId) return [];
    const byId = new Map();
    byId.set(currentUserId, {
      userId: currentUserId,
      name: profile?.name || "Kendim",
      handle: profile?.handle || "sora",
      avatarUrl: profile?.avatarUrl || null,
      color: profile?.color || COLORS.primary,
      isSelf: true,
    });
    for (const m of familyMembers) {
      if (!m?.userId) continue;
      if (m.userId === currentUserId) {
        const selfItem = byId.get(currentUserId);
        byId.set(currentUserId, {
          ...selfItem,
          name: m.name || selfItem.name,
          avatarUrl: m.avatarUrl || selfItem.avatarUrl,
          color: m.color || selfItem.color,
        });
      } else {
        byId.set(m.userId, {
          userId: m.userId,
          name: m.name || "Aile üyesi",
          handle: m.handle || "sora",
          avatarUrl: m.avatarUrl || null,
          color: m.color || COLORS.primary,
          isSelf: false,
        });
      }
    }
    for (const msg of messages) {
      if (msg?.userId && !byId.has(msg.userId)) {
        byId.set(msg.userId, {
          userId: msg.userId,
          name: msg.senderName || "Aile üyesi",
          handle: msg.senderHandle || "sora",
          avatarUrl: msg.senderAvatarUrl || null,
          color: msg.senderColor || COLORS.primary,
          isSelf: msg.userId === currentUserId,
        });
      }
    }
    return Array.from(byId.values());
  }, [currentUserId, familyMembers, messages, profile?.avatarUrl, profile?.color, profile?.handle, profile?.name]);

  const openGiftSheet = useCallback((targetUserId = null) => {
    if (!myFamily?.id || !currentUserId) return;
    const preferred =
      targetUserId
      || giftRecipients.find((item) => item.isSelf)?.userId
      || currentUserId;
    setGiftRecipientId(preferred);
    setGiftQuantity(1);
    setSelectedGiftId((prev) =>
      giftCatalog.some((item) => item.id === prev) ? prev : giftCatalog[0]?.id || null,
    );
    setComboState(null);
    setGiftSheetOpen(true);
    listFamilyMembersLite(myFamily.id)
      .then((members) => {
        if (Array.isArray(members)) {
          familyMembersCache.set(myFamily.id, members);
          setFamilyMembers(members);
        }
      })
      .catch(() => undefined);
  }, [currentUserId, giftCatalog, giftRecipients, myFamily?.id]);

  const selectedGiftRecipient = useMemo(
    () =>
      giftRecipients.find((item) => item.userId === giftRecipientId)
      || giftRecipients[0]
      || null,
    [giftRecipientId, giftRecipients],
  );

  const selectedGift = useMemo(
    () =>
      visibleGiftCatalog.find((item) => item.id === selectedGiftId)
      || visibleGiftCatalog[0]
      || null,
    [selectedGiftId, visibleGiftCatalog],
  );

  const pendingGiftSpendRef = useRef(0);
  const sendingGiftCountRef = useRef(0);

  const executeSendFamilyGift = useCallback(async ({ gift, recipient, quantity }) => {
    if (!myFamily?.id || !gift || !recipient?.userId) return false;
    const totalCost = Math.max(0, Number(gift.cost || 0) * Number(quantity || 1));
    let settled = false;
    onReserveGiftSpend?.(totalCost);
    pendingGiftSpendRef.current += totalCost;
    sendingGiftCountRef.current += 1;
    setSendingGift(true);
    try {
      const requestId = createUuid();
      const result = await sendFamilyGift({
        communityId: myFamily.id,
        giftId: gift.id,
        recipientId: recipient.userId,
        quantity,
        requestId,
      });
      settled = true;
      onSettleGiftSpend?.(totalCost, result.balance);
      onGiftSpent?.(Number(result.giftCost || result.gift_cost || totalCost));
      playGiftEffect({
        ...gift,
        name: result.giftName || gift.name,
        recipientName: recipient.name,
        quantity,
        eventId: result.messageId || requestId,
      });

      if (result.messageId) {
        const communityId = myFamily.id;
        setMessages((prev) => {
          if (prev.some((item) => item.id === result.messageId)) return prev;
          const next = [
            ...prev,
            {
              id: result.messageId,
              communityId,
              userId: currentUserId,
              senderName: profile?.name || "Sen",
              senderHandle: profile?.handle || "sora",
              senderColor: profile?.color || COLORS.primary,
              senderAvatarUrl: profile?.avatarUrl || null,
              text: result.messageBody,
              kind: "gift",
              metadata: result.messageMetadata || {},
              own: true,
              createdAt: result.createdAt,
            },
          ];
          familyMessagesCache.set(communityId, next);
          return next;
        });
      }

      setFamilies((prev) => {
        const next = prev.map((item) =>
          item.id === myFamily.id
            ? {
                ...item,
                xp: typeof result.familyXp === "number" ? result.familyXp : item.xp,
                level: typeof result.familyLevel === "number" ? result.familyLevel : item.level,
                giftCoinsTotal:
                  typeof result.giftCoinsTotal === "number"
                    ? result.giftCoinsTotal
                    : item.giftCoinsTotal,
              }
            : item,
        );
        cachedFamiliesList = next;
        return next;
      });

      requestAnimationFrame(() => {
        scrollToLatest(true);
      });
      if (recipient.userId === currentUserId) {
        const blast = await claimSelfGiftBlast(requestId).catch(() => null);
        const reward = Number(blast?.reward_amount || 0);
        if (blast?.balance !== null && blast?.balance !== undefined) {
          onApplyWalletBalance?.(Number(blast.balance));
        }
        if (reward > 0) {
          const multiplier = Number(blast.multiplier_basis || 0) / 100;
          onCoinBlast?.({ reward, multiplier });
        }
      }
      onBalanceRefresh?.().catch?.(() => undefined);
      return true;
    } catch (err) {
      if (!settled) {
        settled = true;
        onRollbackGiftSpend?.(totalCost);
      }
      setComboState(null);
      Alert.alert("Hediye gönderilemedi", describeFamilyError(err));
      onBalanceRefresh?.().catch?.(() => undefined);
      return false;
    } finally {
      pendingGiftSpendRef.current = Math.max(0, pendingGiftSpendRef.current - totalCost);
      sendingGiftCountRef.current = Math.max(0, sendingGiftCountRef.current - 1);
      setSendingGift(sendingGiftCountRef.current > 0);
    }
  }, [
    currentUserId,
    myFamily?.id,
    onApplyWalletBalance,
    onBalanceRefresh,
    onCoinBlast,
    onReserveGiftSpend,
    onRollbackGiftSpend,
    onSettleGiftSpend,
    playGiftEffect,
    profile?.avatarUrl,
    profile?.color,
    profile?.handle,
    profile?.name,
  ]);

  const handleSendSelectedGift = useCallback(() => {
    const gift = selectedGift;
    if (!myFamily?.id || !gift || sendingGift) return;
    const recipient = selectedGiftRecipient;
    if (!recipient?.userId) {
      Alert.alert("Alıcı seç", "Hediyeyi göndereceğin kişiyi seç.");
      return;
    }
    const reqLevel = Number(gift.minFamilyLevel || 0);
    if (reqLevel > 0 && Number(myFamily.level || 1) < reqLevel) {
      Alert.alert(
        "Aile seviyesi gerekli",
        `Bu hediyeyi göndermek için ailenin en az Seviye ${reqLevel} olması gerekiyor.`,
      );
      return;
    }
    const totalCost = Number(gift.cost || 0) * giftQuantity;
    const availableCoins = typeof coins === "number" ? Math.max(0, coins) : Infinity;
    if (availableCoins < totalCost) {
      Alert.alert(
        "Bakiye yetersiz",
        `${giftQuantity}x ${gift.name} için ${formatCredits(totalCost)} kredi gerekiyor.`,
      );
      return;
    }

    setGiftSheetOpen(false);
    setComboState({
      gift,
      recipient,
      quantity: giftQuantity,
      count: 1,
      triggerKey: Date.now(),
    });
    executeSendFamilyGift({ gift, recipient, quantity: giftQuantity });
  }, [
    coins,
    executeSendFamilyGift,
    giftQuantity,
    myFamily?.id,
    myFamily?.level,
    selectedGift,
    selectedGiftRecipient,
    sendingGift,
  ]);

  const handleComboGiftPress = useCallback(() => {
    if (!comboState?.gift || !comboState?.recipient?.userId) return;
    const { gift, recipient, quantity } = comboState;
    const totalCost = Number(gift.cost || 0) * quantity;
    const availableCoins = typeof coins === "number" ? Math.max(0, coins) : Infinity;
    if (availableCoins < totalCost) {
      setComboState(null);
      Alert.alert(
        "Bakiye yetersiz",
        `${quantity}x ${gift.name} için ${formatCredits(totalCost)} kredi gerekiyor.`,
      );
      return;
    }
    setComboState((prev) =>
      prev
        ? {
            ...prev,
            count: (prev.count || 1) + 1,
            triggerKey: Date.now() + Math.random(),
          }
        : null,
    );
    executeSendFamilyGift({ gift, recipient, quantity });
  }, [coins, comboState, executeSendFamilyGift]);

  const handleExpireCombo = useCallback(() => {
    setComboState(null);
  }, []);

  const openFamilyDetail = useCallback(async (familyId, initialTab = "levels") => {
    if (!familyId) return;
    if (discoverModalOpen) {
      setDiscoverModalOpen(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    setSelectedFamilyId(familyId);
    setDetailTab(initialTab);
    setDetailLoading(true);
    setDetailError("");
    try {
      const data = await getFamilyDetails(familyId, currentUserId);
      setDetailData(data);
      if (data?.family) {
        setEditName(data.family.name || "");
        setEditDescription(data.family.description || "");
        setEditAvatarAsset(null);
        setEditClearAvatar(false);
        if (data.family.id === myFamily?.id && data.members) {
          setFamilyMembers(data.members);
        }
      }
    } catch (err) {
      setDetailError(describeFamilyError(err));
    } finally {
      setDetailLoading(false);
    }
  }, [currentUserId, myFamily?.id]);

  const closeFamilyDetail = useCallback(() => {
    setSelectedFamilyId(null);
    setDetailData(null);
    setDetailError("");
  }, []);

  const normalizedDigits = useMemo(
    () => searchQuery.replace(/\D/g, "").trim(),
    [searchQuery],
  );

  const filteredFamilies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return families;
    return families.filter((item) => {
      const nameMatch = String(item.name || "").toLowerCase().includes(q);
      const codeMatch = item.familyCode && String(item.familyCode).includes(normalizedDigits || q);
      return Boolean(nameMatch || codeMatch);
    });
  }, [families, normalizedDigits, searchQuery]);

  const handleSearchById = useCallback(async () => {
    if (searchingCode) return;
    setCodeLookupMessage("");
    setCodeLookupResult(null);
    if (!/^[1-9][0-9]{7}$/.test(normalizedDigits)) {
      setCodeLookupMessage("8 haneli Aile ID gir.");
      return;
    }
    setSearchingCode(true);
    try {
      const found = await findFamilyByCode(normalizedDigits, currentUserId);
      if (!found) {
        setCodeLookupMessage("Aile bulunamadı.");
      } else {
        setCodeLookupResult(found);
      }
    } catch (err) {
      setCodeLookupMessage(describeFamilyError(err));
    } finally {
      setSearchingCode(false);
    }
  }, [currentUserId, normalizedDigits, searchingCode]);

  const pickAvatarImage = useCallback(async (onPicked) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("İzin gerekli", "Aile fotoğrafı seçmek için galeri izni vermelisin.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      validateFamilyAvatarAsset(asset);
      onPicked(asset);
    } catch (err) {
      Alert.alert("Görsel seçilemedi", describeRoomError(err, err?.message || "Başka bir görsel dene."));
    }
  }, []);

  const handleCreateFamily = useCallback(async () => {
    if (createInFlightRef.current || creating) return;
    const cleanName = createName.trim();
    const cleanDesc = createDescription.trim();
    if (cleanName.length < 3 || cleanName.length > 40) {
      Alert.alert("Geçersiz aile adı", "Aile adı 3 ile 40 karakter arasında olmalı.");
      return;
    }
    if (myFamily) {
      Alert.alert("Zaten bir ailedesin", "Yeni bir aile kurmadan önce mevcut ailenden ayrılmalısın.");
      return;
    }
    if (typeof coins === "number" && coins < FAMILY_CREATION_COST) {
      Alert.alert("Bakiye yetersiz", "Aile kurmak için hesabında en az 10.000.000 kredi bulunmalı.");
      return;
    }

    createInFlightRef.current = true;
    setCreating(true);
    try {
      let uploadedAvatarUrl = null;
      if (createAvatarAsset?.uri) {
        uploadedAvatarUrl = await uploadFamilyAvatar({
          userId: currentUserId,
          asset: createAvatarAsset,
        });
      }
      const fingerprint = `${cleanName.toLowerCase()}|${cleanDesc}|${uploadedAvatarUrl || ""}`;
      if (createFingerprintRef.current !== fingerprint || !createAttemptKeyRef.current) {
        createFingerprintRef.current = fingerprint;
        createAttemptKeyRef.current = createUuid();
      }

      await createFamily({
        name: cleanName,
        description: cleanDesc,
        avatarUrl: uploadedAvatarUrl,
        requestId: createAttemptKeyRef.current,
      });

      createAttemptKeyRef.current = null;
      createFingerprintRef.current = "";
      setCreateName("");
      setCreateDescription("");
      setCreateAvatarAsset(null);
      setCreateOpen(false);
      await Promise.all([
        loadFamilies({ silent: true }),
        onBalanceRefresh?.(),
      ]);
    } catch (err) {
      Alert.alert("Aile kurulamadı", describeFamilyError(err));
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  }, [
    coins,
    createAvatarAsset,
    createDescription,
    createName,
    creating,
    currentUserId,
    loadFamilies,
    myFamily,
    onBalanceRefresh,
  ]);

  const handleJoinFamily = useCallback(async (targetFamily) => {
    if (!targetFamily?.id || joiningBusy) return;
    if (myFamily && myFamily.id !== targetFamily.id) {
      Alert.alert("Tek aile kuralı", "Aynı anda yalnızca bir aileye üye olabilirsin. Önce mevcut ailenden ayrılmalısın.");
      return;
    }
    setJoiningBusy(true);
    try {
      await joinFamily(targetFamily.id);
      closeFamilyDetail();
      setDiscoverModalOpen(false);
      await loadFamilies({ silent: true });
    } catch (err) {
      Alert.alert("Katılım tamamlanamadı", describeFamilyError(err));
    } finally {
      setJoiningBusy(false);
    }
  }, [closeFamilyDetail, joiningBusy, loadFamilies, myFamily]);

  const handleLeaveFamily = useCallback((targetFamily) => {
    if (!targetFamily?.id || leavingBusy) return;
    if (targetFamily.role === "owner") {
      Alert.alert("Aile kurucususun", "Kurucusu olduğun aileden ayrılamazsın.");
      return;
    }
    Alert.alert(
      "Aileden ayrıl",
      `${targetFamily.name} ailesinden ayrılmak istediğine emin misin?`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Ayrıl",
          style: "destructive",
          onPress: async () => {
            setLeavingBusy(true);
            try {
              await leaveFamily(targetFamily.id);
              closeFamilyDetail();
              await loadFamilies({ silent: true });
            } catch (err) {
              Alert.alert("İşlem tamamlanamadı", describeFamilyError(err));
            } finally {
              setLeavingBusy(false);
            }
          },
        },
      ],
    );
  }, [closeFamilyDetail, leavingBusy, loadFamilies]);

  const handleSaveFamilyEdit = useCallback(async () => {
    if (!detailData?.family?.id || savingEdit) return;
    const cleanName = editName.trim();
    const cleanDesc = editDescription.trim();
    if (cleanName.length < 3 || cleanName.length > 40) {
      Alert.alert("Geçersiz aile adı", "Aile adı 3 ile 40 karakter arasında olmalı.");
      return;
    }
    setSavingEdit(true);
    try {
      let nextAvatarUrl = null;
      if (editAvatarAsset?.uri) {
        nextAvatarUrl = await uploadFamilyAvatar({
          userId: currentUserId,
          asset: editAvatarAsset,
        });
      }
      await updateFamilyProfile({
        communityId: detailData.family.id,
        name: cleanName,
        description: cleanDesc,
        avatarUrl: nextAvatarUrl,
        clearAvatar: editClearAvatar && !nextAvatarUrl,
      });
      await Promise.all([
        loadFamilies({ silent: true }),
        openFamilyDetail(detailData.family.id, "levels"),
      ]);
    } catch (err) {
      Alert.alert("Güncellenemedi", describeFamilyError(err));
    } finally {
      setSavingEdit(false);
    }
  }, [
    currentUserId,
    detailData?.family?.id,
    editAvatarAsset,
    editClearAvatar,
    editDescription,
    editName,
    loadFamilies,
    openFamilyDetail,
    savingEdit,
  ]);

  const handleSendText = useCallback(async (rawText) => {
    if (!myFamily?.id || sendInFlightRef.current || sendingMessage) return false;
    const cleanText = String(rawText || "").trim();
    if (!cleanText) return false;

    sendInFlightRef.current = true;
    setSendingMessage(true);
    try {
      if (draftFingerprintRef.current !== cleanText || !draftMessageIdRef.current) {
        draftFingerprintRef.current = cleanText;
        draftMessageIdRef.current = createUuid();
      }
      const communityId = myFamily.id;
      const sent = await sendFamilyMessage({
        communityId,
        text: cleanText,
        clientMessageId: draftMessageIdRef.current,
      });
      draftMessageIdRef.current = null;
      draftFingerprintRef.current = "";
      setMessages((prev) => {
        if (prev.some((item) => item.id === sent.id)) return prev;
        const next = [
          ...prev,
          {
            id: sent.id,
            communityId: sent.communityId,
            userId: sent.userId,
            senderName: profile?.name || "Sen",
            senderHandle: profile?.handle || "sora",
            senderColor: profile?.color || COLORS.primary,
            senderAvatarUrl: profile?.avatarUrl || null,
            text: sent.text,
            kind: sent.kind || "text",
            metadata: sent.metadata || {},
            own: true,
            createdAt: sent.createdAt,
          },
        ];
        familyMessagesCache.set(communityId, next);
        return next;
      });
      requestAnimationFrame(() => {
        scrollToLatest(true);
      });
      return true;
    } catch (err) {
      Alert.alert("Mesaj gönderilemedi", describeFamilyError(err));
      return false;
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  }, [
    myFamily?.id,
    profile?.avatarUrl,
    profile?.color,
    profile?.handle,
    profile?.name,
    scrollToLatest,
    sendingMessage,
  ]);

  const handleSyncRewards = useCallback(async () => {
    const targetId = detailData?.family?.id || myFamily?.id;
    if (!targetId || syncingRewards) return;
    setSyncingRewards(true);
    try {
      const grantedCount = await claimFamilyLevelRewards(targetId);
      if (detailData?.family?.id) {
        const refreshed = await getFamilyDetails(detailData.family.id, currentUserId);
        setDetailData(refreshed);
      }
      Alert.alert(
        "Ödüller kontrol edildi",
        grantedCount > 0
          ? `${grantedCount} yeni aile seviye ödülü hesabına tanımlandı. Profil düzenleme ekranından çerçevelerini kullanabilirsin.`
          : "Mevcut aile seviyesindeki tüm ödüllerin hesabında tanımlı.",
      );
    } catch (err) {
      Alert.alert("Ödüller eşitlenemedi", describeFamilyError(err));
    } finally {
      setSyncingRewards(false);
    }
  }, [currentUserId, detailData?.family?.id, myFamily?.id, syncingRewards]);

  const renderFamilyCard = (family) => (
    <Pressable
      key={family.id}
      onPress={() => openFamilyDetail(family.id, "levels")}
      style={({ pressed }) => [styles.familyCard, pressed && styles.cardPressed]}
    >
      <FamilyAvatar uri={family.avatarUrl} name={family.name} size={54} radius={18} />
      <View style={styles.familyCardBody}>
        <View style={styles.familyCardTitleRow}>
          <Text numberOfLines={1} style={styles.familyCardTitle}>
            {family.name}
          </Text>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>Sv. {family.level}</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={styles.familyCardDesc}>
          {family.description || "Aile açıklaması henüz eklenmemiş."}
        </Text>
        <View style={styles.familyCardMetaRow}>
          <View style={styles.metaChip}>
            <Ionicons name="people-outline" size={12} color={COLORS.primary} />
            <Text style={styles.metaChipText}>{family.memberCount} üye</Text>
          </View>
          {family.familyCode ? (
            <View style={styles.metaChip}>
              <Ionicons name="finger-print-outline" size={12} color={COLORS.textSecondary} />
              <Text style={styles.metaChipText}>ID: {family.familyCode}</Text>
            </View>
          ) : null}
          {family.joined ? (
            <View style={[styles.metaChip, styles.metaChipActive]}>
              <Text style={[styles.metaChipText, { color: COLORS.primary }]}>Üyesin</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
    </Pressable>
  );

  // ID arama ve keşfet alanı — açıklama metni olmadan sade
  const renderDiscoverContent = ({ insideModal = false } = {}) => (
    <View style={{ flex: 1 }}>
      <View style={styles.searchSection}>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={COLORS.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={(val) => {
              setSearchQuery(val);
              if (codeLookupMessage) setCodeLookupMessage("");
              if (codeLookupResult) setCodeLookupResult(null);
            }}
            placeholder="Aile ID ara"
            placeholderTextColor={COLORS.muted}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (/^[1-9][0-9]{7}$/.test(normalizedDigits)) {
                handleSearchById();
              }
            }}
            style={styles.searchInput}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => {
                setSearchQuery("");
                setCodeLookupResult(null);
                setCodeLookupMessage("");
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
        {normalizedDigits.length === 8 ? (
          <Pressable
            disabled={searchingCode}
            onPress={handleSearchById}
            style={styles.idSearchButton}
          >
            {searchingCode ? (
              <ActivityIndicator size="small" color={COLORS.primaryInk} />
            ) : (
              <Text style={styles.idSearchButtonText}>ID Ara</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {codeLookupMessage ? (
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.primary} />
          <Text style={styles.infoNoteText}>{codeLookupMessage}</Text>
        </View>
      ) : null}

      {codeLookupResult ? (
        <View style={{ paddingHorizontal: 18, marginTop: 10 }}>
          {renderFamilyCard(codeLookupResult)}
        </View>
      ) : null}

      {error ? (
        <Pressable onPress={() => loadFamilies()} style={styles.errorBanner}>
          <Ionicons name="refresh-outline" size={17} color={COLORS.danger} />
          <Text style={styles.errorText}>{error} Yeniden dene.</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Aileler yükleniyor...</Text>
        </View>
      ) : !filteredFamilies.length ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="shield-outline" size={30} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>
            {searchQuery.trim() ? "Aile bulunamadı" : "Henüz kurulmuş bir aile yok"}
          </Text>
          {!insideModal && !myFamily && !searchQuery.trim() ? (
            <Pressable onPress={() => setCreateOpen(true)} style={styles.emptyAction}>
              <Text style={styles.emptyActionText}>Aile kur</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, insideModal && { paddingBottom: 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionCaption}>KEŞFET · {filteredFamilies.length} AİLE</Text>
          {filteredFamilies.map(renderFamilyCard)}
        </ScrollView>
      )}
    </View>
  );

  const myProgress = useMemo(
    () => (myFamily ? computeFamilyLevelProgress(myFamily.xp, myFamily.level) : null),
    [myFamily],
  );

  const detailProgress = useMemo(
    () =>
      detailData?.family
        ? computeFamilyLevelProgress(
            detailData.family.xp,
            detailData.family.level,
            detailData.levelConfigs || DEFAULT_FAMILY_LEVEL_CONFIGS,
          )
        : null,
    [detailData],
  );

  const canAffordFamily = typeof coins !== "number" || coins >= FAMILY_CREATION_COST;

  const memberById = useMemo(() => {
    const map = new Map();
    for (const m of familyMembers) {
      if (m?.userId) map.set(m.userId, m);
    }
    return map;
  }, [familyMembers]);
  memberByIdRef.current = memberById;

  const familyLiveRooms = useMemo(() => {
    if (!myFamily?.id || !Array.isArray(rooms) || rooms.length === 0) return [];
    const memberIds = new Set();
    if (myFamily.ownerId) memberIds.add(myFamily.ownerId);
    for (const m of familyMembers) {
      if (m?.userId) memberIds.add(m.userId);
    }
    if (memberIds.size === 0) return [];
    return rooms
      .filter((r) => r?.hostId && memberIds.has(r.hostId))
      .sort((a, b) => (Number(b.listeners) || 0) - (Number(a.listeners) || 0));
  }, [familyMembers, myFamily?.id, myFamily?.ownerId, rooms]);

  const chatParticipantIds = useMemo(() => {
    const ids = [];
    if (currentUserId) ids.push(currentUserId);
    for (const m of messages) {
      if (m?.userId) ids.push(m.userId);
    }
    for (const mem of familyMembers) {
      if (mem?.userId) ids.push(mem.userId);
    }
    return ids;
  }, [currentUserId, familyMembers, messages]);
  const giftSpentMap = useGiftSpentMap(chatParticipantIds);

  const reversedMessages = useMemo(
    () => (messages.length ? [...messages].reverse() : []),
    [messages],
  );

  const chatKeyExtractor = useCallback((item) => String(item.id), []);

  const renderChatItem = useCallback(
    ({ item: msg }) => (
      <FamilyMessageRow
        msg={msg}
        knownMember={msg.userId ? memberById.get(msg.userId) : null}
        senderSpent={msg.userId ? giftSpentMap[msg.userId] || 0 : 0}
        profile={profile}
        onOpenUserProfile={onOpenUserProfile}
        onOpenGiftSheet={openGiftSheet}
      />
    ),
    [giftSpentMap, memberById, onOpenUserProfile, openGiftSheet, profile],
  );

  return (
    <View collapsable={false} style={styles.screen}>
      {myFamily ? (
        // ── Üye olunan aile varsa doğrudan Aile Sohbeti açılır ─────────────────
        <KeyboardSafeView style={{ flex: 1 }} iosOffset={insets.top}>
          <LinearGradient
            colors={["#101D36", "#1A325C", "#0F192E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.chatHeader}
          >
            <ShimmerSweep duration={4800} color="rgba(255,255,255,0.12)" />
            <Pressable
              onPress={() => openFamilyDetail(myFamily.id, "levels")}
              style={styles.chatHeaderIdentity}
            >
              <FamilyAvatar uri={myFamily.avatarUrl} name={myFamily.name} size={46} radius={15} />
              <View style={{ flex: 1 }}>
                <View style={styles.chatTitleRow}>
                  <Text numberOfLines={1} style={styles.chatTitle}>
                    {myFamily.name}
                  </Text>
                  <LinearGradient
                    colors={["#FFD66B", "#F59E0B"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.chatHeaderLevelBadge}
                  >
                    <Text style={styles.chatHeaderLevelBadgeText}>Sv. {myFamily.level}</Text>
                  </LinearGradient>
                </View>
                <Text numberOfLines={1} style={styles.chatSubtitle}>
                  {myFamily.memberCount} üye
                  {myFamily.familyCode ? ` · ID: ${myFamily.familyCode}` : ""}
                </Text>
              </View>
            </Pressable>
            <View style={styles.chatHeaderActions}>
              <Pressable
                onPress={() => setDiscoverModalOpen(true)}
                accessibilityLabel="Aileleri keşfet"
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  pressed && { transform: [{ scale: 0.93 }], opacity: 0.85 },
                ]}
              >
                <Ionicons name="compass-outline" size={19} color="#9CC8FF" />
              </Pressable>
              <Pressable
                onPress={() => openFamilyDetail(myFamily.id, "levels")}
                accessibilityLabel="Aile profili ve seviyeler"
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  pressed && { transform: [{ scale: 0.93 }], opacity: 0.85 },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={19} color="#FFD66B" />
              </Pressable>
            </View>
          </LinearGradient>

          <View style={styles.xpStrip}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.xpStripLabels}>
                <View style={styles.xpStripTopRow}>
                  <Text style={styles.xpStripTitle} numberOfLines={1}>
                    {myProgress?.currentTitle}
                  </Text>
                  <Text style={styles.xpStripPercent}>
                    %{Math.min(100, Math.round((myProgress?.ratio || 0) * 100))}
                  </Text>
                </View>
                <Text style={styles.xpStripValue} numberOfLines={1}>
                  {formatCredits(myProgress?.gainedInLevel || 0)} / {formatCredits(myProgress?.stepRequiredXp || 100000)} XP
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={["#2F80ED", "#F59E0B", "#FBBF24"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(4, Math.round((myProgress?.ratio || 0) * 100))}%` },
                  ]}
                />
              </View>
            </View>
            <Pressable
              onPress={() => openGiftSheet(null)}
              accessibilityLabel="Ailede hediye gönder"
              style={({ pressed }) => [
                styles.giftHeaderPill,
                pressed && { transform: [{ scale: 0.94 }], opacity: 0.9 },
              ]}
            >
              <LinearGradient
                colors={["#52A5FF", "#2F80ED", "#7C3AED"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
              />
              <Ionicons name="gift" size={14} color="#FFFFFF" />
              <Text style={styles.giftHeaderPillText}>Hediye</Text>
            </Pressable>
          </View>

          {familyLiveRooms.length > 0 && onOpenRoom ? (
            <View style={styles.familyLiveWrap}>
              {familyLiveRooms.slice(0, 2).map((liveRoom) => {
                const member = liveRoom.hostId ? memberById.get(liveRoom.hostId) : null;
                return (
                  <Pressable
                    key={liveRoom.id}
                    onPress={() => onOpenRoom(liveRoom)}
                    accessibilityRole="button"
                    accessibilityLabel={`${liveRoom.title} canlı aile odasına katıl`}
                    style={({ pressed }) => [
                      styles.familyLiveBar,
                      pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
                    ]}
                  >
                    <LinearGradient
                      colors={["#0F213E", "#183766", "#13294B"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
                    />
                    <View style={styles.familyLiveAvatarBox}>
                      <MemberAvatar
                        uri={liveRoom.hostAvatarUrl || member?.avatarUrl || null}
                        name={liveRoom.host || member?.name || "Aile"}
                        color={liveRoom.accent || member?.color || COLORS.primary}
                        size={34}
                      />
                      <View style={styles.familyLiveDotWrap}>
                        <LivePulse size={7} color="#22C55E" />
                      </View>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.familyLiveTopRow}>
                        <Text style={styles.familyLiveBadgeText}>AİLE YAYINDA</Text>
                        <Text style={styles.familyLiveCountText}>
                          · {Math.max(1, Number(liveRoom.listeners) || 1)} kişi
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={styles.familyLiveTitle}>
                        {liveRoom.title}
                      </Text>
                    </View>
                    <LinearGradient
                      colors={["#22C55E", "#16A34A"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.familyLiveJoinBtn}
                    >
                      <Ionicons name="headset" size={13} color="#FFFFFF" />
                      <Text style={styles.familyLiveJoinText}>Katıl</Text>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {messagesError ? (
            <Pressable
              onPress={() => loadMessages(myFamily.id)}
              style={styles.errorBanner}
            >
              <Ionicons name="refresh-outline" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{messagesError} Yeniden dene.</Text>
            </Pressable>
          ) : null}

          {messagesLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.loadingText}>Aile sohbeti yükleniyor...</Text>
            </View>
          ) : !messages.length ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubbles-outline" size={28} color={COLORS.primary} />
              </View>
              <Text style={styles.emptyTitle}>Aile sohbeti hazır</Text>
              <Text style={styles.emptyDescription}>
                Mesaj yazabilir veya hediye kutusuna dokunup üyelere ve kendine hediye gönderebilirsin.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={chatScrollRef}
              data={reversedMessages}
              renderItem={renderChatItem}
              keyExtractor={chatKeyExtractor}
              inverted
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={14}
              maxToRenderPerBatch={10}
              windowSize={7}
              updateCellsBatchingPeriod={40}
            />
          )}

          <GiftComboButton
            combo={giftSheetOpen ? null : comboState}
            coins={coins}
            onPress={handleComboGiftPress}
            onExpire={handleExpireCombo}
            bottomOffset={keyboard.visible ? 68 : 132 + Math.max(insets.bottom, 8)}
          />

          <FamilyChatComposer
            currentUserId={currentUserId}
            profile={profile}
            sendingMessage={sendingMessage}
            onSendText={handleSendText}
            onOpenGiftSheet={openGiftSheet}
            onOpenUserProfile={onOpenUserProfile}
            bottomMargin={keyboard.visible ? 0 : 64 + Math.max(insets.bottom, 8)}
          />
        </KeyboardSafeView>
      ) : (
        // ── Kullanıcı henüz ailede değilse sade Keşfet + ID Arama + Aile Kurma ─
        <>
          <View style={styles.pageHeader}>
            <View>
              <Text style={styles.eyebrow}>AİLE</Text>
              <Text style={styles.pageTitle}>Aileler</Text>
            </View>
            <Pressable
              onPress={() => setCreateOpen(true)}
              accessibilityLabel="Aile kur"
              style={styles.createHeaderBtn}
            >
              <Ionicons name="add" size={18} color={COLORS.primaryInk} />
              <Text style={styles.createHeaderBtnText}>Aile kur</Text>
            </Pressable>
          </View>

          {renderDiscoverContent({ insideModal: false })}
        </>
      )}

      {/* ── Aile İçi Hediye Kutusu Modalı (Profil fotoğraflı alıcı + Kendine atma) ─ */}
      <Modal
        transparent
        visible={giftSheetOpen}
        animationType="slide"
        onRequestClose={() => !sendingGift && setGiftSheetOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !sendingGift && setGiftSheetOpen(false)}
          />
          <View style={[styles.sheet, { maxHeight: "86%", paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.eyebrow}>AİLE HEDİYELERİ</Text>
                <Text style={styles.sheetTitle}>Hediye gönder</Text>
              </View>
              <View style={styles.giftHeaderRight}>
                <View style={styles.coinBadge}>
                  <Ionicons name="diamond" size={13} color={COLORS.primary} />
                  <Text style={styles.coinBadgeText}>{formatCredits(coins)}</Text>
                </View>
                <Pressable
                  disabled={sendingGift}
                  onPress={() => setGiftSheetOpen(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={COLORS.text} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.fieldLabel}>ALICI SEÇ</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recipientPickerRow}
              style={{ flexGrow: 0, flexShrink: 0, marginBottom: 14 }}
            >
              {giftRecipients.map((recipient) => {
                const active = selectedGiftRecipient?.userId === recipient.userId;
                return (
                  <Pressable
                    key={recipient.userId}
                    onPress={() => setGiftRecipientId(recipient.userId)}
                    style={[
                      styles.recipientCard,
                      active && styles.recipientCardActive,
                    ]}
                  >
                    <View style={[styles.recipientAvatarRing, active && styles.recipientAvatarRingActive]}>
                      <MemberAvatar
                        uri={recipient.avatarUrl}
                        name={recipient.name}
                        color={recipient.color}
                        size={44}
                      />
                      {active ? (
                        <View style={styles.recipientCheckBadge}>
                          <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.recipientName,
                        active && styles.recipientNameActive,
                      ]}
                    >
                      {recipient.isSelf ? "Kendim" : recipient.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.recipientSub}>
                      {recipient.isSelf ? `@${recipient.handle}` : "Üye"}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.qtyHeaderRow}>
              <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>ADET</Text>
              <View style={styles.qtyPillsRow}>
                {GIFT_QUANTITIES.map((qty) => {
                  const active = giftQuantity === qty;
                  return (
                    <Pressable
                      key={qty}
                      onPress={() => setGiftQuantity(qty)}
                      style={[styles.qtyPill, active && styles.qtyPillActive]}
                    >
                      <Text style={[styles.qtyPillText, active && styles.qtyPillTextActive]}>
                        {qty}x
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <View style={styles.giftGrid}>
                {visibleGiftCatalog.map((gift) => {
                  const active = selectedGift?.id === gift.id;
                  const lockedByLevel =
                    Number(gift.minFamilyLevel || 0) > Number(myFamily?.level || 1);
                  const totalCost = Number(gift.cost || 0) * giftQuantity;
                  const xpGain = Math.floor(totalCost / FAMILY_COINS_PER_XP);
                  const accent = safeHexAccent(gift.color);
                  return (
                    <Pressable
                      key={gift.id}
                      disabled={sendingGift}
                      onPress={() => setSelectedGiftId(gift.id)}
                      style={({ pressed }) => [
                        styles.giftItemCard,
                        active && styles.giftItemCardActive,
                        active && {
                          borderColor: accent,
                          backgroundColor: `${accent}16`,
                        },
                        lockedByLevel && { opacity: 0.62 },
                        pressed && { transform: [{ scale: 0.98 }] },
                      ]}
                    >
                      {active ? (
                        <View style={[styles.giftItemCheckBadge, { backgroundColor: accent }]}>
                          <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                        </View>
                      ) : null}
                      <View style={{ marginBottom: 6, marginTop: 2 }}>
                        <SoraGiftArtwork
                          giftId={gift.id}
                          giftName={gift.name}
                          fallbackIcon={resolveGiftIcon(gift.icon)}
                          fallbackColor={gift.color || COLORS.primary}
                          size={62}
                        />
                      </View>
                      <Text numberOfLines={1} style={styles.giftItemName}>
                        {gift.name}
                      </Text>
                      <View style={styles.giftItemCostRow}>
                        <Ionicons
                          name={lockedByLevel ? "lock-closed-outline" : "diamond"}
                          size={11}
                          color={lockedByLevel ? COLORS.muted : "#F59E0B"}
                        />
                        <Text numberOfLines={1} style={styles.giftItemCostText}>
                          {lockedByLevel
                            ? `Sv. ${gift.minFamilyLevel} · ${formatCredits(totalCost)}`
                            : formatCredits(totalCost)}
                        </Text>
                      </View>
                      {xpGain > 0 ? (
                        <Text style={styles.giftItemXpHint}>+{formatCredits(xpGain)} XP</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {selectedGift ? (
              <View style={styles.giftSendBar}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.giftSendTitle}>
                    {giftQuantity}x {selectedGift.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.giftSendMeta}>
                    {formatCredits(Number(selectedGift.cost || 0) * giftQuantity)} kredi
                    {Math.floor((Number(selectedGift.cost || 0) * giftQuantity) / FAMILY_COINS_PER_XP) > 0
                      ? ` · +${formatCredits(Math.floor((Number(selectedGift.cost || 0) * giftQuantity) / FAMILY_COINS_PER_XP))} XP`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  disabled={sendingGift}
                  onPress={handleSendSelectedGift}
                  accessibilityRole="button"
                  accessibilityLabel="Hediyeyi gönder"
                  style={({ pressed }) => [
                    styles.giftSendButton,
                    sendingGift && { opacity: 0.6 },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <Ionicons name="paper-plane" size={15} color="#FFFFFF" />
                  <Text style={styles.giftSendButtonText}>Gönder</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <CoinBlastEffect event={coinBlastEvent} />
        </View>
      </Modal>

      {/* ── Ailedeyken Diğer Aileleri Keşfet ve ID Arama Modalı ─────────────── */}
      <Modal
        transparent
        visible={discoverModalOpen}
        animationType="slide"
        onRequestClose={() => setDiscoverModalOpen(false)}
      >
        <KeyboardSafeView style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDiscoverModalOpen(false)} />
          <View style={[styles.sheet, { height: "84%", paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.eyebrow}>AİLE KEŞFET</Text>
                <Text style={styles.sheetTitle}>Aileler</Text>
              </View>
              <Pressable onPress={() => setDiscoverModalOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={COLORS.text} />
              </Pressable>
            </View>
            {renderDiscoverContent({ insideModal: true })}
          </View>
        </KeyboardSafeView>
      </Modal>

      {/* ── Yeni Aile Kurma Modalı (Fotoğraf seçimi + 10.000.000 kredi) ───── */}
      <Modal
        transparent
        visible={createOpen}
        animationType="slide"
        onRequestClose={() => !creating && setCreateOpen(false)}
      >
        <KeyboardSafeView style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !creating && setCreateOpen(false)}
          />
          <View style={[styles.sheet, { maxHeight: "88%", paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.eyebrow}>YENİ AİLE</Text>
                <Text style={styles.sheetTitle}>Aileni kur</Text>
              </View>
              <Pressable
                disabled={creating}
                onPress={() => setCreateOpen(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={20} color={COLORS.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>AİLE PROFİL FOTOĞRAFI</Text>
              <View style={styles.photoPickerRow}>
                <FamilyAvatar
                  uri={createAvatarAsset?.uri || null}
                  name={createName || "A"}
                  size={64}
                  radius={22}
                />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => pickAvatarImage(setCreateAvatarAsset)}
                      style={styles.secondaryActionBtn}
                    >
                      <Ionicons name="image-outline" size={15} color={COLORS.primary} />
                      <Text style={styles.secondaryActionBtnText}>
                        {createAvatarAsset ? "Fotoğrafı değiştir" : "Fotoğraf seç"}
                      </Text>
                    </Pressable>
                    {createAvatarAsset ? (
                      <Pressable
                        onPress={() => setCreateAvatarAsset(null)}
                        style={styles.ghostRemoveBtn}
                      >
                        <Text style={styles.ghostRemoveBtnText}>Kaldır</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={styles.photoHint}>JPEG, PNG veya WebP · En fazla 3 MB</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>AİLE ADI</Text>
              <TextInput
                value={createName}
                onChangeText={setCreateName}
                placeholder="Örn. Kuzey Yıldızı"
                placeholderTextColor={COLORS.muted}
                maxLength={40}
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>AÇIKLAMA</Text>
              <TextInput
                value={createDescription}
                onChangeText={setCreateDescription}
                placeholder="Ailenin amacı ve kuralları hakkında kısa bilgi"
                placeholderTextColor={COLORS.muted}
                maxLength={240}
                multiline
                style={[styles.input, styles.descriptionInput]}
              />

              <View style={styles.costCard}>
                <View style={styles.costRow}>
                  <Text style={styles.costLabel}>Kurulum bedeli</Text>
                  <Text style={styles.costValue}>{formatCredits(FAMILY_CREATION_COST)} kredi</Text>
                </View>
                <View style={styles.costRow}>
                  <Text style={styles.costLabel}>Mevcut bakiyen</Text>
                  <Text style={[styles.costBalance, !canAffordFamily && { color: COLORS.danger }]}>
                    {formatCredits(coins)} kredi
                  </Text>
                </View>
                <Text style={styles.costFootnote}>
                  {canAffordFamily
                    ? "Tutar sunucuda atomik olarak doğrulanır ve düşülür. Her aileye otomatik 8 haneli özel ID atanır."
                    : "Bakiyen kurulum bedelinin altında olduğu için aile oluşturulamaz."}
                </Text>
              </View>

              <Pressable
                disabled={creating || !canAffordFamily}
                onPress={handleCreateFamily}
                style={{ opacity: creating || !canAffordFamily ? 0.55 : 1 }}
              >
                <LinearGradient colors={[COLORS.primary, "#1D5FBF"]} style={styles.primaryAction}>
                  {creating ? (
                    <ActivityIndicator color={COLORS.primaryInk} />
                  ) : (
                    <>
                      <Text style={styles.primaryActionText}>
                        {formatCredits(FAMILY_CREATION_COST)} kredi ile kur
                      </Text>
                      <Ionicons name="arrow-forward" size={18} color={COLORS.primaryInk} />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardSafeView>
      </Modal>

      {/* ── Aile Detay, Seviyeler, Üyeler ve Düzenleme Modalı ──────────────── */}
      <Modal
        transparent
        visible={Boolean(selectedFamilyId)}
        animationType="slide"
        onRequestClose={closeFamilyDetail}
      >
        <KeyboardSafeView style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeFamilyDetail} />
          <View style={[styles.sheet, { maxHeight: "88%", paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
            <View style={styles.sheetHandle} />
            {detailLoading ? (
              <View style={[styles.center, { minHeight: 240 }]}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.loadingText}>Aile bilgileri yükleniyor...</Text>
              </View>
            ) : detailError || !detailData?.family ? (
              <View style={[styles.center, { minHeight: 220 }]}>
                <Text style={styles.errorText}>{detailError || "Aile bulunamadı."}</Text>
                <Pressable onPress={closeFamilyDetail} style={styles.secondaryActionBtn}>
                  <Text style={styles.secondaryActionBtnText}>Kapat</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.detailTopRow}>
                  <FamilyAvatar
                    uri={detailData.family.avatarUrl}
                    name={detailData.family.name}
                    size={60}
                    radius={20}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.familyCardTitleRow}>
                      <Text numberOfLines={1} style={styles.detailTitle}>
                        {detailData.family.name}
                      </Text>
                      <View style={styles.levelBadge}>
                        <Text style={styles.levelBadgeText}>Sv. {detailData.family.level}</Text>
                      </View>
                    </View>
                    <Text style={styles.detailMeta}>
                      {detailData.members.length} üye
                      {detailData.family.familyCode ? ` · Aile ID: ${detailData.family.familyCode}` : ""}
                    </Text>
                    {detailData.family.description ? (
                      <Text style={styles.detailDesc}>{detailData.family.description}</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={closeFamilyDetail} style={styles.closeButton}>
                    <Ionicons name="close" size={20} color={COLORS.text} />
                  </Pressable>
                </View>

                <View style={styles.detailTabs}>
                  <Pressable
                    onPress={() => setDetailTab("levels")}
                    style={[styles.detailTabBtn, detailTab === "levels" && styles.detailTabBtnActive]}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.84}
                      style={[styles.detailTabText, detailTab === "levels" && styles.detailTabTextActive]}
                    >
                      Seviyeler
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDetailTab("members")}
                    style={[styles.detailTabBtn, detailTab === "members" && styles.detailTabBtnActive]}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.84}
                      style={[styles.detailTabText, detailTab === "members" && styles.detailTabTextActive]}
                    >
                      Üyeler ({detailData.members.length})
                    </Text>
                  </Pressable>
                  {detailData.family.role === "owner" ? (
                    <Pressable
                      onPress={() => setDetailTab("edit")}
                      style={[styles.detailTabBtn, detailTab === "edit" && styles.detailTabBtnActive]}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.84}
                        style={[styles.detailTabText, detailTab === "edit" && styles.detailTabTextActive]}
                      >
                        Düzenle
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 16 }}
                >
                  {detailTab === "levels" ? (
                    <View style={{ gap: 12 }}>
                      <View style={styles.levelHeroCard}>
                        <View style={styles.xpStripLabels}>
                          <View style={styles.xpStripTopRow}>
                            <Text style={styles.levelHeroTitle} numberOfLines={1}>
                              Sv. {detailData.family.level} · {detailProgress?.currentTitle}
                            </Text>
                            <Text style={styles.xpStripPercent}>
                              %{Math.min(100, Math.round((detailProgress?.ratio || 0) * 100))}
                            </Text>
                          </View>
                          <Text style={styles.xpStripValue} numberOfLines={1}>
                            {formatCredits(detailProgress?.gainedInLevel || 0)} / {formatCredits(detailProgress?.stepRequiredXp || 100000)} XP
                          </Text>
                        </View>
                        <View style={[styles.progressTrack, { marginTop: 8 }]}>
                          <LinearGradient
                            colors={["#2F80ED", "#F59E0B", "#FBBF24"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[
                              styles.progressFill,
                              { width: `${Math.max(4, Math.round((detailProgress?.ratio || 0) * 100))}%` },
                            ]}
                          />
                        </View>
                        <Text style={styles.levelHeroSub}>
                          Seviye {detailProgress?.nextLevel} için {formatCredits(detailProgress?.remainingXp || 0)} XP kaldı · Her seviyede gereken XP 2 katına çıkar
                        </Text>
                        <Text style={styles.levelHeroVolume}>
                          Toplam XP: {formatCredits(detailData.family.xp)} · Hediye hacmi: {formatCredits(detailData.family.giftCoinsTotal || 0)} kredi
                        </Text>
                        {detailData.family.joined ? (
                          <Pressable
                            disabled={syncingRewards}
                            onPress={handleSyncRewards}
                            style={styles.syncRewardBtn}
                          >
                            {syncingRewards ? (
                              <ActivityIndicator size="small" color={COLORS.primary} />
                            ) : (
                              <>
                                <Ionicons name="ribbon-outline" size={15} color={COLORS.primary} />
                                <Text style={styles.syncRewardBtnText}>Seviye ödüllerini hesabımla eşitle</Text>
                              </>
                            )}
                          </Pressable>
                        ) : null}
                      </View>

                      <Text style={styles.sectionCaption}>SEVİYE İLERLEME KURALI</Text>
                      <View style={styles.ruleCard}>
                        {detailData.xpRules.map((rule) => (
                          <View key={rule.eventType} style={styles.ruleRow}>
                            <Ionicons name="gift-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.ruleLabel}>{rule.label}</Text>
                          </View>
                        ))}
                      </View>

                      <Text style={styles.sectionCaption}>SEVİYE EŞİKLERİ VE ÖDÜLLER</Text>
                      {detailData.levelConfigs.map((cfg) => {
                        const unlocked = detailData.family.level >= cfg.level;
                        return (
                          <View
                            key={cfg.level}
                            style={[styles.tierCard, unlocked && styles.tierCardUnlocked]}
                          >
                            <View style={[styles.tierBadge, unlocked && styles.tierBadgeUnlocked]}>
                              <Text style={[styles.tierBadgeText, unlocked && { color: COLORS.primaryInk }]}>
                                Sv. {cfg.level}
                              </Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.tierTitle}>
                                {cfg.title} · {formatCredits(cfg.minXp)} XP
                              </Text>
                              <Text style={styles.tierPerk}>{cfg.perkLabel}</Text>
                            </View>
                            <Ionicons
                              name={unlocked ? "lock-open-outline" : "lock-closed-outline"}
                              size={17}
                              color={unlocked ? COLORS.primary : COLORS.muted}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ) : detailTab === "members" ? (
                    <View style={{ gap: 8 }}>
                      {detailData.members.map((member) => (
                        <View key={member.userId} style={styles.memberRow}>
                          <Pressable
                            disabled={!onOpenUserProfile}
                            onPress={() => {
                              closeFamilyDetail();
                              setTimeout(() => onOpenUserProfile?.(member.userId), 300);
                            }}
                            style={styles.memberIdentityPress}
                          >
                            <MemberAvatar
                              uri={member.avatarUrl}
                              name={member.name}
                              color={member.color}
                              size={40}
                            />
                            <View style={{ flex: 1 }}>
                              <Text numberOfLines={1} style={styles.memberName}>
                                {member.name}
                              </Text>
                              <Text numberOfLines={1} style={styles.memberMeta}>
                                @{member.handle}
                                {member.publicId ? ` · ID: ${member.publicId}` : ""}
                              </Text>
                            </View>
                          </Pressable>
                          {detailData.family.joined && detailData.family.id === myFamily?.id ? (
                            <Pressable
                              onPress={() => {
                                closeFamilyDetail();
                                setTimeout(() => openGiftSheet(member.userId), 300);
                              }}
                              accessibilityLabel={`${member.name} kişisine hediye gönder`}
                              style={styles.memberGiftBtn}
                            >
                              <Ionicons name="gift-outline" size={16} color={COLORS.primary} />
                            </Pressable>
                          ) : null}
                          <View
                            style={[
                              styles.rolePill,
                              member.role === "owner" && styles.rolePillOwner,
                            ]}
                          >
                            <Text
                              style={[
                                styles.rolePillText,
                                member.role === "owner" && { color: COLORS.primary },
                              ]}
                            >
                              {member.role === "owner" ? "Kurucu" : "Üye"}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={{ gap: 10 }}>
                      <Text style={styles.fieldLabel}>AİLE PROFİL FOTOĞRAFI</Text>
                      <View style={styles.photoPickerRow}>
                        <FamilyAvatar
                          uri={
                            editAvatarAsset?.uri
                            || (editClearAvatar ? null : detailData.family.avatarUrl)
                          }
                          name={editName || detailData.family.name}
                          size={62}
                          radius={20}
                        />
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <Pressable
                              onPress={() =>
                                pickAvatarImage((asset) => {
                                  setEditAvatarAsset(asset);
                                  setEditClearAvatar(false);
                                })
                              }
                              style={styles.secondaryActionBtn}
                            >
                              <Text style={styles.secondaryActionBtnText}>Fotoğraf seç</Text>
                            </Pressable>
                            {(editAvatarAsset || detailData.family.avatarUrl) && !editClearAvatar ? (
                              <Pressable
                                onPress={() => {
                                  setEditAvatarAsset(null);
                                  setEditClearAvatar(true);
                                }}
                                style={styles.ghostRemoveBtn}
                              >
                                <Text style={styles.ghostRemoveBtnText}>Kaldır</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          <Text style={styles.photoHint}>JPEG, PNG veya WebP · En fazla 3 MB</Text>
                        </View>
                      </View>

                      <Text style={styles.fieldLabel}>AİLE ADI</Text>
                      <TextInput
                        value={editName}
                        onChangeText={setEditName}
                        maxLength={40}
                        style={styles.input}
                      />

                      <Text style={styles.fieldLabel}>AÇIKLAMA</Text>
                      <TextInput
                        value={editDescription}
                        onChangeText={setEditDescription}
                        maxLength={240}
                        multiline
                        style={[styles.input, styles.descriptionInput]}
                      />

                      <Pressable disabled={savingEdit} onPress={handleSaveFamilyEdit}>
                        <LinearGradient colors={[COLORS.primary, "#1D5FBF"]} style={styles.primaryAction}>
                          {savingEdit ? (
                            <ActivityIndicator color={COLORS.primaryInk} />
                          ) : (
                            <Text style={styles.primaryActionText}>Değişiklikleri kaydet</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                    </View>
                  )}
                </ScrollView>

                {detailTab !== "edit" ? (
                  <View style={styles.detailFooter}>
                    {detailData.family.joined ? (
                      detailData.family.role === "owner" ? (
                        <View style={styles.footerInfoBox}>
                          <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
                          <Text style={styles.footerInfoText}>Bu ailenin kurucususun.</Text>
                        </View>
                      ) : (
                        <Pressable
                          disabled={leavingBusy}
                          onPress={() => handleLeaveFamily(detailData.family)}
                          style={styles.leaveBtn}
                        >
                          {leavingBusy ? (
                            <ActivityIndicator size="small" color={COLORS.danger} />
                          ) : (
                            <Text style={styles.leaveBtnText}>Aileden ayrıl</Text>
                          )}
                        </Pressable>
                      )
                    ) : myFamily ? (
                      <View style={styles.footerInfoBox}>
                        <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
                        <Text style={styles.footerInfoText}>
                          Başka bir aileye katılmak için önce mevcut ailenden ayrılmalısın.
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        disabled={joiningBusy}
                        onPress={() => handleJoinFamily(detailData.family)}
                      >
                        <LinearGradient colors={[COLORS.primary, "#1D5FBF"]} style={styles.primaryAction}>
                          {joiningBusy ? (
                            <ActivityIndicator color={COLORS.primaryInk} />
                          ) : (
                            <Text style={styles.primaryActionText}>Aileye katıl</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </>
            )}
          </View>
        </KeyboardSafeView>
      </Modal>
      <SoraGiftEffect gift={giftEffect} />
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative", backgroundColor: COLORS.background },
  pageHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  pageTitle: {
    color: COLORS.text,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.9,
    marginTop: 2,
  },
  createHeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  createHeaderBtnText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },
  searchSection: {
    marginHorizontal: 18,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInputWrap: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 13, paddingVertical: 8 },
  idSearchButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  idSearchButtonText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },
  infoNote: {
    marginHorizontal: 18,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: COLORS.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoNoteText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  sectionCaption: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  list: { padding: 18, paddingBottom: 110, gap: 10 },
  familyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  familyCardBody: { flex: 1 },
  familyCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  familyCardTitle: { flexShrink: 1, color: COLORS.text, fontSize: 15, fontWeight: "900" },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.22)",
  },
  levelBadgeText: { color: COLORS.primary, fontSize: 10, fontWeight: "900" },
  familyCardDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  familyCardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.raised,
  },
  metaChipActive: { backgroundColor: COLORS.primarySoft },
  metaChipText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  errorBanner: {
    marginHorizontal: 18,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(217,79,92,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,79,92,0.28)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: { color: "#B93E4A", fontSize: 12, lineHeight: 17, flex: 1 },
  emptyState: {
    flex: 1,
    minHeight: 240,
    paddingHorizontal: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: COLORS.raised,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  emptyDescription: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  emptyAction: {
    marginTop: 16,
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingVertical: 11,
    backgroundColor: COLORS.primary,
  },
  emptyActionText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },

  // ── Aile Sohbeti ve Hediye Mesajı Stilleri ──────────────────────────────────
  chatHeader: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(120,180,255,0.18)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    elevation: 4,
  },
  chatHeaderIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  chatTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  chatTitle: { flexShrink: 1, color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  chatHeaderLevelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
  },
  chatHeaderLevelBadgeText: { color: "#1A1204", fontSize: 10, fontWeight: "900" },
  chatSubtitle: { color: "rgba(210,228,255,0.78)", fontSize: 11, marginTop: 2, fontWeight: "600" },
  chatHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  xpStrip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lineSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  familyLiveWrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 2,
    gap: 6,
  },
  familyLiveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.34)",
    overflow: "hidden",
  },
  familyLiveAvatarBox: {
    position: "relative",
  },
  familyLiveDotWrap: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: "#0F213E",
    alignItems: "center",
    justifyContent: "center",
  },
  familyLiveTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  familyLiveBadgeText: {
    color: "#4ADE80",
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  familyLiveCountText: {
    color: "rgba(219,234,254,0.78)",
    fontSize: 10.5,
    fontWeight: "700",
  },
  familyLiveTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 1,
  },
  familyLiveJoinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    borderRadius: 10,
  },
  familyLiveJoinText: {
    color: "#FFFFFF",
    fontSize: 11.5,
    fontWeight: "900",
  },
  xpStripLabels: { gap: 2 },
  xpStripTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  xpStripTitle: { flex: 1, color: COLORS.text, fontSize: 12, fontWeight: "800" },
  xpStripPercent: { color: COLORS.primary, fontSize: 10.5, fontWeight: "900", flexShrink: 0 },
  xpStripValue: { color: COLORS.textSecondary, fontSize: 10.5, fontWeight: "700" },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(203,218,236,0.55)",
    overflow: "hidden",
    marginTop: 5,
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: COLORS.primary },
  giftHeaderPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 12,
    overflow: "hidden",
    elevation: 2,
  },
  giftHeaderPillText: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "900" },
  messagesList: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 11,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 9 },
  msgRowOwn: { justifyContent: "flex-end" },
  msgAvatarPress: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  msgContentCol: { maxWidth: "75%", alignItems: "flex-start" },
  msgContentColOwn: { alignItems: "flex-end" },
  msgSenderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 3,
  },
  msgSender: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    flexShrink: 1,
  },
  msgBubble: {
    minHeight: 39,
    minWidth: 66,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 19,
    justifyContent: "center",
  },
  msgBubbleOther: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.86)",
    borderBottomLeftRadius: 6,
  },
  msgBubbleOwn: {
    backgroundColor: "#2563EB",
    borderBottomRightRadius: 6,
  },
  msgInlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    columnGap: 8,
    rowGap: 2,
  },
  msgText: { color: COLORS.text, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  msgTextOwn: { color: COLORS.primaryInk },
  msgTime: { color: COLORS.muted, fontSize: 10.5, lineHeight: 15, marginLeft: "auto" },
  msgTimeOwn: { color: "rgba(255,255,255,0.82)" },
  giftMsgCard: {
    width: 272,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.36)",
  },
  giftMsgCardOwn: {
    backgroundColor: "#F6FAFF",
    borderColor: "rgba(47,128,237,0.34)",
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
  },
  giftMsgBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  giftMsgTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  giftMsgBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  giftMsgMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  giftMsgMetaChip: {
    color: "#B45309",
    fontSize: 10.5,
    fontWeight: "900",
    backgroundColor: "rgba(245,158,11,0.14)",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  giftMsgXpChip: {
    color: "#15803D",
    fontSize: 10.5,
    fontWeight: "900",
    backgroundColor: "rgba(22,163,74,0.12)",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  giftMsgTime: { color: COLORS.muted, fontSize: 10.5, marginLeft: "auto" },
  composerRow: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: "rgba(203,218,236,0.75)",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  composerAvatarWrap: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  composerGiftBtn: {
    width: 41,
    height: 41,
    borderRadius: 21,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
  },
  composerInput: {
    flex: 1,
    minHeight: 41,
    maxHeight: 96,
    borderRadius: 21,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.88)",
    color: COLORS.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 41,
    height: 41,
    borderRadius: 21,
    overflow: "hidden",
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
  },
  sendBtnDisabled: { opacity: 0.45 },

  // ── Aile Hediye Kutusu Stilleri ─────────────────────────────────────────────
  giftHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  coinBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 11,
    backgroundColor: COLORS.primarySoft,
  },
  coinBadgeText: { color: COLORS.primary, fontSize: 12, fontWeight: "900" },
  recipientPickerRow: { gap: 10, paddingRight: 6 },
  recipientCard: {
    width: 82,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
    alignItems: "center",
  },
  recipientCardActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primary,
  },
  recipientAvatarRing: {
    padding: 2,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: 5,
  },
  recipientAvatarRingActive: { borderColor: COLORS.primary },
  recipientCheckBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  recipientName: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  recipientNameActive: { color: COLORS.primary, fontWeight: "900" },
  recipientSub: { color: COLORS.muted, fontSize: 9, marginTop: 1 },
  qtyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    flexShrink: 0,
  },
  qtyPillsRow: { flexDirection: "row", gap: 5 },
  qtyPill: {
    paddingHorizontal: 9,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  qtyPillText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800" },
  qtyPillTextActive: { color: COLORS.primaryInk, fontWeight: "900" },
  categoryPillsRow: { gap: 7, paddingRight: 6 },
  categoryPill: {
    paddingHorizontal: 12,
    height: 31,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryPillActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primary,
  },
  categoryPillText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800" },
  categoryPillTextActive: { color: COLORS.primary, fontWeight: "900" },
  giftGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 9 },
  giftItemCard: {
    width: "31.5%",
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: "rgba(203,218,236,0.82)",
    alignItems: "center",
    position: "relative",
  },
  giftItemCardActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primary,
  },
  giftItemCheckBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  giftSendBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.lineSoft,
  },
  giftSendTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  giftSendMeta: { color: COLORS.primary, fontSize: 11, fontWeight: "800", marginTop: 2 },
  giftSendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 42,
    paddingHorizontal: 20,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
  },
  giftSendButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  giftItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  giftItemName: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  giftItemCostRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  giftItemCostText: { color: COLORS.primary, fontSize: 10, fontWeight: "900" },
  giftItemXpHint: { color: COLORS.textSecondary, fontSize: 9, fontWeight: "700", marginTop: 2 },

  // ── Modallar ve Formlar ─────────────────────────────────────────────────────
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.56)" },
  sheet: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C2CEDD",
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sheetTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "900",
    marginBottom: 7,
  },
  photoPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 16,
    padding: 12,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
  },
  photoHint: { color: COLORS.muted, fontSize: 11 },
  secondaryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.primarySoft,
  },
  secondaryActionBtnText: { color: COLORS.primary, fontSize: 11, fontWeight: "900" },
  ghostRemoveBtn: {
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostRemoveBtnText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "800" },
  input: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.text,
    fontSize: 14,
    marginBottom: 14,
  },
  descriptionInput: { minHeight: 80, textAlignVertical: "top" },
  costCard: {
    padding: 13,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginBottom: 16,
    gap: 6,
  },
  costRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  costLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },
  costValue: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
  costBalance: { color: COLORS.primary, fontSize: 13, fontWeight: "900" },
  costFootnote: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  primaryAction: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryActionText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },

  // ── Detay Modalı ────────────────────────────────────────────────────────────
  detailTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  detailTitle: { flexShrink: 1, color: COLORS.text, fontSize: 18, fontWeight: "900" },
  detailMeta: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 3 },
  detailDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
  detailTabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 13,
    backgroundColor: COLORS.background,
    marginBottom: 14,
    gap: 4,
  },
  detailTabBtn: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  detailTabBtnActive: { backgroundColor: COLORS.primarySoft },
  detailTabText: { color: COLORS.muted, fontSize: 11.5, fontWeight: "800", textAlign: "center" },
  detailTabTextActive: { color: COLORS.primary, fontWeight: "900" },
  levelHeroCard: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  levelHeroTitle: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "900" },
  levelHeroSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 7, lineHeight: 16 },
  levelHeroVolume: { color: COLORS.muted, fontSize: 10, fontWeight: "700", marginTop: 4 },
  syncRewardBtn: {
    marginTop: 10,
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: COLORS.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  syncRewardBtnText: { flexShrink: 1, color: COLORS.primary, fontSize: 11.5, fontWeight: "900", textAlign: "center" },
  ruleCard: {
    padding: 12,
    borderRadius: 15,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
    gap: 8,
  },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ruleLabel: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  tierCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
  },
  tierCardUnlocked: {
    borderColor: "rgba(47,128,237,0.34)",
    backgroundColor: "rgba(47,128,237,0.06)",
  },
  tierBadge: {
    minWidth: 46,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.raised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tierBadgeUnlocked: { backgroundColor: COLORS.primary },
  tierBadgeText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "900" },
  tierTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  tierPerk: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.lineSoft,
  },
  memberIdentityPress: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberGiftBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  memberName: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  memberMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  rolePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.raised,
  },
  rolePillOwner: { backgroundColor: COLORS.primarySoft },
  rolePillText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: "900" },
  detailFooter: { paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.lineSoft },
  footerInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.background,
  },
  footerInfoText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  leaveBtn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "rgba(217,79,92,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,79,92,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  leaveBtnText: { color: COLORS.danger, fontSize: 13, fontWeight: "900" },
});
