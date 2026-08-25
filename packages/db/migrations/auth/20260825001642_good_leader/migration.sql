CREATE TABLE `auth_rate_limit` (
	`key` text PRIMARY KEY,
	`count` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
