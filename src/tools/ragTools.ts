import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { JiraReader } from "../jira/client.js"
import { Doc } from "../rag/documents.js"
import { Hit } from "../rag/knowledgeIndex.js"
import { IndexStore } from "../rag/store.js"
import { findIssue, IssueKind } from "./jiraTools.js"

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] })
const failure = (value: string) => ({ ...text(value), isError: true })

const KIND_NAME: Record<IssueKind, string> = { story: "Story", "test-case": "Test case", "past-defect": "Past defect", other: "Issue" }

// The description without its title line, indented. Test cases and defects are short, and their
// expected result is what tells whether a criterion is really checked, so the limit is generous.
function body(doc: Doc, maxLines = 14): string {
  const lines = doc.text.split("\n").slice(1).filter((l) => l.trim())
  const shown = lines.slice(0, maxLines).map((l) => `     ${l}`)
  return [...shown, ...(lines.length > maxLines ? ["     …"] : [])].join("\n")
}

function formatHit(hit: Hit, rank: number, linkedTo?: string): string {
  const d = hit.doc
  const linked = linkedTo && d.stories.includes(linkedTo) ? ` · linked to ${linkedTo}` : ""
  return `${rank}. ${d.key} [${KIND_NAME[d.kind]} · ${d.status}${linked}] ${d.title}  (similarity ${hit.similarity.toFixed(2)})`
}

// "Acceptance criteria" bullets from a story description; the whole description when there are none
export function acceptanceCriteria(description: string): string[] {
  const lines = description.split("\n")
  const start = lines.findIndex((l) => /^acceptance criteria/i.test(l.trim()))
  if (start !== -1) {
    const items: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (/^\s*(-|\d+\.)\s+/.test(line)) items.push(line.replace(/^\s*(-|\d+\.)\s+/, "").trim())
      else if (items.length) break
    }
    if (items.length) return items
  }
  return description.trim() ? [description.trim()] : []
}

export function registerRagTools(server: McpServer, jira: JiraReader, store: IndexStore): void {
  server.registerTool(
    "search_test_assets",
    {
      title: "Search test cases, past defects and stories",
      description:
        "Semantic and keyword search over the project's test cases, past defects and stories. Finds matches by meaning, so \"page refresh\" also finds \"reload\". Use it to answer \"is this already tested?\" or \"did this break before?\".",
      inputSchema: {
        query: z.string().min(2).describe("What to look for, in plain words"),
        kind: z.enum(["any", "test-case", "past-defect", "story"]).default("any"),
        limit: z.number().int().min(1).max(10).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, kind, limit }) => {
      const index = await store.get()
      const hits = await index.search(query, { k: limit, ...(kind !== "any" ? { kinds: [kind] } : {}) })
      if (!hits.length) return text("Nothing found.")
      return text(hits.map((h, i) => `${formatHit(h, i + 1)}\n${body(h.doc)}\n     ${h.doc.url}`).join("\n"))
    }
  )

  server.registerTool(
    "check_coverage",
    {
      title: "Find tests and past defects for each acceptance criterion",
      description:
        "For each acceptance criterion of a story, finds the closest test cases and past defects in the whole project, linked or not, with their steps and expected results. It gives evidence, not a verdict: similar wording does not mean a test checks the criterion, so read the expected results before calling something covered.",
      inputSchema: {
        key: z.string().describe("Story key, e.g. KAN-10"),
        tests_per_criterion: z.number().int().min(1).max(5).default(3),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ key, tests_per_criterion }) => {
      const k = key.trim().toUpperCase()
      const story = await findIssue(jira, k)
      if ("error" in story) return failure(story.error)
      const criteria = acceptanceCriteria(story.description)
      if (!criteria.length) return failure(`${k} has no description to check against.`)
      const index = await store.get()

      const sections: string[] = [`# Coverage evidence for ${k}: ${story.summary}`, `${criteria.length} acceptance criteria · index of ${index.size} issues built ${index.builtAt}`]
      // An issue often matches several criteria; its details are printed once, then referred to
      const shown = new Set<string>()
      const entry = (h: Hit, rank: number) => {
        const head = formatHit(h, rank, k)
        if (shown.has(h.doc.key)) return `${head}\n     (details above)`
        shown.add(h.doc.key)
        return `${head}\n${body(h.doc)}`
      }
      for (const [i, criterion] of criteria.entries()) {
        const tests = await index.search(criterion, { k: tests_per_criterion, kinds: ["test-case"] })
        const defects = (await index.search(criterion, { k: 2, kinds: ["past-defect"] })).filter((h) => h.similarity >= 0.3)
        sections.push(
          "",
          `## AC${i + 1}: ${criterion}`,
          "Closest test cases:",
          ...tests.map((h, r) => entry(h, r + 1)),
          defects.length ? "Related past defects:" : "Related past defects: none close",
          ...defects.map((h, r) => entry(h, r + 1))
        )
      }
      return text(sections.join("\n"))
    }
  )

  server.registerTool(
    "refresh_index",
    {
      title: "Re-read Jira into the search index",
      description: "Rebuilds the search index from Jira after issues were added or changed. Only changed issues are embedded again. Writes a local cache file; changes nothing in Jira.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const index = await store.refresh()
      const count = (kind: IssueKind) => index.docs.filter((d) => d.kind === kind).length
      return text(`Index rebuilt: ${index.size} issues (${count("story")} stories, ${count("test-case")} test cases, ${count("past-defect")} past defects).`)
    }
  )
}
