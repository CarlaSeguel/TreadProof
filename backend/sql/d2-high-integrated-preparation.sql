-- PROPOSAL ONLY. NOT INSTALLED. Add one preparation-only function; reuse existing intents/RLS.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='8s';
DO $guard$ BEGIN
 IF current_user<>'tp_d2_lab_admin' OR current_database()<>'treadproof_d2_high_integrated'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55440
 OR current_setting('server_version') NOT LIKE '17.11%'
 OR replace(current_setting('data_directory'),chr(92),'/')<>'/home/carla/treadproof-d2-sql-lab/data'
 OR to_regprocedure('nfu_store.prepare_create_batch(jsonb)') IS NOT NULL
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='tp_nfu_store_owner' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)
 OR NOT(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='nfu_store.intents'::regclass) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='preparation_target_or_owner_rejected';END IF;
END $guard$;
CREATE FUNCTION nfu_store.prepare_create_batch(j jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=on AS $$
DECLARE d jsonb;i nfu_store.intents;scope_user uuid;scope_org uuid;
BEGIN
 IF current_setting('transaction_read_only')<>'off' OR jsonb_typeof(j) IS DISTINCT FROM 'object'
 OR pg_column_size(j)>524288 OR (SELECT count(*) FROM jsonb_object_keys(j))<>8
 OR EXISTS(SELECT FROM jsonb_object_keys(j) k WHERE k<>ALL(ARRAY['id','idempotencyKey','descriptor','binding','payloadDigest','reviewDigest','hash','requestDigest'])) THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_preparation';END IF;
 scope_user:=nullif(current_setting('tp_nfu.user',true),'')::uuid;scope_org:=nullif(current_setting('tp_nfu.org',true),'')::uuid;d:=j->'descriptor';
 IF scope_user IS NULL OR scope_org IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object'
 OR d->>'userId' IS DISTINCT FROM scope_user::text OR d->>'organizationId' IS DISTINCT FROM scope_org::text
 OR d->>'role' IS DISTINCT FROM 'company' OR d->>'action' IS DISTINCT FROM 'create_batch'
 OR d->>'preparationKind' IS DISTINCT FROM 'create_batch_preliminary_v1'
 OR d->>'requestDigest' IS DISTINCT FROM j->>'requestDigest' OR coalesce(j->>'requestDigest','')!~'^[a-f0-9]{64}$'
 OR d->>'networkPassphrase' IS DISTINCT FROM 'Test SDF Network ; September 2015'
 OR d->>'contract' IS DISTINCT FROM 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'
 OR d->'target'->>'company' IS DISTINCT FROM scope_org::text
 OR d->>'actor' IS DISTINCT FROM d->'actors'->>'company'
 OR d->'parameters'->>'company' IS DISTINCT FROM d->'actors'->>'company'
 OR d->'parameters'->>'carrier' IS DISTINCT FROM d->'actors'->>'carrier'
 OR d->'parameters'->>'plant' IS DISTINCT FROM d->'actors'->>'plant'
 OR d->'beforeBatchXdr' IS DISTINCT FROM 'null'::jsonb THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='preparation_scope_rejected';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope_user::text||scope_org::text||(j->>'idempotencyKey'),0));
 SELECT * INTO i FROM nfu_store.intents WHERE owner_user=scope_user AND owner_org=scope_org AND idempotency_key=(j->>'idempotencyKey')::uuid;
 IF FOUND THEN
  IF i.phase<>'prepared' OR i.descriptor->>'preparationKind' IS DISTINCT FROM 'create_batch_preliminary_v1'
  OR i.descriptor->>'requestDigest' IS DISTINCT FROM j->>'requestDigest' OR i.binding IS DISTINCT FROM j->>'binding'
  OR EXISTS(SELECT FROM nfu_store.attempts WHERE intent_id=i.id) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='preparation_idempotency_conflict';END IF;
  RETURN to_jsonb(i);
 END IF;
 IF (d->>'expiresAt')::timestamptz<=clock_timestamp() OR (d->>'expiresAt')::timestamptz>clock_timestamp()+interval '305 seconds' THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='preparation_expired';END IF;
 INSERT INTO nfu_store.intents(id,owner_user,owner_org,idempotency_key,binding,descriptor,payload_digest,review_digest,tx_hash,expires_at)
 VALUES((j->>'id')::uuid,scope_user,scope_org,(j->>'idempotencyKey')::uuid,j->>'binding',d,j->>'payloadDigest',j->>'reviewDigest',j->>'hash',(d->>'expiresAt')::timestamptz) RETURNING * INTO i;
 RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION nfu_store.prepare_create_batch(jsonb) FROM PUBLIC,tp_nfu_app;
ALTER FUNCTION nfu_store.prepare_create_batch(jsonb) OWNER TO tp_nfu_store_owner;
GRANT EXECUTE ON FUNCTION nfu_store.prepare_create_batch(jsonb) TO tp_nfu_app;
-- No UPDATE/DELETE of existing records, attempts, run(), reader, roles or policies.
COMMIT;
