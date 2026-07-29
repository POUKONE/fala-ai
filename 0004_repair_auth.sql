-- Repair installations created before the authentication migrations were applied.
CREATE TABLE IF NOT EXISTS `rate_limits` (
  `key` text PRIMARY KEY NOT NULL,
  `window_start` text NOT NULL,
  `count` integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `token` text PRIMARY KEY NOT NULL,
  `user_email` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `auth_sessions_email_idx` ON `auth_sessions` (`user_email`);
