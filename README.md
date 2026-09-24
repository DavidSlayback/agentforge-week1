[![Syntax Status](https://github.com/openemr/openemr/actions/workflows/syntax.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/syntax.yml)
[![Styling Status](https://github.com/openemr/openemr/actions/workflows/styling.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/styling.yml)
[![Testing Status](https://github.com/openemr/openemr/actions/workflows/test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/test.yml)
[![JS Unit Testing Status](https://github.com/openemr/openemr/actions/workflows/js-test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/js-test.yml)
[![PHPStan](https://github.com/openemr/openemr/actions/workflows/phpstan.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/phpstan.yml)
[![Rector](https://github.com/openemr/openemr/actions/workflows/rector.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/rector.yml)
[![ShellCheck](https://github.com/openemr/openemr/actions/workflows/shellcheck.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/shellcheck.yml)
[![Docker Compose Linting](https://github.com/openemr/openemr/actions/workflows/docker-compose-lint.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/docker-compose-lint.yml)
[![Dockerfile Linting](https://github.com/openemr/openemr/actions/workflows/docker-lint-hadolint.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/docker-lint-hadolint.yml)
[![Isolated Tests](https://github.com/openemr/openemr/actions/workflows/isolated-tests.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/isolated-tests.yml)
[![Inferno Certification Test](https://github.com/openemr/openemr/actions/workflows/inferno-test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/inferno-test.yml)
[![Composer Checks](https://github.com/openemr/openemr/actions/workflows/composer.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/composer.yml)
[![Composer Require Checker](https://github.com/openemr/openemr/actions/workflows/composer-require-checker.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/composer-require-checker.yml)
[![API Docs Freshness Checks](https://github.com/openemr/openemr/actions/workflows/api-docs.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/api-docs.yml)
[![codecov](https://codecov.io/gh/openemr/openemr/graph/badge.svg?token=7Eu3U1Ozdq)](https://codecov.io/gh/openemr/openemr)

[![Backers on Open Collective](https://opencollective.com/openemr/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/openemr/sponsors/badge.svg)](#sponsors)

# OpenEMR

[OpenEMR](https://open-emr.org) is a Free and Open Source electronic health records and medical practice management application. It features fully integrated electronic health records, practice management, scheduling, electronic billing, internationalization, free support, a vibrant community, and a whole lot more. It runs on Windows, Linux, Mac OS X, and many other platforms.

## AgentForge local development setup

This repository is the local OpenEMR substrate for AgentForge work. The repeatable local setup uses the pinned Docker Compose environment under `docker/development-easy-light`.

Prerequisites: Docker Desktop with the Linux container engine enabled and Windows PowerShell.

From the repository root:

```powershell
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;" + $env:Path
$env:COMPOSE_PROJECT_NAME = "agentforge-week1"
docker compose -f docker/development-easy-light/docker-compose.yml up --detach --wait --wait-timeout 600
```

Open [http://localhost:8300](http://localhost:8300) and sign in to the local development instance with `admin` / `pass`. To load the realistic OpenEMR demo dataset, run this destructive reset command only against the isolated local development database:

```powershell
docker exec agentforge-week1-openemr-1 /root/devtools dev-reset-install-demodata
```

The local compose project exposes OpenEMR on ports 8300 (HTTP) and 9300 (HTTPS), phpMyAdmin on 8310, and MariaDB on 8320. These defaults are for local development only.

### AgentForge Week 1 baseline and Week 2 work

Week 1 is the existing patient-scoped chart preparation service. Its OpenEMR
chart adapter is read-only. Week 2 adds a separate, synthetic-only document
workflow; it does not change the Week 1 chart adapter into a write path. The
Week 2 service is configured (`AGENTFORGE_PERSISTENCE_MODE=openemr-module`) to
store uploads, a derived-facts JSON and extracted lab results in OpenEMR through
`oe-module-agentforge`; that live round-trip is unverified until
`agentforge/scripts/w2-openemr-smoke.mjs` passes on the deployed SHA. In the
default mode the upload store is in-memory (`in-memory-synthetic`) and is
**not** OpenEMR persistence.

The current Week 2 parser accepts UTF-8 text fixtures with `LAB|` or `INTAKE|`
records. `lab_pdf` is a schema name: binary PDF parsing, OCR/VLM extraction,
confidence scoring, and scan handling are not implemented. Only the two scoped
types, `lab_pdf` and `intake_form`, are planned; there is no third type.

The Week 2 supervisor calls extraction and evidence-retrieval workers. RAG uses
a deterministic local lexical fallback by default. Optional Cohere Embed and
Rerank requires `AGENTFORGE_RAG_PROVIDER=cohere` and the server-only
`AGENTFORGE_COHERE_API_KEY`. Before any Cohere call, user text is mapped locally
to a small allowlist of fixed synthetic queries; unsupported text is withheld.
No Cohere-backed run is claimed until verified.

For a fixture-backed local run, use Node 24 and start with a server-only
synthetic secret:

```powershell
$env:AGENTFORGE_DEMO_SECRET = "local-synthetic-secret"
$env:AGENTFORGE_SYNTHETIC_CONTEXT = "true"
node agentforge/src/server.js
```

Open `http://localhost:8787/`, choose a fixture patient, prepare the briefing,
then ask a follow-up. Operational and evaluation surfaces are `/observability`
and `/evals` under the app base path; with the default local server these are
`/observability` and `/evals`, while the deployed browser URLs are
`/agentforge/observability` and `/agentforge/evals`. The runnable API collection is
`agentforge/api/collection.ps1`. Run the verification gate with:

```powershell
node --test agentforge/test/*.test.js evals/test/*.test.js observability/test/*.test.js
node --test scripts/test/*.test.mjs
node evals/lib/runner.js
```

Week 1 deployment/provider notes in older submission artifacts refer to older
candidates and are not Week 2 release evidence. See
[`docs/agentforge/W2_EARLY_CHECKPOINT.md`](docs/agentforge/W2_EARLY_CHECKPOINT.md)
for current local evidence and unverified release requirements, and
[`docs/agentforge/W2_ARCHITECTURE.md`](docs/agentforge/W2_ARCHITECTURE.md) for
the Week 2 implementation boundary and Sunday gaps.
See [`docs/agentforge/PROJECT_EXPLAINER.md`](docs/agentforge/PROJECT_EXPLAINER.md),
[`ARCHITECTURE.md`](docs/agentforge/ARCHITECTURE.md), and
[`REQUIREMENTS_MATRIX.md`](docs/agentforge/REQUIREMENTS_MATRIX.md) for the
assignment-grounded implementation and evidence map.

### Contributing

OpenEMR is a leader in healthcare open source software and comprises a large and diverse community of software developers, medical providers and educators with a very healthy mix of both volunteers and professionals. [Join us and learn how to start contributing today!](https://open-emr.org/wiki/index.php/FAQ#How_do_I_begin_to_volunteer_for_the_OpenEMR_project.3F)

> Already comfortable with git? Check out [CONTRIBUTING.md](CONTRIBUTING.md) for quick setup instructions and requirements for contributing to OpenEMR by resolving a bug or adding an awesome feature 😊.

### Support

Community and Professional support can be found [here](https://open-emr.org/wiki/index.php/OpenEMR_Support_Guide).

Extensive documentation and forums can be found on the [OpenEMR website](https://open-emr.org) that can help you to become more familiar about the project 📖.

### Reporting Issues and Bugs

Report these on the [Issue Tracker](https://github.com/openemr/openemr/issues). If you are unsure if it is an issue/bug, then always feel free to use the [Forum](https://community.open-emr.org/) and [Chat](https://www.open-emr.org/chat/) to discuss about the issue 🪲.

### Reporting Security Vulnerabilities

Check out [SECURITY.md](.github/SECURITY.md)

### API

Check out [API_README.md](API_README.md)

### Docker

Check out [DOCKER_README.md](DOCKER_README.md)

### FHIR

Check out [FHIR_README.md](FHIR_README.md)

### For Developers

If using OpenEMR directly from the code repository, then the following commands will build OpenEMR (Node.js version 24.* is required) :

```shell
composer install --no-dev
npm install
npm run build
composer dump-autoload -o
```

### Contributors

This project exists thanks to all the people who have contributed. [[Contribute]](CONTRIBUTING.md).
<a href="https://github.com/openemr/openemr/graphs/contributors"><img src="https://opencollective.com/openemr/contributors.svg?width=890" /></a>


### Sponsors

Thanks to our [ONC Certification Major Sponsors](https://www.open-emr.org/wiki/index.php/OpenEMR_Certification_Stage_III_Meaningful_Use#Major_sponsors)!


### License

[GNU GPL](LICENSE)
