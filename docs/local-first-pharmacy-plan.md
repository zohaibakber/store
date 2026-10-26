# Local pharmacy implementation plan

Status: product direction revised on 2026-10-05, implementation in progress.

This plan targets single-location pharmacies and medical stores in Pakistan using one shared computer. The vendor issues a one-year licence. A licensed shop works locally with no account, sign-in, or connection. An owner who works alone uses the app with no PIN. An owner with employees turns staff on, and then everyone unlocks with a PIN. The cloud has one optional job, which is keeping a backup for the few shops that want one.

The product behavior in the first table is confirmed. The defaults in the second table are implementation choices that the owner of this plan has not ruled on yet. Storage boundaries, module ownership, and release gates are recommendations.

## Preserve the agreed product behavior

| Area                | Confirmed behavior                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence             | The vendor issues a licence that is valid for one year. A licensed installation needs no account, sign-in, or connection during that year.                                                                                                                                    |
| Renewal             | When the licence expires the shop renews it with a new licence from the vendor. Renewal never touches shop data.                                                                                                                                                              |
| Cloud               | The cloud is used for backup only, and only for shops that opt in. Few shops will, so it must cost nothing for shops that do not. PlanetScale and the Postgres sync authority are removed.                                                                                    |
| Staff               | Staff is optional. Many owners run the shop alone, and they never see a PIN or a lock screen. When the owner turns staff on, Owner, Manager, and Cashier are local roles, the owner creates the others, the app starts locked on every launch, and PINs are verified locally. |
| Locking             | With staff on, auto-lock after 15 minutes by default, configurable by the owner.                                                                                                                                                                                              |
| Permissions         | Owner manages settings and staff. Manager handles purchasing, returns, stock corrections, and reports. Cashier sells, records customer payments, and reprints receipts.                                                                                                       |
| Cashier freedoms    | Cashiers can issue refunds without approval, make credit sales without credit limits, and change selling prices and discounts. Attribute each action to the staff member.                                                                                                     |
| Draft sales         | Drafts belong to their originating cashier. Owner or Manager can explicitly hand them over. Record the starter, handover, and completer.                                                                                                                                      |
| Reports             | Shop-wide profit, expenses, and cash-flow reports are available to Owner and Manager. Cashiers can see customer balances needed for their work.                                                                                                                               |
| Money               | Include customer udhaar and supplier ledgers, opening balances, partial payments, and statements. Record cash, card, Easypaisa, JazzCash, and bank transfer manually.                                                                                                         |
| Cash drawer         | One shared drawer, opening cash, cash movements, and daily closing. Attribute transactions to staff.                                                                                                                                                                          |
| Medicine quantities | Support units, optional strips, and boxes or packs.                                                                                                                                                                                                                           |
| Prices              | Store purchase cost and selling prices per batch, with product defaults when batch prices are absent.                                                                                                                                                                         |
| Batch selection     | Automatically choose the earliest-expiring eligible batch. Allow staff to choose another eligible batch.                                                                                                                                                                      |
| Sale restrictions   | No role can sell expired batches. Block sales that exceed recorded stock until Owner or Manager corrects stock. There is no expired-stock approval override.                                                                                                                  |
| Missing expiry      | Import missing expiry as unknown, flag it for review, and allow sales with a warning.                                                                                                                                                                                         |
| Barcodes            | Persist and edit product codes and support scanner lookup. Defer label printing.                                                                                                                                                                                              |
| Stocktake           | Count products, an aisle, or the whole shop. Review discrepancies before audited corrections. Sales and deliveries continue during counting.                                                                                                                                  |
| Supplier claims     | Include supplier returns and expiry claims. Track supplier responses, credits, and replacement goods.                                                                                                                                                                         |
| Migration           | Target Abuzar, Candela, MARS, and Excel or CSV. Import current products, batches, stock, prices, customers, suppliers, and opening balances into an empty shop database.                                                                                                      |
| Migration history   | Keep past transactions in the original software. Handle returns for pre-migration sales there for the first release.                                                                                                                                                          |
| Migration cutover   | Detect and preview beforehand. Pause transactions in the old software for a final consistent export and import.                                                                                                                                                               |
| Local backups       | Local file backups are manual only.                                                                                                                                                                                                                                           |
| Deferred work       | FBR integration, payment integrations, label printing, historical transaction migration, and returns against pre-migration sales.                                                                                                                                             |

## Defaults chosen in this revision

