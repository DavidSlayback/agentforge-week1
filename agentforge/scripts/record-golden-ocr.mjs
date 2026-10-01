// Records real pdftoppm + Tesseract output for every golden PDF so the eval gate
// can replay it deterministically (see createRecordedOcrReplay). Run it only
// inside the image built from the repo Dockerfile, the same OCR stack that is
// deployed:
//   docker build -t agentforge-gate .
//   docker run --rm -v "$PWD:/repo" -w /repo agentforge-gate node agentforge/scripts/record-golden-ocr.mjs [--only=id1,id2]
// Re-recording changes the gate's case-set hash, so the gate then requires
// `--update-baseline`, and the diff shows exactly which OCR lines moved.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdfScanFixture, tesseractOcrEngine } from '../src/pdfScanAdapter.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const goldenDir = join(repoRoot, 'agentforge/test/fixtures/golden');
// The 50-case gate's manifest plus the extension suite's (E4 medication lists).
const manifests = await Promise.all(['manifest.json', 'extension-manifest.json'].map(async (name) => JSON.parse(await readFile(join(goldenDir, name), 'utf8'))));
const manifest = { documents: manifests.flatMap((item) => item.documents) };
// `--only=id1,id2` records just those documents, leaving every other recording untouched.
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;

const version = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`${command} is not on PATH; run this inside the agentforge Docker image`);
  return `${result.stdout}${result.stderr}`.split(/\r?\n/).find(Boolean)?.trim() || 'unknown';
};
const toolVersions = { tesseract: version('tesseract', ['--version']), pdftoppm: version('pdftoppm', ['-v']) };

// Record at the OCR options the deployed scan path passes by default
// (captured from extractPdfScanFixture), never the engine's own defaults.
let productionOptions = null;
const firstPdf = manifest.documents.find((item) => item.pdf && item.id === 'lab-a');
await extractPdfScanFixture({ content: await readFile(join(repoRoot, firstPdf.pdf)), documentType: 'lab_pdf', ocrEngine: { name: 'spy', recognize: async (content, options) => { productionOptions = { psm: options.psm }; return tesseractOcrEngine.recognize(content, options); } } });

await mkdir(join(goldenDir, 'ocr'), { recursive: true });
for (const document of manifest.documents.filter((item) => item.pdf && (!only || only.has(item.id)))) {
  const content = await readFile(join(repoRoot, document.pdf));
  const base = { schema_version: 'agentforge-golden-ocr-v1', document_id: document.id, pdf: document.pdf, pdf_sha256: createHash('sha256').update(content).digest('hex'), engine: tesseractOcrEngine.name, tools: toolVersions };
  let recording;
  try {
    const { pageCount, pages } = await tesseractOcrEngine.recognize(content, productionOptions);
    recording = { ...base, page_count: pageCount, pages };
  } catch (error) {
    // Only the error code is kept; stderr from the tools is not recorded.
    recording = { ...base, error: String(error.message).split(':')[0] };
  }
  await writeFile(join(goldenDir, 'ocr', `${document.id}.json`), `${JSON.stringify(recording, null, 1)}\n`);
  console.log(`${document.id}: ${recording.error || `${recording.pages.reduce((total, page) => total + page.lines.length, 0)} lines`}`);
}
