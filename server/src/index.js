import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const requiredEnvironment = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
}

const PLACEHOLDER_PATTERN = /(your[-_]|example\.com|\bYOUR_)/i;
const placeholderEnvironment = requiredEnvironment.filter((key) => PLACEHOLDER_PATTERN.test(String(process.env[key])));
if (placeholderEnvironment.length) {
  throw new Error(
    `Placeholder values detected for: ${placeholderEnvironment.join(", ")}. ` +
    "Fill in real credentials in server/.env (LiveKit Cloud project settings) before starting the server."
  );
}

const liveKitUrlIsValid = /^wss?:\/\/[^\s]+$/i.test(String(process.env.LIVEKIT_URL));
if (!liveKitUrlIsValid) {
  throw new Error("LIVEKIT_URL must start with wss:// (or ws:// for a local LiveKit server).");
}

const app = express();
app.set("trust proxy", 1);

const port = Number(process.env.PORT || 3001);
const liveKitServiceUrl = process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const liveKitService = new RoomServiceClient(liveKitServiceUrl, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (!allowedOrigins.length && !isProduction) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(express.json({ limit: "12kb" }));

const makeRateLimiter = (windowMs, maxRequests) => {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    if (buckets.size > 1024) {
      for (const [k, entry] of buckets) {
        if (now - entry.createdAt >= windowMs) buckets.delete(k);
      }
    }
    const current = buckets.get(key);
    if (!current || now - current.createdAt >= windowMs) {
      buckets.set(key, { createdAt: now, count: 1 });
      return true;
    }
    if (current.count >= maxRequests) return false;
    current.count += 1;
    return true;
  };
};

const canAcceptErrorReport = makeRateLimiter(60_000, 20);
const canAcceptApiCall = makeRateLimiter(60_000, 90);

