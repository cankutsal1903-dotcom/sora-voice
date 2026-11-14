import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function PasswordResetSheet({ visible, onDismiss, onUpdatePassword }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) {
      setPassword("");
      setConfirmation("");
      setError("");
      setSubmitting(false);
    }
  }, [visible]);

  const submit = async () => {
    if (password.length < 6) {
      setError("Parola en az 6 karakter olmalı.");
      return;
    }
    if (password !== confirmation) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onUpdatePassword(password);
    } catch (nextError) {
      setError(nextError?.message || "Parola güncellenemedi.");
      setSubmitting(false);
    }
  };

  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}><View style={styles.overlay}><Pressable style={styles.dismiss} onPress={onDismiss} /><View style={styles.sheet}><View style={styles.handle} /><View style={styles.icon}><Ionicons name="key-outline" size={24} color="#111820" /></View><Text style={styles.kicker}>GÜVENLİK DOĞRULAMASI</Text><Text style={styles.title}>Yeni parolanı belirle.</Text><Text style={styles.subtitle}>Bu bağlantı ile hesabının parolasını güvenle yenileyebilirsin.</Text><Text style={styles.label}>YENİ PAROLA</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="En az 6 karakter" placeholderTextColor="#8190A2" style={styles.input} /><Text style={styles.label}>YENİ PAROLA TEKRAR</Text><TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry placeholder="Parolanı tekrar yaz" placeholderTextColor="#8190A2" style={styles.input} />{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable disabled={submitting} onPress={submit} style={[styles.submit, submitting && styles.disabled]}><Text style={styles.submitText}>{submitting ? "Kaydediliyor" : "Parolayı güncelle"}</Text><Ionicons name="checkmark" size={20} color="#111820" /></Pressable></View></View></Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(5,6,11,0.68)", justifyContent: "flex-end" }, dismiss: { flex: 1 }, sheet: { backgroundColor: "#FFFFFF", paddingHorizontal: 22, paddingTop: 28, paddingBottom: 29, borderTopLeftRadius: 29, borderTopRightRadius: 29 }, handle: { width: 38, height: 4, borderRadius: 4, backgroundColor: "#C2CEDD", position: "absolute", alignSelf: "center", top: 10 }, icon: { width: 47, height: 47, borderRadius: 16, justifyContent: "center", alignItems: "center", backgroundColor: "#2F80ED", marginBottom: 16 }, kicker: { color: "#2F80ED", fontSize: 10, fontWeight: "900", letterSpacing: 1.3, marginBottom: 7 }, title: { color: "#111820", fontSize: 23, fontWeight: "900", letterSpacing: -0.7 }, subtitle: { color: "#46596F", fontSize: 12, lineHeight: 17, marginTop: 7, marginBottom: 20 }, label: { color: "#46596F", fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 8 }, input: { height: 48, borderRadius: 12, backgroundColor: "#EDF3FA", borderWidth: 1, borderColor: "#D9E3EF", color: "#111820", paddingHorizontal: 13, fontSize: 14, marginBottom: 15 }, error: { color: "#E5486B", fontSize: 11, marginTop: -6, marginBottom: 12 }, submit: { height: 52, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, backgroundColor: "#2F80ED" }, submitText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" }, disabled: { opacity: 0.55 },
});
