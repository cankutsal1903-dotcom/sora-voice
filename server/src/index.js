import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const requiredEnvironment = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
}

// .env.example / .env dosyalarindaki ornek degerlerin sessizce kullanilmasini engeller.
// Aksi halde sunucu ayakta gorunur ama her /token istegi LiveKit hatasi verir.
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
const port = Number(process.env.PORT || 3001);
const liveKitServiceUrl = process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const liveKitService = new RoomServiceClient(liveKitServiceUrl, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed"));
  },
}));
app.use(express.json({ limit: "10kb" }));

const errorReportWindows = new Map();
const ERROR_REPORT_WINDOW_MS = 60_000;
const MAX_ERROR_REPORTS_PER_WINDOW = 20;
const redactReportText = (value) => String(value || "")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
  .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g, "[REDACTED_JWT]")
  .replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|sk_[A-Za-z0-9_-]+)\b/g, "[REDACTED_KEY]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
  .slice(0, 1200);

const canAcceptErrorReport = (ip) => {
  const now = Date.now();
  const window = errorReportWindows.get(ip);
  if (!window || now - window.createdAt >= ERROR_REPORT_WINDOW_MS) {
    errorReportWindows.set(ip, { createdAt: now, count: 1 });
    return true;
  }
  if (window.count >= MAX_ERROR_REPORTS_PER_WINDOW) return false;
  window.count += 1;
  return true;
};

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

// Oda sahibi her zaman 1 numaralı koltuktadır; diğer kullanıcılar yalnızca
// bir koltuğa oturtulduklarında (LiveKit "seat" özniteliği) yayın yapabilir.
const roomRoleCanPublish = (role, muted, seated = false) => role === "host" || (seated && !muted);
const roomRoleIsStaff = (role) => ["host", "moderator"].includes(role);
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

const supabaseRequest = async (path, accessToken, options = {}) => {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
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

app.post("/token", async (request, response) => {
  const { name, roomName } = request.body || {};
  const cleanName = String(name || "").trim();
  const cleanRoomName = String(roomName || "").trim();

  if (!cleanName || !cleanRoomName) {
    response.status(400).json({ error: "name and roomName are required" });
    return;
  }

  const invalidRoomName = !/^[a-f0-9-]{36}$/i.test(cleanRoomName);

  if (invalidRoomName || cleanName.length > 128) {
    response.status(400).json({ error: "roomName must be a valid room id" });
    return;
  }

  try {
    const { accessToken, user } = await getAuthenticatedUser(request);
    const membership = await joinRoomMembership(accessToken, cleanRoomName);
    if (!membership?.role) throw new Error("Room membership could not be created");
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user.id,
      name: cleanName,
      ttl: "10m",
    });
    token.addGrant({
      roomJoin: true,
      room: cleanRoomName,
      canPublish: roomRoleCanPublish(membership.role, membership.is_muted, false),
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
    });
    const jwt = await token.toJwt();
    console.info("Room token issued");
    response.json({
      serverUrl: process.env.LIVEKIT_URL,
      token: jwt,
      role: membership.role,
      muted: membership.is_muted,
      canPublish: roomRoleCanPublish(membership.role, membership.is_muted, false),
    });
  } catch (error) {
    console.error("Room token request failed:", error.message);
    response.status(error.status || 403).json({ error: error.message || "Unable to join this room" });
  }
});

app.post("/rooms/:roomId/moderate", async (request, response) => {
  const roomId = String(request.params.roomId || "").trim();
  const targetUserId = String(request.body?.targetUserId || "").trim();
  const action = String(request.body?.action || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(roomId) || !/^[a-f0-9-]{36}$/i.test(targetUserId)) {
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
      await liveKitService.removeParticipant(roomId, targetUserId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }).catch(() => undefined);
    } else {
      const seat = action === "demote_listener" ? null : undefined;
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

// Koltuk işlemleri: take (yönetici/oda sahibi kendisi oturur), leave,
// assign (istek onayı / mikrofona davet), kick (10 dk mikrofon yasağı),
// reject (isteği reddet).
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
      seat = validSeats.find((index) => index >= FIRST_REGULAR_SEAT_INDEX && !occupied.has(index)) ?? null;
      if (seat === null) {
        const error = new Error("No free seat");
        error.status = 409;
        throw error;
      }
    }
    await applyLiveKitPermission(roomId, targetId, seatAuth.target_role, seatAuth.target_muted, seat);
    response.json({ ok: true, seat });
  } catch (error) {
    sendError(response, error, "Seat action failed");
  }
});

// Süreli oda banı. minutes null => kalıcı.
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
    await liveKitService
      .removeParticipant(roomId, targetUserId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) })
      .catch(() => undefined);
    response.json({ membership });
  } catch (error) {
    sendError(response, error, "Ban failed");
  }
});

// Mikrofon sayısı / çift koltuğu. Kapanan koltuklardaki kullanıcılar indirilir.
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
    const validSeats = new Set(roomSeatIndexes(seatCount, coupleSeat));
    const participants = await listSeatedParticipants(roomId);
    await Promise.all(
      participants
        .filter((participant) => participant.seat !== null && !validSeats.has(participant.seat))
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

// Keşfet: uygulaması arka planda olduğu için kalp atışı gecikmiş odaların
// sahibinin LiveKit'te hâlâ bağlı olup olmadığını döndürür.
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
    const liveRoomIds = [];
    await Promise.all(
      wanted
        .filter((room) => activeNames.has(room.roomId))
        .map(async (room) => {
          const host = await liveKitService.getParticipant(room.roomId, room.hostId).catch(() => null);
          if (host) liveRoomIds.push(room.roomId);
        }),
    );
    response.json({ liveRoomIds });
  } catch (error) {
    sendError(response, error, "Presence lookup failed");
  }
});

const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Sora token server listening on ${host}:${port}`);
});
