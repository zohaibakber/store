# Local pharmacy implementation plan

Status: product direction revised on 2026-10-05, implementation in progress.

This plan targets single-location pharmacies and medical stores in Pakistan using one shared computer. The vendor issues a one-year licence. A licensed shop works locally with no account, sign-in, or connection, and staff use PINs. The cloud has one optional job, which is keeping a backup for the few shops that want one.

The product behavior in the first table is confirmed. The defaults in the second table are implementation choices that the owner of this plan has not ruled on yet. Storage boundaries, module ownership, and release gates are recommendations.

## Preserve the agreed product behavior

| Area                | Confirmed behavior                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence             | The vendor issues a licence that is valid for one year. A licensed installation needs no account, sign-in, or connection during that year.                                |
| Renewal             | When the licence expires the shop renews it with a new licence from the vendor. Renewal never touches shop data.                                                          |
| Cloud               | The cloud is used for backup only. Few shops need it, so it must cost nothing for shops that do not use it. PlanetScale and the Postgres sync authority are removed.      |
| Staff               | Owner, Manager, and Cashier are local staff roles. The owner creates the other staff. Start locked on every launch. Verify PINs locally.                                  |
| Locking             | Auto-lock after 15 minutes by default, configurable by the owner.                                                                                                         |
| Permissions         | Owner manages settings and staff. Manager handles purchasing, returns, stock corrections, and reports. Cashier sells, records customer payments, and reprints receipts.   |
| Cashier freedoms    | Cashiers can issue refunds without approval, make credit sales without credit limits, and change selling prices and discounts. Attribute each action to the staff member. |
| Draft sales         | Drafts belong to their originating cashier. Owner or Manager can explicitly hand them over. Record the starter, handover, and completer.                                  |
| Reports             | Shop-wide profit, expenses, and cash-flow reports are available to Owner and Manager. Cashiers can see customer balances needed for their work.                           |
| Money               | Include customer udhaar and supplier ledgers, opening balances, partial payments, and statements. Record cash, card, Easypaisa, JazzCash, and bank transfer manually.     |
| Cash drawer         | One shared drawer, opening cash, cash movements, and daily closing. Attribute transactions to staff.                                                                      |
| Medicine quantities | Support units, optional strips, and boxes or packs.                                                                                                                       |
| Prices              | Store purchase cost and selling prices per batch, with product defaults when batch prices are absent.                                                                     |
| Batch selection     | Automatically choose the earliest-expiring eligible batch. Allow staff to choose another eligible batch.                                                                  |
| Sale restrictions   | No role can sell expired batches. Block sales that exceed recorded stock until Owner or Manager corrects stock. There is no expired-stock approval override.              |
| Missing expiry      | Import missing expiry as unknown, flag it for review, and allow sales with a warning.                                                                                     |
| Barcodes            | Persist and edit product codes and support scanner lookup. Defer label printing.                                                                                          |
| Stocktake           | Count products, an aisle, or the whole shop. Review discrepancies before audited corrections. Sales and deliveries continue during counting.                              |
| Supplier claims     | Include supplier returns and expiry claims. Track supplier responses, credits, and replacement goods.                                                                     |
| Migration           | Target Abuzar, Candela, MARS, and Excel or CSV. Import current products, batches, stock, prices, customers, suppliers, and opening balances into an empty shop database.  |
| Migration history   | Keep past transactions in the original software. Handle returns for pre-migration sales there for the first release.                                                      |
| Migration cutover   | Detect and preview beforehand. Pause transactions in the old software for a final consistent export and import.                                                           |
| Local backups       | Local file backups are manual only.                                                                                                                                       |
| Deferred work       | FBR integration, payment integrations, label printing, historical transaction migration, and returns against pre-migration sales.                                         |

## Defaults chosen in this revision

Each row is a product call that follows from the confirmed behavior but was not stated. The plan proceeds on the default. Changing one changes only the phase named in the row.

