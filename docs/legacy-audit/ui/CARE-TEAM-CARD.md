# CareTeamViewCard — Care Team dashboard card (DB-07)

The Care Team card is one of the six hardcoded primary cards on
`demographics.php` (`interface/patient_file/summary/demographics.php:1250-1276`,
per `ui/DASHBOARD-MAP.md` section 4). Unlike Allergies/Medical
Problems/Medications, it is not a plain read-only list: `CareTeamViewCard`
renders a single HTML `<form>` that is simultaneously the "view" and the
"edit" UI for one care team, toggled client-side between a read-only look
and an editable look, and POSTs back to `demographics.php` itself to save.
The user reaches it by loading the patient dashboard; there is no separate
page. Saving redirects nowhere — the same `demographics.php` request that
carries `save_care_team=true` re-renders the whole dashboard after the save
runs inside the card's own constructor.

**Source:**
`src/Patient/Cards/CareTeamViewCard.php` · 389 lines
`templates/patient/card/manage_care_team.html.twig` · 227 lines
`src/Services/CareTeamService.php::getCareTeamData()` (550-671) and
`::getExistingCareTeamMembers()` (677-689), read path only — the rest of
this 690-line service (`search`, `getAll`, `saveCareTeam`, and the FHIR-facing
query methods) is Phase 3 scope and not re-audited here beyond what's needed
to answer the key question.
No `@author`/`Version`/`Modified On` header on the twig file;
`CareTeamViewCard.php` header credits Jerry Padgett and Stephen Nielson,
copyright 2025.

**Audited by:** tier 2 · confidence high (key question), medium (findings
not re-verified against a running browser — see Open questions)

## Purpose & lifecycle

`new CareTeamViewCard($pid, ['dispatcher' => $ed])`
(`demographics.php:1253`) → constructor (`CareTeamViewCard.php:41-48`) →
`setupOpts()` computes ACL/collapse/button config, then
**`handleFormSubmission()` runs unconditionally, every time the object is
constructed** (`CareTeamViewCard.php:47`) — see Permission checks below,
this is where the CSRF-but-no-ACL gap is. `demographics.php:1270-1271` then
checks `$card->getAcl()` (`['patients','demo']`, read-level) before
rendering; if that passes, `array_merge($viewArgs,
$card->getTemplateVariables())` (`demographics.php:1273`) feeds
`manage_care_team.html.twig`. The template embeds the full member list as a
JSON blob in an inline `<script>` and builds every `<tr>` client-side on
`$(document).ready` (see Logic). There is no separate "Add Care Team"
screen reachable from elsewhere — `card->canAdd()` is hardcoded `false`
(`CareTeamViewCard.php:91`), so the header's `+` button never renders; only
the pencil ("Edit") button does, which just flips the same form between its
two CSS-class-driven visual states — no navigation occurs.

## Layout / interface

Card chrome (title bar, collapse toggle, Edit pencil) comes from
`patient/card/card_base.html.twig` (`templates/patient/card/card_base.html.twig`),
shared by all cards. `manage_care_team.html.twig` supplies the `content`
block: one `<form method="POST" action="">` containing:
- Team name text input + a "view" `<h5>` with a status badge
  (`manage_care_team.html.twig:172-180`)
- A team-status `<select>` (`:182-188`, tagged "AI-generated addition")
- `<table id="care_team_table">` with a server-rendered 8-column `<thead>`
  (Type, Member, Role, Facility, Since, Status, Note, Remove —
  `:192-201`) and an **empty `<tbody>`** with only the comment
  `{# Populated by JS #}` (`:203-205`)
