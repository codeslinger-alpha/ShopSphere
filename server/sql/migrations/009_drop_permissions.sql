-- Drop the permissions and role_permissions tables.
--
-- They were seeded with seven demo.* permissions and seven grants, and nothing in
-- the application ever read them. Authorization in this codebase is
-- requireRole(roleName) on a mounted router — a check per role, not per
-- capability — so the two tables described an authorization model the code does
-- not implement. Keeping them meant every reader had to be told they were
-- decorative, and the admin console grew a screen whose whole content was that
-- disclaimer.
--
-- Dropping them is the honest version. If per-capability authorization is ever
-- wanted, it should arrive with the code that consults it.
--
-- role_permissions goes first: its foreign keys point at both roles and
-- permissions, so dropping permissions first would need CASCADE and would take
-- the grants out without saying so.
--
-- Neither table carried the fn_prevent_delete trigger, so no rule blocks this.

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
