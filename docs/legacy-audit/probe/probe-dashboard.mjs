// Phase 0 probe of the OpenEMR patient dashboard.
//
// Read-only: it logs in, opens dashboards, measures, screenshots, and reads
// text. It never submits forms other than the login, and never changes data.
// Local dev stack and synthetic data only.
//
// Usage:
//   node probe-dashboard.mjs --pid 7 [--empty-pid 12] [--label codex]
//        [--base http://localhost:8300] [--fhir https://localhost:9300]
//        [--user admin] [--pass pass] [--runs 3] [--headed]
//
// Output: results/<label>/summary.json, cards-<pid>.json, and screenshots
// under results/<label>/screens/ (screenshots are git-ignored).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, all) => {
        if (cur.startsWith('--')) {
            const next = all[i + 1];
            acc.push([cur.slice(2), next && !next.startsWith('--') ? next : true]);
        }
        return acc;
    }, []),
);

const base = String(args.base ?? 'http://localhost:8300').replace(/\/$/, '');
const fhir = String(args.fhir ?? 'https://localhost:9300').replace(/\/$/, '');
const label = String(args.label ?? 'probe');
const runs = Number(args.runs ?? 3);
const pids = [args.pid, args['empty-pid']].filter((v) => v && v !== true).map(String);
if (pids.length === 0) {
    console.error('error: --pid <patient id> is required (the setup script prints it)');
    process.exit(2);
}

// The areas the port must match (REQUIREMENTS-TRACE.md DB-02..DB-08).
const IN_SCOPE = [
    { id: 'allergies', re: /allerg/i },
    { id: 'problems', re: /problem/i },
    { id: 'medications', re: /^medications?$/i },
    { id: 'prescriptions', re: /prescription/i },
    { id: 'care_team', re: /care\s*team/i },
    { id: 'notes', re: /note/i },
];

const outDir = path.resolve('results', label);
const screens = path.join(outDir, 'screens');
await mkdir(screens, { recursive: true });

const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ url: page.url(), text: msg.text() });
});
page.on('pageerror', (err) => consoleErrors.push({ url: page.url(), text: String(err) }));
const failedRequests = [];
page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), error: req.failure()?.errorText }));
page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
});

const summary = { label, base, startedAt: new Date().toISOString(), login: {}, patients: {}, fhirMetadata: {}, consoleErrors, failedRequests };

// --- Login -----------------------------------------------------------------
const t0 = Date.now();
await page.goto(`${base}/interface/login/login.php?site=default`, { waitUntil: 'domcontentloaded' });
await page.fill('#authUser', String(args.user ?? 'admin'));
await page.fill('#clearPass', String(args.pass ?? 'pass'));
await Promise.all([page.waitForLoadState('networkidle'), page.click('#login-button')]);
summary.login = { ms: Date.now() - t0, landedOn: page.url() };
await page.screenshot({ path: path.join(screens, 'after-login.png') });
// Anything modal right after login (e.g. the email / registration prompt).
summary.login.dialogs = await page.$$eval('.modal.show, [role="dialog"]', (els) =>
    els.map((e) => (e.innerText || '').trim().slice(0, 500)),
).catch(() => []);

// --- Dashboards --------------------------------------------------------------
for (const pid of pids) {
    const url = `${base}/interface/patient_file/summary/demographics.php?set_pid=${encodeURIComponent(pid)}`;
    const timings = [];
    for (let i = 0; i < runs; i += 1) {
        const start = Date.now();
        await page.goto(url, { waitUntil: 'networkidle' });
        const nav = await page.evaluate(() => {
            const n = performance.getEntriesByType('navigation')[0];
            return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferKB: Math.round((n.transferSize || 0) / 1024) } : null;
        });
        const resources = await page.evaluate(() => performance.getEntriesByType('resource').length);
        timings.push({ wallToNetworkIdleMs: Date.now() - start, ...nav, resources });
    }
    await page.screenshot({ path: path.join(screens, `dashboard-${pid}-full.png`), fullPage: true });

    const cards = await page.$$eval('.card', (els) =>
        els
            .map((el) => {
                const titleEl = el.querySelector('.card-title');
                const title = titleEl ? titleEl.innerText.replace(/\s+/g, ' ').trim() : '';
                const body = el.querySelector('.card-text');
                return {
                    title,
                    collapsed: body ? !body.classList.contains('show') : null,
                    text: (body ? body.innerText : el.innerText).replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000),
                    links: [...el.querySelectorAll('a')].map((a) => (a.innerText || a.title || '').trim()).filter(Boolean).slice(0, 30),
                    tables: [...el.querySelectorAll('table')].map((t) => [...t.querySelectorAll('th')].map((th) => th.innerText.trim())),
                };
            })
            .filter((c) => c.title),
    );
    for (const [i, card] of cards.entries()) {
        const scope = IN_SCOPE.find((s) => s.re.test(card.title));
        card.inScope = scope ? scope.id : null;
        if (scope) {
            const handle = (await page.$$('.card'))[i];
            await handle?.screenshot({ path: path.join(screens, `card-${pid}-${scope.id}.png`) }).catch(() => {});
        }
    }
    // Everything above the first card is treated as the patient header.
    const header = await page.evaluate(() => {
        const firstCard = document.querySelector('.card');
        const all = document.body.innerText;
        const cut = firstCard ? all.indexOf(firstCard.innerText.slice(0, 40)) : -1;
        return (cut > 0 ? all.slice(0, cut) : all.slice(0, 1500)).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
    });
    await writeFile(path.join(outDir, `cards-${pid}.json`), JSON.stringify({ pid, header, cards }, null, 2));
    summary.patients[pid] = {
        url,
        timings,
        cardTitles: cards.map((c) => c.title),
        inScopeFound: [...new Set(cards.map((c) => c.inScope).filter(Boolean))],
        inScopeMissing: IN_SCOPE.map((s) => s.id).filter((id) => !cards.some((c) => c.inScope === id)),
    };
}

// --- FHIR metadata (public capability statement) ------------------------------
try {
    const res = await context.request.get(`${fhir}/apis/default/fhir/metadata`);
    const body = await res.json().catch(() => null);
    summary.fhirMetadata = {
        status: res.status(),
        fhirVersion: body?.fhirVersion ?? null,
        resources: body?.rest?.[0]?.resource?.map((r) => r.type) ?? [],
    };
} catch (err) {
    summary.fhirMetadata = { error: String(err) };
}

summary.finishedAt = new Date().toISOString();
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
await browser.close();

for (const [pid, p] of Object.entries(summary.patients)) {
    const best = Math.min(...p.timings.map((t) => t.wallToNetworkIdleMs));
    console.log(`pid ${pid}: ${p.cardTitles.length} cards; fastest load ${best} ms; in scope found: ${p.inScopeFound.join(', ') || 'none'}; missing: ${p.inScopeMissing.join(', ') || 'none'}`);
}
console.log(`console errors: ${consoleErrors.length}; failed requests: ${failedRequests.length}; FHIR metadata: ${summary.fhirMetadata.status ?? summary.fhirMetadata.error}`);
console.log(`results: ${outDir}`);
