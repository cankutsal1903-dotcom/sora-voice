import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import {
  listDirectConversations,
  listDirectMessages,
  sendDirectMessage,
  startDirectConversation,
  subscribeToDirectMessages,
} from "../data/soraRepository";

const COLORS = {
  background: "#F0F3F4",
  surface: "#FFFFFF",
  raised: "#F7F9FA",
  line: "#E1E6EA",
  text: "#11161C",
  muted: "#8A93A3",
  primary: "#01D9A8",
  primaryInk: "#04211B",
  danger: "#E5486B",
};

const formatMessageTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(date);
};

const friendlyError = (error) => {
  const message = error?.message || "İşlem tamamlanamadı.";
  if (message.includes("User not found")) return "Bu kullanıcı adına sahip bir hesap bulunamadı.";
  if (message.includes("yourself")) return "Kendinle sohbet başlatamazsın.";
  if (message.includes("unavailable")) return "Bu kullanıcıyla sohbet başlatılamıyor.";
  if (message.includes("Duplicate")) return "Aynı mesajı kısa süre içinde tekrar gönderemezsin.";
  if (message.includes("Too many")) return "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.";
  if (message.includes("blocked language")) return "Mesaj topluluk kurallarına uygun değil.";
  return message;
};

function Avatar({ name, color, size = 48 }) {
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: color || "#7FCBEA" }]}><Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(name || "S").charAt(0).toUpperCase()}</Text></View>;
}

function EmptyState({ icon, title, description, action, onAction }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name={icon} size={28} color={COLORS.primary} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text>{action ? <Pressable onPress={onAction} style={styles.emptyAction}><Text style={styles.emptyActionText}>{action}</Text></Pressable> : null}</View>;
}

