DROP INDEX IF EXISTS `account_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `invitation_organizationId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `invitation_email_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `member_organizationId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `member_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `organization_slug_uidx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `verification_identifier_idx`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
DROP TABLE `invitation`;--> statement-breakpoint
DROP TABLE `member`;--> statement-breakpoint
DROP TABLE `organization`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
DROP TABLE `verification`;