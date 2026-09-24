# S8 design: W2 uploads persisted in the deployed OpenEMR

Read-only spike, 2026-09-24. Scope: PLAN.md S8, D1, D7, A2, A3, W2-C1, W2-C2.
Evidence comes from the VM (`vultr-openemr-1`, `vultr-mysql-1`) unless marked
"local". Anything not exercised end to end is marked **UNVERIFIED**.

## 1. Verified facts

| # | Fact | Evidence |
|---|---|---|
| F1 | The deployed OpenEMR is 8.0.0 (`v_database=531`) on PHP 8.4.16, served by Apache `httpd` with `mod_php` (`php_module`). The DB is named `openemr` (MariaDB 11.8.8). | `version.php`, `php -v`, `httpd -M`, `SHOW DATABASES` |
| F2 | `AGENTFORGE_DEMO_SECRET` is set in the httpd PID 1 environment, so `getenv()` works under mod_php. It is also set in `agentforge-w2`. | `/proc/1/environ` count = 1 (value not printed) |
| F3 | `agentforge` and `agentforge-w2` are both on `vultr_default` with `openemr`. `fetch('http://openemr/meta/health/readyz')` returns 200 from both. OpenEMR serves plain HTTP on :80 inside the network. | `docker inspect`, node fetch |
| F4 | **The module path is public.** Caddy's catch-all `handle { reverse_proxy openemr:80 }` forwards it. `GET https://dtstest.64.177.10.182.nip.io/interface/modules/custom_modules/oe-module-agentforge/info.txt` returns 200, and so does `.../public/index.php`. | curl from the host |
| F5 | `oe-module-agentforge` is registered and active (`modules.mod_id=19`, `mod_active=1`), so `openemr.bootstrap.php` runs on every `globals.php` load, with `$classLoader` (a `ModulesClassLoader`) in scope. `registerNamespaceIfNotExists()` exists in 8.0.0. | `modules` table, `src/Core/ModulesApplication.php:171`, `src/Core/ModulesClassLoader.php:61` |
| F6 | `$ignoreAuth = true;` set **before** `require globals.php` skips `auth.inc.php` (`interface/globals.php:108,742`). With no `site_id` in the session, the site comes from `$_GET['site']`, or else from `HTTP_HOST` falling back to `default` (`globals.php:246-294`). There is an in-tree precedent at `library/ajax/sql_server_status.php:18`. The faxsms `webhook_receiver.php` sets the flag after the require, which is a bug; do not copy it. | container source |
| F7 | `Document::createDocument($patient_id, $category_id, $filename, $mimetype, &$data, $higher_level_path='', $path_depth=1, $owner=0, $tmpfile=null, $date_expires=null, $foreign_reference_id=null, $foreign_reference_table=null)` returns `''` on success or an error string. Read the new id with `$doc->get_id()`. `owner` falls back to the session's `authUserID`, which is empty here, so pass it explicitly. It stores `documents.hash = sha3-512(plaintext)`. 8.2.0-dev adds a 13th arg, `$eid`; do **not** pass it. | `library/classes/Document.class.php:889-1095` |
| F8 | Storage is `document_storage_method=0` (filesystem) with `drive_encryption=1`. Files land at `sites/default/documents/<pid>/<drive_uuid>` and are **encrypted**, so the on-disk bytes are not the PDF. Byte-identity must use `Document::get_data()`, which decrypts, or REST `GET /api/patient/:pid/document/:did` (`DocumentRestController::downloadFile` → `BinaryFileResponse`). `secure_upload=1` is enforced only in `DocumentService::insertAtPath`. Calling `createDocument` directly bypasses it, so the module must check file types itself. `generate_doc_thumb=0`. | `globals` table, `Document.class.php`, `DocumentService.php:124-157` |
| F9 | `categories` is a nested set (root id 1, `rght=67`, `categories_seq.id=34`). The existing categories **Lab Report** (id 2) and **Medical Record** (id 3) both have `aco_spec='patients\|docs'`. There is no "AgentForge Uploads" category. | `SELECT ... FROM categories` |
| F10 | FHIR lab Observations in 8.0.0 come from `FhirObservationLaboratoryService` → **`ProcedureService::search`**, not `ObservationLabService`, which is commented out (`FhirObservationLaboratoryService.php:71,166`). A row appears only if: `procedure_order.activity=1`; a `procedure_order_code` row exists whose `procedure_order_seq` **equals** `procedure_report.procedure_order_seq`; `procedure_report.uuid` is non-empty; `procedure_result.procedure_report_id` links to the report; and `result` is not `DNR`/`TNP`. Patient scoping uses `patient_data.uuid` via `porder.patient_id`. | `ProcedureService.php:75-330` |
| F11 | FHIR field mapping: `result_code`+`result_text` → `code` (LOINC system, needs both); `result` → value; `units`; `range` → `referenceRange` **only if it parses as `low-high`** (`"under 5.7"` yields none); `abnormal` → interpretation, using `list_options` `proc_res_abnormal` = `no,yes,high,low,vhigh,vlow`; `result_status` must be one of `final/preliminary/...` or it becomes `unknown`; `effectiveDateTime` = `procedure_report.date_report`; the Observation id is `procedure_result.uuid`; `comments` → `note`. | `FhirObservationLaboratoryService.php:220-360`, `list_options` |
| F12 | Relevant columns: `procedure_order(procedure_order_id AI, uuid, provider_id, patient_id, encounter_id, date_collected, date_ordered, order_status, activity, control_id varchar(255), lab_id, procedure_order_type default 'laboratory_test', ...)`; `procedure_order_code(procedure_order_id, procedure_order_seq PK, procedure_code, procedure_name, procedure_source, procedure_order_title, procedure_type)`; `procedure_report(procedure_report_id AI, uuid, procedure_order_id, procedure_order_seq, date_collected, date_report, report_status, review_status, report_notes)`; `procedure_result(procedure_result_id AI, uuid, procedure_report_id, result_data_type, result_code, result_text, date, units, result, range, abnormal, comments, document_id bigint, result_status)`. Today `procedure_order` has 0 rows. | `DESCRIBE` |
| F13 | **The FHIR HTTP API is off:** `rest_fhir_api=0`, `rest_api=1`. The saved token's scope is `openid offline_access user/patient.rs user/encounter.rs user/medical_problem.rs user/allergy.rs user/medication.rs user/document.rs`, with no `api:fhir` and no Observation. The enabled client allows `password\|refresh_token`, but `oauth_password_grant=0`. | `globals`, `oauth_clients`, token file keys |
| F14 | The token's `expires_at` (1789833960522 ms) is 2026-09-19 16:06 UTC, so the access token has expired. `api_refresh_token` holds 4 unrevoked rows with expiry 2026-12-18..19 (`GRANT_TYPE_REFRESH_TOKEN_TTL='P3M'`), so a refresh **should** succeed. **UNVERIFIED** until the adapter exercises it. The container runs as root and can rewrite the bind-mounted cache file in place. | `api_refresh_token`, `AuthorizationController.php:111` |
| F15 | Synthetic patients: pid 1 is "Test Patient One", DOB 1980-04-12, uuid `a2c37f7f-1076-4172-b17a-bee8bb8d2da6`. It matches the intake PDFs' name and DOB; the manifest's `patient_fixture` is `fixture-patient-001`. pids 2-6 are the 2026-09-18 seed (`AF-SYN-0N`); the seed file has `patient_ref/pid/name/marker/encounters/problems/medications/allergies` and does not include pid 1. User `admin` is id 1, with uuid `a2c37ca7-696f-41cd-be17-ce0e5ae0a9a3` and no NPI. | `patient_data`, `users`, seed JSON shape |
| F16 | `lists` writes: `AllergyIntoleranceService::insert(['puuid','title',...])` validates the input and creates the uuid. `ListService::insert` (used for medication) sets no uuid. `lists` has `uuid, type, title, begdate, comments, pid, user, verification, external_id varchar(20)`. The verification options are `confirmed/unconfirmed/refuted/entered-in-error`. | `src/Services/*.php`, `DESCRIBE lists` |
| F17 | 8.0.0 `QueryUtils` has `inTransaction`, `sqlInsert`, `querySingleRow(string,array)`, `fetchRecords`, `fetchSingleValue` and `existsTable`. It does **not** have `affectedRows` or `getLastError`, and there is no `src/BC/` (so no `DatabaseConnectionFactory` and no `ServiceContainer`). `SystemLogger` and `EventAuditLogger::newEvent($event,$user,$group,$success,$comments,$pid,...)` exist. PHP limits: `post_max_size=30M`, `memory_limit=512M`. | container source, `php.ini` |
| F18 | **Existing bug in `public/index.php`:** it calls `AclMain::aclCheckCore('patients','med',$user)` with `$user = authUserID` (`"1"`), but `aclCheckCore` expects a username (the gacl ARO value is `admin`). Every launcher request therefore fails the ACL check and returns 403. It also sends `clinician_uuid = "1"`, which is not a uuid. **UNVERIFIED in a browser, but confirmed by code and data.** | `AclMain.php:167-182`, `gacl_aro` |
| F19 | `deploy.sh` moves `interface/modules/custom_modules/oe-module-agentforge` to a backup directory and extracts a new copy, but it rebuilds only the agentforge services. A bind mount stays pinned to the old (moved) directory inode, so **the openemr container keeps running the old module until it is restarted.** | `deploy/vultr/deploy.sh`, compose bind mount |
| F20 | Local toolchain: `vendor/` is empty, there is no composer, and local PHP 8.4.25 lacks openssl, mbstring and sodium but has `hash`. PHPStan and PHPUnit cannot run locally without the dev stack. The container image has no `vendor/phpunit`. `.githooks/pre-commit` is Node-only. | local `ls`/`php -m`, container `ls vendor` |

