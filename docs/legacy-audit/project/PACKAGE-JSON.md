# JS Package Manifests — Map

Audited by: tier 2 (sonnet)
Date: 2026-09-25
Git SHA: `3ccfe1d`

This is a MAP, not a critique. No recommendations, no fixes. Scope: every JS
package manifest that is part of the build (root, webpack/gulp configs, the
AgentForge manifests), plus a list of every other `package.json` in the repo
so it's clear what was excluded and why.

All manifests found by `git ls-files '*package.json'` (9 total):

| Path | In this audit's scope? | Why |
|---|---|---|
| `package.json` | Yes | root UI toolkit/theme manifest |
| `agentforge/package.json` | Yes | AgentForge service |
| `evals/package.json` | Yes | AgentForge W2 eval harness |
| `ccdaservice/package.json` | No | separate C-CDA generator Node microservice, not the browser JS build — see §5 |
| `ccdaservice/oe-blue-button-generate/package.json` | No | ccdaservice workspace member |
| `ccdaservice/oe-blue-button-meta/package.json` | No | ccdaservice workspace member |
| `ccdaservice/oe-blue-button-util/package.json` | No | ccdaservice workspace member |
| `ccdaservice/packages/oe-cda-schematron/package.json` | No | ccdaservice workspace member |
| `ccdaservice/packages/oe-cqm-service/package.json` | No | ccdaservice workspace member |
| `interface/modules/custom_modules/oe-module-comlink-telehealth/public/assets/js/package.json` | No | inside `public/` — excluded by task rule; own isolated webpack build — see §5 |

No `webpack.config.js` or `gulpfile*` exists in the repo (`git ls-files` /
`find` both confirm). The one build config present is `webpack.themes.js`,
plus two custom loaders under `webpack/loaders/`.

## 1. Root `package.json`

`package.json:1-125`. Name `openemr-interface`, version `0.2.0`, "UI
toolkit, theme and component library for OpenEMR" (`package.json:3`).

**Scripts** (`package.json:6-21`):

| Script | Does |
|---|---|
| `postinstall` | `napa && node scripts/install-assets.js` — fetches napa (non-npm-registry) sources, then copies `dependencies` (npm + napa) from `node_modules/` into `public/assets/` |
| `build` | `build:webpack:prod` then `build:sync` — full production asset build |
| `build:webpack` | `webpack --config webpack.themes.js` |
| `build:webpack:prod` | `build:webpack -- --mode production` |
| `build:webpack:dev` | `build:webpack -- --mode development` |
| `build:sync` | `node scripts/sync-css.js` — copies static (non-SCSS) CSS from `interface/themes/` to `public/themes/`, autoprefixed |
| `dev` | dev webpack build + sync + `watch` |
| `watch` | `webpack --config webpack.themes.js --mode development --watch` |
| `test` | placeholder — `echo "Error: no test specified" && exit 1` (always fails; not a real test command) |
| `lint:js` | `eslint '**/*.js' --quiet` |
| `lint:js-fix` | `lint:js -- --fix` |
| `test:js` | `jest` |
| `test:js-coverage` | `jest --coverage` |
| `stylelint` | `npx stylelint '**/*.{css,scss}'` |
| `stylelint-fix` | `stylelint -- --fix` |

**Engines:** `node >=24.0.0` (`package.json:29-30`) — no `npm` engine pin.

**Browserslist** (`package.json:31-43`): `> 1%, ie >= 8, edge >= 15, ie_mob
>= 10, ff >= 45, chrome >= 45, safari >= 7, opera >= 23, ios >= 7, android
>= 4, bb >= 10`. Feeds `autoprefixer` through `postcss-loader` in
`webpack.themes.js` (no explicit browserslist config passed to
`postcss-loader` — it reads this field by convention). Still targets IE8 —
see §5.

**Workspaces:** none.

