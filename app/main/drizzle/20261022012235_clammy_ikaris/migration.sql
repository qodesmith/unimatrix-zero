CREATE TABLE `providers` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`plan` text NOT NULL,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_provider` ON `providers` (`provider`);