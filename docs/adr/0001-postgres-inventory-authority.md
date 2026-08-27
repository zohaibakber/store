# Postgres is the catalog authority

The organization Durable Object and `/api/sync/live` WebSocket were a
compatibility path after the PowerSync cutover. Postgres is the source of
truth: the Worker writes catalog commands there, PowerSync streams
organization-scoped rows into client SQLite, and D1 stays auth. Keeping a
second live-write runtime would leak the old `SyncOperation` envelope and
split inventory across two authorities. The Durable Object, live-sync route,
and envelope are retired; do not restore them as compatibility.
