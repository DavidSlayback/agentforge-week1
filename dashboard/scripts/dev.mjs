// Local dev loop (MIGRATION-REACT.md §3): rebuild the SPA into web/dist on
// change and restart the BFF on change; one origin, http://localhost:8790/dashboard/.
// `npm run dev` loads dashboard/.env.local (gitignored) into this process.
import { spawn } from 'node:child_process';

const children = [
  spawn('npx', ['vite', 'build', '--watch', '--config', 'web/vite.config.ts'], { stdio: 'inherit', shell: true }),
  spawn(process.execPath, ['--watch', 'bff/src/server.ts'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
