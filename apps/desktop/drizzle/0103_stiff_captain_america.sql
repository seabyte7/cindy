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
CREATE INDEX `idx_dsh_activity_snapshots_scope_sequence` ON `dsh_activity_snapshots` (`host_scope_id`,`sequence`);