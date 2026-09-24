# <unitName> — <Role in a few words>

<Opening paragraph: what this unit is, how the user/system reaches it, and
where control goes afterwards. Written for the person who will rewrite it.>

**Source:** `<path>` · <N> lines · header version/date if present (`Version : x.y.z`, `Modified On : DD/MM/YYYY`)

## Purpose & lifecycle

<Load → events → unload (or request → handler → response). Entry points,
exit points, modal/non-modal, who opens it.>

## Layout / interface

<UI: controls and what each does, with notable properties (MaxLength,
visibility, hardcoded captions/colors). Module: public functions/classes
with signatures. Endpoint: routes, params, payloads.>

## State

```text
<module-level variables / fields, one per line with a comment>
```

**Globals read:** `<name>` (in `<Function>`), ...
**Globals written:** `<name>` (in `<Function>`), ...

## Logic

### `<HandlerOrFunction>`

<Long-form narration of what it does, step by step. Quote SQL/queries when
they matter. Call out quirks inline, e.g. "*Note:* the per-user idle value
is read, then immediately overwritten with `0` — a leftover debug line.">

### `<NextHandler>`

...

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| <open form / save / delete / export> | yes / **missing** | `<UserAccessModule(MOD_X)>` | <load-time only? per operation?> |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|

## Cross-links

- **Opened by:** `<unit>` (`<Function>`)
- **Opens:** `<unit>`
- **Calls into:** `<module>.<Function>`

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug / Security / Smell / Dead code / Half-implemented | Critical / High / Medium / Low | <one sentence> | `<Function>` (`<path>:<line>`) | <one line> |

## Port notes

- **Must survive:** <behaviors the rewrite has to keep, e.g. snapshotting room price at booking time>
- **Must not survive:** <things to design out>
- **Open questions:** <for the user/domain expert>