**napa config** (`package.json:112-124`): 8 packages fetched from GitHub
archives / direct zip URLs instead of the npm registry (`napa` is itself a
devDependency, `package.json:55`): `bootstrap-rtl`,
`jquery-creditcardvalidator`, `jquery-panelslider`, `jquery-ui`,
`jquery-ui-themes`, `literallycanvas`, `react` (pinned to the **v15.1.0**
GitHub release zip), `lforms`. These do not appear in `package-lock.json`
(napa is a separate installer, not npm) — so there is no npm-recorded
integrity/version metadata for them, only the URL/tag in `package.json`
itself. `install-assets.js` merges `packages.napa` into the same
`dependencies` copy loop as regular npm deps (`scripts/install-assets.js:77-82`)
so they land in `public/assets/<name>/` the same way.

**Config file:** `.stylelintrc.json` (root) backs the `stylelint`/
`stylelint-fix` scripts; `eslint.config.mjs` (flat config, root) backs
`lint:js`/`lint:js-fix`; `jest.config.js` (root) backs `test:js`/
`test:js-coverage` — it ignores `public/assets`, `vendor`, several vendored
third-party JS directories (jQuery UI 1.11.4 copy, lforms fhir/webcomponent
bundles, zend module JS libs, etc.) and `ccdaservice/node_modules` from
coverage (`jest.config.js:1-25`).

## 2. `webpack.themes.js` (root)

`webpack.themes.js:1-288`. A single exported function
`(env, argv) => [themesConfig]` — one webpack config, name `"themes"`
(`webpack.themes.js:145-149`). Despite the plural filename it currently
returns an array with **one** config object.

- **What it builds:** SCSS themes only (`webpack.themes.js:5-23` docblock)
  — no JS bundling of application code. ~40 SCSS entry points under
  `interface/themes/` (base/compact/RTL/RTL-compact × light/dark/solar/
  manila, 2 color variants, tabs themes, misc CSS) → `public/themes/`
  (`webpack.themes.js:151-218`, `outputThemes` at line 71).
- **Custom Sass importer** `publicAssetsImporter` (`webpack.themes.js:41-65`):
  resolves SCSS `@import "…/public/assets/<pkg>/…"` paths straight to
  `node_modules/<pkg>/…`, so the SCSS build works without the postinstall
  copy step having run (explicitly documented as working "either way",
  `webpack.themes.js:33-36`). Explicitly skips `public/assets/modified/`
  (committed, resolved via a Sass `includePaths` entry instead,
  `webpack.themes.js:38-40, 94-96`).
- **Loader chain** (`sassRule()`, `webpack.themes.js:73-109`, right-to-left
  execution order per webpack convention): `sass-bsimport-loader` (custom,
  runs first) → `sass-loader` → `strip-bom-loader` (custom) →
  `postcss-loader` (autoprefixer only) → `css-loader` (`url: false`) →
  `MiniCssExtractPlugin.loader`.
