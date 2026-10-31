import {randomBytes,createHash} from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createD2OpaqueSessionSecret() {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');

  return Object.freeze({
    token,
    tokenSha256: hash
  });
}

export function hashD2OpaqueSessionToken(token) {
  if (typeof token !== 'string' ||
      !TOKEN_PATTERN.test(token)) {
    throw Object.assign(
      new Error('invalid_d2_session_token'),
      {code:'invalid_d2_session_token'}
    );
  }

  return createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}