ALTER TABLE `trees` ADD `web_search` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `claude_connectors` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `claude_built_in_skills` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `chatgpt_built_in_skills` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `chatgpt_remote_plugins` integer DEFAULT false NOT NULL;