import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { IssueKind } from "../tools/jiraTools.js"
import { Bm25 } from "./bm25.js"
import { Doc } from "./documents.js"
import { Embedder } from "./embedder.js"

export type Mode = "hybrid" | "vector" | "keyword"

export interface Hit {
  doc: Doc
  // cosine similarity to the query, -1..1; shown so a reader can judge how close a match is
  similarity: number
  score: number
}

interface Stored {
  model: string
  builtAt: string
  entries: { doc: Doc; hash: string; vector: number[] }[]
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)

// Reciprocal rank fusion: each ranking contributes 1/(k + rank). It needs no score
// calibration between BM25 and cosine, which live on different scales.
const RRF_K = 60

export class KnowledgeIndex {
  private readonly bm25: Bm25

  private constructor(
    private readonly embedder: Embedder,
    private readonly entries: Stored["entries"],
    readonly builtAt: string
  ) {
    this.bm25 = new Bm25(entries.map((e) => e.doc.text))
  }

  get size(): number {
    return this.entries.length
  }

  get docs(): Doc[] {
    return this.entries.map((e) => e.doc)
  }

  // Re-embeds only documents whose text changed since the previous index
  static async build(docs: Doc[], embedder: Embedder, previous?: KnowledgeIndex): Promise<KnowledgeIndex> {
    const reusable = new Map(
      previous && previous.embedder.model === embedder.model ? previous.entries.map((e) => [e.hash, e.vector]) : []
    )
    const hashes = docs.map((d) => hashOf(d.text))
    const missing = docs.filter((_, i) => !reusable.has(hashes[i]!))
    const fresh = await embedder.embed(missing.map((d) => d.text))
    missing.forEach((d, i) => reusable.set(hashOf(d.text), fresh[i]!))
    const entries = docs.map((doc, i) => ({ doc, hash: hashes[i]!, vector: reusable.get(hashes[i]!)! }))
    return new KnowledgeIndex(embedder, entries, new Date().toISOString())
  }

  static load(file: string, embedder: Embedder): KnowledgeIndex | null {
    if (!fs.existsSync(file)) return null
    const stored = JSON.parse(fs.readFileSync(file, "utf-8")) as Stored
    if (stored.model !== embedder.model) return null
    return new KnowledgeIndex(embedder, stored.entries, stored.builtAt)
  }

  save(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const stored: Stored = { model: this.embedder.model, builtAt: this.builtAt, entries: this.entries }
    fs.writeFileSync(file, JSON.stringify(stored))
  }

  async search(query: string, opts: { k?: number; kinds?: IssueKind[]; mode?: Mode } = {}): Promise<Hit[]> {
    const { k = 5, kinds, mode = "hybrid" } = opts
    const [queryVector] = await this.embedder.embed([query])
    const similarity = this.entries.map((e) => dot(queryVector!, e.vector))
    const keyword = this.bm25.scores(query)

    const allowed = this.entries.map((e) => !kinds || kinds.includes(e.doc.kind))
    const rankOf = (scores: number[]) => {
      const order = scores.map((s, i) => ({ s, i })).filter(({ i, s }) => allowed[i] && (scores !== keyword || s > 0))
      order.sort((a, b) => b.s - a.s)
      const ranks = new Map<number, number>()
      order.forEach(({ i }, r) => ranks.set(i, r + 1))
      return ranks
    }
    const vectorRanks = rankOf(similarity)
    const keywordRanks = rankOf(keyword)

    const score = (i: number) => {
      if (mode === "vector") return similarity[i]!
      if (mode === "keyword") return keyword[i]!
      const v = vectorRanks.get(i)
      const w = keywordRanks.get(i)
      return (v ? 1 / (RRF_K + v) : 0) + (w ? 1 / (RRF_K + w) : 0)
    }

    return this.entries
      .map((e, i) => ({ doc: e.doc, similarity: similarity[i]!, score: score(i), i }))
      .filter(({ i, score }) => allowed[i] && (mode !== "keyword" || score > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ doc, similarity, score }) => ({ doc, similarity, score }))
  }
}
