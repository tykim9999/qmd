#!/usr/bin/env bun
/**
 * QMD Embedding Benchmark
 *
 * Measures batch embedding throughput across different batch sizes.
 * Reports device info, median time, texts/sec, and peak RSS.
 *
 * Usage:
 *   bun bench/bench-embed.ts           # full benchmark
 *   bun bench/bench-embed.ts --quick   # quick smoke test
 */

import { LlamaCpp, formatDocForEmbedding } from "../src/llm.ts";
import { heapStats } from "bun:jsc";

// ============================================================================
// Config
// ============================================================================

const args = process.argv.slice(2);
const quick = args.includes("--quick");

const BATCH_SIZES = quick ? [1, 10] : [1, 10, 50, 100];
const ITERATIONS = quick ? 1 : 3;

// ============================================================================
// Test data — realistic formatted documents
// ============================================================================

const SAMPLE_TEXTS = [
  "Query expansion generates hypothetical documents that help bridge the vocabulary gap between user queries and relevant documents in the corpus.",
  "BM25 scoring uses term frequency and inverse document frequency to rank documents by lexical relevance to the search query.",
  "Vector embeddings capture semantic meaning allowing retrieval of conceptually similar documents even without keyword overlap.",
  "Hybrid search combines sparse BM25 retrieval with dense vector search to get the best of both lexical and semantic matching.",
  "Reranking with cross-encoder models provides more accurate relevance scores by jointly encoding the query and document together.",
  "The transformer architecture revolutionized natural language processing through self-attention mechanisms that weigh input importance.",
  "Fine-tuning adapts pre-trained models to specific tasks using domain data while techniques like LoRA reduce trainable parameters.",
  "Retrieval-augmented generation combines information retrieval with language models for grounded, factual text generation.",
  "Neural network training involves forward propagation, loss computation, and backpropagation with optimizers adjusting weights.",
  "Large language models exhibit emergent capabilities at scale including few-shot learning and chain-of-thought reasoning.",
];

function generateTexts(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    formatDocForEmbedding(SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]!, `Document ${i + 1}`)
  );
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
  console.log("  QMD Embedding Benchmark");
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

  // Cold-start: first embedBatch triggers context creation
  console.log("\nLoading model + creating contexts...");
  const initTexts = generateTexts(1);
  const initT0 = performance.now();
  await llm.embedBatch(initTexts);
  const initMs = performance.now() - initT0;
  const ctx = llm.getContextCounts();
  console.log(`  ${ctx.embed} embed context${ctx.embed !== 1 ? "s" : ""} created in ${initMs.toFixed(0)}ms`);

  // Benchmark
  console.log(`\nBenchmark (1 cold + ${ITERATIONS} warm iteration${ITERATIONS > 1 ? "s" : ""} per config)\n`);

  type Result = { batchSize: number; coldMs: number; warmMs: number; coldTps: number; warmTps: number; peakRss: number };
  const results: Result[] = [];
  let peakRss = process.memoryUsage().rss;

  for (const batchSize of BATCH_SIZES) {
    const texts = generateTexts(batchSize);

    process.stdout.write(`  [batch=${String(batchSize).padStart(3)}] `);

    // Cold run (first invocation at this batch size)
    const t0 = performance.now();
    const coldResult = await llm.embedBatch(texts);
    const coldMs = performance.now() - t0;

    const valid = coldResult.filter(e => e !== null).length;
    if (valid !== batchSize) {
      console.log(`WARNING: only ${valid}/${batchSize} embeddings succeeded`);
    }

    let rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;

    // Warm runs
    const warmTimes: number[] = [];
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const t1 = performance.now();
      await llm.embedBatch(texts);
      warmTimes.push(performance.now() - t1);

      rss = process.memoryUsage().rss;
      if (rss > peakRss) peakRss = rss;
    }

    const warmMs = median(warmTimes);
    const coldTps = (batchSize / coldMs) * 1000;
    const warmTps = (batchSize / warmMs) * 1000;
    results.push({ batchSize, coldMs, warmMs, coldTps, warmTps, peakRss });
    console.log(`cold ${coldMs.toFixed(0).padStart(5)}ms  warm ${warmMs.toFixed(0).padStart(5)}ms  ${warmTps.toFixed(1).padStart(7)} texts/s  RSS ${formatBytes(peakRss)}`);
  }

  // Heap stats
  Bun.gc(true);
  const heap = heapStats();
  console.log(`\nHeap: ${formatBytes(heap.heapSize)} (${heap.objectCount} objects)`);

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Results");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const header = "  Batch    Cold      Warm   Texts/s   Peak RSS";
  const sep    = "  ─────  ──────    ──────   ───────   ────────";
  console.log(header);
  console.log(sep);

  for (const r of results) {
    console.log(
      `  ${String(r.batchSize).padStart(5)}  ` +
      `${r.coldMs.toFixed(0).padStart(5)}ms  ` +
      `${r.warmMs.toFixed(0).padStart(5)}ms  ` +
      `${r.warmTps.toFixed(1).padStart(7)}  ` +
      `${formatBytes(r.peakRss).padStart(8)}`
    );
  }

  if (results.length > 1) {
    const best = results.reduce((a, b) => a.warmTps > b.warmTps ? a : b);
    console.log(`\n  Best: batch=${best.batchSize}, ${best.warmTps.toFixed(1)} texts/s`);
  }

  console.log("");
  await llm.dispose();
}

main().catch(console.error);
