CREATE TABLE `checkout_locks` (
	`key` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`intent_id` text,
	`type` text NOT NULL,
	`detail` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `purchase_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`record` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `purchase_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `purchase_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`platform` text NOT NULL,
	`order_number` text NOT NULL,
	`record` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `purchase_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_intent_unique` ON `purchase_orders` (`intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_platform_number_unique` ON `purchase_orders` (`platform`,`order_number`);--> statement-breakpoint
CREATE TABLE `purchase_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`record` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `purchase_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submission_attempts` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
