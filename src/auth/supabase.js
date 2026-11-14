import "react-native-url-polyfill/auto";
import { AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// SecureStore tek bir deger icin boyut siniri koyabilir (iOS'ta ~2048 byte,
// Android'de surum/cihaza gore degisir) ve Keystore sifirlandiginda okuma
// basarisiz olabilir. Ikisinde de deger sessizce kaybolur ve kullanici her
// uygulama acilisinda oturumdan atilmis olur.
//
// Bu sarmalayici:
//   1. Degeri 1500 karakterlik parcalara boler (boyut sinirini asmamak icin)
//   2. Her parcayi SecureStore'da tutar (Keystore destekli sifreleme)
//   3. SecureStore yazamazsa AsyncStorage'a yedekler
//   4. Okurken once SecureStore'a, olmazsa AsyncStorage'a bakar
//
// Boylece oturum, cihazin Keystore davranisindan bagimsiz olarak kalici olur.
const CHUNK_SIZE = 1500;
const CHUNK_COUNT_SUFFIX = ".__chunk_count";
const FALLBACK_PREFIX = "sora.auth.fallback.";

const chunkKeys = (key, count) =>
  Array.from({ length: count }, (_, index) => `${key}.__chunk_${index}`);

const splitIntoChunks = (value) => {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
};

const readChunksFromSecureStore = async (key) => {
  const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
  if (!countRaw) {
    // Parcalanmamis (onceki surumden kalan) tek deger olabilir
    return await SecureStore.getItemAsync(key);
  }
  const count = Number(countRaw);
  if (!Number.isFinite(count) || count <= 0) return null;
  const parts = await Promise.all(
    chunkKeys(key, count).map((chunkKey) => SecureStore.getItemAsync(chunkKey)),
  );
  if (parts.some((part) => part === null || part === undefined)) return null;
  return parts.join("");
};

const writeChunksToSecureStore = async (key, value) => {
  const previousCountRaw = await SecureStore.getItemAsync(
    key + CHUNK_COUNT_SUFFIX,
  );
  const chunks = splitIntoChunks(value);
  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(`${key}.__chunk_${index}`, chunk),
    ),
  );
  // Sayaci en son yaz: yarim kalan yazma okuma sirasinda yakalanir.
  await SecureStore.setItemAsync(key + CHUNK_COUNT_SUFFIX, String(chunks.length));
  const previousCount = Number(previousCountRaw);
  if (Number.isFinite(previousCount) && previousCount > chunks.length) {
    await Promise.all(
      chunkKeys(key, previousCount)
        .slice(chunks.length)
        .map((chunkKey) =>
          SecureStore.deleteItemAsync(chunkKey).catch(() => undefined),
        ),
    );
  }
};

const deleteChunksFromSecureStore = async (key) => {
  const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
  const count = Number(countRaw);
  if (Number.isFinite(count) && count > 0) {
    await Promise.all(
      chunkKeys(key, count).map((chunkKey) =>
        SecureStore.deleteItemAsync(chunkKey).catch(() => undefined),
      ),
    );
  }
  await SecureStore.deleteItemAsync(key + CHUNK_COUNT_SUFFIX).catch(
    () => undefined,
  );
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
};

const authStorage = {
  async getItem(key) {
    try {
      const fromSecureStore = await readChunksFromSecureStore(key);
      if (fromSecureStore) return fromSecureStore;
    } catch {
      // Keystore okunamadi; yedege dus
    }
    try {
      return await AsyncStorage.getItem(FALLBACK_PREFIX + key);
    } catch {
      return null;
    }
  },

  async setItem(key, value) {
    let stored = false;
    try {
      await writeChunksToSecureStore(key, value);
      stored = true;
    } catch {
      // Cihaz SecureStore'a yazamiyor; yedege dus
    }
    try {
      // Yedegi her zaman yaz: SecureStore'un sonradan okunamaz hale gelmesi
      // (Keystore sifirlanmasi, yedekten geri yukleme) oturumu bozmasin.
      await AsyncStorage.setItem(FALLBACK_PREFIX + key, value);
      stored = true;
    } catch {
      // yoksay
    }
    if (!stored) throw new Error("Oturum cihaza kaydedilemedi");
  },

  async removeItem(key) {
    await deleteChunksFromSecureStore(key).catch(() => undefined);
    await AsyncStorage.removeItem(FALLBACK_PREFIX + key).catch(() => undefined);
  },
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      storage: Platform.OS === "web" ? AsyncStorage : authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  : null;

export const AUTH_CALLBACK_URL = "sora://auth/callback";
export const PASSWORD_RESET_CALLBACK_URL = "sora://auth/reset-password";

const requireSupabase = () => {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
};

export const normalizePhoneNumber = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) return `+90${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 10) return `+90${digits}`;
  return digits ? `+${digits}` : "";
};

export const isHandleAvailable = async (handle) => {
  const client = requireSupabase();
  const { data, error } = await client.rpc("is_handle_available", { p_handle: handle });
  if (error) throw error;
  return Boolean(data);
};

export const startPhoneSignIn = async ({ phone, profile }) => {
  const client = requireSupabase();
  const options = profile
    ? { shouldCreateUser: true, data: { display_name: profile.displayName, handle: profile.handle } }
    : { shouldCreateUser: false };
  const { error } = await client.auth.signInWithOtp({ phone, options });
  if (error) throw error;
};

export const verifyPhoneSignIn = async ({ phone, token }) => {
  const client = requireSupabase();
  const { data, error } = await client.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
  return data.session;
};

export const startOAuthSignIn = async (provider) => {
  const client = requireSupabase();
  const isWeb = Platform.OS === "web";
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      ...(isWeb ? {} : { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true }),
    },
  });
  if (error) throw error;
  if (!isWeb && data?.url) await Linking.openURL(data.url);
};

export const requestPasswordReset = async (email) => {
  const client = requireSupabase();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: PASSWORD_RESET_CALLBACK_URL,
  });
  if (error) throw error;
};

export const updatePassword = async (password) => {
  const client = requireSupabase();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
};

export const completeAuthRedirect = async (url) => {
  const client = requireSupabase();
  const parsedUrl = new URL(url);
  const query = parsedUrl.searchParams;
  const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
  const valueFor = (key) => query.get(key) || fragment.get(key);
  const errorDescription = valueFor("error_description") || valueFor("error");

  if (errorDescription) throw new Error(errorDescription);

  const accessToken = valueFor("access_token");
  const refreshToken = valueFor("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  } else if (query.get("code")) {
    const { error } = await client.auth.exchangeCodeForSession(url);
    if (error) throw error;
  }

  const authType = valueFor("type");
  return {
    isPasswordRecovery: authType === "recovery",
    isEmailConfirmation: authType === "signup" || authType === "email_change",
  };
};

export const deleteCurrentAccount = async () => {
  const client = requireSupabase();
  const { error } = await client.functions.invoke("delete-account", { method: "POST" });
  if (error) throw error;
};

if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
