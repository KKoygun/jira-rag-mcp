import { IssueKind } from "../tools/jiraTools.js"
import { KnowledgeIndex, Mode } from "./knowledgeIndex.js"

export interface Question {
  q: string
  kind?: IssueKind
  expected: string[]
}

export interface ModeResult {
  mode: Mode
  // share of expected issues found in the top k, averaged over questions
  recall: Record<1 | 3 | 5, number>
  // mean reciprocal rank of the first expected issue
  mrr: number
  misses: { q: string; expected: string[]; got: string[] }[]
}

export async function evaluate(index: KnowledgeIndex, questions: Question[], mode: Mode): Promise<ModeResult> {
  const recall = { 1: 0, 3: 0, 5: 0 }
  let mrr = 0
  const misses: ModeResult["misses"] = []

  for (const question of questions) {
    const hits = await index.search(question.q, { k: 5, mode, ...(question.kind ? { kinds: [question.kind] } : {}) })
    const got = hits.map((h) => h.doc.seedId ?? h.doc.key)
    for (const k of [1, 3, 5] as const) {
      const top = new Set(got.slice(0, k))
      recall[k] += question.expected.filter((e) => top.has(e)).length / Math.min(question.expected.length, k)
    }
    const first = got.findIndex((g) => question.expected.includes(g))
    mrr += first === -1 ? 0 : 1 / (first + 1)
    if (!question.expected.every((e) => got.slice(0, 3).includes(e))) misses.push({ q: question.q, expected: question.expected, got: got.slice(0, 3) })
  }

  const n = questions.length
  return { mode, recall: { 1: recall[1] / n, 3: recall[3] / n, 5: recall[5] / n }, mrr: mrr / n, misses }
}