- Action buttons: "Add Team Member", "Add Related Person", "Save Care
  Team" (submit), "Cancel" (`:208-221`) — all four carry the `editShow
  d-none` classes, so none is visible until edit mode is toggled on

Every row's cells carry two overlapping elements — a `.viewOnly` `<span>`
and an `.editShow` `<input>`/`<select>` — and `toggleEditMode()`
(`:17-21`) just flips `d-none` on whichever class set should be hidden.
This is a single DOM, not two templates: "view mode" and "edit mode" are
the same 8 columns of data with different form controls shown.

## State

```text
existingCareTeam   — JS const, the PHP `existing_care_team` array as JSON (one entry per member)
userOptions        — JS const, pre-built <option> HTML string for the user <select> (all active users)
relatedPersonOptions — JS const, pre-built <option> HTML for related-person <select>
hasRelatedPersons  — JS const, boolean gate for the "Add Related Person" button
facilityOptions, roleOptions, statusOptions — JS consts, pre-built <option> HTML
editModeEnabled    — JS closure var, current toggle state (starts false)
```

**Globals read:** none directly by `CareTeamViewCard`; it goes through
`AclMain`, `CsrfUtils`, `SessionWrapperFactory`, `QueryUtils` — no
`$GLOBALS`/`$_SESSION` reads in this file.
**Globals written:** none in this file (writes happen inside
`CareTeamService::saveCareTeam()`, Phase 3).

## Logic

### `CareTeamViewCard::setupOpts()` (`:83-110`)

Computes `$initiallyCollapsed` from `getUserSetting('careteam_ps_expand')`
(per-user dashboard preference, same mechanism as every other card — see
`ui/DASHBOARD-MAP.md` section 3) and a **write-level** ACL probe:
`AclMain::aclCheckCore('patients', 'demo', '', 'write')` (`:86`). This
`$authCheck` only controls `templateVariables['auth']`, which
`card_base.html.twig:5` uses to decide whether to render the pencil button
at all — it is never consulted again server-side. `btnLink` is hardcoded
`"javascript:void(0);"` with `linkMethod: 'html'` (`:102-103`); per
`ui/DASHBOARD-MAP.md`, this wins over demographics.php's own `btnLink:
'test'` placeholder in the later `array_merge`, so the pencil opens no
page — it only exists so `card_base.html.twig` renders an `<a>` that JS
attaches a click handler to (`manage_care_team.html.twig:157`).

### `CareTeamViewCard::getTemplateVariables()` (`:112-122`)

Merges in a `RenderEvent` dispatch result (prepended/appended injection —
an extension point, not traced further), `hasActiveTeam` from
`CareTeamService::hasActiveCareTeam($pid)` (`:119`), and the full result of
`getFormManagementData($pid)`. **`hasActiveTeam` is computed — a real
`SELECT COUNT(*) ... WHERE pid=? AND (status='active' OR status IS NULL)`
query (`CareTeamService.php:369`, cited in `api/CLINICAL-CARDS.md`) — but
never referenced in `manage_care_team.html.twig`** (confirmed:
`grep -rn hasActiveTeam templates` has no hits). Wasted query, not a
correctness bug.

### `CareTeamViewCard::handleFormSubmission()` (`:124-147`) — the write path

Runs on **every** construction of the card, not just POST requests — it
early-returns only if `save_care_team !== 'true'` (`:127`). If that gate
passes:
1. `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)` (`:130`) — the
   only defense on this endpoint; a missing/stale token kills the request.
2. Parses `team_id` (`ValidationUtils::validateInt`, false → null),
   `team_name` (trimmed), `team_status` (trimmed, default `'active'`), and
   `team` — the one field allowed to arrive as a raw array via
   `$request->all()` rather than the typed `getString()` accessor
   (`:132-140`, with an inline comment explaining why).
3. Dies with `xlt("Invalid request.")` if `$this->pid` is falsy (`:142-144`).
4. Calls `getCareTeamService()->saveCareTeam($pid, $teamId, $teamName,
   $team, $teamStatus)` (`:146`) — Phase 3 territory for its internals, but
   note it calls `getExistingCareTeamMembers($careTeamId)`
   (`CareTeamService.php:384`, inside `saveCareTeam` at `:375-446`), a
   **different, unfiltered** query (`SELECT ctm.* FROM care_team_member ctm
   WHERE ctm.care_team_id = ?`, `:679-682` — no status exclusion) than the
   read path below, presumably to diff/reconcile all rows including
   inactive ones during save.

**No ACL/authorization check anywhere in this method or in
`CareTeamService.php`** (`grep -n "AclMain|aclCheck"
src/Services/CareTeamService.php` — no hits at all in that 690-line file).
See Permission checks.

### `CareTeamViewCard::getFormManagementData($pid)` (`:158-359`) — the read path

1. `$careTeamResult = $this->getCareTeamService()->getCareTeamData($pid)`
   (`:162`) — see `CareTeamService::getCareTeamData()` below.
2. Reshapes `$careTeamResult['members']` into `$existingCareTeam[]`
   (`:166-183`) — this array becomes the `existing_care_team` template
   variable, later JSON-embedded into the page by
   `{{ existing_care_team|js_escape }}` (`manage_care_team.html.twig:23`).
3. Builds a "related persons" contact list via `ContactService` /
   `ContactRelationService` (`:186-197`, tagged "AI-generated... Start/End")
   — `getOrCreateForEntity('patient_data', $pid)`, then
   `getRelationshipsWithDetails()`. **Side effect worth flagging:** `getOrCreate`
   means simply loading this card's data can create a `contact` row for the
   patient if one didn't exist — a write triggered by a read-only card
   render. Not traced further (`ContactService` is out of this unit's
   scope), but the name says what it does.
4. Runs three more `QueryUtils::sqlStatementThrowException()` calls
   unrelated to `getCareTeamData`: active users + physician type
   (`:201-216`), facilities with `service_location=1 OR
   billing_location=1` (`:219-235`), and roles/statuses via
   `ListService::getOptionsByListName()` (`:238-257`, lists
   `care_team_roles` and `Care_Team_Status`) — these populate the `<select>`
   option-HTML strings built at `:260-307` (string-concatenated, using
   `attr()`/`text()` escaping helpers, not a twig loop).
5. Computes `team_status_display`/`team_status_badge_class` by re-scanning
   `$templateData['statuses']` for a match (`:309-329`, "AI-generated
   addition") — a small `match` on `$teamStatus` maps `active` →
   `badge-success`, `inactive` → `badge-warning`, `proposed` →
   `badge-info`, `entered-in-error` → `badge-danger`, default →
   `badge-secondary`.
6. Returns the full template-variable array including `csrf_token` via
   `CsrfUtils::collectCsrfToken()` (`:356`).

### `CareTeamService::getCareTeamData($pid)` (`CareTeamService.php:550-671`) — confirmed by read-only SQL

```php
// :562-582 (abridged)
FROM care_teams ct
LEFT JOIN (
   SELECT * FROM care_team_member
   WHERE status != 'inactive' AND status != 'entered-in-error'
) ctm ON ct.id = ctm.care_team_id
LEFT JOIN users u ON ctm.user_id = u.id
LEFT JOIN (SELECT id AS contact_record_id, foreign_id AS person_record_id
           FROM contact WHERE foreign_table_name = 'person') person_contact
  ON ctm.contact_id = person_contact.contact_record_id
