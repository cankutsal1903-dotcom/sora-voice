/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
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
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  "";
const liveKitUrl = Deno.env.get("LIVEKIT_URL") || "";
const liveKitApiKey = Deno.env.get("LIVEKIT_API_KEY") || "";
const liveKitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") || "";

const liveKitService = liveKitUrl && liveKitApiKey && liveKitApiSecret
  ? new RoomServiceClient(
    liveKitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
    liveKitApiKey,
    liveKitApiSecret,
  )
  : null;

const roomRoleCanPublish = (role: string, muted: boolean, seated = false) =>
  role === "host" || (seated && !muted);
const UUID_PATTERN = /^[a-f0-9-]{36}$/i;
const COUPLE_SEAT_INDEX = 1;
const FIRST_REGULAR_SEAT_INDEX = 2;
const MIC_KICK_MINUTES = 10;

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

const roomSeatIndexes = (seatCount: number, coupleSeat: boolean) => {
  const lastSeat = seatCount === 13 ? 13 : 9;
  const seats: number[] = [];
  if (coupleSeat) seats.push(COUPLE_SEAT_INDEX);
  for (let seat = FIRST_REGULAR_SEAT_INDEX; seat <= lastSeat; seat += 1) {
    seats.push(seat);
  }
  return seats;
};

const participantSeat = (
  participant: { attributes?: Record<string, string> } | null,
) => {
  const value = Number.parseInt(participant?.attributes?.seat || "", 10);
  return Number.isInteger(value) ? value : null;
};

const requireConfig = () => {
  if (
    !supabaseUrl || !supabaseKey || !liveKitUrl || !liveKitApiKey ||
    !liveKitApiSecret
  ) {
    throw new Error("LiveKit token function is not configured");
  }
};

const getAuthorization = (request: Request) => {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization : "";
};

const getUserClient = (authorization: string) => {
  if (!authorization) throw new HttpError("Authentication required", 401);
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
  });
};

const getAuthenticatedClient = async (request: Request) => {
  const client = getUserClient(getAuthorization(request));
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError("Invalid session", 401);
  return { client, user: data.user };
};

const applyLiveKitPermission = async (
  roomId: string,
  identity: string,
  role: string,
  muted: boolean,
  seat?: number | null,
) => {
  if (!liveKitService) return;
  let seated = seat !== undefined ? seat !== null : false;
  if (seat === undefined) {
    const participant = await liveKitService.getParticipant(roomId, identity)
      .catch(() => null);
    seated = participantSeat(participant) !== null;
  }
  const options: Record<string, unknown> = {
    permission: {
      canPublish: roomRoleCanPublish(role, muted, seated),
      canSubscribe: true,
      canPublishData: true,
    },
  };
  if (seat !== undefined) {
    options.attributes = { seat: seat === null ? "" : String(seat) };
  }
  await liveKitService.updateParticipant(roomId, identity, options);
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
      )
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

  const { client: userClient, user } = await getAuthenticatedClient(request);

  const { data: membership, error: membershipError } = await userClient.rpc(
    "join_room",
    { p_room_id: cleanRoomName },
  );
  if (membershipError) {
    return json({ error: membershipError.message }, 403);
  }
  const { data: roomRow } = await userClient
    .from("rooms")
    .select("host_id")
    .eq("id", cleanRoomName)
    .maybeSingle();
  const isRoomHost = Boolean(roomRow?.host_id && roomRow.host_id === user.id);

  const rawRole = membership?.[0]?.role;
  const role = isRoomHost ? "host" : rawRole;
  const muted = isRoomHost ? false : Boolean(membership?.[0]?.is_muted);
  if (!role) {
    return json({ error: "Room membership could not be created" }, 403);
  }

  const canPublish = roomRoleCanPublish(role, muted, isRoomHost);
  const token = new AccessToken(liveKitApiKey, liveKitApiSecret, {
    identity: user.id,
    name: cleanName,
    ttl: "10m",
    attributes: isRoomHost ? { seat: "0" } : undefined,
  });
  token.addGrant({
    roomJoin: true,
    room: cleanRoomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
  });
  return json({
    serverUrl: liveKitUrl,
    token: await token.toJwt(),
    role,
    muted,
    canPublish,
  });
};

