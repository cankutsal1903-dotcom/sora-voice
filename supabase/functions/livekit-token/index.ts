/// <reference lib="deno.ns" />

import { Buffer } from "node:buffer";
import { createHmac, randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  AccessToken,
  RoomServiceClient,
} from "https://esm.sh/livekit-server-sdk@2.11.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

// 1) Birincil sağlayıcı: LiveKit Cloud
const liveKitUrl = Deno.env.get("LIVEKIT_URL") || "";
const liveKitApiKey = Deno.env.get("LIVEKIT_API_KEY") || "";
const liveKitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") || "";

// 2) İkincil sağlayıcı: Agora RTC (10.000 ücretsiz dk/ay)
const agoraAppId = Deno.env.get("AGORA_APP_ID") || "";
const agoraAppCertificate = Deno.env.get("AGORA_APP_CERTIFICATE") || "";

// 3) Üçüncül sağlayıcı: Cloudflare Realtime SFU (1.000 GB ücretsiz/ay)
const cfCallsAppId = Deno.env.get("CF_CALLS_APP_ID") || "";
const cfCallsAppSecret = Deno.env.get("CF_CALLS_APP_SECRET") || "";

// 4) Dördüncül sağlayıcı: Yedek / Self-Hosted LiveKit
const backupLiveKitUrl = Deno.env.get("LIVEKIT_BACKUP_URL") || "";
const backupLiveKitApiKey = Deno.env.get("LIVEKIT_BACKUP_API_KEY") || "";
const backupLiveKitApiSecret = Deno.env.get("LIVEKIT_BACKUP_API_SECRET") || "";

const toHttpUrl = (wsUrl: string) =>
  wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

const primaryLiveKitService =
  liveKitUrl && liveKitApiKey && liveKitApiSecret
    ? new RoomServiceClient(
      toHttpUrl(liveKitUrl),
      liveKitApiKey,
      liveKitApiSecret,
    )
    : null;

const backupLiveKitService =
  backupLiveKitUrl && backupLiveKitApiKey && backupLiveKitApiSecret
    ? new RoomServiceClient(
      toHttpUrl(backupLiveKitUrl),
      backupLiveKitApiKey,
      backupLiveKitApiSecret,
    )
    : null;

const getConfiguredProviders = (): string[] => {
  const list: string[] = [];
  if (primaryLiveKitService) list.push("livekit");
  if (agoraAppId && agoraAppCertificate) list.push("agora");
  if (cfCallsAppId && cfCallsAppSecret) list.push("cloudflare");
  if (backupLiveKitService) list.push("livekit_backup");
  return list;
};

const getLiveKitServiceForProvider = (
  provider: string | null | undefined,
): RoomServiceClient | null => {
  if (provider === "livekit_backup") return backupLiveKitService;
  if (provider === "agora" || provider === "cloudflare") return null;
  return primaryLiveKitService;
};

// ── Agora AccessToken2 (007) imzalayıcı (resmi RtcTokenBuilder ile bit-for-bit uyumlu) ──
const packUint16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff);
  return b;
};

const packUint32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};

const packString = (s: string) => {
  const sb = Buffer.from(s, "utf8");
  return Buffer.concat([packUint16(sb.length), sb]);
};

const packMapUint32 = (map: Record<number, number>) => {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  return Buffer.concat([
    packUint16(keys.length),
    ...keys.map((k) => Buffer.concat([packUint16(k), packUint32(map[k])])),
  ]);
};

const hmacSha256 = (key: Buffer, data: Buffer) =>
  createHmac("sha256", key).update(data).digest();

const buildAgoraRtcToken007 = (
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number,
  canPublish: boolean,
  expireSec = 600,
): string => {
  const issueTs = Math.floor(Date.now() / 1000);
  const salt = randomInt(1, 99_999_999);
  const privs: Record<number, number> = { 1: expireSec };
  if (canPublish) {
    privs[2] = expireSec;
    privs[3] = expireSec;
    privs[4] = expireSec;
  }
  const serviceRtc = Buffer.concat([
    packUint16(1),
    packMapUint32(privs),
    packString(channelName),
    packString(uid === 0 ? "" : String(uid)),
  ]);
  let signing = hmacSha256(
    packUint32(issueTs),
    Buffer.from(appCertificate, "utf8"),
  );
  signing = hmacSha256(packUint32(salt), signing);
  const signingInfo = Buffer.concat([
    packString(appId),
    packUint32(issueTs),
    packUint32(expireSec),
    packUint32(salt),
    packUint16(1),
    serviceRtc,
  ]);
  const signature = hmacSha256(signing, signingInfo);
  const content = Buffer.concat([
    packUint16(signature.length),
    signature,
    signingInfo,
  ]);
  return `007${deflateSync(content).toString("base64")}`;
};

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

