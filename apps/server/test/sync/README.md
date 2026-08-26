Compat until retirement: Durable Object / `/api/sync/live` WebSocket engine.

These tests stay and still run in `vp test`. They are not the inventory source of
truth — catalog authority is Postgres + PowerSync. Do not treat a failure here as
a PowerSync regression unless the compatibility surface itself changed.
