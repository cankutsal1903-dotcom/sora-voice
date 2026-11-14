import { supabase } from "../auth/supabase";

const FALLBACK_COLORS = ["#5140BD", "#252458"];
const ROOM_SELECT = "*, profiles!rooms_host_id_fkey(display_name, handle, avatar_color)";

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
    initials: (host?.display_name || "S").charAt(0).toUpperCase(),
    title: room.title,
    description: room.description,
    category: room.category,
    listeners: room.listener_count,
    colors: Array.isArray(room.theme_colors) ? room.theme_colors : FALLBACK_COLORS,
    accent: room.accent_color,
    roomLocked: room.room_locked,
    chatLocked: room.chat_locked,
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
    query.gte("last_active_at", new Date(Date.now() - 90_000).toISOString());
  }
  const [{ data, error }, { data: blocks, error: blocksError }] = await Promise.all([
    query,
    client.from("user_blocks").select("blocked_id"),
  ]);
  throwIfError(error);
  if (blocksError) return (data || []).map(mapRoom);
  const blockedIds = new Set((blocks || []).map((block) => block.blocked_id));
  return (data || []).filter((room) => !blockedIds.has(room.host_id)).map(mapRoom);
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
      accent_color: room.accent || "#D698FF",
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

export const setRoomPresence = async (roomId, isActive) => {
  const client = requireClient();
  const { data, error } = await client
    .from("rooms")
    .update({
      state: isActive ? "live" : "inactive",
      listener_count: isActive ? 1 : 0,
      last_active_at: new Date().toISOString(),
    })
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
  return data?.[0] || null;
};

export const listRoomMembers = async (roomId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("room_members")
    .select("user_id, role, is_muted, removed_at, profiles!room_members_user_id_fkey(display_name, avatar_color)")
    .eq("room_id", roomId)
    .is("removed_at", null);
  throwIfError(error);
  return (data || []).map((member) => ({
    userId: member.user_id,
    role: member.role,
    isMuted: member.is_muted,
    name: profileFromJoin(member.profiles)?.display_name || "Sora kullanıcısı",
    color: profileFromJoin(member.profiles)?.avatar_color || "#7FCBEA",
  }));
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

export const createBankTransferRequest = async ({ requestedCredits, amountTry }) => {
  const client = requireClient();
  const { data, error } = await client.rpc("create_bank_transfer_request", {
    p_requested_credits: requestedCredits,
    p_amount_try: amountTry,
  });
  throwIfError(error);
  return mapBankTransferRequest(Array.isArray(data) ? data[0] : data);
};

export const listMyBankTransferRequests = async () => {
  const client = requireClient();
  const { data, error } = await client
    .from("bank_transfer_requests")
    .select("id, reference_code, user_id, requested_credits, amount_try, status, credited_credits, admin_note, created_at, reviewed_at")
    .order("created_at", { ascending: false })
    .limit(20);
  throwIfError(error);
  return (data || []).map(mapBankTransferRequest);
};

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
      color: profile?.avatar_color || "#785E90",
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

const mapDirectConversation = (conversation) => ({
  id: conversation.conversation_id,
  userId: conversation.other_user_id,
  name: conversation.other_display_name || "Sora kullanıcısı",
  handle: conversation.other_handle || "sora",
  color: conversation.other_avatar_color || "#7FCBEA",
  lastMessage: conversation.last_message || "Henüz mesaj yok.",
  lastMessageAt: conversation.last_message_at,
});

export const listDirectConversations = async () => {
  const client = requireClient();
  const { data, error } = await client.rpc("list_direct_conversations");
  throwIfError(error);
  return (data || []).map(mapDirectConversation);
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

const mapCommunity = (community, currentUserId) => {
  const members = community.community_members || [];
  return {
    id: community.id,
    ownerId: community.owner_id,
    name: community.name,
    description: community.description || "",
    icon: community.icon || "people",
    colors: Array.isArray(community.theme_colors) ? community.theme_colors : FALLBACK_COLORS,
    createdAt: community.created_at,
    memberCount: members.length,
    joined: members.some((member) => member.user_id === currentUserId),
    role: members.find((member) => member.user_id === currentUserId)?.role || null,
  };
};

export const listCommunities = async (currentUserId) => {
  const client = requireClient();
  const { data, error } = await client
    .from("communities")
    .select("id, owner_id, name, description, icon, theme_colors, created_at, community_members(user_id, role)")
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data || []).map((community) => mapCommunity(community, currentUserId));
};

export const createCommunity = async ({ userId, name, description, icon = "people", colors = FALLBACK_COLORS }) => {
  const client = requireClient();
  const { data, error } = await client
    .from("communities")
    .insert({ owner_id: userId, name, description, icon, theme_colors: colors })
    .select("id, owner_id, name, description, icon, theme_colors, created_at")
    .single();
  throwIfError(error);
  return { ...mapCommunity({ ...data, community_members: [{ user_id: userId, role: "owner" }] }, userId), memberCount: 1 };
};

export const setCommunityMembership = async ({ communityId, userId, joined }) => {
  const client = requireClient();
  if (joined) {
    const { error } = await client.from("community_members").insert({ community_id: communityId, user_id: userId, role: "member" });
    if (error?.code !== "23505") throwIfError(error);
    return;
  }
  const { error } = await client
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);
  throwIfError(error);
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
  const { data, error } = await client.from("gift_catalog")
    .select("id,name,icon,color,cost").eq("active", true).order("cost");
  throwIfError(error);
  return data || [];
};

export const listProfileItems = async () => {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  throwIfError(userError);
  const [catalog, owned, profile] = await Promise.all([
    client.from("profile_item_catalog").select("id,name,item_type,appearance,cost").eq("active", true).order("cost"),
    client.from("user_profile_items").select("item_id"),
    client.from("profiles").select("active_frame_id,active_profile_theme_id").eq("id", userData.user.id).maybeSingle(),
  ]);
  throwIfError(catalog.error); throwIfError(owned.error); throwIfError(profile.error);
  return { items: catalog.data || [], ownedIds: (owned.data || []).map((row) => row.item_id), active: profile.data || {} };
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
