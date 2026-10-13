-- Feature migration only: does not import memory personal data or modify Wiki/ToDo.
CREATE TABLE IF NOT EXISTS memo_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
