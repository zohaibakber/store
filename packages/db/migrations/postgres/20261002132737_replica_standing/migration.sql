ALTER TABLE "replicas" ADD COLUMN "ignored_at" bigint;
--> statement-breakpoint
ALTER TABLE "replicas" ADD COLUMN "removed_at" bigint;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.active_replicas(p_organization_id text, p_now bigint) RETURNS SETOF public.replicas
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM public.replicas AS r
  WHERE r.organization_id = p_organization_id
    AND r.last_seen_at >= p_now - 1209600000
    AND (r.ignored_at IS NULL OR r.ignored_at < coalesce(r.schema_version_at, 0))
    AND (r.removed_at IS NULL OR r.last_seen_at > r.removed_at)
    AND r.last_seen_at >= coalesce((
      SELECT min(n.schema_version_at) - 86400000
      FROM public.replicas AS n
      WHERE n.organization_id = r.organization_id
        AND n.schema_version > r.schema_version
    ), 0)
$$;
