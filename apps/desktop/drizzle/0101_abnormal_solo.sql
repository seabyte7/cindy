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
CREATE INDEX `idx_dsh_projection_events_session_sequence` ON `dsh_projection_events` (`cindy_session_id`,`sequence`);