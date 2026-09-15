CREATE TABLE `dsh_activity_snapshots` (
	`cindy_session_id` text PRIMARY KEY NOT NULL,
	`host_scope_id` text NOT NULL,
	`activity_json` text NOT NULL,
	`activity_sha256` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cindy_session_id`) REFERENCES `dsh_session_bindings`(`cindy_session_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_dsh_activity_snapshots_scope_sequence` ON `dsh_activity_snapshots` (`host_scope_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `dsh_projection_events` (
	`cindy_session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_json` text NOT NULL,
	`event_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`cindy_session_id`, `sequence`),
	FOREIGN KEY (`cindy_session_id`) REFERENCES `dsh_session_bindings`(`cindy_session_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_dsh_projection_events_session_sequence` ON `dsh_projection_events` (`cindy_session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `dsh_prompt_receipts` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`cindy_session_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`stop_reason` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`cindy_session_id`) REFERENCES `dsh_session_bindings`(`cindy_session_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_dsh_prompt_receipts_session_state_created` ON `dsh_prompt_receipts` (`cindy_session_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `dsh_session_bindings` (
	`cindy_session_id` text PRIMARY KEY NOT NULL,
	`runtime_session_id` text NOT NULL,
	`host_scope_id` text NOT NULL,
	`runtime_release_id` text NOT NULL,
	`runtime_version` text NOT NULL,
	`controller_api_version` integer NOT NULL,
	`capability_fingerprint` text NOT NULL,
	`home_mode` text NOT NULL,
	`lifecycle_state` text DEFAULT 'active' NOT NULL,
	`last_projected_sequence` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cindy_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_dsh_bindings_scope_runtime` ON `dsh_session_bindings` (`host_scope_id`,`runtime_session_id`);--> statement-breakpoint
CREATE INDEX `idx_dsh_bindings_scope_lifecycle` ON `dsh_session_bindings` (`host_scope_id`,`lifecycle_state`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `startup_state` text DEFAULT 'ready' NOT NULL;