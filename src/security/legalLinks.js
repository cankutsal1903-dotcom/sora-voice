import { Alert, Linking } from "react-native";

export const LEGAL_BASE_URL = "https://cankutsal1903-dotcom.github.io/sora-voice";
export const PRIVACY_POLICY_URL = `${LEGAL_BASE_URL}/privacy.html`;
export const TERMS_OF_USE_URL = `${LEGAL_BASE_URL}/terms.html`;
export const ACCOUNT_DELETION_URL = `${LEGAL_BASE_URL}/delete-account.html`;
export const CHILD_SAFETY_URL = `${LEGAL_BASE_URL}/child-safety.html`;
export const SUPPORT_EMAIL = "cankutsal1903@gmail.com";

export const openLegalUrl = async (url) => {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Bağlantı açılamadı", `Belgeye tarayıcıdan erişebilirsin:\n${url}`);
  }
};
