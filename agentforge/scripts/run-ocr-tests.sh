#!/bin/sh
# Run the live-OCR tests (LIVE_OCR_TEST_FILES in test/helpers/ocrTools.js)
# with AGENTFORGE_REQUIRE_OCR=1, so a missing pdftoppm, pdfinfo or tesseract
# fails instead of skipping.
#
# - pdftoppm, pdfinfo and tesseract all on PATH: run natively.
# - Otherwise, Docker running: run inside an image built from the deployed
#   Dockerfile's own FROM line and `RUN apk add` OCR line (node:24-alpine +
#   poppler-utils, tesseract-ocr, tesseract-ocr-data-eng), with the repo
#   mounted read-only. The image is tagged with a hash of those two lines, so
#   repeat runs reuse it and a Dockerfile change rebuilds it.
# - Neither: exit 3. The pre-commit hook decides whether that blocks.
#
# Exit status: 0 pass, 1 fail, 3 no OCR tools and no Docker.
# Set AGENTFORGE_OCR_TESTS_DOCKER=1 to use Docker even when the tools are on PATH.
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

files=$(node --input-type=module -e "import('./agentforge/test/helpers/ocrTools.js').then((m) => console.log(m.LIVE_OCR_TEST_FILES.join(' ')))")

have_tools=1
for tool in pdftoppm pdfinfo tesseract; do
  command -v "$tool" >/dev/null 2>&1 || have_tools=0
done

if [ "$have_tools" = 1 ] && [ "${AGENTFORGE_OCR_TESTS_DOCKER:-0}" != 1 ]; then
  echo "AgentForge OCR tests: native pdftoppm/pdfinfo/tesseract ($files)"
  # shellcheck disable=SC2086
  (cd agentforge && AGENTFORGE_REQUIRE_OCR=1 node --test --test-concurrency=1 $files)
  exit $?
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "AgentForge OCR tests: pdftoppm/pdfinfo/tesseract are not on PATH and Docker is not running." >&2
  exit 3
fi

base_line=$(grep -m1 '^FROM ' Dockerfile || true)
apk_line=$(grep -m1 '^RUN apk add .*tesseract' Dockerfile || true)
if [ -z "$base_line" ] || [ -z "$apk_line" ]; then
  echo "AgentForge OCR tests: cannot find the FROM line and the 'RUN apk add ... tesseract' line in Dockerfile; update scripts/run-ocr-tests.sh to match it." >&2
  exit 1
fi
dockerfile=$(printf '%s\n%s\n' "$base_line" "$apk_line")
tag="agentforge-ocr-test:$(printf '%s' "$dockerfile" | sha256sum | cut -c1-12)"

if ! docker image inspect "$tag" >/dev/null 2>&1; then
  echo "AgentForge OCR tests: building $tag from the deployed Dockerfile's base and OCR packages..."
  printf '%s\n' "$dockerfile" | docker build --quiet -t "$tag" - >/dev/null
fi

# Git Bash on Windows: hand Docker a C:/ path and stop MSYS rewriting /repo.
host_root=$(pwd -W 2>/dev/null || pwd)
echo "AgentForge OCR tests: Docker $tag, repo mounted read-only ($files)"
# shellcheck disable=SC2086
MSYS_NO_PATHCONV=1 docker run --rm -e AGENTFORGE_REQUIRE_OCR=1 -v "$host_root:/repo:ro" -w /repo/agentforge "$tag" \
  node --test --test-concurrency=1 $files
