import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

const serverError = (message: string, status = 500) => new Response(message, { status });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("x-webhook-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
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
  const eventKey = `room-live:${roomId}`;
  const clearEventLock = () => supabase.from("notification_log").delete().eq("event_key", eventKey);

  const { error: logError } = await supabase.from("notification_log").insert({ event_key: eventKey });
  if (logError) {
    if ((logError as { code?: string }).code === "23505") return new Response("OK", { status: 200 });
    console.error("notification_log insert error:", logError.message);
    return serverError("Internal Error");
  }

  const { data: follows, error: followsError } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", hostId);
  if (followsError) {
    await clearEventLock();
    console.error("follows query error:", followsError.message);
    return serverError("Internal Error");
  }
  const followerIds = (follows || []).map((follow: { follower_id: string }) => follow.follower_id);
  if (!followerIds.length) return new Response("OK", { status: 200 });

  const { data: tokenRows, error: tokensError } = await supabase
    .from("device_push_tokens")
    .select("token")
    .in("user_id", followerIds);
  if (tokensError) {
    await clearEventLock();
    console.error("device_push_tokens query error:", tokensError.message);
    return serverError("Internal Error");
  }
  const tokens = (tokenRows || []).map((row: { token: string }) => row.token);
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
      const payload = await response.json();
      (payload.data || []).forEach((item: { status?: string; details?: { error?: string } }, index: number) => {
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
    const { error: cleanupError } = await supabase
      .from("device_push_tokens")
      .delete()
      .in("token", invalidTokens);
    if (cleanupError) console.warn("Token cleanup error:", cleanupError.message);
  }

  return new Response("OK", { status: 200 });
});
