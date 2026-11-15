import { supabase } from "../auth/supabase";
import { fetchHostPresence } from "../room/roomApi";

const FALLBACK_COLORS = ["#5140BD", "#252458"];
const ROOM_SELECT = "*, profiles!rooms_host_id_fkey(display_name, handle, avatar_color, avatar_url)";

const requireClient = () => {
  if (!supabase) throw new Error("Supabase yapılandırılmadı.");
  return supabase;
};

const throwIfError = (error) => {
  if (error) throw error;
};

const profileFromJoin = (profile) => Array.isArray(profile) ? profile[0] : profile;

export const mapRoom = (room) => {
  const host = profileFromJoin(room.profiles);
  return {
    id: room.id,
    hostId: room.host_id,
    host: host?.display_name || "Sora kullanıcısı",
    hostAvatarUrl: host?.avatar_url || null,
    initials: (host?.display_name || "S").charAt(0).toUpperCase(),
    title: room.title,
    description: room.description,
    category: room.category,
    listeners: room.listener_count,
    colors: Array.isArray(room.theme_colors) ? room.theme_colors : FALLBACK_COLORS,
    accent: room.accent_color,
    roomLocked: room.room_locked,
    chatLocked: room.chat_locked,
    announcement: room.announcement || "Hoşgeldin",
    passwordProtected: Boolean(room.password_protected),
    seatCount: room.seat_count === 13 ? 13 : 9,
    coupleSeat: Boolean(room.couple_seat),
    backgroundPath: room.background_path || null,
    musicState: room.music_state || null,
    startsAt: room.schedule_label || (room.starts_at ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(room.starts_at)) : "Yakında"),
    startsAtIso: room.starts_at || null,
    userCreated: true,
    persisted: true,
    state: room.state,
  };
};

export const listRooms = async (state = "live") => {
  const client = requireClient();
  const query = client
    .from("rooms")
    .select(ROOM_SELECT)
    .eq("state", state)
    .order(state === "scheduled" ? "starts_at" : "created_at", { ascending: state === "scheduled", nullsFirst: false });
  if (state === "live") {
    // Uygulaması arka planda olan oda sahiplerinin kalp atışı gecikebilir;
    // bu odalar LiveKit'te sahip hâlâ bağlıysa keşfette kalır.
    query.gte("last_active_at", new Date(Date.now() - 12 * 60 * 60_000).toISOString());
  }
  const [{ data, error }, { data: blocks, error: blocksError }] = await Promise.all([
    query,
    client.from("user_blocks").select("blocked_id"),
  ]);
  throwIfError(error);
  const blockedIds = new Set(blocksError ? [] : (blocks || []).map((block) => block.blocked_id));
  let visibleRows = (data || []).filter((room) => !blockedIds.has(room.host_id));
  if (state === "live") {
    // Uygulama arka plana alındığında Android zamanlayıcıları ve soketleri bekletebilir;
    // oda sahibi gerçekten çıkana kadar (state = 'inactive') aktif odalar keşfette korunur.
    const backgroundGraceSince = Date.now() - 60 * 60_000;
    const staleRows = visibleRows.filter((room) => new Date(room.last_active_at).getTime() < backgroundGraceSince);
    let presentIds = new Set();
    if (staleRows.length) {
      try {
        const { data: sessionData } = await client.auth.getSession();
        const liveIds = await fetchHostPresence({
          rooms: staleRows.map((room) => ({ id: room.id, hostId: room.host_id })),
          accessToken: sessionData?.session?.access_token,
        });
        presentIds = new Set(liveIds);
      } catch {
        presentIds = new Set();
      }
    }
    visibleRows = visibleRows.filter(
      (room) => new Date(room.last_active_at).getTime() >= backgroundGraceSince || presentIds.has(room.id),
    );
  }
  return visibleRows.map(mapRoom);
};

export const createRoom = async ({ room, userId }) => {
  const client = requireClient();
  const { data, error } = await client
    .from("rooms")
    .insert({
      host_id: userId,
      title: room.title,
      description: room.description || "Yeni başlayan bir sohbet.",
      category: room.category,
      theme_colors: room.colors || FALLBACK_COLORS,
      accent_color: room.accent || "#8BB8F5",
      listener_count: room.listeners || 1,
      state: room.state || "live",
      starts_at: room.startsAtIso || null,
      schedule_label: room.startsAt || "",
    })
    .select(ROOM_SELECT)
    .single();
  throwIfError(error);
  return mapRoom(data);
};

export const updateRoom = async (roomId, updates) => {
  const client = requireClient();
  if (typeof updates.roomLocked !== "boolean" && typeof updates.chatLocked !== "boolean") {
    throw new Error("Guncellenecek oda ayari bulunamadi.");
  }
  const { data, error } = await client
    .rpc("update_room_settings", {
      p_room_id: roomId,
      p_room_locked: typeof updates.roomLocked === "boolean" ? updates.roomLocked : null,
      p_chat_locked: typeof updates.chatLocked === "boolean" ? updates.chatLocked : null,
    });
  throwIfError(error);
  return mapRoom(data?.[0] || data);
};

export const getRoom = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("rooms")
    .select(ROOM_SELECT)
    .eq("id", roomId)
    .single();
  throwIfError(error);
  return mapRoom(data);
};

