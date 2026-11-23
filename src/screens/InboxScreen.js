import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  listDirectConversations,
  listDirectMessages,
  sendDirectMessage,
  startDirectConversation,
  subscribeToDirectMessages,
} from "../data/soraRepository";
import { COLORS } from "../theme/colors";
import { KeyboardSafeView, useKeyboardInset } from "../ui/useKeyboardInset";
import { Reveal } from "../ui/Motion";
import { FloatingGlow, ShimmerSweep } from "../ui/SoraFx";
import { SoraWealthBadge } from "../ui/SoraWealthTier";
import { useGiftSpentMap } from "../data/wealthStore";

const TR_TIME_FMT = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const TR_DAY_FMT = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" });

let cachedInboxUserId = null;
let cachedInboxConversations = null;
const cachedDirectMessages = new Map();

function resetInboxCachesIfUserChanged(userId) {
  if (userId && cachedInboxUserId && cachedInboxUserId !== userId) {
    cachedInboxConversations = null;
    cachedDirectMessages.clear();
  }
  if (userId) cachedInboxUserId = userId;
}

const isSameCalendarDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getDateKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const formatDateSeparator = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (isSameCalendarDay(date, today)) return "Bugün";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return "Dün";
  return TR_DAY_FMT.format(date);
};

const formatBubbleClock = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return TR_TIME_FMT.format(date);
};

const formatMessageTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (isSameCalendarDay(date, today)) {
    return TR_TIME_FMT.format(date);
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return "Dün";
  }
  return TR_DAY_FMT.format(date);
};

const isNetworkError = (error) => {
  const message = String(error?.message || error || "");
  const normalizedMessage = message.toLocaleLowerCase("en-US");
  return (
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("network request failed") ||
    normalizedMessage.includes("unknownhostexception") ||
    normalizedMessage.includes("unable to resolve host")
  );
};

const friendlyError = (error) => {
  const message = String(error?.message || "İşlem tamamlanamadı.");
  if (isNetworkError(error)) return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.";
  if (message.includes("User not found")) return "Bu kullanıcı adına sahip bir hesap bulunamadı.";
  if (message.includes("yourself")) return "Kendinle sohbet başlatamazsın.";
  if (message.includes("unavailable")) return "Bu kullanıcıyla sohbet başlatılamıyor.";
  if (message.includes("Duplicate")) return "Aynı mesajı kısa süre içinde tekrar gönderemezsin.";
  if (message.includes("Too many")) return "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.";
  if (message.includes("blocked language")) return "Mesaj topluluk kurallarına uygun değil.";
  return message;
};

const Avatar = memo(function Avatar({
  name,
  color,
  size = 48,
  uri = null,
  live = false,
  borderColor = null,
  style = null,
}) {
  const innerSize = live ? Math.max(size - 4, 20) : size;
  const radius = innerSize / 2;
  const circle = (
    <View
      style={[
        styles.avatar,
        {
          width: innerSize,
          height: innerSize,
          borderRadius: radius,
          backgroundColor: color || "#7FCBEA",
          overflow: "hidden",
          borderWidth: live ? 2 : borderColor ? 1.5 : 0,
          borderColor: live ? "#FFFFFF" : borderColor || "transparent",
        },
        !live && style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: innerSize, height: innerSize, borderRadius: radius }}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.avatarText, { fontSize: innerSize * 0.4 }]}>
          {(name || "S").charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );

  if (!live) return circle;

  const ringSize = size + 2;
  return (
    <LinearGradient
      colors={["#22C55E", "#2F80ED"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.avatarLiveRing,
        {
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
        },
        style,
      ]}
    >
      {circle}
    </LinearGradient>
  );
});

