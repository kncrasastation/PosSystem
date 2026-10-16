-- One-time creation of the first Owner account.
--
-- 1. In Supabase: Authentication > Users > "Add user" (email + strong password,
--    tick "Auto confirm user").
-- 2. Replace the email and display name below, then run this in the SQL Editor.
--
-- Fails safely if an owner already exists or the auth user is missing.
-- This function cannot be called from the app; it only runs from the SQL Editor.
select app.bootstrap_owner('owner@example.com', 'Owner Name');
