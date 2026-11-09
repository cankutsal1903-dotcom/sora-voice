import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const COLORS = {
  text: "#F7F7FB",
  muted: "#9699AC",
  primary: "#B5FF78",
  surface: "#202230",
  surfaceRaised: "#292B3A",
  line: "#3B3E4F",
  danger: "#FF7BA7",
};

export function AccountSecuritySheet({ visible, email, onDismiss, onResetPassword, onSignOut, onDeleteAccount }) {
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setConfirmingDeletion(false);
      setConfirmation("");
      setSubmitting(false);
    }
  }, [visible]);

  const run = async (action) => {
    setSubmitting(true);
    try {
      await action();
    } catch {
      return undefined;
    } finally {
      setSubmitting(false);
    }
  };

  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}><View style={styles.overlay}><Pressable style={styles.dismiss} onPress={onDismiss} /><View style={styles.sheet}><View style={styles.handle} /><Pressable onPress={onDismiss} style={styles.close}><Ionicons name="close" size={20} color={COLORS.text} /></Pressable><Text style={styles.kicker}>HESAP VE GÜVENLİK</Text><Text style={styles.title}>Hesabın senin kontrolünde.</Text><View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} /><Text style={styles.noticeText}>{email ? `${email} hesabıyla giriş yaptın.` : "Bu hesabın için güvenlik işlemlerini buradan yönetebilirsin."}</Text></View>{email ? <Pressable disabled={submitting} onPress={() => run(onResetPassword)} style={styles.action}><View style={styles.icon}><Ionicons name="key-outline" size={19} color={COLORS.primary} /></View><View style={styles.content}><Text style={styles.actionTitle}>Parolamı sıfırla</Text><Text style={styles.description}>E-postana güvenli bir sıfırlama bağlantısı gönder.</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.muted} /></Pressable> : null}<Pressable disabled={submitting} onPress={() => run(onSignOut)} style={styles.action}><View style={styles.icon}><Ionicons name="log-out-outline" size={19} color={COLORS.primary} /></View><View style={styles.content}><Text style={styles.actionTitle}>Çıkış yap</Text><Text style={styles.description}>Bu cihazdaki güvenli oturumunu kapat.</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.muted} /></Pressable><View style={styles.dangerSection}><Text style={styles.dangerCaption}>TEHLİKELİ İŞLEMLER</Text>{confirmingDeletion ? <><Text style={styles.confirmText}>Tüm oda, mesaj, takip ve cüzdan verilerini kalıcı olarak silmek için <Text style={styles.confirmWord}>SİL</Text> yaz.</Text><TextInput value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" placeholder="SİL" placeholderTextColor={COLORS.muted} style={styles.input} maxLength={3} /><Pressable disabled={submitting || confirmation !== "SİL"} onPress={() => run(onDeleteAccount)} style={[styles.deleteButton, (submitting || confirmation !== "SİL") && styles.disabled]}><Text style={styles.deleteButtonText}>{submitting ? "Siliniyor" : "Hesabımı kalıcı olarak sil"}</Text></Pressable><Pressable disabled={submitting} onPress={() => { setConfirmingDeletion(false); setConfirmation(""); }} style={styles.cancel}><Text style={styles.cancelText}>Vazgeç</Text></Pressable></> : <Pressable disabled={submitting} onPress={() => setConfirmingDeletion(true)} style={styles.deleteAction}><View style={styles.deleteIcon}><Ionicons name="trash-outline" size={19} color={COLORS.danger} /></View><View style={styles.content}><Text style={styles.deleteTitle}>Hesabımı sil</Text><Text style={styles.description}>Bu işlem geri alınamaz; buluttaki verilerin de silinir.</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.danger} /></Pressable>}</View></View></View></Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(5,6,11,0.68)", justifyContent: "flex-end" }, dismiss: { flex: 1 }, sheet: { backgroundColor: COLORS.surface, paddingHorizontal: 22, paddingTop: 29, paddingBottom: 28, borderTopLeftRadius: 29, borderTopRightRadius: 29 }, handle: { width: 38, height: 4, borderRadius: 4, backgroundColor: "#5A5D6F", position: "absolute", alignSelf: "center", top: 10 }, close: { width: 31, height: 31, borderRadius: 15, backgroundColor: COLORS.surfaceRaised, justifyContent: "center", alignItems: "center", position: "absolute", right: 17, top: 15 }, kicker: { color: COLORS.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.3, marginBottom: 7 }, title: { color: COLORS.text, fontSize: 23, fontWeight: "900", letterSpacing: -0.7, marginBottom: 18 }, notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 15, backgroundColor: "#232B28", marginBottom: 15 }, noticeText: { flex: 1, color: "#C7CCD3", fontSize: 12, lineHeight: 17 }, action: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: "#353746" }, icon: { width: 36, height: 36, borderRadius: 11, justifyContent: "center", alignItems: "center", backgroundColor: "#2B352C" }, content: { flex: 1 }, actionTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800", marginBottom: 3 }, description: { color: COLORS.muted, fontSize: 10, lineHeight: 14 }, dangerSection: { marginTop: 19 }, dangerCaption: { color: COLORS.danger, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 8 }, deleteAction: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 15, paddingHorizontal: 10, backgroundColor: "#30252E" }, deleteIcon: { width: 36, height: 36, borderRadius: 11, justifyContent: "center", alignItems: "center", backgroundColor: "#452D3A" }, deleteTitle: { color: COLORS.danger, fontSize: 13, fontWeight: "800", marginBottom: 3 }, confirmText: { color: "#C7CCD3", fontSize: 12, lineHeight: 18, marginBottom: 11 }, confirmWord: { color: COLORS.danger, fontWeight: "900" }, input: { height: 46, borderRadius: 12, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.line, color: COLORS.text, paddingHorizontal: 13, fontSize: 14, marginBottom: 10 }, deleteButton: { height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#E2608A" }, deleteButtonText: { color: "#25131B", fontSize: 13, fontWeight: "900" }, cancel: { alignSelf: "center", paddingTop: 13 }, cancelText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" }, disabled: { opacity: 0.55 },
});