const moderateParticipant = async (request: Request, roomId: string) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId || "").trim();
  const action = String(body.action || "").trim();
  if (
    !/^[a-f0-9-]{36}$/i.test(roomId) || !/^[a-f0-9-]{36}$/i.test(targetUserId)
  ) {
    return json({ error: "Invalid room or participant" }, 400);
  }
  const userClient = getUserClient(getAuthorization(request));
  const { data: membership, error } = await userClient.rpc(
    "manage_room_member",
    {
      p_room_id: roomId,
      p_target_user_id: targetUserId,
      p_action: action,
    },
  );
  if (error || !membership?.[0]) {
    return json({ error: error?.message || "Moderation action failed" }, 403);
  }
  const updatedMembership = membership[0];
  if (liveKitService) {
    if (action === "remove") {
      await liveKitService
        .removeParticipant(roomId, targetUserId)
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

const listSeatedParticipants = async (roomId: string) => {
  if (!liveKitService) return [];
  const participants = await liveKitService.listParticipants(roomId).catch(
    () => [],
  );
  return participants.map((participant) => ({
    identity: participant.identity,
    seat: participantSeat(participant),
  }));
};

const authorizeSeat = async (request: Request, roomId: string) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const targetUserId = body.targetUserId
    ? String(body.targetUserId).trim()
    : null;
  const requestedSeat = body.seatIndex === undefined || body.seatIndex === null
    ? null
    : Number.parseInt(String(body.seatIndex), 10);
  if (
    !UUID_PATTERN.test(roomId) ||
    (targetUserId && !UUID_PATTERN.test(targetUserId))
  ) {
    return json({ error: "Invalid room or participant" }, 400);
  }
  if (!["take", "leave", "assign", "kick", "reject"].includes(action)) {
    return json({ error: "Unsupported seat action" }, 400);
  }

  const { client } = await getAuthenticatedClient(request);
  const { data, error } = await client.rpc("authorize_room_seat", {
    p_room_id: roomId,
    p_action: action,
    p_target_user_id: targetUserId,
  });
  const seatAuth = data?.[0];
  if (error || !seatAuth?.target_user_id) {
    return json({ error: error?.message || "Seat action failed" }, 403);
  }
  const targetId = seatAuth.target_user_id;
  if (action === "reject") return json({ ok: true });

  if (action === "leave" || action === "kick") {
    if (targetId !== seatAuth.host_id) {
      await applyLiveKitPermission(
        roomId,
        targetId,
        seatAuth.target_role,
        Boolean(seatAuth.target_muted),
        null,
      ).catch(() => undefined);
      await muteParticipantTracks(roomId, targetId, true).catch(() =>
        undefined
      );
    }
    return json({
      ok: true,
      seat: null,
      micBannedMinutes: action === "kick" ? MIC_KICK_MINUTES : 0,
    });
  }

  if (targetId === seatAuth.host_id) {
    await applyLiveKitPermission(roomId, targetId, "host", false, 0).catch(
      () => undefined,
    );
    return json({ ok: true, seat: 0 });
  }
  const participants = await listSeatedParticipants(roomId);
  if (!participants.some((participant) => participant.identity === targetId)) {
    return json({ error: "Participant is not connected" }, 409);
  }
  const validSeats = roomSeatIndexes(
    Number(seatAuth.seat_count),
    Boolean(seatAuth.couple_seat),
  );
  const occupied = new Set(
    participants
      .filter((participant) =>
        participant.identity !== targetId && participant.seat !== null
      )
      .map((participant) => participant.seat),
  );
  let seat = requestedSeat;
  if (seat !== null) {
    if (!validSeats.includes(seat)) return json({ error: "Invalid seat" }, 400);
    if (occupied.has(seat)) return json({ error: "Seat is taken" }, 409);
  } else {
    seat = validSeats.find(
      (index) => index >= FIRST_REGULAR_SEAT_INDEX && !occupied.has(index),
    ) ?? validSeats.find((index) => !occupied.has(index)) ?? null;
    if (seat === null) return json({ error: "No free seat" }, 409);
  }
  await applyLiveKitPermission(
    roomId,
    targetId,
    seatAuth.target_role,
    Boolean(seatAuth.target_muted),
    seat,
  );
  return json({ ok: true, seat });
};

const banParticipant = async (request: Request, roomId: string) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId || "").trim();
  const minutes = body.minutes === null || body.minutes === undefined
    ? null
    : Number.parseInt(String(body.minutes), 10);
  if (
    !UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(targetUserId) ||
    (minutes !== null && !(minutes > 0))
  ) {
    return json({ error: "Invalid ban request" }, 400);
  }
  const { client } = await getAuthenticatedClient(request);
  const { data, error } = await client.rpc("ban_room_member", {
    p_room_id: roomId,
    p_target_user_id: targetUserId,
    p_minutes: minutes,
  });
  if (error || !data?.[0]) {
    return json({ error: error?.message || "Ban failed" }, 403);
  }
  await liveKitService!.removeParticipant(roomId, targetUserId).catch(() =>
    undefined
  );
  return json({ membership: data[0] });
};