## 2. Decisions

- **D-A (endpoint):** add one front controller, `public/api.php?site=default&route=<route>`. It sets
  `$ignoreAuth = true` before `globals.php`, reads only `OEGlobalsBag::getInstance()->get('restRequest')`
  (an `HttpRestRequest`, i.e. a Symfony Request), which keeps it inside the `ForbiddenRequestGlobalsRule`, and dispatches on
  `route`. Service calls go to `http://openemr/...` inside the network. Caddy returns 404 for
  `/interface/modules/custom_modules/oe-module-agentforge/public/api.php*` on all three site blocks.
  HMAC is still mandatory, because the internal network is not an auth boundary.
- **D-B (categories):** reuse existing categories, looked up by name at runtime: `lab_pdf` → "Lab Report";
  `intake_form` and `derived_facts` → "Medical Record". Creating "AgentForge Uploads" would mean a
  nested-set `lft/rght` shift plus a `categories_seq` bump, which is deferred. Update PLAN S8 wording to match.
- **D-C (FHIR read-back):** `route=lab-observations` calls `FhirObservationService::getAll(['category'=>'laboratory'], $puuid)`
  **in-process** and returns the serialized US Core Observations. Label it
  `read_path: "openemr-fhir-service-in-process"`. The public `/fhir` HTTP read stays unavailable
  (F13). An HTTP FHIR read would need a human step: set `rest_fhir_api=1` and authorize a client with
  `api:fhir user/Observation.rs` interactively. Record that in W2_ARCHITECTURE as a known gap and do not
  call it the FHIR HTTP API.