- **Custom loaders** (`webpack/loaders/`, referenced via `resolveLoader.alias`,
  `webpack.themes.js:239-250`):
  - `sass-bsimport-loader.js` (`webpack/loaders/*.js`, 91 lines shown):
    reads a `?variant=` resource query on the entry path to prepend/append
    RTL, compact, and `// bs4import` → `@import "bootstrap/scss/bootstrap"`
    (or RTL/compact equivalents) substitutions — this is what used to be
    Gulp's per-variant task logic.
  - `strip-bom-loader.js`: strips a UTF-8 BOM from loader input (comment
    cites Font Awesome's Sass output as the source of the BOM).
- **Aliases** (`webpack.themes.js:230-236`): `~bootstrap` and
  `~@fortawesome/fontawesome-free` → their `node_modules/` paths.
- **Filesystem cache** (`sharedCacheConfig()`, `webpack.themes.js:111-124`):
  writes to `.webpack-cache/`, explicitly called out as a Docker BuildKit
  cache-mount target (comment, `webpack.themes.js:20-22`); `buildDependencies`
  includes both custom loader files so cache invalidates on loader changes.
- **Output cleanup plugin** (`webpack.themes.js:255-279`): a bespoke
  `afterEmit` hook deletes the empty `.js`/`.js.map` shim webpack emits per
  CSS-only entry, so `public/themes/` ends up CSS + maps only. `output.clean`
  additionally preserves three pre-existing static CSS files
  (`ajax_calendar_ie.css`, `jquery.autocomplete.css`, `rtl_style_pdf.css`,
  `webpack.themes.js:225-227`) that `build:sync` copies in separately.
- **Devtool:** `eval-source-map` in dev, `false` (none) in production
  (`webpack.themes.js:281`).

Nothing unusual beyond the above — it's a from-scratch replacement for a
former Gulp pipeline (comments throughout say so explicitly), not a stock
webpack scaffold.

**Related non-manifest build scripts** (not manifests themselves, but the
other half of `npm run build`):
- `scripts/install-assets.js` — replaces "the Gulp `install` task
  (previously invoked via `gulp -i`)" (comment, line 10); copies
  `dependencies` + `napa` deps from `node_modules/` → `public/assets/`,
  with symlink-skip and path-traversal guards (`scripts/install-assets.js:29-50`).
- `scripts/sync-css.js` — replaces Gulp's `sync` task; copies static
  (already-authored) CSS from `interface/themes/*.css` to `public/themes/`
  through `postcss([autoprefixer])`.

## 3. `agentforge/package.json`

Full contents (25 lines): name `agentforge-service`, `"private": true`,
`"type": "module"` (native ESM).

**Scripts:**

| Script | Does |
|---|---|
| `test` | `node --test --test-concurrency=1 test/*.test.js` — Node's built-in test runner, no Jest/Mocha; concurrency forced to 1 |
| `start` | `node src/server.js` |
| `eval:gate` | `node scripts/run-w2-gate.mjs` — matches `AGENTS.md`'s `npm run eval:gate --prefix agentforge` |
| `eval:trust-probes` | `node scripts/trust-probes.mjs` |
| `eval:pdf-samples` | `node scripts/benchmark-pdf-samples.mjs` |
| `eval:metrics` | `node scripts/measure-key-metrics.mjs` |
| `export:schemas` | `node scripts/export-schemas.mjs` |

No `engines`, no `browserslist`, no `workspaces`, no devDependencies at all
— zero build tooling; runs directly on Node.

## 4. `evals/package.json`

Full contents (single line, minified): name `agentforge-evals`,
`"private": true`, `"type": "commonjs"`.

**Scripts:**

| Script | Does |
|---|---|
| `test` | `node --test test/*.test.js` |
| `run` | `node lib/runner.js` |
| `run:reference` | same as `run` (alias) |
| `run:service` | `node lib/runner.js --service http://127.0.0.1:8787` |
| `run:error-analysis` | `node lib/error-analysis.js` |

**No `dependencies` or `devDependencies` key at all** — the only manifest
in scope with zero declared npm packages (neither runtime nor dev). No
`package-lock.json` alongside it either (`ls evals/` — none present;
confirms nothing to lock).

## 5. Dependency tables

★ = a library the current PHP dashboard
(`interface/patient_file/summary/demographics.php`) actually loads, either
via its own `Header::setupHeader(['common', 'utility'])` call
(`demographics.php:384`) or via a `config/config.yaml` asset marked
`autoload: true` (loaded on every page regardless of the explicit list —
see §6). "Used for" cites where usage was confirmed by grep; "no usage
found" means a repo-wide grep (`interface/`, `library/`, `src/`,
`templates/`, `config/`) under that package's own name and its known
global/API surface (e.g. `DataTable(`, `ClassicEditor`, `Konva.`) returned
nothing outside `node_modules`/`ccdaservice`/`vendor`/`Documentation`.
"Locked" versions were cross-checked against `package-lock.json`
programmatically; every root/devDependency in this repo is pinned to an
exact version in `package.json` (no `^`/`~`), and every one matches its
lockfile-resolved version exactly — so "Locked" = "Constraint" everywhere
in this repo (no divergence found).

### 5a. Root `package.json` — `dependencies`

