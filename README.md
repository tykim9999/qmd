# qmd

Fork of [tobi/qmd](https://github.com/tobi/qmd) with a knowledge graph layer.

Markdown search engine: BM25 full-text, vector similarity, LLM reranking,
and graph traversal over YAML frontmatter links.

## Install

```
bun install
bun link
```

Requires Bun (fast path) and Node >= 22 (vector/LLM path).

## Architecture

```
.md files with YAML frontmatter
        |
        v
   qmd update
        |
        +---> content (SHA256) ---> FTS5 (BM25)
        |                     ---> vectors (sqlite-vec)
        +---> graph_nodes (id, type, properties)
              graph_edges (source, target, edge_type)
                    |
                    v
              qmd graph <id>.<edge_type>
```

Storage: single SQLite database (~/.cache/qmd/index.sqlite).

## Commands

```
Search:
  qmd search <query>          BM25 keyword search (fast, no LLM)
  qmd query <query>           Query expansion + vector + reranking (best quality)
  qmd vsearch <query>         Vector similarity (no reranking)

Graph:
  qmd graph                   Stats (node/edge counts, type distribution)
  qmd graph <id>              Node info + all edges
  qmd graph <id>.<edge>       Traverse edges (dot notation, multi-hop)
  qmd graph --impact <id>     BFS fan-out (what's affected?)
  qmd graph --path <a> <b>    Shortest path between nodes
  qmd graph --type <type>     List nodes by object type
  qmd graph --edges <id>      All edges for a node (TSV)

Documents:
  qmd get <file> [-l N]       Get document content
  qmd ls [collection]         List files
  qmd multi-get <pattern>     Get multiple docs by glob

Index:
  qmd update [--pull]         Re-index all collections
  qmd embed [-f]              Create/update vector embeddings
  qmd status                  Show index stats
  qmd cleanup                 Remove cache, vacuum DB

Collections:
  qmd collection list         List collections
  qmd collection add <path>   Add collection
  qmd collection remove <n>   Remove collection
```

## Graph

The graph is built automatically during `qmd update` from YAML frontmatter:

```yaml
---
id: my-note
type: plan
person: ty
related:
  - other-note.md
  - ../finance/budget.md
links:
  owns: [apartment-a]
  covers: [topic-x, topic-y]
---
```

- `id` becomes the graph node ID
- `type` (or `object_type`) becomes the node type
- `related:` creates edges with type "related"
- `links:` creates typed edges (owns, covers, etc.)
- All other frontmatter fields stored as node properties

### Examples

```bash
# What's connected to the financial plan?
qmd graph joint-financial-plan

# Traverse: all notes related to the apartment
qmd graph joint-urvine-first.related

# Impact: if I sell the apartment, what's affected?
qmd graph --impact joint-urvine-first --depth 3

# Path: how are health checkup and emigration connected?
qmd graph --path ty-checkup-20250728 joint-emigration-analysis

# Compose with other commands
qmd graph --type plan | xargs -I{} qmd graph {}
```

### Output

Graph commands output plain text, one ID per line (pipe-friendly):

```
$ qmd graph joint-urvine-first.related
joint-centum-analysis
joint-financial-plan
joint-emigration-analysis
joint-relocation-research-20260213
joint-pyeongchon-academy-research
```

`--edges` and `--impact` output TSV for easy parsing:

```
$ qmd graph --impact joint-urvine-first --depth 2
joint-centum-analysis    related    1
joint-financial-plan     related    1
joint-plan               related    2
ty-supplement-plan       related    2
```

## Runtime

Fast-path commands (graph, search, get, ls) run under Bun (~170ms).
LLM commands (query, vsearch, embed) run under Node for sqlite-vec compatibility.

## License

MIT (original: Tobi Lutke)
