import { z } from 'zod';
import type { DemoPatient } from '../../core/dto.ts';
import { parsePatientUuid } from '../../core/ids.ts';

/**
 * Typed BFF configuration. This is the only module that reads `process.env`
 * (MIGRATION-REACT.md §5). It refuses to start without the client secret
 * (catalog 1.01 / M-4: OpenEMR only checks the secret when one is sent, so a
 * missing secret would silently downgrade the confidential client).
 */
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly basePath: '/dashboard';
  /** Browser-facing origin of this app, e.g. `https://host` (no path, no trailing slash). */
  readonly publicOrigin: string;
  /** The OpenEMR OAuth issuer (`iss` of its id tokens), e.g. `https://host/oauth2/default`. */
  readonly issuer: string;
  /** Where the BFF reaches OpenEMR server-side (Docker network), e.g. `http://openemr`. */
  readonly openemrInternalUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sessionSecret: string;
  readonly openemrTimeZone: string;
  readonly demoPatients: readonly DemoPatient[];
  readonly upstreamTimeoutMs: number;
  readonly cookieSecure: boolean;
  readonly staticDir: string | null;
  /** Exact OAuth scope string, identical on every request (§2.3); never `offline_access`. */
  readonly scope: string;
}

export const OAUTH_SCOPE = [
  'openid',
  'api:oemr',
  'api:fhir',
  'user/Patient.rs',
  'user/CareTeam.rs',
  'user/Practitioner.rs',
  'user/Organization.rs',
  // 01-06-04: Medications dosage instructions. A client registered without it
  // still signs in (OpenEMR drops unregistered scopes, ScopeRepository::finalizeScopes()),
  // and the FHIR call then answers 401; the card keeps its list and says so.
  'user/MedicationRequest.rs',
  'user/patient.rs',
  'user/allergy.rs',
  'user/medical_problem.rs',
  'user/medication.rs',
  'user/prescription.rs',
  'user/encounter.rs',
  'user/vital.rs',
  'user/list.r',
].join(' ');

const origin = z
  .url()
  .transform((v) => v.replace(/\/+$/, ''))
  .refine((v) => new URL(v).pathname === '/' || new URL(v).pathname === '', 'must be an origin without a path');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.string().optional(),
  DASHBOARD_BASE_PATH: z.literal('/dashboard').default('/dashboard'),
  DASHBOARD_PUBLIC_ORIGIN: origin,
  DASHBOARD_OAUTH_ISSUER: z
    .url()
    .transform((v) => v.replace(/\/+$/, '')),
  DASHBOARD_OPENEMR_INTERNAL_URL: origin.default('http://openemr'),
  DASHBOARD_OAUTH_CLIENT_ID: z.string().min(8),
  DASHBOARD_OAUTH_CLIENT_SECRET: z.string().min(16),
  DASHBOARD_SESSION_SECRET: z.string().min(32),
  // Required, no default (W3 hardening H4): it must equal OpenEMR's effective PHP timezone
  // (`gbl_time_zone` if set, else php.ini `date.timezone`, else UTC; see README "Configuration").
  // A named zone only: PHP's settings are zone names, and a bare offset would ignore DST.
  DASHBOARD_OPENEMR_TZ: z
    .string()
    .min(1)
    .refine((tz) => {
      if (/^[+-]/.test(tz)) return false;
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'must be an IANA time zone name'),
  DASHBOARD_DEMO_PATIENTS: z.string().default(''),
  DASHBOARD_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  DASHBOARD_STATIC_DIR: z.string().optional(),
});

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Parse `label=uuid,label=uuid`. Labels are neutral ("Demo A (data-rich)"), never names. */
export function parseDemoPatients(raw: string): DemoPatient[] {
  if (raw.trim() === '') return [];
  return raw.split(',').map((pair) => {
    const eq = pair.lastIndexOf('=');
    const label = pair.slice(0, eq).trim();
    const patientId = parsePatientUuid(pair.slice(eq + 1).trim());
    if (eq <= 0 || label === '' || patientId === null) {
      throw new ConfigError('DASHBOARD_DEMO_PATIENTS must be label=<patient uuid>[,label=<uuid>...]');
    }
    return { label, patientId };
  });
}

/** Build the config from an environment map; throws `ConfigError` naming the bad keys (never their values). */
export function loadConfig(env: Readonly<Record<string, string | undefined>>, defaultStaticDir: string | null): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))].sort();
    throw new ConfigError(`invalid or missing configuration: ${keys.join(', ')}`);
  }
  const e = parsed.data;
  const cookieSecure = e.DASHBOARD_PUBLIC_ORIGIN.startsWith('https://');
  if (e.NODE_ENV === 'production' && !cookieSecure) {
    throw new ConfigError('DASHBOARD_PUBLIC_ORIGIN must be https in production (Secure cookies)');
  }
  return {
    port: e.PORT,
    host: e.HOST,
    basePath: e.DASHBOARD_BASE_PATH,
    publicOrigin: e.DASHBOARD_PUBLIC_ORIGIN,
    issuer: e.DASHBOARD_OAUTH_ISSUER,
    openemrInternalUrl: e.DASHBOARD_OPENEMR_INTERNAL_URL,
    clientId: e.DASHBOARD_OAUTH_CLIENT_ID,
    clientSecret: e.DASHBOARD_OAUTH_CLIENT_SECRET,
    sessionSecret: e.DASHBOARD_SESSION_SECRET,
    openemrTimeZone: e.DASHBOARD_OPENEMR_TZ,
    demoPatients: parseDemoPatients(e.DASHBOARD_DEMO_PATIENTS),
    upstreamTimeoutMs: e.DASHBOARD_UPSTREAM_TIMEOUT_MS,
    cookieSecure,
    staticDir: e.DASHBOARD_STATIC_DIR ?? defaultStaticDir,
    scope: OAUTH_SCOPE,
  };
}
