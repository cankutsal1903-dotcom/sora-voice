import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { configureNotificationChannel } from "./pushTokenManager";

const STORAGE_KEY = "@sora/reminder-notif-ids";
let storageQueue = Promise.resolve();

const runSerialized = (fn) => {
  const next = storageQueue.then(fn, fn);
  storageQueue = next.catch(() => undefined);
  return next;
};

async function getStoredIds() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveStoredIds(ids) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export async function scheduleReminder(room) {
  if (Platform.OS === "web" || !room?.startsAtIso) return null;
  const startsAt = new Date(room.startsAtIso);
  if (Number.isNaN(startsAt.getTime())) return null;
  const triggerDate = new Date(startsAt.getTime() - 60 * 1000);
  if (triggerDate <= new Date()) return null;

  await configureNotificationChannel().catch(() => undefined);
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  return runSerialized(async () => {
    const prevIds = await getStoredIds();
    if (prevIds[room.id]) {
      await Notifications.cancelScheduledNotificationAsync(prevIds[room.id]).catch(() => undefined);
      delete prevIds[room.id];
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Oda başlamak üzere!",
        body: room.title,
        data: { roomId: room.id, roomTitle: room.title },
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "sora-default" } : {}),
      },
      trigger: { type: "date", date: triggerDate },
    });

    prevIds[room.id] = notificationId;
    await saveStoredIds(prevIds);
    return notificationId;
  });
}

export async function cancelReminder(roomId) {
  if (Platform.OS === "web") return;
  return runSerialized(async () => {
    const ids = await getStoredIds();
    const notificationId = ids[roomId];
    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
    }
    delete ids[roomId];
    await saveStoredIds(ids);
  });
}

export async function clearAllReminders() {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    return;
  }
  return runSerialized(async () => {
    const ids = await getStoredIds();
    await Promise.all(
      Object.values(ids).map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined),
      ),
    );
    await AsyncStorage.removeItem(STORAGE_KEY);
  });
}
