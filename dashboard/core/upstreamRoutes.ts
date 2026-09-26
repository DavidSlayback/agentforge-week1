import { parseMrn, parsePatientUuid, parsePid } from './ids.ts';

/**
 * The upstream allow-list (MIGRATION-REACT.md §2.4). `buildUpstreamPath` is the
 * only way the BFF can build an OpenEMR URL: unknown query keys, missing fixed
 * values and unparseable path parameters throw (fail loudly). The table has no
 * unscoped collection route (catalog 3.13); a test asserts it.
 *
 * Routes are added by the slice that needs them. Slice 01-01-01 needs the
 * header reads and the MRN lookup; 01-02-01 the allergy list and the
 * `severity_ccda` label list; 01-02-02 the medical problem list; 01-02-03
 * the medication list.
 */

export type UpstreamRouteId =
  | 'fhir.patient.read'
  | 'rest.patient.read'
  | 'fhir.patient.search'
  | 'rest.allergy.list'
  | 'rest.list.read'
  | 'rest.problem.list'
  | 'rest.medication.list';

/** What a parameter value must parse as before it is placed in a URL. */
export type ParamKind = 'puuid' | 'pid' | 'mrn';

export interface PathParamSpec {
  readonly name: string;
  readonly kind: ParamKind;
}

export type QueryParamSpec =
  | { readonly key: string; readonly kind: ParamKind; readonly fixed?: undefined }
  | { readonly key: string; readonly kind: 'fixed'; readonly fixed: string };

export interface UpstreamRouteSpec {
  readonly id: UpstreamRouteId;
  readonly api: 'fhir' | 'rest';
  /** Path under the API prefix, with `{name}` placeholders. */
  readonly pathTemplate: string;
  readonly pathParams: readonly PathParamSpec[];
  /** The exact allowed query keys. Nothing else is ever sent. */
  readonly query: readonly QueryParamSpec[];
  readonly scope: string;
  readonly acl: string;
  /**
   * How the route is bound to one patient (3.13). `none` is allowed only for a
   * fixed-literal code list with no parameters at all (`rest.list.read`).
   */
  readonly patientBinding: 'path' | 'query' | 'none';
}

export const API_PREFIX = { rest: '/apis/default/api', fhir: '/apis/default/fhir' } as const;

export const UPSTREAM_ROUTES: Readonly<Record<UpstreamRouteId, UpstreamRouteSpec>> = {
  'fhir.patient.read': {
    id: 'fhir.patient.read',
    api: 'fhir',
    pathTemplate: '/Patient/{puuid}',
    pathParams: [{ name: 'puuid', kind: 'puuid' }],
    query: [],
    scope: 'user/Patient.rs',
    acl: 'patients/demo',
    patientBinding: 'path',
  },
  'rest.patient.read': {
    id: 'rest.patient.read',
    api: 'rest',
    pathTemplate: '/patient/{puuid}',
    pathParams: [{ name: 'puuid', kind: 'puuid' }],
    query: [],
    scope: 'user/patient.rs',
    acl: 'patients/demo',
    patientBinding: 'path',
  },
  // Patient selection by MRN. FHIR `identifier` is a token search over
  // `ss` and `pubpid` (FhirPatientService.php:129@legacy-baseline), so the BFF
  // keeps only entries whose `PT` identifier equals the MRN exactly.
  'fhir.patient.search': {
    id: 'fhir.patient.search',
    api: 'fhir',
    pathTemplate: '/Patient',
    pathParams: [],
    query: [{ key: 'identifier', kind: 'mrn' }],
    scope: 'user/Patient.rs',
    acl: 'patients/demo',
    patientBinding: 'query',
  },
  // Allergies card (01-02-01). The route ignores the query string upstream
  // (ALLERGY-SERVICES.md "Confirmed gap"); we never send one.
  'rest.allergy.list': {
    id: 'rest.allergy.list',
    api: 'rest',
    pathTemplate: '/patient/{puuid}/allergy',
    pathParams: [{ name: 'puuid', kind: 'puuid' }],
    query: [],
    scope: 'user/allergy.rs',
    acl: 'patients/med',
    patientBinding: 'path',
  },
  // The allergy severity labels (`list_options` where list_id = severity_ccda).
  // The list name is a fixed literal, never a parameter: no other list is reachable.
  'rest.list.read': {
    id: 'rest.list.read',
    api: 'rest',
    pathTemplate: '/list/severity_ccda',
    pathParams: [],
    query: [],
    scope: 'user/list.r',
    acl: 'lists/default',
    patientBinding: 'none',
  },
  // Medical Problems card (01-02-02). Note the ACL: encounters/notes, not
  // patients/med like the legacy card's gate (3.14, CONDITION-SERVICES.md
  // Finding 1/2), so this card can be forbidden while its siblings load.
  'rest.problem.list': {
    id: 'rest.problem.list',
    api: 'rest',
    pathTemplate: '/patient/{puuid}/medical_problem',
    pathParams: [{ name: 'puuid', kind: 'puuid' }],
    query: [],
    scope: 'user/medical_problem.rs',
    acl: 'encounters/notes',
    patientBinding: 'path',
  },
  // Medications card (01-02-03). This route takes the integer pid, which the
  // BFF only ever takes from `rest.patient.read` for the requested puuid (10.04).
  'rest.medication.list': {
    id: 'rest.medication.list',
    api: 'rest',
    pathTemplate: '/patient/{pid}/medication',
    pathParams: [{ name: 'pid', kind: 'pid' }],
    query: [],
    scope: 'user/medication.rs',
    acl: 'patients/med',
    patientBinding: 'path',
  },
};

