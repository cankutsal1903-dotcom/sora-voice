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

const formatMessageTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return TR_TIME_FMT.format(date);
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

const Avatar = memo(function Avatar({ name, color, size = 48, uri = null }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: color || "#7FCBEA", overflow: "hidden" }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(name || "S").charAt(0).toUpperCase()}</Text>
      )}
    </View>
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
    if (!rawHandle && !targetUserId) return undefined;

    const existing = conversationsRef.current.find(
      (item) =>
        (targetUserId && (item.userId === targetUserId || item.otherUserId === targetUserId)) ||
        (rawHandle && String(item.handle || "").replace(/^@+/, "").toLowerCase() === rawHandle.toLowerCase()),
    );
    if (existing) {
      setNewChatOpen(false);
      openConversation(existing);
      loadConversations({ silent: true });
      return undefined;
    }

    if (!rawHandle) {
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
    return (
      <KeyboardSafeView style={styles.screen} iosOffset={insets.top}>
        <View style={styles.chatHeader}>
          <Pressable
            onPress={() => setSelectedConversation(null)}
            accessibilityLabel="Sohbet listesine dön"
            style={({ pressed }) => [
              styles.headerButton,
              pressed && { transform: [{ scale: 0.94 }], opacity: 0.85 },
            ]}
          >
            <Ionicons name="arrow-back" size={21} color={COLORS.text} />
          </Pressable>
          <Avatar
            name={selectedConversation.name}
            color={selectedConversation.color}
            uri={selectedConversation.avatarUrl}
            size={42}
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
          >
            {!messages.length ? (
              <EmptyState
                icon="chatbubble-ellipses-outline"
                title="İlk mesajı sen gönder"
                description="Bu konuşmadaki mesajlar hesabına bağlı olarak saklanır."
              />
            ) : (
              messages.map((message) => (
                <View
                  key={message.id}
                  style={[styles.messageRow, message.own && styles.messageRowOwn]}
                >
                  {message.own ? (
                    <LinearGradient
                      colors={["#3B8DF6", "#2563EB"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.messageBubble, styles.messageBubbleOwn]}
                    >
                      <Text style={[styles.messageBody, styles.messageBodyOwn]}>
                        {message.text}
                      </Text>
                      <Text style={[styles.messageTime, styles.messageTimeOwn]}>
                        {formatMessageTime(message.createdAt)}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.messageBubble}>
                      <Text style={styles.messageBody}>{message.text}</Text>
                      <Text style={styles.messageTime}>
                        {formatMessageTime(message.createdAt)}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        )}
        <View
          style={[
            styles.composer,
            { marginBottom: keyboard.visible ? 0 : 64 + Math.max(insets.bottom, 8) },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitMessage}
            returnKeyType="send"
            placeholder="Mesaj yaz..."
            placeholderTextColor={COLORS.muted}
            style={styles.composerInput}
            maxLength={500}
            multiline
          />
          <Pressable
            disabled={!draft.trim() || sending}
            onPress={submitMessage}
            style={({ pressed }) => [
              styles.sendButton,
              (!draft.trim() || sending) && styles.sendButtonDisabled,
              pressed && { transform: [{ scale: 0.93 }] },
            ]}
          >
            <LinearGradient
              colors={["#3B8DF6", "#2563EB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 21 }]}
            />
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.primaryInk} />
            ) : (
              <Ionicons name="send" size={18} color={COLORS.primaryInk} />
            )}
          </Pressable>
        </View>
      </KeyboardSafeView>
    );
  }

  return (
    <View style={styles.screen}>
      <Reveal distance={10}>
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.eyebrow}>SORA · MESAJLAR</Text>
            <Text style={styles.pageTitle}>Mesajlar</Text>
          </View>
          <Pressable
            onPress={() => setNewChatOpen(true)}
            accessibilityLabel="Yeni sohbet"
            style={({ pressed }) => [
              styles.newButton,
              pressed && { transform: [{ scale: 0.93 }], opacity: 0.9 },
            ]}
          >
            <LinearGradient
              colors={["#3B8DF6", "#2563EB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 15 }]}
            />
            <Ionicons name="create-outline" size={20} color={COLORS.primaryInk} />
          </Pressable>
        </View>
      </Reveal>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={COLORS.primary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Kişi ara"
          placeholderTextColor={COLORS.muted}
          style={styles.searchInput}
          autoCapitalize="none"
        />
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
            return (
              <Reveal key={conversation.id} delay={Math.min(index, 6) * 45} distance={10}>
                <Pressable
                  onPress={() => openConversation(conversation)}
                  style={({ pressed }) => [
                    styles.conversationCard,
                    pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
                  ]}
                >
                  <Avatar
                    name={conversation.name}
                    color={conversation.color}
                    uri={conversation.avatarUrl}
                  />
                  <View style={styles.conversationCopy}>
                    <View style={styles.conversationTop}>
                      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
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
                      <Text numberOfLines={1} style={styles.conversationTime}>
                        {formatMessageTime(conversation.lastMessageAt)}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.conversationMessage}>
                      {conversation.lastMessage || "@" + conversation.handle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
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
                <View>
                  <Text style={styles.eyebrow}>YENİ SOHBET</Text>
                  <Text style={styles.sheetTitle}>Yeni sohbet</Text>
                </View>
                <Pressable onPress={() => setNewChatOpen(false)} style={styles.headerButton}>
                  <Ionicons name="close" size={21} color={COLORS.text} />
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
  pageHeader: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  pageTitle: { color: COLORS.text, fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -1.1, marginTop: 3 },
  newButton: {
    width: 45,
    height: 45,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#1D5FBF",
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  search: {
    marginHorizontal: 18,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    shadowColor: "#162A48",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  errorBanner: { marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: "rgba(217,79,92,0.10)", borderWidth: 1, borderColor: "rgba(217,79,92,0.28)", flexDirection: "row", alignItems: "center", gap: 8 },
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
  conversationList: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110, gap: 10 },
  conversationCard: {
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.82)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.34)" },
  avatarText: { color: "#FFFFFF", fontWeight: "900" },
  conversationCopy: { flex: 1, minWidth: 0 },
  conversationTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  conversationName: { flexShrink: 1, color: COLORS.text, fontSize: 15, fontWeight: "900" },
  conversationTime: { flexShrink: 0, color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  conversationMessage: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  conversationHandle: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  chatHeader: {
    minHeight: 68,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(203,218,236,0.75)",
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    elevation: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.raised,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeaderCopy: { flex: 1, minWidth: 0 },
  chatHeaderName: { flexShrink: 1, color: COLORS.text, fontSize: 15.5, fontWeight: "900" },
  chatHeaderHandle: { color: COLORS.muted, fontSize: 11.5, marginTop: 2 },
  savedBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, backgroundColor: "rgba(47,128,237,0.12)", paddingHorizontal: 8, paddingVertical: 6 },
  savedBadgeText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  messageList: { flexGrow: 1, justifyContent: "flex-end", padding: 15, gap: 9 },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowOwn: { justifyContent: "flex-end" },
  messageBubble: {
    maxWidth: "82%",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 19,
    borderBottomLeftRadius: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.86)",
  },
  messageBubbleOwn: {
    borderBottomLeftRadius: 19,
    borderBottomRightRadius: 6,
    borderWidth: 0,
  },
  messageBody: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  messageBodyOwn: { color: COLORS.primaryInk },
  messageTime: { color: COLORS.muted, fontSize: 10.5, marginTop: 4, alignSelf: "flex-end" },
  messageTimeOwn: { color: "rgba(255,255,255,0.84)" },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: Platform.OS === "ios" ? 12 : 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(203,218,236,0.75)",
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  composerInput: {
    flex: 1,
    minHeight: 41,
    maxHeight: 110,
    borderRadius: 21,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: "rgba(203,218,236,0.88)",
    color: COLORS.text,
    fontSize: 14,
  },
  sendButton: {
    width: 41,
    height: 41,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 1,
  },
  sendButtonDisabled: { opacity: 0.42 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(4,5,9,0.64)" },
  sheet: { paddingHorizontal: 19, paddingTop: 11, paddingBottom: Platform.OS === "ios" ? 32 : 21, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#C2CEDD", alignSelf: "center", marginBottom: 15 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  sheetTitle: { color: COLORS.text, fontSize: 25, fontWeight: "900", marginTop: 3 },
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
    backgroundColor: "rgba(22,163,74,0.13)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.34)",
    flexShrink: 0,
  },
  liveInlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#16A34A",
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