const redactReportText = (value) => String(value || "")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
  .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g, "[REDACTED_JWT]")
  .replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|sk_[A-Za-z0-9_-]+)\b/g, "[REDACTED_KEY]")
  .replace(/([?&#](?:access_token|refresh_token|token|code)=)[^&#\s]+/gi, "$1[REDACTED]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
  .replace(/\+[1-9]\d{9,14}\b/g, "[REDACTED_PHONE]")
  .slice(0, 1200);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/errors", (request, response) => {
  if (!canAcceptErrorReport(request.ip || "unknown")) {
    response.status(429).json({ error: "Too many error reports" });
    return;
  }

  const body = request.body || {};
  const message = redactReportText(body.message);
  if (!message) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  const context = Object.fromEntries(
    Object.entries(body.context || {})
      .slice(0, 8)
      .map(([key, value]) => [String(key).slice(0, 60), redactReportText(value)])
  );
  console.error("[client-error]", JSON.stringify({
    message,
    stack: redactReportText(body.stack),
    context,
    platform: redactReportText(body.platform),
    appVersion: redactReportText(body.appVersion),
    buildNumber: redactReportText(body.buildNumber),
    occurredAt: redactReportText(body.occurredAt),
  }));
  response.status(202).json({ accepted: true });
});

const roomRoleCanPublish = (role, muted, seated = false) => role === "host" || (seated && !muted);
const UUID_PATTERN = /^[a-f0-9-]{36}$/i;
const COUPLE_SEAT_INDEX = 1;
const FIRST_REGULAR_SEAT_INDEX = 2;
const MIC_KICK_MINUTES = 10;

const roomSeatIndexes = (seatCount, coupleSeat) => {
  const lastSeat = Number(seatCount) === 13 ? 13 : 9;
  const seats = [];
  if (coupleSeat) seats.push(COUPLE_SEAT_INDEX);
  for (let seat = FIRST_REGULAR_SEAT_INDEX; seat <= lastSeat; seat += 1) seats.push(seat);
  return seats;
};

const participantSeat = (participant) => {
  const value = Number.parseInt(participant?.attributes?.seat || "", 10);
  return Number.isInteger(value) ? value : null;
};

const sendError = (response, error, fallback) => {
  const message = error?.message || fallback;
  response.status(error?.status || 403).json({ error: message });
};

const supabaseRequest = async (path, bearerToken, options = {}) => {
  const apiKey = options.serviceRole && supabaseServiceRoleKey ? supabaseServiceRoleKey : supabaseKey;
  const authBearer = options.serviceRole && supabaseServiceRoleKey ? supabaseServiceRoleKey : bearerToken;
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${authBearer}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || "Supabase request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
};

const getAccessToken = (request) => {
  const authorization = String(request.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
};

const getAuthenticatedUser = async (request) => {
  if (!canAcceptApiCall(request.ip || "unknown")) {
    const error = new Error("Too many requests");
    error.status = 429;
    throw error;
  }
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }
  const user = await supabaseRequest("/auth/v1/user", accessToken);
  return { accessToken, user };
};

const joinRoomMembership = async (accessToken, roomId) => {
  const result = await supabaseRequest("/rest/v1/rpc/join_room", accessToken, {
    method: "POST",
    body: JSON.stringify({ p_room_id: roomId }),
  });
  return result?.[0];
};

const applyLiveKitPermission = async (roomId, identity, role, muted, seat) => {
  let seated = seat !== undefined ? seat !== null : false;
  if (seat === undefined) {
    const participant = await liveKitService.getParticipant(roomId, identity).catch(() => null);
    seated = participantSeat(participant) !== null;
  }
  const options = {
    permission: {
      canPublish: roomRoleCanPublish(role, muted, seated),
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
    },
  };
  if (seat !== undefined) options.attributes = { seat: seat === null ? "" : String(seat) };
  await liveKitService.updateParticipant(roomId, identity, options);
};

const muteParticipantTracks = async (roomId, identity, muted) => {
  const participant = await liveKitService.getParticipant(roomId, identity).catch(() => null);
  if (!participant) return;
  await Promise.all((participant.tracks || []).map((track) => liveKitService.mutePublishedTrack(roomId, identity, track.sid, muted)));
};

const handleIssueToken = async (request, response) => {
  const { name, roomName, excludeProviders } = request.body || {};
  const cleanName = String(name || "").trim();
  const cleanRoomName = String(roomName || "").trim();
  const rawExclude = Array.isArray(excludeProviders)
    ? excludeProviders.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!cleanName || !cleanRoomName) {
    response.status(400).json({ error: "name and roomName are required" });
    return;
  }
  if (!UUID_PATTERN.test(cleanRoomName) || cleanName.length > 128) {
    response.status(400).json({ error: "roomName must be a valid room id" });
    return;
  }

  try {
    const { accessToken, user } = await getAuthenticatedUser(request);
    const membership = await joinRoomMembership(accessToken, cleanRoomName);
    if (!membership?.role) throw new Error("Room membership could not be created");

    let role = membership.role;
    let muted = Boolean(membership.is_muted);
    let seat = role === "host" ? 0 : null;
    let agoraUid = 1;

    if (supabaseServiceRoleKey) {
      const allocRows = await supabaseRequest("/rest/v1/rpc/allocate_voice_session_server", accessToken, {
        method: "POST",
        serviceRole: true,
        body: JSON.stringify({
          p_room_id: cleanRoomName,
          p_user_id: user.id,
          p_configured_providers: ["livekit"],
          p_exclude_providers: rawExclude,
        }),
      });
      const alloc = allocRows?.[0];
      if (alloc) {
        const isHost = Boolean(alloc.is_host);
        role = isHost ? "host" : String(alloc.role || role);
        muted = isHost ? false : Boolean(alloc.is_muted);
        seat = isHost ? 0 : (typeof alloc.seat_index === "number" ? alloc.seat_index : null);
        agoraUid = Number(alloc.agora_uid) || 1;
      }
    } else {
      const memberRows = await supabaseRequest(
        `/rest/v1/room_members?room_id=eq.${cleanRoomName}&user_id=eq.${user.id}&select=seat_index`,
        accessToken,
        { method: "GET" }
      ).catch(() => []);
      if (role !== "host" && typeof memberRows?.[0]?.seat_index === "number") {
        seat = memberRows[0].seat_index;
      }
    }

    const profileRows = await supabaseRequest(
      `/rest/v1/profiles?id=eq.${user.id}&select=display_name`,
      accessToken,
      { method: "GET" }
    ).catch(() => []);
    const verifiedName = String(profileRows?.[0]?.display_name || cleanName || "Sora kullanıcısı").trim().slice(0, 64);

    const canPublish = roomRoleCanPublish(role, muted, seat !== null);
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user.id,
      name: verifiedName,
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
    const jwt = await token.toJwt();
    response.json({
      provider: "livekit",
      serverUrl: process.env.LIVEKIT_URL,
      token: jwt,
      roomId: cleanRoomName,
      agoraUid,
      role,
      muted,
      seat,
      canPublish,
    });
  } catch (error) {
    console.error("Room token request failed:", error.message);
    response.status(error.status || 403).json({ error: error.message || "Unable to join this room" });
  }
};

