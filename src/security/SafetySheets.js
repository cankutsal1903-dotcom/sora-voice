import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  createSafetyReport,
  getAdminSecurityOverview,
  listAdminBankTransferRequests,
  listAdminSafetyReports,
  reviewAdminBankTransferRequest,
  listBlockedUsers,
  listMySafetyReports,
  resolveAdminSafetyReport,
  setUserBlocked,
} from "../data/soraRepository";
import { COLORS } from "../theme/colors";

const REPORT_REASONS = [
  ["spam", "Spam", "mail-unread-outline"],
  ["harassment", "Taciz", "warning-outline"],
  ["hate", "Nefret söylemi", "ban-outline"],
  ["sexual", "Uygunsuz içerik", "eye-off-outline"],
  ["violence", "Şiddet", "alert-circle-outline"],
  ["impersonation", "Taklit hesap", "people-outline"],
  ["other", "Diğer", "ellipsis-horizontal"],
];

const CATEGORY_LABELS = Object.fromEntries(REPORT_REASONS.map(([key, label]) => [key, label]));
const STATUS_LABELS = { open: "Bekliyor", reviewing: "İnceleniyor", actioned: "İşlem yapıldı", dismissed: "Kapatıldı" };

function SheetFrame({ visible, onDismiss, children, tall = false }) {
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
    <View style={styles.overlay}>
      <Pressable style={styles.dismissArea} onPress={onDismiss} />
      <View style={[styles.sheet, tall && styles.tallSheet]}>
        <View style={styles.handle} />
        <Pressable onPress={onDismiss} style={styles.closeButton}><Ionicons name="close" size={20} color={COLORS.text} /></Pressable>
        {children}
      </View>
    </View>
  </Modal>;
}

function Avatar({ name, color = "#5878B4" }) {
  return <View style={[styles.avatar, { backgroundColor: color }]}><Text style={styles.avatarText}>{(name || "S").charAt(0).toUpperCase()}</Text></View>;
}