| Package | Constraint | Locked | Used for | Status |
|---|---|---|---|---|
| `@eastdesire/jscolor` | 2.5.2 | 2.5.2 | Color picker; config key `jscolor` (`config/config.yaml:169`); called in `interface/forms/eye_mag/*` (color inputs) | unknown |
| `@fortawesome/fontawesome-free` | 6.7.2 | 6.7.2 | Icon font; config key `fontawesome` (`config/config.yaml:133`), aliased in webpack (`webpack.themes.js:232-235`), referenced in 4 files | supported |
| `backbone` | 1.6.1 | 1.6.1 | Config key `backbone` (`config/config.yaml:189`); `Backbone.Model/View/Collection` used in 2 files (found outside dashboard scope) | maintained, low-activity (last major release years old — inference from version number age, not independently verified) |
| ★ `bootstrap` | 4.6.2 | 4.6.2 | Config key `bootstrap`, `autoload: true` (`config/config.yaml:28-39`) — loads on every page incl. the dashboard; used in 125 files | supported (BS4 is a prior major; BS5 is current — not independently confirmed as EOL) |
| `bootswatch` | 4.6.2 | 4.6.2 | **Not** a `config.yaml` asset key. SCSS-only: imported directly in theme SCSS, e.g. `interface/themes/oe-styles/style_solar.scss:38,62` (`@import "…/public/assets/bootswatch/dist/solar/…"`) — reached only through the webpack SCSS build, not `Header::setupAssets` | unknown |
| `chart.js` | 4.5.1 | 4.5.1 | Config key `chart` (`config/config.yaml:261-265`), loaded together with the adapter below; used in 1 file outside `node_modules` | supported |
| `chartjs-adapter-date-fns` | 3.0.0 | 3.0.0 | Same `chart` config key, second script entry (`config/config.yaml:264`); no standalone usage found outside that bundle | supported |
| `ckeditor5` | 47.6.2 | 47.6.2 | Config keys `ckeditor`/`ckeditor-nation-notes`/`ckeditor-limited` (`config/config.yaml:202-211`); `ClassicEditor`/`CKEDITOR.` found in 3 files | supported |
| `datatables.net` | 1.13.11 | 1.13.11 | Config key `datatables` (`config/config.yaml:107-109`); `.DataTable(`/`.dataTable(` found in 25 files | unknown (DataTables 1.x is a prior major line vs. current 2.x; not confirmed EOL) |
| `datatables.net-bs4` | 1.13.11 | 1.13.11 | Config key `datatables-bs` (`config/config.yaml:117-120`) — BS4 styling integration for the table above | unknown |
| `datatables.net-colreorder` | 1.7.2 | 1.7.2 | Config key `datatables-colreorder` (`config/config.yaml:110-113`) | unknown |
| `datatables.net-colreorder-dt` | 1.7.2 | 1.7.2 | Paired styling package for colreorder | unknown |
| `datatables.net-dt` | 1.13.11 | 1.13.11 | Config key `datatables-dt` (`config/config.yaml:114-116`) | unknown |
| `datatables.net-jqui` | 1.13.11 | 1.13.11 | Config key `datatables-jqui` (`config/config.yaml:121-123`) | unknown |
| `datatables.net-scroller` | 2.4.3 | 2.4.3 | Config key `datatables-scroller` (`config/config.yaml:127-129`) | unknown |
| `datatables.net-scroller-jqui` | 2.4.3 | 2.4.3 | Config key `datatables-scroller-jqui-theme` (`config/config.yaml:130-132`) | unknown |
| `dompurify` | 3.4.11 | 3.4.11 | Config key `dompurify` (`config/config.yaml:269-271`); `DOMPurify.sanitize(`/`.isSupported` found in 1 file | supported |
| `dropzone` | 5.9.3 | 5.9.3 | Not confirmed via a `config.yaml` key by that name in the scanned key list; `new Dropzone`/`Dropzone.autoDiscover` found in 2 files | unknown (Dropzone 5.x predates the current 6.x line — not confirmed EOL) |
| `dwv` | 0.27.1 | 0.27.1 | Config key `dwv` (`config/config.yaml:233-241`); DICOM viewer, `templates/dicom/dicom-viewer.html.twig` and `library/js/dwv/`; 18 files reference it | supported |
| `flot` | 4.2.6 | 4.2.6 | Config key not confirmed by name in the scanned list; used by `library/js/dwv/gui/plot.js` and `templates/dicom/dicom-viewer.html.twig` — i.e. bundled as a dwv/DICOM-viewer dependency, not standalone | unknown |
| `hotkeys-js` | 3.13.15 | 3.13.15 | Config key `hotkeys` (`config/config.yaml:245-248`); referenced in 2 files | supported |
| `i18next` | 24.2.3 | 24.2.3 | Config key `i18next` (`config/config.yaml:41-43`); referenced in 9 files | supported |
| `i18next-browser-languagedetector` | 8.2.1 | 8.2.1 | Config key `i18next-browser-languagedetector` (`config/config.yaml:47-49`) | supported |
| `i18next-xhr-backend` | 3.2.2 | 3.2.2 | Config key `i18next-xhr-backend` (`config/config.yaml:44-46`) | **deprecated** — `package-lock.json` records `"deprecated": "replaced by i18next-http-backend"` for this package (e.g. `package-lock.json:6383`) |
| `interactjs` | 1.10.27 | 1.10.27 | **Not** a `config.yaml` key. Lazy-loaded at runtime from `library/js/utility.js:121-125` (`top.webroot_url + '/public/assets/interactjs/dist/interact.js'`) and called at `library/js/utility.js:161-205` for drag/resize | supported |
| ★ `jquery` | 3.7.1 | 3.7.1 | Config key `jquery`, `autoload: true` (`config/config.yaml:24-27`) — loads on every page incl. the dashboard; referenced in 257 files | supported |
| `jquery-datetimepicker` | 2.5.21 | 2.5.21 | Config key `datetime-picker` (`config/config.yaml:136-142`); 120 files reference date/time picker usage | unknown (last release predates current maintenance status; not independently confirmed) |
| `jquery-validation` | 1.22.1 | 1.22.1 | No `config.yaml` key found by that name; no `.validate(` plugin-style call found outside a false-positive match in a vendored Angular bundle (`interface/forms/questionnaire_assessments/lforms/webcomponent/lhc-forms.js`, which is `.validate(` on an unrelated Angular API) | no usage found |
| `jspdf` | 4.2.1 | 4.2.1 | Config key `jspdf` (`config/config.yaml:227-229`); `jsPDF(`/`new jsPDF` found in 3 files (incl. DICOM viewer template) | supported |
| `jszip` | 3.10.1 | 3.10.1 | Config key `jszip` (`config/config.yaml:224-226`); referenced in `templates/dicom/dicom-viewer.html.twig` | supported |
| `knockout` | 3.5.3 | 3.5.3 | Config key `knockout` (`config/config.yaml:77-79`); used by `interface/forms/fee_sheet/*` view-model files (not the dashboard) | supported |
| `konva` | 9.3.22 | 9.3.22 | Config key `konva` (`config/config.yaml:218-220`); **no `Konva.`/`new Konva` usage found** anywhere in `interface/`, `library/`, `src/`, `templates/` (repo-wide check, excluding vendor/doc dirs) | no usage found |
| `magic-wand-js` | 1.0.0 | 1.0.0 | Config key `magic-wand` (`config/config.yaml:221-223`); referenced in `templates/dicom/dicom-viewer.html.twig` | unknown |
| `moment` | 2.30.1 | 2.30.1 | Config key `moment`, `autoload: false` (`config/config.yaml:183-185`); `moment(` found in 15 files. Not part of demographics.php's explicit `['common','utility']` list and not an `autoload: true` key, so **not confirmed as dashboard-loaded** — not starred | Momentjs project itself states it is in maintenance mode / "we now generally consider Moment to be a legacy project" (well-known upstream project statement since 2020; not verified against this repo's copy directly) |
| `numeral` | 2.0.6 | 2.0.6 | Not confirmed via a `config.yaml` key; **no `numeral(` usage found** anywhere in scanned dirs | no usage found |
| `purecss` | 3.0.0 | 3.0.0 | Config key `purecss` (`config/config.yaml:186-188`); `class="pure-…"` found in 2 files | unknown |
| `select2` | 4.1.0 | 4.1.0 | Config key `select2` (`config/config.yaml:163-168`); `.select2(` found in 19 files | supported (actively maintained, but last major release predates jQuery-free alternatives; not confirmed EOL) |
| `sortablejs` | 1.15.7 | 1.15.7 | Config key `sortablejs` (`config/config.yaml:242-244`); global `Sortable` found in 9 files | supported |
| `summernote` | 0.9.1 | 0.9.1 | Config key `summernote` (`config/config.yaml:192-195`); `.summernote(` found in 2 files | unknown |
| `underscore` | 1.13.8 | 1.13.8 | Config key `underscore` (`config/config.yaml:199-201`); `_.` utility calls found in 1 file outside vendored bundles (17 files matched loosely, most were false positives — Courier font metrics file, minified vendor bundles) | supported |
| `utif2` | 4.1.0 | 4.1.0 | **Not** loaded via `Header`/`config.yaml` at all — hardcoded `<script src="…/utif2/UTIF.js">` in `interface/modules/custom_modules/oe-module-faxsms/messageUI.php:43`, `UTIF.decode(`/`UTIF.decodeImage(` called at lines 384-398 | unknown |
| `validate.js` | 0.13.1 | 0.13.1 | No `config.yaml` key found by that name; 2 loose matches on generic `validate(` calls, not confirmed as this library's API | unknown / usage not confirmed |

