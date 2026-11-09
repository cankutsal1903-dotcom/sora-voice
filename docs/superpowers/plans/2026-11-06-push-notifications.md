# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real phone push notifications so users are alerted when a followed user goes live and when a scheduled room they set a reminder for is about to start.

**Architecture:** Android-first, fully free: Expo Push (FCM v1 under the hood) for remote notifications triggered by a Supabase Edge Function, plus client-side `scheduleNotificationAsync` for local reminders. A `device_push_tokens` table (multi-device, RLS-protected, global UNIQUE on `token`) stores tokens registered via a `SECURITY DEFINER` RPC; a `notification_log` table (RLS enabled, no client policy) prevents duplicate sends via atomic INSERT. The Edge Function is triggered by a Supabase Database Webhook on both INSERT and UPDATE events on the `rooms` table, and validates requests with a secret header. Remote push end-to-end testing requires a development build (not Expo Go).

**Tech Stack:** Expo SDK 58, `expo-notifications`, `expo-device`, Supabase Edge Functions (Deno/TypeScript), Supabase DB Webhooks, Expo Push API, FCM v1 (via EAS credentials), AsyncStorage

**Spec:** `docs/superpowers/specs/2026-11-06-push-notifications-design.md`

## Global Constraints

- `service_role` key MUST NOT appear in any client file — only in Edge Function environment (accessed via injected `Deno.env` — see Task 4 for the correct secret key name)
- `profiles.push_token` column MUST NOT be added; use `device_push_tokens` table
- `device_push_tokens.token` has a **global** `UNIQUE` constraint (not per-user) — token ownership transfers securely via `register_push_token` RPC
- `notification_log` has RLS enabled with **no client-facing policy** — only the Edge Function (service role) can write to it
- Android only for remote push; iOS deferred (no Apple credentials needed now)
- **Do not build APK or start EAS Build** — development build / Expo Go for local testing; remote push E2E test is deferred until a dev build exists
- Expo Push batch size: max 100 tokens per request
- Notification channel id: `sora-default`, color: `#B5FF78`
- AsyncStorage key for reminder notification IDs: `@sora/reminder-notif-ids`
- AsyncStorage key for reminder room IDs (already exists): `@sora/reminder-room-ids`
- Edge Function name: `notify-room-live`
- Migration files go in `supabase/migrations/`
- Supabase error objects from queries must always be checked — never silently ignored
- This project is **not a git repository** — all `git commit` steps are omitted from this plan
- Expo SDK 58 notification handler uses `shouldShowBanner` and `shouldShowList` (not `shouldShowAlert`)

## Review Focus

- **Duplicate remote notifications:** Webhook can re-deliver; the Edge Function's idempotency INSERT must be atomic — `INSERT ... ON CONFLICT DO NOTHING` returning the conflict count, not a prior SELECT+INSERT two-step. If conflict count is 0, return early without sending.
- **Stale reminder after `starts_at` changes:** If a scheduled room is rescheduled, the old local notification must be cancelled and a new one scheduled at the new time. The `toggleReminder` wiring in Task 6 handles toggle-off then toggle-on. Document that re-scheduling an already-active reminder requires calling `cancelReminder` then `scheduleReminder` explicitly.
- **Account switch token safety:** If a user logs out and a new user logs in on the same device, the token must move to the new user. The `register_push_token` RPC uses `SECURITY DEFINER` and upserts on the global `UNIQUE(token)`, updating `user_id` to the caller — test with two accounts on the same device.
- **Killed-state tap navigation before auth ready:** `getLastNotificationResponseAsync` runs once on mount; auth may not be initialized yet. Store the pending `roomId` in state and open the room once `userId` is set, not immediately.
- **`DeviceNotRegistered` index matching:** The Expo Push API response array is positionally aligned with the request batch array. Match by index (`json.data[i]` corresponds to `batch[i]`) — do not rely on `item.details.expoPushToken` which may be absent.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20261106_push_notifications.sql` | `device_push_tokens` (global UNIQUE token), `notification_log` (RLS on, no client policy), `register_push_token` RPC |
| Create | `supabase/functions/notify-room-live/index.ts` | Edge Function: secret verify, state guard, follower lookup, atomic idempotency, batch push with index-matched cleanup |
| Create | `src/notifications/pushTokenManager.js` | Call `register_push_token` RPC, platform detection, permission request |
| Create | `src/notifications/localReminders.js` | `scheduleReminder(room)`, `cancelReminder(roomId)` with AsyncStorage persistence |
| Modify | `app.json` | Add `expo-notifications` plugin, `googleServicesFile`, notification channel |
| Modify | `App.js` | Imports, SDK-58 handler, token registration, notification listeners (3 scenarios), pending-nav for killed-state, `toggleReminder` wiring |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20261106_push_notifications.sql`

