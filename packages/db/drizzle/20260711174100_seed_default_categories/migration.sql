INSERT OR IGNORE INTO `categories` (`id`, `name`, `createdAt`, `updatedAt`)
VALUES
  ('general', 'General', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('medicine', 'Medicine', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('cosmetics', 'Cosmetics', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