app.post("/token", handleIssueToken);
app.post("/voice/session", handleIssueToken);

app.post("/voice/heartbeat", async (request, response) => {
  const roomId = String(request.body?.roomId || request.body?.roomName || "").trim();
  const ended = Boolean(request.body?.ended);
  const failedProvider = request.body?.failedProvider ? String(request.body.failedProvider).trim() : null;
  const errorText = request.body?.errorText ? String(request.body.errorText).trim() : null;
  if (!UUID_PATTERN.test(roomId)) {
    response.status(400).json({ error: "Invalid room id" });
    return;
  }
  try {
    const { accessToken } = await getAuthenticatedUser(request);
    const data = await supabaseRequest("/rest/v1/rpc/heartbeat_voice_session", accessToken, {
      method: "POST",
      body: JSON.stringify({
        p_room_id: roomId,
        p_ended: ended,
        p_failed_provider: failedProvider,
        p_error_text: errorText,
      }),
    });
    response.json(data || { ok: true });
  } catch (error) {
    sendError(response, error, "Heartbeat failed");
  }
});

app.post("/rooms/:roomId/moderate", async (request, response) => {
  const roomId = String(request.params.roomId || "").trim();
  const targetUserId = String(request.body?.targetUserId || "").trim();
  const action = String(request.body?.action || "").trim();
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(targetUserId)) {
    response.status(400).json({ error: "Invalid room or participant" });
    return;
  }
  try {
    const { accessToken } = await getAuthenticatedUser(request);
    const result = await supabaseRequest("/rest/v1/rpc/manage_room_member", accessToken, {
      method: "POST",
      body: JSON.stringify({ p_room_id: roomId, p_target_user_id: targetUserId, p_action: action }),
    });
    const membership = result?.[0];
    if (!membership) throw new Error("Moderation action failed");
    if (action === "remove") {
      await liveKitService.removeParticipant(roomId, targetUserId).catch(() => undefined);
    } else {
      const seat = action === "demote_listener" ? null : undefined;
      if (action === "demote_listener") {
        await supabaseRequest("/rest/v1/rpc/commit_room_seat", accessToken, {
          method: "POST",
          body: JSON.stringify({ p_room_id: roomId, p_target_user_id: targetUserId, p_seat_index: null }),
        }).catch(() => undefined);
      }
      await applyLiveKitPermission(roomId, targetUserId, membership.role, membership.is_muted, seat).catch(() => undefined);
      if (["mute", "demote_listener"].includes(action)) await muteParticipantTracks(roomId, targetUserId, true);
    }
    response.json({ membership });
  } catch (error) {
    response.status(error.status || 403).json({ error: error.message || "Moderation action failed" });
  }
});

const listSeatedParticipants = async (roomId) => {
  const participants = await liveKitService.listParticipants(roomId).catch(() => []);
  return participants.map((participant) => ({
    identity: participant.identity,
    seat: participantSeat(participant),
  }));
};

