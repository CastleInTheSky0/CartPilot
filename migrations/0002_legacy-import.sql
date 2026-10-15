CREATE TABLE `access_restrictions` (
	`family` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy_imports` (
	`source_id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL
);
