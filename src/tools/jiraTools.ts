import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { JiraClient, JiraIssue } from "../jira/client.js"

export type IssueKind = "story" | "test-case" | "past-defect" | "other"

export function kindOf(issue: Pick<JiraIssue, "type" | "labels">): IssueKind {
  if (issue.labels.includes("test-case")) return "test-case"
  if (issue.labels.includes("past-defect")) return "past-defect"
  if (issue.type === "Story") return "story"
  return "other"
}

// User text goes inside a JQL string literal, so quotes and backslashes are escaped
export function jqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] })
const failure = (value: string) => ({ ...text(value), isError: true })

export function formatStory(story: JiraIssue, linked: JiraIssue[]): string {
  const group = (kind: IssueKind) => linked.filter((i) => kindOf(i) === kind)
  const lines = (issues: JiraIssue[]) => (issues.length ? issues.map((i) => `- ${i.key} [${i.status}] ${i.summary}`).join("\n") : "- none")

  return [
    `# ${story.key}: ${story.summary}`,
    `Type: ${story.type} · Status: ${story.status} · ${story.url}`,
    "",
    story.description || "(no description)",
    "",
    `## Linked test cases (${group("test-case").length})`,
    lines(group("test-case")),
    "",
    `## Linked past defects (${group("past-defect").length})`,
    lines(group("past-defect")),
    ...(group("other").length || group("story").length ? ["", "## Other links", lines([...group("story"), ...group("other")])] : []),
  ].join("\n")
}

// Read-only Jira tools. Nothing here can change an issue.
export function registerJiraTools(server: McpServer, jira: Pick<JiraClient, "getIssue" | "search">, project: string): void {
  server.registerTool(
    "get_story",
    {
      title: "Get a Jira story",
      description:
        "Reads one Jira issue: summary, status, description with its acceptance criteria, and the test cases and past defects linked to it. Use it before reasoning about what a story needs tested.",
      inputSchema: { key: z.string().describe("Issue key, e.g. KAN-10") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ key }) => {
      const k = key.trim().toUpperCase()
      if (!KEY.test(k)) return failure(`"${key}" is not an issue key. Expected something like KAN-10.`)
      const story = await jira.getIssue(k)
      if (!story) return failure(`${k} was not found, or this account cannot see it.`)
      const linkedKeys = story.links.map((l) => l.key)
      const linked = linkedKeys.length ? await jira.search(`key in (${linkedKeys.join(",")})`, linkedKeys.length) : []
      return text(formatStory(story, linked))
    }
  )

  server.registerTool(
    "search_stories",
    {
      title: "Search Jira stories",
      description: `Finds stories in project ${project} by words in their summary or description, optionally by status. Returns keys, statuses and summaries; use get_story for the details.`,
      inputSchema: {
        text: z.string().optional().describe("Words to look for, e.g. \"filter reload\""),
        status: z.enum(["To Do", "In Progress", "In Review", "Done"]).optional().describe("Only stories in this status"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ text: words, status, limit }) => {
      const clauses = [`project = ${jqlString(project)}`, "issuetype = Story"]
      if (words?.trim()) clauses.push(`text ~ ${jqlString(words.trim())}`)
      if (status) clauses.push(`status = ${jqlString(status)}`)
      const stories = await jira.search(`${clauses.join(" AND ")} ORDER BY key`, limit)
      if (!stories.length) return text("No stories match.")
      return text(stories.map((s) => `- ${s.key} [${s.status}] ${s.summary}`).join("\n"))
    }
  )
}
