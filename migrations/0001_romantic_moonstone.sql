-- Compatibility migration: retain author import tables for databases that only saw the earlier generated baseline.
CREATE TABLE IF NOT EXISTS `author_book_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`author_card_id` text NOT NULL,
	`title` text NOT NULL,
	`author_name` text,
	`style_card` text NOT NULL,
	`style_profile_json` text DEFAULT '{}' NOT NULL,
	`style_digest` text DEFAULT '' NOT NULL,
	`style_exemplars_json` text DEFAULT '[]' NOT NULL,
	`sampled_excerpts_json` text DEFAULT '[]' NOT NULL,
	`confidence` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`chapter_count` integer DEFAULT 0 NOT NULL,
	`source_file_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`author_card_id`) REFERENCES `author_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `author_book_cards_author_idx` ON `author_book_cards` (`author_card_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `author_text_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`author_card_id` text NOT NULL,
	`title` text NOT NULL,
	`author_name` text,
	`original_file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`source_hash` text NOT NULL,
	`word_count` integer NOT NULL,
	`encoding` text NOT NULL,
	`confidence` text NOT NULL,
	`chapter_count` integer NOT NULL,
	`excerpts_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`author_card_id`) REFERENCES `author_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `author_text_imports_author_idx` ON `author_text_imports` (`author_card_id`);