export const deleteRoom = async (roomId) => {
  const client = requireClient();
  const { error } = await client.from("rooms").delete().eq("id", roomId);
  throwIfError(error);
};

export const getHostedRoom = async (userId) => {
  const client = requireClient();
  const { data: liveRoom, error: liveRoomError } = await client
    .from("rooms")
    .select(ROOM_SELECT)
    .eq("host_id", userId)
    .eq("state", "live")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(liveRoomError);
  if (liveRoom) return mapRoom(liveRoom);

  const { data: inactiveRoom, error: inactiveRoomError } = await client
    .from("rooms")
    .select(ROOM_SELECT)
    .eq("host_id", userId)
    .eq("state", "inactive")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(inactiveRoomError);
  return inactiveRoom ? mapRoom(inactiveRoom) : null;
};

export const setRoomPresence = async (roomId, isActive, { resetListeners = false } = {}) => {
  const client = requireClient();
  const patch = isActive
    ? {
        state: "live",
        ...(resetListeners ? { listener_count: 1 } : {}),
        last_active_at: new Date().toISOString(),
      }
    : {
        state: "inactive",
        listener_count: 0,
        last_active_at: new Date().toISOString(),
      };
  const { data, error } = await client
    .from("rooms")
    .update(patch)
    .eq("id", roomId)
    .select(ROOM_SELECT)
    .single();
  throwIfError(error);
  return mapRoom(data);
};

export const startScheduledRoom = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("rooms")
    .update({ state: "live" })
    .eq("id", roomId)
    .eq("state", "scheduled")
    .select(ROOM_SELECT)
    .single();
  throwIfError(error);
  return mapRoom(data);
};

export const listRoomMessages = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("room_messages")
    .select("id, body, kind, created_at, sender_id, sender_name")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(100);
  throwIfError(error);
  return (data || []).reverse().map((message) => ({
    id: message.id,
    userId: message.sender_id,
    user: message.sender_name || "Sora kullanıcısı",
    text: message.body,
    system: message.kind === "system",
    createdAt: message.created_at,
  }));
};

export const sendRoomMessage = async ({ roomId, userId, text }) => {
  const client = requireClient();
  const { data, error } = await client
    .from("room_messages")
    .insert({ room_id: roomId, sender_id: userId, body: text })
    .select("id, body, kind, created_at, sender_id, sender_name")
    .single();
  throwIfError(error);
  return {
    id: data.id,
    userId: data.sender_id,
    user: data.sender_name || "Sora kullanıcısı",
    text: data.body,
    system: data.kind === "system",
    createdAt: data.created_at,
  };
};

export const joinRoomMembership = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("join_room", { p_room_id: roomId });
  throwIfError(error);
  const membership = data?.[0] || null;
  if (!membership?.role) throw new Error("Room membership could not be created");
  return membership;
};

export const listRoomMembers = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("room_members")
    .select("user_id, role, is_muted, removed_at, hand_raised_at, mic_banned_until, profiles!room_members_user_id_fkey(display_name, avatar_color, avatar_url)")
    .eq("room_id", roomId)
    .is("removed_at", null);
  throwIfError(error);
  return (data || []).map((member) => ({
    userId: member.user_id,
    role: member.role,
    isMuted: member.is_muted,
    handRaisedAt: member.hand_raised_at || null,
    micBannedUntil: member.mic_banned_until || null,
    name: profileFromJoin(member.profiles)?.display_name || "Sora kullanıcısı",
    color: profileFromJoin(member.profiles)?.avatar_color || "#7FCBEA",
    avatarUrl: profileFromJoin(member.profiles)?.avatar_url || null,
  }));
};

export const getPublicProfile = async (userId) => {
  if (!userId) return null;
  const client = requireClient();
  const [profileResult, appearanceResult, publicIdResult] = await Promise.all([
    client
      .from("profiles")
      .select("id, handle, display_name, avatar_color, avatar_url, bio")
      .eq("id", userId)
      .maybeSingle(),
    client
      .from("profiles")
      .select("active_frame_id, active_profile_theme_id")
      .eq("id", userId)
      .maybeSingle(),
    client
      .from("profiles")
      .select("public_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const { data, error } = profileResult;
  throwIfError(error);
  if (!data) return null;
  const appearance = appearanceResult.error ? null : appearanceResult.data;
  const publicIdRow = publicIdResult.error ? null : publicIdResult.data;
  return {
    userId: data.id,
    publicId: publicIdRow?.public_id || null,
    handle: data.handle,
    name: data.display_name,
    color: data.avatar_color,
    avatarUrl: data.avatar_url || null,
    bio: data.bio,
    activeFrameId: appearance?.active_frame_id || null,
    activeProfileThemeId: appearance?.active_profile_theme_id || null,
  };
};

export const getFollowCounts = async (userId) => {
  const client = requireClient();
  const [following, followers] = await Promise.all([
    client.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId),
    client.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
  ]);
  throwIfError(following.error);
  throwIfError(followers.error);
  return { following: following.count || 0, followers: followers.count || 0 };
};

export const listFollowedUserIds = async (userId) => {
  const client = requireClient();
  const { data, error } = await client.from("follows").select("following_id").eq("follower_id", userId);
  throwIfError(error);
  return (data || []).map((follow) => follow.following_id);
};

export const setFollowing = async ({ userId, targetUserId, following }) => {
  const client = requireClient();
  if (following) {
    const { error } = await client.from("follows").insert({ follower_id: userId, following_id: targetUserId });
    throwIfError(error);
    return;
  }
  const { error } = await client.from("follows").delete().eq("follower_id", userId).eq("following_id", targetUserId);
  throwIfError(error);
};

export const getWallet = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("wallet_get_or_create");
  throwIfError(error);
  return data?.[0] || { balance: 0, last_daily_reward_at: null };
};

export const listWalletTransactions = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("wallet_transactions")
    .select("id, amount, type, description, created_at")
    .order("created_at", { ascending: false })
    .limit(12);
  throwIfError(error);
  return data || [];
};

