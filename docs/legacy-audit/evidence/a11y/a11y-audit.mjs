// Real-browser accessibility pass for the dashboard port (LOCAL stack only, synthetic data).
//
// Drives headless Chromium through the UI only: signs in through the local OpenEMR's OAuth2
// pages, opens each audit patient from the landing page (MRN form or configured demo link),
// then per patient:
//   1. runs axe-core in the rendered page, color-contrast included;
//   2. walks the page with Tab and Shift+Tab, recording the tab order, whether each stop shows a
//      visible focus indicator, and whether the sticky patient header covers the focused element;
//   3. checks reflow at 390 px, at 320 x 568 px, and at 1280 x 720 zoomed to 200 % and 400 %
//      (320 CSS px wide, the WCAG 1.4.10 reference width).
// Finally it signs out with the keyboard.
//
// Usage (from the repo root, with `npm run dev --prefix dashboard` running and the probe kit
// installed under docs/legacy-audit/probe):
//   node docs/legacy-audit/evidence/a11y/a11y-audit.mjs [--out docs/legacy-audit/evidence/a11y]
//
// The OpenEMR login is the documented LOCAL dev login, read at runtime from
// docker/development-easy-light/docker-compose.yml (OE_USER / OE_PASS). It is never printed or
// written. No REST/FHIR call is scripted; every request comes from the page itself. Output holds
// no names, DOBs or clinical values: text is recorded only for interactive controls, and
// patient-specific link labels are the configured neutral demo labels.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const require = createRequire(join(repo, 'docs/legacy-audit/probe/package.json'));
const { chromium } = require('playwright');
const axePath = join(repo, 'dashboard/node_modules/axe-core/axe.min.js');
const axeSource = readFileSync(axePath, 'utf8');
const axeVersion = JSON.parse(readFileSync(join(repo, 'dashboard/node_modules/axe-core/package.json'), 'utf8')).version;

const outArg = process.argv.indexOf('--out');
const outDir = resolve(outArg > 0 ? process.argv[outArg + 1] : here);
mkdirSync(outDir, { recursive: true });

const BASE = 'http://localhost:8790/dashboard';

function localLogin() {
  const yml = readFileSync(join(repo, 'docker/development-easy-light/docker-compose.yml'), 'utf8');
  const pick = (k) => {
    const m = new RegExp(`^\\s*${k}:\\s*(\\S+)\\s*$`, 'm').exec(yml);
    if (!m) throw new Error(`${k} not found in the local compose file`);
    return m[1].replace(/^['"]|['"]$/g, '');
  };
  return { user: pick('OE_USER'), pass: pick('OE_PASS') };
}

/** The audit patients: how each is opened from the landing page. */
const PATIENTS = [
  { key: 'dash-syn-01', note: 'local pid 14, data-rich', open: { kind: 'mrn', mrn: 'DASH-SYN-01' } },
  { key: 'dash-syn-02', note: 'local pid 15, deceased', open: { kind: 'demo', label: 'DASH-SYN-02 (deceased)' } },
  { key: 'pid-3', note: 'local pid 3, empty-state', open: { kind: 'demo', label: 'Local pid 3 (empty-state)' } },
];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function runAxe(page) {
  // Injected through the DevTools protocol, not a <script> tag, so the page's CSP stays in force.
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.evaluate(axeSource);
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const slim = (list) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      }));
    return {
      violations: slim(r.violations),
      incomplete: slim(r.incomplete),
      passes: r.passes.length,
      colorContrastRan: [...r.passes, ...r.violations, ...r.incomplete, ...r.inapplicable].some((x) => x.id === 'color-contrast'),
    };
  }, AXE_TAGS);
}

async function settled(page) {
  await page.waitForSelector('.patient-header dl, .patient-header .state:not(.state-loading)', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-card]').length === 6 && document.querySelectorAll('[data-card][data-state="loading"]').length === 0, null, { timeout: 60000 });
}

