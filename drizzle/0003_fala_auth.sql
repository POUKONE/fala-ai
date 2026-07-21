ALTER TABLE `users` ADD `password_hash` text;
ALTER TABLE `users` ADD `email_verified_at` text;
ALTER TABLE `users` ADD `verification_token` text;
ALTER TABLE `users` ADD `reset_token` text;
ALTER TABLE `users` ADD `reset_token_expires_at` text;
CREATE TABLE IF NOT EXISTS `auth_sessions` (`token` text PRIMARY KEY NOT NULL, `user_email` text NOT NULL, `created_at` text NOT NULL, `expires_at` text NOT NULL);
CREATE INDEX IF NOT EXISTS `auth_sessions_email_idx` ON `auth_sessions` (`user_email`);
