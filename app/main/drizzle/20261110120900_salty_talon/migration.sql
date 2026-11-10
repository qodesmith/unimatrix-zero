CREATE TABLE `compactions` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`session_id` text NOT NULL,
	`boundary_id` text,
	`reply_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_compactions_reply_id_replies_id_fk` FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON DELETE SET NULL
);