app.post("/rooms/:roomId/seat", async (request, response) => {
  const roomId = String(request.params.roomId || "").trim();
  const action = String(request.body?.action || "").trim();
  const rawTarget = request.body?.targetUserId ? String(request.body.targetUserId).trim() : null;
  const requestedSeat = request.body?.seatIndex === undefined || request.body?.seatIndex === null
    ? null
    : Number.parseInt(request.body.seatIndex, 10);
  if (!UUID_PATTERN.test(roomId) || (rawTarget && !UUID_PATTERN.test(rawTarget))) {
    response.status(400).json({ error: "Invalid room or participant" });
    return;
  }
  if (!["take", "leave", "assign", "kick", "reject"].includes(action)) {
    response.status(400).json({ error: "Unsupported seat action" });
    return;
  }
  try {
    const { accessToken } = await getAuthenticatedUser(request);
    const result = await supabaseRequest("/rest/v1/rpc/authorize_room_seat", accessToken, {
      method: "POST",
      body: JSON.stringify({ p_room_id: roomId, p_action: action, p_target_user_id: rawTarget }),
    });
    const seatAuth = result?.[0];
    if (!seatAuth?.target_user_id) throw new Error("Seat action failed");
    const targetId = seatAuth.target_user_id;

    if (action === "reject") {
      response.json({ ok: true });
      return;
    }

    if (action === "leave" || action === "kick") {
      await supabaseRequest("/rest/v1/rpc/commit_room_seat", accessToken, {
        method: "POST",
        body: JSON.stringify({ p_room_id: roomId, p_target_user_id: targetId, p_seat_index: null }),
      }).catch(() => undefined);
      if (targetId !== seatAuth.host_id) {
        await applyLiveKitPermission(roomId, targetId, seatAuth.target_role, seatAuth.target_muted, null).catch(() => undefined);
        await muteParticipantTracks(roomId, targetId, true).catch(() => undefined);
      }
      response.json({
        ok: true,
        seat: null,
        micBannedMinutes: action === "kick" ? MIC_KICK_MINUTES : 0,
      });
      return;
    }

    if (targetId === seatAuth.host_id) {
      await supabaseRequest("/rest/v1/rpc/commit_room_seat", accessToken, {
        method: "POST",
        body: JSON.stringify({ p_room_id: roomId, p_target_user_id: targetId, p_seat_index: 0 }),
      }).catch(() => undefined);
      response.json({ ok: true, seat: 0 });
      return;
    }

    const participants = await listSeatedParticipants(roomId);
    if (!participants.some((participant) => participant.identity === targetId)) {
      const error = new Error("Participant is not connected");
      error.status = 409;
      throw error;
    }
    const validSeats = roomSeatIndexes(seatAuth.seat_count, seatAuth.couple_seat);
    const occupied = new Map(
      participants
        .filter((participant) => participant.seat !== null && participant.identity !== targetId)
        .map((participant) => [participant.seat, participant.identity]),
    );
    let seat = requestedSeat;
    if (seat !== null) {
      if (!validSeats.includes(seat)) {
        const error = new Error("Invalid seat");
        error.status = 400;
        throw error;
      }
      if (occupied.has(seat)) {
        const error = new Error("Seat is taken");
        error.status = 409;
        throw error;
      }
    } else {
      seat = validSeats.find((index) => index >= FIRST_REGULAR_SEAT_INDEX && !occupied.has(index))
        ?? validSeats.find((index) => !occupied.has(index))
        ?? null;
      if (seat === null) {
        const error = new Error("No free seat");
        error.status = 409;
        throw error;
      }
    }

    const committed = await supabaseRequest("/rest/v1/rpc/commit_room_seat", accessToken, {
      method: "POST",
      body: JSON.stringify({
        p_room_id: roomId,
        p_target_user_id: targetId,
        p_seat_index: seat,
        p_valid_seats: validSeats,
      }),
    });
    const finalSeat = Number(committed);
    await applyLiveKitPermission(roomId, targetId, seatAuth.target_role, seatAuth.target_muted, finalSeat);
    response.json({ ok: true, seat: finalSeat });
  } catch (error) {
    sendError(response, error, "Seat action failed");
  }
});

