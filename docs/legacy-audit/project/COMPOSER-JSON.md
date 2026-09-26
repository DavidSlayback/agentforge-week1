# composer.json — Directive and Dependency Map

**Audited by:** tier 2 (sonnet)
**Date:** 2026-09-25
**Source:** `composer.json` @ git HEAD `3ccfe1d` (`git rev-parse --short HEAD`)
**Companion:** `composer.lock` (18,607 lines) read for locked versions and `abandoned` flags. `package.json` is out of scope for this file.

This is a walk of the file's own directives and a map of what each declared
dependency is, at what version, and whether it is confirmed used. No
recommendations, no fixes — Phase 1 produces a map, not a critique.

---

## 1. Directive walk

All line numbers are `composer.json:N` at the audited HEAD.

### `name`, `description`, `license`, `type`, `support` (`composer.json:2-12`)

- `name`: `openemr/openemr`.
- `type`: `project` — this is composer's marker for "the application itself",
  not a reusable library; composer will not try to install this package as a
  dependency of something else.
- `license`: `GPL-3.0-or-later`.
- `support`: five links (issues, forum, wiki, source, website), all pointing
  at the upstream OpenEMR community project, not this fork.

### `require` (`composer.json:13-138`)

- `php: >=8.2.0` (`composer.json:14`) plus 33 `ext-*` entries
  (`composer.json:15-47`) — every PHP extension the app declares it needs
  (bcmath, calendar, ctype, curl, dom, fileinfo, filter, gd, iconv, imagick,
  intl, json, ldap, libxml, mbstring, mysqli, openssl, pdo, pdo_mysql, phar,
  redis, session, simplexml, soap, sockets, sodium, tokenizer, xml,
  xmlreader, xmlwriter, xsl, zip, zlib). These are informational/platform
  requirements, not installable packages — composer checks the running PHP
  has them.
- 89 real packages (`composer.json:48-137`). See §3 for the full table.

### `require-dev` (`composer.json:139-161`)

- 20 packages, all tooling: static analysis (phpstan + 3 phpstan plugins),
  linting/formatting (phpcs, slevomat, rector), a code-coverage engine
  (`phpunit/php-code-coverage`) alongside `phpunit/phpunit` itself, a
  security-advisory blocklist (`roave/security-advisories`, pinned to
  `dev-latest` — see "Unusual" below), a REPL (`psy/psysh`), a browser-test
  driver (`symfony/panther`), commit-message validation
  (`ramsey/conventional-commits`), two independent SQL parsers
  (`iamcal/sql-parser` and `phpmyadmin/sql-parser` — see "Unusual"), a
  composer.json normalizer, a require-checker, a JSON-schema validator, and
  an in-memory Flysystem adapter for tests.

### `repositories` (`composer.json:162-171`)

Two custom VCS repositories:

- `https://github.com/openemr/wkhtmltopdf-openemr` (type `vcs`)
- `https://github.com/openemr/oe-module-cqm` (type `git`)

**Notable:** neither package name appears anywhere in `require` or
`require-dev` (`composer.json:48-160`), and neither shows up as an installed
package in `composer.lock` (checked by grepping both files for
`wkhtmltopdf` and `oe-module-cqm` — the only lock hit is the unrelated
`knplabs/knp-snappy` description text, which mentions "wkhtmltopdf" as the
external binary it wraps, not this repository). These two custom
repositories are declared but nothing currently pulls a package from them.

### `autoload` (`composer.json:172-195`)

