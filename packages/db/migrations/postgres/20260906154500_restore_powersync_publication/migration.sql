DO $$
DECLARE
  tbl text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    EXECUTE 'CREATE PUBLICATION powersync FOR TABLE categories, products, batches, invoices, invoice_items, stock_movements';
  ELSE
    FOREACH tbl IN ARRAY ARRAY['categories', 'products', 'batches', 'invoices', 'invoice_items', 'stock_movements']
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION powersync ADD TABLE %I', tbl);
      END IF;
    END LOOP;
  END IF;
END
$$;
