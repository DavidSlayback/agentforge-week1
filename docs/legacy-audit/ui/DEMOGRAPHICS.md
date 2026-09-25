# demographics.php — the patient dashboard (index)

`interface/patient_file/summary/demographics.php` is 2,080 lines and the center
of gravity. It's audited in two halves, split at the page ACL gate, so each can
be read in about 10 minutes:

| Part | Lines | Analysis | Audited by | Findings (C/H/M/L) |
|---|---|---|---|---|
| Boot, session, `set_pid`, CDR checks, `<head>` JS, async fragment loader | 1–1055 | [`DEMOGRAPHICS-PART1-BOOT.md`](DEMOGRAPHICS-PART1-BOOT.md) | tier 3 (opus) | 0 / 5 / 7 / 11 |
| Page ACL gate, squad check, every card block, parity spec for the six in-scope cards | 1056–2080 | [`DEMOGRAPHICS-PART2-CARDS.md`](DEMOGRAPHICS-PART2-CARDS.md) | tier 3 (opus) | 0 / 5 / 5 / 10 |

## The page in one paragraph

A logged-in user reaches the page in the tabbed shell's iframe with `?set_pid=N`.
The page switches the session patient (`setpid()`, lines 84–94) **before** any
authorization check, runs the CDR allergy/reminder checks, and writes identity
data and the encounter list into inline JS (lines 916–967). Only then, at line
1056, does it check `patients/demo`. Past the gate, cards render in hard-coded
order. Six are synchronous Twig or Smarty blocks (Allergies, Medical Problems,
Medications, Prescriptions, Care Team, Demographics…). The rest are fetched
asynchronously from fragment endpoints (`stats.php`, `vitals_fragment.php`,
`pnotes_fragment.php`, reminders…). Those endpoints read the **session** patient,
and most run no ACL check of their own.

## Cross-cutting findings

These cut across both halves; the details are in the part files.

- **Authorization happens after the data.** The patient switch, audit row, CDR
  run and identity JS all come before the page gate. Fragment endpoints mostly
  don't re-check. The squad check hides only the header.
- **The session patient is implicit state.** Async fetches don't carry a pid, so
  switching patients in another window mid-load can mix two patients' cards.
- **Some filters look right but don't work:** the Rx `active` filter never
  excludes anything; the Vitals deleted-set filter joins `forms` by id alone.
- **Silent JS failures:** the allergy-conflict alert breaks with 2 or more
  conflicts; `restoreSession` errors outside the shell leave reminder cards
  spinning.
