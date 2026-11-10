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
  createCommunity,
  listCommunities,
  setCommunityMembership,
  subscribeToCommunities,
} from "../data/soraRepository";

const COLORS = {
  background: "#10111C",
  surface: "#1A1C29",
  raised: "#242735",
  line: "#303344",
  text: "#F7F7FB",
  muted: "#9699AC",
  primary: "#B5FF78",
  primaryInk: "#172117",
  danger: "#FF7BA7",
};

const COMMUNITY_THEMES = [
  ["#6046A7", "#28244F"],
  ["#166A73", "#16333D"],
  ["#A04D6F", "#3E2235"],
  ["#7D6030", "#332B1D"],
];

const friendlyError = (error) => {
  const message = error?.message || "İşlem tamamlanamadı.";
  if (message.includes("duplicate key") || error?.code === "23505") return "Bu topluluk adı daha önce alınmış.";
  if (message.includes("row-level security")) return "Bu işlem için hesabının yetkisi yok.";
  return message;
};

function EmptyState({ joinedOnly, onCreate }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name={joinedOnly ? "people-outline" : "planet-outline"} size={30} color={COLORS.primary} /></View><Text style={styles.emptyTitle}>{joinedOnly ? "Henüz bir topluluğa katılmadın" : "İlk topluluğu sen kur"}</Text><Text style={styles.emptyDescription}>{joinedOnly ? "Keşfet sekmesinden ilgini çeken bir topluluğa katılabilirsin." : "Topluluklar gerçek hesaplara bağlıdır ve tüm cihazlarında görünür."}</Text>{!joinedOnly ? <Pressable onPress={onCreate} style={styles.emptyAction}><Text style={styles.emptyActionText}>Topluluk kur</Text></Pressable> : null}</View>;
}