const requireBaseConfig = () => {
  if (!supabaseUrl || !supabaseKey || getConfiguredProviders().length === 0) {
    throw new Error("Voice session function is not configured");
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

const getRoomProvider = async (
  client: ReturnType<typeof createClient>,
  roomId: string,
): Promise<string> => {
  const { data } = await client
    .from("rooms")
    .select("voice_provider")
    .eq("id", roomId)
    .maybeSingle();
  return data?.voice_provider || "livekit";
};

const applyLiveKitPermission = async (
  lkService: RoomServiceClient | null,
  roomId: string,
  identity: string,
  role: string,
  muted: boolean,
  seat?: number | null,
) => {
  if (!lkService) return;
  let seated = seat !== undefined ? seat !== null : false;
  if (seat === undefined) {
    const participant = await lkService.getParticipant(roomId, identity)
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
  await lkService.updateParticipant(roomId, identity, options);
};

const muteParticipantTracks = async (
  lkService: RoomServiceClient | null,
  roomId: string,
  identity: string,
  muted: boolean,
) => {
  if (!lkService) return;
  const participant = await lkService
    .getParticipant(roomId, identity)
    .catch(() => null);
  if (!participant) return;
  await Promise.all(
    (participant.tracks || []).map((track) =>
      lkService.mutePublishedTrack(
        roomId,
        identity,
        track.sid,
        muted,
      )
    ),
  );
};

const createCloudflareCallsSession = async () => {
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/apps/${cfCallsAppId}/sessions/new`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfCallsAppSecret}`,
        "Content-Type": "application/json",
      },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.sessionId) {
    throw new HttpError("Cloudflare Realtime session failed", 502);
  }
  return String(data.sessionId);
};

const issueToken = async (request: Request) => {
  requireBaseConfig();
  const body = await request.json().catch(() => ({}));
  const cleanName = String(body.name || "").trim();
  const cleanRoomName = String(body.roomName || "").trim();
  const rawExclude = Array.isArray(body.excludeProviders)
    ? body.excludeProviders.map((item: unknown) => String(item || "").trim())
      .filter(Boolean)
    : [];

  if (!cleanName || !cleanRoomName) {
    return json({ error: "name and roomName are required" }, 400);
  }
  if (!UUID_PATTERN.test(cleanRoomName) || cleanName.length > 128) {
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

  const configuredProviders = getConfiguredProviders();
  const { data: allocRows, error: allocError } = await userClient.rpc(
    "allocate_voice_session",
    {
      p_room_id: cleanRoomName,
      p_configured_providers: configuredProviders,
      p_exclude_providers: rawExclude,
    },
  );
  if (allocError || !allocRows?.[0]) {
    return json(
      { error: allocError?.message || "Voice session allocation failed" },
      503,
    );
  }

  const alloc = allocRows[0];
  const provider = String(alloc.provider_id || "livekit");
  const isRoomHost = Boolean(alloc.is_host);
  const role = isRoomHost
    ? "host"
    : String(alloc.role || membership?.[0]?.role || "listener");
  const muted = isRoomHost ? false : Boolean(alloc.is_muted);
  const seat = isRoomHost
    ? 0
    : (typeof alloc.seat_index === "number" ? alloc.seat_index : null);
  const canPublish = roomRoleCanPublish(role, muted, seat !== null);
  const quota = {
    usedMinutes: Number(alloc.used_minutes) || 0,
    limitMinutes: Number(alloc.monthly_limit_minutes) || 5000,
  };

  if (provider === "agora") {
    const agoraUid = Number(alloc.agora_uid) || 1;
    const token = buildAgoraRtcToken007(
      agoraAppId,
      agoraAppCertificate,
      cleanRoomName,
      agoraUid,
      canPublish,
      600,
    );
    return json({
      provider: "agora",
      appId: agoraAppId,
      token,
      roomId: cleanRoomName,
      agoraUid,
      role,
      muted,
      seat,
      canPublish,
      quota,
    });
  }

  if (provider === "cloudflare") {
    const cfSessionId = await createCloudflareCallsSession();
    return json({
      provider: "cloudflare",
      cfSessionId,
      token: cfSessionId,
      roomId: cleanRoomName,
      agoraUid: Number(alloc.agora_uid) || 1,
      role,
      muted,
      seat,
      canPublish,
      quota,
    });
  }

  const useBackup = provider === "livekit_backup";
  const targetUrl = useBackup ? backupLiveKitUrl : liveKitUrl;
  const targetKey = useBackup ? backupLiveKitApiKey : liveKitApiKey;
  const targetSecret = useBackup ? backupLiveKitApiSecret : liveKitApiSecret;

  const token = new AccessToken(targetKey, targetSecret, {
    identity: user.id,
    name: cleanName,
    ttl: "10m",
    attributes: seat !== null ? { seat: String(seat) } : undefined,
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
    provider,
    serverUrl: targetUrl,
    token: await token.toJwt(),
    roomId: cleanRoomName,
    agoraUid: Number(alloc.agora_uid) || 1,
    role,
    muted,
    seat,
    canPublish,
    quota,
  });
};

const handleVoiceHeartbeat = async (request: Request) => {
  requireBaseConfig();
  const body = await request.json().catch(() => ({}));
  const roomId = String(body.roomId || body.roomName || "").trim();
  const ended = Boolean(body.ended);
  const failedProvider = body.failedProvider
    ? String(body.failedProvider).trim()
    : null;
  const errorText = body.errorText ? String(body.errorText).trim() : null;

  if (!UUID_PATTERN.test(roomId)) {
    return json({ error: "Invalid room id" }, 400);
  }

  const { client } = await getAuthenticatedClient(request);
  const { data, error } = await client.rpc("heartbeat_voice_session", {
    p_room_id: roomId,
    p_ended: ended,
    p_failed_provider: failedProvider,
    p_error_text: errorText,
  });
  if (error) {
    return json({ error: error.message }, 403);
  }
  return json(data || { ok: true });
};

const handleCloudflareNegotiate = async (request: Request) => {
  requireBaseConfig();
  if (!cfCallsAppId || !cfCallsAppSecret) {
    return json({ error: "Cloudflare Realtime is not configured" }, 503);
  }
  const body = await request.json().catch(() => ({}));
  const roomId = String(body.roomId || "").trim();
  const sessionId = String(body.sessionId || "").trim();
  const op = String(body.op || "tracks_new").trim();
  const payload = body.payload || {};

  if (!UUID_PATTERN.test(roomId) || !sessionId) {
    return json({ error: "Invalid Cloudflare request" }, 400);
  }

  const { client, user } = await getAuthenticatedClient(request);
  const { data: member } = await client
    .from("room_members")
    .select("role, is_muted, removed_at")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || member.removed_at) {
    return json({ error: "Room membership required" }, 403);
  }

  const endpoint = op === "renegotiate"
    ? `https://rtc.live.cloudflare.com/v1/apps/${cfCallsAppId}/sessions/${sessionId}/renegotiate`
    : `https://rtc.live.cloudflare.com/v1/apps/${cfCallsAppId}/sessions/${sessionId}/tracks/new`;

  const upstream = await fetch(endpoint, {
    method: op === "renegotiate" ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${cfCallsAppSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const upstreamJson = await upstream.json().catch(() => ({}));
  return json(upstreamJson, upstream.status);
};

const moderateParticipant = async (request: Request, roomId: string) => {
  requireBaseConfig();
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId || "").trim();
  const action = String(body.action || "").trim();
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(targetUserId)) {
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
  if (["demote_listener", "remove"].includes(action)) {
    await userClient.rpc("commit_room_seat", {
      p_room_id: roomId,
      p_target_user_id: targetUserId,
      p_seat_index: null,
      p_valid_seats: null,
    }).catch(() => undefined);
  }

  const provider = await getRoomProvider(userClient, roomId);
  const lkService = getLiveKitServiceForProvider(provider);
  if (lkService) {
    if (action === "remove") {
      await lkService.removeParticipant(roomId, targetUserId).catch(() =>
        undefined
      );
    } else {
      await applyLiveKitPermission(
        lkService,
        roomId,
        targetUserId,
        updatedMembership.role,
        updatedMembership.is_muted,
        action === "demote_listener" ? null : undefined,
      ).catch(() => undefined);
      if (["mute", "demote_listener"].includes(action)) {
        await muteParticipantTracks(lkService, roomId, targetUserId, true);
      }
    }
  }
  return json({ membership: updatedMembership });
};

const listSeatedParticipants = async (
  lkService: RoomServiceClient | null,
  roomId: string,
) => {
  if (!lkService) return [];
  const participants = await lkService.listParticipants(roomId).catch(
    () => [],
  );
  return participants.map((participant) => ({
    identity: participant.identity,
    seat: participantSeat(participant),
  }));
};

const authorizeSeat = async (request: Request, roomId: string) => {
  requireBaseConfig();
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

  const provider = await getRoomProvider(client, roomId);
  const lkService = getLiveKitServiceForProvider(provider);

  if (action === "leave" || action === "kick") {
    if (targetId !== seatAuth.host_id) {
      await client.rpc("commit_room_seat", {
        p_room_id: roomId,
        p_target_user_id: targetId,
        p_seat_index: null,
        p_valid_seats: null,
      }).catch(() => undefined);

      await applyLiveKitPermission(
        lkService,
        roomId,
        targetId,
        seatAuth.target_role,
        Boolean(seatAuth.target_muted),
        null,
      ).catch(() => undefined);
      await muteParticipantTracks(lkService, roomId, targetId, true).catch(() =>
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
    await client.rpc("commit_room_seat", {
      p_room_id: roomId,
      p_target_user_id: targetId,
      p_seat_index: 0,
      p_valid_seats: [0],
    }).catch(() => undefined);
    await applyLiveKitPermission(lkService, roomId, targetId, "host", false, 0)
      .catch(() => undefined);
    return json({ ok: true, seat: 0 });
  }

  const validSeats = roomSeatIndexes(
    Number(seatAuth.seat_count),
    Boolean(seatAuth.couple_seat),
  );
  const orderedValidSeats = [
    ...validSeats.filter((idx) => idx >= FIRST_REGULAR_SEAT_INDEX),
    ...validSeats.filter((idx) => idx < FIRST_REGULAR_SEAT_INDEX),
  ];

  // LiveKit dışı sağlayıcılarda (Agora / Cloudflare) koltuk ataması doğrudan DB atomik kilidiyle yapılır
  if (!lkService) {
    const { data: assignedSeat, error: seatErr } = await client.rpc(
      "commit_room_seat",
      {
        p_room_id: roomId,
        p_target_user_id: targetId,
        p_seat_index: requestedSeat,
        p_valid_seats: orderedValidSeats,
      },
    );
    if (seatErr || assignedSeat === null || assignedSeat === undefined) {
      const msg = seatErr?.message || "Seat action failed";
      const code = msg.includes("Invalid seat") ? 400 : 409;
      return json({ error: msg }, code);
    }
    return json({ ok: true, seat: Number(assignedSeat) });
  }

  const participants = await listSeatedParticipants(lkService, roomId);
  if (!participants.some((participant) => participant.identity === targetId)) {
    return json({ error: "Participant is not connected" }, 409);
  }
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
    seat = orderedValidSeats.find((index) => !occupied.has(index)) ?? null;
    if (seat === null) return json({ error: "No free seat" }, 409);
  }

  await client.rpc("commit_room_seat", {
    p_room_id: roomId,
    p_target_user_id: targetId,
    p_seat_index: seat,
    p_valid_seats: validSeats,
  }).catch(() => undefined);

  await applyLiveKitPermission(
    lkService,
    roomId,
    targetId,
    seatAuth.target_role,
    Boolean(seatAuth.target_muted),
    seat,
  );
  return json({ ok: true, seat });
};

const banParticipant = async (request: Request, roomId: string) => {
  requireBaseConfig();
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
  const provider = await getRoomProvider(client, roomId);
  const lkService = getLiveKitServiceForProvider(provider);
  if (lkService) {
    await lkService.removeParticipant(roomId, targetUserId).catch(() =>
      undefined
    );
  }
  return json({ membership: data[0] });
};

const updateLayout = async (request: Request, roomId: string) => {
  requireBaseConfig();
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

  const validList = roomSeatIndexes(seatCount, coupleSeat);
  await client.rpc("prune_invalid_room_seats", {
    p_room_id: roomId,
    p_valid_seats: validList,
  }).catch(() => undefined);

  const provider = await getRoomProvider(client, roomId);
  const lkService = getLiveKitServiceForProvider(provider);
  if (lkService) {
    const validSeats = new Set(validList);
    const participants = await listSeatedParticipants(lkService, roomId);
    await Promise.all(
      participants
        .filter((participant) =>
          participant.seat !== null && !validSeats.has(participant.seat)
        )
        .map(async (participant) => {
          await lkService.updateParticipant(roomId, participant.identity, {
            attributes: { seat: "" },
            permission: {
              canPublish: false,
              canSubscribe: true,
              canPublishData: true,
            },
          }).catch(() => undefined);
          await muteParticipantTracks(lkService, roomId, participant.identity, true)
            .catch(() => undefined);
        }),
    );
  }
  return json({ room });
};

const listHostPresence = async (request: Request) => {
  requireBaseConfig();
  const body = await request.json().catch(() => ({}));
  const rooms = Array.isArray(body.rooms) ? body.rooms.slice(0, 50) : [];
  const { client } = await getAuthenticatedClient(request);
  const wanted = rooms.filter(
    (room) =>
      UUID_PATTERN.test(String(room?.roomId)) &&
      UUID_PATTERN.test(String(room?.hostId)),
  );
  if (!wanted.length) return json({ liveRoomIds: [] });

  const liveSet = new Set<string>();
  const roomIds = wanted.map((r) => String(r.roomId));

  // 1) Aktif veritabanı ses oturumları (tüm sağlayıcıları kapsar: LiveKit, Agora, Cloudflare, Yedek)
  const twoMinAgo = new Date(Date.now() - 130_000).toISOString();
  const { data: activeSessions } = await client
    .from("voice_active_sessions")
    .select("room_id, user_id")
    .in("room_id", roomIds)
    .gte("last_heartbeat_at", twoMinAgo);

  if (Array.isArray(activeSessions)) {
    const sessionPairs = new Set(
      activeSessions.map((s) => `${s.room_id}:${s.user_id}`),
    );
    for (const r of wanted) {
      if (sessionPairs.has(`${r.roomId}:${r.hostId}`)) {
        liveSet.add(String(r.roomId));
      }
    }
  }

  // 2) LiveKit doğrudan varlık kontrolü (birincil + yedek)
  for (const lkService of [primaryLiveKitService, backupLiveKitService]) {
    if (!lkService) continue;
    const remaining = wanted.filter((r) => !liveSet.has(String(r.roomId)));
    if (!remaining.length) break;
    const activeRooms = await lkService
      .listRooms(remaining.map((r) => String(r.roomId)))
      .catch(() => []);
    const activeNames = new Set(
      activeRooms.filter((r) => r.numParticipants > 0).map((r) => r.name),
    );
    const checks = await Promise.all(
      remaining
        .filter((r) => activeNames.has(String(r.roomId)))
        .map(async (r) => {
          const participant = await lkService
            .getParticipant(String(r.roomId), String(r.hostId))
            .catch(() => null);
          return participant ? String(r.roomId) : null;
        }),
    );
    for (const id of checks) {
      if (id) liveSet.add(id);
    }
  }

  return json({ liveRoomIds: [...liveSet] });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname.endsWith("/health")) {
    return json({
      status: "ok",
      configuredProviders: getConfiguredProviders(),
    });
  }
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (pathname.endsWith("/token") || pathname.endsWith("/voice/session")) {
      return await issueToken(request);
    }
    if (pathname.endsWith("/voice/heartbeat")) {
      return await handleVoiceHeartbeat(request);
    }
    if (pathname.endsWith("/voice/cloudflare/negotiate")) {
      return await handleCloudflareNegotiate(request);
    }
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
