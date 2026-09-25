Audited by: tier 2 (sonnet)
Date: 2026-09-25
Git SHA: 3ccfe1d

# Docker dev stack — `docker/development-easy-light`

Scope per task: the compose file actually used locally (container
`agentforge-week1-openemr-1`) and the image/Dockerfile it runs. A comparison
of the other `docker/*` variants closes the file.

## Services (`docker/development-easy-light/docker-compose.yml`)

### `mysql`
- Image: `mariadb:11.8.8@sha256:be1ef4fe5f14589325c08a41c76334097ce66c86264b75e1d28342c742782a61` — `docker/development-easy-light/docker-compose.yml:4`
- Command: `mariadbd --character-set-server=utf8mb4 --ssl-ca=... --ssl_cert=... --ssl_key=...` — `docker-compose.yml:5`
- Ports: `${WT_MYSQL_PORT:-8320}:3306` — `docker-compose.yml:6-7`
- Volumes — `docker-compose.yml:8-12`:
  - `../library/sql-ssl-certs-keys/easy/ca.pem:/etc/ssl/ca.pem:ro` (bind mount, repo path)
  - `../library/sql-ssl-certs-keys/easy/server-cert.pem:/etc/ssl/server-cert.pem:ro` (bind mount)
  - `../library/sql-ssl-certs-keys/easy/server-key.pem:/etc/ssl/server-key.pem:ro` (bind mount)
  - `databasevolume:/var/lib/mysql` (**named volume**, declared at `docker-compose.yml:116`)
