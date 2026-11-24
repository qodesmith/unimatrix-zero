CREATE TABLE `system_prompt_library` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `system_prompts` (`id`, `hash`, `text`, `created_at`) VALUES ('01a20d9e-0a3b-74da-ab98-77a122bff26a', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '', 1795999978000);
--> statement-breakpoint
CREATE TABLE `__new_trees` (
	`id` text PRIMARY KEY,
	`title` text,
	`unseen_failure` integer DEFAULT false NOT NULL,
	`system_prompt_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_trees_system_prompt_id_system_prompts_id_fk` FOREIGN KEY (`system_prompt_id`) REFERENCES `system_prompts`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_trees` (`id`, `title`, `unseen_failure`, `system_prompt_id`, `created_at`) SELECT `id`, `title`, `unseen_failure`, (SELECT `id` FROM `system_prompts` WHERE `hash` = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), `created_at` FROM `trees`;
--> statement-breakpoint
DROP TABLE `trees`;
--> statement-breakpoint
ALTER TABLE `__new_trees` RENAME TO `trees`;
