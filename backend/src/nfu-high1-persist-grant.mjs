import {notePreparationCause,preparationSqlCause} from './nfu-preparation-diagnostics.js';

import { spawnSync } from 'node:child_process';

const ALLOWED_DATABASES = new Set([
  'treadproof_d2_high1_integration',
  'treadproof_d2_high_integrated'
]);

const DB = process.env.TP_HIGH1_LAB_DATABASE
  ?? 'treadproof_d2_high1_integration';

if (!ALLOWED_DATABASES.has(DB)) {
  throw new Error('high1_invalid_database');
}
const PASSFILE = '/home/carla/.treadproof-high1-issuer.pgpass';
const OPERATIONS = new Set([
  'create', 'read', 'find', 'list',
  'approve', 'stage', 'cas'
]);

export async function persistHigh1Grant(grant) {
  const {
    tokenSha256, userId, organizationId,
    operation, request, issuedAt, expiresAt
  } = grant;

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hex = /^[0-9a-f]{64}$/;

  if (!hex.test(tokenSha256) ||
      !uuid.test(userId) ||
      !uuid.test(organizationId) ||
      !OPERATIONS.has(operation) ||
      !request || Array.isArray(request) ||
      typeof request !== 'object' ||
      Object.hasOwn(request, 'grantToken')) {
    throw new Error('high1_invalid_grant');
  }

  const payloadHex = Buffer.from(
    JSON.stringify(request), 'utf8'
  ).toString('hex');

  const sql = `
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> '${DB}'
     OR current_setting('port') <> '55440'
     OR session_user <> 'tp_nfu_auth_login'
  THEN RAISE EXCEPTION 'high1_wrong_database'; END IF;
END $guard$;

SET LOCAL ROLE tp_nfu_auth;

INSERT INTO d2_security.auth_grants
(token_sha256,user_id,organization_id,operation,
 request_sha256,issued_at,expires_at)
VALUES (
 decode('${tokenSha256}','hex'),
 '${userId}'::uuid,
 '${organizationId}'::uuid,
 '${operation}',
 sha256(convert_to(
   '${operation}:' ||
   convert_from(decode('${payloadHex}','hex'),'UTF8')::jsonb::text,
   'UTF8'
 )),
 '${issuedAt}'::timestamptz,
 '${expiresAt}'::timestamptz
);

SELECT encode(
 sha256(convert_to(
   '${operation}:' ||
   convert_from(decode('${payloadHex}','hex'),'UTF8')::jsonb::text,
   'UTF8'
 )), 'hex'
);
COMMIT;
`;

  const result = spawnSync('/usr/bin/psql', [
    '-X', '-q', '-A', '-t', '-w',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
    '-h', '127.0.0.1', '-p', '55440',
    '-U', 'tp_nfu_auth_login',
    '-d', DB
  ], {
    input: sql,
    encoding: 'utf8',
    timeout: 12000,
    maxBuffer: 65536,
    env: {
      ...process.env,
      PGPASSFILE: PASSFILE
    }
  });

  if (result.status !== 0 || result.error) {
    throw notePreparationCause(new Error('high1_grant_persistence_failed'),result.error?.code==='ETIMEDOUT'?'sql_transport_timeout':result.error?'sql_process_start_failed':preparationSqlCause(result.stderr));
  }

  const lines = result.stdout.trim().split(/\r?\n/);
  const requestSha256 = lines.find(x => hex.test(x.trim()))?.trim();

  if (!requestSha256) {
    throw new Error('high1_grant_persistence_uncertain');
  }

  return { requestSha256 };
}
