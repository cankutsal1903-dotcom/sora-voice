import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

const serverError = (message: string, status = 500) => new Response(message, { status });

const secretsMatch = (expected: string | undefined, supplied: string | null) => {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  if (!secretsMatch(Deno.env.get("WEBHOOK_SECRET"), req.headers.get("x-webhook-secret"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase runtime credentials");
    return serverError("Server configuration error");
  }

  let payload: {
    record?: Record<string, unknown>;
    old_record?: Record<string, unknown> | null;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const newRoom = payload.record;
  const oldRoom = payload.old_record;
  if (newRoom?.state !== "live" || oldRoom?.state === "live") {
    return new Response("OK", { status: 200 });
  }

  const roomId = newRoom.id;
  const hostId = newRoom.host_id;
  if (typeof roomId !== "string" || typeof hostId !== "string") {
    return new Response("Bad Request", { status: 400 });
  }
  const roomTitle = typeof newRoom.title === "string" && newRoom.title.trim() ? newRoom.title : "Oda";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 5-minute dedupe window per room so reopened rooms notify followers again without spamming rapid toggles.
  const bucket = Math.floor(Date.now() / 300_000);
  const eventKey = `room-live:${roomId}:${bucket}`;
  const clearEventLock = () => supabase.from("notification_log").delete().eq("event_key", eventKey);

  const { error: logError } = await supabase.from("notification_log").insert({ event_key: eventKey });
  if (logError) {
    if ((logError as { code?: string }).code === "23505") return new Response("OK", { status: 200 });
    console.error("notification_log insert error:", logError.message);
    return serverError("Internal Error");
  }

  const { data: tokenRows, error: tokensError } = await supabase.rpc(
    "get_unblocked_follower_push_tokens_server",
    { p_host_id: hostId },
  );
  if (tokensError) {
    await clearEventLock();
    console.error("follower push token rpc error:", tokensError.message);
    return serverError("Internal Error");
  }

  const tokens = (tokenRows || [])
    .map((row: { token?: string }) => String(row?.token || "").trim())
    .filter(Boolean);
  if (!tokens.length) return new Response("OK", { status: 200 });

  const invalidTokens: string[] = [];
  try {
    for (let offset = 0; offset < tokens.length; offset += BATCH_SIZE) {
      const batchTokens = tokens.slice(offset, offset + BATCH_SIZE);
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batchTokens.map((token) => ({
          to: token,
          title: "Yeni canlı oda",
          body: `${roomTitle} şimdi yayında`,
          data: { roomId, roomTitle },
          channelId: "sora-default",
          sound: "default",
          priority: "high",
        }))),
      });
      if (!response.ok) throw new Error(`Expo Push API returned ${response.status}`);
      const pushPayload = await response.json();
      (pushPayload.data || []).forEach((item: { status?: string; details?: { error?: string } }, index: number) => {
        if (item.status === "error" && item.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(batchTokens[index]);
        }
      });
    }
  } catch (error) {
    await clearEventLock();
    console.error("Expo Push API error:", error instanceof Error ? error.message : error);
    return serverError("Push delivery failed", 502);
  }

  if (invalidTokens.length) {
    for (let offset = 0; offset < invalidTokens.length; offset += 200) {
      const slice = invalidTokens.slice(offset, offset + 200);
      const { error: cleanupError } = await supabase
        .from("device_push_tokens")
        .delete()
        .in("token", slice);
      if (cleanupError) console.warn("Token cleanup error:", cleanupError.message);
    }
  }

  return new Response("OK", { status: 200 });
});
