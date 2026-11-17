import { JiraError, JiraIssue } from "../src/jira/client.js"
import { tokenize } from "../src/rag/bm25.js"
import { Embedder } from "../src/rag/embedder.js"

// Deterministic stand-in for the model: each token hashed into one of 64 buckets, normalised.
// Shared words give similar vectors, which is all the unit tests need; the real model is
// measured by npm run eval:retrieval instead.
export class FakeEmbedder implements Embedder {
  readonly model = "fake-bag-of-words"
  calls = 0
  embedded = 0

  async embed(texts: string[]): Promise<number[][]> {
    this.calls++
    this.embedded += texts.length
    return texts.map((t) => {
      const v = new Array<number>(64).fill(0)
      for (const token of tokenize(t)) {
        let h = 0
        for (const c of token) h = (h * 31 + c.charCodeAt(0)) >>> 0
        v[h % 64]! += 1
      }
      const norm = Math.hypot(...v) || 1
      return v.map((x) => x / norm)
    })
  }
}

export const issue = (key: string, over: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  type: "Story",
  summary: `Summary ${key}`,
  status: "Done",
  statusCategory: "done",
  labels: ["rag-demo"],
  description: "",
  links: [],
  url: `https://acme.atlassian.net/browse/${key}`,
  ...over,
})

// A Jira that answers from memory and records the JQL it was asked. Set authorized to false to
// get what real Jira Cloud does with a wrong token: issues "not found", searches empty, and a
// 401 only from the credentials check.
export function fakeJira(issues: JiraIssue[]) {
  const queries: string[] = []
  const fake = {
    queries,
    authorized: true,
    async getIssue(key: string) {
      return (fake.authorized && issues.find((i) => i.key === key)) || null
    },
    async search(jql: string, max = 500) {
      queries.push(jql)
      if (!fake.authorized) return []
      const keys = jql.match(/key in \(([^)]*)\)/)?.[1]?.split(",")
      if (keys) return issues.filter((i) => keys.includes(i.key)).slice(0, max)
      if (jql.includes("issuetype = Story")) return issues.filter((i) => i.type === "Story").slice(0, max)
      return issues.slice(0, max)
    },
    async checkAccess() {
      if (!fake.authorized) throw new JiraError(401, "Jira rejected the credentials (401). Check JIRA_EMAIL and JIRA_API_TOKEN.")
    },
  }
  return fake
}
