-- Push notification tables and RPC
-- Apply via Supabase SQL editor or: supabase db push

-- device_push_tokens: one row per physical device token
-- token is globally unique: a token belongs to exactly one user at a time
-- register_push_token RPC handles safe ownership transfer on account switch
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read and delete their own tokens
-- INSERT/UPDATE goes through the SECURITY DEFINER RPC only
DROP POLICY IF EXISTS "Kullanici kendi tokenlarini okur" ON public.device_push_tokens;
CREATE POLICY "Kullanici kendi tokenlarini okur"
  ON public.device_push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Kullanici kendi tokenini siler" ON public.device_push_tokens;
CREATE POLICY "Kullanici kendi tokenini siler"
  ON public.device_push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- SECURITY DEFINER RPC: safely transfers token to the calling user
-- even if another account previously owned this token (e.g. device shared between accounts)
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'Unsupported platform';
  END IF;
  IF p_token IS NULL OR p_token !~ '^(ExpoPushToken|ExponentPushToken)\[[^]]+\]$' THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;
  INSERT INTO public.device_push_tokens (user_id, token, platform, updated_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id    = auth.uid(),
        platform   = EXCLUDED.platform,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

-- notification_log: idempotency guard for remote push sends
-- RLS enabled with NO client policy: only service_role (Edge Function) can write
CREATE TABLE IF NOT EXISTS public.notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   TEXT NOT NULL UNIQUE,
  sent_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: table is inaccessible to anon/authenticated roles
-- Only the Edge Function using service_role key can insert/select

CREATE INDEX IF NOT EXISTS notification_log_sent_at_idx ON public.notification_log (sent_at);
