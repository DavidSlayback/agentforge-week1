# Real-browser accessibility pass (local stack, synthetic data)

Run 2026-09-26 by a coding agent, on the **local** stack only
(`npm run dev --prefix dashboard` at `http://localhost:8790/dashboard/`, against
the local OpenEMR). Never production. Synthetic patients only: DASH-SYN-01
(local pid 14, data-rich), DASH-SYN-02 (pid 15, deceased) and pid 3
(empty-state).

**What this is not.** No person used a screen reader on the port. A human
screen-reader pass (NVDA or JAWS on Windows, VoiceOver on iOS/macOS) is
**still outstanding**. So are Firefox and Safari: only Chromium was run.

| | Before (`2860445`) | After (`66260cd`) |
|---|---|---|
| axe violations, 5 pages (color-contrast included) | 1 rule: `target-size`, 5 nodes (landing, demo links) | **0** |
| axe "incomplete" (needs review) | 0 | 0 |
| Keyboard sign-out | reached (2nd tab stop); **POST answered 403**, still signed in | 303, signed out, back at the sign-in screen |
| Scroll regions (card bodies wider than the screen) | unnamed `div` tab stops (Chrome's own) | named regions, "Prescriptions, scrolls sideways" |
| Sticky bar at 400 % zoom (320 x 180 CSS px) | sticky, 70-86 % of the viewport; focus partly under it | scrolls with the page |
| Scroll padding against the bar's real height, 320 px wide | 144 px padding vs a 155 px bar | measured: 163 px |
| Unreachable controls, missing focus indicator, horizontal page scroll | none | none |

Files:

- [`axe-results.json`](axe-results.json): the after run, recording `gitSha` = `66260cd` and a clean `dashboard/`.
- [`axe-results-before.json`](axe-results-before.json): the same script, with the fixes stashed (code = `2860445`). The script did not yet record the SHA; it was added afterwards and says so.
- [`a11y-audit.mjs`](a11y-audit.mjs): the script. [`regression.txt`](regression.txt): the deliberate-regression proofs.
- `*-1280.png`, `*-390.png`, `*-320x568.png`, `*-1280x720-zoom200.png`, `*-1280x720-zoom400.png`: after-run viewport screenshots.

## Method

`a11y-audit.mjs` drives headless Chromium 141 (Playwright 1.56 from the
[probe kit](../../probe/)). It uses the UI only; no REST or FHIR call is
scripted.

1. **Sign-in.** It opens the signed-out landing page and clicks "Sign in with OpenEMR". On OpenEMR's
   own login page it enters the documented local dev login, which it reads at runtime from
   `docker/development-easy-light/docker-compose.yml`. The login is never printed or written. Then
   it clicks Authorize.
2. **Opening each patient.**
   - DASH-SYN-01 by keyboard: Tab to the MRN field, type the MRN, press Enter.
   - The other two: focus the configured demo link and press Enter.

   It then waits until the header and all six cards have left the loading state.
3. **axe-core 4.13** runs inside the rendered page, with tags `wcag2a`, `wcag2aa`, `wcag21a`,
   `wcag21aa`, `wcag22aa` and `best-practice`. **color-contrast is included**, and the JSON records
   that the rule ran. axe is injected through the DevTools protocol, not a `<script>` tag, so the
   page's CSP (`script-src 'self'`) stays in force.
4. **Keyboard walk.**
   - Tab from the top of the document until focus cycles, then Shift+Tab from the bottom.
   - At each stop it records the control, whether `:focus-visible` matches, the computed focus
     indicator, and how many pixels of the control are under the sticky patient header.
   - It compares the stops with every visible, enabled, tabbable element on the page.
5. **Reflow and zoom.** It repeats the walk at four sizes.
   - 390 x 844 and 320 x 568 (phones).
   - 1280 x 720 at 200 % zoom (640 x 360 CSS px).
   - 1280 x 720 at 400 % zoom (320 x 180 CSS px, the WCAG 1.4.10 reference width).

   Zoom is emulated by the CSS-pixel viewport it produces. At Z % zoom the page lays out in a
   (W / Z) x (H / Z) CSS-px viewport, so media queries, rem sizes and sticky geometry all follow it.
   It is not the browser's zoom control.

   At each size it records horizontal page overflow, overflowing card bodies, the bar's height and
   position, and focus obscured by the bar.
6. **Keyboard sign-out.** It tabs to "Sign out", presses Enter, and records the POST's status and
   `Origin` header, and whether the signed-out landing page appears.

Output holds no names, DOBs or clinical values. Only links and buttons are
labelled by their text. The MRN field is labelled by its id, and any other
focused element by its role and card.

Tab order at 1280 px, the same on all three patients:

1. "Patient Dashboard"
2. "Sign out"
3. Collapse Allergies
4. Collapse Medical Problems
5. Collapse Medications
6. Collapse Prescriptions
7. Collapse Care Team
8. Collapse Vitals

That is the visual order. On a phone, an overflowing card body adds a stop
after its own toggle. On the signed-in landing page the stops are:

1. the title
2. Sign out
3. MRN
4. Open
5. the five demo links

## Findings and fixes

### K-1. Sign-out failed with 403 (blocker; fixed in `f8c5ad7`)

Tabbing to "Sign out" and pressing Enter posted `/dashboard/logout`. Chromium
sent `Origin: null`, and the BFF's Origin check (rightly) answered
`403 {"error":"origin not allowed"}`. The user stayed signed in on a page
showing that JSON. A mouse click fails the same way.

Cause: `Referrer-Policy: no-referrer`, set both as a header and as the SPA's
`<meta name="referrer">`. Under it, the Fetch spec's "serialize a request
origin" gives `null` for a POST.

- **Fix:** `strict-origin` in both places (`REFERRER_POLICY` in
  `dashboard/bff/src/http/security.ts`).
  - A Referer still never carries the path (the patient uuid).
  - The Origin check is unchanged.
  - `same-origin` was rejected. OpenEMR shares the production origin, so it
    would receive the full path.
- **Test:** `test/bff/security.test.ts`. The policy must be one that keeps a
  real Origin on same-origin POSTs and never sends a path, and the meta tag
  must match the header.
- **Observed after:** POST 303 with `Origin: http://localhost:8790`, then the
  signed-out landing page.
- **Production is not verified.** `VERIFICATION.md` records David signing out
  on his phone on `a800e97`, browser not recorded. That fits a browser that
  sends a real Origin here, such as WebKit. Chromium users on `a800e97` likely
  get the 403. Nobody checked this on the public URL; this pass was local only.

### K-2. Scrolling card bodies were unnamed or unreachable (fixed in `66260cd`)

Wide tables scroll inside their card rather than widen the page (slice
01-06-04). When a card body overflows, Chromium makes it a tab stop on its
own, but with no role or name. DASH-SYN-01 has three such bodies at 320 px:
Prescriptions, Care Team and Vitals. At 390 px only Care Team overflows. A
screen-reader user hears an unnamed group.

Safari, by general knowledge, does not make such scrollers focusable at all.
A keyboard user there could not scroll them. This was not tested here.

- **Fix:** `Card.tsx` watches for overflow (ResizeObserver, re-checked on new
  rows). While the body overflows it gets `tabindex="0"`, `role="region"` and
  `aria-label="<card>, scrolls sideways"`. It gets none of these when the
  content fits, so there is no extra tab stop on wide screens. The region's
  focus ring is 2 px, inside the card border.
- **Test:** `test/web/A11y.test.tsx`.
- **Observed after:** the region stops are named in `axe-results.json`, with
  0 axe violations.

### Z-1. At 400 % zoom the sticky bar covered most of the screen (fixed in `66260cd`)

At 320 x 180 CSS px the identity bar is 126-155 px tall, 70-86 % of the
viewport. Before the fix, the collapse toggles were 6 px under it when
focused, and the scroll regions up to 155 px. Almost no page was left to read.

- **Fix:** on viewports 20 rem tall or less, the bar is `position: static`
  and scrolls with the page, as the legacy page does, and no scroll padding is
  reserved. That covers about 400 % zoom on a laptop and tiny landscape
  screens.
  - At 200 % zoom (640 x 360) the bar stays sticky. It is 68 px there, 19 %.
  - Phones in portrait keep it sticky.
- **Test:** `test/web/A11y.test.tsx`, which checks the shipped media rule.
- **Observed after:** `static` at 320 x 180, `sticky` at every other size;
  nothing obscured.

### K-3. The scroll padding was a guess smaller than the bar (fixed in `66260cd`)

`scroll-padding-top` was a fixed 5 rem (9 rem below 48 rem wide). At 320 px
wide, DASH-SYN-01's bar is 155 px against a 144 px padding. A long name would
make it taller still.

The walk did not catch a control actually hidden at 320 x 568. Chrome's
scroll-into-view left room. The fix is defensive: the padding no longer
depends on a guess.

- **Fix:** `PatientHeader.tsx` measures the bar and sets
  `--sticky-header-offset` to its height + 8 px. The CSS values remain the
  fallback without ResizeObserver.
- **Test:** `test/web/A11y.test.tsx`.
- **Observed after:** padding 105 / 134 / 163 px for bars of 97 / 126 /
  155 px.

### A-1. Demo patient links were too small a target (WCAG 2.5.8; fixed in `66260cd`)

axe `target-size` flagged 5 nodes on the signed-in landing page: links 21 px
tall, spaced 18-19 px apart.

- **Fix:** the list gets the class `demo-patients`. Each link is
  `inline-block`, at least 1.5 rem (24 px) tall, with 0.25 rem between items.
- **Test:** `test/web/A11y.test.tsx`.
- **Observed after:** 0 violations.

### Checked and fine (no change)

- **Color contrast:** axe's `color-contrast` ran on all five pages, with 0
  violations and 0 needing review. That covers the muted text, the green and
  red status, the severe-allergy badge, links on the grey bars, and the
  empty-state text. No card was in an error state in these runs. The error
  text uses the same red (`--danger`) that passed here as the Deceased status
  on the darker grey bar, and it sits on white, so it has more contrast still;
  it was not measured in its own state.
- **Focus visible:** every tab stop at every size shows an indicator. It is
  Chrome's default focus ring (`outline: auto`), plus the region ring above.
  The indicator's contrast and area against WCAG 2.4.13 (AAA) was not
  assessed.
- **Reachability:** every interactive element was reached, and Sign out is
  the second stop on every signed-in page.
- **Order:** DOM order is the visual order. The cards are placed by grid
  area and never re-ordered.
- **Reflow:** there is no horizontal page scroll at 390, 320 or 640 px wide.
  Only card bodies scroll, now as named regions.

## Still outstanding (for a human)

- **A screen-reader pass.** Check each of these:
  - landmarks: the banner, main, the "Patient header" region and the six card
    regions;
  - heading levels;
  - how the six card states are announced, including the `role="alert"`
    error, reauth and landing messages (announced on load, which may be
    noisy);
  - the collapse buttons' `aria-expanded`;
  - the new scroll regions.
- **Firefox and Safari keyboard passes.** In particular, confirm K-2's
  region is reachable in Safari with "Press Tab to highlight each item" off.
- **Real browser zoom** (Ctrl +) and text-only zoom. Here zoom was emulated by
  viewport size.
- **Other display settings:** Windows forced colors / High Contrast, and
  200 % text spacing (WCAG 1.4.12).
- **The public URL.** Confirm K-1 on `a800e97` with a Chromium browser, and
  that the fix works there once deployed.
- **OpenEMR's pages.** Its own login and consent pages are out of scope for
  the port and were not audited.

## Rerun

```sh
npm run dev --prefix dashboard     # needs dashboard/.env.local with a local client holding the full OAUTH_SCOPE
node docs/legacy-audit/evidence/a11y/a11y-audit.mjs            # writes axe-results.json + PNGs here
node docs/legacy-audit/evidence/a11y/a11y-audit.mjs --out DIR  # elsewhere
```