LEFT JOIN person p ON person_contact.person_record_id = p.id
LEFT JOIN contact_relation cr ON cr.target_id = p.id AND cr.target_table='person' AND cr.active = 1
LEFT JOIN facility f ON ctm.facility_id = f.id
LEFT JOIN list_options lo1 ON lo1.option_id = ctm.role AND lo1.list_id = 'care_team_roles'
LEFT JOIN list_options lo2 ON lo2.option_id = ctm.status AND lo2.list_id = 'Care_Team_Status'
LEFT JOIN list_options lo3 ON lo3.option_id = u.physician_type AND lo3.list_id = 'physician_type'
WHERE ct.pid = ? AND (ct.status IS NULL OR ct.status != 'entered-in-error')
ORDER BY ct.team_name, ctm.date_created ASC
```

Two behaviors not visible from `api/CLINICAL-CARDS.md`'s FHIR-side read of
this service (that doc audited `search()`/`getAll()`, the API path — this
is the UI-only path):

- **The `care_team_member` subselect excludes `inactive` and
  `entered-in-error` members before the join even runs** (`:564-566`).
  Confirmed by running this exact query read-only against pid 13
  (see Key question below): the seeded inactive specialist (user 10)
  never appears in the result set at all, at the SQL level — not merely
  hidden by CSS or JS.
- **Only one care team is ever returned, even if the patient has several.**
  `:653-661`: loop over all found teams, return the first with
  `team_status === 'active'`; if none is active, `reset($careTeams)`
  (first found, any status). A patient with two active teams would
  silently lose one from this card (and its edit form) — `getAll()`/
  `search()` (Phase 3, cited in `api/CLINICAL-CARDS.md`) return every team
  regardless of status, so this is a card-specific narrowing not present
  on the API side. The code's own `TODO` at `:652` acknowledges this:
  *"at some point we want to support multiple care teams... for now
  return first active or first found."*
- If `$careTeams` ends up empty (no rows at all — a patient with zero
  care teams), the method returns a literal fallback shape (`:664-669`):
  `['team_name' => '', 'team_status' => 'active', 'members' => [],
  'member_count' => 0]` — no `team_id` key at all in this branch (handled
  by `?? null` at `CareTeamViewCard.php:342`).

### `manage_care_team.html.twig` — client-side rendering (`:8-163`)

`$(function () {...})` runs on document ready (not gated on the card's
collapse state — it executes whether or not the card is visually
collapsed, since Bootstrap `.collapse` only toggles CSS `display`, per
`card_base.html.twig:16`). Sequence:
1. `preloadTeamRows()` (`:31-107`): if `existingCareTeam.length === 0`,
   returns immediately — **no empty-state message is ever shown for this
   card**; an empty team is simply a table with a header row and no body
   rows, plus a blank team-name input. Unlike Allergies/Medical
   Problems/Medications/Prescriptions ("Nothing Recorded"/"None", per
   `RECON.md`), Care Team has no equivalent string — confirmed by reading
   the whole template: no literal empty-state text exists anywhere in it.
   Otherwise, for each member: derives `memberType` (`user` vs `contact`,
   `:35`), builds one `<tr>` via a template literal
   (`row.innerHTML = ...`, `:44-78`) with both `.viewOnly` and `.editShow`
   cells, appends it to `#care_team_table tbody` (`:79`), then re-selects
   each of its own `<select>`s to set their value and copy the selected
   option's text into the adjacent `.viewOnly` span (`:82-101`) — i.e. the
   "view" text for Role/Facility/Status is whatever label the freshly-set
   `<select>` resolves to, not a value sent separately from PHP.
