#!/usr/bin/env bash
# Run QMD benchmarks with CPU profiling enabled.
# Generates .cpuprofile files that can be opened in speedscope or Chrome DevTools.
#
# Usage:
#   ./bench/run-cpu-profile.sh           # full benchmarks
#   ./bench/run-cpu-profile.sh --quick   # quick smoke test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_DIR="$(dirname "$SCRIPT_DIR")"
PROF_DIR="/tmp/qmd-bench"

mkdir -p "$PROF_DIR"

BENCHMARKS=(
  "bench/bench-embed.ts"
  "bench/bench-expand.ts"
  "bench/bench-rerank.ts"
)

echo "═══════════════════════════════════════════════════════════════"
echo "  QMD CPU Profiling"
echo "  Output: $PROF_DIR"
echo "═══════════════════════════════════════════════════════════════"
echo ""

for bench in "${BENCHMARKS[@]}"; do
  name="$(basename "$bench" .ts)"
  echo "▸ $name"
  bun --cpu-prof --cpu-prof-dir "$PROF_DIR" "$PROJ_DIR/$bench" "$@"
  echo ""
done

echo "═══════════════════════════════════════════════════════════════"
echo "  Done. CPU profiles saved to: $PROF_DIR"
echo "  Open with: npx speedscope $PROF_DIR/*.cpuprofile"
echo "═══════════════════════════════════════════════════════════════"
