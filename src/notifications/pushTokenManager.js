import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

let lastRegisteredToken = null;

const getProjectId = () => process.env.EXPO_PUBLIC_EAS_PROJECT_ID
  || Constants.easConfig?.projectId
  || Constants.expoConfig?.extra?.eas?.projectId;

export async function configureNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("sora-default", {
    name: "Sora bildirimleri",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2F80ED",
    sound: "default",
  });
}

export async function registerPushToken(supabaseClient) {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (!supabaseClient) return null;

  await configureNotificationChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  const projectId = getProjectId();
  if (!projectId || projectId.includes("EAS_PROJECT_ID")) return null;
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData?.data;
  if (!token) return null;
  const platform = Platform.OS === "ios" ? "ios" : "android";

  const { error } = await supabaseClient.rpc("register_push_token", {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw error;

  lastRegisteredToken = token;
  return token;
}

export async function unregisterPushToken(supabaseClient) {
  if (Platform.OS === "web" || !Device.isDevice || !supabaseClient) return;
  try {
    let token = lastRegisteredToken;
    if (!token) {
      const projectId = getProjectId();
      if (projectId && !projectId.includes("EAS_PROJECT_ID")) {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === "granted") {
          const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
          token = tokenData?.data || null;
        }
      }
    }
    if (token) {
      await supabaseClient.from("device_push_tokens").delete().eq("token", token);
    }
  } catch {
    // Çıkış akışını engelleme
  } finally {
    lastRegisteredToken = null;
  }
}
