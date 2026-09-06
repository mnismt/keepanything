-- One collection shape: the dynamic kind is gone, so its columns go too.
-- Column-level CHECKs on the dropped columns are removed with them; the loose
-- ('dynamic' still allowed) CHECKs on other tables stay: rewriting tables for that is not worth it.
-- items.suggested_actions is left alone: libraries created after it was cut from 001 never had it,
-- and DROP COLUMN has no IF EXISTS. Where it remains it has a default and nobody reads it.
ALTER TABLE collections DROP COLUMN type;
ALTER TABLE collections DROP COLUMN query;
