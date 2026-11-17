-- The mobile client must never be able to choose the provider list.  The
-- Edge Function now calls allocate_voice_session_server with service_role.
revoke all on function public.allocate_voice_session(uuid, text[], text[]) from public, anon, authenticated;