app.post("/rooms/:roomId/ban", async (request, response) => {
  const roomId = String(request.params.roomId || "").trim();
  const targetUserId = String(request.body?.targetUserId || "").trim();
  const minutes = request.body?.minutes === null || request.body?.minutes === undefined
    ? null
    : Number.parseInt(request.body.minutes, 10);
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(targetUserId) || (minutes !== null && !(minutes > 0))) {
    response.status(400).json({ error: "Invalid ban request" });
    return;
  }
  try {
    const { accessToken } = await getAuthenticatedUser(request);
    const result = await supabaseRequest("/rest/v1/rpc/ban_room_member", accessToken, {
      method: "POST",
      body: JSON.stringify({ p_room_id: roomId, p_target_user_id: targetUserId, p_minutes: minutes }),
    });
    const membership = result?.[0];
    if (!membership) throw new Error("Ban failed");
    await liveKitService.removeParticipant(roomId, targetUserId).catch(() => undefined);
    response.json({ membership });
  } catch (error) {
    sendError(response, error, "Ban failed");
  }
});

app.post("/rooms/:roomId/layout", async (request, response) => {
  const roomId = String(request.params.roomId || "").trim();
  const seatCount = Number.parseInt(request.body?.seatCount, 10);
  const coupleSeat = Boolean(request.body?.coupleSeat);
  if (!UUID_PATTERN.test(roomId) || ![9, 13].includes(seatCount)) {
    response.status(400).json({ error: "Invalid layout" });
    return;
  }
  try {
    const { accessToken } = await getAuthenticatedUser(request);
    const result = await supabaseRequest("/rest/v1/rpc/update_room_layout", accessToken, {
      method: "POST",
      body: JSON.stringify({ p_room_id: roomId, p_seat_count: seatCount, p_couple_seat: coupleSeat }),
    });
    const room = Array.isArray(result) ? result[0] : result;
    const validList = roomSeatIndexes(seatCount, coupleSeat);
    await supabaseRequest("/rest/v1/rpc/prune_invalid_room_seats", accessToken, {
      method: "POST",
      body: JSON.stringify({ p_room_id: roomId, p_valid_seats: validList }),
    }).catch(() => undefined);

    const validSeats = new Set(validList);
    const participants = await listSeatedParticipants(roomId);
    await Promise.all(
      participants
        .filter((participant) =>
          participant.seat !== null &&
          participant.seat > 0 &&
          participant.identity !== room?.host_id &&
          !validSeats.has(participant.seat)
        )
        .map(async (participant) => {
          await liveKitService.updateParticipant(roomId, participant.identity, {
            attributes: { seat: "" },
            permission: { canPublish: false, canSubscribe: true, canPublishData: true, roomAdmin: false },
          }).catch(() => undefined);
          await muteParticipantTracks(roomId, participant.identity, true).catch(() => undefined);
        }),
    );
    response.json({ room });
  } catch (error) {
    sendError(response, error, "Layout update failed");
  }
});

app.post("/rooms/presence", async (request, response) => {
  const rooms = Array.isArray(request.body?.rooms) ? request.body.rooms.slice(0, 50) : [];
  try {
    await getAuthenticatedUser(request);
    const wanted = rooms.filter((room) => UUID_PATTERN.test(String(room?.roomId)) && UUID_PATTERN.test(String(room?.hostId)));
    if (!wanted.length) {
      response.json({ liveRoomIds: [] });
      return;
    }
    const activeRooms = await liveKitService.listRooms(wanted.map((room) => room.roomId)).catch(() => []);
    const activeNames = new Set(activeRooms.filter((room) => room.numParticipants > 0).map((room) => room.name));
    const liveRoomIds = wanted
      .filter((room) => activeNames.has(room.roomId))
      .map((room) => room.roomId);
    response.json({ liveRoomIds });
  } catch (error) {
    sendError(response, error, "Presence lookup failed");
  }
});

const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Sora token server listening on ${host}:${port}`);
});