**Interfaces:**
- Produces: `device_push_tokens(id, user_id, token, platform, created_at, updated_at)` with global `UNIQUE(token)` and RLS; client policy allows users to SELECT/DELETE their own rows
- Produces: `notification_log(id, event_key UNIQUE, sent_at)` with RLS enabled and **no** client-facing policy (only service role can insert)
- Produces: `register_push_token(p_token TEXT, p_platform TEXT) RETURNS void` — `SECURITY DEFINER` function, inserts or updates the token's `user_id` to `auth.uid()`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20261106_push_notifications.sql`:

```sql
-- device_push_tokens: one row per physical device token, globally unique
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,  -- global unique: token belongs to exactly one user
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read and delete their own tokens (registration goes through RPC)
CREATE POLICY "Kullanici kendi tokenlarini okur ve siler"
  ON public.device_push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Kullanici kendi tokenini siler"
  ON public.device_push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- SECURITY DEFINER RPC: safely transfers token to the calling user even if another user owned it
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.device_push_tokens (user_id, token, platform, updated_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id   = auth.uid(),
        platform  = EXCLUDED.platform,
        updated_at = now();
END;
$$;

-- notification_log: idempotency guard; only service role (Edge Function) writes here
CREATE TABLE IF NOT EXISTS public.notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   TEXT NOT NULL UNIQUE,
  sent_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
-- No client policy: table is only accessible via service_role (Edge Function)

CREATE INDEX IF NOT EXISTS notification_log_sent_at_idx ON public.notification_log (sent_at);
```

- [ ] **Step 2: Apply via Supabase CLI or panel**

Run: `supabase db push` (if CLI configured) OR paste into Supabase SQL editor and execute.
Expected: both tables and the function appear in Supabase; RLS shows as enabled on both tables.

- [ ] **Step 3: Verify**

In Supabase Table Editor:
- `device_push_tokens` → Policies: two SELECT and DELETE policies; no INSERT/UPDATE policy (insert goes through RPC)
- `notification_log` → Policies: RLS enabled, **zero** policies listed
- SQL editor: `SELECT proname FROM pg_proc WHERE proname = 'register_push_token';` → returns one row

---

### Task 2: `pushTokenManager.js` — Token Registration

**Files:**
- Create: `src/notifications/pushTokenManager.js`

**Interfaces:**
- Consumes: `supabase` client from `../auth/supabase`; `expo-device`, `expo-notifications`; `register_push_token` RPC from Task 1
- Produces: `registerPushToken(supabaseClient, userId): Promise<string | null>` — returns the Expo push token string on success, `null` if device is not physical or permission denied

- [ ] **Step 1: Install dependencies**

Run: `npx expo install expo-notifications expo-device`
Expected: both packages appear in `package.json` dependencies.

- [ ] **Step 2: Create `src/notifications/pushTokenManager.js`**

```js
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function registerPushToken(supabaseClient, userId) {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  // projectId must match the EAS project — read from app.json extra.eas.projectId at build time
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID; // set in .env or hardcoded after eas project:info
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  // Use RPC so token ownership transfers safely on account switch
  const { error } = await supabaseClient.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) {
    console.warn('register_push_token RPC failed:', error.message);
  }

  return token;
}
```