export function InboxScreen({ currentUserId, profile }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [startingChat, setStartingChat] = useState(false);

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    if (!currentUserId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextConversations = await listDirectConversations();
      setConversations(nextConversations);
      setSelectedConversation((current) => current ? nextConversations.find((item) => item.id === current.id) || current : current);
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversation?.id || !currentUserId) return undefined;
    let active = true;
    setMessagesLoading(true);
    setError("");
    listDirectMessages({ conversationId: selectedConversation.id, currentUserId })
      .then((nextMessages) => { if (active) setMessages(nextMessages); })
      .catch((loadError) => { if (active) setError(friendlyError(loadError)); })
      .finally(() => { if (active) setMessagesLoading(false); });

    const unsubscribe = subscribeToDirectMessages({
      conversationId: selectedConversation.id,
      onMessage: (message) => {
        if (!active) return;
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, {
          ...message,
          own: message.userId === currentUserId,
          sender: message.userId === currentUserId ? profile.name : selectedConversation.name,
        }]);
        loadConversations({ silent: true });
      },
    });
    return () => { active = false; unsubscribe(); };
  }, [currentUserId, loadConversations, profile.name, selectedConversation?.id]);

  const visibleConversations = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase("tr-TR");
    if (!cleanQuery) return conversations;
    return conversations.filter((conversation) => `${conversation.name} ${conversation.handle}`.toLocaleLowerCase("tr-TR").includes(cleanQuery));
  }, [conversations, query]);

  const openConversation = (conversation) => {
    setSelectedConversation(conversation);
    setMessages([]);
    setDraft("");
    setError("");
  };

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
    if (!text || !selectedConversation || sending) return;
    setSending(true);
    setDraft("");
    try {
      const sentMessage = await sendDirectMessage({ conversationId: selectedConversation.id, userId: currentUserId, text });
      setMessages((current) => current.some((item) => item.id === sentMessage.id) ? current : [...current, { ...sentMessage, sender: profile.name }]);
      loadConversations({ silent: true });
    } catch (sendError) {
      setDraft(text);
      Alert.alert("Mesaj gönderilemedi", friendlyError(sendError));
    } finally {
      setSending(false);
    }
  };

  if (selectedConversation) {
    return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
      <View style={styles.chatHeader}>
        <Pressable onPress={() => setSelectedConversation(null)} accessibilityLabel="Sohbet listesine dön" style={styles.headerButton}><Ionicons name="arrow-back" size={21} color={COLORS.text} /></Pressable>
        <Avatar name={selectedConversation.name} color={selectedConversation.color} size={42} />
        <View style={styles.chatHeaderCopy}><Text numberOfLines={1} style={styles.chatHeaderName}>{selectedConversation.name}</Text><Text style={styles.chatHeaderHandle}>@{selectedConversation.handle}</Text></View>
      </View>
      {error ? <Pressable onPress={() => openConversation(selectedConversation)} style={styles.errorBanner}><Ionicons name="alert-circle-outline" size={17} color={COLORS.danger} /><Text style={styles.errorText}>{error}</Text></Pressable> : null}
      {messagesLoading ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View> : <ScrollView contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled">
        {!messages.length ? <EmptyState icon="chatbubble-ellipses-outline" title="İlk mesajı sen gönder" description="Bu konuşmadaki mesajlar hesabına bağlı olarak saklanır." /> : messages.map((message) => <View key={message.id} style={[styles.messageRow, message.own && styles.messageRowOwn]}><View style={[styles.messageBubble, message.own && styles.messageBubbleOwn]}><Text style={[styles.messageBody, message.own && styles.messageBodyOwn]}>{message.text}</Text><Text style={[styles.messageTime, message.own && styles.messageTimeOwn]}>{formatMessageTime(message.createdAt)}</Text></View></View>)}
      </ScrollView>}
      <View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={submitMessage} returnKeyType="send" placeholder="Mesaj yaz..." placeholderTextColor={COLORS.muted} style={styles.composerInput} maxLength={500} multiline /><Pressable disabled={!draft.trim() || sending} onPress={submitMessage} style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}>{sending ? <ActivityIndicator size="small" color={COLORS.primaryInk} /> : <Ionicons name="send" size={18} color={COLORS.primaryInk} />}</Pressable></View>
    </KeyboardAvoidingView>;
  }

  return <View style={styles.screen}>
    <View style={styles.pageHeader}><View><Text style={styles.eyebrow}>MESAJLAR</Text><Text style={styles.pageTitle}>Sohbetlerin.</Text></View><Pressable onPress={() => setNewChatOpen(true)} accessibilityLabel="Yeni sohbet" style={styles.newButton}><Ionicons name="create-outline" size={20} color={COLORS.primaryInk} /></Pressable></View>
    <View style={styles.search}><Ionicons name="search-outline" size={18} color={COLORS.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Kişi ara" placeholderTextColor={COLORS.muted} style={styles.searchInput} autoCapitalize="none" /></View>
    {error ? <Pressable onPress={() => loadConversations()} style={styles.errorBanner}><Ionicons name="refresh-outline" size={17} color={COLORS.danger} /><Text style={styles.errorText}>{error} Tekrar dene.</Text></Pressable> : null}
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.loadingText}>Sohbetler yükleniyor...</Text></View> : !visibleConversations.length ? <EmptyState icon="chatbubbles-outline" title={query ? "Sonuç bulunamadı" : "Henüz sohbet yok"} description={query ? "Farklı bir isim veya kullanıcı adı ara." : "Gerçek bir kullanıcı adıyla yeni sohbet başlat."} action={query ? null : "Sohbet başlat"} onAction={() => setNewChatOpen(true)} /> : <ScrollView contentContainerStyle={styles.conversationList} showsVerticalScrollIndicator={false}>{visibleConversations.map((conversation) => <Pressable key={conversation.id} onPress={() => openConversation(conversation)} style={styles.conversationCard}><Avatar name={conversation.name} color={conversation.color} /><View style={styles.conversationCopy}><View style={styles.conversationTop}><Text numberOfLines={1} style={styles.conversationName}>{conversation.name}</Text><Text style={styles.conversationTime}>{formatMessageTime(conversation.lastMessageAt)}</Text></View><Text numberOfLines={1} style={styles.conversationMessage}>{conversation.lastMessage || ("@" + conversation.handle)}</Text></View></Pressable>)}</ScrollView>}
    <Modal transparent visible={newChatOpen} animationType="slide" onRequestClose={() => setNewChatOpen(false)}><KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={StyleSheet.absoluteFill} onPress={() => setNewChatOpen(false)} /><View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.eyebrow}>YENİ SOHBET</Text><Text style={styles.sheetTitle}>Birini bul.</Text></View><Pressable onPress={() => setNewChatOpen(false)} style={styles.headerButton}><Ionicons name="close" size={21} color={COLORS.text} /></Pressable></View><Text style={styles.fieldLabel}>KULLANICI ADI</Text><View style={styles.handleInput}><Text style={styles.handlePrefix}>@</Text><TextInput value={newHandle} onChangeText={setNewHandle} placeholder="kullaniciadi" placeholderTextColor={COLORS.muted} autoCapitalize="none" autoCorrect={false} maxLength={24} style={styles.handleTextInput} /></View><Text style={styles.sheetHint}>Yalnızca kayıtlı Sora kullanıcılarıyla sohbet başlatabilirsin.</Text><Pressable disabled={startingChat} onPress={createConversation}><LinearGradient colors={[COLORS.primary, "#8CE958"]} style={styles.primaryAction}>{startingChat ? <ActivityIndicator color={COLORS.primaryInk} /> : <><Text style={styles.primaryActionText}>Sohbeti aç</Text><Ionicons name="arrow-forward" size={19} color={COLORS.primaryInk} /></>}</LinearGradient></Pressable></View></KeyboardAvoidingView></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  pageHeader: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  pageTitle: { color: COLORS.text, fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -1.1, marginTop: 3 },
  newButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  search: { marginHorizontal: 18, height: 46, paddingHorizontal: 14, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center", gap: 9 },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  errorBanner: { marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: "rgba(229,72,107,0.10)", borderWidth: 1, borderColor: "rgba(229,72,107,0.28)", flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#C2294A", fontSize: 12, lineHeight: 17, flex: 1 },
  emptyState: { flex: 1, minHeight: 280, paddingHorizontal: 36, alignItems: "center", justifyContent: "center" },
  emptyIcon: { width: 64, height: 64, borderRadius: 23, backgroundColor: COLORS.raised, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  emptyDescription: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  emptyAction: { marginTop: 18, borderRadius: 13, paddingHorizontal: 17, paddingVertical: 11, backgroundColor: COLORS.primary },
  emptyActionText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },
  conversationList: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110, gap: 8 },
  conversationCard: { minHeight: 70, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 17, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  avatarText: { color: "#FFFFFF", fontWeight: "900" },
  conversationCopy: { flex: 1, minWidth: 0 },
  conversationTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  conversationName: { flex: 1, color: COLORS.text, fontSize: 15, fontWeight: "900" },
  conversationTime: { color: COLORS.muted, fontSize: 10 },
  conversationMessage: { color: COLORS.textSecondary, fontSize: 12, marginTop: 5 },
  conversationHandle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  chatHeader: { minHeight: 66, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.line, flexDirection: "row", alignItems: "center", gap: 10 },
  headerButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: COLORS.raised, alignItems: "center", justifyContent: "center" },
  chatHeaderCopy: { flex: 1, minWidth: 0 },
  chatHeaderName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  chatHeaderHandle: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  savedBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, backgroundColor: "rgba(1,217,168,0.12)", paddingHorizontal: 8, paddingVertical: 6 },
  savedBadgeText: { color: COLORS.primary, fontSize: 9, fontWeight: "800" },
  messageList: { flexGrow: 1, justifyContent: "flex-end", padding: 16, gap: 8 },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowOwn: { justifyContent: "flex-end" },
  messageBubble: { maxWidth: "82%", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 17, borderBottomLeftRadius: 5, backgroundColor: COLORS.raised, borderWidth: 1, borderColor: COLORS.line },
  messageBubbleOwn: { borderBottomLeftRadius: 17, borderBottomRightRadius: 5, backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  messageBody: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  messageBodyOwn: { color: COLORS.primaryInk },
  messageTime: { color: COLORS.muted, fontSize: 9, marginTop: 5, alignSelf: "flex-end" },
  messageTimeOwn: { color: "#0B5A4B" },
  composer: { paddingHorizontal: 13, paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 12 : 9, borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: COLORS.background, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composerInput: { flex: 1, minHeight: 43, maxHeight: 112, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, color: COLORS.text, fontSize: 14 },
  sendButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  sendButtonDisabled: { opacity: 0.42 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(4,5,9,0.64)" },
  sheet: { paddingHorizontal: 19, paddingTop: 11, paddingBottom: Platform.OS === "ios" ? 32 : 21, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#C4CBD3", alignSelf: "center", marginBottom: 15 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  sheetTitle: { color: COLORS.text, fontSize: 25, fontWeight: "900", marginTop: 3 },
  fieldLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: "900", marginBottom: 8 },
  handleInput: { height: 50, borderRadius: 15, paddingHorizontal: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center" },
  handlePrefix: { color: COLORS.primary, fontSize: 16, fontWeight: "900" },
  handleTextInput: { flex: 1, color: COLORS.text, fontSize: 15, paddingLeft: 3 },
  sheetHint: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 9, marginBottom: 18 },
  primaryAction: { minHeight: 49, borderRadius: 15, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryActionText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },
});
