-- +goose Up
-- Owned by the profiles and slot modules (ADR 0026): a fresh install starts with no Profiles and one Slot, Standard, on for
-- new Titles with no default Profile. Migrations 00005, 00046 and 00048 still seed the six Profiles and the 4K Slot, and stay
-- as they are, because an install that already ran them keeps what they made.
--
-- `install_origin` tells the two apart. store.Open creates it before it runs any migration, holding 1 when the database had
-- no schema yet (a fresh install) and 0 otherwise (an upgrade), and this migration drops it. Only a fresh install loses the
-- seeds; nothing references them yet, so no Version, Request or default has to be unpicked.
-- Without a record from store.Open the database is taken for an upgrade, which keeps everything.
CREATE TABLE IF NOT EXISTS install_origin (fresh INTEGER NOT NULL) STRICT;
INSERT INTO install_origin (fresh) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM install_origin);
DELETE FROM profiles WHERE (SELECT fresh FROM install_origin) = 1;
DELETE FROM slots WHERE id <> 'standard' AND (SELECT fresh FROM install_origin) = 1;
UPDATE slots SET default_movies = NULL, default_series = NULL WHERE (SELECT fresh FROM install_origin) = 1;
DROP TABLE install_origin;

-- +goose Down
-- The seeds a fresh install lost are not brought back.
SELECT 1;