> `projectId`: run `eas project:info` to get the UUID, then set `EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>` in `.env`. Alternatively hardcode it after confirming with `eas project:info`.

> **Remote push note:** `getExpoPushTokenAsync` only works in a development build (not Expo Go). In Expo Go the call will fail or return a simulator token that cannot receive remote pushes. Remote end-to-end testing is deferred until a dev build exists.

- [ ] **Step 3: Verify: no import errors**

Start the Expo dev server (`npx expo start`). Open the app. No red-screen crash. The function is not called yet — wiring happens in Task 6.

---

### Task 3: `localReminders.js` — Local Notification Scheduling

**Files:**
- Create: `src/notifications/localReminders.js`
- Modify: `src/data/soraRepository.js` (add `startsAtIso` to `mapRoom`)

**Interfaces:**
- Consumes: `expo-notifications` (installed in Task 2); `@react-native-async-storage/async-storage`
- Produces:
  - `scheduleReminder(room): Promise<string | null>` — schedules local notification 60 s before `room.startsAtIso`, persists `notificationId` to AsyncStorage, returns id; returns `null` if `startsAtIso` absent or trigger time already passed
  - `cancelReminder(roomId): Promise<void>` — reads `notificationId` from AsyncStorage, cancels it, removes key

**Note on `startsAtIso`:** `mapRoom` in `soraRepository.js` currently sets `startsAt` to a formatted label string. A new `startsAtIso: room.starts_at || null` field is added so local reminders have the raw ISO date.

- [ ] **Step 1: Create `src/notifications/localReminders.js`**

```js
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const triggerDate = new Date(new Date(room.startsAtIso).getTime() - 60 * 1000);
  if (triggerDate <= new Date()) return null;

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Oda başlamak üzere!',
      body: room.title,
      data: { roomId: room.id, roomTitle: room.title },
      sound: true,
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
```

- [ ] **Step 2: Add `startsAtIso` to `mapRoom` in `src/data/soraRepository.js`**

In the returned object of `mapRoom` (after the `startsAt` field), add:

```js
startsAtIso: room.starts_at || null,
```

- [ ] **Step 3: Verify scheduling logic manually**

In Metro logs or a quick test: construct a room object with `startsAtIso` set to 2 minutes from now, call `scheduleReminder(room)`. Confirm: returns a string ID, AsyncStorage key `@sora/reminder-notif-ids` contains `{ [roomId]: <id> }`. Then call `cancelReminder(roomId)` — key is removed.

---

### Task 4: Edge Function — `notify-room-live`

**Files:**
- Create: `supabase/functions/notify-room-live/index.ts`

**Interfaces:**
- Consumes: Supabase DB Webhook POST payload shape:
  - INSERT: `{ type: 'INSERT', record: newRoom, old_record: null }`
  - UPDATE: `{ type: 'UPDATE', record: newRoom, old_record: oldRoom }`
- Consumes: env vars (Deno runtime):
  - `WEBHOOK_SECRET` — set as a named secret in Supabase Edge Function Secrets
  - `SUPABASE_URL` — automatically injected by Supabase runtime
  - `SUPABASE_SERVICE_ROLE_KEY` — **cannot** be named with the `SUPABASE_` prefix as a custom secret; use the automatically injected `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` which is provided by the Supabase runtime for Edge Functions
- Produces: HTTP 200 on success/skip; 401 on bad secret; 500 on unhandled error

