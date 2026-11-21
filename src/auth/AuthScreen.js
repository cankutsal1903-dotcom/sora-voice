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

/** Odaklandiginda kenarligi marka rengine donen metin alani. */
function Field({ focused, style, ...props }) {
  return (
    <TextInput
      placeholderTextColor="#8190A2"
      selectionColor={BRAND}
      style={[style, focused && styles.inputFocused]}
      {...props}
    />
  );
}

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
      <Text style={styles.label}>GÖRÜNEN AD</Text>
      <Field
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        placeholder="Adın"
        style={styles.input}
        maxLength={36}
        focused={focusedField === "name"}
        onFocus={focus("name")}
        onBlur={blur}
      />
      <Text style={styles.label}>KULLANICI ADI</Text>
      <View style={[styles.handleInput, focusedField === "handle" && styles.handleInputFocused]}>
        <Text style={styles.handlePrefix}>@</Text>
        <TextInput
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="kullaniciadi"
          placeholderTextColor="#8190A2"
          selectionColor={BRAND}
          onFocus={focus("handle")}
          onBlur={blur}
          style={styles.handleText}
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
    <LinearGradient colors={["#F3F7FC", "#F3F7FC", "#EAF3FD"]} style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <KeyboardSafeView style={styles.safe}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.logo}><SoraMark size={96} tone="light" /></View>
              <Text style={styles.kicker}>SORA HESABI</Text>
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
                  pressed && { opacity: 0.9 },
                ]}
              >
                <View style={styles.googleBadge}>
                  <Ionicons name="logo-google" size={17} color={BRAND} />
                </View>
                <Text style={styles.googleButtonText}>
                  {isRegistering ? "Google ile kaydol" : "Google ile giriş yap"}
                </Text>
                <Ionicons name="chevron-forward" size={17} color="#46596F" />
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.or}>
                  {isRegistering ? "veya e-posta ile kaydol" : "veya e-posta ile giriş yap"}
                </Text>
                <View style={styles.dividerLine} />
              </View>

              {isRegistering ? profileFields : null}

              <Text style={styles.label}>E-POSTA</Text>
              <Field
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="ornek@mail.com"
                style={styles.input}
                focused={focusedField === "email"}
                onFocus={focus("email")}
                onBlur={blur}
              />

              <Text style={styles.label}>PAROLA</Text>
              <Field
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="En az 6 karakter"
                style={styles.input}
                focused={focusedField === "password"}
                onFocus={focus("password")}
                onBlur={blur}
              />

              <Pressable disabled={submitting} onPress={submitEmail}>
                <LinearGradient colors={[BRAND, "#1D5FBF"]} style={[styles.submit, submitting && styles.disabled]}>
                  <Text style={styles.submitText}>
                    {submitting ? "İşleniyor" : isRegistering ? "E-posta ile kaydol" : "Giriş yap"}
                  </Text>
                  <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
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

            <View style={styles.providerHint}>
              <Ionicons name="shield-checkmark-outline" size={16} color={BRAND} />
              <Text style={styles.providerHintText}>Hesabın güvenli oturumla cihazında saklanır.</Text>
            </View>
          </ScrollView>
        </KeyboardSafeView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const CARD_SHADOW = {
  shadowColor: "#102033",
  shadowOpacity: 0.12,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 4,
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  hero: { alignItems: "center", marginBottom: 22 },
  logo: {
    width: 96,
    height: 96,
    marginBottom: 14,
  },
  kicker: {
    color: BRAND,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: "#111820",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.1,
    marginTop: 8,
    textAlign: "center",
  },
  subtitle: {
    color: "#46596F",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 310,
  },
  card: {
    borderRadius: 26,
    padding: 19,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E3EF",
    ...CARD_SHADOW,
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: "#EDF3FA",
    borderRadius: 14,
    padding: 4,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#D9E3EF",
  },
  modeTab: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#102033",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeTabText: {
    color: "#46596F",
    fontSize: 13,
    fontWeight: "800",
  },
  modeTabTextActive: {
    color: BRAND,
    fontWeight: "900",
  },
  consentBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F3F7FC",
    borderWidth: 1,
    borderColor: "#D9E3EF",
    marginBottom: 14,
  },
  consentBoxActive: {
    borderColor: "rgba(47,128,237,0.45)",
    backgroundColor: "#EAF3FD",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#8190A2",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  consentText: {
    flex: 1,
    color: "#46596F",
    fontSize: 11.5,
    lineHeight: 17,
  },
  legalLink: {
    color: BRAND,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  googleButton: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: "#F4F8FD",
    borderWidth: 1,
    borderColor: "rgba(47,128,237,0.32)",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  googleBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E3EF",
    alignItems: "center",
    justifyContent: "center",
  },
  googleButtonText: {
    flex: 1,
    color: "#111820",
    fontSize: 14,
    fontWeight: "900",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 15,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E1E9F3",
  },
  or: {
    color: "#8190A2",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  label: {
    color: "#46596F",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 7,
    marginTop: 4,
  },
  input: {
    height: 52,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: 15,
    color: "#111820",
    backgroundColor: "#EDF3FA",
    borderWidth: 1,
    borderColor: "#D9E3EF",
    fontSize: 15,
  },
  inputFocused: {
    borderColor: "rgba(47,128,237,0.55)",
    backgroundColor: "#E4ECF6",
  },
  handleInput: {
    height: 52,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EDF3FA",
    borderWidth: 1,
    borderColor: "#D9E3EF",
  },
  handleInputFocused: { borderColor: "rgba(47,128,237,0.55)" },
  handlePrefix: {
    color: BRAND,
    fontSize: 16,
    fontWeight: "900",
    marginRight: 4,
  },
  handleText: { flex: 1, color: "#111820", fontSize: 15 },
  submit: {
    height: 54,
    marginTop: 4,
    borderRadius: 16,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: BRAND,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  disabled: { opacity: 0.55, shadowOpacity: 0 },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  toggle: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  toggleMuted: { color: "#46596F", fontSize: 12.5 },
  toggleLink: { color: BRAND, fontSize: 12.5, fontWeight: "900" },
  textButton: { alignSelf: "center", paddingVertical: 11 },
  textButtonLabel: { color: BRAND, fontSize: 12.5, fontWeight: "800" },
  legalFooter: {
    marginTop: 15,
    paddingHorizontal: 8,
  },
  legalFooterText: {
    color: "#5D6F84",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  providerHint: {
    marginTop: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  providerHintText: {
    color: "#8190A2",
    fontSize: 10.5,
    textAlign: "center",
    flexShrink: 1,
  },
});
