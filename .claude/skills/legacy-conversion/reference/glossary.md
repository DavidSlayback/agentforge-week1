# Glossary: Mapping the Lecture's VB6 Vocabulary to Other Stacks

The pipeline was demonstrated on a VB6 desktop app. The phases are
stack-agnostic; only the nouns change.

| Lecture term (VB6) | Generic role | Equivalents |
|---|---|---|
| `StarHotel.vbp` project file | **Build/project manifest** — lists compilation units, deps, entry point, version | `.sln`/`.csproj`/`.vbproj`, `pom.xml`, `build.gradle`, `package.json`, `composer.json`, `pyproject.toml`/`setup.py`, `Gemfile`, `go.mod`, `Cargo.toml`, `CMakeLists.txt`/`Makefile`, Delphi `.dpr`/`.dproj`, PowerBuilder `.pbt`, COBOL JCL + copybook lists, `web.xml`, Rails `routes.rb`, Laravel/Symfony route files |
| `.vbw`, `.res`, app manifest | **Packaging artifacts** | IDE workspace files, resource bundles, installer scripts (InnoSetup/WiX/NSIS), Dockerfiles, CI configs, `.env` templates |
| Forms (`.frm` + `.frx`) | **UI units** (Phase 2) | WinForms/WPF windows, Delphi `.pas`+`.dfm`, Access forms, JSP/ASP/ASPX/PHP pages, MVC controllers + views, Twig/Smarty/Blade templates, SPA routes/components, CICS/BMS maps, CLI commands, public API endpoints |
| Modules (`.bas`), classes (`.cls`) | **Business & data-logic modules** (Phase 3) | Services, repositories, DAOs, helper libraries, include files (`library/*.inc.php`), COBOL programs/paragraphs, stored-procedure wrappers |
| Global `gstrSQL`, `gstrUserID` | **Shared mutable state** | Statics/singletons, `$GLOBALS`, `$_SESSION` as a service locator, module-level variables, thread-locals, application-scope beans |
| Access `.mdb` + `CreateDB` | **Schema source of truth** (Phase 4) | DDL scripts, migrations, ORM mappings, `sql/*.sql`, live DB dump |
| Crystal Reports `.rpt` | **Report engine & templates** | SSRS `.rdl`, JasperReports `.jrxml`, BIRT, FastReport, ActiveReports, PDF generators, CSV/Excel exports |
| "Run the EXE" | **Run the app** | `docker compose up`, dev server, VM with the legacy OS, 3270 emulator, staging environment, recorded demo |
| `publish/` folder | **Shipped artifacts** | `dist/`, `build/`, installers, WAR/EAR/JAR, container images |
| COM references (ADO, MSCOMCTL) | **External dependencies** | NuGet/Maven/npm/Composer packages, native DLLs/SOs, OCX/ActiveX, system services |
| Web LLM "AI scrape" | **Broad-context mapping model** | Any long-context model given the manifest + tree; in Claude Code, the main session |
| Local LLM "deep-dive" | **Tool-using agent in the repo** | Claude Code with `CLAUDE.md`, this skill, and subagents |
| VBUC (VB Upgrade Companion) | **Automated translator** | .NET Upgrade Assistant, vendor migrators, transpilers, Rector/codemods for in-place upgrades |
| "Form audit" / "Module audit" | **Layer audits** | UI-layer audit / module audit (Phases 2–3) |
