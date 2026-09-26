import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_SHA_PATH, readBuildSha } from '../../bff/src/buildInfo.ts';
import { ConfigError, loadConfig, parseDemoPatients } from '../../bff/src/config.ts';
import { buildTestApp, FakeOpenEmr, TEST_ENV } from '../support/harness.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('/dashboard/health and /dashboard/ready', () => {
  it('health is compact JSON with the build SHA (deploy.sh greps "git_sha":"<sha>")', async () => {
    const app = await buildTestApp({ fake: new FakeOpenEmr(), buildSha: SHA });
    const res = await app.inject({ method: 'GET', url: '/dashboard/health' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(`{"status":"ok","service":"dashboard","git_sha":"${SHA}"}`);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ready follows OpenEMR readiness', async () => {
    const up = new FakeOpenEmr().on('GET', 'http://openemr/meta/health/readyz', { status: 200, body: { status: 'ready' } });
    expect((await (await buildTestApp({ fake: up })).inject({ method: 'GET', url: '/dashboard/ready' })).statusCode).toBe(200);
    const down = new FakeOpenEmr().on('GET', 'http://openemr/meta/health/readyz', { status: 503, body: null });
    expect((await (await buildTestApp({ fake: down })).inject({ method: 'GET', url: '/dashboard/ready' })).statusCode).toBe(503);
    const absent = new FakeOpenEmr();
    expect((await (await buildTestApp({ fake: absent })).inject({ method: 'GET', url: '/dashboard/ready' })).statusCode).toBe(503);
  });
});

describe('readBuildSha', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-sha-'));
  it('uses a stamped file, then DASHBOARD_GIT_SHA, then "unversioned"', () => {
    const stamped = join(dir, 'stamped');
    writeFileSync(stamped, `${SHA}\n`);
    expect(readBuildSha(stamped, {})).toBe(SHA);
    const placeholder = join(dir, 'placeholder');
    writeFileSync(placeholder, '$Format:%H$\n');
    expect(readBuildSha(placeholder, { DASHBOARD_GIT_SHA: SHA })).toBe(SHA);
    expect(readBuildSha(placeholder, { DASHBOARD_GIT_SHA: 'main' })).toBe('unversioned');
    expect(readBuildSha(join(dir, 'missing'), {})).toBe('unversioned');
  });
  it('the checked-in BUILD_SHA is the export-subst placeholder (never a guessed value)', () => {
    expect(readBuildSha(DEFAULT_BUILD_SHA_PATH, {})).toBe('unversioned');
  });
});

describe('config', () => {
  it('refuses to start without the client secret, session secret, issuer or public origin, naming keys only', () => {
    for (const key of ['DASHBOARD_OAUTH_CLIENT_SECRET', 'DASHBOARD_SESSION_SECRET', 'DASHBOARD_OAUTH_ISSUER', 'DASHBOARD_PUBLIC_ORIGIN', 'DASHBOARD_OAUTH_CLIENT_ID']) {
      const env = Object.fromEntries(Object.entries(TEST_ENV).filter(([k]) => k !== key));
      expect(() => loadConfig(env, null), key).toThrow(ConfigError);
      try {
        loadConfig(env, null);
      } catch (e) {
        expect(String(e)).toContain(key);
        expect(String(e)).not.toContain(TEST_ENV.DASHBOARD_SESSION_SECRET);
      }
    }
  });

  it('refuses a short secret, an origin with a path, and http in production', () => {
    expect(() => loadConfig({ ...TEST_ENV, DASHBOARD_OAUTH_CLIENT_SECRET: 'short' }, null)).toThrow(ConfigError);
    expect(() => loadConfig({ ...TEST_ENV, DASHBOARD_PUBLIC_ORIGIN: 'http://localhost:8790/dashboard' }, null)).toThrow(ConfigError);
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production' }, null)).toThrow(/https in production/);
    expect(() => loadConfig({ ...TEST_ENV, DASHBOARD_OPENEMR_TZ: 'Mars/Olympus' }, null)).toThrow(ConfigError);
  });

  it('parses demo patients as neutral label=uuid pairs', () => {
    expect(parseDemoPatients('')).toEqual([]);
    expect(parseDemoPatients('Demo A (data-rich)=A2D4D063-D949-4F5A-9001-01C1D919AFC6')).toEqual([
      { label: 'Demo A (data-rich)', patientId: 'a2d4d063-d949-4f5a-9001-01c1d919afc6' },
    ]);
    expect(() => parseDemoPatients('Demo=13')).toThrow(ConfigError);
    expect(() => parseDemoPatients('=a2d4d063-d949-4f5a-9001-01c1d919afc6')).toThrow(ConfigError);
  });
});
