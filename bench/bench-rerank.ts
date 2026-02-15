#!/usr/bin/env bun
/**
 * QMD Reranker Benchmark
 *
 * Measures reranking throughput across different batch sizes.
 * Reports device info, median time, docs/sec, and peak RSS.
 *
 * Usage:
 *   bun bench/bench-rerank.ts           # full benchmark
 *   bun bench/bench-rerank.ts --quick   # quick smoke test
 */

import { LlamaCpp, type RerankDocument } from "../src/llm.ts";
import { heapStats } from "bun:jsc";

// ============================================================================
// Config
// ============================================================================

const args = process.argv.slice(2);
const quick = args.includes("--quick");

const BATCH_SIZES = quick ? [10, 40] : [10, 20, 40, 80, 160];
const ITERATIONS = quick ? 1 : 3;

const QUERY = "How do AI agents work and what are their limitations?";

// ============================================================================
// Test data — realistic document chunks
// ============================================================================

const SAMPLE_TEXTS = [
  "Artificial intelligence agents are software systems that perceive their environment and take actions to achieve goals. They use techniques like reinforcement learning, planning, and natural language processing to operate autonomously.",
  "The transformer architecture, introduced in 2017, revolutionized natural language processing. Self-attention mechanisms allow models to weigh the importance of different parts of input sequences when generating outputs.",
  "Machine learning models require careful evaluation to avoid overfitting. Cross-validation, holdout sets, and metrics like precision, recall, and F1 score help assess generalization performance.",
  "Retrieval-augmented generation combines information retrieval with language models. Documents are embedded into vector spaces, retrieved based on query similarity, and used as context for generation.",
  "Neural network training involves forward propagation, loss computation, and backpropagation. Optimizers like Adam and SGD adjust weights to minimize the loss function over training iterations.",
  "Large language models exhibit emergent capabilities at scale, including few-shot learning, chain-of-thought reasoning, and instruction following. These properties were not explicitly trained for.",
  "Embedding models convert text into dense vector representations that capture semantic meaning. Similar texts produce similar vectors, enabling efficient similarity search and clustering.",
  "Autonomous agents face challenges including hallucination, lack of grounding, limited planning horizons, and difficulty with multi-step reasoning. Safety and alignment remain open research problems.",
  "The attention mechanism computes query-key-value interactions to determine which parts of the input are most relevant. Multi-head attention allows the model to attend to different representation subspaces.",
  "Fine-tuning adapts a pre-trained model to specific tasks using domain-specific data. Techniques like LoRA reduce the number of trainable parameters while maintaining performance.",
];

function generateDocs(n: number): RerankDocument[] {
  return Array.from({ length: n }, (_, i) => ({
    file: `doc-${i}.md`,
    text: SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]!,
    title: `Document ${i + 1}`,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  QMD Reranker Benchmark");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const llm = new LlamaCpp();

  // System info
  const device = await llm.getDeviceInfo();
  console.log("System");
  console.log(`  Device:    ${device.gpu || "cpu"}`);
  if (device.gpuDevices.length > 0) console.log(`  GPU:       ${device.gpuDevices.join(", ")}`);
  if (device.vram) console.log(`  VRAM:      ${formatBytes(device.vram.total)} total, ${formatBytes(device.vram.free)} free`);
  console.log(`  CPU cores: ${device.cpuCores} math`);
  console.log(`  RSS:       ${formatBytes(process.memoryUsage().rss)} at start`);

  // Cold-start: first rerank triggers context creation
  console.log("\nLoading model + creating contexts...");
  const initDocs = generateDocs(2);
  const initT0 = performance.now();
  await llm.rerank(QUERY, initDocs);
  const initMs = performance.now() - initT0;
  const ctx = llm.getContextCounts();
  console.log(`  ${ctx.rerank} rerank context${ctx.rerank !== 1 ? "s" : ""} created in ${initMs.toFixed(0)}ms`);

  // Benchmark
  console.log(`\nBenchmark (1 cold + ${ITERATIONS} warm iteration${ITERATIONS > 1 ? "s" : ""} per config)`);
  console.log(`  Query: "${QUERY.slice(0, 50)}..."\n`);

  type Result = { batchSize: number; coldMs: number; warmMs: number; coldDps: number; warmDps: number; peakRss: number };
  const results: Result[] = [];
  let peakRss = process.memoryUsage().rss;

  for (const batchSize of BATCH_SIZES) {
    const docs = generateDocs(batchSize);

    process.stdout.write(`  [docs=${String(batchSize).padStart(3)}] `);

    // Cold run (first invocation at this batch size)
    const t0 = performance.now();
    const coldResult = await llm.rerank(QUERY, docs);
    const coldMs = performance.now() - t0;

    if (coldResult.results.length !== batchSize) {
      console.log(`WARNING: got ${coldResult.results.length}/${batchSize} results`);
    }

    let rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;

    // Warm runs
    const warmTimes: number[] = [];
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const t1 = performance.now();
      await llm.rerank(QUERY, docs);
      warmTimes.push(performance.now() - t1);

      rss = process.memoryUsage().rss;
      if (rss > peakRss) peakRss = rss;
    }

    const warmMs = median(warmTimes);
    const coldDps = (batchSize / coldMs) * 1000;
    const warmDps = (batchSize / warmMs) * 1000;
    results.push({ batchSize, coldMs, warmMs, coldDps, warmDps, peakRss });
    console.log(`cold ${coldMs.toFixed(0).padStart(5)}ms  warm ${warmMs.toFixed(0).padStart(5)}ms  ${warmDps.toFixed(1).padStart(7)} docs/s  RSS ${formatBytes(peakRss)}`);
  }

  // Heap stats
  Bun.gc(true);
  const heap = heapStats();
  console.log(`\nHeap: ${formatBytes(heap.heapSize)} (${heap.objectCount} objects)`);

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Results");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const header = "  Docs    Cold      Warm    Docs/s   Peak RSS";
  const sep    = "  ────  ──────    ──────    ──────   ────────";
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const speedup = r === results[0] ? "" : ` (${(r.warmDps / results[0]!.warmDps).toFixed(1)}x)`;
    console.log(
      `  ${String(r.batchSize).padStart(4)}  ` +
      `${r.coldMs.toFixed(0).padStart(5)}ms  ` +
      `${r.warmMs.toFixed(0).padStart(5)}ms  ` +
      `${r.warmDps.toFixed(1).padStart(7)}  ` +
      `${formatBytes(r.peakRss).padStart(8)}` +
      speedup
    );
  }

  if (results.length > 1) {
    const best = results.reduce((a, b) => a.warmDps > b.warmDps ? a : b);
    console.log(`\n  Best: ${best.batchSize} docs, ${best.warmDps.toFixed(1)} docs/s`);
  }

  console.log("");
  await llm.dispose();
}

main().catch(console.error);
