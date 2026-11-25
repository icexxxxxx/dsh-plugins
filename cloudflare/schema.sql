-- One row per install per UTC day; retries overwrite the same row.
CREATE TABLE IF NOT EXISTS reports (
  install_id TEXT NOT NULL,
  day TEXT NOT NULL,
  received_at TEXT NOT NULL,
  app_version TEXT,
  platform TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX IF NOT EXISTS reports_day ON reports (day);
CREATE INDEX IF NOT EXISTS reports_received ON reports (received_at);

-- Optional: keep the table small. Run on a schedule or delete manually.
-- DELETE FROM reports WHERE day < date('now','-180 day');