| Decision                | Default                                                                                                                                                                                     | Phase |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Live multi-device sync  | Removed from the product. One computer per shop. The sync protocol, its server authority, and live notifications are deleted, not ported.                                                   | 2     |
| Backup storage          | R2 holds backup files. No Durable Object is needed. See [Use R2 for backups](#use-r2-for-backups).                                                                                          | 7     |
| Licence delivery        | A signed licence the owner pastes or opens as a file. The app verifies it offline, so a new installation never needs a connection.                                                          | 1     |
| Licence and computers   | A licence names a shop, not a computer. It is not locked to hardware, so a replacement computer works offline. Usage reports show a licence that appears on several installations.          | 1     |
| Before a licence exists | The app shows only the licence screen. There is no trial mode.                                                                                                                              | 1     |
| At expiry               | Warn from 30 days before. Keep working for 14 days after expiry with a daily reminder. After that the app is read-only: viewing, reports, receipt reprints, and backups work, sales do not. | 1     |
| Owner recovery          | The offline recovery code resets the owner PIN. If that is also lost, the vendor issues a signed one-time reset code for that licence. There is no online owner identity any more.          | 1     |
| Replacement computer    | Install, enter the licence, restore a backup file or the cloud backup.                                                                                                                      | 7     |
| Who gets cloud backup   | A flag in the licence turns cloud backup on. The licence is the only credential the backup service accepts.                                                                                 | 7     |
| Cloud backup schedule   | Hourly when changes exist and the computer is online, with an owner-configurable interval and a last-success timestamp.                                                                     | 7     |
| Usage reporting         | Report licence, installation, app version, last activity, and a coarse staff count when the computer happens to be online. Never report business contents or feature use.                   | 7     |
| Mobile app              | Not part of this product. It only works through sync, so it is removed with sync.                                                                                                           | 2     |
| Online helpers          | Invoice extraction and product scan stay optional online features. They accept the licence instead of a session.                                                                            | 2     |

## What this revision removes

| Removed                                                              | Replaced by                                 | What is lost                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Accounts, sign-in, Google OAuth, one-time codes, sessions            | The licence                                 | Nothing a single-computer shop uses.                                                        |
| Organizations, team members, invitations, the workspace switcher     | Local staff with PINs                       | Staff identities that exist outside one computer.                                           |
| The auth Worker and its D1 schema                                    | A small licence registry                    | Remote sign-out and session revocation.                                                     |
| Postgres authority, Hyperdrive, PlanetScale and Neon                 | Nothing                                     | A second authoritative copy of every command within seconds.                                |
| The planned Durable Object authority and the organization migration  | Nothing                                     | Nothing. It was never built.                                                                |
| Push, pull, digests, snapshots, retention, registration, live socket | Nothing                                     | Two computers sharing one shop. Cloud recovery point moves from seconds to the last backup. |
| The publish flow that moved a local workspace into an organization   | Nothing                                     | Nothing once organizations are gone.                                                        |
| The mobile app                                                       | Nothing                                     | Phone access to the shop.                                                                   |
| The activation grant and backup-bound offline activation             | The licence, which already verifies offline | Nothing.                                                                                    |

Every later phase gets simpler as a result. A pharmacy rule is written once in the local authority. There is no second authority to keep in agreement, no digest or snapshot version to bump, and no schema negotiation with older clients.

## Build on the current implementation

The existing app already has local workspaces, a SQLite local authority, batches, pack and unit stock, purchasing, receipts, multiple sale drafts, file backup and restore, CSV import, and inventory insights. Extend those capabilities instead of creating parallel implementations.

These files establish the current boundaries:

- [Architecture](architecture.md) describes the current Postgres authority, which Phase 2 removes.
- [Local authority](../packages/sync/src/local-authority.ts) already decides and commits commands for a local workspace without a server. After Phase 2 it is the only authority.
- [Local access policy](../apps/web/src/host-access.ts) currently permits local workspaces without an account. The licence gate replaces it.
- [Desktop auth](../apps/desktop/electron/auth.ts) and the [auth Worker](../apps/auth) hold the account flows that Phase 2 deletes.
- [Server inventory](../apps/server/src/inventory) and [live fan-out](../apps/server/src/live) hold the Postgres authority and notifications that Phase 2 deletes.
- [Shared inventory schema](../packages/db/src/shared/store.schema.ts) has product prices and batch stock. Customer ledgers, payments, strips, and batch prices need additions.
- [Replica schema](../packages/db/src/replica/schema.ts) is the device database. Staff, staff events, and settings are added here so they travel in every backup.
- [Draft model](../apps/web/src/lib/sale-drafts.ts) needs staff ownership and handover records.
- [Desktop backup](../apps/desktop/electron/replica-backup.ts) already stages, validates, and swaps local backups. Cloud backup reuses that path and adds only transport.
- [Header status](../apps/web/src/lib/inventory/sync-status.tsx) shows an action only when something needs attention. Keep its storage-error recovery when the sync states go.

## Keep the cloud small

| Component     | Responsibility                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Device SQLite | Everything the shop owns: inventory, transactions, ledgers, staff, audit records, drafts, and settings.         |
| Licence file  | The signed licence, kept beside the database in the app's private data directory, not inside the database.      |
| One Worker    | Verifies a licence signature, then serves backup upload and download, usage reports, and the online helpers.    |
| R2            | Backup files and one manifest per shop.                                                                         |
| D1            | The licence registry and usage summaries. The account and organization tables are dropped.                      |
| Operator tool | Issues and renews licences and owner reset codes with the vendor's private key. The key never reaches a Worker. |

The Worker holds no session state and no business rules. It trusts a request because the licence signature verifies and the registry has not revoked that licence. Shop data reaches the cloud only as an encrypted backup file.

### Use R2 for backups

A backup is one whole file. R2 stores whole files, and SQLite-backed Durable Objects cap a row at 2 MB, so a database stored in a Durable Object would need chunking, reassembly, and its own integrity checks. R2 needs none of that. Its free tier covers 10 GB of storage with free egress, and storage past that is $0.015 per GB each month. A Durable Object would add a class, a migration, and a routing rule and give nothing back, because one shop uploads from one computer and a single manifest object written last is already atomic. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Phase 1: Add the licence and local staff access

### Licence

- Define a versioned licence holding a licence id, shop id, shop name, issue date, expiry date, a cloud-backup flag, and the id of the signing key. Sign it with Ed25519.
- Verify the licence in the desktop main process against public keys shipped in the app. Keep the keys for older licences through key rotation.
- Store the licence outside the workspace database so that restoring a backup cannot bring back an older licence.
- Derive one licence state: missing, valid, expiring, in grace, or expired. Serve it to the renderer as a named `DesktopRpcs` member.
- Enforce the read-only state where commands commit, in the process that owns the database, not only in the renderer.
- Guard against a clock set backwards. Record the latest time the app has seen, and judge expiry against the later of that and the system clock.
- Renew by entering a new licence for the same shop id. Refuse a licence for a different shop on a database that already belongs to one.
- Build the operator tool that issues, renews, and lists licences and signs owner reset codes. Record each issued licence in the registry.

### Staff

- Use local staff records and enforce role permissions at command boundaries. The renderer never supplies the acting staff id. The process that owns the database knows who unlocked it.
- Store only PIN verifiers, with attempt throttling. Validate PINs in the owning process.
- Start locked and apply the configurable 15-minute idle lock. Preserve drafts across locking and switching.
- Attribute every command to the staff member who was unlocked when it ran. Leave commands from before staff existed unattributed instead of assigning them to someone.
- Keep drafts per staff member. Record explicit Owner or Manager handovers and preserve starter and completer attribution.
- Provide owner recovery through the offline recovery code, which is shown once and replaced on use, and through the vendor's signed reset code.
- Record staff-management and recovery actions in a local audit history that the owner can read.
- Gate backup, restore, and settings to the owner. Keep restore reachable when the database cannot open.
- Preserve existing local data during the upgrade. A shop with data and no staff gets the owner-setup screen once.

The release gate is a fresh installation activated offline, relaunch with no connection, owner setup, staff switching, an unauthorized command refused by the owning process, owner recovery by both codes, an expired licence going read-only after the grace period, a renewal restoring sales, and a clock set backwards not extending the licence.

Primary ownership: `apps/desktop/electron` for the licence and worker wiring, `packages/contracts` for licence and staff contracts, `packages/client-db` for the staff gate, `packages/db/src/replica` for staff tables, `apps/web/src/session`, and the lock, setup, and staff screens in `apps/web`.

## Phase 2: Remove accounts and cloud sync

Subtract before building pharmacy features, so each feature is written against one authority.

1. Convert every existing organization workspace on a device to a local shop in place. Let its queued commands settle against the server first, then mark the database as locally owned. The device already holds a full copy, so nothing is downloaded.
2. Take a final export of each Postgres organization and keep it for a defined window as a safety copy.
3. Cut the network path on the client: registration, upload, pull, digests, snapshots, the live socket, and their scheduling.
4. Delete the sign-in, sign-up, organization, team, invitation, workspace-switcher, and publish surfaces in the renderer, with their preload channels and main-process handlers.
5. Delete the server inventory authority, live fan-out, Hyperdrive binding, Postgres migrations, and the auth Worker. Reduce D1 to the licence registry.
6. Move the online helpers to licence authorization and rate-limit them per licence.
7. Remove the mobile app and the in-process store wiring that exists only for it.
8. Collapse the client layers that existed only to reconcile with a server, such as pending overlays and receipt replay from the server. Keep `operationId` idempotency, because a double submit must still commit once. Judge each layer by deleting it and seeing what breaks.
9. Decommission PlanetScale and Neon after the retention window. Update [architecture.md](architecture.md), the Effect profile, `AGENTS.md`, and the affected tests.

Do steps 1 and 2 in a release that still contains sync, so a device can settle its queue before the server goes away. Steps 3 to 9 ship after every known device has converted.

The release gate is an upgraded organization device that opens as a local shop with the same stock, invoices, and purchasing history, a fresh installation that never contacts a server, the packaged app containing no auth or sync code, and the deployed stage containing no Postgres or Hyperdrive resources. Measure startup and checkout latency before and after.

Primary ownership: `packages/sync`, `packages/client-db`, `apps/desktop/electron`, `apps/web/src/session` and the auth and settings screens, `apps/server`, `apps/auth`, `apps/mobile`, `packages/auth`, `packages/workspace`, and `alchemy.run.ts`.

## Phase 3: Add pharmacy stock rules

- Extend shared contracts, SQLite migrations, local decisions, and reads together.
- Define exact integer conversions between units, optional strips, and boxes. Preserve pack-opening behavior and reject invalid conversion factors.
- Add persisted product codes and scanner lookup. Reuse the existing product picker, medicine composition, strength, and catalog search.
- Add batch purchase costs and selling prices. Snapshot effective prices and quantity conversions on transaction lines so later edits do not rewrite history.
- Allocate from eligible known-expiry batches in earliest-expiry order. Use unknown-expiry stock after known eligible stock, with a visible warning. Preserve manual eligible-batch selection.
- Enforce expired-batch and insufficient-stock restrictions at command commit, including manual batch selection. Use the shop's calendar date.
- Distinguish missing expiry from a valid date. Define month-only expiry interpretation and migrated date parsing in the source mapping rather than guessing during checkout.
- Explain allocation across batches when prices differ, and record each allocation with its actual price. Keep existing cashier price and discount freedoms.

The release gate is quantity conversion across repeated sales and returns, batch-price history, scanner lookup, expiry-boundary checks, unknown-expiry warnings, and negative-stock refusal.

Primary ownership: `packages/contracts/src/store`, `packages/db/src/shared/store.schema.ts`, replica migrations, the local authority, product screens, and invoice screens.

## Phase 4: Add ledgers, payments, refunds, and the cash drawer

- Add customer records, opening-balance entries, supplier balance entries, payment records, and payment allocations. Derive balances from entries rather than a separately editable total.
- Define currency precision and rounding once. Reconcile existing stored prices before migration, and keep payment, ledger, receipt, and report arithmetic consistent.
- Add manually recorded payment methods, partial settlement, and customer credit sales without enforced credit limits. Preserve cashier access to customer balances.
- Post the sale, stock movement, payment, debt, and drawer effects as one idempotent command. Apply the same rule to refunds and supplier settlement.
- Snapshot paid prices and costs for refund and profit calculations. Limit returns to the remaining returnable quantity of a Tabaaq sale.
- Let cashiers refund without approval. Link refunds to their sale and staff actor. Record the stock disposition without making expired returned stock sellable.
- Keep pre-migration sale returns in the old software. Show that boundary in the return flow.
- Add one shared drawer with opening cash, receipts, payouts, and daily closing. Keep non-cash payments outside physical cash totals.
- Add expense entries and Owner and Manager reports for profit, expenses, and cash flow. Enforce report access in named reads, not only navigation.
- Provide customer and supplier statements with opening balances, charges, payments, credits, and running balances.

The release gate is reconciliation of cash sales, credit sales, partial payments, refunds, supplier credits, and expenses. Duplicate commands and interruptions must not charge a ledger or drawer twice. Refunds must not exceed the sold quantity or refund recorded payments twice.

Primary ownership: shared contracts and schemas, local command decisions, `InventoryReads`, `InventoryInsights`, invoice and purchasing screens, and new ledger and drawer screens.

## Phase 5: Add stocktake and supplier claims

- Persist scoped count sessions for products, an aisle, or the whole shop. Record each count's batch, quantity, actor, and count position.
- Let sales, deliveries, returns, and other stock movements continue. Reconcile movements after each count before calculating the final adjustment.
- Detect conflicting corrections and require review instead of overwriting stock changed since the count. Commit accepted discrepancies once, with an audit reason.
- Add supplier returns and expiry claims with batch quantities, dispatch, response, and settlement records.
- Separate a proposed claim from actual stock dispatch. Record the stock movement when goods leave, and post credit or replacement goods only on the corresponding settlement.
- Link replacement goods to normal batch receipt behavior. Prevent retries from deducting returned stock or applying supplier credits twice.

The release gate includes a count with intervening sales and deliveries, interruption and resume, and one supplier claim settled through credit and another through replacement goods.

Primary ownership: purchasing and stock contracts, local commands, named inventory reads, stock movement history, and purchasing UI.

## Phase 6: Build first-run migration

Abuzar, Candela, MARS, and spreadsheets remain launch targets. Native adapters require real, sanitized sample backups or exports and identified source versions. Do not advertise a source version as supported before its import passes reconciliation. Missing samples block that adapter, not the generic spreadsheet importer.

- Add a desktop detection boundary for recognized installations and data locations. Offer an explicit file or export selection when detection fails. Keep external-software access read-only.
- Use a source adapter to produce one canonical staging model. Support source-specific product codes, units, batch prices, missing expiry, customers, suppliers, and opening balances.
- Preview mappings, counts, stock totals, values, ledger balances, unresolved rows, and duplicate candidates. Give users actionable corrections.
- Require an empty business database. Owner setup, staff, and the licence do not make the business database non-empty. Recheck emptiness when committing.
- Identify rows using source IDs and a source fingerprint. Make staging and final import resumable and idempotent. Do not guess conversion factors or silently merge ambiguous medicine names.
- Preserve unknown expiry explicitly. For unbatched source stock, create labelled opening-stock records with source provenance. Do not invent batch numbers, expiry dates, or historical invoices.
- Take the final consistent source export after transactions stop in the old software. Build and validate a staged target before activating it through the desktop workspace owner.
- Reconcile stock, prices, customer balances, and supplier balances. Publish one import report with source version, row counts, exceptions, and reconciliation results.
- Leave the original software and files intact. Prevent a failed or partial import from becoming the live workspace.

The release gate is one verified fixture per advertised native source version, plus spreadsheet imports covering invalid rows, duplicate retry, missing expiry, unit conversions, and opening balances. Demonstrate interruption recovery and a final cutover on a realistic shop dataset.

Primary ownership: desktop import services, canonical contracts, local import staging and commands, existing upload/import UI, and first-run setup. Source adapters stay outside shared domain rules.

## Phase 7: Finish backup, usage reporting, and local UI

### Backup and restore

- Treat the device database as the backup. It already contains the business data, staff verifiers, settings, audit history, and drafts. Version the file format and keep the licence out of it.
- Preserve manual file backups. Do not add scheduled or rotating retained local copies.
- For cloud backup, take the same consistent copy the manual backup takes, compress and encrypt it on the device, and upload it to R2 under the shop id. Write the manifest last so a partial upload is never offered for restore.
- Derive the encryption key on the device and include it in the owner's recovery sheet. The Worker and the vendor cannot read a shop's backup. Say plainly in the app that a lost key means a lost cloud backup.
- Run hourly by default when changes exist, the app is running, and connectivity permits. Recheck on relaunch or reconnect and coalesce missed intervals into one current backup.
- Set last-success only after the complete file is stored and its checksum matches. Show it in owner settings.
- Keep a bounded number of cloud copies per shop. Size the default from fixture sizes before release.
- Restore by staging and validating before replacement. Show the selected timestamp and data counts and require confirmation before replacing an existing workspace.
- Accept an upload or download only for the shop id in a verified, unrevoked licence with the backup flag set.

### Basic usage reporting

- Define allowlisted summaries for licence id, installation identity, app version, last activity, and coarse active staff count.
- Queue summaries offline and upload idempotently when a connection exists. Do not use business commands, product contents, customer records, amounts, or feature-click logs as telemetry.
- Provide a protected operator view of licences, expiry dates, installations per licence, versions, and reported staff counts.
- Show last-seen coverage so offline shops are not presented as proven churn. A shop that never connects reports nothing, and that is acceptable.

### Local user experience

- Show the shop name, the active staff member, and the licence status where the account menu used to be.
- Show the licence expiry warning to the owner only, and the read-only state to everyone.
- Put the cloud backup switch and last-success time in owner settings, hidden when the licence has no backup flag.
- Retain actionable local save, storage-full, and corruption recovery states.
- Verify the local path from lock screen to sale, payment, receipt, staff switch, stocktake, statement, and backup on a low-end desktop.

The release gate includes a cloud backup with an interrupted upload, a restore on a replacement computer from the cloud and from a file, a backup refused for a licence without the flag, and queued usage reporting with no business contents. Confirm that a shop that never connects can sell, back up to a file, and renew its licence.

## Preserve repository boundaries and validate each release

- Use named `InventoryReads`, `InventoryStore`, `InventoryInsights`, and `DesktopRpcs` members over Effect RPC. Do not send SQL or query IR through renderer boundaries. Keep preload IPC within its existing open, close, backup, and restore responsibilities.
- Financial corrections use domain reversal records rather than a `deletedAt` scheme.
- Follow the Effect skill and [repo profile](effect-profile.md). Validate external data at boundaries and keep domain decisions independent of storage.
- For web UI implementation, use COSS, Inter, the agreed size and weight scale, and Hugeicons. Keep registry-owned UI primitives intact.
- Keep meaningful tests for financial, licence, and permission invariants. Use temporary tests for exploratory checks instead of adding a test file for every UI change.

Run `vp install`, `vp check`, `vp run -r check`, and `vp test` for implementation releases. Run `vp run lint:design` after web UI changes and package the desktop with `vp run --filter @store/desktop build`. Verify the backup service against the real deployed dev stage before production. Measure startup and checkout latency before and after changes.

Release in this order: licence and staff access, removal of accounts and sync, pharmacy stock rules, financial workflows, stocktake and claims, migration adapters, then cloud backup and usage reporting. Collect source fixtures early.

Do not assign calendar estimates until source fixtures establish the remaining work. The main external dependencies are sanitized source data, scanner and receipt-printer hardware, and a realistic shop dataset for migration and backup sizing.
