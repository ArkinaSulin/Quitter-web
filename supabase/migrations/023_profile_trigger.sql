-- 023: Auto-create a pending profile for every new auth user.
-- Previously profiles rows were created lazily by the client (useProfile upsert);
-- if that failed or raced, a new user had NO profile row at all — so they saw the
-- awaiting-approval screen and could submit a request, but nothing persisted and the
-- admin panel never listed them. This trigger guarantees a pending (role = NULL)
-- profile exists immediately after signup, independent of any client behavior.
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