### 5b. Root `package.json` — `devDependencies`

| Package | Constraint | Locked | Used for | Status |
|---|---|---|---|---|
| `@types/jest` | 29.5.14 | 29.5.14 | TypeScript types for the `jest` test API (no `.ts` test files found; likely IDE/type-checking support only) | supported |
| `autoprefixer` | 10.5.0 | 10.5.0 | `postcss-loader` plugin in `webpack.themes.js:81` (reads root `browserslist`); also used directly by `scripts/sync-css.js:8,22` | supported |
| `css-loader` | 6.11.0 | 6.11.0 | Sass loader chain, `webpack.themes.js:78` | supported |
| `css-minimizer-webpack-plugin` | 8.0.0 | 8.0.0 | Production minification, `webpack.themes.js:253` | supported |
| `eslint` | 9.39.4 | 9.39.4 | `lint:js`/`lint:js-fix` scripts; config `eslint.config.mjs` (flat config) | supported |
| `eslint-plugin-import` | 2.32.0 | 2.32.0 | ESLint plugin (config file not inspected in detail; declared as a devDependency for the lint pipeline) | supported |
| `eslint-plugin-jest` | 28.14.0 | 28.14.0 | ESLint rules for Jest test files | supported |
| `jest` | 29.7.0 | 29.7.0 | `test:js`/`test:js-coverage`; config `jest.config.js` | supported |
| `jest-environment-jsdom` | 30.4.1 | 30.4.1 | DOM environment for Jest (note: major-version-ahead of `jest` 29 — a jsdom-env/jest version skew, not independently confirmed compatible) | supported |
| `mini-css-extract-plugin` | 2.10.2 | 2.10.2 | Sass loader chain + plugin, `webpack.themes.js:26,77,256-259` | supported |
| `napa` | 3.0.0 | 3.0.0 | `postinstall` script (`package.json:7`) — fetches the 8 non-registry packages listed under `napa` in §1 | unknown (niche/low-activity package; not confirmed maintained) |
| `postcss` | 8.5.15 | 8.5.15 | Used directly in `scripts/sync-css.js:8,20`; also the `postcss-loader` engine | supported |
| `postcss-loader` | 7.3.4 | 7.3.4 | Sass loader chain, `webpack.themes.js:27,80` | supported |
| `sass` | 1.101.0 | 1.101.0 | `sass-loader`'s underlying compiler | supported |
| `sass-loader` | 13.3.3 | 13.3.3 | Sass loader chain, `webpack.themes.js:85-103` | supported |
| `stylelint` | 16.26.1 | 16.26.1 | `stylelint`/`stylelint-fix` scripts; config `.stylelintrc.json` | supported |
| `stylelint-config-sass-guidelines` | 12.1.0 | 12.1.0 | Stylelint config extension (referenced from `.stylelintrc.json`, not individually re-verified) | supported |
| `stylelint-config-standard` | 37.0.0 | 37.0.0 | Stylelint config extension | supported |
| `stylelint-order` | 6.0.4 | 6.0.4 | Stylelint plugin (property ordering) | supported |
| `stylelint-scss` | 6.14.0 | 6.14.0 | Stylelint SCSS syntax plugin | supported |
| `webpack` | 5.107.2 | 5.107.2 | The build tool itself; invoked by `build:webpack*`/`watch` | supported |
| `webpack-cli` | 5.1.4 | 5.1.4 | CLI front-end for the `webpack --config webpack.themes.js` commands | supported |

