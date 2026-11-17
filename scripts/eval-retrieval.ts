// Measures retrieval on the seed corpus, offline: no Jira, no API key.
//   npm run eval:retrieval                      table for hybrid, vector-only and keyword-only
//   npm run eval:retrieval -- --min-recall=0.9  exit 1 if hybrid recall@5 is below 0.9 (CI)
import fs from "node:fs"
import path from "node:path"
import { seedDocs } from "../src/rag/documents.js"
import { PROJECT_ROOT } from "../src/paths.js"
import { LocalEmbedder } from "../src/rag/embedder.js"
import { evaluate, Question } from "../src/rag/evaluate.js"
import { KnowledgeIndex, Mode } from "../src/rag/knowledgeIndex.js"

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5)

async function main(): Promise<void> {
  const { questions } = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "evals/retrieval/questions.json"), "utf-8")) as { questions: Question[] }
  const embedder = new LocalEmbedder()
  // plain is what the server uses; contextual is kept as a measured alternative
  const index = await KnowledgeIndex.build(seedDocs(), embedder)
  const contextual = await KnowledgeIndex.build(seedDocs({ contextual: true }), embedder)
  console.log(`Retrieval eval · ${questions.length} questions · ${index.size} documents\n`)
  console.log("documents   mode     recall@1 recall@3 recall@5   MRR")

  const results = []
  for (const [label, idx] of [["plain", index], ["contextual", contextual]] as const) {
    for (const mode of ["hybrid", "vector", "keyword"] as Mode[]) {
      const r = await evaluate(idx, questions, mode)
      if (label === "plain") results.push(r)
      console.log(`${label.padEnd(11)} ${mode.padEnd(8)}   ${pct(r.recall[1])}    ${pct(r.recall[3])}    ${pct(r.recall[5])}   ${r.mrr.toFixed(2)}`)
    }
  }

  const hybrid = results[0]!
  if (hybrid.misses.length) {
    console.log(`\nHybrid: not all expected issues in the top 3`)
    for (const m of hybrid.misses) console.log(`  "${m.q}"  expected ${m.expected.join(",")}  got ${m.got.join(",")}`)
  }

  const minArg = process.argv.find((a) => a.startsWith("--min-recall="))
  if (minArg) {
    const min = Number(minArg.split("=")[1])
    if (hybrid.recall[5] < min) {
      console.error(`\nHybrid recall@5 ${pct(hybrid.recall[5]).trim()} is below ${pct(min).trim()}`)
      process.exit(1)
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
