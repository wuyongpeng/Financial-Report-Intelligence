CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`code` text NOT NULL,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`report_type` text NOT NULL,
	`published_at` text NOT NULL,
	`discovered_at` text NOT NULL,
	`downloaded_at` text,
	`parsed_at` text,
	`online_at` text,
	`pdf_url` text NOT NULL,
	`pdf_key` text,
	`pdf_sha256` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`parse_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_announcements_source_id` ON `announcements` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_announcements_code_published` ON `announcements` (`code`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_announcements_status` ON `announcements` (`status`);--> statement-breakpoint
CREATE TABLE `companies` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`exchange` text NOT NULL,
	`industry` text NOT NULL,
	`rank` integer NOT NULL,
	`weight` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_companies_enabled_rank` ON `companies` (`enabled`,`rank`);--> statement-breakpoint
CREATE TABLE `financial_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` text NOT NULL,
	`code` text NOT NULL,
	`period` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`source_page` integer,
	`source_label` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_metrics_announcement_metric` ON `financial_metrics` (`announcement_id`,`metric`);--> statement-breakpoint
CREATE INDEX `idx_metrics_code_period` ON `financial_metrics` (`code`,`period`);--> statement-breakpoint
CREATE TABLE `ingest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`downloaded_count` integer DEFAULT 0 NOT NULL,
	`source_health` text DEFAULT '{}' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `source_health` (
	`source` text PRIMARY KEY NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`circuit_open_until` text,
	`last_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL
);