/** Describes document.activeElement: where it is, whether focus is visible, whether the sticky header covers it. */
async function describeFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { kind: 'body' };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const ring = cs.boxShadow && cs.boxShadow !== 'none';
    const header = document.querySelector('.patient-header');
    let coveredPx = 0;
    let fullyCovered = false;
    if (header && !header.contains(el) && getComputedStyle(header).position === 'sticky') {
      const h = header.getBoundingClientRect();
      const overlapTop = Math.max(r.top, h.top);
      const overlapBottom = Math.min(r.bottom, h.bottom);
      coveredPx = Math.max(0, overlapBottom - overlapTop);
      fullyCovered = r.height > 0 && coveredPx >= r.height - 0.5;
    }
    const inView = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    const card = el.closest('[data-card]');
    // Patient-specific text never leaves the page: links and buttons are labelled by their own text
    // (fixed UI strings and the configured neutral demo labels), inputs by id, and anything else
    // (e.g. a keyboard-focusable scroll region) by its role or class and its card only.
    let label;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    else if (el.tagName === 'INPUT') label = `input#${el.id}`;
    else label = `${el.getAttribute('role') || el.className || el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? ` "${el.getAttribute('aria-label')}"` : ''}`;
    return {
      kind: 'element',
      tag: el.tagName.toLowerCase(),
      label: label.slice(0, 60),
      card: card ? card.getAttribute('data-card') : null,
      inHeader: Boolean(header && header.contains(el)),
      focusVisibleMatch: el.matches(':focus-visible'),
      indicator: outline ? `outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` : ring ? `box-shadow ${cs.boxShadow}` : 'none',
      visibleIndicator: outline || Boolean(ring),
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
      inViewport: inView,
      coveredByStickyHeaderPx: Math.round(coveredPx),
      fullyCoveredByStickyHeader: fullyCovered,
      scrollY: Math.round(window.scrollY),
    };
  });
}

/** Everything a keyboard user should be able to reach (visible, enabled, tabbable). */
async function interactiveInventory(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const items = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
    const scrollers = [...document.querySelectorAll('.card-body')].filter((e) => e.scrollWidth > e.clientWidth + 1);
    return {
      // Same labelling rule as describeFocus: no patient text leaves the page.
      interactive: items.map((e) => {
        const tag = e.tagName.toLowerCase();
        if (tag === 'a' || tag === 'button') return `${tag}:${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}`;
        if (tag === 'input') return `input:input#${e.id}`;
        return `${tag}:${e.getAttribute('role') || e.className || tag}${e.getAttribute('aria-label') ? ` "${e.getAttribute('aria-label')}"` : ''}`;
      }),
      overflowingScrollers: scrollers.map((e) => ({ card: e.closest('[data-card]')?.getAttribute('data-card'), tabIndex: e.tabIndex, focusableAttr: e.hasAttribute('tabindex') })),
    };
  });
}

async function tabWalk(page, direction, maxStops = 80) {
  // Start from the document itself (scrolled to the top, or the bottom for Shift+Tab) so the first
  // keypress lands on the first (or last) control.
  await page.evaluate((dir) => window.scrollTo(0, dir === 'back' ? document.documentElement.scrollHeight : 0), direction);
  await page.mouse.click(1, 1).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.());
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press(direction === 'back' ? 'Shift+Tab' : 'Tab');
    await page.waitForTimeout(40);
    const f = await describeFocus(page);
    if (f.kind === 'body') break;
    const id = `${f.tag}|${f.label}|${f.card}`;
    if (seen.has(id)) break;
    seen.add(id);
    stops.push(f);
  }
  return stops;
}

