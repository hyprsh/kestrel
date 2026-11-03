-- +goose Up
-- How many searches of the row in a row could not finish (an indexer failed, a Grab could not be sent): the next
-- retry waits 15 min, then 30 min, 1 h and so on, and a completed search resets it to 0.
ALTER TABLE search_state ADD COLUMN missing_failures INTEGER NOT NULL DEFAULT 0;

-- The cooldown of the retries a rejected Import or a Cancel with blocklist start: how many such rejections of the
-- Version came in a row (an Import resets it to 0), and the earliest the next retry may run. Kept on every row of
-- a Version, so it survives restarts.
ALTER TABLE search_state ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_state ADD COLUMN retry_not_before TEXT;

-- +goose Down
ALTER TABLE search_state DROP COLUMN retry_not_before;
ALTER TABLE search_state DROP COLUMN retry_count;
ALTER TABLE search_state DROP COLUMN missing_failures;
