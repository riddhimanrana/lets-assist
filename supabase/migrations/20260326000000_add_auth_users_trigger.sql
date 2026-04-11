-- Add missing trigger for auto-creating profiles on auth.users insert
-- This trigger calls handle_new_user() which creates a profile when a new auth user is created

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
