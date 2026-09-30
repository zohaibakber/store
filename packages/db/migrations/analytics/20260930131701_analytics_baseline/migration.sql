CREATE TABLE `expiring_batch` (
	`runId` integer NOT NULL,
	`productId` text NOT NULL,
	`seq` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`batchJson` text NOT NULL,
	CONSTRAINT `expiring_batch_pk` PRIMARY KEY(`runId`, `productId`, `seq`)
) WITHOUT ROWID, STRICT;
--> statement-breakpoint
CREATE TABLE `insight_alert` (
	`runId` integer NOT NULL,
	`productId` text NOT NULL,
	`kind` text NOT NULL,
	`severityRank` integer NOT NULL,
	`impact` real NOT NULL,
	`alertJson` text NOT NULL,
	CONSTRAINT `insight_alert_pk` PRIMARY KEY(`runId`, `productId`, `kind`)
) WITHOUT ROWID, STRICT;
--> statement-breakpoint
CREATE TABLE `product_insight` (
	`runId` integer NOT NULL,
	`productId` text NOT NULL,
	`name` text NOT NULL,
	`nameKey` text NOT NULL,
	`status` text NOT NULL,
	`abc` text NOT NULL,
	`priority` real NOT NULL,
	`hasOrder` integer NOT NULL,
	`revenue90d` real NOT NULL,
	`unitCost` real,
	`trend` text NOT NULL,
	`periodRevenue7` real NOT NULL,
	`periodUnits7` real NOT NULL,
	`periodRevenue30` real NOT NULL,
	`periodUnits30` real NOT NULL,
	`periodRevenue90` real NOT NULL,
	`periodUnits90` real NOT NULL,
	`valueAtCost` integer NOT NULL,
	`valueAtRetail` integer NOT NULL,
	`deadStockValue` integer NOT NULL,
	`expiryRiskValue` integer NOT NULL,
	`expiredValue` integer NOT NULL,
	`reorderCost` integer NOT NULL,
	`missingCost` integer NOT NULL,
	`insightJson` text NOT NULL,
	CONSTRAINT `product_insight_pk` PRIMARY KEY(`runId`, `productId`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `published` (
	`id` integer PRIMARY KEY,
	`runId` integer NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`completedAt` integer NOT NULL,
	`generatedAt` integer NOT NULL,
	`sourceGeneration` text NOT NULL,
	`sourceVersion` integer NOT NULL,
	`policyVersion` text NOT NULL,
	`algorithmVersion` integer NOT NULL,
	`today` integer NOT NULL,
	`utcOffsetMinutes` integer NOT NULL,
	`productCount` integer NOT NULL,
	`summaryJson` text NOT NULL,
	CONSTRAINT "published_singleton" CHECK("id" = 1)
) STRICT;
--> statement-breakpoint
CREATE TABLE `run_sequence` (
	`id` integer PRIMARY KEY AUTOINCREMENT
) STRICT;
--> statement-breakpoint
CREATE TABLE `work_product` (
	`runId` integer NOT NULL,
	`productId` text NOT NULL,
	`stagedJson` text NOT NULL,
	CONSTRAINT `work_product_pk` PRIMARY KEY(`runId`, `productId`)
) WITHOUT ROWID, STRICT;
--> statement-breakpoint
CREATE TABLE `work_sales` (
	`runId` integer NOT NULL,
	`productId` text NOT NULL,
	`day` integer NOT NULL,
	`units` real NOT NULL,
	`revenue` real NOT NULL,
	CONSTRAINT `work_sales_pk` PRIMARY KEY(`runId`, `productId`, `day`)
) WITHOUT ROWID, STRICT;
--> statement-breakpoint
CREATE INDEX `expiring_batch_expiry_idx` ON `expiring_batch` (`runId`,`expiresAt`,`productId`,`seq`);--> statement-breakpoint
CREATE INDEX `insight_alert_rank_idx` ON `insight_alert` (`runId`,`severityRank`,"impact" DESC);--> statement-breakpoint
CREATE INDEX `product_insight_restock_idx` ON `product_insight` (`runId`,"priority" DESC,`nameKey`,`productId`,`status`,`hasOrder`);