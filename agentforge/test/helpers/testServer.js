import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const LISTENING = 'AgentForge listening';
const spawned = new Set();
process.once('exit', () => { for (const child of spawned) child.kill(); });

/**
 * Wait until a spawned AgentForge server logs that it is listening and, when
 * `path` is given, until that path answers 2xx.
 *
 * Throws a descriptive error (and kills the child) if the server exits or the
 * deadline passes, so a slow machine fails loudly instead of racing a fixed
 * retry budget.
 */
export async function waitForServer(child, { port, path = null, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  spawned.add(child);
  child.once('exit', () => spawned.delete(child));
  const fail = (reason) => {
    child.kill();
    return new Error(`AgentForge test server on port ${port} ${reason} within ${timeoutMs} ms`);
  };
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { cleanup(); reject(fail(`did not log "${LISTENING}"`)); }, timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(LISTENING)) { cleanup(); resolve(); }
    };
    const onExit = (code) => { cleanup(); reject(fail(`exited with code ${code} before listening`)); };
    // After startup the child must not keep the test process alive (for example
    // when every test in a file is skipped and its after-hook never runs), and it
    // must not outlive the test process.
    const cleanup = () => { clearTimeout(timer); child.stdout.off('data', onData); child.off('exit', onExit); child.stdout.resume(); child.stdout.unref?.(); child.unref(); };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
  if (!path) return child;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return child;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) { lastStatus = error.code || error.message; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw fail(`did not answer ${path} with 2xx (last: ${lastStatus})`);
}

/** Spawn `agentforge/src/server.js` with synthetic test defaults and wait for it (see `waitForServer`). */
export async function startTestServer(port, extraEnv = {}, { path = '/ready', timeoutMs = 15000 } = {}) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', ...extraEnv },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return waitForServer(child, { port, path, timeoutMs });
}
