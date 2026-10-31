CREATE TABLE `layout` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layout_key` ON `layout` (`key`);