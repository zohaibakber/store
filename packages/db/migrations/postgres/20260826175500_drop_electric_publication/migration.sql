-- Retire Electric Cloud leftovers that were never in the Drizzle schema.
-- PowerSync uses the `powersync` publication (see
-- 20260824065600_create_powersync_publication) and must not be dropped.
-- Application tables, including live `electric_mutation_receipts` write
-- receipts, are unchanged.

DROP PUBLICATION IF EXISTS electric;
DROP PUBLICATION IF EXISTS electric_publication;

DROP SCHEMA IF EXISTS electric CASCADE;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT slot_name
    FROM pg_replication_slots
    WHERE slot_name ILIKE 'electric%'
       OR slot_name ILIKE '%electric%'
  LOOP
    PERFORM pg_drop_replication_slot(rec.slot_name);
  END LOOP;
END $$;
