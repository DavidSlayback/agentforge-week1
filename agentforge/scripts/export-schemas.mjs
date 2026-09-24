/**
 * Export JSON Schema for the W2 document/citation Zod contracts.
 *
 * Writes one JSON Schema file per schema in `src/schemas.js` to
 * `docs/agentforge/schemas/`, using Zod's built-in JSON Schema conversion.
 * This is the documentation artifact the W2 assignment's "Schemas" deliverable
 * points at; `src/schemas.js` (Zod) remains the runtime source of truth.
 *
 * Usage: `node scripts/export-schemas.mjs` (also `npm run export:schemas`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Citation, GuidelineEvidence, IntakeForm, LabResult } from '../src/schemas.js';

const outputDir = fileURLToPath(new URL('../../docs/agentforge/schemas/', import.meta.url));

const SCHEMAS = {
  Citation,
  LabResult,
  IntakeForm,
  GuidelineEvidence,
};

async function main() {
  await mkdir(outputDir, { recursive: true });
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    jsonSchema.title = name;
    const path = new URL(`${name}.json`, `file://${outputDir}`);
    await writeFile(path, `${JSON.stringify(jsonSchema, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${path.pathname.replace(/^\/([A-Za-z]:)/, '$1')}`);
  }
}

await main();