> **Secret key name note:** Supabase Edge Function runtime automatically injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` — these do not need to be manually added as secrets. Only add `WEBHOOK_SECRET` manually.

- [ ] **Step 1: Create `supabase/functions/notify-room-live/index.ts`**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

Deno.serve(async (req: Request) => {
  // 1. Verify webhook secret
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { type: string; record: Record<string, unknown>; old_record: Record<string, unknown> | null };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const newRoom = payload.record;
  const oldRoom = payload.old_record;

  // 2. State transition guard: only act when transitioning TO 'live'
  if (newRoom?.state !== "live" || oldRoom?.state === "live") {
    return new Response("OK", { status: 200 });
  }

  const roomId = newRoom.id as string;
  const hostId = newRoom.host_id as string;
  const roomTitle = (newRoom.title as string) || "Oda";

  // Service role client — SUPABASE_SERVICE_ROLE_KEY is auto-injected by Supabase runtime
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 3. Atomic idempotency: INSERT returns conflict info
  const eventKey = `room-live:${roomId}`;
  const { error: logError, count } = await supabase
    .from("notification_log")
    .insert({ event_key: eventKey })
    .select("id", { count: "exact", head: true });

  if (logError) {
    // Unique constraint violation code: '23505'
    if ((logError as { code?: string }).code === "23505") {
      return new Response("OK", { status: 200 }); // already sent
    }
    console.error("notification_log insert error:", logError.message);
    return new Response("Internal Error", { status: 500 });
  }
  if (!count) {
    return new Response("OK", { status: 200 }); // conflict, already sent
  }

  // 4. Get followers of the host
  const { data: follows, error: followsError } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", hostId);
  if (followsError) {
    console.error("follows query error:", followsError.message);
    return new Response("Internal Error", { status: 500 });
  }
  const followerIds = (follows || []).map((f) => f.follower_id as string);
  if (!followerIds.length) return new Response("OK", { status: 200 });

  // 5. Get device tokens for all followers
  const { data: tokenRows, error: tokensError } = await supabase
    .from("device_push_tokens")
    .select("token")
    .in("user_id", followerIds);
  if (tokensError) {
    console.error("device_push_tokens query error:", tokensError.message);
    return new Response("Internal Error", { status: 500 });
  }
  const tokens = (tokenRows || []).map((r) => r.token as string);
  if (!tokens.length) return new Response("OK", { status: 200 });

  // 6. Batch send (max 100 per call), match errors by index
  const invalidTokens: string[] = [];
  for (let i = 0; i < tokens.length; i += 100) {
    const batchTokens = tokens.slice(i, i + 100);
    const batchMessages = batchTokens.map((token) => ({
      to: token,
      title: "Oda açıldı!",
      body: `${roomTitle} · canlı yayında`,
      data: { roomId, roomTitle },
      channelId: "sora-default",
      sound: "default",
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(batchMessages),
      });
      if (!res.ok) {
        console.warn("Expo Push API non-200:", res.status);
        continue;
      }
      const json = await res.json();
      // Positional match: json.data[j] corresponds to batchTokens[j]
      (json.data || []).forEach((item: { status: string; details?: { error?: string } }, j: number) => {
        if (
          item.status === "error" &&
          (item.details?.error === "DeviceNotRegistered" ||
            item.details?.error === "InvalidCredentials")
        ) {
          invalidTokens.push(batchTokens[j]);
        }
      });
    } catch (e) {
      console.warn("Expo Push batch fetch error:", (e as Error).message);
      // continue with next batch
    }
  }

  // 7. Cleanup invalid tokens
  if (invalidTokens.length) {
    const { error: cleanupError } = await supabase
      .from("device_push_tokens")
      .delete()
      .in("token", invalidTokens);
    if (cleanupError) {
      console.warn("Token cleanup error:", cleanupError.message);
    }
  }

  return new Response("OK", { status: 200 });
});
```

- [ ] **Step 2: Add `WEBHOOK_SECRET` to Edge Function secrets**

Supabase Dashboard → Edge Functions → `notify-room-live` → Secrets → Add:
- `WEBHOOK_SECRET`: any random 32-char string — record it for the Webhook header

> Do NOT manually add `SUPABASE_SERVICE_ROLE_KEY` — it is automatically injected by the Supabase runtime.