- Env vars (names only): `MYSQL_ROOT_PASSWORD` — `docker-compose.yml:14`. Value is the literal `root` in this dev compose file (not a real secret; a fixed dev-only credential, not redacted here since the task's redaction rule targets real secrets — flagging it anyway since it is a plaintext credential: `docker-compose.yml:14`).
- Healthcheck: `/usr/local/bin/healthcheck.sh --su-mysql --connect --innodb_initialized`, start_period 1m, interval 1m, timeout 5s, retries 3 — `docker-compose.yml:15-26`.

### `openemr`
- Image: `openemr/openemr:flex@sha256:1d2c8345a320cf2985c9d02138951267739ec498559ca724b3d5397e4568482e` — `docker-compose.yml:29`. This is the published "flex" image (fetches/builds OpenEMR source at container-start time rather than at image-build time); the Dockerfile that produces it lives in-repo at `docker/flex/Dockerfile` (see below). The compose file does not `build:` it locally — it pulls the pinned digest.
- Ports: `${WT_HTTP_PORT:-8300}:80`, `${WT_HTTPS_PORT:-9300}:443` — `docker-compose.yml:30-32`.
- Volumes — `docker-compose.yml:33-46`:
  - `${OPENEMR_DIR:-../..}:/openemr:ro` (bind mount, read-only copy of repo root)
  - `${OPENEMR_DIR:-../..}:/var/www/localhost/htdocs/openemr:rw` (bind mount, repo root mounted read-write as the webroot — this is how local edits show up live)
  - `assetvolume:/var/www/localhost/htdocs/openemr/public/assets:rw` (**named volume**)
  - `themevolume:/var/www/localhost/htdocs/openemr/public/themes:rw` (**named volume**)
  - `sitesvolume:/var/www/localhost/htdocs/openemr/sites:rw` (**named volume** — task explicitly calls out `sites/`; confirmed at `docker-compose.yml:38` and declared at `docker-compose.yml:119`)
  - `nodemodules:/var/www/localhost/htdocs/openemr/node_modules:rw` (**named volume**)
  - `vendordir:/var/www/localhost/htdocs/openemr/vendor:rw` (**named volume**)
  - `phpstanvolume:/var/www/localhost/htdocs/openemr/tmp-phpstan:rw` (**named volume**)
  - `webpackcachevolume:/var/www/localhost/htdocs/openemr/.webpack-cache:rw` (**named volume**)
  - `ccdanodemodules:/var/www/localhost/htdocs/openemr/ccdaservice/node_modules:rw` (**named volume**)
  - `ccdanodemodules2:/var/www/localhost/htdocs/openemr/ccdaservice/packages/oe-cqm-service/node_modules:rw` (**named volume**)
  - `logvolume:/var/log` (**named volume**)
  - `couchdbvolume:/couchdb/data` (**named volume** — present even though this "light" variant has no `couchdb` service; likely a leftover/shared default from `development-easy`, unused here since nothing writes to `/couchdb/data` without a couchdb service. Marked as a guess on intent, not on the fact that the mount line exists.)
  - All named volumes are declared under top-level `volumes:` — `docker-compose.yml:115-127`.
- Env vars (names only) — `docker-compose.yml:47-86`:
  `HOST_UID`, `HOST_GID`, `DEBUG_COLORS`, `TERM`, `COLORTERM`, `MYSQL_HOST`, `MYSQL_ROOT_PASS`, `MYSQL_USER`, `MYSQL_PASS`, `OE_USER`, `OE_PASS`, `EASY_DEV_MODE`, `EASY_DEV_MODE_NEW`, `DEVELOPER_TOOLS`, `XDEBUG_ON`, `XDEBUG_PROFILER_ON`, `XDEBUG_CLIENT_HOST`, `GITHUB_COMPOSER_TOKEN`, `GITHUB_COMPOSER_TOKEN_ENCODED`, `GITHUB_COMPOSER_TOKEN_ENCODED_ALTERNATE`, `OPENEMR_DOCKER_ENV_TAG`, `OPENEMR_SETTING_site_addr_oath`, `OPENEMR_SETTING_oauth_password_grant`, `OPENEMR_SETTING_rest_system_scopes_api`, `OPENEMR_SETTING_rest_api`, `OPENEMR_SETTING_rest_fhir_api`, `OPENEMR_SETTING_rest_portal_api`, `OPENEMR_SETTING_portal_onsite_two_enable`, `OPENEMR_SETTING_ccda_alt_service_enable`.
  - `MYSQL_ROOT_PASS`, `MYSQL_PASS`, `OE_PASS` are hardcoded dev-only literal values (`root`/`openemr`/`pass`) in this file, not templated from the environment — `docker-compose.yml:63-67`. Not treated as a "secret" per repo convention (documented dev credentials, e.g. `CLAUDE.md`'s "Login: admin / pass"), but noted per the read-only/no-secrets rule.
  - `GITHUB_COMPOSER_TOKEN*` vars default to empty (`${VAR:-}`) — no committed value — `docker-compose.yml:75-77`.
  - `HOST_UID`/`HOST_GID` purpose is documented inline: let the flex entrypoint adopt the host user's uid for apache so bind-mounted files stay host-owned — `docker-compose.yml:48-58` (also see `CLAUDE.md`'s "Bind-mount permissions / HOST_UID" gotcha).
- `depends_on: mysql: condition: service_healthy` — `docker-compose.yml:87-89`.
- Healthcheck: `curl --fail --insecure --location --show-error --silent https://localhost/meta/health/readyz`, start_period 3m, interval 1m, timeout 5s, retries 3 — `docker-compose.yml:90-104`.

### `phpmyadmin`
- Image: `phpmyadmin:5.2.3@sha256:b16dc88d6e62b186dc4864adac4996fe0238587aa9f5ed507dcfc3894903a3f6` — `docker-compose.yml:107`.
- Ports: `${WT_PMA_PORT:-8310}:80` — `docker-compose.yml:108-109`.
- Env: `PMA_HOSTS: mysql` — `docker-compose.yml:111`.
- `depends_on: mysql: condition: service_healthy` — `docker-compose.yml:112-114`. No volumes, no healthcheck defined for this service.

## Container naming

The task names the running container `agentforge-week1-openemr-1`. Docker
Compose's default container name is `<project>-<service>-<index>`, and no
`container_name:` or `COMPOSE_PROJECT_NAME` override was found anywhere
under `docker/` (`grep -rn COMPOSE_PROJECT_NAME docker/` — no hits). **Guess,
not verified by running Docker (task is read-only, no `docker` invocations
allowed):** the project name `agentforge-week1` is Compose's default
derivation from the primary clone's directory name (`C:\Users\david\repos\
agentforge-week1`), giving `agentforge-week1-openemr-1` for the `openemr`
service. This audit's own working copy is a separate checkout
(`...-w2-dashboard`), so its own container names would differ; the task's
named container refers to the primary checkout.

## Image build: `docker/flex/Dockerfile`

The `openemr/openemr:flex` image pulled by the compose file is built from
`docker/flex/Dockerfile` (this is the source for the published tag, not
something this compose file builds itself):
- Base: `alpine:3.23` (`ARG ALPINE_VERSION=3.23`) — `docker/flex/Dockerfile:29-30`.
- PHP: `ARG PHP_VERSION=8.5` — `docker/flex/Dockerfile:33-35`.
- Installs dev tooling (bash, vim, nano, tree, unzip), Apache2 (+ proxy/ssl/utils modules), certbot, curl, dcron, git, imagemagick, jq, mariadb-client, nodejs/npm, openssl, perl, rsync, shadow, su-exec, tar, build-base, and the full PHP extension set OpenEMR needs (mysqli, pdo_mysql, gd, imagick, openssl, sodium, mbstring, intl, curl, bcmath, opcache/apcu, redis, ldap, soap, xml family, zip, etc.) — `docker/flex/Dockerfile:44-170` (extension list per `PHP_VERSION_ABBR`-suffixed apk packages).
- Sets Apache to listen on `0.0.0.0:80`, sets `apache` uid to 1000 — `docker/flex/Dockerfile` (Apache/user-config sections, ~lines 172-190).
- Installs Composer via the official installer script — same section.
- Entry: `CMD [ "./openemr.sh" ]` for the `base`/`final` build targets — `docker/flex/Dockerfile:297`; a separate `kcov` build target uses `CMD [ "./kcov-wrapper.sh" ]` — `docker/flex/Dockerfile:347`.
- **devtools entrypoint** (`/root/devtools`, referenced in `CLAUDE.md`'s Testing section): copied into the image from the repo at build time —
  `COPY utilities/devtools /root/` and `COPY utilities/devtoolsLibrary.source /root/`, then `RUN chmod 500 /root/devtools` — `docker/flex/Dockerfile:262-263,279`. Source files in-repo: `docker/flex/utilities/devtools` and `docker/flex/utilities/devtoolsLibrary.source`. (Parallel copies of the same pattern exist for the `binary` and `release` image variants: `docker/binary/utilities/devtoolsLibrary.source`, `docker/release/utilities/devtoolsLibrary.source`.) `openemr-cmd`'s subcommands (`ut`, `at`, `et`, `pl`, `shell`, `drid`, etc., per `CLAUDE.md`) shell out to this in-container `/root/devtools` script.
- Container startup logic (env var handling, HOST_UID adoption, DB auto-setup, etc.) lives in `docker/flex/openemr.sh`, documented in its own header comment block (`docker/flex/openemr.sh:1-40`).

## Other `docker/*` variants (one line each)

- `docker/development-easy/` — the full "Easy" dev stack: same `mysql`/`openemr`/`phpmyadmin` services as `development-easy-light` plus `selenium` (Chromium grid for E2E), `couchdb` (with SSL certs mounted and a real `couchdbvolume`), `openldap`, and `mailpit` (SMTP capture), and extra `OPENEMR_SETTING_*` env for couchdb/LDAP/SMTP/Selenium — confirmed via `diff docker/development-easy/docker-compose.yml docker/development-easy-light/docker-compose.yml`.
- `docker/development-easy-light/` — this audit's target; per its own README (`docker/development-easy-light/README.md:1-2`) it is "a special order easy development docker for Tyler. It does not included CouchDB or LDAP" (mailpit/selenium are also absent, per the diff above).
- `docker/development-easy-redis/` — Easy-style stack specialized for session-backed Redis in a sentinel cluster (`docker/development-easy-redis/README.md`).
- `docker/development-insane/` — "loads up about 37 separate dockers" to test many mysql/mariadb/php version combinations; explicitly documented as harder to use than Easy (`docker/development-insane/README.md`).
- `docker/binary/` — production-style image built from static PHP binaries (via `openemr-static-binary-forge`) instead of apk-installed PHP packages (`docker/binary/README.md`); has its own `docker-compose.test.yml`.
- `docker/flex/` — source of the `openemr/openemr:flex` image used by all the "development-easy*" compose files above (runtime source-fetching, dev tooling included); has no compose file of its own, it's consumed by others.
- `docker/dockerhub/` — README/publishing material for the official Docker Hub image, no compose file.
- `docker/library/` — no README content found, no compose file (likely shared library/support files consumed by other Dockerfiles; not independently investigated further — read-only/no-network scope).
- `docker/production/` — production compose file; see root `DOCKER_README.md` per its README pointer.
- `docker/release/` — official release image; documents ~5x startup / ~70% memory optimizations vs previous builds (`docker/release/README.md`).
- `docker/container_benchmarking/` — benchmarking/functional-test utility (`benchmark.sh`, `test_suite.sh`) for comparing container images, not a dev stack itself.

## Notes / redactions

No API keys, tokens, or non-dev secrets were found in `docker/development-easy-light/docker-compose.yml` or `docker/flex/Dockerfile`. The only plaintext credentials present are fixed, publicly-documented development defaults (`root`/`openemr`/`pass`), matching `CLAUDE.md`'s documented dev login (`admin`/`pass`); these are not treated as sensitive per repo convention but are listed above for completeness rather than silently omitted.
