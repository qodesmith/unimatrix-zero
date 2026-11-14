CREATE TABLE `attachments` (
	`id` text PRIMARY KEY,
	`sha256` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_attachments` (
	`id` text PRIMARY KEY,
	`prompt_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `fk_prompt_attachments_prompt_id_prompts_id_fk` FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_prompt_attachments_attachment_id_attachments_id_fk` FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_attachments_position` ON `prompt_attachments` (`prompt_id`,`position`);