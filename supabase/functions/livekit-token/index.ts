import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AccessToken,
  RoomServiceClient,
} from "https://esm.sh/livekit-server-sdk@2.11.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  "";
const liveKitUrl = Deno.env.get("LIVEKIT_URL") || "";
const liveKitApiKey = Deno.env.get("LIVEKIT_API_KEY") || "";
const liveKitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") || "";

const liveKitService =
  liveKitUrl && liveKitApiKey && liveKitApiSecret
    ? new RoomServiceClient(
        liveKitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
        liveKitApiKey,
        liveKitApiSecret,
      )
    : null;

const roomRoleCanPublish = (role: string, muted: boolean) =>
  ["host", "moderator", "speaker"].includes(role) && !muted;
const roomRoleIsStaff = (role: string) => ["host", "moderator"].includes(role);

const requireConfig = () => {
  if (!supabaseUrl || !supabaseKey || !liveKitUrl || !liveKitApiKey || !liveKitApiSecret) {
    throw new Error("LiveKit token function is not configured");
  }
};

const getAuthorization = (request: Request) => {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization : "";
};

const getUserClient = (authorization: string) => {
  if (!authorization) throw new Error("Authentication required");
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
  });
};

const applyLiveKitPermission = async (
  roomId: string,
  identity: string,
  role: string,
  muted: boolean,
) => {
  if (!liveKitService) return;
  await liveKitService.updateParticipant(roomId, identity, {
    permission: {
      canPublish: roomRoleCanPublish(role, muted),
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: roomRoleIsStaff(role),
    },
  });
};

const muteParticipantTracks = async (
  roomId: string,
  identity: string,
  muted: boolean,
) => {
  if (!liveKitService) return;
  const participant = await liveKitService
    .getParticipant(roomId, identity)
    .catch(() => null);
  if (!participant) return;
  await Promise.all(
    (participant.tracks || []).map((track) =>
      liveKitService!.mutePublishedTrack(
        roomId,
        identity,
        track.sid,
        muted,
      ),
    ),
  );
};

const issueToken = async (request: Request) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const cleanName = String(body.name || "").trim();
  const cleanRoomName = String(body.roomName || "").trim();
  if (!cleanName || !cleanRoomName) {
    return json({ error: "name and roomName are required" }, 400);
  }
  if (!/^[a-f0-9-]{36}$/i.test(cleanRoomName) || cleanName.length > 128) {
    return json({ error: "roomName must be a valid room id" }, 400);
  }

  const authorization = getAuthorization(request);
  const userClient = getUserClient(authorization);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  const { data: membership, error: membershipError } = await userClient.rpc(
    "join_room",
    { p_room_id: cleanRoomName },
  );
  if (membershipError) {
    return json({ error: membershipError.message }, 403);
  }
  const role = membership?.[0]?.role;
  const muted = Boolean(membership?.[0]?.is_muted);
  if (!role) return json({ error: "Room membership could not be created" }, 403);

  const token = new AccessToken(liveKitApiKey, liveKitApiSecret, {
    identity: userData.user.id,
    name: cleanName,
    ttl: "10m",
  });
  token.addGrant({
    roomJoin: true,
    room: cleanRoomName,
    canPublish: roomRoleCanPublish(role, muted),
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: roomRoleIsStaff(role),
  });
  return json({
    serverUrl: liveKitUrl,
    token: await token.toJwt(),
    role,
    muted,
  });
};

const moderateParticipant = async (request: Request, roomId: string) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId || "").trim();
  const action = String(body.action || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(roomId) || !/^[a-f0-9-]{36}$/i.test(targetUserId)) {
    return json({ error: "Invalid room or participant" }, 400);
  }
  const userClient = getUserClient(getAuthorization(request));
  const { data: membership, error } = await userClient.rpc("manage_room_member", {
    p_room_id: roomId,
    p_target_user_id: targetUserId,
    p_action: action,
  });
  if (error || !membership?.[0]) {
    return json({ error: error?.message || "Moderation action failed" }, 403);
  }
  const updatedMembership = membership[0];
  if (liveKitService) {
    if (action === "remove") {
      await liveKitService
        .removeParticipant(roomId, targetUserId, {
          revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
        })
        .catch(() => undefined);
    } else {
      await applyLiveKitPermission(
        roomId,
        targetUserId,
        updatedMembership.role,
        updatedMembership.is_muted,
      ).catch(() => undefined);
      if (["mute", "demote_listener"].includes(action)) {
        await muteParticipantTracks(roomId, targetUserId, true);
      }
    }
  }
  return json({ membership: updatedMembership });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname.endsWith("/health")) {
    return json({ status: "ok" });
  }
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (pathname.endsWith("/token")) return await issueToken(request);
    const match = pathname.match(/\/rooms\/([^/]+)\/moderate$/);
    if (match) return await moderateParticipant(request, match[1]);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("livekit-token function failed", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
