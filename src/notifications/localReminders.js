import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = '@sora/reminder-notif-ids';

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
  if (!room.startsAtIso) return null;
  const startsAt = new Date(room.startsAtIso);
  if (Number.isNaN(startsAt.getTime())) return null;
  const triggerDate = new Date(startsAt.getTime() - 60 * 1000);
  if (triggerDate <= new Date()) return null;

  await cancelReminder(room.id);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Oda başlamak üzere!',
      body: room.title,
      data: { roomId: room.id, roomTitle: room.title },
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "sora-default" } : {}),
    },
    trigger: { type: 'date', date: triggerDate },
  });

  const ids = await getStoredIds();
  ids[room.id] = notificationId;
  await saveStoredIds(ids);
  return notificationId;
}

export async function cancelReminder(roomId) {
  const ids = await getStoredIds();
  const notificationId = ids[roomId];
  if (notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
  }
  delete ids[roomId];
  await saveStoredIds(ids);
}

export async function clearAllReminders() {
  const ids = await getStoredIds();
  await Promise.all(Object.values(ids).map((notificationId) => Notifications
    .cancelScheduledNotificationAsync(notificationId)
    .catch(() => undefined)));
  await AsyncStorage.removeItem(STORAGE_KEY);
}
