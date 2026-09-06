-- One collection shape: the dynamic kind is gone, so its columns go too.
-- Column-level CHECKs on the dropped columns are removed with them; the loose
-- ('dynamic' still allowed) CHECKs on other tables stay: rewriting tables for that is not worth it.
ALTER TABLE collections DROP COLUMN type;
ALTER TABLE collections DROP COLUMN query;
ALTER TABLE items DROP COLUMN suggested_actions;