2. `addTeamRow(memberType)` (`:109-151`): same row-building logic for a
   brand-new, empty member row when "Add Team Member"/"Add Related Person"
   is clicked; blocks the "Add Related Person" path with a `alert()` if
   `hasRelatedPersons` is false (`:111-117`).
3. `setupEvents()` (`:153-158`) wires the four action buttons; the pencil
   button (`.btn-edit-care-team`, from `card_base.html.twig`) toggles
   `editModeEnabled`.
4. `toggleEditMode(false)` (`:161`) runs once at the end — the form always
   starts in view mode regardless of `initiallyCollapsed`.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| View card (render at all) | yes | `AclMain::aclCheckCore('patients','demo')` (read), checked at `demographics.php:1271` against `$card->getAcl()` | Same ACL as the whole page-level gate (`demographics.php:1056`) — not Care-Team-specific, confirmed in `ui/DASHBOARD-MAP.md` |
| Show Edit pencil / edit-mode UI | yes (client-side only) | `AclMain::aclCheckCore('patients','demo','','write')` (`CareTeamViewCard.php:86`) drives `templateVariables['auth']`, consumed by `card_base.html.twig:5` | Purely cosmetic — hides the button, does not gate the endpoint |
| **Save care team (`save_care_team=true` POST)** | **missing** | CSRF only (`CsrfUtils::checkCsrfInput`, `CareTeamViewCard.php:130`); no `AclMain` call anywhere in `handleFormSubmission()` or in `CareTeamService.php` (confirmed by grep, zero hits for `AclMain\|aclCheck` in the 690-line service) | A user with **read-only** `patients/demo` (enough to view the page at all) can still submit a valid CSRF-protected POST and have `saveCareTeam()` execute — the write-level check exists only to decide whether the client shows the pencil button. Also runs from inside the constructor (`:47`), i.e. **before** `demographics.php:1271`'s own ACL check on this card even executes for that same request |
| Load care-team form data (`getFormManagementData`) | same as "View card" | n/a | Runs `ContactService::getOrCreateForEntity()` (`:190`), a potential row-creating side effect on a nominally read-only render — not verified further, out of unit scope |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `care_teams` | yes | Phase 3 (`saveCareTeam`, not audited here) | `getCareTeamData` (`CareTeamService.php:562`), `hasActiveCareTeam` (`:369`) | n/a for read path |
| `care_team_member` | yes (filtered: excludes `inactive`/`entered-in-error`) | Phase 3 | `getCareTeamData` (`:564-566`); unfiltered read via `getExistingCareTeamMembers` (`:679-682`) inside `saveCareTeam` | n/a |
| `users` | yes | no | `getCareTeamData` (`:567`); active-user list (`CareTeamViewCard.php:201-205`) | n/a |
| `contact`, `person`, `contact_relation` | yes | possibly (via `ContactService::getOrCreateForEntity`, not traced) | `getCareTeamData` (`:568-576`); `getFormManagementData` (`:187-197`) | n/a |
| `facility` | yes | no | `getCareTeamData` (`:577`); facility list (`CareTeamViewCard.php:219-225`) | n/a |
| `list_options` | yes | no | `care_team_roles`, `Care_Team_Status`, `physician_type` lookups (`:578-580`, `238-257`) | n/a |

