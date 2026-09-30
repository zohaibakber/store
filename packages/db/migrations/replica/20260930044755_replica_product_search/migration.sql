CREATE INDEX `invoices_created_at_idx` ON `invoices` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `invoices_created_at_idx__alt` ON `invoices_standby` (`createdAt`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `products_search` USING fts5(`name`, `composition`, `strength`, content='', contentless_delete=1, tokenize='trigram');
--> statement-breakpoint
CREATE VIRTUAL TABLE `products_search_standby` USING fts5(`name`, `composition`, `strength`, content='', contentless_delete=1, tokenize='trigram');
--> statement-breakpoint
INSERT INTO `products_search` (rowid, `name`, `composition`, `strength`) SELECT rowid, `name`, `composition`, `strength` FROM `products`;
--> statement-breakpoint
INSERT INTO `products_search_standby` (rowid, `name`, `composition`, `strength`) SELECT rowid, `name`, `composition`, `strength` FROM `products_standby`;
--> statement-breakpoint
CREATE TRIGGER `products_search_insert` AFTER INSERT ON `products` BEGIN INSERT INTO `products_search` (rowid, `name`, `composition`, `strength`) VALUES (new.rowid, new.`name`, new.`composition`, new.`strength`); END;
--> statement-breakpoint
CREATE TRIGGER `products_search_delete` AFTER DELETE ON `products` BEGIN DELETE FROM `products_search` WHERE rowid = old.rowid; END;
--> statement-breakpoint
CREATE TRIGGER `products_search_update` AFTER UPDATE OF `name`, `composition`, `strength` ON `products` WHEN old.`name` IS NOT new.`name` OR old.`composition` IS NOT new.`composition` OR old.`strength` IS NOT new.`strength` BEGIN DELETE FROM `products_search` WHERE rowid = old.rowid; INSERT INTO `products_search` (rowid, `name`, `composition`, `strength`) VALUES (new.rowid, new.`name`, new.`composition`, new.`strength`); END;
--> statement-breakpoint
CREATE TRIGGER `products_search_insert__alt` AFTER INSERT ON `products_standby` BEGIN INSERT INTO `products_search_standby` (rowid, `name`, `composition`, `strength`) VALUES (new.rowid, new.`name`, new.`composition`, new.`strength`); END;
--> statement-breakpoint
CREATE TRIGGER `products_search_delete__alt` AFTER DELETE ON `products_standby` BEGIN DELETE FROM `products_search_standby` WHERE rowid = old.rowid; END;
--> statement-breakpoint
CREATE TRIGGER `products_search_update__alt` AFTER UPDATE OF `name`, `composition`, `strength` ON `products_standby` WHEN old.`name` IS NOT new.`name` OR old.`composition` IS NOT new.`composition` OR old.`strength` IS NOT new.`strength` BEGIN DELETE FROM `products_search_standby` WHERE rowid = old.rowid; INSERT INTO `products_search_standby` (rowid, `name`, `composition`, `strength`) VALUES (new.rowid, new.`name`, new.`composition`, new.`strength`); END;