- [ ] **Step 3: Deploy the Edge Function**

Run: `supabase functions deploy notify-room-live`
Expected: function appears in Supabase Dashboard → Edge Functions with status Active.

- [ ] **Step 4: Configure the Database Webhook**

Supabase Dashboard → Database → Webhooks → Create new webhook:
- Name: `room-live-notify`
- Table: `rooms`
- Events: ✅ **Insert** ✅ **Update** (both — rooms can be created directly with `state='live'`)
- URL: `https://<project-ref>.supabase.co/functions/v1/notify-room-live`
- HTTP Headers: add `x-webhook-secret` → value from Step 2

- [ ] **Step 5: Smoke test (without remote push E2E)**

Via Supabase SQL editor:
```sql
-- Insert a new room directly as 'live' (triggers INSERT webhook)
INSERT INTO rooms (host_id, title, state, category)
VALUES ('<your-user-id>', 'Test odası', 'live', 'Sohbet');
```
Check Edge Function logs → Dashboard → Edge Functions → `notify-room-live` → Logs.
Expected: `200 OK`, no Supabase query errors in log. Actual phone delivery is deferred until a dev build with real FCM credentials exists.

---

### Task 5: `app.json` — Notification Plugin Config

**Files:**
- Modify: `app.json`

**Interfaces:**
- Produces: `expo-notifications` registered as an Expo plugin; Android notification channel `sora-default` with color `#B5FF78`; `googleServicesFile` pointer for FCM

- [ ] **Step 1: Add `expo-notifications` plugin to `app.json`**

In the `plugins` array, add after `"expo-secure-store"`:
```json
[
  "expo-notifications",
  {
    "icon": "./assets/images/sora-logo.png",
    "color": "#B5FF78",
    "defaultChannel": "sora-default",
    "sounds": []
  }
]
```

- [ ] **Step 2: Add Android FCM + notification channel config**

Inside `"android": { ... }`, add:
```json
"googleServicesFile": "./google-services.json",
"notification": {
  "channelId": "sora-default",
  "color": "#B5FF78"
}
```

> `google-services.json` is downloaded from Firebase Console → Android app. Place it at the project root. If not yet obtained, the app still runs for local testing — FCM delivery requires it only at build time.

- [ ] **Step 3: Add EAS project ID to `app.json`**

Add an `extra` block at the top level inside `"expo"`:
```json
"extra": {
  "eas": {
    "projectId": "<EAS_PROJECT_ID>"
  }
}
```

Get the value: run `eas project:info` in the project root or check Expo Dashboard → Project → Settings → Project ID.

- [ ] **Step 4: Verify**

Run: `npx expo config --type introspect`
Expected: no errors about unknown plugins or missing fields; `expo-notifications` appears in the plugin list.

---

### Task 6: `App.js` — Wire Push Token Registration and Notification Listeners

**Files:**
- Modify: `App.js`

**Interfaces:**
- Consumes: `registerPushToken` from `./src/notifications/pushTokenManager`
- Consumes: `scheduleReminder`, `cancelReminder` from `./src/notifications/localReminders`
- Consumes: `expo-notifications` (Expo SDK 58 API)

**SDK 58 handler fields:** Use `shouldShowBanner` and `shouldShowList` instead of `shouldShowAlert` (removed in SDK 52+).

- [ ] **Step 1: Add import statements**

After existing imports at the top of `App.js`, add:
```js
import * as Notifications from 'expo-notifications';
import { registerPushToken } from './src/notifications/pushTokenManager';
import { scheduleReminder, cancelReminder } from './src/notifications/localReminders';
```

- [ ] **Step 2: Set the notification handler (outside the component, after imports)**