export function ReportSheet({ target, onDismiss }) {
  const [category, setCategory] = useState("spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) return;
    setCategory("spam");
    setDetails("");
  }, [target]);

  const submit = async () => {
    if (!target?.roomId && !target?.userId && !target?.messageId) return;
    setSubmitting(true);
    try {
      await createSafetyReport({
        category,
        details: details.trim(),
        targetUserId: target.userId || null,
        roomId: target.roomId || null,
        messageId: target.messageId || null,
      });
      onDismiss();
      Alert.alert("Bildirimin alındı", "Güvenlik ekibi kaydı inceleyecek. Durumu Güvenlik Merkezi'nden takip edebilirsin.");
    } catch (error) {
      const duplicate = error?.message?.includes("already submitted");
      const limited = error?.message?.includes("Report limit exceeded");
      Alert.alert("Bildirim gönderilemedi", duplicate
        ? "Bu konu için yakın zamanda zaten bildirim yaptın."
        : limited
          ? "Çok sayıda bildirim gönderdin. Bir saat sonra tekrar dene."
          : "Bağlantını kontrol edip tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  };

  return <SheetFrame visible={Boolean(target)} onDismiss={onDismiss} tall>
    <Text style={styles.kicker}>GÜVENLİK BİLDİRİMİ</Text>
    <Text style={styles.title}>{target?.name || "İçeriği"} bildir</Text>
    <Text style={styles.description}>En uygun nedeni seç. Bildirim kimliğin karşı tarafa gösterilmez.</Text>
    <ScrollView style={styles.reasonScroll} contentContainerStyle={styles.reasonGrid}>
      {REPORT_REASONS.map(([key, label, icon]) => <Pressable key={key} onPress={() => setCategory(key)} style={[styles.reason, category === key && styles.reasonActive]}>
        <Ionicons name={icon} size={17} color={category === key ? COLORS.primaryInk : COLORS.muted} />
        <Text style={[styles.reasonText, category === key && styles.reasonTextActive]}>{label}</Text>
      </Pressable>)}
    </ScrollView>
    <Text style={styles.label}>AYRINTI (İSTEĞE BAĞLI)</Text>
    <TextInput value={details} onChangeText={setDetails} placeholder="Ne olduğunu kısaca anlat" placeholderTextColor={COLORS.muted} style={styles.detailsInput} maxLength={500} multiline />
    <Text style={styles.counter}>{details.length}/500</Text>
    <Pressable disabled={submitting} onPress={submit} style={[styles.primaryButton, submitting && styles.disabledButton]}>
      <Text style={styles.primaryButtonText}>{submitting ? "Gönderiliyor" : "Güvenli biçimde gönder"}</Text>
      <Ionicons name="shield-checkmark" size={19} color={COLORS.primaryInk} />
    </Pressable>
  </SheetFrame>;
}

export function SafetyCenterSheet({ visible, onDismiss }) {
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [blocks, ownReports] = await Promise.all([listBlockedUsers(), listMySafetyReports()]);
      setBlockedUsers(blocks);
      setReports(ownReports);
    } catch {
      setError("Güvenlik kayıtları yüklenemedi. Veritabanı güncellemesini ve bağlantını kontrol et.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (visible) load(); }, [visible]);

  const unblock = (user) => {
    Alert.alert("Engel kaldırılsın mı?", `${user.name} yeniden profilini ve ortak odalardaki mesajlarını görebilir.`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Engeli kaldır", onPress: async () => {
        try {
          await setUserBlocked({ targetUserId: user.userId, blocked: false });
          setBlockedUsers((current) => current.filter((item) => item.userId !== user.userId));
        } catch { Alert.alert("İşlem yapılamadı", "Bağlantını kontrol edip tekrar dene."); }
      } },
    ]);
  };

  return <SheetFrame visible={visible} onDismiss={onDismiss} tall>
    <Text style={styles.kicker}>GÜVENLİK MERKEZİ</Text>
    <Text style={styles.title}>Alanını koru.</Text>
    <View style={styles.notice}><Ionicons name="shield-checkmark" size={21} color={COLORS.primary} /><Text style={styles.noticeText}>Engellediğin hesapların mesajları gizlenir ve takip bağlantısı kaldırılır.</Text></View>
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable onPress={load}><Text style={styles.retryText}>Yeniden dene</Text></Pressable></View> : null}
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionLabel}>ENGELLENEN HESAPLAR</Text>
      {blockedUsers.length ? blockedUsers.map((user) => <View key={user.userId} style={styles.userRow}>
        <Avatar name={user.name} color={user.color} />
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>{user.name}</Text><Text style={styles.rowMeta}>@{user.handle}</Text></View>
        <Pressable onPress={() => unblock(user)} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Kaldır</Text></Pressable>
      </View>) : <View style={styles.empty}><Ionicons name="person-add-outline" size={24} color={COLORS.muted} /><Text style={styles.emptyText}>{loading ? "Yükleniyor..." : "Engellenen hesap yok."}</Text></View>}
      <Text style={styles.sectionLabel}>BİLDİRİMLERİM</Text>
      {reports.length ? reports.map((report) => <View key={report.id} style={styles.reportRow}>
        <View style={styles.reportHeader}><Text style={styles.rowTitle}>{CATEGORY_LABELS[report.category] || "Bildirim"}</Text><View style={[styles.statusPill, report.status === "actioned" && styles.statusDone]}><Text style={styles.statusText}>{STATUS_LABELS[report.status] || report.status}</Text></View></View>
        <Text style={styles.rowMeta}>{report.targetName || report.roomTitle || "İçerik"} · {new Date(report.createdAt).toLocaleDateString("tr-TR")}</Text>
        {report.details ? <Text style={styles.reportDetails} numberOfLines={2}>{report.details}</Text> : null}
      </View>) : <View style={styles.empty}><Ionicons name="flag-outline" size={23} color={COLORS.muted} /><Text style={styles.emptyText}>{loading ? "Yükleniyor..." : "Henüz gönderilmiş bildirim yok."}</Text></View>}
    </ScrollView>
  </SheetFrame>;
}

