-- Remove Ocean, Midnight, and Sunrise profile themes (theme_ocean, theme_midnight, theme_sunrise)

update public.profiles
   set active_profile_theme_id = null
 where active_profile_theme_id in ('theme_ocean', 'theme_midnight', 'theme_sunrise')
    or active_profile_theme_id is not null;

delete from public.user_profile_items
 where item_id in (
   select id
     from public.profile_item_catalog
    where id in ('theme_ocean', 'theme_midnight', 'theme_sunrise')
       or item_type = 'theme'
 );

delete from public.profile_item_catalog
 where id in ('theme_ocean', 'theme_midnight', 'theme_sunrise')
    or item_type = 'theme';