- **D-D (actor):** the service forwards the **context token that the module launcher signed**. The module
  re-verifies that token and takes the actor from it. The service never asserts identity on its own.
  Fix F18: `index.php` sets `clinician_uuid = users.uuid` and checks the ACL with `authUser`. It also
  mints a second token, `scope=write-source-document, acl=write`, only when the user has
  `patients/docs` write access (`aclCheckCore('patients','docs',$authUser,['write','addonly'])`).
- **D-E (public demo fallback, labeled):** graders cannot log into OpenEMR, so in live mode
  `/v1/source-document-context` may still issue `issuer=synthetic-demo` tokens, but only for the uuids in
  `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` (initially pid 1's uuid). The module accepts `synthetic-demo`
  only for patients on its own copy of that allowlist (openemr env), and records the actor as
  `AGENTFORGE_DEMO_ACTOR_USERNAME` (for example `admin`, or a dedicated user created by a human). The ledger
  and audit rows record `issuer`, so demo writes are distinguishable.

## 3. Endpoint contract (module)

Every request carries these headers:
`X-AgentForge-Key-Id: v1`, `X-AgentForge-Timestamp: <unix s>`, `X-AgentForge-Nonce: <32 hex>`,
`X-AgentForge-Content-SHA256: <hex sha256 of raw body; sha256("") for GET>`, `X-AgentForge-Signature: <base64url>`.
Bodies are JSON (`content-type: application/json`) and at most 8 MiB. Base64 content decodes to at most 5 MiB, matching `MAX_SOURCE_DOCUMENT_BYTES`.

**POST `route=documents`** stores a source PDF or a derived-facts JSON:
```json
{"patient_uuid":"a2c37f7f-1076-4172-b17a-bee8bb8d2da6","context_token":"<b64url.b64url>",
 "document_type":"lab_pdf|intake_form|derived_facts","filename":"filled-lab-a.pdf",
 "mime_type":"application/pdf|application/json","content_sha256":"<hex>","content_base64":"...",
 "source_document_id":57}
```
`source_document_id` is required only for `derived_facts`. It is stored as
`foreign_reference_table='documents', foreign_reference_id=<id>`, which `createDocument` supports natively.
Checks: the decoded sha256 equals `content_sha256`; PDFs start with `%PDF-`; derived facts must parse with
`json_decode(..., flags: JSON_THROW_ON_ERROR)`; the filename has no `/`, `\` or `..` and is at most 255 characters.
Response `201` (created) or `200` (duplicate):
```json
{"status":"created|duplicate","document_id":57,"document_uuid":"...","category":"Lab Report",
 "content_sha256":"<hex>","size_bytes":48213,"idempotency_key":"doc:v1:1:lab_pdf:<sha256>",
 "persistence_boundary":"openemr-module"}
```

**GET `route=documents&patient_uuid=..&document_id=57`** returns
`{"document_id":57,"mime_type":"application/pdf","size_bytes":..,"content_sha256":"<sha256 of get_data()>","sha3_512_matches_documents_hash":true,"content_base64":"..."}`.
It checks `foreign_id == pid` and `deleted = 0`, and returns 404 otherwise.

**POST `route=lab-results`**:
```json
{"patient_uuid":"...","context_token":"...","source_document_id":57,"source_sha256":"<hex>",
 "results":[{"field_id":"lab.hgb","loinc_code":"718-7","test_name":"Hemoglobin","value":"13.2","unit":"g/dL",
   "reference_range":"12.0-16.0","abnormal":"no","collection_date":"2026-09-20","page":1}]}
```
Validation: `loinc_code` matches `^\d{1,7}-\d$`; `abnormal` is one of `yes|no|high|low|vhigh|vlow` (the service maps the
source's "Yes"/"No" literally and never infers high/low); the date is `Y-m-d`; there are 1 to 50 results; and the source document belongs
to this pid, is `lab_pdf`, and its ledger sha equals `source_sha256`. The LOINC map lives in the service
(`lab.hgb → 718-7`, "Hemoglobin [Mass/volume] in Blood"; `lab.a1c → 4548-4`, "Hemoglobin A1c/Hemoglobin.total in Blood"). They are the only two analytes in the code today.
Response:
```json
{"status":"created|duplicate","payload_differs":false,"procedure_order_id":9,"procedure_report_id":9,
 "results":[{"field_id":"lab.hgb","procedure_result_id":21,"observation_id":"<procedure_result.uuid>"}],
 "idempotency_key":"lab:v1:1:<source_sha256>"}
```

**GET `route=lab-observations&patient_uuid=..&source_document_id=57`** returns
`{"resourceType":"Bundle","type":"searchset","read_path":"openemr-fhir-service-in-process","entry":[{"resource":{Observation}}]}`,
filtered to the observation ids in that document's ledger row.

**POST `route=clinical-list-items`**, called only after the clinician confirms (A3):
```json
{"patient_uuid":"...","context_token":"<write-clinical-action token>","source_document_id":58,
 "confirmation_event_id":"evt-...","items":[{"kind":"medication|allergy","title":"Metformin 500 mg daily","field_id":"medications"}]}
```
Allergies go through `AllergyIntoleranceService::insert(['puuid'=>..,'title'=>..,'verification'=>'confirmed','comments'=>'AgentForge intake doc 58; clinician-confirmed evt-...'])`.
Medications go through a direct `QueryUtils::sqlInsert` into `lists` with `type='medication'`, activity 1, a new `UuidRegistry` uuid, `user=<username>`,
and the same comments. That covers the `ListService::insert` case, which sets no uuid. Response:
`{"status":"created|duplicate","items":[{"kind":"allergy","list_id":31,"list_uuid":"...","duplicate":false}]}`.

**Errors:** 400 `invalid_request` with issue codes; 401 `signature_invalid|timestamp_skew|context_invalid`;
409 `nonce_replayed`; 403 `acl_denied|patient_scope_mismatch|demo_patient_not_allowed`; 404 `patient_not_found|document_not_found`;
503 `module_not_configured|ledger_not_installed`; 500 `write_failed`. Error responses never include `getMessage()`. The exception is logged
through PSR-3 with its context.

## 4. HMAC scheme

- `k_write = HMAC-SHA256(key=AGENTFORGE_DEMO_SECRET, msg="agentforge/openemr-write/v1")`. This separates request signatures from
  context-token signatures, which use the raw secret, the same way as in `index.php` and `accessContext.js`.
- The canonical string is newline-joined:
  `AGENTFORGE-HMAC-SHA256-V1`, `METHOD`, `route`, `site`, `patient_uuid`, `content_sha256` (from the body field, or `-`),
  `body_sha256` (the header value, which is recomputed and must match), `timestamp`, `nonce`.
- Signature: `base64url(HMAC-SHA256(k_write, canonical))`, compared with `hash_equals` in PHP and `crypto.timingSafeEqual` in Node.
- Skew: `abs(now - ts) <= 300`. Nonce: `^[0-9a-f]{32}$`. `INSERT INTO agentforge_request_nonce(nonce, expires_at=ts+600)` runs
  in autocommit before any write, and a duplicate key returns 409. Each request also runs `DELETE ... WHERE expires_at < now`, which is cheap on a tiny table.
- Context token: the module verifies it with the raw secret and the existing launcher format. It checks that `exp` is in the future and at most 300 s ahead, that
  `patient_uuid` matches the request, the `scope/acl` pair (`write-source-document/write` for documents and lab results;
  `write-clinical-action/write` for list items), and that `issuer` is in (`openemr-module` with `authn=openemr-session`) or
  (`synthetic-demo` with an allowlisted patient).
- Mapping: patient uuid → pid via `SELECT pid FROM patient_data WHERE uuid = ?` (`UuidRegistry::uuidToBytes`).
  Actor: `users.uuid` → `id, username`, which must be `active=1`, followed by a server-side `AclMain::aclCheckCore(section, value, username, ['write','addonly'])`
  (`patients/docs` for documents; `patients/lab` for lab results; `patients/med` for lists).
- Shared test vectors: `oe-module-agentforge/tests/fixtures/hmac-vectors.json` holds `{secret, inputs, canonical, signature}` and is
  consumed by both the Node client test and the PHP verifier test, so the two languages cannot drift apart.

## 5. Row plan and idempotency

Install (`oe-module-agentforge/table.sql`, applied once by a deploy step; the endpoint checks `QueryUtils::existsTable` and returns 503 if the tables are missing):
```sql
CREATE TABLE IF NOT EXISTS agentforge_write_ledger (
  idempotency_key VARCHAR(160) NOT NULL PRIMARY KEY, operation VARCHAR(32) NOT NULL,
  pid BIGINT NOT NULL, content_sha256 CHAR(64) NULL, document_id BIGINT NULL,
  procedure_order_id BIGINT NULL, response_json TEXT NOT NULL, payload_sha256 CHAR(64) NOT NULL,
  actor_user_id BIGINT NOT NULL, issuer VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL,
  KEY pid_sha (pid, content_sha256)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS agentforge_request_nonce (
  nonce CHAR(32) NOT NULL PRIMARY KEY, expires_at INT UNSIGNED NOT NULL, KEY (expires_at)) ENGINE=InnoDB;
```
Idempotency keys: `doc:v1:<pid>:<document_type>:<sha256>`; `derived:v1:<pid>:<source_document_id>` (the first write wins, so a
non-deterministic re-extraction still adds 0 rows); `lab:v1:<pid>:<source_sha256>`; `list:v1:<pid>:<kind>:<source_document_id>:<sha256(lower(trim(title)))>`.

Write path for each operation:
1. `SELECT GET_LOCK(<key>, 10)` (release it in `finally`).
2. Look up the ledger row. If it exists, return the stored `response_json` with `status:"duplicate"`, and set `payload_differs` if `payload_sha256` differs.
3. Otherwise run `QueryUtils::inTransaction`: do the writes, insert the ledger row, then call `EventAuditLogger::instance()->newEvent('agentforge-write', $username, 'Default', 1, 'op=<op> doc=<id> n=<count> issuer=<iss>', $pid)`. Never put values or names in the audit comment.

Lab rows for one source PDF:
- `procedure_order`: uuid from `UuidRegistry(['table_name'=>'procedure_order'])`; `patient_id=pid`, `provider_id=0` (the actor did **not** order this test), `encounter_id=0`, `date_ordered=NOW()`, `date_collected=<collection_date>`, `order_status='complete'`, `activity=1`, `control_id='AF1:'.<sha256>`, `procedure_order_type='laboratory_test'`, `clinical_hx=''`.
- `procedure_order_code`: exactly one row, seq 1: `procedure_code='AF-EXTRACTED-LAB'`, `procedure_name='AgentForge extracted lab report'`, `procedure_source='1'`. Use exactly one code row: the legacy `ObservationLabService` joins order codes without the seq, so extra code rows would duplicate results.
- `procedure_report`: uuid; `procedure_order_seq=1` (must equal the code seq, per F10); `date_collected` = `date_report` = collection date (the source has no report date, and FHIR `effectiveDateTime` reads `date_report`); `report_status='final'`; `review_status='received'` (not clinician-reviewed); `report_notes='AgentForge extraction from document <id>; not clinician-reviewed'`.
- `procedure_result`, one per result: uuid; `result_data_type` = `'N'` if numeric, else `'S'`; `result_code=<loinc>`; `result_text=<test_name>`; `date=<collection_date>`; `units`; `result`; `range` (raw source text, never rewritten); `abnormal`; `result_status='final'`; `document_id=<source doc id>`; `comments='agentforge:v1 doc=<id> page=<p> field=<field_id>'`.

## 6. Service side (agentforge)

- New `src/openemrModuleClient.js` signs requests per §4 and uses `fetch` with a timeout. It maps HTTP errors to codes and never logs bodies.
- New `src/openemrModuleWriteback.js` is an **async** implementation of the `SyntheticWriteback` surface
  (`persistSourceDocument`, `getSourceDocument`, `persistLabResults`, `persistDerivedFacts`, `confirmClinicalListItems`),
  with `persistence_boundary:'openemr-module'`. The upload chain in `service.js` is synchronous today
  (`ingestSourceDocument`, `readSourceDocument`, `extractLabEvidence`, `extractIntakeEvidence`), and the `server.js` handlers must `await` it.
  **Coordinate with the agent editing `agentforge/`.**
- `server.js` in live mode: `writeback = new OpenEMRModuleWriteback(...)` instead of `null` (line 80). The upload routes stop
  returning `synthetic_writeback_only` when the module writeback is configured. The upload response gains
  `openemr:{document_id, derived_document_id, observation_ids[]}`. `clinicalActions.js` gains the types `medication` and `allergy`,
  and in live mode `confirm()` calls `route=clinical-list-items`. Drafts stay in memory; only confirmed items are written (A3).
- Compose: add `AGENTFORGE_OPENEMR_MODULE_URL=http://openemr/interface/modules/custom_modules/oe-module-agentforge/public/api.php`
  and `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` to both services. Add `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` and `AGENTFORGE_DEMO_ACTOR_USERNAME`
  to `openemr`. Rewrite the `agentforge-w2` comment "no OpenEMR dependency", which becomes false.

## 7. Files

Create, under `interface/modules/custom_modules/oe-module-agentforge/`:
- `public/api.php`: entry point. It contains the ignoreAuth flag, wiring and dispatch, and nothing else.
- `table.sql`.
- `src/Http/{HmacVerifier, ContextTokenVerifier, SignedRequest, JsonResponder}.php`: `HmacVerifier` and `ContextTokenVerifier` are pure, with no OpenEMR dependencies.
- `src/Domain/{DocumentType (enum), PatientUuid, LabResultInput, ClinicalListItemInput, IdempotencyKey}.php`.
- `src/Persistence/{WriteLedger, NonceStore, PatientResolver, ActorResolver, CategoryResolver}.php`.
- `src/Write/{DocumentWriter, LabResultWriter, ClinicalListWriter}.php` and `src/Read/{DocumentReader, LabObservationReader}.php`.
- `tests/fixtures/hmac-vectors.json`.

Modify: `openemr.bootstrap.php` (`$classLoader->registerNamespaceIfNotExists('OpenEMR\\Modules\\AgentForge\\', __DIR__.'/src')`);
`public/index.php` (the F18 fix and write-scope tokens); `moduleConfig.php` (the description still says "read-only");
`deploy/vultr/Caddyfile` (404 for `api.php`); `deploy/vultr/deploy.sh` (when module paths change: `docker compose restart openemr`,
wait for healthy, then apply `table.sql` via `docker exec -i vultr-mysql-1 mariadb ... openemr`); `deploy/vultr/docker-compose.yml`.
Agentforge: the new client/writeback files, `server.js`, `service.js`, `clinicalActions.js`, `contracts.js`, and tests.

Every PHP file starts with `declare(strict_types=1)` and a GPL header, uses `final readonly` DTOs, `DocumentType` as a backed enum
(persisted in the ledger), and `match` without `default`. It uses only APIs present in 8.0.0: no `ServiceContainer`, no
`DatabaseConnectionFactory`, no `QueryUtils::affectedRows`/`getLastError`, no `$eid` argument, and `querySingleRow` with two arguments.
There is one known conflict with the fork's PHPStan rules: `ForbiddenInstantiationsRule` bans `new SystemLogger` in favour of
`ServiceContainer::getLogger()`, which does not exist in 8.0.0. Confine `new SystemLogger()` to `api.php` with one
explained ignore, or a small `class_exists(ServiceContainer::class)` shim. **Decide before coding.**

## 8. Test plan

1. **Pure PHP (local now):** `php oe-module-agentforge/tests/run-pure.php` is a dependency-free assert script for `HmacVerifier`,
   `ContextTokenVerifier`, the request parsers, the `IdempotencyKey` and the lab row planner. It runs with local PHP 8.4, which has `hash`, and in the container
   (`docker exec vultr-openemr-1 php .../tests/run-pure.php`), which proves it works on 8.0.0. Add PHPUnit wrappers under
   `tests/Tests/Isolated/Modules/AgentForge/` for `openemr-cmd pit`, and mark data providers `@codeCoverageIgnore` per CLAUDE.md.
   Optionally add `php -l` plus `run-pure.php` to `.githooks/pre-commit` when `php` is on PATH; that only adds to the gate.
2. **Node:** client signing against `hmac-vectors.json`; `OpenEMRModuleWriteback` against a recorded fixture of module HTTP
   responses (created, duplicate, 401, 409, 403); the server live-mode upload flow with an injected fetch; and a deliberate regression
   (for example, drop `route` from the canonical string) that makes the vector test fail.
3. **Live smoke** (`deploy/vultr/smoke-s8.sh`, run from the host via ssh, output saved to `docs/agentforge/evidence/`):
   (a) record `SELECT COUNT(*)` from `documents WHERE foreign_id=1`, from `procedure_result` joined to pid 1, and from `lists WHERE pid=1`;
   (b) `docker exec vultr-agentforge-w2-1 node agentforge/scripts/s8-smoke.mjs`, using the demo issuer for pid 1, runs these steps:
   POST `filled-lab-a.pdf` → 201; POST it again → 200 duplicate with the same id; GET the document → sha256 equal to the local file;
   POST lab-results → 201; POST again → 200 duplicate; GET lab-observations → contains `718-7` with value 13.2 g/dL and
   `4548-4` with value 6.1 %; POST intake + derived facts twice (the second call creates nothing);
   (c) negative checks: unsigned → 401; timestamp −400 s → 401; reused nonce → 409; wrong patient in the context → 403;
   `curl -X POST https://dtstest.../interface/modules/custom_modules/oe-module-agentforge/public/api.php` → 404 at Caddy;
   (d) recount: rows grew only on the first pass, and the second full run of the script adds 0 rows (W2-C2);
   (e) independent read: the agentforge container's `OpenEMRRefreshTokenProvider` →
   `GET /apis/default/api/patient/1/document/<id>` → identical sha256 (W2-C1). This also proves F14.
   **UNVERIFIED** until it runs.

## 9. Risks and fallback

- R1 (F19): if openemr is not restarted after a deploy, the new PHP is invisible. Add the restart step and have the smoke script check for `route=health`.
- R2 (F4): the public path is exposed. The Caddy 404 rule plus mandatory HMAC and replay checks cover it. Test both.
- R3 (F13): FHIR over HTTP is disabled. The honest wording is "FHIR Observation resources produced by OpenEMR's FHIR service", not
  "the `/fhir` API". Enabling `rest_fhir_api` is a global settings change and needs explicit user approval plus an interactive OAuth consent.
- R4 (F20): PHPStan level 10 and PHPUnit need `docker/development-easy` (`openemr-cmd pst`/`pit`). Budget about 30 min to bring it up, or
  record them as not run.
- R5: `createDocument` writes the encrypted file before the DB transaction commits, so a rollback leaves an orphan file. This is acceptable; log it with the document uuid only.
- R6: context tokens have a 300 s TTL. An intake confirmation made after 5 min needs a fresh launch or demo token. The UI must refresh it.
- R7: `"under 5.7"` ranges produce no FHIR `referenceRange` in 8.0.0 (F11). Keep the raw text and do not fabricate `0-5.7`.
- R8: the concurrent `agentforge/` edits conflict with making the service async (§6). Sequence that change after the other agent lands.
- R9: the deployed `docker-compose.yml` on the VM differs from local (sha `380666c8…` vs `e78f8d03…`). The next deploy overwrites it, so diff it first.
- **Fallback (the PLAN circuit breaker, Sat 14:00):** ship only `route=documents` (the source PDF plus a derived-facts JSON with a `foreign_reference` to
  the source) and the GET read-back. That meets W2-C1. Mark W2-C2 as "derived facts stored as an OpenEMR document; not
  Observation rows" in W2_ARCHITECTURE. `procedure_*` writes and list writes are then `not done`.

## 10. Implementation deviations (S8 commit)

- **Canonical string:** two lines were added after `nonce`: the sorted query
  (`k=v&...`, keys `[a-z_]`, values `[A-Za-z0-9._-]`, so no percent-encoding can
  drift) and the sha256 of the context token (or `-`). The token moved from a
  body field to the `X-AgentForge-Context-Token` header, so GET and POST work
  the same way and the token is bound into the signature.
- **Content types:** `lab_pdf`/`intake_form` also accept `text/plain` (valid
  UTF-8, `.txt`, no NUL) so the deployed demo's synthetic scan envelope still
  works. `abnormal` also accepts `""` for "source states no flag".
- **Paths:** shared vectors are `agentforge/test/fixtures/hmac-vectors.json`;
  the PHP script is `tests/run.php` (pass the vector path when run outside the
  repo). No PHPUnit wrappers were added.
- **Service wiring:** persistence is chosen by `AGENTFORGE_PERSISTENCE_MODE`
  (`in-memory-synthetic` | `openemr-module`), independent of the chart mode, so
  W2 keeps its fixture chart. `AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP` maps
  `fixture-patient-001` to pid 1's uuid; for `synthetic-demo` contexts the
  service mints the module token for the mapped uuid, and it forwards
  `openemr-module` tokens unchanged. Derived facts and lab rows are written from
  the scan-supervisor path after the typed contract validates. The legacy
  `LAB|`/`INTAKE|` text lane returns `OBSERVATION_WRITE_UNAVAILABLE` in module
  mode. `clinicalActions.js` was not changed: the module route and client
  method for list items exist, but the confirm lane does not call them yet.
- **Reads:** GET `documents` returns only documents in the ledger. GET routes
  accept any context scope and check read ACL.
- **Other:** lock names are hashed (the 64-character limit); the ledger has a
  `(pid, document_id)` index; `new SystemLogger()` is confined to `api.php`;
  `deploy.sh` uses `docker compose exec -T mysql` with `MYSQL_PWD`. The smoke
  is `agentforge/scripts/w2-openemr-smoke.mjs` (public mode plus
  `--module-checks`). The REST `GET /api/patient/:pid/document/:did`
  cross-check (F14) is not implemented, so F14 stays **UNVERIFIED**.
