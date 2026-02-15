#!/usr/bin/env bash
# Run QMD benchmarks with memory-constrained profiling.
# Uses bun --smol for reduced memory mode. Benchmarks report heap stats
# via bun:jsc heapStats() for before/after heap comparison.
#
# Usage:
#   ./bench/run-heap-profile.sh           # full benchmarks
#   ./bench/run-heap-profile.sh --quick   # quick smoke test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_DIR="$(dirname "$SCRIPT_DIR")"

BENCHMARKS=(
  "bench/bench-embed.ts"
  "bench/bench-expand.ts"
  "bench/bench-rerank.ts"
)

echo "═══════════════════════════════════════════════════════════════"
echo "  QMD Heap Profiling (--smol mode)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

for bench in "${BENCHMARKS[@]}"; do
  name="$(basename "$bench" .ts)"
  echo "▸ $name"
  bun --smol "$PROJ_DIR/$bench" "$@"
  echo ""
done

echo "═══════════════════════════════════════════════════════════════"
echo "  Done."
echo "═══════════════════════════════════════════════════════════════"