### 5c. `agentforge/package.json` — `dependencies`

| Package | Constraint | Locked | Used for | Status |
|---|---|---|---|---|
| `zod` | 4.6.5 | not independently re-checked against a lockfile (no `agentforge/package-lock.json` found in the listing; the service likely resolves via the repo-root `node_modules` or its own install — not verified here) | Schema validation, imported directly in `agentforge/src/geminiClient.js:5`, `agentforge/src/reranker.js:3`, `agentforge/src/schemas.js:1`, and used in `agentforge/src/w2RegressionGate.js:406,411` | supported |

### 5d. `evals/package.json`

No `dependencies` or `devDependencies` — nothing to table.

## 6. How front-end assets reach the browser

1. `npm install` at repo root runs `postinstall`: `napa` fetches the 8
   non-registry packages into `node_modules/`, then
   `scripts/install-assets.js` copies every package under `dependencies`
   (npm + napa merged, `scripts/install-assets.js:77-90`) from
   `node_modules/<pkg>/` into `public/assets/<pkg>/` (`dist/` subfolder if
   present, else the whole package minus test/doc dirs).
2. `npm run build` (or `build:webpack:prod` + `build:sync`) compiles SCSS
   themes via `webpack.themes.js` → `public/themes/` (webpack) and copies
   static theme CSS via `scripts/sync-css.js` → `public/themes/` (autoprefixed
   copy, not webpack).
