# qmd

Fork of tobi/qmd. Markdown search + knowledge graph over YAML frontmatter.

## Structure

```
src/
  qmd.ts          CLI entry point, command dispatch
  store.ts        SQLite schema, FTS5, graph tables, all query functions
  db.ts           SQLite compatibility layer (bun:sqlite vs better-sqlite3)
  llm.ts          LLM operations (embedding, reranking, query expansion)
  collections.ts  YAML config for collections (~/.config/qmd/index.yml)
  formatter.ts    Output formatting (CLI, CSV, JSON, MD, XML)
test/             Tests (bun test)
qmd               Shell wrapper (Bun fast path, Node for vector/LLM)
```

## Key decisions

- Hybrid runtime: Bun for fast commands, Node for sqlite-vec (bun:sqlite can't load native extensions)
- Lazy llm.js import: only loaded for query/embed/vsearch/pull/status
- Graph built from frontmatter during `qmd update` (Phase 2 in indexFiles)
- Graph uses SQLite tables (graph_nodes, graph_edges), not a graph DB
- Backward compat: `related:` -> edge_type "related", `links:` -> typed edges
- All graph queries are bidirectional (traverse checks both source and target)

## Build

```bash
bun run build    # tsc -> dist/ (needed for Node path)
bun test         # run tests
```

## Test

191 pass, 6 fail (pre-existing sqlite-vec extension loading issue in bun:sqlite).
