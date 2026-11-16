// Okapi BM25 keyword scoring. It catches exact terms a small embedding model can blur
// ("Escape", "#/active", "localStorage"); the vector side catches the paraphrases.

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were when with which who will".split(" ")
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}#/]+/u)
    .map((t) => t.replace(/^[#/]+|[#/]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

export class Bm25 {
  private readonly docs: Map<string, number>[]
  private readonly lengths: number[]
  private readonly df = new Map<string, number>()
  private readonly avgLength: number

  constructor(texts: string[], private readonly k1 = 1.2, private readonly b = 0.75) {
    this.docs = texts.map((t) => {
      const tf = new Map<string, number>()
      for (const token of tokenize(t)) tf.set(token, (tf.get(token) ?? 0) + 1)
      return tf
    })
    this.lengths = this.docs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0))
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length)
    for (const tf of this.docs) for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1)
  }

  scores(query: string): number[] {
    const n = this.docs.length
    const terms = [...new Set(tokenize(query))]
    return this.docs.map((tf, i) => {
      let score = 0
      for (const term of terms) {
        const f = tf.get(term)
        if (!f) continue
        const df = this.df.get(term) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[i]!) / this.avgLength))
      }
      return score
    })
  }
}