export function AdminPanelSheet({ visible, role, onDismiss }) {
  const [overview, setOverview] = useState(null);
  const [reports, setReports] = useState([]);
  const [transferRequests, setTransferRequests] = useState([]);
  const [creditAmounts, setCreditAmounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [summary, items, transfers] = await Promise.all([
        getAdminSecurityOverview(),
        listAdminSafetyReports(),
        role === "moderator" ? Promise.resolve([]) : listAdminBankTransferRequests(),
      ]);
      setOverview(summary);
      setReports(items);
      setTransferRequests(transfers);
      setCreditAmounts(Object.fromEntries(transfers.filter((request) => request.status === "awaiting_transfer").map((request) => [request.id, String(request.requestedCredits)])));
    } catch { Alert.alert("Panel açılamadı", "Yönetici yetkini ve veritabanı bağlantısını kontrol et."); }
    finally { setLoading(false); }
  };

  const reviewTransfer = (request, approved) => {
    const creditAmount = Number(creditAmounts[request.id] || request.requestedCredits);
    if (approved && (!Number.isInteger(creditAmount) || creditAmount < 1)) {
      Alert.alert("Kredi miktarı gerekli", "Yüklenecek kredi miktarını tam sayı olarak yaz.");
      return;
    }
    Alert.alert(
      approved ? "Transfer onaylansın mı?" : "Talep reddedilsin mi?",
      approved ? `${request.requesterName || "Kullanıcı"} hesabına ${creditAmount} kredi eklenecek. Banka hareketindeki referansı kontrol ettiğinden emin ol.` : "Bu işlem geri alınamaz; kullanıcıya kredi eklenmez.",
      [
        { text: "Vazgeç", style: "cancel" },
        { text: approved ? "Onayla ve yükle" : "Reddet", style: approved ? "default" : "destructive", onPress: async () => {
          setWorkingId(request.id);
          try {
            await reviewAdminBankTransferRequest({ requestId: request.id, approved, creditedCredits: approved ? creditAmount : null });
            await load();
          } catch (error) {
            Alert.alert("İşlem yapılamadı", error?.message?.includes("already reviewed") ? "Bu talep başka bir yönetici tarafından zaten incelendi." : "Yetkini ve veritabanı bağlantısını kontrol et.");
          } finally { setWorkingId(null); }
        } },
      ],
    );
  };

  useEffect(() => { if (visible) load(); }, [visible]);

  const updateReport = async (report, status, sanctionAction = null, sanctionHours = null) => {
    setWorkingId(report.id);
    try {
      await resolveAdminSafetyReport({
        reportId: report.id,
        status,
        resolution: sanctionAction ? `${CATEGORY_LABELS[report.category] || "Güvenlik"} bildirimi sonucunda işlem uygulandı.` : "Yönetici incelemesi tamamlandı.",
        sanctionAction,
        sanctionHours,
      });
      await load();
    } catch { Alert.alert("İşlem yapılamadı", "Rapor güncellenemedi. Yetkini ve bağlantını kontrol et."); }
    finally { setWorkingId(null); }
  };

  const cards = overview ? [
    ["Bekleyen", overview.open_reports, "flag-outline"],
    ["İncelenen", overview.reviewing_reports, "search-outline"],
    ["Aktif yaptırım", overview.active_sanctions, "ban-outline"],
    ["Filtre terimi", overview.blocked_terms, "text-outline"],
  ] : [];

  return <SheetFrame visible={visible} onDismiss={onDismiss} tall>
    <Text style={styles.kicker}>YÖNETİM PANELİ · {String(role || "moderator").toUpperCase()}</Text>
    <Text style={styles.title}>Güvenlik kuyruğu</Text>
    <View style={styles.statGrid}>{cards.map(([label, value, icon]) => <View key={label} style={styles.statCard}><Ionicons name={icon} size={17} color={COLORS.primary} /><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>)}</View>
    <View style={styles.adminHeading}><Text style={styles.sectionLabel}>SON BİLDİRİMLER</Text><Pressable onPress={load}><Ionicons name="refresh-outline" size={18} color={COLORS.primary} /></Pressable></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.adminList}>
      {role !== "moderator" && <><Text style={styles.sectionLabel}>BEKLEYEN IBAN TRANSFERLERİ</Text>{transferRequests.filter((request) => request.status === "awaiting_transfer").map((request) => <View key={request.id} style={styles.transferRequest}>
        <View style={styles.reportHeader}><Text style={styles.rowTitle}>{request.referenceCode}</Text><Text style={styles.transferAmount}>{Number(request.amountTry).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</Text></View>
        <Text style={styles.rowMeta}>{request.requesterName || "Bilinmeyen kullanıcı"} · @{request.requesterHandle || "sora"}</Text>
        <Text style={styles.transferMeta}>Talep: {request.requestedCredits} kredi · {new Date(request.createdAt).toLocaleString("tr-TR")}</Text>
        <TextInput value={creditAmounts[request.id] || ""} onChangeText={(value) => setCreditAmounts((current) => ({ ...current, [request.id]: value.replace(/[^0-9]/g, "") }))} keyboardType="number-pad" placeholder="Yüklenecek kredi" placeholderTextColor={COLORS.muted} style={styles.transferCreditInput} maxLength={7} />
        <View style={styles.adminActions}><Pressable disabled={workingId === request.id} onPress={() => reviewTransfer(request, true)} style={styles.transferApprove}><Text style={styles.transferApproveText}>Onayla ve yükle</Text></Pressable><Pressable disabled={workingId === request.id} onPress={() => reviewTransfer(request, false)} style={[styles.adminAction, styles.adminActionDanger]}><Text style={styles.adminActionDangerText}>Reddet</Text></Pressable></View>
      </View>)}{!transferRequests.some((request) => request.status === "awaiting_transfer") ? <View style={styles.empty}><Ionicons name="receipt-outline" size={24} color={COLORS.muted} /><Text style={styles.emptyText}>{loading ? "Yükleniyor..." : "Bekleyen IBAN transfer talebi yok."}</Text></View> : null}</>}
      <Text style={styles.sectionLabel}>GÜVENLİK BİLDİRİMLERİ</Text>
      {reports.map((report) => <View key={report.id} style={styles.adminReport}>
        <View style={styles.reportHeader}><Text style={styles.rowTitle}>{CATEGORY_LABELS[report.category] || report.category}</Text><Text style={styles.statusText}>{STATUS_LABELS[report.status] || report.status}</Text></View>
        <Text style={styles.rowMeta}>{report.reporterName} bildirdi · {report.targetName || report.roomTitle || "İçerik"}</Text>
        <Text style={styles.reportDetails}>{report.details || "Ayrıntı eklenmedi."}</Text>
        {report.status === "open" || report.status === "reviewing" ? <View style={styles.adminActions}>
          {report.status === "open" && <Pressable disabled={workingId === report.id} onPress={() => updateReport(report, "reviewing")} style={styles.adminAction}><Text style={styles.adminActionText}>İncele</Text></Pressable>}
          <Pressable disabled={workingId === report.id} onPress={() => updateReport(report, "dismissed")} style={styles.adminAction}><Text style={styles.adminActionText}>Kapat</Text></Pressable>
          {report.targetUserId && <Pressable disabled={workingId === report.id} onPress={() => updateReport(report, "actioned", "warning")} style={styles.adminAction}><Text style={styles.adminActionText}>Uyar</Text></Pressable>}
          {report.targetUserId && <Pressable disabled={workingId === report.id} onPress={() => updateReport(report, "actioned", "chat_mute", 24)} style={[styles.adminAction, styles.adminActionDanger]}><Text style={styles.adminActionDangerText}>24s sustur</Text></Pressable>}
          {report.targetUserId && role !== "moderator" && <Pressable disabled={workingId === report.id} onPress={() => updateReport(report, "actioned", "suspend", 168)} style={[styles.adminAction, styles.adminActionDanger]}><Text style={styles.adminActionDangerText}>7g askıya al</Text></Pressable>}
          {report.targetUserId && role === "owner" && <Pressable disabled={workingId === report.id} onPress={() => Alert.alert("Hesap yasaklansın mı?", `${report.targetName || "Bu hesap"} süresiz olarak yasaklanacak.`, [{ text: "Vazgeç", style: "cancel" }, { text: "Yasakla", style: "destructive", onPress: () => updateReport(report, "actioned", "ban") }])} style={[styles.adminAction, styles.adminActionDanger]}><Text style={styles.adminActionDangerText}>Yasakla</Text></Pressable>}
        </View> : null}
      </View>)}
      {!reports.length ? <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={25} color={COLORS.primary} /><Text style={styles.emptyText}>{loading ? "Yükleniyor..." : "İncelenecek bildirim yok."}</Text></View> : null}
    </ScrollView>
  </SheetFrame>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(5,6,11,0.72)", justifyContent: "flex-end" },
  dismissArea: { flex: 1 },
  sheet: { maxHeight: "82%", backgroundColor: COLORS.surface, paddingHorizontal: 22, paddingTop: 29, paddingBottom: 30, borderTopLeftRadius: 29, borderTopRightRadius: 29 },
  tallSheet: { height: "82%" },
  handle: { width: 38, height: 4, borderRadius: 4, backgroundColor: "#C2CEDD", position: "absolute", alignSelf: "center", top: 10 },
  closeButton: { width: 31, height: 31, borderRadius: 16, backgroundColor: COLORS.surfaceRaised, justifyContent: "center", alignItems: "center", position: "absolute", right: 17, top: 15, zIndex: 2 },
  kicker: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.3, marginBottom: 7 },
  title: { color: COLORS.text, fontSize: 25, fontWeight: "800", letterSpacing: -0.8, marginBottom: 9, paddingRight: 44 },
  description: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 17 },
  reasonScroll: { maxHeight: 180, marginBottom: 17 },
  reasonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reason: { width: "48%", minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.line },
  reasonActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  reasonText: { color: COLORS.text, fontSize: 11, fontWeight: "700", flex: 1 },
  reasonTextActive: { color: COLORS.primaryInk },
  label: { color: COLORS.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  detailsInput: { minHeight: 88, borderRadius: 13, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.line, color: COLORS.text, padding: 12, fontSize: 13, textAlignVertical: "top" },
  counter: { color: COLORS.muted, fontSize: 9, textAlign: "right", marginTop: 5, marginBottom: 12 },
  primaryButton: { minHeight: 51, borderRadius: 14, backgroundColor: COLORS.primary, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryButtonText: { color: COLORS.primaryInk, fontSize: 13, fontWeight: "800" },
  disabledButton: { opacity: 0.55 },
  notice: { padding: 14, marginTop: 8, marginBottom: 18, borderRadius: 16, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(47,128,237,0.12)", borderWidth: 1, borderColor: "rgba(47,128,237,0.30)" },
  noticeText: { color: COLORS.textSecondary, flex: 1, fontSize: 11, lineHeight: 16 },
  scrollContent: { paddingBottom: 18 },
  sectionLabel: { color: COLORS.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.15, marginTop: 8, marginBottom: 9 },
  userRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  avatar: { width: 40, height: 40, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "900" },
  rowCopy: { flex: 1 },
  rowTitle: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  rowMeta: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  outlineButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.line },
  outlineButtonText: { color: COLORS.primary, fontSize: 10, fontWeight: "800" },
  empty: { minHeight: 82, borderRadius: 14, backgroundColor: COLORS.surfaceRaised, alignItems: "center", justifyContent: "center", gap: 8, padding: 14 },
  emptyText: { color: COLORS.muted, fontSize: 11, textAlign: "center" },
  reportRow: { padding: 13, borderRadius: 14, backgroundColor: COLORS.surfaceRaised, marginBottom: 8 },
  reportHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  reportDetails: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 8 },
  statusPill: { backgroundColor: COLORS.surfaceHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusDone: { backgroundColor: "rgba(47,128,237,0.16)" },
  statusText: { color: COLORS.muted, fontSize: 9, fontWeight: "800" },
  errorBox: { padding: 12, borderRadius: 13, backgroundColor: "rgba(217,79,92,0.10)", marginBottom: 10 },
  errorText: { color: COLORS.danger, fontSize: 11, lineHeight: 16 },
  retryText: { color: COLORS.primary, fontSize: 11, fontWeight: "800", marginTop: 7 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 16 },
  statCard: { width: "48%", minHeight: 76, borderRadius: 15, padding: 12, backgroundColor: COLORS.surfaceRaised },
  statValue: { color: COLORS.text, fontSize: 19, fontWeight: "900", marginTop: 5 },
  statLabel: { color: COLORS.muted, fontSize: 9, marginTop: 2 },
  adminHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  adminList: { paddingBottom: 20 },
  adminReport: { padding: 14, borderRadius: 15, backgroundColor: COLORS.surfaceRaised, marginBottom: 9, borderWidth: 1, borderColor: COLORS.line },
  adminActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  adminAction: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.surfaceHigh },
  adminActionText: { color: COLORS.text, fontSize: 10, fontWeight: "800" },
  adminActionDanger: { backgroundColor: "rgba(217,79,92,0.12)" },
  adminActionDangerText: { color: COLORS.danger, fontSize: 10, fontWeight: "800" },
  transferRequest: { padding: 14, borderRadius: 15, backgroundColor: COLORS.surfaceRaised, marginBottom: 9, borderWidth: 1, borderColor: COLORS.line },
  transferAmount: { color: "#1D5FBF", fontSize: 12, fontWeight: "900" },
  transferMeta: { color: COLORS.textSecondary, fontSize: 10, marginTop: 7 },
  transferCreditInput: { height: 40, borderRadius: 10, marginTop: 11, paddingHorizontal: 11, color: COLORS.text, backgroundColor: COLORS.surfaceHigh, borderWidth: 1, borderColor: COLORS.line, fontSize: 12, fontWeight: "800" },
  transferApprove: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.primary },
  transferApproveText: { color: COLORS.primaryInk, fontSize: 10, fontWeight: "900" },
});