## Cross-links

- **Opened by:** `demographics.php:1252-1276` (Care Team card block), inside
  the `if ($thisauth):` region documented in `ui/DASHBOARD-MAP.md` section 2.
- **Calls into:** `OpenEMR\Services\CareTeamService` (read path audited
  here; `search()`/`getAll()`/`saveCareTeam()` = Phase 3),
  `OpenEMR\Services\ListService::getOptionsByListName()`,
  `OpenEMR\Services\ContactService`, `OpenEMR\Services\ContactRelationService`
  (both unaudited), `OpenEMR\Common\Csrf\CsrfUtils`,
  `OpenEMR\Common\Utils\ValidationUtils`, `OpenEMR\Common\Http\HttpRestRequest`.
- **Shares a service with:** `src/RestControllers/FHIR/FhirCareTeamRestController.php`
  → `src/Services/FHIR/FhirCareTeamService.php` → `CareTeamService` (via
  `search()`/`getAll()`, not `getCareTeamData()` — the UI card and the FHIR
  API do **not** call the same read method; see Key question).
- **See also:** `api/CLINICAL-CARDS.md` DB-07 section for the FHIR
  endpoint, field-mapping table, and OAuth2 scopes (this doc corrects two
  of its "not confirmed — flagged" rows; see Parity spec below).

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | **High (provisional, not verified)** | `save_care_team=true` POST executes with CSRF protection but no server-side ACL/authorization check; the write-level check (`patients/demo` write mode) only gates whether the client renders the Edit button | `CareTeamViewCard::handleFormSubmission()` (`src/Patient/Cards/CareTeamViewCard.php:124-147`); confirmed zero `AclMain`/`aclCheck` references anywhere in `src/Services/CareTeamService.php` | Add an explicit `AclMain::aclCheckCore('patients','demo','','write')` (die/`AccessDenied` on failure) at the top of `handleFormSubmission()`, before the CSRF check or the `saveCareTeam()` call |
| 2 | Bug / Data-loss risk | Medium | `getCareTeamData()` returns only one care team per patient (first active, else first found) even if multiple exist; the DB schema and `search()`/`getAll()` support multiple | `CareTeamService::getCareTeamData()` (`src/Services/CareTeamService.php:652-661`, self-acknowledged `TODO` at `:652`) | Flag as a known limitation in the port; surfacing all teams needs a `saveCareTeam`/`getCareTeamData` rework (Phase 3) |
| 3 | Smell | Low | `hasActiveTeam` template variable is computed with a real DB query (`hasActiveCareTeam()`) but never referenced by the twig template | `CareTeamViewCard::getTemplateVariables()` (`:119`); confirmed no `hasActiveTeam` usage in `templates/` via grep | Delete the unused query and variable, or wire it into the UI (e.g. a "no active team" banner) |
| 4 | Smell / possible side effect on read | Low-Medium (not verified) | Rendering the card's edit-form data (`getFormManagementData`, a read operation from the caller's perspective) calls `ContactService::getOrCreateForEntity()`, whose name implies it can create a `contact` row as a side effect of a page load | `CareTeamViewCard::getFormManagementData()` (`:190`) | Verify `ContactService::getOrCreateForEntity()`'s actual behavior in Phase 3/4; if it does create rows, move creation to the save path only |
| 5 | UX gap vs. sibling cards | Low | No empty-state message exists for a patient with zero care teams (contrast Allergies/Medical Problems/Medications: "Nothing Recorded"; Prescriptions: "None") — the card just shows an empty, blank editable form | `manage_care_team.html.twig:31-32` (`preloadTeamRows()` early-return on empty array, no fallback markup); confirmed by full read of the template, no empty-state string present | Add an explicit empty-state string for the port, since there is no legacy string to carry over verbatim |
| 6 | Parity gap (client-rendered content) | Medium (structural, not a code bug) | Member rows are not present in the server-rendered HTML at all — they exist only as a JSON blob (`existing_care_team`) that client JS turns into `<tr>`s on document-ready. Any tooling, test, or port approach that reads server HTML without executing JS will see 0 member rows, exactly as the probe did | `manage_care_team.html.twig:23` (JSON embed), `:31-107` (`preloadTeamRows()`), `:203-205` (empty `<tbody>` with `{# Populated by JS #}`) | For the port: read `existing_care_team`'s equivalent directly from the API response and render it in the SPA framework's own template layer — do not attempt to scrape server HTML for this card |

