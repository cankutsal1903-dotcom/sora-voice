-- Premium profile frames: earned progression with a clear cosmetic price ladder.
insert into public.profile_item_catalog (id, name, item_type, appearance, cost, active, purchasable)
values
  ('frame_flame', 'Alev Çerçevesi', 'frame', '{"color":"#F04B24","accent":"#FFD166","width":4,"style":"flame","animated":true}'::jsonb, 50000000, true, true)
on conflict (id) do update
set name = excluded.name,
    appearance = excluded.appearance,
    cost = excluded.cost,
    active = excluded.active,
    purchasable = excluded.purchasable;

update public.profile_item_catalog
set cost = case id
  when 'frame_sky' then 2000000
  when 'frame_amber' then 6000000
  when 'frame_lilac' then 15000000
  when 'frame_family_silver' then 1
  when 'frame_family_royal' then 1
  else cost
end
where id in ('frame_sky', 'frame_amber', 'frame_lilac', 'frame_family_silver', 'frame_family_royal');
