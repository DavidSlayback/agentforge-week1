import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchSessionStore, launchSessionCookie } from '../src/launchSession.js';

const context = (expiresAt, scope = 'read-briefing') => Object.freeze({ patient_uuid: 'p', clinician_uuid: 'c', scope, issuer: 'openemr-module', authn: 'openemr-session', role: 'clinician', acl: scope === 'read-briefing' ? 'read' : 'write', expires_at: expiresAt });
const cookieOf = (exchange) => `${exchange.cookieName}=${exchange.cookieValue}`;

test('launch session: one exchange per launch token; the handle needs its cookie; it ends with the token', () => {
  let nowMs = 1_000_000;
  const store = new LaunchSessionStore({ now: () => nowMs });
  const read = context(1_000 + 280);
  const write = context(1_000 + 280, 'write-source-document');
  const exchange = store.exchange({ readToken: 'read-token', readContext: read, writeToken: 'write-token', writeContext: write });
  assert.equal(exchange.status, 'created');
  assert.equal(exchange.maxAgeSeconds, 280);
  assert.equal(store.resolve(exchange.readHandle, cookieOf(exchange)), read);
  assert.equal(store.resolve(exchange.writeHandle, `other=1; ${cookieOf(exchange)}`), write);
  assert.equal(store.resolve(exchange.readHandle, ''), null, 'no cookie');
  assert.equal(store.resolve(exchange.readHandle, `${exchange.cookieName}=wrong`), null, 'wrong secret');
  assert.equal(store.exchange({ readToken: 'read-token', readContext: read }).status, 'replayed');
  assert.equal(store.exchange({ readToken: 'fresh-read', readContext: read, writeToken: 'write-token', writeContext: write }).status, 'replayed', 'a consumed write token cannot ride a new read token');
  const readOnly = store.exchange({ readToken: 'read-only', readContext: read });
  assert.equal(readOnly.writeHandle, '');
  assert.equal(store.resolve(readOnly.readHandle.replace('.read', '.write'), cookieOf(readOnly)), null, 'no write context, no write handle');
  nowMs = 1_280_000;
  assert.equal(store.resolve(exchange.readHandle, cookieOf(exchange)), null, 'the session ends when the launch token would have expired');
  assert.equal(store.exchange({ readToken: 'late', readContext: read }).status, 'expired');
});

test('launch session cookie: HttpOnly, Secure, SameSite=Strict, scoped to the public base path', () => {
  const cookie = launchSessionCookie({ cookieName: 'af_launch_abc', cookieValue: 'secret', maxAgeSeconds: 42 }, '/agentforge-w2');
  assert.equal(cookie, 'af_launch_abc=secret; Path=/agentforge-w2; Max-Age=42; HttpOnly; Secure; SameSite=Strict');
  assert.match(launchSessionCookie({ cookieName: 'n', cookieValue: 'v', maxAgeSeconds: 1 }), /Path=\/;/);
});
