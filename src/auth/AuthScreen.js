import { useState } from "react";
import { Alert, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardSafeView } from "../ui/useKeyboardInset";
import { SoraMark } from "../ui/SoraMark";
import {
  AUTH_CALLBACK_URL,
  isHandleAvailable,
  requestPasswordReset,
  startOAuthSignIn,
  supabase,
} from "./supabase";
import {
  CHILD_SAFETY_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
  openLegalUrl,
} from "../security/legalLinks";
import { COLORS } from "../theme/colors";

const BRAND = COLORS.primary;

const cleanHandle = (value) => value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

const describeAuthError = (error, fallback) => {
  const message = String(error?.message || "");
  const normalizedMessage = message.toLocaleLowerCase("en-US");
  if (
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("network request failed") ||
    normalizedMessage.includes("unknownhostexception") ||
    normalizedMessage.includes("unable to resolve host")
  ) {
    return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
  }
  return message || fallback;
};

export function AuthScreen() {
  const [focusedField, setFocusedField] = useState(null);
  const focus = (name) => () => setFocusedField(name);
  const blur = () => setFocusedField(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ensureAcceptedPolicies = () => {
    if (acceptedPolicies) return true;
    Alert.alert(
      "Koşulları onayla",
      "Kayıt olmadan önce 13 yaş ve üzeri olduğunu ve Kullanım Koşulları, Gizlilik Politikası ile Çocuk Güvenliği kurallarını kabul ettiğini onayla.",
    );
    return false;
  };

  const validateProfile = async () => {
    const normalizedHandle = cleanHandle(handle);
    if (!displayName.trim() || normalizedHandle.length < 3) {
      Alert.alert("Profilini tamamla", "Adını ve en az 3 karakterlik kullanıcı adını yaz.");
      return null;
    }
    if (!await isHandleAvailable(normalizedHandle)) {
      Alert.alert("Kullanıcı adı alınmış", "Başka bir kullanıcı adı dene.");
      return null;
    }
    return { displayName: displayName.trim(), handle: normalizedHandle };
  };

  const submitEmail = async () => {
    if (isRegistering && !ensureAcceptedPolicies()) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || password.length < 6) {
      Alert.alert("Bilgilerini kontrol et", "Geçerli e-posta ve en az 6 karakterlik parola gerekli.");
      return;
    }
    setSubmitting(true);
    try {
      if (!supabase) throw new Error("Supabase yapılandırılmadı.");
      const profile = isRegistering ? await validateProfile() : null;
      if (isRegistering && !profile) return;
      const result = isRegistering
        ? await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              ...(Platform.OS === "web" ? {} : { emailRedirectTo: AUTH_CALLBACK_URL }),
              data: { display_name: profile.displayName, handle: profile.handle },
            },
          })
        : await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (result.error) throw result.error;
      if (isRegistering && !result.data.session) {
        Alert.alert("E-postanı doğrula", "Hesabını açmak için e-postandaki doğrulama bağlantısına dokun.");
      }
    } catch (error) {
      Alert.alert("Giriş yapılamadı", describeAuthError(error, "Bağlantını kontrol edip tekrar dene."));
    } finally {
      setSubmitting(false);
    }
  };

  const startGoogleAuth = async () => {
    if (isRegistering && !ensureAcceptedPolicies()) return;
    setSubmitting(true);
    try {
      await startOAuthSignIn("google");
    } catch (error) {
      Alert.alert("Google girişi başlatılamadı", describeAuthError(error, "Bağlantını kontrol edip tekrar dene."));
    } finally {
      setSubmitting(false);
    }
  };

  const sendResetEmail = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      Alert.alert("E-posta gerekli", "Parola sıfırlama bağlantısı için e-posta adresini yaz.");
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(cleanEmail);
      Alert.alert("Bağlantı gönderildi", "Bu hesap varsa parola sıfırlama bağlantısı e-postana gönderildi.");
    } catch (error) {
      Alert.alert("İstek gönderilemedi", describeAuthError(error, "Daha sonra tekrar dene."));
    } finally {
      setSubmitting(false);
    }
  };

  const profileFields = (
    <>
      <Text style={styles.label}>Görünen ad</Text>
      <View style={[styles.inputRow, focusedField === "name" && styles.inputRowFocused]}>
        <Ionicons
          name="person-outline"
          size={17}
          color={focusedField === "name" ? BRAND : "#8093AC"}
        />
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          placeholder="Adın"
          placeholderTextColor="#94A3B8"
          selectionColor={BRAND}
          style={styles.inputInner}
          maxLength={36}
          onFocus={focus("name")}
          onBlur={blur}
        />
      </View>
      <Text style={styles.label}>Kullanıcı adı</Text>
      <View style={[styles.inputRow, focusedField === "handle" && styles.inputRowFocused]}>
        <Text style={styles.handlePrefix}>@</Text>
        <TextInput
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="kullaniciadi"
          placeholderTextColor="#94A3B8"
          selectionColor={BRAND}
          onFocus={focus("handle")}
          onBlur={blur}
          style={styles.inputInner}
          maxLength={24}
        />
      </View>
    </>
  );

  const consentBox = (
    <View style={[styles.consentBox, acceptedPolicies && styles.consentBoxActive]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedPolicies }}
        accessibilityLabel="Kullanım koşullarını ve gizlilik politikasını onayla"
        onPress={() => setAcceptedPolicies((current) => !current)}
        hitSlop={10}
        style={[styles.checkbox, acceptedPolicies && styles.checkboxActive]}
      >
        {acceptedPolicies ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      </Pressable>
      <Text style={styles.consentText}>
        <Text onPress={() => setAcceptedPolicies((current) => !current)}>13 yaş ve üzerindeyim; </Text>
        <Text style={styles.legalLink} onPress={() => openLegalUrl(TERMS_OF_USE_URL)}>
          Kullanım Koşulları (UGC)
        </Text>
        <Text onPress={() => setAcceptedPolicies((current) => !current)}>, </Text>
        <Text style={styles.legalLink} onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}>
          Gizlilik Politikası
        </Text>
        <Text onPress={() => setAcceptedPolicies((current) => !current)}> ve </Text>
        <Text style={styles.legalLink} onPress={() => openLegalUrl(CHILD_SAFETY_URL)}>
          Çocuk Güvenliği Standartları
        </Text>
        <Text onPress={() => setAcceptedPolicies((current) => !current)}> kurallarını kabul ediyorum.</Text>
      </Text>
    </View>
  );

  const subtitle = isRegistering
    ? "Google veya e-posta adresinle kaydol, topluluğunu bul ve odalara katıl."
    : "Odaların, takiplerin ve profilin seni bekliyor.";

  return (
    <LinearGradient colors={["#E7F1FE", "#F3F7FC", "#F3F7FC"]} locations={[0, 0.36, 1]} style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <KeyboardSafeView style={styles.safe}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <LinearGradient
                colors={["#0D1B34", "#1E40AF", "#3B82F6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logoSquircle}
              >
                <SoraMark size={46} tone="dark" />
              </LinearGradient>
              <Text style={styles.title}>{isRegistering ? "Sesinle yerini al." : "Sohbete geri dön."}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.modeTabs}>
                <Pressable
                  disabled={submitting}
                  onPress={() => setIsRegistering(false)}
                  style={[styles.modeTab, !isRegistering && styles.modeTabActive]}
                >
                  <Text style={[styles.modeTabText, !isRegistering && styles.modeTabTextActive]}>Giriş yap</Text>
                </Pressable>
                <Pressable
                  disabled={submitting}
                  onPress={() => setIsRegistering(true)}
                  style={[styles.modeTab, isRegistering && styles.modeTabActive]}
                >
                  <Text style={[styles.modeTabText, isRegistering && styles.modeTabTextActive]}>Kayıt ol</Text>
                </Pressable>
              </View>

              {isRegistering ? consentBox : null}

              <Pressable
                disabled={submitting}
                onPress={startGoogleAuth}
                style={({ pressed }) => [
                  styles.googleButton,
                  submitting && styles.disabled,
                  pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Ionicons name="logo-google" size={18} color="#2563EB" />
                <Text style={styles.googleButtonText}>
                  {isRegistering ? "Google ile kaydol" : "Google ile devam et"}
                </Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.or}>
                  {isRegistering ? "veya e-posta ile kaydol" : "veya e-posta ile"}
                </Text>
                <View style={styles.dividerLine} />
              </View>

              {isRegistering ? profileFields : null}

              <Text style={styles.label}>E-posta</Text>
              <View style={[styles.inputRow, focusedField === "email" && styles.inputRowFocused]}>
                <Ionicons
                  name="mail-outline"
                  size={17}
                  color={focusedField === "email" ? BRAND : "#8093AC"}
                />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="ornek@mail.com"
                  placeholderTextColor="#94A3B8"
                  selectionColor={BRAND}
                  style={styles.inputInner}
                  onFocus={focus("email")}
                  onBlur={blur}
                />
              </View>

              <Text style={styles.label}>Parola</Text>
              <View style={[styles.inputRow, focusedField === "password" && styles.inputRowFocused]}>
                <Ionicons
                  name="lock-closed-outline"
                  size={17}
                  color={focusedField === "password" ? BRAND : "#8093AC"}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="En az 6 karakter"
                  placeholderTextColor="#94A3B8"
                  selectionColor={BRAND}
                  style={styles.inputInner}
                  onFocus={focus("password")}
                  onBlur={blur}
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color="#8093AC"
                  />
                </Pressable>
              </View>

              <Pressable
                disabled={submitting}
                onPress={submitEmail}
                style={({ pressed }) => [pressed && !submitting && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
              >
                <LinearGradient colors={["#4797FF", "#2563EB"]} style={[styles.submit, submitting && styles.disabled]}>
                  <Text style={styles.submitText}>
                    {submitting ? "İşleniyor…" : isRegistering ? "E-posta ile kaydol" : "Giriş yap"}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </LinearGradient>
              </Pressable>

              {!isRegistering ? (
                <Pressable disabled={submitting} onPress={sendResetEmail} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Parolamı unuttum</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setIsRegistering((current) => !current)}
                style={styles.toggle}
                hitSlop={{ top: 14, bottom: 14, left: 24, right: 24 }}
              >
                <Text style={styles.toggleMuted}>{isRegistering ? "Zaten hesabın var mı?" : "Sora'da yeni misin?"}</Text>
                <Text style={styles.toggleLink}>{isRegistering ? " Giriş yap" : " Kayıt ol"}</Text>
              </Pressable>
            </View>

            <View style={styles.providerHint}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#2563EB" />
              <Text style={styles.providerHintText}>Güvenli oturumla cihazında saklanır</Text>
            </View>

            <View style={styles.legalFooter}>
              <Text style={styles.legalFooterText}>
                Devam ederek{" "}
                <Text style={styles.legalLink} onPress={() => openLegalUrl(TERMS_OF_USE_URL)}>
                  Kullanım Koşulları
                </Text>
                {", "}
                <Text style={styles.legalLink} onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}>
                  Gizlilik Politikası
                </Text>
                {" ve "}
                <Text style={styles.legalLink} onPress={() => openLegalUrl(CHILD_SAFETY_URL)}>
                  Çocuk Güvenliği
                </Text>
                {" kurallarını kabul etmiş olursun."}
              </Text>
            </View>
          </ScrollView>
        </KeyboardSafeView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const CARD_SHADOW = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.07,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 4,
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  hero: { alignItems: "center", marginBottom: 20 },
  logoSquircle: {
    width: 68,
    height: 68,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#1D4ED8",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: {
    color: "#0F172A",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.7,
    textAlign: "center",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 6,
    maxWidth: 300,
  },
  card: {
    borderRadius: 26,
    padding: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5EEF8",
    ...CARD_SHADOW,
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: "#EEF3F9",
    borderRadius: 14,
    padding: 4,
    marginBottom: 15,
  },
  modeTab: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeTabText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
  },
  modeTabTextActive: {
    color: "#0F172A",
    fontWeight: "700",
  },
  consentBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F3F7FC",
    borderWidth: 1,
    borderColor: "#E2EBF5",
    marginBottom: 14,
  },
  consentBoxActive: {
    borderColor: "rgba(37,99,235,0.4)",
    backgroundColor: "#EAF3FD",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#94A3B8",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  consentText: {
    flex: 1,
    color: "#475569",
    fontSize: 11.5,
    lineHeight: 17,
  },
  legalLink: {
    color: "#2563EB",
    fontWeight: "700",
  },
  googleButton: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE7F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleButtonText: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "700",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E9F0F8",
  },
  or: {
    color: "#94A3B8",
    fontSize: 11.5,
    fontWeight: "600",
  },
  label: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    marginTop: 2,
  },
  inputRow: {
    height: 48,
    marginBottom: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#F1F6FC",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  inputRowFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#3B82F6",
  },
  inputInner: {
    flex: 1,
    color: "#0F172A",
    fontSize: 14,
    paddingVertical: 0,
  },
  handlePrefix: {
    color: "#2563EB",
    fontSize: 15,
    fontWeight: "800",
  },
  submit: {
    height: 50,
    marginTop: 6,
    borderRadius: 15,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#2563EB",
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  disabled: { opacity: 0.55, shadowOpacity: 0 },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  toggle: { flexDirection: "row", justifyContent: "center", marginTop: 12 },
  toggleMuted: { color: "#64748B", fontSize: 12.5 },
  toggleLink: { color: "#2563EB", fontSize: 12.5, fontWeight: "700" },
  textButton: { alignSelf: "center", paddingTop: 12, paddingBottom: 4 },
  textButtonLabel: { color: "#2563EB", fontSize: 12.5, fontWeight: "700" },
  legalFooter: {
    marginTop: 10,
    paddingHorizontal: 10,
  },
  legalFooterText: {
    color: "#7C8FA6",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  providerHint: {
    marginTop: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  providerHintText: {
    color: "#64748B",
    fontSize: 11.5,
    fontWeight: "600",
    textAlign: "center",
  },
});
