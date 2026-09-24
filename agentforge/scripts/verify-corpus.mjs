#!/usr/bin/env node
// Verify every chunk in corpus/guidelines/corpus.json is an exact, contiguous
// verbatim excerpt of the live page at its `url` (S5 review finding: several
// chunks were spliced from non-adjacent sentences or retyped table cells).
//
// This needs network access and is NOT part of the pre-commit hook (the hook
// must stay deterministic and offline). Run it after any corpus edit:
//
//   node agentforge/scripts/verify-corpus.mjs
//
// Exits non-zero if any chunk is not found as a single contiguous substring
// of its source page's extracted text.
import { loadGuidelineCorpus } from '../src/guidelineEvidence.js';

const decode = (value) => value
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&rsquo;|&#8217;|&lsquo;|&#x27;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&ge;/g, '>=')
  .replace(/&le;/g, '<=')
  .replace(/&ndash;/g, '-')
  .replace(/&mdash;/g, '-')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const normalize = (value) => decode(value)
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function fetchPageText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', accept: 'text/html' } });
  const html = await response.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return { status: response.status, text: normalize(text) };
}

const corpus = loadGuidelineCorpus();
const urls = [...new Set(corpus.map((chunk) => chunk.url))];
console.log(`Fetching ${urls.length} unique source URLs for ${corpus.length} chunks...`);

const pages = new Map();
for (const url of urls) {
  try {
    pages.set(url, await fetchPageText(url));
  } catch (error) {
    pages.set(url, { status: `ERROR: ${error.message}`, text: '' });
  }
}

let failures = 0;
for (const chunk of corpus) {
  const page = pages.get(chunk.url);
  const chunkText = normalize(chunk.text);
  const found = page.text.includes(chunkText);
  console.log(`${chunk.source_id} | ${page.status} | ${found ? 'VERBATIM' : 'MISMATCH'}`);
  if (!found) failures += 1;
}

console.log(`\n${corpus.length - failures}/${corpus.length} chunks verified as exact, contiguous excerpts of their live source page.`);
if (failures) {
  console.error(`${failures} chunk(s) failed verification — see MISMATCH lines above.`);
  process.exit(1);
}
