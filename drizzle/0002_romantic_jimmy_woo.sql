CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`admin_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text,
	`route` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `consent_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `consented_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `suspension_reason` text;