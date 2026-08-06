-- 026: Guarantee every auth user has a profile row.
--
-- Root cause of "signup has no pending profile": profile rows were created only by
-- the client (useProfile upsert) or by the 023 trigger. If 023 was never applied,
-- or the account predates it, an auth.users row can exist with NO profiles row —
-- so the admin panel never lists the user and they can never be approved.
--
-- This migration is self-contained:
--   1. Backfills a profile for EVERY existing auth.users row that lacks one
--      (display_name from user metadata; role NULL = pending).
--   2. (Re)creates the AFTER INSERT trigger so future signups always get a profile.

-- 1. Backfill existing users missing a profile.
INSERT INTO profiles (id, display_name)
SELECT u.id,
       COALESCE(
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'name',
         u.email
       )
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- 2. Ensure the auto-create trigger exists (idempotent; safe to re-run).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      NEW.email
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
