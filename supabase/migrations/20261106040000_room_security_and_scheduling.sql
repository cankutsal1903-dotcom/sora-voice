-- Limit generic room updates to the host. Moderators receive a narrow RPC for
-- lock settings and cannot change a room owner, title, state, or other fields.

CREATE INDEX IF NOT EXISTS rooms_state_starts_at_idx ON public.rooms (state, starts_at ASC);

DROP POLICY IF EXISTS "Staff update their rooms" ON public.rooms;
DROP POLICY IF EXISTS "Hosts update their rooms" ON public.rooms;
CREATE POLICY "Hosts update their rooms"
  ON public.rooms
  FOR UPDATE
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

CREATE OR REPLACE FUNCTION public.update_room_settings(
  p_room_id UUID,
  p_room_locked BOOLEAN DEFAULT NULL,
  p_chat_locked BOOLEAN DEFAULT NULL
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_room public.rooms;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_room_staff(p_room_id) THEN
    RAISE EXCEPTION 'Moderator permission required';
  END IF;

  UPDATE public.rooms
  SET room_locked = COALESCE(p_room_locked, room_locked),
      chat_locked = COALESCE(p_chat_locked, chat_locked),
      updated_at = now()
  WHERE id = p_room_id
  RETURNING * INTO updated_room;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  RETURN updated_room;
END;
$$;

REVOKE ALL ON FUNCTION public.update_room_settings(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_room_settings(UUID, BOOLEAN, BOOLEAN) TO authenticated;