export const claimDailyReward = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("claim_daily_reward", { p_amount: 75 });
  throwIfError(error);
  return data?.[0] || { balance: 0, claimed: false };
};

export const spendWalletCredit = async ({ amount, description, metadata = {} }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("spend_wallet_credit", {
    p_amount: amount,
    p_description: description,
    p_metadata: metadata,
  });
  throwIfError(error);
  return data?.[0] || { balance: 0 };
};

const mapBankTransferRequest = (request) => ({
  id: request.id,
  referenceCode: request.reference_code,
  userId: request.user_id,
  requestedCredits: request.requested_credits,
  amountTry: Number(request.amount_try),
  status: request.status,
  creditedCredits: request.credited_credits,
  adminNote: request.admin_note || "",
  createdAt: request.created_at,
  reviewedAt: request.reviewed_at,
  requesterName: request.requester_name || null,
  requesterHandle: request.requester_handle || null,
});

export const listAdminBankTransferRequests = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_list_bank_transfer_requests", { p_status: null });
  throwIfError(error);
  return (data || []).map(mapBankTransferRequest);
};

export const reviewAdminBankTransferRequest = async ({ requestId, approved, creditedCredits = null, adminNote = "" }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_review_bank_transfer_request", {
    p_request_id: requestId,
    p_approved: approved,
    p_credited_credits: creditedCredits,
    p_admin_note: adminNote,
  });
  throwIfError(error);
  return data?.[0] || null;
};

export const listBlockedUsers = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("user_blocks")
    .select("blocked_id, created_at, profiles!user_blocks_blocked_id_fkey(display_name, handle, avatar_color)")
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data || []).map((block) => {
    const profile = profileFromJoin(block.profiles);
    return {
      userId: block.blocked_id,
      name: profile?.display_name || "Sora kullanıcısı",
      handle: profile?.handle || "sora",
      color: profile?.avatar_color || "#5878B4",
      createdAt: block.created_at,
    };
  });
};

export const setUserBlocked = async ({ targetUserId, blocked }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("set_user_block", {
    p_blocked_user_id: targetUserId,
    p_blocked: blocked,
  });
  throwIfError(error);
  return Boolean(data);
};

export const createSafetyReport = async ({ category, details = "", targetUserId = null, roomId = null, messageId = null }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("create_safety_report", {
    p_category: category,
    p_details: details,
    p_target_user_id: targetUserId,
    p_room_id: roomId,
    p_message_id: messageId,
  });
  throwIfError(error);
  return data;
};

export const listMySafetyReports = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("safety_reports")
    .select("id, category, status, details, created_at, rooms(title), profiles!safety_reports_target_user_id_fkey(display_name)")
    .order("created_at", { ascending: false })
    .limit(20);
  throwIfError(error);
  return (data || []).map((report) => ({
    id: report.id,
    category: report.category,
    status: report.status,
    details: report.details,
    createdAt: report.created_at,
    roomTitle: profileFromJoin(report.rooms)?.title || null,
    targetName: profileFromJoin(report.profiles)?.display_name || null,
  }));
};

export const getCurrentAdminRole = async (userId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("app_admins")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data?.role || null;
};

export const getAdminSecurityOverview = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_security_overview");
  throwIfError(error);
  return data?.[0] || { open_reports: 0, reviewing_reports: 0, active_sanctions: 0, blocked_terms: 0 };
};

export const listAdminSafetyReports = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("safety_reports")
    .select("id, category, status, details, resolution, created_at, target_user_id, rooms(title), reporter:profiles!safety_reports_reporter_id_fkey(display_name, handle), target:profiles!safety_reports_target_user_id_fkey(display_name, handle)")
    .order("created_at", { ascending: false })
    .limit(100);
  throwIfError(error);
  return (data || []).map((report) => ({
    id: report.id,
    category: report.category,
    status: report.status,
    details: report.details,
    resolution: report.resolution,
    createdAt: report.created_at,
    targetUserId: report.target_user_id,
    roomTitle: profileFromJoin(report.rooms)?.title || null,
    reporterName: profileFromJoin(report.reporter)?.display_name || "Bilinmeyen kullanıcı",
    targetName: profileFromJoin(report.target)?.display_name || null,
  }));
};

export const resolveAdminSafetyReport = async ({ reportId, status, resolution = "", sanctionAction = null, sanctionHours = null }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_resolve_report", {
    p_report_id: reportId,
    p_status: status,
    p_resolution: resolution,
    p_sanction_action: sanctionAction,
    p_sanction_hours: sanctionHours,
  });
  throwIfError(error);
  return data;
};

