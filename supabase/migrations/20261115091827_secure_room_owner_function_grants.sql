-- Supabase projesindeki mevcut default privileges yeni fonksiyonlara anon
-- EXECUTE verebiliyor. Oda sahibi RPC'lerini yalnızca oturum açmış kullanıcılara
-- aç; tetikleyici fonksiyonu doğrudan hiçbir istemci çağıramasın.
revoke execute on function public.join_room(uuid, text) from public, anon;
revoke execute on function public.leave_room(uuid) from public, anon;
revoke execute on function public.set_room_hand_raise(uuid, boolean) from public, anon;
revoke execute on function public.authorize_room_seat(uuid, text, uuid) from public, anon;
revoke execute on function public.ban_room_member(uuid, uuid, integer) from public, anon;
revoke execute on function public.manage_room_member(uuid, uuid, text) from public, anon;
revoke execute on function public.update_room_details(uuid, text, text, text) from public, anon;
revoke execute on function public.set_room_password(uuid, text) from public, anon;
revoke execute on function public.update_room_layout(uuid, integer, boolean) from public, anon;
revoke execute on function public.set_room_music(uuid, jsonb) from public, anon;
revoke execute on function public.submit_room_background(uuid, text) from public, anon;
revoke execute on function public.clear_room_background(uuid) from public, anon;
revoke execute on function public.admin_list_room_background_requests(text) from public, anon;
revoke execute on function public.admin_review_room_background(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_set_app_setting(text, jsonb) from public, anon;
revoke execute on function public.app_setting_enabled(text) from public, anon;
revoke execute on function public.is_room_host(uuid, uuid) from public, anon;
revoke execute on function public.storage_room_id(text) from public, anon;
revoke execute on function public.guard_room_privileged_columns() from public, anon, authenticated;

grant execute on function public.join_room(uuid, text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.set_room_hand_raise(uuid, boolean) to authenticated;
grant execute on function public.authorize_room_seat(uuid, text, uuid) to authenticated;
grant execute on function public.ban_room_member(uuid, uuid, integer) to authenticated;
grant execute on function public.manage_room_member(uuid, uuid, text) to authenticated;
grant execute on function public.update_room_details(uuid, text, text, text) to authenticated;
grant execute on function public.set_room_password(uuid, text) to authenticated;
grant execute on function public.update_room_layout(uuid, integer, boolean) to authenticated;
grant execute on function public.set_room_music(uuid, jsonb) to authenticated;
grant execute on function public.submit_room_background(uuid, text) to authenticated;
grant execute on function public.clear_room_background(uuid) to authenticated;
grant execute on function public.admin_list_room_background_requests(text) to authenticated;
grant execute on function public.admin_review_room_background(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_app_setting(text, jsonb) to authenticated;
grant execute on function public.app_setting_enabled(text) to authenticated;
grant execute on function public.is_room_host(uuid, uuid) to authenticated;
grant execute on function public.storage_room_id(text) to authenticated;

alter function public.storage_room_id(text) set search_path = public, pg_temp;