## Port notes

- **Must survive:** the active-team, active/non-error-member filtering
  rule (`status != 'inactive' AND status != 'entered-in-error'` on
  members; `status IS NULL OR status != 'entered-in-error'` on the team)
  if strict display parity is the goal — otherwise the port's Care Team
  card will show the seeded inactive specialist that the legacy card
  never has.
- **Must not survive:** the CSRF-only, no-ACL save endpoint (Finding 1) —
  the port is read-only per the brief, so this doesn't carry over at all,
  but it's worth flagging for the legacy-code catalog regardless.
- **Open questions:**
  - Whether `ContactService::getOrCreateForEntity()` actually writes on a
    plain page load (Finding 4) — needs either a Phase 3/4 read of that
    class or a live-browser/Selenium check with query logging.
  - Whether a Selenium-driven load of `demographics.php?set_pid=13`
    (executing JS) shows exactly the 2 active members this audit computed
    via read-only SQL — not run in this pass (see Key question; read-only
    SQL replaces the JS behavior, but wasn't rendered in a real browser).
  - Whether `physician_type`/`physician_type_title` ever populates for
    real data — both seeded users (5, 6) have `physician_type IS NULL`, so
    this field's rendering path (`CareTeamService.php:635`,
    `manage_care_team.html.twig` badge "extra" text at
    `CareTeamViewCard.php:262`) is untested by the current seed.

## Parity spec for the port