async function reflow(page, name, viewport, zoom) {
  // Browser zoom at Z % on a W x H window lays the page out in a (W / Z) x (H / Z) CSS-px viewport,
  // so zoom is emulated by that viewport (media queries, rem and sticky geometry all follow it).
  await page.setViewportSize({ width: Math.round(viewport.width / zoom), height: Math.round(viewport.height / zoom) });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const header = document.querySelector('.patient-header');
    const hr = header ? header.getBoundingClientRect() : null;
    const z = 1;
    const cssViewportW = window.innerWidth;
    const cssViewportH = window.innerHeight;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && !e.closest('.card-body');
      })
      .slice(0, 10)
      .map((e) => `${e.tagName.toLowerCase()}.${e.className}`);
    return {
      cssViewport: `${cssViewportW}x${cssViewportH}`,
      pageHorizontalScroll: de.scrollWidth > de.clientWidth + 1,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      offendersOutsideCardScrollers: offenders,
      cardScrollersOverflowing: [...document.querySelectorAll('.card-body')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.closest('[data-card]')?.getAttribute('data-card')),
      stickyHeaderHeightCss: hr ? Math.round(hr.height / z) : null,
      stickyHeaderShareOfViewport: hr ? Math.round((hr.height / window.innerHeight) * 100) / 100 : null,
      scrollPaddingTop: getComputedStyle(de).scrollPaddingTop,
    };
  });
  const walk = await tabWalk(page, 'forward');
  const back = await tabWalk(page, 'back');
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
  return {
    name,
    viewport,
    zoom,
    ...m,
    tabStops: walk.length,
    tabOrder: walk.map((s) => `${s.tag}:${s.label}`),
    focusObscured: [...walk, ...back].filter((s) => s.fullyCoveredByStickyHeader || (s.coveredByStickyHeaderPx > 0 && !s.inHeader)).map((s) => ({ label: s.label, card: s.card, coveredPx: s.coveredByStickyHeaderPx, full: s.fullyCoveredByStickyHeader })),
    focusOutOfViewport: [...walk, ...back].filter((s) => !s.inViewport).map((s) => s.label),
    noVisibleIndicator: walk.filter((s) => !s.visibleIndicator).map((s) => s.label),
    stickyHeaderPosition: await page.evaluate(() => {
      const h = document.querySelector('.patient-header');
      return h ? getComputedStyle(h).position : null;
    }),
  };
}

async function signIn(page, login) {
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Sign in with OpenEMR' }).click();
  await page.waitForSelector('input[name="username"]', { timeout: 30000 });
  await page.fill('input[name="username"]', login.user);
  await page.fill('input[name="password"]', login.pass);
  await page.click('button[name="user_role"][value="api"]');
  const authorize = page.locator('#authorize-btn');
  await authorize.waitFor({ timeout: 30000 });
  await authorize.click();
  await page.waitForURL(`${BASE}/**`, { timeout: 30000 });
  await page.waitForSelector('#select-heading', { timeout: 30000 });
}

async function openPatient(page, p) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#select-heading');
  if (p.open.kind === 'mrn') {
    // Keyboard only: focus the MRN field with Tab, type, press Enter.
    await page.mouse.click(1, 1);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.id === 'mrn')) break;
    }
    if (!(await page.evaluate(() => document.activeElement?.id === 'mrn'))) throw new Error('MRN field not reachable by Tab');
    await page.keyboard.type(p.open.mrn);
    await page.keyboard.press('Enter');
  } else {
    const link = page.getByRole('link', { name: p.open.label, exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
  }
  await page.waitForURL(/\/dashboard\/patients\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await settled(page);
}

const login = localLogin();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
// The code under test: the checked-out commit, and whether dashboard/ had uncommitted changes.
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const dashboardDirty = execFileSync('git', ['status', '--porcelain', '--', 'dashboard'], { cwd: repo, encoding: 'utf8' }).trim() !== '';
const report = { capturedAt: new Date().toISOString(), gitSha, dashboardDirty, stack: 'local only (http://localhost:8790/dashboard/ against the local OpenEMR)', browser: `chromium ${browser.version()}`, axeCore: axeVersion, axeTags: AXE_TAGS, pages: [] };

// Signed-out landing.
await page.goto(`${BASE}/`);
await page.waitForSelector('#signin-heading');
report.pages.push({ page: 'landing-signed-out', axe: await runAxe(page), tabOrder: (await tabWalk(page, 'forward')).map((s) => s.label) });

await signIn(page, login);
report.pages.push({ page: 'landing-signed-in', axe: await runAxe(page), tabOrder: (await tabWalk(page, 'forward')).map((s) => `${s.tag}:${s.label}`) });

for (const p of PATIENTS) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPatient(page, p);
  const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-card]')].map((c) => [c.getAttribute('data-card'), c.getAttribute('data-state')])));
  const axe = await runAxe(page);
  const inventory = await interactiveInventory(page);
  const forward = await tabWalk(page, 'forward');
  const backward = await tabWalk(page, 'back');
  const reached = new Set(forward.map((s) => `${s.tag}:${s.label}`.slice(0, 44)));
  const unreachable = inventory.interactive.filter((i) => ![...reached].some((r) => r.startsWith(i.slice(0, 20))));
  await page.screenshot({ path: join(outDir, `${p.key}-1280.png`), fullPage: false });
  const reflows = [];
  reflows.push(await reflow(page, `${p.key}-390`, { width: 390, height: 844 }, 1));
  reflows.push(await reflow(page, `${p.key}-320x568`, { width: 320, height: 568 }, 1));
  reflows.push(await reflow(page, `${p.key}-1280x720-zoom200`, { width: 1280, height: 720 }, 2));
  reflows.push(await reflow(page, `${p.key}-1280x720-zoom400`, { width: 1280, height: 720 }, 4));
  await page.setViewportSize({ width: 1280, height: 900 });
  report.pages.push({
    page: p.key,
    note: p.note,
    cardStates: states,
    axe,
    inventory,
    tabOrder: forward.map((s) => ({ tag: s.tag, label: s.label, card: s.card, indicator: s.indicator, visible: s.visibleIndicator, focusVisible: s.focusVisibleMatch, coveredPx: s.coveredByStickyHeaderPx })),
    reverseCoverage: backward.filter((s) => s.coveredByStickyHeaderPx > 0).map((s) => ({ label: s.label, card: s.card, coveredPx: s.coveredByStickyHeaderPx, full: s.fullyCoveredByStickyHeader })),
    forwardCoverage: forward.filter((s) => s.coveredByStickyHeaderPx > 0).map((s) => ({ label: s.label, card: s.card, coveredPx: s.coveredByStickyHeaderPx, full: s.fullyCoveredByStickyHeader })),
    noVisibleIndicator: [...forward].filter((s) => !s.visibleIndicator).map((s) => s.label),
    unreachable,
    signOutReachable: forward.some((s) => s.label === 'Sign out'),
    reflow: reflows,
  });
}

