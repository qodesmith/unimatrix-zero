CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`project_key` text NOT NULL,
	`session_id` text NOT NULL,
	`subpath` text NOT NULL,
	`position` integer NOT NULL,
	`uuid` text,
	`entry` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_files` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`project_key` text NOT NULL,
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`data` blob NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_entries_position` ON `session_entries` (`provider`,`project_key`,`session_id`,`subpath`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_entries_uuid` ON `session_entries` (`provider`,`project_key`,`session_id`,`subpath`,`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_files_path` ON `session_files` (`provider`,`project_key`,`session_id`,`path`);