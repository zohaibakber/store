ALTER TABLE "replicas" ADD COLUMN "schema_version_at" bigint;
--> statement-breakpoint
UPDATE "replicas" SET "schema_version_at" = (extract(epoch from now()) * 1000)::bigint WHERE "schema_version" > 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.active_replicas(p_organization_id text, p_now bigint) RETURNS SETOF public.replicas
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM public.replicas AS r
  WHERE r.organization_id = p_organization_id
    AND r.last_seen_at >= p_now - 1209600000
    AND r.last_seen_at >= coalesce((
      SELECT min(n.schema_version_at) - 86400000
      FROM public.replicas AS n
      WHERE n.organization_id = r.organization_id
        AND n.schema_version > r.schema_version
    ), 0)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.register_replica(
  p_actor jsonb,
  p_request jsonb,
  p_now bigint,
  p_incarnation text,
  OUT body text,
  OUT error_code text,
  OUT error_message text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_organization_id text := p_actor->>'organizationId';
  v_user_id text := p_actor->>'userId';
  v_replica_id text := p_request->>'replicaId';
  v_schema_version integer := coalesce((p_request->>'schemaVersion')::integer, 1);
  v_state public.inventory_state;
  v_replica public.replicas;
  v_next text;
  v_lowest integer;
BEGIN
  INSERT INTO public.inventory_state (
    organization_id, incarnation, epoch, commit_sequence, retention_floor
  ) VALUES (v_organization_id, p_incarnation, '1', 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;
  SELECT * INTO v_replica FROM public.replicas AS r
  WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
  IF FOUND THEN
    IF v_replica.owner_user_id IS DISTINCT FROM v_user_id THEN
      error_code := 'REPLICA_OWNED_BY_OTHER';
      error_message := 'This replica belongs to another user.';
      RETURN;
    END IF;
    UPDATE public.replicas AS r
    SET last_seen_at = p_now,
      schema_version = v_schema_version,
      schema_version_at = CASE
        WHEN r.schema_version = v_schema_version THEN coalesce(r.schema_version_at, p_now)
        ELSE p_now
      END,
      device_label = CASE WHEN p_request ? 'deviceLabel' THEN p_request->>'deviceLabel' ELSE r.device_label END
    WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
    v_next := (v_replica.last_client_sequence + 1)::text;
  ELSE
    INSERT INTO public.replicas (
      organization_id, replica_id, owner_user_id, device_label, last_client_sequence,
      processed_through_client_sequence, registered_at, last_seen_at, schema_version,
      schema_version_at
    ) VALUES (
      v_organization_id, v_replica_id, v_user_id, p_request->>'deviceLabel', 0, 0, p_now, p_now,
      v_schema_version, p_now
    );
    v_next := '1';
  END IF;
  SELECT min(r.schema_version) INTO v_lowest
  FROM sync.active_replicas(v_organization_id, p_now) AS r;
  body := '{"replicaId":' || to_json(v_replica_id)::text
    || ',"nextClientSequence":"' || v_next
    || '","epoch":' || to_json(v_state.epoch)::text
    || ',"incarnation":' || to_json(v_state.incarnation)::text
    || ',"retentionFloor":"' || v_state.retention_floor::text
    || '","horizon":"' || v_state.commit_sequence::text
    || '","schemaVersion":1,"lowestActiveSchemaVersion":' || coalesce(v_lowest, v_schema_version)::text || '}';
END
$$;
