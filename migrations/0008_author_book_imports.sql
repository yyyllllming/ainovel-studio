ALTER TABLE `author_text_imports` ADD `source_kind` text NOT NULL DEFAULT 'plain_import';
--> statement-breakpoint
ALTER TABLE `author_text_imports` ADD `book_card_status` text NOT NULL DEFAULT 'idle';
--> statement-breakpoint
ALTER TABLE `author_text_imports` ADD `last_generation_error` text;
--> statement-breakpoint
CREATE TABLE `author_book_import_previews` (
  `id` text PRIMARY KEY NOT NULL,
  `author_card_id` text NOT NULL REFERENCES `author_cards`(`id`) ON UPDATE no action ON DELETE no action,
  `title` text NOT NULL,
  `author_name` text,
  `original_file_name` text NOT NULL,
  `media_type` text NOT NULL,
  `source_hash` text NOT NULL,
  `word_count` integer NOT NULL,
  `encoding` text NOT NULL,
  `parse_confidence` text NOT NULL,
  `parser_mode` text NOT NULL,
  `chapter_count` integer NOT NULL,
  `warnings_json` text NOT NULL DEFAULT '[]',
  `sample_plan_json` text NOT NULL DEFAULT '{"indexes":[],"skippedShort":[],"total":0}',
  `status` text NOT NULL DEFAULT 'active',
  `apply_status` text NOT NULL DEFAULT 'pending',
  `import_id` text,
  `book_card_id` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `author_book_import_previews_author_idx` ON `author_book_import_previews` (`author_card_id`);