Each row is a product call that follows from the confirmed behavior but was not stated. The plan proceeds on the default. Changing one changes only the phase named in the row.

| Decision                        | Default                                                                                                                                                                                                                                                                                                                     | Phase |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Live multi-device sync          | Removed from the product. One computer per shop. The sync protocol, its server authority, and live notifications are deleted, not ported.                                                                                                                                                                                   | 2     |
| Backup storage                  | One Durable Object per shop keeps the backup ledger for the last 30 days: the list of restore points, their order, and what may be deleted. R2 holds every backup file. See [Split backup between a Durable Object and R2](#split-backup-between-a-durable-object-and-r2).                                                  | 7     |
| Licence delivery                | A signed licence the owner pastes or opens as a file. The app verifies it offline, so a new installation never needs a connection.                                                                                                                                                                                          | 1     |
| Licence and computers           | A licence names a shop, not a computer. It is not locked to hardware, so a replacement computer works offline. Usage reports show a licence that appears on several installations.                                                                                                                                          | 1     |
| Before a licence exists         | The app shows only the licence screen. There is no trial mode.                                                                                                                                                                                                                                                              | 1     |
| At expiry                       | Warn from 30 days before. Keep working for 14 days after expiry with a daily reminder. After that the app is read-only: viewing, reports, receipt reprints, file backup, and restore work, sales do not. Cloud backup makes one last upload at that point.                                                                  | 1     |
| Owner recovery                  | The offline recovery code resets the owner PIN. If that is also lost, the vendor issues a signed one-time reset code for that licence. There is no online owner identity any more.                                                                                                                                          | 1     |
| Turning staff on                | Staff is off until the owner turns it on in Settings. Turning it on asks for the owner's name and PIN. The owner can turn it off again.                                                                                                                                                                                     | 1     |
| Replacement computer            | Install, enter the licence, restore a backup file or the cloud backup.                                                                                                                                                                                                                                                      | 7     |
| Who gets cloud backup           | A flag in the licence turns cloud backup on. The licence is the only credential the backup service accepts. It can add and read backups. It cannot delete them.                                                                                                                                                             | 7     |
| Cloud backup schedule           | Changes upload every hour while the shop is trading, at day close, and on demand. A full copy uploads at least weekly. The owner can choose a slower interval.                                                                                                                                                              | 7     |
| Restore points kept             | Every hourly point for 30 days, then one full copy a month for a year. The newest restore point is never deleted by age.                                                                                                                                                                                                    | 7     |
| Backup key                      | The vendor derives each shop's backup key and puts it in the licence with a key version, so a shop that lost its computer restores with the licence alone. The vendor can therefore read a backup. The key never reaches the Worker. A leaked licence is answered by revoking it and issuing one with the next key version. | 7     |
| Backup after the licence lapses | One last upload when the app goes read-only. Backups stay listable and downloadable for 90 days after expiry, then are deleted. The deletion asks the licence registry first, so a renewal the backup service has not seen still protects them.                                                                             | 7     |
| Usage reporting                 | Report licence, installation, app version, last activity, and a coarse staff count when the computer happens to be online. Never report business contents or feature use.                                                                                                                                                   | 7     |
| Mobile app                      | Not part of this product. It only works through sync, so it is removed with sync.                                                                                                                                                                                                                                           | 2     |
| Online helpers                  | Global product search stays an optional online feature. It accepts the licence instead of a session.                                                                                                                                                                                                                        | 2     |

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

The existing app already has local workspaces, a SQLite local authority, batches, pack and unit stock, purchasing, receipts, multiple sale drafts, file backup and restore, and inventory insights. Extend those capabilities instead of creating parallel implementations.

These files establish the current boundaries:

- [Architecture](architecture.md) describes the current Postgres authority, which Phase 2 removes.
- [Local authority](../packages/sync/src/local-authority.ts) already decides and commits commands for a local workspace without a server. After Phase 2 it is the only authority.
- [Local access policy](../apps/desktop/src/host-access.ts) currently permits local workspaces without an account. The licence gate replaces it.
- [Desktop auth](../apps/desktop/electron/auth.ts) and the [auth Worker](../apps/auth) hold the account flows that Phase 2 deletes.
- [Server inventory](../apps/server/src/inventory) and [live fan-out](../apps/server/src/live) hold the Postgres authority and notifications that Phase 2 deletes.
- [Shared inventory schema](../packages/db/src/shared/store.schema.ts) has product prices and batch stock. Customer ledgers, payments, strips, and batch prices need additions.
- [Replica schema](../packages/db/src/replica/schema.ts) is the device database. Staff, staff events, and settings are added here so they travel in every backup.
- [Draft model](../apps/desktop/src/lib/sale-drafts.ts) needs staff ownership and handover records.
- [Desktop backup](../apps/desktop/electron/replica-backup.ts) already stages, validates, and swaps local backups. Cloud backup reuses that path and adds only transport.
- [Header status](../apps/desktop/src/lib/inventory/sync-status.tsx) shows an action only when something needs attention. Keep its storage-error recovery when the sync states go.

## Keep the cloud small

| Component             | Responsibility                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Device SQLite         | Everything the shop owns: inventory, transactions, ledgers, staff, audit records, drafts, and settings.                                   |
| Licence file          | The signed licence, kept beside the database in the app's private data directory, not inside the database.                                |
| One Worker            | Verifies a licence signature, then serves backup upload and download, usage reports, and the online helpers.                              |
| Backup Durable Object | One per shop that opts in. Keeps the backup ledger: restore points, their order, the storage count, and retention. Holds no backup bytes. |
| R2                    | Every backup file, encrypted on the device before upload: full copies and hourly change sets.                                             |
| D1                    | The licence registry and usage summaries. The account and organization tables are dropped.                                                |
| Operator tool         | Issues and renews licences and owner reset codes with the vendor's private key. The key never reaches a Worker.                           |

The Worker holds no session state and no business rules. It trusts a request because the licence signature verifies and the registry has not revoked that licence. Shop data reaches the cloud only as encrypted backup data. R2 stores that data, the Durable Object orders it, and neither can read it.

### Split backup between a Durable Object and R2

The split follows what was measured on a real shop database on 2026-10-05. That file holds 1,902 invoices and is 21.8 MB on disk. A copy that keeps every page in place compresses to 2.75 MB. An hour of 25 sales changes 417 of its 5,317 pages, which is 339 KB compressed. A whole day of 200 sales taken as one change is 762 KB.

| Shop age at 200 sales a day | Full copy, compressed   | Uploading a full copy every hour | Uploading only the changed pages every hour |
| --------------------------- | ----------------------- | -------------------------------- | ------------------------------------------- |
| The measured file           | 2.75 MB                 | About 27 MB a day                | About 3.4 MB a day                          |
| 1 year                      | About 50 MB, estimated  | About 500 MB a day               | 5 to 10 MB a day, a guess                   |
| 3 years                     | About 150 MB, estimated | About 1.5 GB a day               | 10 to 20 MB a day, a guess                  |

Hourly full copies stop being affordable on a shop connection within months. Hourly changes stay small. So a backup is a full copy plus the pages that changed each hour since.

A backup has two parts with different needs, and each goes where it fits.

- **The ledger goes in the shop's Durable Object.** The ledger is the list of restore points for the last 30 days, which change set follows which, how much the shop stores, and what retention may delete. Change sets must be accepted in order, and each is only valid on top of the one before it. One Durable Object per shop runs one request at a time, so it checks the parent and records the restore point in a single transaction. Its alarm runs retention. The ledger is a few hundred small rows per shop.
- **The bytes go in R2.** Full copies and change sets are written once and read rarely. R2 has no row limit, streams any size, and costs $0.015 per GB each month.

An earlier draft of this section kept the 30 days of change sets inside the Durable Object. Review rejected that for four reasons, and the 30-day window stays as the ledger's job.

- The Workers Free plan allows 5 GB of Durable Object storage across the whole account. When that fills, writes fail for every shop at once, not only for the shop that grew.
- Durable Object storage costs $0.20 per GB each month, 13 times R2.
- A row holds at most 2 MB, so every change set would be cut into pieces and reassembled.
- A Worker has 128 MB of memory, and a restore would pull a month of pieces through it.

Thirty days of hourly changes for the measured shop is about 100 MB, with four weekly full copies of 2.75 MB beside it. R2 includes 10 GB, which is roughly 70 shops of that size, and past that a shop of that size costs a fifth of a cent a month. A shop that does not opt in has no Durable Object and no objects, so it costs nothing.

Block comparison coarser than a page saves nothing, because random ids scatter each insert across the table and its indexes. Time-ordered ids for new rows cut the hourly change from 339 KB to 147 KB in the same measurement. The measurement scripts and results are in `~/.cache/store-backup-proto` on the development machine and are not part of the repository. See [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), and [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Phase 1: Add the licence and local staff access

### Licence

- Define a versioned licence holding a licence id, shop id, shop name, issue date, expiry date, a cloud-backup flag, and the id of the signing key. When the flag is set it also holds the backup key version and a hash of the backup key. Sign it with Ed25519. The backup key itself travels beside the signed part and is never sent to the Worker.
- Verify the licence in the desktop main process against public keys shipped in the app. Keep the keys for older licences through key rotation.
- Store the licence outside the workspace database so that restoring a backup cannot bring back an older licence.
- Derive one licence state: missing, valid, expiring, in grace, or expired. Serve it to the renderer as a named `DesktopRpcs` member.
- Enforce the read-only state where commands commit, in the process that owns the database, not only in the renderer.
- Guard against a clock set backwards. Record the latest time the app has seen, and judge expiry against the later of that and the system clock.
- Renew by entering a new licence for the same shop id. Refuse a licence for a different shop on a database that already belongs to one.
- Build the operator tool that issues, renews, and lists licences and signs owner reset codes. Record each issued licence in the registry.

### Staff

- Leave staff off by default. With staff off there is no owner record, no PIN, no lock, and no attribution, and every command is allowed. A new installation and an upgraded one both start this way.
- Let the owner turn staff on in Settings by choosing a name and a PIN, and turn it off again. Turning it off removes every member's access and keeps their names on past sales.
- Use local staff records and enforce role permissions at command boundaries. The renderer never supplies the acting staff id. The process that owns the database knows who unlocked it.
- Store only PIN verifiers, with attempt throttling. Validate PINs in the owning process.
- With staff on, start locked and apply the configurable 15-minute idle lock. Preserve drafts across locking and switching.
- Attribute every command to the staff member who was unlocked when it ran. Leave commands from before staff existed unattributed instead of assigning them to someone.
- Keep drafts per staff member. Record explicit Owner or Manager handovers and preserve starter and completer attribution.
- Provide owner recovery through the offline recovery code, which is shown once and replaced on use, and through the vendor's signed reset code.
- Record staff-management and recovery actions in a local audit history that the owner can read.
- With staff on, gate backup, restore, and settings to the owner. Keep restore reachable when the database cannot open.
- Preserve existing local data during the upgrade. Nothing asks an existing shop to set up staff.

The release gate is a fresh installation activated offline, relaunch with no connection, an owner selling alone with staff off, turning staff on, staff switching, an unauthorized command refused by the owning process, owner recovery by both codes, an expired licence going read-only after the grace period, a renewal restoring sales, and a clock set backwards not extending the licence.

Primary ownership: `apps/desktop/electron` for the licence and worker wiring, `packages/contracts` for licence and staff contracts, `packages/client-db` for the staff gate, `packages/db/src/replica` for staff tables, `apps/desktop/src/session`, and the lock, setup, and staff screens in `apps/desktop`.

## Phase 2: Remove accounts and cloud sync

Subtract before building pharmacy features, so each feature is written against one authority.

1. Convert every existing organization workspace on a device to a local shop in place. Let its queued commands settle against the server first, then mark the database as locally owned. The device already holds a full copy, so nothing is downloaded.
2. Take a final export of each Postgres organization and keep it for a defined window as a safety copy.
3. Cut the network path on the client: registration, upload, pull, digests, snapshots, the live socket, and their scheduling.
4. Delete the sign-in, sign-up, organization, team, invitation, workspace-switcher, and publish surfaces in the renderer, with their preload channels and main-process handlers.
5. Delete the server inventory authority, live fan-out, Hyperdrive binding, Postgres migrations, and the auth Worker. Reduce D1 to the licence registry.
6. Move the online helpers to licence authorization and rate-limit them per licence.
7. The mobile app and the in-process store wiring that existed only for it are removed.
8. Collapse the client layers that existed only to reconcile with a server, such as pending overlays and receipt replay from the server. Keep `operationId` idempotency, because a double submit must still commit once. Judge each layer by deleting it and seeing what breaks.
9. Decommission PlanetScale and Neon after the retention window. Update [architecture.md](architecture.md), the Effect profile, `AGENTS.md`, and the affected tests.

Do steps 1 and 2 in a release that still contains sync, so a device can settle its queue before the server goes away. Steps 3 to 9 ship after every known device has converted.

The release gate is an upgraded organization device that opens as a local shop with the same stock, invoices, and purchasing history, a fresh installation that never contacts a server, the packaged app containing no auth or sync code, and the deployed stage containing no Postgres or Hyperdrive resources. Measure startup and checkout latency before and after.

Primary ownership: `packages/sync`, `packages/client-db`, `apps/desktop/electron`, `apps/desktop/src/session` and the auth and settings screens, `apps/server`, `apps/auth`, `packages/auth`, `packages/workspace`, and `alchemy.run.ts`.

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

Manual file backup stays as it is and needs no connection or licence flag. The rest of this section is cloud backup for a shop that opts in.

**What a shop gets.** After a fire, a theft, or a dead disk, the owner installs the app on any computer, enters the licence, picks a restore point, and is selling again with at most the last hour missing.

**Opting in.**

- The licence carries a backup flag, the shop's backup key, and a key version. Without the flag the backup settings are not shown.
- The owner turns backup on in Settings. The first run uploads a full copy and shows its progress. Selling continues during it.
- The owner can turn backup off. Turning it off stops uploads and deletes nothing.

**What is backed up.** The device database. It already contains the business data, staff, settings, and audit history. The licence, the rebuildable insights database, and parked sales are not in it.

**How a backup is made.**

- Take a consistent copy of the database that keeps page positions, using SQLite's online backup run to completion in one step from the writer. The manual backup repacks the file, which moves every page, so it cannot be used here.
- Keep the copy from the previous backup on disk. A change set is the pages that differ between that copy and the new one, with the new page count and a hash of the whole new file. This costs one extra copy of the database in disk space.
- Before uploading, apply the change set to the previous copy and check that the result hashes the same as the new copy. A change set that fails is discarded and the run uploads a full copy. A broken chain is caught on the device on the day it happens, not months later at restore.
- If the previous copy is missing or is not the one the ledger names as head, the run uploads a full copy.
- Compress and encrypt on the device. Upload the file to R2 through the Worker under an id the device chose, in parts for anything large so an interrupted upload resumes.
- Then ask the Durable Object to commit that id on top of its parent. The commit is the only step that creates a restore point. Repeating a commit with the same id returns the first answer, so a lost response never causes a second upload or a forked chain.
- The Durable Object accepts a commit only if it names the current head as its parent. A device that restored, or a second computer using the same licence, is told to start a new chain with a full copy. Each installation has its own chain, labelled with the computer's name.
- The Durable Object stamps each restore point with its own clock. A device with a wrong clock cannot misdate or reorder history.
- Start a new full copy when the change sets since the last one add up to the size of a full copy, and at least weekly. A change set larger than a full copy is never uploaded.

**When.**

- Hourly while the app is open and something changed. Nothing uploads from an idle shop.
- At day close, and when the owner presses "Back up now".
- On launch and when the connection returns, one catch-up run covers every missed hour.
- The owner can choose hourly, every four hours, or daily. The default is hourly.
- A failed run retries with backoff and never blocks selling.

**What is kept.**

- Every hourly point for 30 days.
- The first full copy of each month for a year.
- Retention never deletes the newest restore point of a chain, whatever its age, and never deletes a file that a kept restore point needs. A full copy outlives every change set built on it. A shop that closed for two months still has its last backup.
- Uploaded parts that were never committed are removed after a day.
- A licence can add backups and read them. It cannot delete or overwrite one, so a damaged computer or a stolen licence cannot destroy history.
- A quota per shop bounds abuse. Size it from real shops before release.

**Deleting backups.** "Delete my cloud backups" in Settings marks the shop's backups for deletion in 30 days and says so. The owner can cancel inside that time. The vendor can delete at once on request, with the operator tool.

**Restore.**

- From the licence screen on a new installation, or from Settings on an existing one, list the shop's restore points.
- Each one shows its time, the computer it came from, its last invoice number, and its size, so the owner can tell two computers' backups apart and pick the right one.
- Download the full copy and the change sets up to the chosen point, apply them, and check the whole-file hash and SQLite's integrity check before anything is replaced.
- Require confirmation before replacing a database that has data.
- Swap the file through the existing staged restore. After a restore the device starts a new chain.
- A shop that lost the licence as well asks the vendor, who issues it again with the same shop id and key. The vendor must be able to look a shop up by name and phone number for this.

**Keys and access.**

- The operator tool derives the shop's backup key from a vendor secret, the shop id, and the key version, and writes it into the licence. A renewal carries the same key. This is what lets a shop with nothing but its licence get its data back.
- The signed part of the licence holds a hash of the key, so the app refuses a licence whose key was damaged or swapped before it encrypts anything with it.
- The device sends only the signed part of the licence to the Worker. The key stays on the device and with the vendor.
- Each restore point records the key version that encrypted it. After a licence leaks, the vendor revokes it and issues one with the next version. Old backups stay readable to the vendor and the shop, and the leaked licence is refused.
- The Worker accepts a request only for the shop id in a verified, unrevoked licence with the backup flag.

**What the owner sees.**

- In Settings: backup on or off, the time of the last successful backup, the interval, "Back up now", and "Restore".
- In the header: nothing while backups succeed. A notice appears after one trading day with sales and no successful backup. It appears at once when the service refuses the licence, since retrying cannot fix that.

**When the licence lapses.** Uploads continue through the grace period. When the app goes read-only it makes one last backup, and after that nothing changes. For 90 days after expiry the Worker still lists and serves the shop's backups to that licence and refuses uploads. Before the alarm deletes anything it reads the licence registry, so a shop that renewed keeps its backups even if this computer has been offline since. A renewal inside the window resumes the same chain.

Build it in two steps. First full copies only, daily and on demand, which proves opt-in, upload, restore, keys, and retention end to end. Then hourly change sets on top of the same ledger.

### Basic usage reporting

- Define allowlisted summaries for licence id, installation identity, app version, last activity, and coarse active staff count.
- Queue summaries offline and upload idempotently when a connection exists. Do not use business commands, product contents, customer records, amounts, or feature-click logs as telemetry.
- Provide a protected operator view of licences, expiry dates, installations per licence, versions, and reported staff counts.
- Show last-seen coverage so offline shops are not presented as proven churn. A shop that never connects reports nothing, and that is acceptable.

### Local user experience

- Show the shop name, the active staff member, and the licence status where the account menu used to be.
- Show the licence expiry warning to the owner only, and the read-only state to everyone.
- Put the cloud backup controls in owner settings, hidden when the licence has no backup flag. With staff off, the person at the computer is the owner.
- Retain actionable local save, storage-full, and corruption recovery states.
- Verify the local path from lock screen to sale, payment, receipt, staff switch, stocktake, statement, and backup on a low-end desktop.

The release gate includes a full copy with an interrupted upload, a backup taken while sales are being recorded, a week of hourly change sets restored to a chosen hour on a replacement computer, a commit repeated after a lost response, a second computer on the same licence starting its own chain, a change set with the wrong parent refused, a delete attempted with a valid licence refused, a restore from a file, a backup refused for a licence without the flag, pruning at 30 days that leaves every remaining point restorable, a shop silent for 60 days that keeps its newest point, a lapsed shop that renewed offline keeping its backups, and queued usage reporting with no business contents. Confirm that a shop that never connects can sell, back up to a file, and renew its licence.

## Preserve repository boundaries and validate each release

- Use named `InventoryReads`, `InventoryStore`, `InventoryInsights`, and `DesktopRpcs` members over Effect RPC. Do not send SQL or query IR through renderer boundaries. Keep preload IPC within its existing open, close, backup, and restore responsibilities.
- Financial corrections use domain reversal records rather than a `deletedAt` scheme.
- Follow the Effect skill and [repo profile](effect-profile.md). Validate external data at boundaries and keep domain decisions independent of storage.
- For web UI implementation, use COSS, Inter, the agreed size and weight scale, and Hugeicons. Keep registry-owned UI primitives intact.
- Keep meaningful tests for financial, licence, and permission invariants. Use temporary tests for exploratory checks instead of adding a test file for every UI change.

Run `vp install`, `vp check`, `vp run -r check`, and `vp test` for implementation releases. Package the desktop with `vp run --filter @store/desktop build`. Verify the backup service against the real deployed dev stage before production. Measure startup and checkout latency before and after changes.

Release in this order: licence and staff access, removal of accounts and sync, pharmacy stock rules, financial workflows, stocktake and claims, migration adapters, then cloud backup and usage reporting. Collect source fixtures early.

Do not assign calendar estimates until source fixtures establish the remaining work. The main external dependencies are sanitized source data, scanner and receipt-printer hardware, and a realistic shop dataset for migration and backup sizing.
