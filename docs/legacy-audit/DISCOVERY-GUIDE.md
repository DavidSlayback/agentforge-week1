# Discovery Guide — AgentForge (OpenEMR + AgentForge service)

You're about to look at the app the way its users do, before anyone reads the
code. Spend 15–30 minutes. Answer what you can, in this file or in chat. Short
notes are fine. Anything that surprised or annoyed you is worth writing
down.

While you do this, the agent is running the inventory and the existing
build/test/lint checks. It won't change anything.

## How to run it (from the repo README)

**OpenEMR.** From the repo root, in Windows PowerShell with Docker Desktop:

```powershell
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;" + $env:Path
$env:COMPOSE_PROJECT_NAME = "agentforge-week1"
docker compose -f docker/development-easy-light/docker-compose.yml up --detach --wait --wait-timeout 600
```

- OpenEMR: <http://localhost:8300>. Sign in as `admin` / `pass`.
- phpMyAdmin: <http://localhost:8310>.
- Optional demo data: this **wipes the local dev database**, so only run it
  on the isolated local stack:
  `docker exec agentforge-week1-openemr-1 /root/devtools dev-reset-install-demodata`

**AgentForge service** (Node 24, synthetic fixtures, read-only):

```powershell
$env:AGENTFORGE_DEMO_SECRET = "local-synthetic-secret"
$env:AGENTFORGE_SYNTHETIC_CONTEXT = "true"
node agentforge/src/server.js
```

- App: <http://localhost:8787/>. Pick a fixture patient, prepare the
  briefing, and ask a follow-up.
- Ops and evals pages: `/observability` and `/evals`.

Synthetic or demo data only, throughout.

## What to look at

1. **Getting it running.** Did anything fight you? Setup errors, slow
   containers, missing services, confusing steps?
2. **First screen.** What does the OpenEMR login or first screen show?
   Versions, default credentials, banners?
3. **Center of gravity.** In OpenEMR, which screen does everything hang
   off? The patient chart, the calendar, the encounter? Where does a
   clinician keep coming back to?
4. **Getting around.** Menus, tabs, and URLs. What roles or permissions can
   you see (admin versus clinician)?
5. **Main jobs.** Walk through the 2–4 things a clinician does most, for
   example open a patient, review the chart, and document an encounter.
   Then do the same in the AgentForge service: prepare a briefing and ask
   a follow-up. What happens at each step?
6. **Reports and exports.** What can you print, export, or download?
7. **Errors and oddities.** Every error message, blank page, broken link,
   slow page, or behavior that seemed wrong. Say what you were doing when it
   happened. Browser console errors count.
8. **Where AgentForge meets OpenEMR.** Can you reach the AgentForge module
   from inside OpenEMR? What happens when you do?
9. **Missing.** What did you expect either app to do that it doesn't?
10. **For the new requirements.** Where in the app would each new
    requirement live? Which screens would it touch? (Add the requirements
    doc first; see the checkpoint message.)

## Your notes

<Write here, or answer in chat.>