- **psr-4**: `OpenEMR\` → `src` (`composer.json:174`). This is the one
  modern namespace root.
- **classmap**: `library/classes` (`composer.json:177`) — legacy class
  files, indexed by class name rather than by PSR-4 path convention.
- **files** (`composer.json:179-188`) — eight legacy procedural files that
  composer's autoloader `require`s **unconditionally on every autoload
  initialization**, i.e. effectively on every PHP request that boots the
  app: `library/global_functions.inc.php`,
  `library/htmlspecialchars.inc.php`, `library/formdata.inc.php`,
  `library/sanitize.inc.php`, `library/formatting.inc.php`,
  `library/date_functions.php`, `library/validation/validate_core.php`,
  `library/translation.inc.php`. This is the "files autoload" pattern
  called out as unusual in the task brief — global function libraries
  loaded eagerly and globally rather than lazily via class autoloading.
- **exclude-from-classmap** (`composer.json:189-194`): four paths are
  explicitly kept out of the classmap scan —
  `src/Common/Compatibility/Checker.php`,
  `library/classes/ClinicalTypes/`, `library/classes/rulesets/`,
  `library/classes/smtp/`. (Facts only: the file does not say why;
  plausible reasons — duplicate/conditionally-defined class names,
  intentionally dead code — are not confirmed here.)

### `autoload-dev` (`composer.json:196-201`)

- psr-4 `OpenEMR\` → `tests` (`composer.json:198`) — **the same top-level
  namespace prefix (`OpenEMR\`) used by the production psr-4 map
  (`composer.json:174`) is reused for the entire `tests/` tree.** Composer
  merges multiple psr-4 directories under one prefix without conflict (this
  is a documented, supported composer feature — files are looked up in
  registration order), but it does mean `OpenEMR\Foo\Bar` could resolve to
  either `src/Foo/Bar.php` or `tests/Foo/Bar.php` depending on which is
  present; only active when dev dependencies are installed.
- psr-4 `OpenEMR\Release\` → `tools/release/src` (`composer.json:199`) — a
  second, more specific dev-only namespace for release tooling.

### `config` (`composer.json:202-247`)

- **`allow-plugins`** (`composer.json:203-209`): five composer plugins
  explicitly allow/deny-listed (composer refuses to run any plugin not
  listed here since Composer 2.2):
  - `dealerdirect/phpcodesniffer-composer-installer`: **false** (disabled)
    — notable because `squizlabs/php_codesniffer` and
    `slevomat/coding-standard` are both present in `require-dev`
    (`composer.json:158-159`) and are the packages this installer normally
    auto-wires phpcs standard paths for; it being off here is a fact worth
    recording, not a judgment.
  - `ergebnis/composer-normalize`: true
  - `openemr/oe-module-installer-plugin`: true — a custom OpenEMR
    plugin/installer type, matching the `"type": "openemr-module"` package
    kind used by `claimrevolution/oe-module-claimrev-connect` (see §3).
  - `php-http/discovery`: **false** (disabled) — `php-http/discovery`
    (`composer.json:99`) is present as a dependency but its own composer
    plugin (which normally auto-installs a discovered PSR-7/17/18 client)
    is turned off.
  - `phpstan/extension-installer`: true
- **`platform`** (`composer.json:210-245`): a full platform override —
  every `ext-*` requirement plus `php` is pinned to the literal string
  `"8.2"` (`composer.json:211-244`), even though `require.php` only demands
  `>=8.2.0` (`composer.json:14`). This tells composer to resolve
  dependencies **as if** the running interpreter were exactly PHP 8.2,
  regardless of what PHP actually runs the resolver — a deliberate
  reproducibility pin, independent of whatever PHP version is on the host
  machine or CI runner.
- **`sort-packages`**: true (`composer.json:246`) — cosmetic; keeps
  `require`/`require-dev` alphabetized.

### `extra` (`composer.json:248-278`)

- `composer-normalize`: `indent-size: 4, indent-style: space`
  (`composer.json:250-251`) — config for the `composer normalize` plugin,
  matches the file's own 4-space formatting.
- `ramsey/conventional-commits` config (`composer.json:253-277`): drives
  `composer.json:294`'s `conventional-commits:check` script. Notable
  values: `bodyRequired: false`, `scopeRequired: false`,
  `requiredFooters: []` (i.e. the `Assisted-by:` trailer described in
  `CLAUDE.md` is **not** enforced by this config — it is convention, not a
  composer-level gate), and an explicit `types` allow-list of 11 conventional
  commit types (`composer.json:264-274`).

### `scripts` (`composer.json:279-313`)

24 named scripts. Grouped by what they do:

- **Composite/aggregate**: `checks` (validate + normalize --dry-run,
  `composer.json:280-283`); `code-quality` (runs `codespell`,
  `php-syntax-check`, `phpcbf`, `phpcs`, `phpstan`, `rector-check`,
  `require-checker` in sequence, `composer.json:284-292`).
- **Single tool wrappers**: `phpcbf`, `phpcs`, `phpstan`
  (`--memory-limit=4G --configuration=phpstan.neon.dist`),
  `rector-check` (`--dry-run`), `rector-fix`, `require-checker`
  (`--config-file=.composer-require-checker.json`),
  `phpunit-isolated` (`-c phpunit-isolated.xml`),
  `conventional-commits:check`.
- **Baseline maintenance** (mutating, matches `CLAUDE.md`'s "Data
  providers"/"Avoid baselines" guidance): `phpstan-baseline` (generates
  `.phpstan/baseline/loader.php`, then runs a project-custom binary
  `vendor/bin/split-phpstan-baseline`, `composer.json:299-302`);
  `phpstan-baseline-reset` (runs a project-custom PHP script
  `.phpstan/reset-baseline.php` first, then re-runs `phpstan-baseline`,
  `composer.json:303-306`).
- **Fixture regeneration** (also mutating, matches `CLAUDE.md`'s Twig and
  layout-field fixture sections): `update-layout-field-fixtures`
  (`UPDATE_FIXTURES=1 phpunit --filter FieldRenderingSnapshotTest`,
  `composer.json:311`); `update-twig-fixtures`
  (`UPDATE_FIXTURES=1 phpunit -c phpunit-isolated.xml --filter
  TwigTemplateRenderTest`, `composer.json:312`).
- **Environment-conditional**: `codespell`
  (`composer.json:293`) — shell-guards on `command -v codespell`, printing
  an install hint and continuing rather than failing hard if the binary is
  absent from the host.
- **Custom PHP tooling invoked via scripts**: `php-syntax-check`
  (`composer.json:295`) is not a composer/vendor binary at all — it's a
  raw shell pipeline: `git ls-files -z '*.php' | xargs -0 php -l ... | awk
  ...`, i.e. `php -l` (syntax-only lint) over every PHP file git tracks,
  with an `awk` filter that fails the script if any line doesn't match
  "No syntax errors detected in ...".

Every alias in `CLAUDE.md`'s "Code Quality" table (`cq`, `pst`, `psg`,
`pgr`, `pr`, `pf`, `rd`, `rp`, `crc`, `cck`, `cps`, `ccc`, `pp`) maps
one-to-one to a script name here, confirming that document's claim that
"the same composer scripts back every PHP code-quality check."

---

## 2. Dependency table

**Locked version** = `composer.lock` (packages/packages-dev sections).
**Used for** = one-line description from `composer.lock`, confirmed against
a `use <Namespace>` (or, where noted, a global-class-reference) grep in
`src/`, `library/`, `interface/`. **Status** states its basis:
`composer.lock`'s `abandoned` field, or "unknown" where the file gives no
signal (this audit did not query Packagist/GitHub — that would need
network access, which is out of scope here).

★ = directly relevant to the dashboard port (OAuth2/OIDC server, FHIR/REST,
Twig, Symfony HTTP stack).

### `require`

| Package | Constraint | Locked | Used for | Status |
|---|---|---|---|---|
| academe/omnipay-authorizenetapi | ^3.1.2 | 3.1.2 | Authorize.Net driver for Omnipay; confirmed via `AuthorizeNetApi_Api` gateway name and `\Omnipay\AuthorizeNetApi\...` in `src/Billing/PaymentGateway.php:145` and `interface/patient_file/front_payment_cc.php:33` | unknown |
| adodb/adodb-php | ^5.22.11 | v5.22.11 | Legacy DB abstraction layer; confirmed via global `ADONewConnection(` call (1 file in library/) | unknown |
| aranyasen/hl7 | ^3.2.2 | 3.2.2 | HL7 message parsing; confirmed, `Aranyasen\HL7` (2 `use` hits) | unknown |
| bacon/bacon-qr-code | ^3.0.3 | v3.1.1 | QR code generation (2FA enrollment); confirmed, `BaconQrCode` (1 file) | unknown |
| claimrevolution/oe-module-claimrev-connect | ^2.1 | v2.1.5 | OpenEMR custom module type (`openemr-module`); no `use <Namespace>` match in src/library/interface (the one text hit found was an unrelated author-email string in a different module, `interface/modules/custom_modules/oe-module-dorn/openemr.bootstrap.php:8`) — the package likely lives as a self-contained `interface/modules/custom_modules/` tree not reached by a namespace `use` | unknown |
| digitickets/lalit | ^3.4.0 | 3.4.2 | XML2Array/Array2XML helper (autoload prefix `LaLit\`, per `composer.lock`); **no usage found** — 0 hits for `LaLit\` in src/library/interface | unknown |
| doctrine/dbal | ^4.4 | 4.4.3 ★ | DB abstraction layer under Doctrine ORM/migrations; confirmed, `Doctrine\DBAL` (15 `use` hits) | unknown |
| doctrine/migrations | ^3.9 | 3.9.7 | Schema migrations; confirmed via `Doctrine\Migrations\` in `db/Migrations/Version00000000000000.php`, `db/migration-template.php.tpl`, `config/database.php`, `cli` (no hits under a plain `use` scan of src/library/interface, since migration classes live under `db/`) | unknown |
| doctrine/orm | ^3.6 | 3.6.7 | ORM; confirmed, `Doctrine\ORM` (6 `use` hits) | unknown |
| dompdf/dompdf | ^3.1.4 | v3.1.5 | HTML→PDF rendering; confirmed, `Dompdf\Dompdf` (1 `use` hit) | unknown |
| ezyang/htmlpurifier | ^4.19.0 | v4.19.0 | HTML sanitization; confirmed, `HTMLPurifier_Config`/`HTMLPurifier` referenced (2 hits) | unknown |
| firehed/container | ^1.1 | 1.1.0 | PSR-11 DI container; description "Dependency inversion container with advanced autowiring" — no distinct `Firehed\` usage isolated in the `use`-statement scan (namespace not present in the top-223 list); not separately confirmed | unknown |
| giggsey/libphonenumber-for-php | ^9.0 | 9.0.32 | Phone number parsing/validation; confirmed, `libphonenumber\PhoneNumberUtil` etc. (5 `use` hits) | unknown |
| google/apiclient | ^2.18.4 | v2.19.3 | Google API client (referenced as `Google_Client` legacy class, 1 hit) | unknown |
| guzzlehttp/guzzle | ^7.10.0 | 7.12.1 ★ | HTTP client; confirmed, `GuzzleHttp\Client`/`Exception`/`HandlerStack` (multiple hits) | unknown |
| guzzlehttp/psr7 | ^2.8 | 2.12.1 ★ | PSR-7 message implementation; confirmed, `GuzzleHttp\Psr7` (5 `use` hits) | unknown |
| html2text/html2text | ^4.3.2 | 4.3.2 | HTML→plaintext; confirmed, `Html2Text\Html2Text` (1 `use` hit) | unknown |
| kamermans/guzzle-oauth2-subscriber | ^1.1.1 | v1.1.1 | OAuth2 client subscriber for Guzzle; confirmed via `kamermans\OAuth2` in `src/Common/Http/oeHttp.php` and `src/Common/Http/oeOAuth.php` (outbound API client auth, not the dashboard's own OAuth2 server) | unknown |
| knplabs/knp-snappy | ^1.5.1 | v1.7.2 | wkhtmltopdf/image wrapper; confirmed, `Knp\Snappy` (1 `use` hit) | unknown |
| laminas/laminas-code | ^4.16 | 4.17.0 | Reflection/code-gen extensions; confirmed, `Laminas\Code` (5 `use` hits) | unknown |
| laminas/laminas-config | ^3.10.1 | 3.11.0 | Config value access; confirmed, `Laminas\Config` (3 `use` hits) | **ABANDONED** — `composer.lock` sets `"abandoned": true` with no suggested replacement (`composer.lock:3023`) |
| laminas/laminas-escaper | ^2.18.0 | 2.18.0 | HTML/attr/JS/CSS/URL escaping; description-level match, no distinct top-223 `use` line isolated separately from other Laminas hits | unknown |
| laminas/laminas-eventmanager | ^3.15.0 | 3.15.0 | Event system; confirmed, `Laminas\EventManager` (2 `use` hits) | unknown |
| laminas/laminas-filter | ^2.42.0 | 2.42.0 | Data/file filtering; grouped under general Laminas usage, not separately isolated | unknown |
| laminas/laminas-form | ^3.24.0 | 3.24.2 | Form validation/rendering; confirmed, `Laminas\Form` (6 `use` hits) | unknown |
| laminas/laminas-inputfilter | ^2.34.0 | 2.35.0 | Input normalization/validation; confirmed, `Laminas\InputFilter` (48 `use` hits — one of the heaviest Laminas namespaces in the codebase) | unknown |
| laminas/laminas-loader | ^2.11.1 | 2.12.0 | Autoloading/plugin-loading strategies | **ABANDONED** — `composer.lock` sets `"abandoned": true`, no replacement given (`composer.lock:3757`) |
| laminas/laminas-mvc | ^3.8.0 | 3.8.0 | Event-driven MVC layer; confirmed, `Laminas\Mvc` (41 `use` hits) | unknown |
| laminas/laminas-mvc-i18n | ^1.9.0 | 1.9.0 | laminas-mvc/laminas-i18n integration; not separately isolated in the scan | unknown |
| laminas/laminas-servicemanager | ^3.24.0 | 3.24.0 | DI/service container; confirmed, `Laminas\ServiceManager` (9 `use` hits) | unknown |
| laminas/laminas-soap | ^2.14.0 | 2.15.0 | SOAP server/client; confirmed, `Laminas\Soap` (1 `use` hit) | unknown |
| laminas/laminas-stdlib | ^3.21.0 | 3.21.0 | Array/SPL utilities shared by other Laminas packages; not separately isolated | unknown |
| laminas/laminas-view | ^2.43.0 | 2.44.0 | View layer/helpers; confirmed, `Laminas\View` (26 `use` hits) | unknown |
| lcobucci/clock | ^2.3 \|\| ^3.0 | 3.3.1 ★ | Clock abstraction, used by lcobucci/jwt; confirmed, `Lcobucci\Clock` (4 `use` hits) | unknown |
| lcobucci/jwt | ^4.3.0 | 4.3.0 ★ | JWT issuing/parsing for OAuth2 tokens; confirmed, `Lcobucci\JWT` (31 `use` hits) | unknown |
| league/csv | ^9.28.0 | 9.28.0 | CSV read/write; confirmed, `League\Csv` (7 `use` hits) | unknown |
| league/flysystem | ^3.33 | 3.34.0 | Filesystem abstraction; confirmed, `League\Flysystem` (5 `use` hits) | unknown |
| league/flysystem-local | ^3.31 | 3.31.0 | Local adapter for Flysystem; grouped with `league/flysystem` usage, not separately isolated | unknown |
| league/oauth2-server | ^8.4 | 8.5.5 ★ | The OAuth2 authorization/resource server library; confirmed, `League\OAuth2` (88 `use` hits — the single heaviest non-OpenEMR/Symfony namespace found). Directly relevant to DB-01 (OAuth2/OIDC login) | unknown |
| league/omnipay | ^3.2.1 | v3.2.1 | Payment processing abstraction; confirmed, `Omnipay\Common` (2 `use` hits) | unknown |
| moneyphp/money | ^4.8 | v4.9.0 | Money value-object pattern; confirmed, `Money\Money` / `Money\` (5 `use` hits) | unknown |
| monolog/monolog | ^3.9.0 | 3.10.0 | PSR-3 logging backend; confirmed, `Monolog\Logger`/`Handler`/`Formatter`/`Level`/`Processor` (multiple hits) | unknown |
| mpdf/mpdf | ^8.2.7 | v8.3.1 | HTML→PDF generation; confirmed, `Mpdf\Mpdf` (11 `use` hits) | unknown |
| nikic/php-parser | ^5.7 | v5.7.0 | PHP parser (used by release tooling / possibly rector); confirmed, `PhpParser\Node`/`ParserFactory`/`NodeFinder` (multiple hits) | unknown |
| nyholm/psr7 | ^1.8.2 | 1.8.2 ★ | PSR-7 implementation; confirmed, `Nyholm\Psr7` (4 `use` hits) | unknown |
| nyholm/psr7-server | ^1.1.0 | 1.1.0 ★ | PSR-7 server-request helpers; confirmed, `Nyholm\Psr7Server` (1 `use` hit) | unknown |
| omnipay/stripe | ^3.2.0 | v3.2.0 | Stripe driver for Omnipay; grouped with `Omnipay\` usage, not separately isolated from `stripe/stripe-php`'s own `Stripe\` usage | unknown |
| openemr/mustache | ^2.15.2 | v2.15.2 | Mustache templating; confirmed, `Mustache_Context` (6 hits) and `Mustache_Engine` (2 hits, global-class refs) | unknown |
| paragonie/constant_time_encoding | ^3.1.3 | v3.1.3 | Constant-time base64/32/16 encoding; confirmed, `ParagonIE\ConstantTime` (1 `use` hit) | unknown |
| particle/validator | ^2.3.6 | v2.3.6 | Validation library; confirmed, `Particle\Validator` (32 `use` hits) | unknown |
| pear/archive_tar | ^1.6.0 | 1.6.0 | Tar file handling; confirmed via global `Archive_Tar` class reference (1 file) | unknown |
| php-http/discovery | ^1.20.0 | 1.20.0 ★ | Finds PSR-7/17/18 implementations at runtime; confirmed, `Http\Discovery` (2 `use` hits). Its own installer plugin is disabled in `config.allow-plugins` (`composer.json:207`) — package itself is still required and used in code | unknown |
| php-http/message | ^1.16 | 1.16.2 | HTTP message helper tools; confirmed, `Http\Message` (2 `use` hits) | unknown |
| php81_bc/strftime | ^0.7.6 | 0.7.6 | `strftime()` polyfill for PHP 8.1+ (native `strftime` was removed); confirmed usage (1 file) | unknown |
| phpmailer/phpmailer | ^6.12.0 | v6.12.0 | Email sending; confirmed, `PHPMailer\PHPMailer` (7 `use` hits) | unknown |
| phpoffice/phpspreadsheet | ^5.3.0 | 5.8.0 | Spreadsheet read/write; confirmed, `PhpOffice\PhpSpreadsheet` (1 `use` hit) | unknown |
| phpseclib/phpseclib | ^3.0.48 | 3.0.55 | Pure-PHP crypto (RSA/AES/SSH2/SFTP/X.509); confirmed, `phpseclib3\Net`/`Crypt` (4 `use` hits) | unknown |
| psr/clock | ^1.0 | 1.0.0 ★ | PSR-20 clock interface; confirmed, `Psr\Clock` (6 `use` hits) | unknown |
| psr/container | ^1.1 | 1.1.2 | PSR-11 container interface; confirmed, `Psr\Container` (1 `use` hit, plus `Interop\Container` legacy alias — 14 hits) | unknown |
| psr/http-client | ^1.0 | 1.0.3 ★ | PSR-18 HTTP client interface; grouped under the 51 `Psr\Http` hits, not separately isolated | unknown |
| psr/http-factory | ^1.1 | 1.1.0 ★ | PSR-17 HTTP factories; grouped under the 51 `Psr\Http` hits | unknown |
| psr/http-message | ^1.1 | 1.1 ★ | PSR-7 HTTP message interfaces; grouped under the 51 `Psr\Http` hits, and confirmed specifically via `Symfony\Bridge\PsrHttpMessage` usage in 7 files under `src/RestControllers/` (e.g. `src/RestControllers/AuthorizationController.php`, `src/RestControllers/SMART/SMARTAuthorizationController.php`) | unknown |
| psr/log | ^3.0.2 | 3.0.2 | PSR-3 logging interface; confirmed, `Psr\Log` (74 `use` hits) | unknown |
| ramsey/uuid | ^4.9.2 | 4.9.3 | UUID generation; confirmed, `Ramsey\Uuid` (19 `use` hits) | unknown |
| ringcentral/ringcentral-php | ^3.0.4 | 3.0.4 | RingCentral platform SDK; confirmed, `RingCentral\SDK` (5 `use` hits) | unknown |
| robthree/twofactorauth | ^3.0.2 | v3.0.3 | TOTP 2FA; confirmed, `RobThree\Auth` (3 `use` hits) | unknown |
| rospdf/pdf-php | ^0.12.67 | 0.12.67 | PDF generation without extra extensions; confirmed via global `Cezpdf` class reference (7 files) | unknown |
| smarty/smarty | ^4.5.6 | v4.5.6 | Legacy Smarty templating; confirmed via `new Smarty(` (1 file — Smarty is a global, non-namespaced class) | unknown |
| steverhoades/oauth2-openid-connect-server | ^3.0.1 | v3.0.1 ★ | OpenID Connect layer on top of league/oauth2-server; confirmed, `OpenIDConnectServer\Repositories`/`Entities`/`ClaimExtractor`/`IdTokenResponse` (11 `use` hits total). Directly relevant to DB-01 | unknown |
| stripe/stripe-php | ^16.6.0 | v16.6.0 | Stripe API client; confirmed, `Stripe\Terminal`/`Stripe`/`PaymentIntent` (3 `use` hits) | unknown |
| symfony/cache | ^7.3 | v7.4.13 ★ | PSR-6/16 cache implementations; confirmed, `Symfony\Component\Cache` (present among the 24 files matching the combined Symfony-component scan) | unknown |
| symfony/config | ^7.3 | v7.4.10 ★ | Config loading/validation; confirmed, `Symfony\Component\Config` (same combined scan; e.g. `src/Core/Kernel.php`) | unknown |
| symfony/console | ^7.3 | v7.4.13 ★ | CLI command framework; not isolated to a single grep line in this pass, but `composer.json` has no `bin`/console entry of its own (see §4) — likely consumed via `src/Common/Command/*` (seen adjacent to other Symfony-component hits, e.g. `src/Common/Command/SymfonyCommandRunner.php`) | unknown |
| symfony/dependency-injection | ^7.3 | v7.4.13 ★ | DI container; confirmed, `Symfony\Component\DependencyInjection` (combined scan) | unknown |
| symfony/event-dispatcher | ^7.3 | v7.4.9 ★ | Event dispatch; confirmed, `Symfony\Component\EventDispatcher` in `src/RestControllers/Subscriber/*Listener.php` (8 files) and `src/Services/*` | unknown |
| symfony/event-dispatcher-contracts | ^3.6 | v3.7.0 | EventDispatcher interfaces; confirmed, `Symfony\Contracts` (78 `use` hits, includes other Symfony contracts too) | unknown |
| symfony/filesystem | ^7.3 | v7.4.11 | Filesystem utilities; confirmed, `Symfony\Component\Filesystem` (combined scan) | unknown |
| symfony/finder | ^7.3 | v7.4.8 | File/dir finding; confirmed, `Symfony\Component\Finder` (combined scan) | unknown |
| symfony/http-client | ^7.3 | v7.4.13 ★ | HTTP client; confirmed, `Symfony\Component\HttpClient` in `tools/release/bin/create-tag.php`, `tools/release/bin/dispatch.php`, and `src/RestControllers/AuthorizationController.php` | unknown |
| symfony/http-foundation | ^7.3 | v7.4.13 ★ | Request/Response object model; confirmed, `Symfony\Component\HttpFoundation` (widely used, e.g. `src/RestControllers/Subscriber/*`) | unknown |
| symfony/http-kernel | ^7.3 | v7.4.13 ★ | Request→Response processing kernel; confirmed, `Symfony\Component\HttpKernel` (combined scan, e.g. `src/Core/Kernel.php`) | unknown |
| symfony/process | ^7.3 | v7.4.13 | Sub-process execution; confirmed, `Symfony\Component\Process` (combined scan) | unknown |
| symfony/psr-http-message-bridge | ^7.3 | v7.4.8 ★ | Bridges Symfony HttpFoundation and PSR-7 messages; confirmed, `Symfony\Bridge\PsrHttpMessage` in 7 `src/RestControllers/*` files | unknown |
| symfony/routing | ^7.3 | v7.4.13 ★ | HTTP request routing; confirmed, `Symfony\Component\Routing` in `src/Core/Routing/ZendModuleApplication.php` and `ZendModuleRouteLoader.php` | unknown |
| symfony/yaml | ^7.3 | v7.4.13 | YAML parsing/dumping; confirmed, `Symfony\Component\Yaml` (combined scan) | unknown |
| twig/twig | ^3.22.2 | v3.27.1 ★ | Modern templating engine; confirmed, `Twig\Environment`/`Extension`/`Error`/`Loader`/`TwigFunction`/`TwigFilter`/`TwigTest` (39 combined `use` hits) | unknown |
| twilio/sdk | ^8.10.0 | 8.11.6 | Twilio SMS/voice API client; confirmed, `Twilio\Rest`/`SignalWire\Rest` (2 `use` hits) | unknown |
| vlucas/phpdotenv | ^5.6.3 | v5.6.3 | `.env` loading; confirmed, `Dotenv\Dotenv` (1 `use` hit) | unknown |
| yubico/u2flib-server | ^1.0.2 | 1.0.2 | U2F hardware-key auth | **ABANDONED** — `composer.lock` sets `"abandoned": true`, no replacement given (`composer.lock:13255`); confirmed used via `u2flib_server`/`Yubico` references (3 files) |
| zircote/swagger-php | ^6.0 | 6.2.0 ★ | Generates OpenAPI/Swagger docs from PHP attributes; confirmed heavily, `OpenApi\Attributes` (61 `use` hits) plus `Processors`/`Analysers`/`SourceFinder`/`Generator` (6 more). Directly relevant to the REST/FHIR API surface the dashboard port consumes | unknown |

### `require-dev`

| Package | Constraint | Locked | Used for | Status |
|---|---|---|---|---|
| ergebnis/composer-normalize | ^2.48 | 2.52.0 | Backs the `composer normalize` command used by `checks`/`code-quality` scripts (`composer.json:282`); not a `use`-statement dependency, invoked via its composer-plugin hook | unknown |
| iamcal/sql-parser | ^0.7.0 | v0.7 | MySQL schema parser; **no usage found** in src/library/interface (0 hits for `iamcal\SQLParser`) — two independent SQL parsers are present, see phpmyadmin/sql-parser below | unknown |
| justinrainbow/json-schema | ^6.8 | 6.10.0 | JSON Schema validation; **no usage in src/library/interface**, but confirmed in `tests/Tests/Isolated/Release/Contracts/DispatchSchemaTest.php` (`JsonSchema\`) — a dev/test-only consumer, consistent with it being a dev dependency | unknown |
| league/flysystem-memory | ^3.31 | 3.31.0 | In-memory Flysystem adapter for tests; **no usage in src/library/interface**, confirmed in `tests/Tests/Isolated/Billing/BillingLoggerTest.php` and `tests/Tests/Isolated/Services/Storage/ManagerTest.php` | unknown |
| maglnet/composer-require-checker | ^4.0 | 4.17.0 | Backs the `require-checker` script (`composer.json:310`, `.composer-require-checker.json` config); CLI tool, not a `use`-statement dependency | unknown |
| phpmyadmin/sql-parser | ^6.0 | 6.0.0 | Validating SQL lexer/parser (MySQL dialect); **no usage found** in src/library/interface (0 hits for `PhpMyAdmin\SqlParser`) — coexists with `iamcal/sql-parser`, also unconfirmed; two SQL-parser dependencies with no confirmed call site in the scanned trees is worth flagging as a fact (not a recommendation) | unknown |
| phpstan/extension-installer | ^1.4 | 1.4.3 | Auto-registers other PHPStan extensions listed below via composer plugin; not a `use`-statement dependency | unknown |
| phpstan/phpstan | ^2.1 | 2.1.56 | Static analysis engine; backs `phpstan`/`phpstan-baseline*` scripts (`composer.json:298,299-306`) | unknown |
| phpstan/phpstan-deprecation-rules | ^2.0 | 2.0.4 | PHPStan rule pack for deprecated-symbol usage | unknown |
| phpstan/phpstan-phpunit | ^2.0 | 2.0.16 | PHPStan rule pack for PHPUnit-specific patterns | unknown |
| phpstan/phpstan-strict-rules | ^2.0 | 2.0.11 | Extra strict PHPStan rule pack | unknown |
| phpunit/php-code-coverage | ^11.0 | 11.0.12 | Code coverage engine used by phpunit; confirmed, `SebastianBergmann\CodeCoverage` (4 `use` hits) | unknown |
| phpunit/phpunit | ^11.0 | 11.5.55 | Test runner; confirmed, `PHPUnit\Framework` (4 `use` hits, plus the whole `tests/` tree) | unknown |
| psy/psysh | ^0.12.23 | v0.12.23 | Interactive PHP REPL; confirmed, `Psy\Shell` (1 `use` hit) | unknown |
| ramsey/conventional-commits | ^1.5 | 1.7.0 | Backs the `conventional-commits:check` script (`composer.json:294`, `vendor/bin/conventional-commits validate`) and the `extra.ramsey/conventional-commits` config block (`composer.json:253-277`) | unknown |
| rector/rector | ^2.1 | 2.4.4 | Automated PHP refactoring/upgrades; backs `rector-check`/`rector-fix` scripts (`composer.json:308-309`); CLI tool | unknown |
| roave/security-advisories | dev-latest | dev-latest | A metapackage with no code — its only purpose is a `conflict` map of known-vulnerable versions of other packages, so `composer install`/`update` refuses them | n/a — this package has no releases by design; see "Unusual" below for the `dev-latest` constraint itself |
| shipmonk/phpstan-baseline-per-identifier | ^2.3 | 2.3.0 | Splits a PHPStan baseline into one file per error identifier; backs `phpstan-baseline` script's `split-phpstan-baseline` step (`composer.json:301`) | unknown |
| slevomat/coding-standard | ^8.28 | 8.29.0 | Extra PHP_CodeSniffer sniffs; paired with `squizlabs/php_codesniffer` below, its installer plugin is disabled (`composer.json:204`) | unknown |
| squizlabs/php_codesniffer | ^4.0 | 4.0.1 | PSR-12/PER-CS style checker; backs `phpcs`/`phpcbf` scripts (`composer.json:296-297`) | unknown |
| symfony/panther | ^2.0 | v2.4.0 | Browser-automation test client (WebDriver/Selenium wrapper); this is the package `CLAUDE.md`'s "Browser debugging via Selenium" section names directly (`Client::createSeleniumClient`) | unknown |

---

## 3. Entry points

`composer.json` itself declares **no `bin` key** — no CLI executables of its
own are exposed via `composer.json:bin`. Entry points that do exist, as
declared or implied by this file:

- **`scripts`** (`composer.json:279-313`): 24 named entry points, runnable
  as `composer <script-name>`. These are the canonical entry points a
  developer or CI/git-hook invokes (`CLAUDE.md`'s whole "Code Quality"
  section maps to these 1:1). See §1 for the full breakdown.
- **`symfony/console`** (`composer.json:120`) is present as a library
  dependency, implying a console-command framework is wired somewhere in
  `src/` (e.g. `src/Common/Command/*` classes observed during the usage
  grep — `CreateAPIDocumentationCommand.php`, `RootCliGuard.php`,
  `SymfonyCommandRunner.php`, plus release tooling under `tools/release/`),
  but `composer.json` does not itself declare a `bin/console`-style
  entry point or a `symfony/runtime`-style bootstrap. Locating the actual
  console application bootstrap is out of scope for a composer.json-only
  walk.
- **`vendor/bin/*` tool binaries** provided transitively by require-dev
  packages and invoked from `scripts`: `phpcs`, `phpcbf`, `phpstan`,
  `rector`, `composer-require-checker`, `conventional-commits`,
  `split-phpstan-baseline`, `phpunit` (via `phpunit-isolated` script),
  `psysh` (not itself wired into a script, but installed).

---

## 4. Unusual/notable items (facts only)

1. **Eager global-function autoloading.** Eight legacy procedural files are
   composer `files`-autoloaded (`composer.json:179-188`), meaning they
   execute on every autoload bootstrap rather than being pulled in
   on-demand by class references.
2. **Two custom VCS repositories with no current consumer.**
   `wkhtmltopdf-openemr` and `oe-module-cqm` are declared under
   `repositories` (`composer.json:163-170`) but neither package name
   appears in `require`/`require-dev` or in `composer.lock`'s installed
   package list.
3. **A hard platform pin.** `config.platform` fixes every extension and PHP
   itself to the literal `"8.2"` (`composer.json:210-245`), stricter than
   the `>=8.2.0` in `require.php` (`composer.json:14`).
4. **`dealerdirect/phpcodesniffer-composer-installer` and
   `php-http/discovery` plugins are explicitly disabled**
   (`composer.json:204,207`) while their companion packages
   (`squizlabs/php_codesniffer`/`slevomat/coding-standard`, and
   `php-http/discovery` itself) remain required.
5. **Three packages are flagged `abandoned: true` in `composer.lock`, with
   no replacement listed:** `laminas/laminas-config` (`composer.lock:3023`),
   `laminas/laminas-loader` (`composer.lock:3757`), and
   `yubico/u2flib-server` (`composer.lock:13255`) — all three are direct
   `require` entries, and all three are confirmed used in code (see §2).
   Two more abandoned packages appear **transitively** (not in `composer.json`
   directly): `php-http/message-factory`, abandoned in favor of
   `psr/http-factory` (`composer.lock:7321`), and `symfony/inflector`
   v5.0.11, abandoned in favor of "EnglishInflector from the String
   component" (`composer.lock:11191`).
6. **Two independent SQL parser packages** (`iamcal/sql-parser` and
   `phpmyadmin/sql-parser`) are both present in `require-dev`, and neither
   showed a confirmed call site in `src/`, `library/`, or `interface/` in
   this pass.
7. **`roave/security-advisories` is pinned to `dev-latest`**
   (`composer.json:156`), and `composer.lock`'s top-level
   `stability-flags` records exactly this one package at a `dev`-level
   stability flag (`"roave/security-advisories": 20`) even though the
   project's overall `minimum-stability` is `"stable"`
   (`composer.lock` top level) and `prefer-stable` is `false`. This is the
   package's documented normal usage pattern (it has no releases; only
   `dev-*` branches), noted here as a fact rather than a concern.
8. **`autoload-dev` reuses the production `OpenEMR\` namespace prefix** for
   the entire `tests/` directory (`composer.json:198`), alongside `src`
   (`composer.json:174`) — two directories merged under one psr-4 prefix,
   active only when dev dependencies are installed.
9. **`digitickets/lalit` (required directly) and
   `claimrevolution/oe-module-claimrev-connect` (required directly) had no
   confirmed usage** via namespace grep in `src/`, `library/`, or
   `interface/` in this pass — see §2 for the exact greps run and their
   zero/near-zero results.

---

**Scope note:** this file audits `composer.json` and cross-references
`composer.lock` for locked versions/abandoned flags. It does not audit
`package.json`, does not run `composer` (validate/normalize/install), does
not query Packagist or GitHub over the network, and does not open
`vendor/` source to confirm behavior beyond `use`-statement/class-reference
greps in `src/`, `library/`, and `interface/` (with a few targeted greps
into `tests/`, `tools/`, `db/`, and `config/` where a package's use was not
findable in the three primary directories, called out inline above).
