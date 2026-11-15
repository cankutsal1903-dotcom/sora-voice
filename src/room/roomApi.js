import { supabase } from "../auth/supabase";

const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");

export const ROOM_BAN_DURATIONS = [
  { label: "10 dakika", minutes: 10 },
  { label: "1 saat", minutes: 60 },
  { label: "1 gün", minutes: 1440 },
  { label: "7 gün", minutes: 10080 },
  { label: "Kalıcı", minutes: null },
];

export const DEFAULT_ROOM_ANNOUNCEMENT = "Hoşgeldin";
export const COUPLE_SEAT_INDEX = 1;
export const FIRST_REGULAR_SEAT_INDEX = 2;

const requireClient = () => {
  if (!supabase) throw new Error("Supabase yapılandırılmadı.");
  return supabase;
};

const throwIfError = (error) => {
  if (error) throw error;
};

const firstRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

const callTokenServer = async (path, { accessToken, body }) => {
  if (!tokenServerUrl) throw new Error("Canlı ses sunucusu yapılandırılmadı.");
  if (!accessToken) throw new Error("Oturum bulunamadı.");
  const response = await fetch(`${tokenServerUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "İşlem tamamlanamadı.");
  return payload;
};

// Sunucu / veritabanı hatalarını kullanıcıya gösterilecek Türkçe metne çevirir.
export const describeRoomError = (error, fallback = "Bağlantını kontrol edip tekrar dene.") => {
  const message = String(error?.message || "");
  const until = message.match(/until (.+)$/)?.[1];
  if (message.includes("Mic banned")) {
    return `Mikrofondan indirildin. ${until ? `${until.slice(-5)} saatine` : "10 dakika"} kadar mikrofona çıkamazsın.`;
  }
  if (message.includes("Room ban active")) return `Bu odadan ${until || "bir süre"} tarihine kadar uzaklaştırıldın.`;
  if (message.includes("You were removed")) return "Bu odadan uzaklaştırıldın.";
  if (message.includes("Room password required")) return "Bu oda şifreli. Girmek için 4 haneli şifreyi yaz.";
  if (message.includes("Room password incorrect")) return "Şifre yanlış.";
  if (message.includes("Too many password attempts")) return "Çok fazla yanlış deneme yaptın. 15 dakika sonra tekrar dene.";
  if (message.includes("Password must be 4 digits")) return "Şifre 4 haneli bir sayı olmalı.";
  if (message.includes("No free seat")) return "Boş mikrofon kalmadı.";
  if (message.includes("Seat is taken")) return "Bu mikrofon dolu.";
  if (message.includes("Participant is not connected")) return "Kullanıcı şu an odada değil.";
  if (message.includes("Seat approval required")) return "Mikrofona çıkmak için istek göndermelisin.";
  if (message.includes("Moderators cannot change each other")) return "Yöneticiler birbirini yönetemez.";
  if (message.includes("Moderator permission required")) return "Bu işlem için yönetici yetkisi gerekiyor.";
  if (message.includes("Only the host") || message.includes("Only the room owner")) return "Bu işlemi yalnızca oda sahibi yapabilir.";
  if (message.includes("This member cannot be changed")) return "Bu kullanıcı üzerinde işlem yapılamaz.";
  if (message.includes("Background changes are disabled")) return "Arka plan değiştirme şu an kapalı.";
  if (message.includes("blocked language")) return "Metin topluluk kurallarına aykırı bir ifade içeriyor.";
  if (message.includes("Title too long")) return "Oda adı en fazla 36 karakter olabilir.";
  if (message.includes("Description too long")) return "Açıklama en fazla 180 karakter olabilir.";
  if (message.includes("Announcement too long")) return "Duyuru en fazla 200 karakter olabilir.";
  if (message.includes("Room is locked")) return "Oda sahibi mikrofon sırasını kapattı.";
  if (message.includes("Room is unavailable")) return "Bu oda şu an kullanılamıyor.";
  if (message.includes("Payload too large") || message.includes("exceeded the maximum")) return "Dosya çok büyük.";
  if (message.includes("mime type") || message.includes("invalid_mime_type")) return "Bu dosya türü desteklenmiyor.";
  return fallback;
};

// ── Koltuk / yönetim (token sunucusu) ─────────────────────────────────────
export const performSeatAction = ({ roomId, action, seatIndex = null, targetUserId = null, accessToken }) =>
  callTokenServer(`/rooms/${roomId}/seat`, {
    accessToken,
    body: { action, seatIndex, targetUserId },
  });

export const banRoomMember = ({ roomId, targetUserId, minutes, accessToken }) =>
  callTokenServer(`/rooms/${roomId}/ban`, {
    accessToken,
    body: { targetUserId, minutes },
  });

export const updateRoomLayout = async ({ roomId, seatCount, coupleSeat, accessToken }) => {
  const payload = await callTokenServer(`/rooms/${roomId}/layout`, {
    accessToken,
    body: { seatCount, coupleSeat },
  });
  return payload.room || null;
};

export const fetchHostPresence = async ({ rooms, accessToken }) => {
  if (!tokenServerUrl || !accessToken || !rooms.length) return [];
  const payload = await callTokenServer("/rooms/presence", {
    accessToken,
    body: { rooms: rooms.map((room) => ({ roomId: room.id, hostId: room.hostId })) },
  });
  return Array.isArray(payload.liveRoomIds) ? payload.liveRoomIds : [];
};

// ── Supabase RPC'leri ─────────────────────────────────────────────────────
export const joinRoomWithPassword = async (roomId, password) => {
  const client = requireClient();
  const { data, error } = await client.rpc("join_room", { p_room_id: roomId, p_password: password || null });
  throwIfError(error);
  const membership = firstRow(data);
  if (!membership?.role) throw new Error("Room password incorrect");
  return membership;
};

export const leaveRoomMembership = async (roomId) => {
  const client = requireClient();
  const { error } = await client.rpc("leave_room", { p_room_id: roomId });
  throwIfError(error);
};

export const updateRoomDetails = async ({ roomId, title, description, announcement }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("update_room_details", {
    p_room_id: roomId,
    p_title: title ?? null,
    p_description: description ?? null,
    p_announcement: announcement ?? null,
  });
  throwIfError(error);
  return firstRow(data);
};

export const setRoomPassword = async ({ roomId, password }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("set_room_password", {
    p_room_id: roomId,
    p_password: password || null,
  });
  throwIfError(error);
  return firstRow(data);
};

export const setRoomMusic = async ({ roomId, state }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("set_room_music", {
    p_room_id: roomId,
    p_state: state || null,
  });
  throwIfError(error);
  return firstRow(data);
};

export const getBackgroundUploadsEnabled = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", "room_background_uploads_enabled")
    .maybeSingle();
  if (error) return false;
  return data?.value === true;
};

export const getLatestBackgroundRequest = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("room_background_requests")
    .select("id, status, review_note, created_at, reviewed_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
};

export const clearRoomBackground = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("clear_room_background", { p_room_id: roomId });
  throwIfError(error);
  return firstRow(data);
};

const safeFileName = (name, fallbackExtension) => {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-60);
  const hasExtension = /\.[A-Za-z0-9]{2,5}$/.test(base);
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${random}${hasExtension ? `-${base}` : `.${fallbackExtension}`}`;
};

const readFileBytes = (uri) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.response && xhr.response.byteLength >= 0) {
        resolve(xhr.response);
      } else {
        reject(new Error("Dosya okunamadı."));
      }
    };
    xhr.onerror = () => reject(new Error("Dosya okunamadı."));
    xhr.responseType = "arraybuffer";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });

export const uploadProfileAvatar = async ({ userId, asset }) => {
  const client = requireClient();
  const mimeType = asset.mimeType || "image/jpeg";
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/${safeFileName(null, extension)}`;
  const bytes = await readFileBytes(asset.uri);
  const { error: uploadError } = await client.storage
    .from("avatars")
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  throwIfError(uploadError);
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = data?.publicUrl;
  const { error } = await client.from("profiles").update({ avatar_url: avatarUrl }).eq("id", userId);
  throwIfError(error);
  return avatarUrl;
};

export const FAMILY_AVATAR_MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_FAMILY_AVATAR_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const validateFamilyAvatarAsset = (asset, byteLength = null) => {
  if (!asset?.uri) {
    throw new Error("Görsel seçilemedi.");
  }
  const rawMime = String(asset.mimeType || "image/jpeg").toLowerCase().trim();
  const normalizedMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  if (!ALLOWED_FAMILY_AVATAR_MIMES.has(normalizedMime)) {
    throw new Error("Yalnızca JPEG, PNG veya WebP görselleri yüklenebilir.");
  }
  const reportedSize = typeof asset.fileSize === "number" ? asset.fileSize : null;
  if (reportedSize !== null && reportedSize > FAMILY_AVATAR_MAX_BYTES) {
    throw new Error("Aile profil fotoğrafı en fazla 3 MB olabilir.");
  }
  if (byteLength !== null) {
    if (byteLength <= 0) throw new Error("Seçilen görsel okunamadı.");
    if (byteLength > FAMILY_AVATAR_MAX_BYTES) {
      throw new Error("Aile profil fotoğrafı en fazla 3 MB olabilir.");
    }
  }
  const extension = normalizedMime === "image/png" ? "png" : normalizedMime === "image/webp" ? "webp" : "jpg";
  return { mimeType: normalizedMime, extension };
};

export const uploadFamilyAvatar = async ({ userId, asset }) => {
  if (!userId) throw new Error("Oturum bulunamadı.");
  const client = requireClient();
  const initialCheck = validateFamilyAvatarAsset(asset);
  const bytes = await readFileBytes(asset.uri);
  const { mimeType, extension } = validateFamilyAvatarAsset(asset, bytes.byteLength);
  const path = `${userId}/${safeFileName(asset.fileName || null, initialCheck.extension || extension)}`;
  const { error: uploadError } = await client.storage
    .from("family-avatars")
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  throwIfError(uploadError);
  const { data } = client.storage.from("family-avatars").getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error("Fotoğraf bağlantısı oluşturulamadı.");
  }
  return data.publicUrl;
};

export const removeProfileAvatar = async ({ userId }) => {
  const client = requireClient();
  const { error } = await client.from("profiles").update({ avatar_url: null }).eq("id", userId);
  throwIfError(error);
};

export const uploadRoomBackground = async ({ roomId, asset }) => {
  const client = requireClient();
  const mimeType = asset.mimeType || "image/jpeg";
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const path = `${roomId}/${safeFileName(null, extension)}`;
  const bytes = await readFileBytes(asset.uri);
  const { error: uploadError } = await client.storage
    .from("room-backgrounds")
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  throwIfError(uploadError);
  const { data, error } = await client.rpc("submit_room_background", {
    p_room_id: roomId,
    p_image_path: path,
  });
  throwIfError(error);
  return firstRow(data);
};

export const uploadRoomMusic = async ({ roomId, asset }) => {
  const client = requireClient();
  const mimeType = asset.mimeType || "audio/mpeg";
  const path = `${roomId}/${safeFileName(asset.name, "mp3")}`;
  const bytes = await readFileBytes(asset.uri);
  const { error } = await client.storage
    .from("room-music")
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  throwIfError(error);
  return path;
};

const signedUrlCache = new Map();

// Yüklenen dosya adından okunur başlık üretir: "1731..-abc123-Sarki_Adi.mp3" → "Sarki Adi"
export const musicTitleFromPath = (path) => {
  const fileName = String(path || "").split("/").pop() || "";
  const withoutPrefix = fileName.replace(/^\d+-[a-z0-9]+-?/i, "");
  const withoutExtension = withoutPrefix.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  return withoutExtension.replace(/_/g, " ").trim() || "Müzik";
};

export const listRoomMusic = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client.storage
    .from("room-music")
    .list(roomId, { limit: 60, sortBy: { column: "created_at", order: "desc" } });
  throwIfError(error);
  return (data || [])
    .filter((item) => item?.name && !item.name.startsWith("."))
    .map((item) => {
      const path = `${roomId}/${item.name}`;
      return { path, title: musicTitleFromPath(path), size: item.metadata?.size || 0 };
    });
};

export const deleteRoomMusic = async (path) => {
  const client = requireClient();
  const { error } = await client.storage.from("room-music").remove([path]);
  throwIfError(error);
};

export const getSignedRoomFileUrl = async (bucket, path, expiresIn = 3600) => {
  if (!path) return null;
  const key = `${bucket}/${path}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  const client = requireClient();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
  throwIfError(error);
  signedUrlCache.set(key, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
  return data.signedUrl;
};