export function CommunityScreen({ currentUserId }) {
  const [communities, setCommunities] = useState([]);
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workingId, setWorkingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTheme, setSelectedTheme] = useState(0);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!currentUserId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      setCommunities(await listCommunities(currentUserId));
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    load();
    if (!currentUserId) return undefined;
    const unsubscribe = subscribeToCommunities(() => load({ silent: true }));
    return unsubscribe;
  }, [currentUserId, load]);

  const visibleCommunities = useMemo(() => joinedOnly ? communities.filter((community) => community.joined) : communities, [communities, joinedOnly]);
  const joinedCount = communities.filter((community) => community.joined).length;

  const toggleMembership = async (community) => {
    if (community.role === "owner") {
      Alert.alert("Topluluğun sahibi sensin", "Sahip olduğun topluluktan ayrılamazsın.");
      return;
    }
    setWorkingId(community.id);
    const nextJoined = !community.joined;
    try {
      await setCommunityMembership({ communityId: community.id, userId: currentUserId, joined: nextJoined });
      setCommunities((current) => current.map((item) => item.id === community.id ? { ...item, joined: nextJoined, role: nextJoined ? "member" : null, memberCount: Math.max(0, item.memberCount + (nextJoined ? 1 : -1)) } : item));
    } catch (membershipError) {
      Alert.alert("İşlem tamamlanamadı", friendlyError(membershipError));
    } finally {
      setWorkingId(null);
    }
  };

  const submitCommunity = async () => {
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (cleanName.length < 3) {
      Alert.alert("Topluluk adı kısa", "En az 3 karakterlik bir ad yaz.");
      return;
    }
    setCreating(true);
    try {
      const community = await createCommunity({
        userId: currentUserId,
        name: cleanName,
        description: cleanDescription,
        colors: COMMUNITY_THEMES[selectedTheme],
      });
      setCommunities((current) => [community, ...current.filter((item) => item.id !== community.id)]);
      setName("");
      setDescription("");
      setSelectedTheme(0);
      setCreateOpen(false);
    } catch (createError) {
      Alert.alert("Topluluk oluşturulamadı", friendlyError(createError));
    } finally {
      setCreating(false);
    }
  };

  return <View style={styles.screen}>
    <View style={styles.pageHeader}><View><Text style={styles.eyebrow}>TOPLULUKLAR</Text><Text style={styles.pageTitle}>Birlikte büyü.</Text></View><Pressable onPress={() => setCreateOpen(true)} accessibilityLabel="Topluluk oluştur" style={styles.newButton}><Ionicons name="add" size={22} color={COLORS.primaryInk} /></Pressable></View>
    <LinearGradient colors={["#242B39", "#191C29"]} style={styles.hero}><View style={styles.heroGlow} /><View style={styles.heroIcon}><Ionicons name="planet-outline" size={25} color={COLORS.primary} /></View><View style={styles.heroCopy}><Text style={styles.heroTitle}>Gerçek çevreni kur.</Text><Text style={styles.heroDescription}>İlgini çeken toplulukları keşfet, yeni insanlarla bir araya gel.</Text></View></LinearGradient>
    <View style={styles.filters}><Pressable onPress={() => setJoinedOnly(false)} style={[styles.filter, !joinedOnly && styles.filterActive]}><Text style={[styles.filterText, !joinedOnly && styles.filterTextActive]}>Keşfet</Text></Pressable><Pressable onPress={() => setJoinedOnly(true)} style={[styles.filter, joinedOnly && styles.filterActive]}><Text style={[styles.filterText, joinedOnly && styles.filterTextActive]}>Katıldıkların · {joinedCount}</Text></Pressable></View>
    {error ? <Pressable onPress={() => load()} style={styles.errorBanner}><Ionicons name="refresh-outline" size={17} color={COLORS.danger} /><Text style={styles.errorText}>{error} Tekrar dene.</Text></Pressable> : null}
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.loadingText}>Topluluklar yükleniyor...</Text></View> : !visibleCommunities.length ? <EmptyState joinedOnly={joinedOnly} onCreate={() => setCreateOpen(true)} /> : <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>{visibleCommunities.map((community) => <View key={community.id} style={styles.card}><LinearGradient colors={community.colors || COMMUNITY_THEMES[0]} style={styles.cardVisual}><View style={styles.cardOrb} /><View style={styles.communityIcon}><Ionicons name={community.icon || "people"} size={25} color="#FFFFFF" /></View><View style={styles.memberPill}><Ionicons name="people" size={12} color="#FFFFFF" /><Text style={styles.memberPillText}>{community.memberCount}</Text></View></LinearGradient><View style={styles.cardBody}><View style={styles.cardTitleRow}><Text numberOfLines={1} style={styles.cardTitle}>{community.name}</Text>{community.role === "owner" ? <View style={styles.ownerBadge}><Ionicons name="shield-checkmark" size={12} color="#F4D168" /><Text style={styles.ownerBadgeText}>Sahibi</Text></View> : null}</View><Text numberOfLines={2} style={styles.cardDescription}>{community.description || "Bu topluluğun açıklaması henüz eklenmedi."}</Text><View style={styles.cardFooter}><Text style={styles.persistedText}><Ionicons name="cloud-done-outline" size={12} color={COLORS.primary} /> Hesaba kayıtlı</Text><Pressable disabled={workingId === community.id || community.role === "owner"} onPress={() => toggleMembership(community)} style={[styles.joinButton, community.joined && styles.joinButtonJoined, community.role === "owner" && styles.joinButtonOwner]}>{workingId === community.id ? <ActivityIndicator size="small" color={community.joined ? COLORS.primary : COLORS.primaryInk} /> : <Text style={[styles.joinButtonText, community.joined && styles.joinButtonTextJoined]}>{community.role === "owner" ? "Sahibi" : community.joined ? "Ayrıl" : "Katıl"}</Text>}</Pressable></View></View></View>)}</ScrollView>}
    <Modal transparent visible={createOpen} animationType="slide" onRequestClose={() => setCreateOpen(false)}><KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={StyleSheet.absoluteFill} onPress={() => setCreateOpen(false)} /><View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.eyebrow}>YENİ TOPLULUK</Text><Text style={styles.sheetTitle}>Çevreni kur.</Text></View><Pressable onPress={() => setCreateOpen(false)} style={styles.closeButton}><Ionicons name="close" size={21} color={COLORS.text} /></Pressable></View><Text style={styles.fieldLabel}>TOPLULUK ADI</Text><TextInput value={name} onChangeText={setName} placeholder="Örn. Gece Sohbetleri" placeholderTextColor={COLORS.muted} maxLength={40} style={styles.input} /><Text style={styles.fieldLabel}>AÇIKLAMA</Text><TextInput value={description} onChangeText={setDescription} placeholder="Topluluğun ne hakkında?" placeholderTextColor={COLORS.muted} maxLength={240} multiline style={[styles.input, styles.descriptionInput]} /><Text style={styles.fieldLabel}>TEMA</Text><View style={styles.themeRow}>{COMMUNITY_THEMES.map((theme, index) => <Pressable key={theme[0]} onPress={() => setSelectedTheme(index)} style={[styles.themeOption, selectedTheme === index && styles.themeOptionSelected]}><LinearGradient colors={theme} style={styles.themeGradient}>{selectedTheme === index ? <Ionicons name="checkmark" size={18} color="#FFFFFF" /> : null}</LinearGradient></Pressable>)}</View><Pressable disabled={creating} onPress={submitCommunity}><LinearGradient colors={[COLORS.primary, "#8CE958"]} style={styles.primaryAction}>{creating ? <ActivityIndicator color={COLORS.primaryInk} /> : <><Text style={styles.primaryActionText}>Topluluğu oluştur</Text><Ionicons name="arrow-forward" size={19} color={COLORS.primaryInk} /></>}</LinearGradient></Pressable></View></KeyboardAvoidingView></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  pageHeader: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  pageTitle: { color: COLORS.text, fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -1.1, marginTop: 3 },
  newButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  hero: { marginHorizontal: 18, minHeight: 108, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "#343847", flexDirection: "row", alignItems: "center", overflow: "hidden" },
  heroGlow: { position: "absolute", width: 160, height: 160, borderRadius: 80, right: -45, top: -80, backgroundColor: "rgba(181,255,120,0.08)" },
  heroIcon: { width: 50, height: 50, borderRadius: 18, backgroundColor: "#202A25", borderWidth: 1, borderColor: "#405548", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, marginLeft: 13 },
  heroTitle: { color: COLORS.text, fontSize: 17, fontWeight: "900" },
  heroDescription: { color: "#B3B7C6", fontSize: 11, lineHeight: 16, marginTop: 5 },
  filters: { marginHorizontal: 18, marginTop: 14, padding: 4, borderRadius: 14, backgroundColor: COLORS.surface, flexDirection: "row" },
  filter: { flex: 1, minHeight: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  filterActive: { backgroundColor: COLORS.raised },
  filterText: { color: COLORS.muted, fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: COLORS.primary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  errorBanner: { marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: "#2B1D2A", borderWidth: 1, borderColor: "#5B3049", flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#FFC2D4", fontSize: 12, lineHeight: 17, flex: 1 },
  emptyState: { flex: 1, minHeight: 260, paddingHorizontal: 36, alignItems: "center", justifyContent: "center" },
  emptyIcon: { width: 68, height: 68, borderRadius: 24, backgroundColor: "#20252A", borderWidth: 1, borderColor: "#3D5745", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  emptyDescription: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  emptyAction: { marginTop: 18, borderRadius: 13, paddingHorizontal: 17, paddingVertical: 11, backgroundColor: COLORS.primary },
  emptyActionText: { color: COLORS.primaryInk, fontSize: 12, fontWeight: "900" },
  list: { padding: 18, paddingBottom: 110, gap: 13 },
  card: { borderRadius: 23, overflow: "hidden", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line },
  cardVisual: { height: 88, padding: 14, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", overflow: "hidden" },
  cardOrb: { position: "absolute", width: 150, height: 150, borderRadius: 75, right: -20, top: -72, backgroundColor: "rgba(255,255,255,0.13)" },
  communityIcon: { width: 47, height: 47, borderRadius: 17, backgroundColor: "rgba(10,11,20,0.28)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  memberPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "rgba(10,11,20,0.28)" },
  memberPillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  cardBody: { padding: 14 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 17, fontWeight: "900" },
  ownerBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 9, backgroundColor: "#2C291E", paddingHorizontal: 7, paddingVertical: 5 },
  ownerBadgeText: { color: "#F4D168", fontSize: 9, fontWeight: "900" },
  cardDescription: { color: "#B7BAC8", fontSize: 12, lineHeight: 18, marginTop: 7 },
  cardFooter: { marginTop: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  persistedText: { color: COLORS.muted, fontSize: 10 },
  joinButton: { minWidth: 76, height: 35, borderRadius: 12, paddingHorizontal: 13, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  joinButtonJoined: { backgroundColor: "#202A25", borderWidth: 1, borderColor: "#405548" },
  joinButtonOwner: { opacity: 0.62 },
  joinButtonText: { color: COLORS.primaryInk, fontSize: 11, fontWeight: "900" },
  joinButtonTextJoined: { color: COLORS.primary },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(4,5,9,0.64)" },
  sheet: { paddingHorizontal: 19, paddingTop: 11, paddingBottom: Platform.OS === "ios" ? 32 : 21, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#171923", borderWidth: 1, borderColor: COLORS.line },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#4A4D5E", alignSelf: "center", marginBottom: 15 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  sheetTitle: { color: COLORS.text, fontSize: 25, fontWeight: "900", marginTop: 3 },
  closeButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: COLORS.raised, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: "900", marginBottom: 8 },
  input: { minHeight: 49, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, color: COLORS.text, fontSize: 14, marginBottom: 15 },
  descriptionInput: { minHeight: 84, textAlignVertical: "top" },
  themeRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  themeOption: { width: 48, height: 48, borderRadius: 16, padding: 3, borderWidth: 2, borderColor: "transparent" },
  themeOptionSelected: { borderColor: COLORS.primary },
  themeGradient: { flex: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  primaryAction: { minHeight: 49, borderRadius: 15, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryActionText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "900" },
});
