import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/agentforge');
const allowed = new Set(['AUDIT.md', 'ARCHITECTURE.md', 'USERS.md', 'KEY_METRICS.md', 'LOAD_TEST.md', 'COST_MODEL.md', 'INCIDENT_RESPONSE.md', 'REQUIREMENTS_MATRIX.md', 'DEMO_SCRIPT.md']);
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(root, 'DEMO_EVIDENCE.html')));
  }
  const name = req.url.slice(1);
  if (!allowed.has(name)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<title>${name}</title><style>body{max-width:1000px;margin:40px auto;font:18px/1.6 system-ui;color:#17202a}pre{white-space:pre-wrap;font:inherit}a{color:#174a7e}</style><a href="/">← Demo evidence</a><h1>${name}</h1><pre>${escape(fs.readFileSync(path.join(root,name),'utf8'))}</pre>`);
}).listen(18791, '127.0.0.1', () => console.log('Demo evidence: http://127.0.0.1:18791/'));
