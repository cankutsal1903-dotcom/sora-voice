import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const removeFolderObjects = async (
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  folder: string,
) => {
  const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  if (!cleanFolder) return;
  const { data: items } = await adminClient.storage
    .from(bucket)
    .list(cleanFolder, { limit: 200 });
  if (!items?.length) return;
  const paths = items
    .filter((item) => item?.name)
    .map((item) => `${cleanFolder}/${item.name}`);
  if (paths.length) {
    await adminClient.storage.from(bucket).remove(paths).catch(() => undefined);
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Account deletion is not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Transfer multi-member family ownership and gather hosted room IDs for Storage cleanup.
  const { data: prepData, error: prepError } = await adminClient.rpc(
    "prepare_account_deletion_server",
    { p_user_id: user.id },
  );
  if (prepError) {
    console.error("prepare_account_deletion_server error:", prepError.message);
  }

  const roomIds: string[] = Array.isArray(prepData?.room_ids)
    ? prepData.room_ids.map((id: unknown) => String(id || "")).filter(Boolean)
    : [];

  await Promise.all([
    removeFolderObjects(adminClient, "avatars", user.id),
    removeFolderObjects(adminClient, "family-avatars", user.id),
    ...roomIds.flatMap((roomId) => [
      removeFolderObjects(adminClient, "room-backgrounds", roomId),
      removeFolderObjects(adminClient, "room-music", roomId),
    ]),
  ]).catch(() => undefined);

  // Hard-delete (shouldSoftDelete = false) so auth.users, profiles, rooms, wallets,
  // messages, follows, and push tokens cascade-delete completely.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id, false);

  if (deleteError) {
    console.error("auth.admin.deleteUser error:", deleteError.message);
    return new Response(JSON.stringify({ error: "Could not delete account" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