const mapDirectConversation = (conversation, avatarByUserId = new Map()) => ({
  id: conversation.conversation_id,
  userId: conversation.other_user_id,
  name: conversation.other_display_name || "Sora kullanıcısı",
  handle: conversation.other_handle || "sora",
  color: conversation.other_avatar_color || "#7FCBEA",
  avatarUrl: conversation.other_avatar_url || avatarByUserId.get(conversation.other_user_id) || null,
  lastMessage: conversation.last_message || "Henüz mesaj yok.",
  lastMessageAt: conversation.last_message_at,
});

export const listDirectConversations = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("list_direct_conversations");
  throwIfError(error);
  const rows = data || [];
  const otherUserIds = [...new Set(rows.map((row) => row.other_user_id).filter(Boolean))];
  const avatarByUserId = new Map();
  if (otherUserIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, avatar_url")
      .in("id", otherUserIds);
    (profiles || []).forEach((item) => {
      if (item?.id && item.avatar_url) avatarByUserId.set(item.id, item.avatar_url);
    });
  }
  return rows.map((row) => mapDirectConversation(row, avatarByUserId));
};

export const startDirectConversation = async (handle) => {
  const client = requireClient();
  const { data, error } = await client.rpc("start_direct_conversation", { p_handle: handle });
  throwIfError(error);
  return data;
};