Column-by-column mapping from the card's 8-column table
(`manage_care_team.html.twig:192-200`) to what an API-only client would
need. FHIR facts below are from `api/CLINICAL-CARDS.md` DB-07 plus direct
reads of `src/Services/FHIR/FhirCareTeamService.php` in this pass (two
corrections to that doc's "not confirmed" flags, marked below).

| Column | PHP card source | Format | FHIR `CareTeam` field | Standard REST | Match / gap for the port |
|---|---|---|---|---|---|
| Type | derived: `contact_id` set → `contact`, else `user` (`CareTeamService.php:607-619`) | badge text "Provider" / "Related Person" (`CareTeamViewCard.php` translations) | Implicit in participant reference type: `Practitioner` (`populateProviderTeamMembers`, `FhirCareTeamService.php:357-358`) vs `RelatedPerson` (`populateRelatedPersonTeamMembers`, `:408-409`) | n/a — no standard REST route exists for Care Team at all (`api/CLINICAL-CARDS.md` DB-07) | Client must infer Type from which reference type `participant.member` uses. **Caveat found in this pass:** `populateRelatedPersonTeamMembers` returns immediately, adding nothing, if the server's US Core profile version is `3.1.1` (`FhirCareTeamService.php:398-400`, code comment: "3.1.1 DOES NOT support RelatedPerson as care team members") — contact-type members can be invisible via FHIR entirely depending on server config |
| Member | `users.fname/lname` or `person.first_name/last_name` (`CareTeamService.php:609-616`) | `"Last, First"`-style concatenation, or `"First Last (relationship)"` for contacts | `CareTeamParticipant.member` → `Practitioner`/`RelatedPerson` reference (name resolved by dereferencing that resource) | n/a (no standard route) | Yes, via a second fetch of the referenced resource — no name string ships inline on the participant itself |
| Role | `care_team_member.role` + `list_options` title (`care_team_roles`) | free-text list label, e.g. "Nurse", "Primary Care Provider" | `CareTeamParticipant.role`, SNOMED CT via a fixed lookup table (`getRoleMappings()`, cited in `api/CLINICAL-CARDS.md`); falls back to generic "Healthcare professional" (223366009) if unmapped | n/a | Partial — SNOMED code, not the free-text role label; a port wanting the exact legacy label needs its own reverse-lookup of the SNOMED code back to `care_team_roles` |
| Facility | `care_team_member.facility_id` → `facility.name` (`CareTeamService.php:577`) | facility name string | `populateFacilityTeamMembers` → separate `Organization`-reference participant (`FhirCareTeamService.php:373-394`), or `onBehalfOf` on the provider's own participant (`:362-366`) | n/a | Yes, via reference dereference |
| Since | `care_team_member.provider_since`, formatted via `oeFormatShortDate()` (`CareTeamService.php:640`) | short localized date | **Confirmed this pass** (corrects `api/CLINICAL-CARDS.md`'s "not confirmed" flag): `CareTeamParticipant.period.start` — only set `if (!empty($dataRecordProvider['provider_since']))` (`FhirCareTeamService.php:342-346`) | n/a | Yes, for provider-type members only — related-person participants get no `period` at all (not set anywhere in `populateRelatedPersonTeamMembers`) |
| Status | `care_teams.status` (team-level; the card has no per-member status column despite the seed data having per-member status) | badge, via `Care_Team_Status` list-options title | `CareTeam.status` | n/a | Yes for the team. **Note:** the visible "Status" column header is per-*row* in the twig markup, but the value populated by `getFormManagementData`/`preloadTeamRows` is `member.status` (`care_team_member.status`, e.g. `active`), a genuinely different value from the team-level badge shown next to the team name — both exist in FHIR (`CareTeam.status` for the team; no per-participant status field defined in FHIR CareTeam) |
| Note | `care_team_member.note` (populated in the seed: `"Nurse [seed:phase1]"`, `"PCP [seed:phase1]"`) | free text | **Confirmed this pass** (corrects `api/CLINICAL-CARDS.md`'s "not confirmed" flag): **not available via API** — `grep -n "note" src/Services/FHIR/FhirCareTeamService.php` has zero hits; nothing in the FHIR mapping reads `care_team_member.note` | not exposed (no standard route for Care Team at all) | **Gap.** The port cannot show per-member notes without either a backend/API change or dropping the column with the gap documented, per the project's DB-10 "consume the existing API only" rule |
| Remove | n/a (edit-mode-only button, no data) | n/a | n/a | n/a | Out of scope — the port is read-only |

## Key question — would members render, and why did the probe only capture the header?

**Answer: yes, both seeded active members would render — but only after
client-side JavaScript runs; the automated probe evidently did not execute
that script (or captured before it ran).** The seeded inactive member
never renders on this card, for a separate, unrelated reason (a SQL-level
filter). Evidence:

1. **The `<tbody>` is server-rendered empty, by design.**
   `manage_care_team.html.twig:203-205`: `<tbody>{# Populated by JS
   #}</tbody>` — no twig loop, no server-side row markup at all. This is
   the single biggest difference from every other primary card
   (Allergies/Medical Problems/Medications/Prescriptions all render their
   rows via twig/Smarty on the server).
2. **Rows are built entirely by inline `<script>` on document-ready.**
   `existingCareTeam` is the PHP `existing_care_team` array JSON-embedded
   into the page (`:23`), and `preloadTeamRows()` (`:31-107`) is called
   unconditionally at `:159` inside `$(function () {...})`. A probe that
   fetches/parses raw HTML (curl, a non-JS HTTP client, or a headless
   fetch that doesn't run scripts) would see exactly what RECON reported:
   the `<thead>` with its 8 column labels, and nothing in `<tbody>`. A
   real browser (or a JS-executing tool like Selenium/Panther) that waits
   for document-ready would see the rows.
3. **Confirmed by running `getCareTeamData()`'s exact SQL read-only
   against pid 13** (`docker exec` `mariadb`, SELECT only, per the audit's
   read-only-SQL rule): the query returns **2 rows** — user 6 (Donna Lee,
   `primary_care_provider`, role_title "Primary Care Provider", facility
   "Great Clinic") and user 5 (Fred Stone, `nurse`, role_title "Nurse",
   same facility) — both formatted correctly, all joins resolve (no NULL
   facility/role breakage), no SQL error. This is exactly the data that
   would end up in `existing_care_team` and therefore in `existingCareTeam`
   client-side, and `preloadTeamRows()` would append 2 `<tr>`s for it.
4. **The seeded inactive member (user 10, `specialist`, status
   `inactive`) is excluded before it ever reaches the template or the
   JSON — not hidden by JS, not collapsed, not a role-lookup failure.**
   `getCareTeamData()`'s member subselect is `WHERE status != 'inactive'
   AND status != 'entered-in-error'` (`CareTeamService.php:564-566`).
   Confirmed by re-running the query without that filter: all 3 seeded
   `care_team_member` rows exist in the table (verified via a direct
   `SELECT ... FROM care_team_member ctm JOIN care_teams ct ON
   ct.id=ctm.care_team_id WHERE ct.pid=13`), but only the 2 active ones
   survive the join used by `getCareTeamData()`. This is a card-specific
   behavior distinct from the FHIR API's `search()`/`getAll()` path, which
   per `api/CLINICAL-CARDS.md` applies **no** default status filter — so a
   port that calls `GET /fhir/CareTeam` naively would show the inactive
   specialist even though the legacy UI card never does, unless it
   reimplements this same exclusion.
5. **Collapse state is not the explanation.** Care Team defaults to
   collapsed (`RECON.md`, confirmed via `CareTeamViewCard::setupOpts()`
   line 85's `getUserSetting()` check), and `card_base.html.twig:16` wraps
   the whole card body in a Bootstrap `.collapse` div without `.show` when
   collapsed — but that only sets CSS `display:none`; the DOM (and any JS
   that ran on document-ready) is unaffected. `preloadTeamRows()` is not
   gated on the collapse toggle, so collapse/expand state does not explain
   the probe's result.

**What can't be determined without a browser:** whether a real
JS-executing load of `demographics.php?set_pid=13` (or a headless
Chromium/Selenium session, per `CLAUDE.md`'s documented debugging path)
actually produces the 2 `<tr>` elements this audit predicts from source +
read-only SQL — this pass did not drive a browser, per its read-only/no-HTTP
scope. The SQL-level reproduction is strong evidence but not a substitute
for observing the rendered DOM.