// Sign out with the keyboard: Tab to the button, press Enter.
await page.mouse.click(1, 1);
let activated = false;
let logoutStatus = null;
let logoutOriginHeader = null;
page.on('request', (r) => {
  if (r.method() === 'POST' && new URL(r.url()).pathname === '/dashboard/logout') logoutOriginHeader = r.headers()['origin'] ?? '(absent)';
});
page.on('response', (r) => {
  if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/dashboard/logout') logoutStatus = r.status();
});
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Tab');
  if ((await describeFocus(page)).label === 'Sign out') {
    await page.keyboard.press('Enter');
    activated = true;
    break;
  }
}
// On success the BFF ends its session and bounces through OpenEMR's end-session endpoint back to /dashboard/.
const signedOut = activated ? await page.waitForSelector('#signin-heading', { timeout: 20000 }).then(() => true, () => false) : false;
report.keyboardSignOut = {
  reachedAndActivated: activated,
  logoutPostStatus: logoutStatus,
  logoutPostOriginHeader: logoutOriginHeader,
  signedOutLandingShown: signedOut,
  urlPathAfter: new URL(page.url()).pathname,
};

await browser.close();
const summary = report.pages.map((p) => ({
  page: p.page,
  violations: p.axe.violations.map((v) => `${v.id} (${v.nodes.length})`),
  incomplete: p.axe.incomplete.map((v) => `${v.id} (${v.nodes.length})`),
  colorContrastRan: p.axe.colorContrastRan,
  tabStops: Array.isArray(p.tabOrder) ? p.tabOrder.length : undefined,
  unreachable: p.unreachable,
  noVisibleIndicator: p.noVisibleIndicator,
  forwardCoverage: p.forwardCoverage,
  reverseCoverage: p.reverseCoverage,
  reflow: p.reflow?.map((r) => ({ name: r.name, css: r.cssViewport, hscroll: r.pageHorizontalScroll, header: r.stickyHeaderPosition, headerPx: r.stickyHeaderHeightCss, headerShare: r.stickyHeaderShareOfViewport, obscured: r.focusObscured.length, offView: r.focusOutOfViewport.length, noIndicator: r.noVisibleIndicator.length })),
}));
report.summary = summary;
const outFile = join(outDir, 'axe-results.json');
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary, keyboardSignOut: report.keyboardSignOut }, null, 2));
console.log(`wrote ${outFile}`);