export const listDirectMessages = async ({ conversationId, currentUserId }) => {
  const client = requireClient();
  const { data, error } = await client
    .from("direct_messages")
    .select("id, conversation_id, sender_id, body, created_at, profiles!direct_messages_sender_id_fkey(display_name)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  throwIfError(error);
  return (data || []).map((message) => ({
    id: message.id,
    conversationId: message.conversation_id,
    userId: message.sender_id,
    sender: profileFromJoin(message.profiles)?.display_name || "Sora kullanıcısı",
    text: message.body,
    own: message.sender_id === currentUserId,
    createdAt: message.created_at,
  }));
};

export const sendDirectMessage = async ({ conversationId, userId, text }) => {
  const client = requireClient();
  const { data, error } = await client
    .from("direct_messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body: text })
    .select("id, conversation_id, sender_id, body, created_at")
    .single();
  throwIfError(error);
  return {
    id: data.id,
    conversationId: data.conversation_id,
    userId: data.sender_id,
    text: data.body,
    own: true,
    createdAt: data.created_at,
  };
};

export const subscribeToDirectMessages = ({ conversationId, onMessage }) => {
  const client = requireClient();
  const channel = client
    .channel(`direct-messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages", filter: `conversation_id=eq.${conversationId}` },
      ({ new: message }) => onMessage({
        id: message.id,
        conversationId: message.conversation_id,
        userId: message.sender_id,
        text: message.body,
        createdAt: message.created_at,
      }),
    )
    .subscribe();
  return () => client.removeChannel(channel);
};

export const FAMILY_CREATION_COST = 10_000_000;
export const FAMILY_BASE_STEP_XP = 100_000;
export const FAMILY_COINS_PER_XP = 100;

export const calculateFamilyLevelFromXp = (rawXp) => {
  let remaining = Math.max(0, Math.floor(Number(rawXp) || 0));
  let level = 1;
  let step = FAMILY_BASE_STEP_XP;
  while (remaining >= step && level < 50) {
    remaining -= step;
    level += 1;
    step *= 2;
  }
  return level;
};

export const computeFamilyLevelProgress = (rawXp, rawLevel, levelConfigs = DEFAULT_FAMILY_LEVEL_CONFIGS) => {
  const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
  const level = Math.max(1, Number(rawLevel) || calculateFamilyLevelFromXp(xp));
  const currentMinXp = FAMILY_BASE_STEP_XP * (Math.pow(2, level - 1) - 1);
  const stepRequiredXp = FAMILY_BASE_STEP_XP * Math.pow(2, level - 1);
  const nextMinXp = currentMinXp + stepRequiredXp;
  const gainedInLevel = Math.max(0, xp - currentMinXp);
  const remainingXp = Math.max(0, stepRequiredXp - gainedInLevel);
  const currentCfg = (levelConfigs || []).find((item) => item.level === level);
  return {
    level,
    currentTitle: currentCfg?.title || `Seviye ${level} Ailesi`,
    currentMinXp,
    stepRequiredXp,
    gainedInLevel,
    nextLevel: level + 1,
    nextMinXp,
    remainingXp,
    ratio: Math.min(1, gainedInLevel / Math.max(1, stepRequiredXp)),
  };
};

export const DEFAULT_FAMILY_LEVEL_CONFIGS = [
  { level: 1, minXp: 0, title: "Başlangıç Ailesi", badgeCode: "family_lv1", frameItemId: null, giftUnlockId: null, memberLimit: 30, perkLabel: "Aile sohbeti, hediyeleşme ve 30 üye kapasitesi" },
  { level: 2, minXp: 100_000, title: "Yükselen Aile", badgeCode: "family_lv2", frameItemId: null, giftUnlockId: null, memberLimit: 45, perkLabel: "Yükselen Aile rozeti ve 45 üye kapasitesi (+100.000 XP)" },
  { level: 3, minXp: 300_000, title: "Parlayan Aile", badgeCode: "family_lv3", frameItemId: "frame_family_silver", giftUnlockId: null, memberLimit: 60, perkLabel: "Aile Gümüş profil çerçevesi ve 60 üye kapasitesi (+200.000 XP)" },
  { level: 4, minXp: 700_000, title: "Seçkin Aile", badgeCode: "family_lv4", frameItemId: null, giftUnlockId: "family_crest", memberLimit: 80, perkLabel: "Aile Sancağı hediyesi kilidi ve 80 üye kapasitesi (+400.000 XP)" },
  { level: 5, minXp: 1_500_000, title: "Asil Aile", badgeCode: "family_lv5", frameItemId: "frame_family_royal", giftUnlockId: null, memberLimit: 100, perkLabel: "Aile Asil profil çerçevesi ve 100 üye kapasitesi (+800.000 XP)" },
  { level: 6, minXp: 3_100_000, title: "Zirve Ailesi", badgeCode: "family_lv6", frameItemId: null, giftUnlockId: null, memberLimit: 130, perkLabel: "Zirve Ailesi rozeti ve 130 üye kapasitesi (+1.600.000 XP)" },
  { level: 7, minXp: 6_300_000, title: "Sancak Ailesi", badgeCode: "family_lv7", frameItemId: null, giftUnlockId: null, memberLimit: 160, perkLabel: "Sancak Ailesi rozeti ve 160 üye kapasitesi (+3.200.000 XP)" },
  { level: 8, minXp: 12_700_000, title: "Hükümran Aile", badgeCode: "family_lv8", frameItemId: null, giftUnlockId: null, memberLimit: 200, perkLabel: "Hükümran Aile rozeti ve 200 üye kapasitesi (+6.400.000 XP)" },
  { level: 9, minXp: 25_500_000, title: "Efsane Aile", badgeCode: "family_lv9", frameItemId: null, giftUnlockId: null, memberLimit: 250, perkLabel: "Efsane Aile rozeti ve 250 üye kapasitesi (+12.800.000 XP)" },
  { level: 10, minXp: 51_100_000, title: "İmparatorluk Ailesi", badgeCode: "family_lv10", frameItemId: null, giftUnlockId: null, memberLimit: 300, perkLabel: "İmparatorluk Ailesi rozeti ve 300 üye kapasitesi (+25.600.000 XP)" },
];

export const DEFAULT_FAMILY_XP_RULES = [
  { eventType: "family_gift_sent", xpAmount: 100_000, dailyUserCap: 1_000_000, label: "Aile içi hediye gönderimi: 10.000.000 kredi = +100.000 XP (100 kredi = +1 XP)" },
  { eventType: "room_gift_sent", xpAmount: 100_000, dailyUserCap: 1_000_000, label: "Canlı odada hediye gönderimi: 10.000.000 kredi = +100.000 XP (100 kredi = +1 XP)" },
];

export const describeFamilyError = (error, fallback = "İşlem şu anda tamamlanamadı. Bağlantını kontrol edip tekrar dene.") => {
  const message = String(error?.message || "");
  if (message.includes("Insufficient balance")) {
    return "Bakiyen bu işlem için yeterli değil.";
  }
  if (message.includes("Already in a family")) {
    return "Aynı anda yalnızca bir aileye üye olabilirsin. Önce mevcut ailenden ayrılmalısın.";
  }
  if (message.includes("Family name already taken")) {
    return "Bu aile adı zaten kullanılıyor. Farklı bir ad dene.";
  }
  if (message.includes("Family name must be between")) {
    return "Aile adı 3 ile 40 karakter arasında olmalı.";
  }
  if (message.includes("Family description must be")) {
    return "Aile açıklaması en fazla 240 karakter olabilir.";
  }
  if (message.includes("Family not found")) {
    return "Aranan aile bulunamadı.";
  }
  if (message.includes("Family is full")) {
    return "Bu ailenin üye kapasitesi dolu.";
  }
  if (message.includes("Family owner cannot leave")) {
    return "Aile kurucusu kendi ailesinden ayrılamaz.";
  }
  if (message.includes("Only family owner can update")) {
    return "Aile bilgilerini yalnızca aile kurucusu düzenleyebilir.";
  }
  if (message.includes("Family membership required")) {
    return "Bu işlem için aile üyesi olmalısın.";
  }
  if (message.includes("Recipient must be in the same family")) {
    return "Hediye alıcısı aynı ailenin üyesi olmalı.";
  }
  if (message.includes("Recipient unavailable")) {
    return "Bu kullanıcıya şu anda hediye gönderilemiyor.";
  }
  if (message.includes("Gift is unavailable")) {
    return "Seçilen hediye şu anda kullanılamıyor.";
  }
  if (message.includes("Invalid gift quantity")) {
    return "Geçersiz hediye adedi seçildi.";
  }
  if (message.includes("Too many messages")) {
    return "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekleyip tekrar dene.";
  }
  if (message.includes("Message must be between")) {
    return "Mesaj metni 1 ile 1000 karakter arasında olmalı.";
  }
  if (message.includes("Invalid avatar URL")) {
    return "Aile profil fotoğrafı adresi geçersiz.";
  }
  if (message.includes("Family level required")) {
    return "Bu hediyeyi göndermek için aile seviyen yeterli değil.";
  }
  if (message.includes("Authentication required")) {
    return "Devam etmek için oturum açmalısın.";
  }
  if (message.includes("Could not find the function") || (message.includes("function") && message.includes("does not exist"))) {
    return "Aile veritabanı güncellemesi henüz sunucuda etkinleştirilmedi.";
  }
  if (message.includes("Network request failed") || message.includes("Failed to fetch")) {
    return "İnternet bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.";
  }
  return fallback;
};

const FAMILY_SELECT_EXTENDED =
  "id, owner_id, family_code, name, description, avatar_url, xp, gift_coins_total, level, icon, theme_colors, created_at, community_members(user_id, role)";
const FAMILY_SELECT_LEGACY =
  "id, owner_id, name, description, icon, theme_colors, created_at, community_members(user_id, role)";

const mapFamily = (community, currentUserId) => {
  const members = community.community_members || [];
  const xp = Math.max(0, Number(community.xp) || 0);
  const level = Math.max(1, Number(community.level) || calculateFamilyLevelFromXp(xp));
  const giftCoinsTotal = Math.max(0, Number(community.gift_coins_total) || 0);
  const membership = currentUserId ? members.find((member) => member.user_id === currentUserId) : null;
  return {
    id: community.id,
    ownerId: community.owner_id,
    familyCode: community.family_code || null,
    name: community.name,
    description: community.description || "",
    avatarUrl: community.avatar_url || null,
    xp,
    giftCoinsTotal,
    level,
    icon: community.icon || "people",
    colors: Array.isArray(community.theme_colors) ? community.theme_colors : ["#2F80ED", "#1D4E89"],
    createdAt: community.created_at,
    memberCount: members.length,
    joined: Boolean(membership),
    role: membership?.role || null,
  };
};

export const listFamilies = async (currentUserId) => {
  const client = requireClient();
  let { data, error } = await client
    .from("communities")
    .select(FAMILY_SELECT_EXTENDED)
    .order("level", { ascending: false })
    .order("xp", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    const legacyResult = await client
      .from("communities")
      .select(FAMILY_SELECT_LEGACY)
      .order("created_at", { ascending: false });
    throwIfError(legacyResult.error);
    data = legacyResult.data;
  }
  return (data || []).map((community) => mapFamily(community, currentUserId));
};

export const listCommunities = listFamilies;

export const getMyFamily = async (currentUserId) => {
  if (!currentUserId) return null;
  const client = requireClient();
  const { data: membership, error: memberError } = await client
    .from("community_members")
    .select("community_id, role")
    .eq("user_id", currentUserId)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberError || !membership?.community_id) return null;

  let { data, error } = await client
    .from("communities")
    .select(FAMILY_SELECT_EXTENDED)
    .eq("id", membership.community_id)
    .maybeSingle();
  if (error) {
    const legacy = await client
      .from("communities")
      .select(FAMILY_SELECT_LEGACY)
      .eq("id", membership.community_id)
      .maybeSingle();
    if (legacy.error || !legacy.data) return null;
    data = legacy.data;
  }
  return data ? mapFamily(data, currentUserId) : null;
};

export const findFamilyByCode = async (rawCode, currentUserId) => {
  const code = String(rawCode || "").replace(/\D/g, "").trim();
  if (!/^[1-9][0-9]{7}$/.test(code)) {
    throw new Error("Lütfen 8 haneli geçerli bir aile ID numarası gir.");
  }
  const client = requireClient();
  const { data, error } = await client
    .from("communities")
    .select(FAMILY_SELECT_EXTENDED)
    .eq("family_code", code)
    .maybeSingle();
  if (error) {
    if (String(error.message || "").includes("family_code")) {
      throw new Error("8 haneli aile ID araması henüz veritabanında etkinleştirilmedi.");
    }
    throw error;
  }
  return data ? mapFamily(data, currentUserId) : null;
};

export const getFamilyDetails = async (communityId, currentUserId) => {
  if (!communityId) return null;
  const client = requireClient();
  const [familyRes, membersRes, levelsRes, rulesRes, rewardsRes] = await Promise.all([
    client.from("communities").select(FAMILY_SELECT_EXTENDED).eq("id", communityId).maybeSingle(),
    client
      .from("community_members")
      .select("user_id, role, joined_at, profiles(id, display_name, handle, avatar_color, avatar_url)")
      .eq("community_id", communityId)
      .order("joined_at", { ascending: true }),
    client.from("family_level_configs").select("*").order("level", { ascending: true }),
    client.from("family_xp_rules").select("*").order("xp_amount", { ascending: false }),
    currentUserId
      ? client.from("family_reward_grants").select("level, frame_item_id, badge_code, granted_at").eq("community_id", communityId).eq("user_id", currentUserId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  let familyRow = familyRes.data;
  if (familyRes.error) {
    const legacy = await client.from("communities").select(FAMILY_SELECT_LEGACY).eq("id", communityId).maybeSingle();
    throwIfError(legacy.error);
    familyRow = legacy.data;
  }
  if (!familyRow) return null;

  const memberRows = membersRes.error ? [] : (membersRes.data || []);
  const memberIds = memberRows.map((row) => row.user_id).filter(Boolean);
  const publicIdByUser = new Map();
  if (memberIds.length > 0) {
    const { data: idRows } = await client.from("profiles").select("id, public_id").in("id", memberIds);
    (idRows || []).forEach((item) => {
      if (item?.id && item.public_id) publicIdByUser.set(item.id, item.public_id);
    });
  }

  let checkedInToday = false;
  if (currentUserId && memberIds.includes(currentUserId)) {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const { data: checkinRow } = await client
      .from("family_xp_events")
      .select("id")
      .eq("community_id", communityId)
      .eq("actor_id", currentUserId)
      .eq("event_type", "daily_checkin")
      .eq("event_date", todayUtc)
      .limit(1)
      .maybeSingle();
    checkedInToday = Boolean(checkinRow?.id);
  }

  const members = memberRows.map((row) => {
    const p = profileFromJoin(row.profiles);
    return {
      userId: row.user_id,
      role: row.role || "member",
      joinedAt: row.joined_at,
      name: p?.display_name || "Sora kullanıcısı",
      handle: p?.handle || "sora",
      color: p?.avatar_color || "#2F80ED",
      avatarUrl: p?.avatar_url || null,
      publicId: publicIdByUser.get(row.user_id) || null,
    };
  });

  const levelConfigs = !levelsRes.error && Array.isArray(levelsRes.data) && levelsRes.data.length > 0
    ? levelsRes.data.map((row) => ({
        level: row.level,
        minXp: row.min_xp,
        title: row.title,
        badgeCode: row.badge_code || null,
        frameItemId: row.frame_item_id || null,
        giftUnlockId: row.gift_unlock_id || null,
        memberLimit: row.member_limit || 40,
        perkLabel: row.perk_label,
      }))
    : DEFAULT_FAMILY_LEVEL_CONFIGS;

  const xpRules = !rulesRes.error && Array.isArray(rulesRes.data) && rulesRes.data.length > 0
    ? rulesRes.data.map((row) => ({
        eventType: row.event_type,
        xpAmount: row.xp_amount,
        dailyUserCap: row.daily_user_cap,
        label: row.label,
      }))
    : DEFAULT_FAMILY_XP_RULES;

  return {
    family: mapFamily(familyRow, currentUserId),
    members,
    levelConfigs,
    xpRules,
    rewardGrants: rewardsRes.error ? [] : (rewardsRes.data || []),
    checkedInToday,
  };
};

export const createFamily = async ({ name, description = "", avatarUrl = null, requestId }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("create_family", {
    p_name: name,
    p_description: description,
    p_avatar_url: avatarUrl,
    p_request_id: requestId,
  });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    familyId: row?.family_id || null,
    familyCode: row?.family_code || null,
    balance: typeof row?.balance === "number" ? row.balance : null,
    promoBalance: typeof row?.promo_balance === "number" ? row.promo_balance : null,
    paidBalance: typeof row?.paid_balance === "number" ? row.paid_balance : null,
  };
};

export const joinFamily = async (communityId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("join_family", { p_community_id: communityId });
  throwIfError(error);
  return (Array.isArray(data) ? data[0] : data) || null;
};

export const leaveFamily = async (communityId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("leave_family", { p_community_id: communityId });
  throwIfError(error);
  return Boolean(data);
};

export const updateFamilyProfile = async ({ communityId, name = null, description = null, avatarUrl = null, clearAvatar = false }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("update_family_profile", {
    p_community_id: communityId,
    p_name: name,
    p_description: description,
    p_avatar_url: avatarUrl,
    p_clear_avatar: Boolean(clearAvatar),
  });
  throwIfError(error);
  return Array.isArray(data) ? data[0] : data;
};

export const listFamilyMessages = async ({ communityId, currentUserId }) => {
  const client = requireClient();
  let { data, error } = await client
    .from("family_messages")
    .select("id, community_id, sender_id, body, kind, metadata, created_at, profiles!family_messages_sender_id_fkey(display_name, handle, avatar_color, avatar_url)")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) {
    const legacy = await client
      .from("family_messages")
      .select("id, community_id, sender_id, body, created_at, profiles!family_messages_sender_id_fkey(display_name, handle, avatar_color, avatar_url)")
      .eq("community_id", communityId)
      .order("created_at", { ascending: false })
      .limit(120);
    throwIfError(legacy.error);
    data = legacy.data;
  }
  return (data || []).reverse().map((msg) => {
    const sender = profileFromJoin(msg.profiles);
    return {
      id: msg.id,
      communityId: msg.community_id,
      userId: msg.sender_id,
      senderName: sender?.display_name || "Sora kullanıcısı",
      senderHandle: sender?.handle || "sora",
      senderColor: sender?.avatar_color || "#2F80ED",
      senderAvatarUrl: sender?.avatar_url || null,
      text: msg.body,
      kind: msg.kind || "text",
      metadata: msg.metadata || {},
      own: msg.sender_id === currentUserId,
      createdAt: msg.created_at,
    };
  });
};

export const sendFamilyMessage = async ({ communityId, text, clientMessageId }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("send_family_message", {
    p_community_id: communityId,
    p_body: text,
    p_client_message_id: clientMessageId,
  });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row.id,
    communityId: row.community_id,
    userId: row.sender_id,
    text: row.body,
    kind: row.kind || "text",
    metadata: row.metadata || {},
    own: true,
    createdAt: row.created_at,
    awardedXp: Number(row.awarded_xp) || 0,
    familyXp: row.family_xp != null ? Number(row.family_xp) : null,
    familyLevel: typeof row.family_level === "number" ? row.family_level : null,
  };
};

export const sendFamilyGift = async ({
  communityId,
  giftId,
  recipientId,
  quantity = 1,
  requestId,
}) => {
  const client = requireClient();
  const { data, error } = await client.rpc("send_family_gift", {
    p_community_id: communityId,
    p_gift_id: giftId,
    p_recipient_id: recipientId,
    p_quantity: quantity,
    p_request_id: requestId,
  });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    messageId: row?.message_id || null,
    messageBody: row?.message_body || "",
    messageMetadata: row?.message_metadata || {},
    createdAt: row?.created_at || new Date().toISOString(),
    balance: typeof row?.balance === "number" ? row.balance : null,
    promoBalance: typeof row?.promo_balance === "number" ? row.promo_balance : null,
    paidBalance: typeof row?.paid_balance === "number" ? row.paid_balance : null,
    giftName: row?.gift_name || "Hediye",
    totalCost: Number(row?.total_cost) || 0,
    awardedXp: Number(row?.awarded_xp) || 0,
    familyXp: row?.family_xp != null ? Number(row.family_xp) : null,
    familyLevel: typeof row?.family_level === "number" ? row.family_level : null,
    giftCoinsTotal: row?.gift_coins_total != null ? Number(row.gift_coins_total) : null,
  };
};

export const subscribeToFamilyMessages = ({ communityId, onMessage }) => {
  const client = requireClient();
  const channel = client
    .channel(`family-messages:${communityId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "family_messages", filter: `community_id=eq.${communityId}` },
      ({ new: message }) => onMessage({
        id: message.id,
        communityId: message.community_id,
        userId: message.sender_id,
        text: message.body,
        kind: message.kind || "text",
        metadata: message.metadata || {},
        createdAt: message.created_at,
      }),
    )
    .subscribe();
  return () => client.removeChannel(channel);
};

export const claimFamilyCheckin = async (communityId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("claim_family_checkin", { p_community_id: communityId });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    claimed: Boolean(row?.claimed),
    awardedXp: Number(row?.awarded_xp) || 0,
    familyXp: row?.family_xp != null ? Number(row.family_xp) : null,
    familyLevel: typeof row?.family_level === "number" ? row.family_level : null,
  };
};

export const claimFamilyLevelRewards = async (communityId) => {
  const client = requireClient();
  const { data, error } = await client.rpc("claim_family_level_rewards", { p_community_id: communityId });
  throwIfError(error);
  return Number(data) || 0;
};

export const subscribeToCommunities = (onChange) => {
  const client = requireClient();
  const channel = client
    .channel("communities:changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_members" }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
};

export const setRoomHandRaise = async ({ roomId, raised }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("set_room_hand_raise", { p_room_id: roomId, p_raised: raised });
  throwIfError(error);
  return data;
};

export const sendRoomGift = async ({ roomId, giftId, recipientId, requestId }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("send_room_gift", {
    p_room_id: roomId,
    p_gift_id: giftId,
    p_recipient_id: recipientId,
    p_request_id: requestId,
  });
  throwIfError(error);
  return data?.[0] || null;
};

export const listRoomGiftCatalog = async () => {
  const client = requireClient();
  let { data, error } = await client
    .from("gift_catalog")
    .select("id,name,icon,color,cost,min_family_level")
    .eq("active", true)
    .order("cost");
  if (error) {
    const legacy = await client.from("gift_catalog").select("id,name,icon,color,cost").eq("active", true).order("cost");
    throwIfError(legacy.error);
    data = legacy.data;
  }
  return (data || []).map((row) => ({
    ...row,
    icon: row.icon === "crown" ? "trophy" : row.icon,
    minFamilyLevel: row.min_family_level || 0,
  }));
};

export const listProfileItems = async () => {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  throwIfError(userError);
  let catalog = await client
    .from("profile_item_catalog")
    .select("id,name,item_type,appearance,cost,purchasable")
    .eq("active", true)
    .order("cost");
  if (catalog.error) {
    catalog = await client
      .from("profile_item_catalog")
      .select("id,name,item_type,appearance,cost")
      .eq("active", true)
      .order("cost");
  }
  const [owned, profile] = await Promise.all([
    client.from("user_profile_items").select("item_id"),
    client.from("profiles").select("active_frame_id,active_profile_theme_id").eq("id", userData.user.id).maybeSingle(),
  ]);
  throwIfError(catalog.error);
  throwIfError(owned.error);
  return {
    items: (catalog.data || []).map((row) => ({ ...row, purchasable: row.purchasable !== false })),
    ownedIds: (owned.data || []).map((row) => row.item_id),
    active: profile.error ? {} : (profile.data || {}),
  };
};

export const purchaseProfileItem = async ({ itemId, requestId }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("purchase_profile_item", { p_item_id: itemId, p_request_id: requestId });
  throwIfError(error);
  return data?.[0] || null;
};

export const activateProfileItem = async (itemId) => {
  const client = requireClient();
  const { error } = await client.rpc("activate_profile_item", { p_item_id: itemId });
  throwIfError(error);
};
