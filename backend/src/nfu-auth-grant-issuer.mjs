import { randomBytes, createHash } from 'node:crypto';

const operations = new Set([
  'create', 'read', 'find', 'list',
  'approve', 'stage', 'cas'
]);

const sha256 = value =>
  createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(k => [k, canonical(value[k])])
    );
  }

  return value;
}

export function createNfuGrantIssuer({
  resolveIdentity,
  persistGrant,
  now = Date.now
} = {}) {
  if (typeof resolveIdentity !== 'function' ||
      typeof persistGrant !== 'function') {
    throw new Error('high1_authority_not_configured');
  }

  return Object.freeze({
    async issue({ credential, operation, request }) {
      if (!operations.has(operation) ||
          !request ||
          typeof request !== 'object' ||
          Array.isArray(request)) {
        throw new Error('invalid_grant_request');
      }

      const identity = await resolveIdentity(credential);

      const validUuid = value =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

      if (identity?.verified !== true ||
          !validUuid(identity.userId) ||
          !validUuid(identity.organizationId)) {
        throw new Error('authorization_required');
      }

            const token = randomBytes(32).toString('base64url');

      if (Object.hasOwn(request, 'grantToken')) {
        throw new Error('invalid_grant_request');
      }

      // PostgreSQL calculará el hash de la solicitud.
      // La autorización todavía no se emite en este punto.

      const issuedAt = new Date(now());
      const expiresAt = new Date(issuedAt.getTime() + 30000);

     const stored = await persistGrant({
  tokenSha256: sha256(token),
  userId: identity.userId,
  organizationId: identity.organizationId,
  operation,
  request,
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString()
});

const requestSha256 = stored?.requestSha256;

if (!/^[0-9a-f]{64}$/.test(requestSha256 ?? '')) {
  throw new Error('high1_grant_persistence_invalid');
}

      return Object.freeze({
        token,
        requestSha256,
        expiresAt: expiresAt.toISOString()
      });
    }
  });
}
