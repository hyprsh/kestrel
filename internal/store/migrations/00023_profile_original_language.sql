-- +goose Up
-- Owned by the profiles module: what a Primary-Language Profile does with a
-- Release that has the Title's Original Language but no Primary-Language audio
-- (#103): reject it, offer it to the admin, or accept it. It replaces
-- `original_fallback` (0 = reject, 1 = accept), which is still written in step
-- (1 only for accept) but no longer read. Original-Language Profiles always
-- reject.
ALTER TABLE profiles ADD COLUMN original_language TEXT NOT NULL DEFAULT 'reject'
    CHECK (original_language IN ('reject', 'offer', 'accept') AND (language_rule = 'primary' OR original_language = 'reject'));
UPDATE profiles SET original_language = 'accept' WHERE original_fallback = 1;

-- +goose Down
ALTER TABLE profiles DROP COLUMN original_language;
