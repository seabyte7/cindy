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
CREATE INDEX `idx_dsh_prompt_receipts_session_state_created` ON `dsh_prompt_receipts` (`cindy_session_id`,`state`,`created_at`);