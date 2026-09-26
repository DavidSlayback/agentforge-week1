import type { ErrorCode } from '../../core/cardResult.ts';

/**
 * Error-state drills (arc slice 01-06-01, done in 01-06-04): one synthetic
 * upstream failure each, pushed through the real BFF against a fake OpenEMR
 * (`test/bff/drills.test.ts`), and the exact BFF wire answer it must produce
 * rendered by the SPA (`test/web/Drills.test.tsx`). Both tests assert against
 * the same `wire` value, so the chain upstream → BFF → UI is covered end to
 * end. Pure data: no Node or DOM imports (both test projects load it).
 */

export type DrillCard = 'allergies' | 'problems' | 'medications';

/** The upstream route the drill breaks; every other call is served from the shaped pid 13 fixture. */
export type DrillUpstream = 'rest.patient.read' | 'rest.allergy.list' | 'rest.problem.list' | 'rest.medication.list';

export type DrillWire =
  | { readonly status: 401; readonly kind: 'reauth' }
  | { readonly status: 200; readonly kind: 'forbidden' }
  | { readonly status: 200; readonly kind: 'empty' }
  | { readonly status: 200; readonly kind: 'error'; readonly code: ErrorCode };

export interface Drill {
  readonly name: string;
  readonly card: DrillCard;
  readonly title: string;
  readonly breaks: DrillUpstream;
  /** Inline upstream response, or a hand-built fixture file (read only by the BFF test). */
  readonly upstream: { readonly status: number; readonly body: unknown } | { readonly fixture: string };
  readonly wire: DrillWire;
  /** What the card must say, and upstream text it must never show. */
  readonly ui: RegExp;
  readonly neverShown: readonly string[];
}

export const DRILLS: readonly Drill[] = [
  {
    name: '401: expired or revoked token on the allergy list',
    card: 'allergies',
    title: 'Allergies',
    breaks: 'rest.allergy.list',
    upstream: { status: 401, body: { error: 'invalid_token', message: 'UPSTREAM_TEXT_401' } },
    wire: { status: 401, kind: 'reauth' },
    ui: /^Your session has ended\. Sign in again$/,
    neverShown: ['UPSTREAM_TEXT_401', 'invalid_token'],
  },
  {
    name: '403: a card-level deny on the medical problem list (3.14)',
    card: 'problems',
    title: 'Medical Problems',
    breaks: 'rest.problem.list',
    upstream: { status: 403, body: { error: 'UPSTREAM_TEXT_403' } },
    wire: { status: 200, kind: 'forbidden' },
    ui: /^Not authorized for this section\.$/,
    neverShown: ['UPSTREAM_TEXT_403'],
  },
  {
    name: 'HTTP 200 carrying validationErrors on the allergy list (6.02)',
    card: 'allergies',
    title: 'Allergies',
    breaks: 'rest.allergy.list',
    upstream: { fixture: 'hand-built/rest-200-validation-errors.json' },
    wire: { status: 200, kind: 'error', code: 'UPSTREAM_VALIDATION' },
    ui: /^Couldn't load Allergies\. Reference [\w-]+ \(UPSTREAM_VALIDATION\)\.$/,
    neverShown: ['invalid or nonexisting value', 'Nothing Recorded'],
  },
  {
    name: '404 with an empty body on the medication list: this route only, "Nothing Recorded" (6.04)',
    card: 'medications',
    title: 'Medications',
    breaks: 'rest.medication.list',
    upstream: { status: 404, body: null },
    wire: { status: 200, kind: 'empty' },
    ui: /^Nothing Recorded$/,
    neverShown: [],
  },
  {
    name: '404 on the patient read (unknown patient): an error, never "Nothing Recorded"',
    card: 'allergies',
    title: 'Allergies',
    breaks: 'rest.patient.read',
    upstream: { status: 404, body: null },
    wire: { status: 200, kind: 'error', code: 'UPSTREAM_STATUS' },
    ui: /^Couldn't load Allergies\. Reference [\w-]+ \(UPSTREAM_STATUS\)\.$/,
    neverShown: ['Nothing Recorded'],
  },
  {
    name: '500 whose body leaks SQL on the medical problem list (6.01)',
    card: 'problems',
    title: 'Medical Problems',
    breaks: 'rest.problem.list',
    upstream: { fixture: 'hand-built/rest-500-sqlstate.json' },
    wire: { status: 200, kind: 'error', code: 'UPSTREAM_STATUS' },
    ui: /^Couldn't load Medical Problems\. Reference [\w-]+ \(UPSTREAM_STATUS\)\.$/,
    neverShown: ['SQLSTATE', 'LEAKED_SQL_MARKER'],
  },
];
