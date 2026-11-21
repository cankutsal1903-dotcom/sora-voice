-- Global Liderlik Podyumu (En Cömertler, En Aktif Aileler, Zirve Seviyeler)
-- ve başkasının profilinde doğru takipçi/takip sayısı özeti (RLS güvenli sayaç RPC'si).

begin;

-- Performans indeksleri
create index if not exists profiles_gift_spent_leaderboard_idx
  on public.profiles (gift_spent_total desc, id)
  where gift_spent_total > 0;

create index if not exists profiles_level_leaderboard_idx
  on public.profiles (user_level desc, user_xp desc, id);

create index if not exists communities_xp_leaderboard_idx
  on public.communities (xp desc, gift_coins_total desc, level desc, id);

create index if not exists follows_following_id_idx
  on public.follows (following_id);

-- Tek çağrıda 3 kategorili Global Liderlik Podyumu (N+1 yok, security invoker)
create or replace function public.get_global_leaderboard(p_limit integer default 50)
returns table (
  category text,
  rank_no integer,
  entity_type text,
  entity_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  avatar_color text,
  family_icon text,
  score bigint,
  secondary_score bigint,
  level integer,
  wealth_level integer,
  member_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  with
  generous as (
    select
      row_number() over (order by p.gift_spent_total desc, p.id)::integer as rank_no,
      p.id,
      p.display_name,
      p.handle,
      p.avatar_url,
      p.avatar_color,
      coalesce(p.gift_spent_total, 0)::bigint as gift_spent_total,
      coalesce(p.user_level, 1)::integer as user_level
    from public.profiles p
    where coalesce(p.gift_spent_total, 0) > 0
    order by p.gift_spent_total desc, p.id
    limit v_limit
  ),
  family_top as (
    select
      row_number() over (
        order by coalesce(c.xp, 0) desc, coalesce(c.gift_coins_total, 0) desc, coalesce(c.level, 1) desc, c.id
      )::integer as rank_no,
      c.id,
      c.name,
      c.family_code,
      c.avatar_url,
      coalesce(c.theme_colors->>0, '#2F80ED')::text as accent_color,
      c.icon,
      coalesce(c.xp, 0)::bigint as xp,
      coalesce(c.gift_coins_total, 0)::bigint as gift_coins_total,
      coalesce(c.level, 1)::integer as level
    from public.communities c
    order by coalesce(c.xp, 0) desc, coalesce(c.gift_coins_total, 0) desc, coalesce(c.level, 1) desc, c.id
    limit v_limit
  ),
  family_counts as (
    select cm.community_id, count(*)::integer as member_count
    from public.community_members cm
    join family_top f on f.id = cm.community_id
    group by cm.community_id
  ),
  level_top as (
    select
      row_number() over (
        order by coalesce(p.user_level, 1) desc, coalesce(p.user_xp, 0) desc, p.id
      )::integer as rank_no,
      p.id,
      p.display_name,
      p.handle,
      p.avatar_url,
      p.avatar_color,
      coalesce(p.user_level, 1)::integer as user_level,
      coalesce(p.user_xp, 0)::bigint as user_xp,
      coalesce(p.gift_spent_total, 0)::bigint as gift_spent_total
    from public.profiles p
    order by coalesce(p.user_level, 1) desc, coalesce(p.user_xp, 0) desc, p.id
    limit v_limit
  ),
  combined as (
    select
      'most_generous'::text as category,
      g.rank_no,
      'profile'::text as entity_type,
      g.id as entity_id,
      g.display_name,
      g.handle,
      g.avatar_url,
      g.avatar_color,
      null::text as family_icon,
      g.gift_spent_total as score,
      0::bigint as secondary_score,
      g.user_level as level,
      public.wealth_level_for(g.gift_spent_total)::integer as wealth_level,
      null::integer as member_count
    from generous g

    union all

    select
      'active_families'::text,
      f.rank_no,
      'family'::text,
      f.id,
      f.name,
      f.family_code,
      f.avatar_url,
      f.accent_color,
      f.icon,
      f.xp,
      f.gift_coins_total,
      f.level,
      null::integer,
      coalesce(fc.member_count, 0)
    from family_top f
    left join family_counts fc on fc.community_id = f.id

    union all

    select
      'top_levels'::text,
      l.rank_no,
      'profile'::text,
      l.id,
      l.display_name,
      l.handle,
      l.avatar_url,
      l.avatar_color,
      null::text,
      l.user_level::bigint,
      l.user_xp,
      l.user_level,
      public.wealth_level_for(l.gift_spent_total)::integer,
      null::integer
    from level_top l
  )
  select
    c.category,
    c.rank_no,
    c.entity_type,
    c.entity_id,
    c.display_name,
    c.handle,
    c.avatar_url,
    c.avatar_color,
    c.family_icon,
    c.score,
    c.secondary_score,
    c.level,
    c.wealth_level,
    c.member_count
  from combined c
  order by case c.category
    when 'most_generous' then 1
    when 'active_families' then 2
    else 3
  end, c.rank_no;
end;
$$;

revoke all on function public.get_global_leaderboard(integer) from public, anon;
grant execute on function public.get_global_leaderboard(integer) to authenticated;

-- Başkasının profilinde gizli takip grafiğini açmadan yalnızca sayısal takipçi/takip özeti
create or replace function public.get_profile_follow_counts(p_user_id uuid)
returns table (
  followers_count integer,
  following_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_user_id is null then
    return query select 0::integer, 0::integer;
    return;
  end if;

  return query
  select
    (select count(*)::integer from public.follows f where f.following_id = p_user_id) as followers_count,
    (select count(*)::integer from public.follows f where f.follower_id = p_user_id) as following_count;
end;
$$;

revoke all on function public.get_profile_follow_counts(uuid) from public, anon;
grant execute on function public.get_profile_follow_counts(uuid) to authenticated;

commit;
