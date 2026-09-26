# E1: click-to-source observed on the public URL

- **Deployed W2 SHA:** `521af470f72d988706a6d934dceab19c0655654f` (`/agentforge-w2/health`, 2026-09-26 ~08:20 CT). Valid for that SHA only; E7 repeats this on the freeze SHA.
- **Flow:** the public UI's "Lab result · Layout A → Run this sample" (synthetic `filled-lab-a.pdf`, seeded `fixture-patient-001`). The upload deduplicated to the existing OpenEMR document (`openemr-doc-21`, the same id as `LEDGER.md` W2-C1). Then "Open source preview".
- **DOM checks on the live preview page:** 12 "View source region" links; 12 `source-box` elements; every link targets an existing box (`linksWithoutBox: []`); the page image loaded at 1700×2200.
- **Click:** "View source region" for `lab.a1c.value`. The URL hash became `#box-lab-a1c-value`, and the `:target` box `box-lab-a1c-value` (`source-box--verified`) rendered with a `4px rgb(194, 46, 46)` border, inside the viewport.
- **Visual:** a red box around "A1C value" on the page image; green boxes on the verified fields; an amber review box on "Hemoglobin abnormal: No". A screenshot was taken in the browser pane (not committed: screenshots are treated as sensitive under the PRD, and this one would add nothing to the DOM facts above).
- **Offline regression cover:** extension cases `x1-click-to-source-lab-a` and `x1-click-to-source-intake-b` (`E0-extension-gate-regression.txt`).
