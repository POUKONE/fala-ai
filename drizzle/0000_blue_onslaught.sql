CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`contract_type` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'Ajout manuel' NOT NULL,
	`required_skills` text DEFAULT '' NOT NULL,
	`experience_required` text DEFAULT '' NOT NULL,
	`education_required` text DEFAULT '' NOT NULL,
	`languages` text DEFAULT '' NOT NULL,
	`sector` text DEFAULT '' NOT NULL,
	`salary_min` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'À préparer' NOT NULL,
	`applied_at` text,
	`next_action_at` text,
	`interview_at` text,
	`score` integer,
	`score_breakdown` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_email` text PRIMARY KEY NOT NULL,
	`target_title` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`contract_type` text DEFAULT '' NOT NULL,
	`skills` text DEFAULT '' NOT NULL,
	`experience_level` text DEFAULT '' NOT NULL,
	`education_level` text DEFAULT '' NOT NULL,
	`languages` text DEFAULT '' NOT NULL,
	`sectors` text DEFAULT '' NOT NULL,
	`salary_min` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
