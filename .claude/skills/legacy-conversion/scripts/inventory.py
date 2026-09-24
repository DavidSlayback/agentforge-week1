#!/usr/bin/env python3
"""Deterministic inventory of a legacy source tree (Phases 0-1).

Prints a Markdown report: totals, lines by extension and by top-level
directory, largest files, detected build manifests, shipped binaries, and
(optionally) git churn hot spots. Standard library only; read-only.

Usage:
    inventory.py <source-root> [--exclude GLOB ...] [--top N] [--churn]
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

DEFAULT_EXCLUDES = [
    ".git", ".hg", ".svn", "node_modules", "vendor", "bower_components",
    "__pycache__", ".venv", "venv", ".idea", ".vs",
    "*.min.js", "*.min.css", "*.map",
]

MANIFEST_PATTERNS = {
    "*.vbp": "VB6 project", "*.vbg": "VB6 project group", "*.vbw": "VB6 workspace",
    "*.sln": ".NET solution", "*.csproj": "C# project", "*.vbproj": "VB.NET project",
    "*.dpr": "Delphi program", "*.dproj": "Delphi project", "*.pbt": "PowerBuilder target",
    "pom.xml": "Maven", "build.gradle": "Gradle", "build.gradle.kts": "Gradle (Kotlin)",
    "build.xml": "Ant", "package.json": "npm", "composer.json": "Composer",
    "pyproject.toml": "Python project", "setup.py": "Python setup", "requirements.txt": "pip requirements",
    "Gemfile": "Bundler", "go.mod": "Go module", "Cargo.toml": "Cargo",
    "CMakeLists.txt": "CMake", "Makefile": "Make", "makefile": "Make",
    "web.xml": "Java web app", "*.jcl": "JCL", "Dockerfile": "Docker",
    "docker-compose.yml": "Compose", "compose.yml": "Compose",
}

BINARY_ARTIFACTS = {
    ".exe", ".dll", ".ocx", ".tlb", ".olb", ".com", ".msi", ".cab",
    ".mdb", ".accdb", ".mde", ".sqlite", ".db", ".dbf", ".mdf", ".ldf",
    ".rpt", ".rdl", ".jasper", ".frx", ".ctx", ".res",
    ".jar", ".war", ".ear", ".class", ".so", ".dylib", ".a", ".lib",
    ".pyc", ".zip", ".7z", ".rar", ".tar", ".gz",
}

TEXT_SNIFF_BYTES = 4096


@dataclass
class FileStat:
    rel: str
    ext: str
    top: str
    size: int
    lines: int  # non-blank lines; -1 for binaries


def is_excluded(rel_parts: tuple[str, ...], name: str, excludes: list[str]) -> bool:
    for pattern in excludes:
        if any(fnmatch.fnmatch(part, pattern) for part in rel_parts):
            return True
        if fnmatch.fnmatch(name, pattern):
            return True
    return False


def looks_binary(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            chunk = handle.read(TEXT_SNIFF_BYTES)
    except OSError:
        return True
    return b"\x00" in chunk


def count_lines(path: Path) -> int:
    count = 0
    with path.open("rb") as handle:
        for raw in handle:
            if raw.strip():
                count += 1
    return count


def scan(root: Path, excludes: list[str]) -> list[FileStat]:
    stats: list[FileStat] = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root)
        dirnames[:] = sorted(
            d for d in dirnames if not is_excluded(rel_dir.parts + (d,), d, excludes)
        )
        for name in sorted(filenames):
            rel = rel_dir / name
            if is_excluded(rel.parts, name, excludes):
                continue
            path = Path(dirpath) / name
            ext = path.suffix.lower() or "(none)"
            top = rel.parts[0] if len(rel.parts) > 1 else "."
            size = path.stat().st_size
            binary = ext in BINARY_ARTIFACTS or looks_binary(path)
            lines = -1 if binary else count_lines(path)
            stats.append(FileStat(rel.as_posix(), ext, top, size, lines))
    return stats


def churn(root: Path, top: int) -> list[tuple[int, str]] | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "log", "--format=", "--name-only", "--", "."],
            capture_output=True, text=True, check=True,
        ).stdout
        prefix = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--show-prefix"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    counts = Counter(
        line[len(prefix):] if prefix and line.startswith(prefix) else line
        for line in out.splitlines() if line.strip()
    )
    return [(n, path) for path, n in counts.most_common(top)]


def git_summary(root: Path) -> str | None:
    try:
        commits = subprocess.run(
            ["git", "-C", str(root), "rev-list", "--count", "HEAD", "--", "."],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        first_last = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%as", "--", "."],
            capture_output=True, text=True, check=True,
        ).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        return None
    if not first_last:
        return None
    return f"{commits} commits touching this tree, {first_last[-1]} → {first_last[0]}"


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--exclude", action="append", default=[],
                        help="extra glob to exclude (repeatable)")
    parser.add_argument("--top", type=int, default=20, help="rows in top-N tables")
    parser.add_argument("--churn", action="store_true", help="include git churn hot spots")
    args = parser.parse_args()

    root: Path = args.root.resolve()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2
    excludes = DEFAULT_EXCLUDES + args.exclude
    stats = scan(root, excludes)
    text = [s for s in stats if s.lines >= 0]
    binaries = [s for s in stats if s.lines < 0]

    print(f"# Inventory — `{root.name}`\n")
    print("Generated by `.claude/skills/legacy-conversion/scripts/inventory.py`. "
          "Counts are non-blank lines; designer/markup lines are included, so "
          "behavioral LOC is lower for form-based stacks.\n")
    print(f"- **Excluded globs:** {', '.join(f'`{e}`' for e in excludes)}")
    print(f"- **Files:** {len(stats)} ({len(text)} text, {len(binaries)} binary)")
    print(f"- **Non-blank text lines:** {sum(s.lines for s in text):,}")
    summary = git_summary(root)
    if summary:
        print(f"- **Git history:** {summary}")
    print()

    by_ext: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for s in text:
        by_ext[s.ext][0] += 1
        by_ext[s.ext][1] += s.lines
    print("## Lines by extension\n")
    rows = sorted(by_ext.items(), key=lambda kv: -kv[1][1])
    print(md_table(["Extension", "Files", "Lines"],
                   [[f"`{e}`", str(f), f"{n:,}"] for e, (f, n) in rows]))
    print()

    by_top: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for s in stats:
        by_top[s.top][0] += 1
        by_top[s.top][1] += max(s.lines, 0)
        by_top[s.top][2] += s.size
    print("## By top-level directory\n")
    print(md_table(["Directory", "Files", "Text lines", "Size"],
                   [[f"`{d}`", str(f), f"{n:,}", human(z)]
                    for d, (f, n, z) in sorted(by_top.items(), key=lambda kv: -kv[1][1])]))
    print()

    print(f"## Largest text files (top {args.top})\n")
    print(md_table(["File", "Lines"],
                   [[f"`{s.rel}`", f"{s.lines:,}"]
                    for s in sorted(text, key=lambda s: -s.lines)[: args.top]]))
    print()

    manifests = []
    for s in stats:
        name = Path(s.rel).name
        for pattern, kind in MANIFEST_PATTERNS.items():
            if fnmatch.fnmatch(name, pattern):
                manifests.append([f"`{s.rel}`", kind])
                break
    print("## Build manifests detected\n")
    print(md_table(["File", "Kind"], manifests) if manifests else "_None detected — find the entry point by hand._")
    print()

    print("## Binary / shipped artifacts\n")
    if binaries:
        kinds = Counter(s.ext for s in binaries)
        print(md_table(["Extension", "Count"], [[f"`{e}`", str(n)] for e, n in kinds.most_common()]))
        print()
        print(md_table(["File", "Size"],
                       [[f"`{s.rel}`", human(s.size)]
                        for s in sorted(binaries, key=lambda s: -s.size)[: args.top]]))
    else:
        print("_None._")
    print()

    if args.churn:
        print(f"## Git churn hot spots (top {args.top})\n")
        hot = churn(root, args.top)
        if hot is None:
            print("_Not a git repository (or git unavailable)._")
        elif not hot:
            print("_No history._")
        else:
            print(md_table(["Commits", "File"], [[str(n), f"`{p}`"] for n, p in hot]))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