const updateLayout = async (request: Request, roomId: string) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const seatCount = Number.parseInt(String(body.seatCount), 10);
  const coupleSeat = Boolean(body.coupleSeat);
  if (!UUID_PATTERN.test(roomId) || ![9, 13].includes(seatCount)) {
    return json({ error: "Invalid layout" }, 400);
  }
  const { client } = await getAuthenticatedClient(request);
  const { data, error } = await client.rpc("update_room_layout", {
    p_room_id: roomId,
    p_seat_count: seatCount,
    p_couple_seat: coupleSeat,
  });
  const room = Array.isArray(data) ? data[0] : data;
  if (error || !room) {
    return json({ error: error?.message || "Layout update failed" }, 403);
  }

  const validSeats = new Set(roomSeatIndexes(seatCount, coupleSeat));
  const participants = await listSeatedParticipants(roomId);
  await Promise.all(
    participants
      .filter((participant) =>
        participant.seat !== null && !validSeats.has(participant.seat)
      )
      .map(async (participant) => {
        await liveKitService!.updateParticipant(roomId, participant.identity, {
          attributes: { seat: "" },
          permission: {
            canPublish: false,
            canSubscribe: true,
            canPublishData: true,
          },
        }).catch(() => undefined);
        await muteParticipantTracks(roomId, participant.identity, true).catch(
          () => undefined,
        );
      }),
  );
  return json({ room });
};

const listHostPresence = async (request: Request) => {
  requireConfig();
  const body = await request.json().catch(() => ({}));
  const rooms = Array.isArray(body.rooms) ? body.rooms.slice(0, 50) : [];
  await getAuthenticatedClient(request);
  const wanted = rooms.filter(
    (room) =>
      UUID_PATTERN.test(String(room?.roomId)) &&
      UUID_PATTERN.test(String(room?.hostId)),
  );
  if (!wanted.length) return json({ liveRoomIds: [] });
  const activeRooms = await liveKitService!
    .listRooms(wanted.map((room) => String(room.roomId)))
    .catch(() => []);
  const activeNames = new Set(
    activeRooms.filter((room) => room.numParticipants > 0).map((room) =>
      room.name
    ),
  );
  const checks = await Promise.all(
    wanted
      .filter((room) => activeNames.has(String(room.roomId)))
      .map(async (room) => {
        const participant = await liveKitService!
          .getParticipant(String(room.roomId), String(room.hostId))
          .catch(() => null);
        return participant ? String(room.roomId) : null;
      }),
  );
  return json({ liveRoomIds: checks.filter(Boolean) });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname.endsWith("/health")) {
    return json({ status: "ok" });
  }
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (pathname.endsWith("/token")) return await issueToken(request);
    const moderateMatch = pathname.match(/\/rooms\/([^/]+)\/moderate$/);
    if (moderateMatch) {
      return await moderateParticipant(request, moderateMatch[1]);
    }
    const seatMatch = pathname.match(/\/rooms\/([^/]+)\/seat$/);
    if (seatMatch) return await authorizeSeat(request, seatMatch[1]);
    const banMatch = pathname.match(/\/rooms\/([^/]+)\/ban$/);
    if (banMatch) return await banParticipant(request, banMatch[1]);
    const layoutMatch = pathname.match(/\/rooms\/([^/]+)\/layout$/);
    if (layoutMatch) return await updateLayout(request, layoutMatch[1]);
    if (pathname.endsWith("/rooms/presence")) {
      return await listHostPresence(request);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("livekit-token function failed", error);
    return json(
      { error: error instanceof Error ? error.message : "Request failed" },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
