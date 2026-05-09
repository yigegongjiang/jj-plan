-- Drop the redundant 'draft' status from specs.
--
-- Background: 'draft' and 'active' carried the same operational semantics
-- (no enforced state transition; the app layer never gated behavior on
-- draft vs active). The two-state model `active | done` matches what the
-- spec lifecycle actually represents: in-progress vs finished.
--
-- This migration only rewrites existing rows. The application enum and
-- INSERT default are tightened in the same release; after deploy, no new
-- 'draft' rows can appear.

UPDATE specs SET status = 'active', updated_at = updated_at WHERE status = 'draft';
