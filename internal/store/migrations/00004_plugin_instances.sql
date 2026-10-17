-- +goose Up
-- Owned by the plugin module. One row per configured plugin instance of any
-- contract. `config` is a JSON object holding every field of the plugin's manifest,
-- secrets included; the API strips the secret fields before answering.
CREATE TABLE plugin_instances (
    id        INTEGER PRIMARY KEY,
    contract  TEXT    NOT NULL,
    plugin_id TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    enabled   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    priority  INTEGER NOT NULL DEFAULT 0,
    config    TEXT    NOT NULL CHECK (json_valid(config))
) STRICT;

CREATE INDEX plugin_instances_contract ON plugin_instances (contract, enabled);

-- +goose Down
DROP TABLE plugin_instances;
