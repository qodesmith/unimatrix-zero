CREATE TABLE `prompts` (
	`id` text PRIMARY KEY,
	`tree_id` text NOT NULL,
	`parent_reply_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_prompts_tree_id_trees_id_fk` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_prompts_parent_reply_id_replies_id_fk` FOREIGN KEY (`parent_reply_id`) REFERENCES `replies`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY,
	`tree_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`content` text NOT NULL,
	`system_prompt_id` text NOT NULL,
	`session_id` text,
	`session_turn_id` text,
	`context_size` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_replies_tree_id_trees_id_fk` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_replies_prompt_id_prompts_id_fk` FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_replies_system_prompt_id_system_prompts_id_fk` FOREIGN KEY (`system_prompt_id`) REFERENCES `system_prompts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_prompts` (
	`id` text PRIMARY KEY,
	`hash` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY,
	`json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trees` (
	`id` text PRIMARY KEY,
	`title` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replies_prompt_id` ON `replies` (`prompt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key` ON `settings` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `system_prompts_hash` ON `system_prompts` (`hash`);