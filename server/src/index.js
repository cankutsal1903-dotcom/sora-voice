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

const roomRoleCanPublish = (role, muted) => ["host", "moderator", "speaker"].includes(role) && !muted;
const roomRoleIsStaff = (role) => ["host", "moderator"].includes(role);

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

const applyLiveKitPermission = async (roomId, identity, role, muted) => {
  await liveKitService.updateParticipant(roomId, identity, {
    permission: {
      canPublish: roomRoleCanPublish(role, muted),
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: roomRoleIsStaff(role),
    },
  });
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
    if (!membership) throw new Error("Room membership could not be created");
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user.id,
      name: cleanName,
      ttl: "10m",
    });
    token.addGrant({
      roomJoin: true,
      room: cleanRoomName,
      canPublish: roomRoleCanPublish(membership.role, membership.is_muted),
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: roomRoleIsStaff(membership.role),
    });
    response.json({ serverUrl: process.env.LIVEKIT_URL, token: await token.toJwt(), role: membership.role, muted: membership.is_muted });
  } catch (error) {
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
      await applyLiveKitPermission(roomId, targetUserId, membership.role, membership.is_muted).catch(() => undefined);
      if (["mute", "demote_listener"].includes(action)) await muteParticipantTracks(roomId, targetUserId, true);
    }
    response.json({ membership });
  } catch (error) {
    response.status(error.status || 403).json({ error: error.message || "Moderation action failed" });
  }
});

const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Sora token server listening on ${host}:${port}`);
});
