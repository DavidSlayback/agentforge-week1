// Preload (`node --import`) for dockerfile-runtime-dirs.test.js: any read of a
// path under agentforge/test throws and is reported on stderr, so the test can
// prove the running server needs nothing the Docker image no longer copies.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const forbidden = (target) => /[\\/]agentforge[\\/]test([\\/]|$)/.test(target instanceof URL ? target.pathname : String(target));
const guard = (name, original) => function guarded(target, ...rest) {
  if (forbidden(target)) {
    process.stderr.write(`FORBIDDEN_TEST_READ ${name}\n`);
    throw Object.assign(new Error('FORBIDDEN_TEST_READ'), { code: 'FORBIDDEN_TEST_READ' });
  }
  return original.call(this, target, ...rest);
};
for (const name of ['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'openSync', 'readFile', 'createReadStream']) fs[name] = guard(name, fs[name]);
for (const name of ['readFile', 'readdir', 'stat', 'open']) fsp[name] = guard(`promises.${name}`, fsp[name]);
syncBuiltinESMExports();
