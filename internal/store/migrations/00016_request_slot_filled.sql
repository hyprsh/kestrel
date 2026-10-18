-- +goose Up
-- Owned by the requests module: when a requested Slot first held a file that fits
-- its Version's Profile. Completed means filled at some point, so a later Profile
-- change that makes the file a misfit does not reopen the Request.
ALTER TABLE request_slots ADD COLUMN filled_at TEXT;

-- +goose Down
ALTER TABLE request_slots DROP COLUMN filled_at;