3. At request time, a PHP view (e.g.
   `interface/patient_file/summary/demographics.php:384`) calls
   `Header::setupHeader(['common', 'utility'])`. `Header::setupHeader()`
   (`src/Core/Header.php:84-133`) always emits every asset marked
   `autoload: true` in `config/config.yaml` (`Header.php:230`,
   `self::$isHeader = true` from `setupAssets($assets, true, ...)` at
   `Header.php:154,96`) **plus** the explicitly named keys.
4. `Header::includeAsset()` (`Header.php:180-207`) reads
   `config/config.yaml`'s `assets:` map (`Header.php:192`, via
   `readConfigFile()`/`Yaml::parse`), resolves `%placeholder%` tokens
   against `OEGlobalsBag` (`Header.php:349-362`, e.g.
   `%assets_static_relative%` → the `public/assets/` web path), and emits
   `<script src="…">`/`<link rel="stylesheet" href="…">` tags with a
   cache-busting `?v=<v_js_includes>` query string (`Header.php:391-399`).
5. The browser requests those built files from `public/assets/…` (step 1's
   output) and `public/themes/…` (step 2's output) as static files served
   directly — no server-side JS bundling happens per-request.
6. A minority of scripts bypass this whole system with a hardcoded
   `<script src="…">` tag written directly into a PHP view instead of a
   `config.yaml` key — confirmed for `utif2` in
   `interface/modules/custom_modules/oe-module-faxsms/messageUI.php:43`.

For the dashboard specifically: `demographics.php:384` requests `common`
and `utility` explicitly; combined with the `autoload: true` set
(`jquery`, `bootstrap`, `utility` itself, `main-theme`, `compact-theme`,
`textformat`, `dialog` — `config/config.yaml:24-65,143-162`, confirmed via
`awk` scan of every `autoload: true` line), that's the full set of
config.yaml-declared front-end packages the dashboard page loads. No
DataTables/Chart.js/Select2/CKEditor/etc. call sites were found in
`demographics.php` or `dashboard_header.php` (grep for each library's
characteristic API call returned nothing in those two files) — consistent
with `RECON.md`'s description of the dashboard as plain lists/a plain
table, not componentized widgets. `interactjs` is reachable indirectly:
`utility.js` (loaded explicitly by the dashboard) lazy-loads it at runtime
(`library/js/utility.js:121-125`) for drag/resize interactions, but only
if that code path executes.

## 7. Unusual / notable items (facts only)

- **`react` 15.1.0 (napa dependency, `package.json:119`) has no confirmed
  usage.** It's fetched from a GitHub release zip
  (`https://github.com/facebook/react/releases/download/v15.1.0/react-15.1.0.zip`),
  copied into `public/assets/react/` by the postinstall step, but a
  repo-wide grep for `React.createElement`, `React.Component`, or a
  reference to `/public/assets/react/` in any `.php`/`.js`/`.twig` file
  found nothing outside `node_modules`. React 15 itself is several major
  versions behind current React and has been unsupported for years
  (well-known fact, not independently re-verified against a changelog).
- **`i18next-xhr-backend` is marked deprecated in `package-lock.json`**
  ("replaced by i18next-http-backend", e.g. `package-lock.json:6383,8301`)
  and is a direct (not transitive) dependency — used per `config/config.yaml:44-46`.
- **`test` at the repo root is a no-op that always fails**
  (`package.json:15`: `"echo \"Error: no test specified\" && exit 1"`). The
  real JS test command is `test:js` (Jest). Anything that runs `npm test`
  at the repo root (as opposed to `npm run test:js`) will exit non-zero
  regardless of code health.
- **`browserslist` still targets `ie >= 8`** (`package.json:33`) alongside
  modern engines like `edge >= 15`, `chrome >= 45`.
- **8 dependencies are installed outside the npm registry** via `napa`
  (GitHub zip/tarball URLs, `package.json:112-121`) and therefore carry no
  lockfile integrity/version record — `bootstrap-rtl`,
  `jquery-creditcardvalidator`, `jquery-panelslider`, `jquery-ui`,
  `jquery-ui-themes`, `literallycanvas`, `react`, `lforms`.
- **`evals/package.json` has zero declared dependencies** (no
  `dependencies` or `devDependencies` key at all) and no lockfile — the
  smallest/simplest manifest in scope.
- **Two `webpack` installations exist in the repo, independently
  versioned**: root `package.json` pins `webpack: 5.107.2`; the excluded
  telehealth module (`interface/modules/custom_modules/oe-module-comlink-telehealth/public/assets/js/package.json`)
  separately declares `webpack: ^5.105.0` / `webpack-cli: ^5.0.1` (caret
  ranges, unlike the root's exact pins) with its own `build`/`build-dev`/
  `watch:build` scripts and its own (unread) `webpack-dev.config.js` — a
  second, isolated JS build under `public/`, excluded from this audit's
  main scope per the task rule but noted here as found.
- **`ccdaservice/` is a separate Node microservice tree (6 of the 9
  manifests found), not the browser-facing build.** Root
  `ccdaservice/package.json` declares its own `workspaces: ["packages/*"]`
  and a `test` script that runs `npm run test --workspaces`; its
  `node_modules` is a distinct Docker volume mounted into the same
  container (`docker/development-easy-light/docker-compose.yml:43-44`,
  same pattern in the other `docker/development-easy*` compose files) —
  confirms it runs as its own Node process tree alongside PHP, not
  something webpack/jest touches. `jest.config.js:9` explicitly excludes
  `ccdaservice/node_modules` from coverage. One dependency entry is a
  local `"file": "./oe-blue-button-generate"` path reference
  (`ccdaservice/package.json:15`), not a registry package.
- **`jest-environment-jsdom` (30.4.1) is a major version ahead of `jest`
  itself (29.7.0)** (`package.json:52-53`) — a version-skew fact, not
  independently confirmed to cause any actual incompatibility.
- **`agentforge/package.json` and `evals/package.json` both use Node's
  built-in `node --test` runner**, not Jest — a different test framework
  from the root manifest's `jest`. `evals/run:reference` is a byte-for-byte
  alias of `run` (`evals/package.json`: both `"node lib/runner.js"`).
