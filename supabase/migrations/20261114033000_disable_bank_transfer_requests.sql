begin;

-- Credit purchases are moving to verified store billing. Keep historical
-- requests available to administrators, but prevent clients from creating new
-- manual bank-transfer requests.
revoke all on function public.create_bank_transfer_request(integer, numeric)
  from public, anon, authenticated;

commit;
