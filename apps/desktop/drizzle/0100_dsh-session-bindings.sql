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
CREATE INDEX `idx_dsh_bindings_scope_lifecycle` ON `dsh_session_bindings` (`host_scope_id`,`lifecycle_state`);