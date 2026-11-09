import { useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  isHandleAvailable,
  normalizePhoneNumber,
  requestPasswordReset,
  startOAuthSignIn,
  startPhoneSignIn,
  supabase,
  verifyPhoneSignIn,
} from "./supabase";

const SORA_LOGO = require("../../assets/images/sora-logo.png");
const BRAND = "#B5FF78";

const cleanHandle = (value) => value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

function ProviderButton({ icon, label, onPress, disabled }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.providerButton, disabled && styles.disabled]}><Ionicons name={icon} size={18} color="#F5F6FA" /><Text style={styles.providerButtonText}>{label}</Text></Pressable>;
}

/** Odaklandiginda kenarligi marka rengine donen metin alani. */
function Field({ focused, style, ...props }) {
  return (
    <TextInput
      placeholderTextColor="#7C8296"
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
  const [screen, setScreen] = useState("email");
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneRegistration, setPhoneRegistration] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || password.length < 6) {
      Alert.alert("Bilgilerini kontrol et", "Geçerli e-posta ve en az 6 karakterlik parola gerekli.");
      return;
    }
    setSubmitting(true);
    try {
      const profile = isRegistering ? await validateProfile() : null;
      if (isRegistering && !profile) return;
      const result = isRegistering
        ? await supabase.auth.signUp({ email: cleanEmail, password, options: { data: { display_name: profile.displayName, handle: profile.handle } } })
        : await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (result.error) throw result.error;
      if (isRegistering && !result.data.session) {
        Alert.alert("E-postanı doğrula", "Hesabını açmak için e-postandaki doğrulama bağlantısına dokun.");
      }
    } catch (error) {
      Alert.alert("Giriş yapılamadı", error?.message || "Bağlantını kontrol edip tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitPhone = async () => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      Alert.alert("Telefon numarası geçersiz", "Numaranı ülke koduyla birlikte yaz. Örnek: 532 123 45 67");
      return;
    }
    setSubmitting(true);
    try {
      const profile = phoneRegistration ? await validateProfile() : null;
      if (phoneRegistration && !profile) return;
      await startPhoneSignIn({ phone: normalizedPhone, profile });
      setPhone(normalizedPhone);
      setScreen("otp");
      Alert.alert("Kod gönderildi", "SMS ile gelen 6 haneli kodu gir.");
    } catch (error) {
      Alert.alert("Kod gönderilemedi", error?.message || "Telefon giriş ayarlarını kontrol et.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async () => {
    if (!/^\d{6}$/.test(otp.trim())) {
      Alert.alert("Kodu kontrol et", "SMS ile gelen 6 haneli kodu yaz.");
      return;
    }
    setSubmitting(true);
    try {
      await verifyPhoneSignIn({ phone, token: otp.trim() });
    } catch (error) {
      Alert.alert("Kod doğrulanamadı", error?.message || "Kodu kontrol edip tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  };

  const startProvider = async (provider) => {
    setSubmitting(true);
    try {
      await startOAuthSignIn(provider);
    } catch (error) {
      Alert.alert("Giriş başlatılamadı", error?.message || "Sağlayıcı ayarlarını kontrol et.");
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
      Alert.alert("İstek gönderilemedi", error?.message || "Daha sonra tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  };

  const profileFields = <><Text style={styles.label}>GÖRÜNEN AD</Text><Field value={displayName} onChangeText={setDisplayName} autoCapitalize="words" placeholder="Adın" style={styles.input} maxLength={36} focused={focusedField === "name"} onFocus={focus("name")} onBlur={blur} /><Text style={styles.label}>KULLANICI ADI</Text><View style={[styles.handleInput, focusedField === "handle" && styles.handleInputFocused]}><Text style={styles.handlePrefix}>@</Text><TextInput value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} placeholder="kullaniciadi" placeholderTextColor="#7C8296" selectionColor={BRAND} onFocus={focus("handle")} onBlur={blur} style={styles.handleText} maxLength={24} /></View></>;

  const emailCard = <><View style={styles.card}>{isRegistering ? profileFields : null}<Text style={styles.label}>E-POSTA</Text><Field value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="ornek@mail.com" style={styles.input} focused={focusedField === "email"} onFocus={focus("email")} onBlur={blur} /><Text style={styles.label}>PAROLA</Text><Field value={password} onChangeText={setPassword} secureTextEntry placeholder="En az 6 karakter" style={styles.input} focused={focusedField === "password"} onFocus={focus("password")} onBlur={blur} /><Pressable disabled={submitting} onPress={submitEmail}><LinearGradient colors={[BRAND, "#7BEF5A"]} style={[styles.submit, submitting && styles.disabled]}><Text style={styles.submitText}>{submitting ? "İşleniyor" : isRegistering ? "Hesabımı oluştur" : "Giriş yap"}</Text><Ionicons name="arrow-forward" size={19} color="#0A160A" /></LinearGradient></Pressable>{!isRegistering ? <Pressable disabled={submitting} onPress={sendResetEmail} style={styles.textButton}><Text style={styles.textButtonLabel}>Parolamı unuttum</Text></Pressable> : null}<Pressable onPress={() => setIsRegistering((current) => !current)} style={styles.toggle}><Text style={styles.toggleMuted}>{isRegistering ? "Zaten hesabın var mı?" : "Sora'da yeni misin?"}</Text><Text style={styles.toggleLink}>{isRegistering ? " Giriş yap" : " Hesap oluştur"}</Text></Pressable></View><Text style={styles.or}>veya</Text><View style={styles.providerGrid}><ProviderButton disabled={submitting} icon="logo-google" label="Google" onPress={() => startProvider("google")} /><ProviderButton disabled={submitting} icon="phone-portrait-outline" label="Telefon" onPress={() => setScreen("phone")} /></View></>;

  const phoneCard = <View style={styles.card}>{phoneRegistration ? profileFields : null}<Text style={styles.label}>TELEFON NUMARASI</Text><Field value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="532 123 45 67" style={styles.input} maxLength={18} focused={focusedField === "phone"} onFocus={focus("phone")} onBlur={blur} /><Pressable disabled={submitting} onPress={submitPhone}><LinearGradient colors={[BRAND, "#7BEF5A"]} style={[styles.submit, submitting && styles.disabled]}><Text style={styles.submitText}>{submitting ? "Gönderiliyor" : "SMS kodu gönder"}</Text><Ionicons name="chatbubble-ellipses-outline" size={19} color="#0A160A" /></LinearGradient></Pressable><Pressable onPress={() => setPhoneRegistration((current) => !current)} style={styles.toggle}><Text style={styles.toggleMuted}>{phoneRegistration ? "Zaten telefon hesabın var mı?" : "Telefonla yeni misin?"}</Text><Text style={styles.toggleLink}>{phoneRegistration ? " Giriş yap" : " Hesap oluştur"}</Text></Pressable><Pressable onPress={() => setScreen("email")} style={styles.textButton}><Text style={styles.textButtonLabel}>E-posta girişine dön</Text></Pressable></View>;

  const otpCard = <View style={styles.card}><Text style={styles.otpDescription}>{phone} numarasına gönderilen 6 haneli kodu gir.</Text><Text style={styles.label}>DOĞRULAMA KODU</Text><Field value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="000000" style={[styles.input, styles.otpInput]} maxLength={6} focused={focusedField === "otp"} onFocus={focus("otp")} onBlur={blur} /><Pressable disabled={submitting} onPress={submitOtp}><LinearGradient colors={[BRAND, "#7BEF5A"]} style={[styles.submit, submitting && styles.disabled]}><Text style={styles.submitText}>{submitting ? "Doğrulanıyor" : "Kodu doğrula"}</Text><Ionicons name="checkmark-circle-outline" size={20} color="#0A160A" /></LinearGradient></Pressable><Pressable disabled={submitting} onPress={submitPhone} style={styles.textButton}><Text style={styles.textButtonLabel}>Kodu yeniden gönder</Text></Pressable><Pressable onPress={() => setScreen("phone")} style={styles.textButton}><Text style={styles.textButtonLabel}>Telefon numarasını değiştir</Text></Pressable></View>;

  const subtitle = screen === "otp" ? "Telefon numaranı güvenle doğrula." : screen === "phone" ? "Telefon numaranla hızlı ve güvenli giriş yap." : isRegistering ? "Profilini oluştur, topluluğunu bul ve odalara katıl." : "Odaların, takiplerin ve profilin seni bekliyor.";

  return <LinearGradient colors={["#111524", "#10111C", "#050509"]} style={styles.screen}><SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.content}><View style={styles.hero}><Image source={SORA_LOGO} style={styles.logo} accessibilityLabel="Sora logosu" /><Text style={styles.kicker}>SORA HESABI</Text><Text style={styles.title}>{screen === "otp" ? "Kodunu doğrula." : screen === "phone" ? "Telefonla devam et." : isRegistering ? "Sesinle yerini al." : "Sohbete geri dön."}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>{screen === "email" ? emailCard : screen === "phone" ? phoneCard : otpCard}<View style={styles.providerHint}><Ionicons name="shield-checkmark-outline" size={16} color={BRAND} /><Text style={styles.providerHintText}>Hesabın güvenli oturumla cihazında saklanır.</Text></View></KeyboardAvoidingView></SafeAreaView></LinearGradient>;
}

const CARD_SHADOW = {
  shadowColor: "#000000",
  shadowOpacity: 0.45,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 8,
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  hero: { alignItems: "center", marginBottom: 26 },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 32,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(181,255,120,0.22)",
  },
  kicker: {
    color: BRAND,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: "#F8F8FC",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.1,
    marginTop: 9,
    textAlign: "center",
  },
  subtitle: {
    color: "#A9ADBE",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 9,
    maxWidth: 300,
  },
  card: {
    borderRadius: 26,
    padding: 19,
    backgroundColor: "#171A27",
    borderWidth: 1,
    borderColor: "#2A2E40",
    ...CARD_SHADOW,
  },
  label: {
    color: "#B6BAC9",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 7,
    marginTop: 4,
  },
  input: {
    height: 52,
    marginBottom: 16,
    paddingHorizontal: 14,
    borderRadius: 15,
    color: "#F7F7FB",
    backgroundColor: "#202433",
    borderWidth: 1,
    borderColor: "#333749",
    fontSize: 15,
  },
  inputFocused: {
    borderColor: "rgba(181,255,120,0.55)",
    backgroundColor: "#232838",
  },
  handleInput: {
    height: 52,
    marginBottom: 16,
    paddingHorizontal: 14,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#202433",
    borderWidth: 1,
    borderColor: "#333749",
  },
  handleInputFocused: { borderColor: "rgba(181,255,120,0.55)" },
  handlePrefix: {
    color: BRAND,
    fontSize: 16,
    fontWeight: "900",
    marginRight: 4,
  },
  handleText: { flex: 1, color: "#F7F7FB", fontSize: 15 },
  submit: {
    height: 54,
    marginTop: 5,
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
  submitText: { color: "#0A160A", fontSize: 15, fontWeight: "900" },
  toggle: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
  toggleMuted: { color: "#A5A9BA", fontSize: 12.5 },
  toggleLink: { color: BRAND, fontSize: 12.5, fontWeight: "900" },
  textButton: { alignSelf: "center", paddingVertical: 11 },
  textButtonLabel: { color: BRAND, fontSize: 12.5, fontWeight: "800" },
  or: {
    color: "#7F8495",
    fontSize: 11,
    textAlign: "center",
    marginVertical: 15,
    letterSpacing: 0.4,
  },
  providerGrid: { flexDirection: "row", gap: 9, justifyContent: "center" },
  providerButton: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: "#1D2130",
    borderWidth: 1,
    borderColor: "#333749",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
  },
  providerButtonText: {
    color: "#F5F6FA",
    fontSize: 10.5,
    fontWeight: "800",
  },
  providerHint: {
    marginTop: 20,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  providerHintText: {
    color: "#8F94A8",
    fontSize: 10.5,
    textAlign: "center",
    flexShrink: 1,
  },
  otpDescription: {
    color: "#B9BDCC",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 20,
  },
  otpInput: {
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: 8,
    textAlign: "center",
  },
});
