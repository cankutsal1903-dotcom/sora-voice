-- Revoke unnecessary `anon` EXECUTE privileges on SECURITY DEFINER functions
-- flagged by Supabase Security Advisor (preserving `is_handle_available` and
-- `resolve_admin_login_email`, which are intentionally pre-auth).

revoke all on function public.activate_profile_item(text) from public, anon;
grant execute on function public.activate_profile_item(text) to authenticated;

revoke all on function public.purchase_profile_item(text, uuid) from public, anon;
grant execute on function public.purchase_profile_item(text, uuid) to authenticated;

revoke all on function public.wallet_get_or_create() from public, anon;
grant execute on function public.wallet_get_or_create() to authenticated;

revoke all on function public.sync_my_user_level() from public, anon;
grant execute on function public.sync_my_user_level() to authenticated;

revoke all on function public.get_my_active_sanction() from public, anon;
grant execute on function public.get_my_active_sanction() to authenticated;

revoke all on function public.user_owns_profile_item(uuid, text, text) from public, anon;
grant execute on function public.user_owns_profile_item(uuid, text, text) to authenticated;

revoke all on function public.assert_user_not_banned(uuid) from public, anon;
grant execute on function public.assert_user_not_banned(uuid) to authenticated;

revoke all on function public.admin_adjust_user_coins(text, bigint, text, text, uuid) from public, anon;
grant execute on function public.admin_adjust_user_coins(text, bigint, text, text, uuid) to authenticated;

revoke all on function public.admin_apply_user_sanction(text, text, integer, text) from public, anon;
grant execute on function public.admin_apply_user_sanction(text, text, integer, text) to authenticated;

revoke all on function public.admin_dashboard_summary() from public, anon;
grant execute on function public.admin_dashboard_summary() to authenticated;

revoke all on function public.admin_list_families() from public, anon;
grant execute on function public.admin_list_families() to authenticated;

revoke all on function public.admin_list_moderation_terms() from public, anon;
grant execute on function public.admin_list_moderation_terms() to authenticated;

revoke all on function public.admin_list_rooms(text) from public, anon;
grant execute on function public.admin_list_rooms(text) to authenticated;

revoke all on function public.admin_list_safety_reports(text) from public, anon;
grant execute on function public.admin_list_safety_reports(text) to authenticated;

revoke all on function public.admin_list_sanctions(boolean, integer) from public, anon;
grant execute on function public.admin_list_sanctions(boolean, integer) to authenticated;

revoke all on function public.admin_list_user_transactions(text, integer) from public, anon;
grant execute on function public.admin_list_user_transactions(text, integer) to authenticated;

revoke all on function public.admin_manage_moderation_term(text, text, bigint) from public, anon;
grant execute on function public.admin_manage_moderation_term(text, text, bigint) to authenticated;

revoke all on function public.admin_manage_room(uuid, text) from public, anon;
grant execute on function public.admin_manage_room(uuid, text) to authenticated;

revoke all on function public.admin_revoke_user_sanctions(text, uuid) from public, anon;
grant execute on function public.admin_revoke_user_sanctions(text, uuid) to authenticated;

revoke all on function public.admin_search_users(text, integer) from public, anon;
grant execute on function public.admin_search_users(text, integer) to authenticated;

revoke all on function public.admin_set_user_level(text, integer) from public, anon;
grant execute on function public.admin_set_user_level(text, integer) to authenticated;

revoke all on function public.before_community_family_code() from public, anon;
revoke all on function public.before_profile_public_id() from public, anon;
revoke all on function public.enforce_not_banned_room_trigger() from public, anon;