export class AllowListViolation extends Error {
  override readonly name = 'AllowListViolation';
}

function parseParam(kind: ParamKind, value: unknown): string | null {
  switch (kind) {
    case 'puuid':
      return parsePatientUuid(value);
    case 'pid': {
      const pid = parsePid(value);
      return pid === null ? null : String(pid);
    }
    case 'mrn':
      return parseMrn(value);
  }
}

/**
 * Build the path + query for an allow-listed upstream route.
 *
 * Throws `AllowListViolation` on an unknown route, an unknown or missing query
 * key, a caller-supplied value for a fixed key, or a parameter that fails its
 * parser. Values are URL-encoded after validation.
 */
export function buildUpstreamPath(
  routeId: UpstreamRouteId,
  pathParams: Readonly<Record<string, unknown>> = {},
  query: Readonly<Record<string, unknown>> = {},
): string {
  if (!Object.hasOwn(UPSTREAM_ROUTES, routeId)) throw new AllowListViolation('unknown upstream route');
  const spec = UPSTREAM_ROUTES[routeId];

  for (const name of Object.keys(pathParams)) {
    if (!spec.pathParams.some((p) => p.name === name)) {
      throw new AllowListViolation(`route ${routeId} has no path parameter ${name}`);
    }
  }
  let path = spec.pathTemplate;
  for (const p of spec.pathParams) {
    const parsed = parseParam(p.kind, pathParams[p.name]);
    if (parsed === null) throw new AllowListViolation(`route ${routeId}: invalid ${p.kind} path parameter ${p.name}`);
    path = path.replace(`{${p.name}}`, encodeURIComponent(parsed));
  }

  for (const key of Object.keys(query)) {
    const allowed = spec.query.find((q) => q.key === key);
    if (!allowed) throw new AllowListViolation(`route ${routeId}: query key not allowed`);
    if (allowed.kind === 'fixed') throw new AllowListViolation(`route ${routeId}: ${key} is fixed and cannot be supplied`);
  }
  const search = new URLSearchParams();
  for (const q of spec.query) {
    if (q.kind === 'fixed') {
      search.append(q.key, q.fixed);
      continue;
    }
    const parsed = parseParam(q.kind, query[q.key]);
    if (parsed === null) throw new AllowListViolation(`route ${routeId}: invalid or missing ${q.kind} query value ${q.key}`);
    search.append(q.key, parsed);
  }
  const qs = search.toString();
  return `${API_PREFIX[spec.api]}${path}${qs ? `?${qs}` : ''}`;
}