```js
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,   // SDK 58: replaces shouldShowAlert
    shouldShowList: true,     // SDK 58: shows in notification center
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

- [ ] **Step 3: Add `pendingRoomId` state for killed-state navigation**

Inside the main App component, add alongside other `useState` declarations:
```js
const [pendingRoomId, setPendingRoomId] = useState(null);
```

- [ ] **Step 4: Handle killed-state tap on mount**

In a `useEffect` with `[]` deps:
```js
useEffect(() => {
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const roomId = response?.notification?.request?.content?.data?.roomId;
      if (roomId) setPendingRoomId(roomId);
    })
    .catch(() => undefined);
}, []);
```

- [ ] **Step 5: Drain `pendingRoomId` once auth is ready**

In the existing `useEffect` that runs when `userId` becomes available (or add alongside it):
```js
useEffect(() => {
  if (userId && pendingRoomId) {
    openRoom({ id: pendingRoomId, persisted: true });
    setPendingRoomId(null);
  }
}, [userId, pendingRoomId]);
```

> `openRoom` is the existing function that navigates into a room screen. Confirm the exact name in `App.js` before wiring.

- [ ] **Step 6: Handle background-state tap and foreground notification (combined effect)**

```js
useEffect(() => {
  // Background: user taps notification while app is backgrounded
  const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const roomId = response.notification.request.content.data?.roomId;
    if (roomId) openRoom({ id: roomId, persisted: true });
  });

  // Foreground: app is active when push arrives — show in-app toast
  const foregroundSub = Notifications.addNotificationReceivedListener((notification) => {
    const { roomId, roomTitle } = notification.request.content.data || {};
    if (roomId) pushNotification(`${roomTitle || 'Oda'} canlıya geçti`);
    // pushNotification is the existing in-app notification helper in App.js
  });

  return () => {
    tapSub.remove();
    foregroundSub.remove();
  };
}, []);
```

- [ ] **Step 7: Register push token when user session is established**

In the `useEffect` that fires when `userId` and `supabase` are ready (find the existing one that initialises user data):
```js
if (userId && supabase) {
  registerPushToken(supabase, userId).catch(() => undefined);
}
```

- [ ] **Step 8: Wire `scheduleReminder` / `cancelReminder` into `toggleReminder`**

Find `toggleReminder` in `App.js` (around line 1247). Add before the state update block:
```js
const targetRoom = scheduledRooms.find((r) => r.id === roomId);
const reminderWasActive = reminderRoomIds.includes(roomId);
if (reminderWasActive) {
  cancelReminder(roomId).catch(() => undefined);
} else if (targetRoom) {
  scheduleReminder(targetRoom).catch(() => undefined);
}
```

> If `toggleReminder` already computes `reminderWasActive`, reuse the existing variable rather than recomputing it.

- [ ] **Step 9: Verify (local reminders only — remote push deferred)**

Start Expo dev server. Log in. Navigate to Scheduled Rooms. Toggle a reminder on a room with `startsAtIso` set ~2 min in the future. After ~1 min, confirm the local notification fires (works in Expo Go). Check Metro logs for no crashes.

---

### Task 7: Android FCM Setup (One-time, Outside Code — Deferred for Remote Push)

> This task is required only before end-to-end remote push testing. It has no code changes. Mark as deferred until a development build is ready.

- [ ] **Step 1 (deferred): Create Firebase project**

[console.firebase.google.com](https://console.firebase.google.com) → Add Project → free Spark plan → name `Sora`.

- [ ] **Step 2 (deferred): Register Android app**

Firebase Console → Android → package: `com.arescan.soravoice` → download `google-services.json` → place at project root.

- [ ] **Step 3 (deferred): Configure FCM credentials in EAS**

Run: `eas credentials`
Select: Android → `com.arescan.soravoice` → FCM V1 → upload Firebase service account JSON (Firebase Console → Project Settings → Service Accounts → Generate new private key).

- [ ] **Step 4 (deferred): Build a development build**

Run: `eas build --profile development --platform android`
Install the resulting `.apk` on a physical Android device. This is the first point where remote Expo Push can be tested end-to-end.

> **Do not start this build until the user explicitly asks for it.** Building an APK is out of scope for the current implementation phase.