function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <View style={styles.emptyState}>
      <LinearGradient
        colors={["#101C33", "#1A2F52", "#0E1729"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.emptyHeroCard}
      >
        <FloatingGlow
          color="rgba(82,165,255,0.28)"
          size={150}
          style={{ top: -44, right: -32 }}
        />
        <ShimmerSweep duration={4600} color="rgba(255,255,255,0.14)" />
        <LinearGradient
          colors={["rgba(82,165,255,0.24)", "rgba(47,128,237,0.10)"]}
          style={styles.emptyIcon}
        >
          <Ionicons name={icon} size={28} color="#8CC8FF" />
        </LinearGradient>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyDescription}>{description}</Text>
        {action ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.emptyAction,
              pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
            ]}
          >
            <LinearGradient
              colors={["#3B8DF6", "#2563EB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 15 }]}
            />
            <ShimmerSweep duration={3400} color="rgba(255,255,255,0.26)" />
            <Text style={styles.emptyActionText}>{action}</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.primaryInk} />
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}

export const InboxScreen = memo(function InboxScreen({
  currentUserId,
  profile,
  rooms = [],
  onOpenRoom = null,
  active = true,
  pendingDirectChat = null,
  onConsumePendingDirectChat = null,
}) {
  resetInboxCachesIfUserChanged(currentUserId);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const chatScrollRef = useRef(null);
  const liveRoomByUserId = useMemo(() => {
    const map = new Map();
    for (const r of rooms || []) {
      if (!r?.id || r.state === "scheduled") continue;
      if (r.hostId) map.set(r.hostId, r);
    }
    return map;
  }, [rooms]);
  const [conversations, setConversations] = useState(
    () => (Array.isArray(cachedInboxConversations) ? cachedInboxConversations : []),
  );
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(() => !Array.isArray(cachedInboxConversations));
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [startingChat, setStartingChat] = useState(false);
  const [messageRetryNonce, setMessageRetryNonce] = useState(0);
  const selectedConversationIdRef = useRef(null);
  selectedConversationIdRef.current = selectedConversation?.id || null;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const handledDirectChatReqRef = useRef(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSelectedConversation(null);
    setMessages([]);
    setDraft("");
    setError("");
    setStartingChat(false);
  }, [currentUserId]);

  useEffect(() => {
    if (keyboard.visible && selectedConversation) {
      const timer = setTimeout(() => {
        chatScrollRef.current?.scrollToEnd?.({ animated: true });
      }, 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [keyboard.visible, selectedConversation]);

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    const requestUserId = currentUserId;
    if (!requestUserId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      let nextConversations;
      try {
        nextConversations = await listDirectConversations();
      } catch (firstError) {
        if (!isNetworkError(firstError)) throw firstError;
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (currentUserIdRef.current !== requestUserId) return;
        nextConversations = await listDirectConversations();
      }
      if (!isMountedRef.current || currentUserIdRef.current !== requestUserId) return;
      cachedInboxUserId = requestUserId;
      cachedInboxConversations = nextConversations;
      setConversations(nextConversations);
      setSelectedConversation((current) => current ? nextConversations.find((item) => item.id === current.id) || current : current);
    } catch (loadError) {
      if (isMountedRef.current && currentUserIdRef.current === requestUserId) {
        setError(friendlyError(loadError));
      }
    } finally {
      if (!silent && isMountedRef.current && currentUserIdRef.current === requestUserId) {
        setLoading(false);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    loadConversations({ silent: Array.isArray(cachedInboxConversations) });
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversation?.id || !currentUserId) return undefined;
    let active = true;
    const convId = selectedConversation.id;
    const cachedMsgs = cachedDirectMessages.get(convId);
    if (cachedMsgs) {
      setMessages(cachedMsgs);
    }
    const showSpinner = !cachedMsgs;
    if (showSpinner) setMessagesLoading(true);
    setError("");
    listDirectMessages({ conversationId: convId, currentUserId })
      .then((nextMessages) => {
        if (!active || currentUserIdRef.current !== currentUserId) return;
        setMessages((current) => {
          const byId = new Map();
          for (const item of nextMessages) {
            if (item?.id) byId.set(item.id, item);
          }
          for (const item of current) {
            if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
          }
          const merged = [...byId.values()].sort(
            (a, b) => (Date.parse(a?.createdAt || 0) || 0) - (Date.parse(b?.createdAt || 0) || 0),
          );
          cachedDirectMessages.set(convId, merged);
          return merged;
        });
      })
      .catch((loadError) => { if (active && !cachedMsgs) setError(friendlyError(loadError)); })
      .finally(() => { if (active && showSpinner) setMessagesLoading(false); });

    const unsubscribe = subscribeToDirectMessages({
      conversationId: convId,
      onMessage: (message) => {
        if (!active) return;
        setMessages((current) => {
          if (current.some((item) => item.id === message.id)) return current;
          const next = [...current, {
            ...message,
            own: message.userId === currentUserId,
            sender: message.userId === currentUserId ? (profile?.name || "Sen") : (selectedConversation?.name || "Sora kullanıcısı"),
          }];
          cachedDirectMessages.set(convId, next);
          return next;
        });
        loadConversations({ silent: true });
      },
    });
    return () => { active = false; unsubscribe(); };
  }, [currentUserId, loadConversations, messageRetryNonce, profile?.name, selectedConversation?.id, selectedConversation?.name]);

  useEffect(() => {
    if (!active || !selectedConversation) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelectedConversation(null);
      return true;
    });
    return () => sub.remove();
  }, [active, selectedConversation]);

  const visibleConversations = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase("tr-TR");
    if (!cleanQuery) return conversations;
    return conversations.filter((conversation) => `${conversation.name} ${conversation.handle}`.toLocaleLowerCase("tr-TR").includes(cleanQuery));
  }, [conversations, query]);

  const partnerUserIds = useMemo(
    () =>
      conversations
        .map((c) => c?.otherUserId || c?.partnerId || c?.userId)
        .filter(Boolean),
    [conversations],
  );
  const giftSpentMap = useGiftSpentMap(partnerUserIds);

  const openConversation = useCallback((conversation) => {
    setSelectedConversation(conversation);
    setMessages(cachedDirectMessages.get(conversation?.id) || []);
    setDraft("");
    setError("");
  }, []);

  useEffect(() => {
    const reqId = pendingDirectChat?.requestId;
    if (!reqId || !currentUserId || handledDirectChatReqRef.current === reqId) return undefined;
    handledDirectChatReqRef.current = reqId;
    onConsumePendingDirectChat?.(reqId);

    const rawHandle = String(pendingDirectChat?.handle || "").trim().replace(/^@+/, "");
    const targetUserId = pendingDirectChat?.userId || null;
    if (!rawHandle && !targetUserId) {
      setStartingChat(false);
      return undefined;
    }

    const existing = conversationsRef.current.find(
      (item) =>
        (targetUserId && (item.userId === targetUserId || item.otherUserId === targetUserId)) ||
        (rawHandle && String(item.handle || "").replace(/^@+/, "").toLowerCase() === rawHandle.toLowerCase()),
    );
    if (existing) {
      setStartingChat(false);
      setNewChatOpen(false);
      openConversation(existing);
      loadConversations({ silent: true });
      return undefined;
    }

    if (!rawHandle) {
      setStartingChat(false);
      Alert.alert("Sohbet başlatılamadı", "Bu kullanıcının mesajlaşma adresi bulunamadı.");
      return undefined;
    }

    const requestUserId = currentUserId;
    setNewChatOpen(false);
    setStartingChat(true);
    startDirectConversation(rawHandle)
      .then(async (conversationId) => {
        if (
          !isMountedRef.current ||
          handledDirectChatReqRef.current !== reqId ||
          currentUserIdRef.current !== requestUserId
        ) {
          return;
        }
        const nextConversations = await listDirectConversations();
        if (
          !isMountedRef.current ||
          handledDirectChatReqRef.current !== reqId ||
          currentUserIdRef.current !== requestUserId
        ) {
          return;
        }
        cachedInboxUserId = requestUserId;
        cachedInboxConversations = nextConversations;
        setConversations(nextConversations);
        const found =
          nextConversations.find((item) => item.id === conversationId) ||
          nextConversations.find(
            (item) =>
              (targetUserId && (item.userId === targetUserId || item.otherUserId === targetUserId)) ||
              String(item.handle || "").replace(/^@+/, "").toLowerCase() === rawHandle.toLowerCase(),
          );
        if (found) {
          openConversation(found);
        } else {
          Alert.alert("Sohbet başlatılamadı", "Konuşma listesi yenilenemedi. Lütfen tekrar dene.");
        }
      })
      .catch((startError) => {
        if (
          isMountedRef.current &&
          handledDirectChatReqRef.current === reqId &&
          currentUserIdRef.current === requestUserId
        ) {
          Alert.alert("Sohbet başlatılamadı", friendlyError(startError));
        }
      })
      .finally(() => {
        if (
          isMountedRef.current &&
          handledDirectChatReqRef.current === reqId &&
          currentUserIdRef.current === requestUserId
        ) {
          setStartingChat(false);
        }
      });

    return undefined;
  }, [currentUserId, loadConversations, onConsumePendingDirectChat, openConversation, pendingDirectChat]);

  const createConversation = async () => {
    const handle = newHandle.trim().replace(/^@+/, "");
    if (!/^[a-z0-9_]{3,24}$/i.test(handle)) {
      Alert.alert("Kullanıcı adını kontrol et", "3-24 karakterlik geçerli bir kullanıcı adı yaz.");
      return;
    }
    setStartingChat(true);
    try {
      const conversationId = await startDirectConversation(handle);
      const nextConversations = await listDirectConversations();
      setConversations(nextConversations);
      const conversation = nextConversations.find((item) => item.id === conversationId);
      setNewChatOpen(false);
      setNewHandle("");
      if (conversation) openConversation(conversation);
    } catch (startError) {
      Alert.alert("Sohbet başlatılamadı", friendlyError(startError));
    } finally {
      setStartingChat(false);
    }
  };

  const submitMessage = async () => {
    const text = draft.trim();
    const targetConvId = selectedConversation?.id;
    if (!text || !targetConvId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const sentMessage = await sendDirectMessage({ conversationId: targetConvId, userId: currentUserId, text });
      if (selectedConversationIdRef.current === targetConvId) {
        setMessages((current) => {
          if (current.some((item) => item.id === sentMessage.id)) return current;
          const next = [...current, { ...sentMessage, sender: profile?.name || "Sen" }];
          cachedDirectMessages.set(targetConvId, next);
          return next;
        });
      }
      loadConversations({ silent: true });
    } catch (sendError) {
      if (selectedConversationIdRef.current === targetConvId) {
        setDraft(text);
      }
      Alert.alert("Mesaj gönderilemedi", friendlyError(sendError));
    } finally {
      setSending(false);
    }
  };

  if (selectedConversation) {
    const partnerId =
      selectedConversation.otherUserId ||
      selectedConversation.partnerId ||
      selectedConversation.userId;
    const partnerSpent = partnerId ? giftSpentMap[partnerId] || 0 : 0;
    const partnerLiveRoom = partnerId ? liveRoomByUserId.get(partnerId) || null : null;
    const canSend = Boolean(draft.trim()) && !sending;
    return (
      <KeyboardSafeView style={styles.screen} iosOffset={insets.top}>
        <View style={styles.chatHeader}>
          <Pressable
            onPress={() => setSelectedConversation(null)}
            accessibilityLabel="Sohbet listesine dön"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.headerButton,
              pressed && { transform: [{ scale: 0.93 }], opacity: 0.82 },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color="#0F172A" />
          </Pressable>
          <Avatar
            name={selectedConversation.name}
            color={selectedConversation.color}
            uri={selectedConversation.avatarUrl}
            live={Boolean(partnerLiveRoom)}
            size={40}
          />
          <View style={styles.chatHeaderCopy}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text numberOfLines={1} style={styles.chatHeaderName}>
                {selectedConversation.name}
              </Text>
              {partnerSpent >= 1000000 ? (
                <SoraWealthBadge spent={partnerSpent} size="sm" />
              ) : null}
            </View>
            <Text style={styles.chatHeaderHandle}>@{selectedConversation.handle}</Text>
          </View>
        </View>
        {partnerLiveRoom && onOpenRoom ? (
          <Pressable
            onPress={() => onOpenRoom(partnerLiveRoom)}
            style={({ pressed }) => [
              styles.livePartnerBar,
              pressed && { opacity: 0.88 },
            ]}
          >
            <View style={styles.livePartnerDot} />
            <Text numberOfLines={1} style={styles.livePartnerText}>
              Şu an canlı odada · {partnerLiveRoom.title}
            </Text>
            <View style={styles.livePartnerBtn}>
              <Text style={styles.livePartnerBtnText}>Katıl</Text>
              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
            </View>
          </Pressable>
        ) : null}
        {error ? (
          <Pressable
            onPress={() => {
              setError("");
              setMessageRetryNonce((n) => n + 1);
            }}
            style={styles.errorBanner}
          >
            <Ionicons name="alert-circle-outline" size={17} color={COLORS.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : null}
        {messagesLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView
            ref={chatScrollRef}
            onContentSizeChange={() => chatScrollRef.current?.scrollToEnd?.({ animated: false })}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!messages.length ? (
              <EmptyState
                icon="chatbubble-ellipses-outline"
                title="İlk mesajı sen gönder"
                description="Bu konuşmadaki mesajlar hesabına bağlı olarak saklanır."
              />
            ) : (
              messages.map((message, index) => {
                const isOwn = Boolean(
                  message.own || (currentUserId && message.userId === currentUserId),
                );
                const curDateKey = getDateKey(message.createdAt);
                const prevDateKey = index > 0 ? getDateKey(messages[index - 1]?.createdAt) : "";
                const showDateSep = Boolean(curDateKey && curDateKey !== prevDateKey);
                const clockText = formatBubbleClock(message.createdAt);
                return (
                  <View key={message.id}>
                    {showDateSep ? (
                      <View style={styles.dateSeparator}>
                        <Text style={styles.dateSeparatorText}>
                          {formatDateSeparator(message.createdAt)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
                      {!isOwn ? (
                        <Avatar
                          name={selectedConversation.name}
                          color={selectedConversation.color}
                          uri={selectedConversation.avatarUrl}
                          size={28}
                          borderColor="#FFFFFF"
                          style={styles.messageAvatar}
                        />
                      ) : null}
                      {isOwn ? (
                        <LinearGradient
                          colors={["#4598FF", "#2563EB"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[styles.messageBubble, styles.messageBubbleOwn]}
                        >
                          <Text style={[styles.messageBody, styles.messageBodyOwn]}>
                            {message.text}
                          </Text>
                          {clockText ? (
                            <Text style={[styles.messageTime, styles.messageTimeOwn]}>
                              {clockText}
                            </Text>
                          ) : null}
                        </LinearGradient>
                      ) : (
                        <View style={styles.messageBubble}>
                          <Text style={styles.messageBody}>{message.text}</Text>
                          {clockText ? (
                            <Text style={styles.messageTime}>{clockText}</Text>
                          ) : null}
                        </View>
                      )}
                      {isOwn ? (
                        <Avatar
                          name={profile?.name || "Sen"}
                          color={profile?.color || COLORS.primary}
                          uri={profile?.avatarUrl || null}
                          size={28}
                          borderColor="rgba(47, 128, 237, 0.36)"
                          style={styles.messageAvatar}
                        />
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
        <View
          style={[
            styles.composerWrap,
            { marginBottom: keyboard.visible ? 0 : 64 + Math.max(insets.bottom, 8) },
          ]}
        >
          <View style={styles.composerCapsule}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submitMessage}
              returnKeyType="send"
              placeholder="Mesaj yaz..."
              placeholderTextColor="#8A99AE"
              style={styles.composerInput}
              maxLength={500}
              multiline
            />
            <Pressable
              disabled={!canSend}
              onPress={submitMessage}
              accessibilityLabel="Mesaj gönder"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && !sending && styles.sendButtonDisabled,
                pressed && canSend && { transform: [{ scale: 0.92 }] },
              ]}
            >
              {canSend || sending ? (
                <LinearGradient
                  colors={["#4FA3FF", "#2F80ED", "#1E66D4"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                />
              ) : null}
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={canSend ? "#FFFFFF" : "#94A3B8"}
                />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardSafeView>
    );
  }

  return (
    <View style={styles.screen}>
      <Reveal distance={10}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Mesajlar</Text>
          <Pressable
            onPress={() => setNewChatOpen(true)}
            accessibilityLabel="Yeni sohbet"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.newButton,
              pressed && { transform: [{ scale: 0.93 }], opacity: 0.9 },
            ]}
          >
            <LinearGradient
              colors={["#4FA3FF", "#2F80ED", "#1A5BC4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 21 }]}
            />
            <LinearGradient
              colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              pointerEvents="none"
              style={styles.newButtonGloss}
            />
            <Ionicons name="pencil" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </Reveal>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color="#2F80ED" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Kişi ara"
          placeholderTextColor="#7B8BA0"
          style={styles.searchInput}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable
            onPress={() => setQuery("")}
            accessibilityLabel="Aramayı temizle"
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close-circle" size={18} color="#8A99AE" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Pressable onPress={() => loadConversations()} style={styles.errorBanner}>
          <Ionicons name="refresh-outline" size={17} color={COLORS.danger} />
          <Text style={styles.errorText}>{error} Tekrar dene.</Text>
        </Pressable>
      ) : null}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Sohbetler yükleniyor...</Text>
        </View>
      ) : !visibleConversations.length ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={query ? "Sonuç bulunamadı" : "Henüz sohbet yok"}
          description={
            query
              ? "Farklı bir isim veya kullanıcı adı ara."
              : "Gerçek bir kullanıcı adıyla yeni sohbet başlat ve sesli arkadaşlarını yakında tut."
          }
          action={query ? null : "Sohbet başlat"}
          onAction={() => setNewChatOpen(true)}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.conversationList} showsVerticalScrollIndicator={false}>
          {visibleConversations.map((conversation, index) => {
            const partnerId =
              conversation.otherUserId || conversation.partnerId || conversation.userId;
            const partnerSpent = partnerId ? giftSpentMap[partnerId] || 0 : 0;
            const partnerLiveRoom = partnerId ? liveRoomByUserId.get(partnerId) || null : null;
            const unreadCount = Number(conversation.unreadCount || 0);
            const hasUnread = unreadCount > 0;
            const isLast = index === visibleConversations.length - 1;
            return (
              <Reveal key={conversation.id} delay={Math.min(index, 6) * 40} distance={8}>
                <Pressable
                  onPress={() => openConversation(conversation)}
                  style={({ pressed }) => [
                    styles.conversationRow,
                    isLast && styles.conversationRowLast,
                    pressed && { opacity: 0.72, transform: [{ scale: 0.992 }] },
                  ]}
                >
                  <Avatar
                    name={conversation.name}
                    color={conversation.color}
                    uri={conversation.avatarUrl}
                    live={Boolean(partnerLiveRoom)}
                    size={50}
                  />
                  <View style={styles.conversationCopy}>
                    <View style={styles.conversationTop}>
                      <View style={styles.conversationNameWrap}>
                        <Text numberOfLines={1} style={styles.conversationName}>
                          {conversation.name}
                        </Text>
                        {partnerSpent >= 1000000 ? (
                          <SoraWealthBadge spent={partnerSpent} size="sm" animated={false} />
                        ) : null}
                        {partnerLiveRoom ? (
                          <View style={styles.liveInlineBadge}>
                            <View style={styles.liveInlineDot} />
                            <Text style={styles.liveInlineText}>Odada</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.conversationTime,
                          hasUnread && styles.conversationTimeUnread,
                        ]}
                      >
                        {formatMessageTime(conversation.lastMessageAt)}
                      </Text>
                    </View>
                    <View style={styles.conversationBottom}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.conversationMessage,
                          hasUnread && styles.conversationMessageUnread,
                        ]}
                      >
                        {conversation.lastMessage || "@" + conversation.handle}
                      </Text>
                      {hasUnread ? (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              </Reveal>
            );
          })}
        </ScrollView>
      )}
      <Modal
        transparent
        visible={newChatOpen}
        animationType="slide"
        onRequestClose={() => setNewChatOpen(false)}
      >
        <KeyboardSafeView style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setNewChatOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <View style={styles.sheetHandle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Yeni sohbet</Text>
                <Pressable onPress={() => setNewChatOpen(false)} style={styles.headerButton}>
                  <Ionicons name="close" size={20} color="#0F172A" />
                </Pressable>
              </View>
              <Text style={styles.fieldLabel}>KULLANICI ADI</Text>
              <View style={styles.handleInput}>
                <Text style={styles.handlePrefix}>@</Text>
                <TextInput
                  value={newHandle}
                  onChangeText={setNewHandle}
                  placeholder="kullaniciadi"
                  placeholderTextColor={COLORS.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={24}
                  style={styles.handleTextInput}
                />
              </View>
              <Text style={styles.sheetHint}>
                Yalnızca kayıtlı Sora kullanıcılarıyla sohbet başlatabilirsin.
              </Text>
              <Pressable
                disabled={startingChat}
                onPress={createConversation}
                style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}
              >
                <LinearGradient
                  colors={["#52A5FF", "#2F80ED", "#1D5FBF"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryAction}
                >
                  <ShimmerSweep duration={3400} color="rgba(255,255,255,0.25)" />
                  {startingChat ? (
                    <ActivityIndicator color={COLORS.primaryInk} />
                  ) : (
                    <>
                      <Text style={styles.primaryActionText}>Sohbeti aç</Text>
                      <Ionicons name="arrow-forward" size={19} color={COLORS.primaryInk} />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardSafeView>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  pageHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: {
    color: "#0F172A",
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  newButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#2F80ED",
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  newButtonGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 19,
  },
  search: {
    marginHorizontal: 18,
    height: 44,
    paddingHorizontal: 15,
    borderRadius: 999,
    backgroundColor: "#E8F0FA",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchInput: { flex: 1, color: "#0F172A", fontSize: 14, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  errorBanner: {
    marginHorizontal: 18,
    marginTop: 12,
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
  emptyState: { flex: 1, minHeight: 280, paddingHorizontal: 18, paddingTop: 18, justifyContent: "flex-start" },
  emptyHeroCard: {
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(120,180,255,0.22)",
    shadowColor: "#0A1529",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(140,200,255,0.34)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center", letterSpacing: -0.4 },
  emptyDescription: { color: "rgba(220,235,255,0.78)", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  emptyAction: {
    marginTop: 20,
    borderRadius: 15,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    shadowColor: "#2F80ED",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  emptyActionText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },
  conversationList: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 112 },
  conversationRow: {
    minHeight: 74,
    paddingVertical: 13,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(203,218,236,0.58)",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  conversationRowLast: {
    borderBottomWidth: 0,
  },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarLiveRing: { alignItems: "center", justifyContent: "center", padding: 2 },
  avatarText: { color: "#FFFFFF", fontWeight: "900" },
  conversationCopy: { flex: 1, minWidth: 0 },
  conversationTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  conversationNameWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  conversationName: { flexShrink: 1, color: "#0F172A", fontSize: 15.5, fontWeight: "800" },
  conversationTime: { flexShrink: 0, color: "#8190A2", fontSize: 11.5, fontWeight: "700" },
  conversationTimeUnread: { color: "#2F80ED", fontWeight: "800" },
  conversationBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 3,
  },
  conversationMessage: { flex: 1, color: "#617287", fontSize: 13.5, lineHeight: 18, fontWeight: "500" },
  conversationMessageUnread: { color: "#1E293B", fontWeight: "700" },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "#2F80ED",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  unreadBadgeText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "900" },
  chatHeader: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(203,218,236,0.72)",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5FA",
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeaderCopy: { flex: 1, minWidth: 0 },
  chatHeaderName: { flexShrink: 1, color: "#0F172A", fontSize: 15.5, fontWeight: "900" },
  chatHeaderHandle: { color: "#64748B", fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  messageList: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 14, gap: 10 },
  dateSeparator: {
    alignSelf: "center",
    paddingHorizontal: 11,
    paddingVertical: 3.5,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.17)",
    marginTop: 4,
    marginBottom: 8,
  },
  dateSeparatorText: { color: "#64748B", fontSize: 10.5, fontWeight: "800" },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    gap: 8,
  },
  messageRowOwn: { justifyContent: "flex-end" },
  messageAvatar: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  messageBubble: {
    maxWidth: "74%",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    backgroundColor: "#E8F1FC",
  },
  messageBubbleOwn: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 6,
    shadowColor: "#2563EB",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  messageBody: { color: "#0F172A", fontSize: 14, lineHeight: 19.5, fontWeight: "500" },
  messageBodyOwn: { color: "#FFFFFF" },
  messageTime: { color: "#64748B", fontSize: 10, fontWeight: "700", marginTop: 3.5, alignSelf: "flex-end" },
  messageTimeOwn: { color: "rgba(255,255,255,0.84)" },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 12 : 10,
    backgroundColor: COLORS.background,
  },
  composerCapsule: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.95)",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  composerInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 110,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
    paddingHorizontal: 0,
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "500",
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2F80ED",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#2F80ED",
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  sendButtonDisabled: {
    backgroundColor: "#E4EEF9",
    shadowOpacity: 0,
    elevation: 0,
  },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(4,5,9,0.64)" },
  sheet: { paddingHorizontal: 19, paddingTop: 11, paddingBottom: Platform.OS === "ios" ? 32 : 21, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#C2CEDD", alignSelf: "center", marginBottom: 15 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  sheetTitle: { color: "#0F172A", fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  fieldLabel: { color: COLORS.muted, fontSize: 10.5, letterSpacing: 1.2, fontWeight: "900", marginBottom: 8 },
  handleInput: { height: 50, borderRadius: 15, paddingHorizontal: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center" },
  handlePrefix: { color: COLORS.primary, fontSize: 16, fontWeight: "900" },
  handleTextInput: { flex: 1, color: COLORS.text, fontSize: 15, paddingLeft: 3 },
  sheetHint: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 9, marginBottom: 18 },
  primaryAction: { minHeight: 50, borderRadius: 16, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" },
  primaryActionText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },
  liveInlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.14)",
    flexShrink: 0,
  },
  liveInlineDot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 3,
    backgroundColor: "#22C55E",
  },
  liveInlineText: {
    color: "#15803D",
    fontSize: 9.5,
    fontWeight: "900",
  },
  livePartnerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(22,163,74,0.10)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(34,197,94,0.24)",
  },
  livePartnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#16A34A",
  },
  livePartnerText: {
    flex: 1,
    color: "#14532D",
    fontSize: 12,
    fontWeight: "800",
  },
  livePartnerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#16A34A",
  },
  livePartnerBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
});
