-- Drop the chain shape from `asks`.
--
-- Background: asks were originally modelled like specs (project-scoped chains
-- via prev_id) on the assumption that follow-up Q&A in the same session
-- belongs in a linked list. In practice every ask was logged standalone, so
-- the chain column / indexes only added complexity. Each ask is now a flat
-- record per project.
--
-- SQLite drops the indexes that reference the column on ALTER TABLE DROP
-- COLUMN, but we drop them explicitly first to keep this migration readable
-- and to avoid relying on that behaviour.

DROP INDEX IF EXISTS uq_asks_succ;
DROP INDEX IF EXISTS idx_asks_prev;
ALTER TABLE asks DROP COLUMN prev_id;
