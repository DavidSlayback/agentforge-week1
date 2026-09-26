import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Proves the lint rules that enforce the layer boundaries and the raw-HTML ban
 * actually fire (MIGRATION-REACT.md §2.2, catalog 2.02 / 2.04). Each snippet is
 * linted as if it were an existing file in that layer. (That the real sources
 * are clean is `npm run lint`, the step before the tests in `npm run check`.)
 */
const cwd = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${cwd}/${filePath}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('lint boundaries', () => {
  it('web importing the BFF fails the lint', async () => {
    const ids = await ruleIds('web/src/App.tsx', "import { buildApp } from '../../bff/src/server.ts';\nexport const x = buildApp;\n");
    expect(ids).toContain('no-restricted-imports');
  });

  it('core importing I/O or a framework fails the lint', async () => {
    expect(await ruleIds('core/format.ts', "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n")).toContain('no-restricted-imports');
    expect(await ruleIds('core/format.ts', "import { z } from 'zod';\nexport const s = z.string();\n")).toContain('no-restricted-imports');
  });

  it('raw HTML is banned in the SPA', async () => {
    const danger = "export function X() {\n  return <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />;\n}\n";
    expect(await ruleIds('web/src/App.tsx', danger)).toContain('react/no-danger');
    const inner = "export function y(el: HTMLElement): void {\n  el.innerHTML = '<b>x</b>';\n}\n";
    expect(await ruleIds('web/src/api.ts', inner)).toContain('no-restricted-properties');
  });
});
