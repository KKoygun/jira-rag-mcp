import { toAdf, adfToText } from "../jira/adf.js"
import { JiraIssue } from "../jira/client.js"
import { IssueKind, kindOf } from "../tools/jiraTools.js"
import { plan } from "../../seed/plan.js"

// One searchable unit per Jira issue. Issues here are short, so splitting them further
// would only cut acceptance criteria away from the story they belong to.
export interface Doc {
  key: string
  kind: IssueKind
  title: string
  status: string
  url: string
  // Stories this test case or defect is linked to, by key
  stories: string[]
  // seed-<id> label when the issue came from the demo seed; the eval matches on it
  seedId?: string
  text: string
}

const KIND_LABEL: Record<IssueKind, string> = { story: "Story", "test-case": "Test case", "past-defect": "Past defect", other: "Issue" }

// contextual: a test case or defect also carries the titles of the stories it is linked to
// ("contextual retrieval"). Off by default: on the seed corpus it moved recall@5 up and
// recall@3 down by one question each, so it did not earn its place. npm run eval:retrieval
// still measures both.
export function docsFromIssues(issues: JiraIssue[], { contextual = false } = {}): Doc[] {
  const stories = new Map(issues.filter((i) => kindOf(i) === "story").map((i) => [i.key, i.summary]))

  return issues.map((issue) => {
    const kind = kindOf(issue)
    const seed = issue.labels.find((l) => l.startsWith("seed-"))
    const linkedStories = kind === "story" ? [] : issue.links.map((l) => l.key).filter((k) => stories.has(k))
    const context = contextual ? linkedStories.map((k) => `Story: ${stories.get(k)}\n`).join("") : ""
    return {
      key: issue.key,
      kind,
      title: issue.summary,
      status: issue.status,
      url: issue.url,
      stories: linkedStories,
      ...(seed ? { seedId: seed.slice("seed-".length) } : {}),
      // The kind and title lead, so a query like "test for ..." can match on them too
      text: `${context}${KIND_LABEL[kind]}: ${issue.summary}\n${issue.description}`.trim(),
    }
  })
}

// The demo corpus straight from seed/todomvc.ts, shaped the way Jira returns it, links included.
// The retrieval eval and CI use it, so they run offline and give the same result every time.
export function seedIssues(): JiraIssue[] {
  return plan().map((item) => ({
    key: item.seedId.toUpperCase(),
    type: item.type,
    summary: item.summary,
    status: item.status,
    statusCategory: item.status === "Done" ? "done" : "new",
    labels: item.labels,
    description: adfToText(toAdf(item.description)),
    links: item.storySeedId ? [{ type: "relates to", direction: "outward", key: item.storySeedId.toUpperCase(), summary: "" }] : [],
    url: "",
  }))
}

export function seedDocs(opts: { contextual?: boolean } = {}): Doc[] {
  return docsFromIssues(seedIssues(), opts)
}
