import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { JiraIssue } from "../src/jira/client.js"
import { createServer } from "../src/server.js"
import { jqlString } from "../src/tools/jiraTools.js"

const issue = (key: string, over: Partial<JiraIssue> = {}): JiraIssue => ({
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

// A Jira that answers from memory and records the JQL it was asked
function fakeJira(issues: JiraIssue[]) {
  const queries: string[] = []
  return {
    queries,
    async getIssue(key: string) {
      return issues.find((i) => i.key === key) ?? null
    },
    async search(jql: string, max = 500) {
      queries.push(jql)
      const keys = jql.match(/key in \(([^)]*)\)/)?.[1]?.split(",")
      return (keys ? issues.filter((i) => keys.includes(i.key)) : issues.filter((i) => i.type === "Story")).slice(0, max)
    },
  }
}

const STORY = issue("KAN-10", {
  summary: "Edit a todo inline",
  description: "Acceptance criteria\n- Escape cancels the edit",
  links: [
    { type: "relates to", direction: "inward", key: "KAN-11", summary: "Test: Double-click opens the edit field" },
    { type: "relates to", direction: "inward", key: "KAN-13", summary: "Escape kept the half-typed text" },
  ],
})
const LINKED = [
  issue("KAN-11", { type: "Task", labels: ["rag-demo", "test-case"], summary: "Test: Double-click opens the edit field" }),
  issue("KAN-13", { type: "Bug", labels: ["rag-demo", "past-defect"], summary: "Escape kept the half-typed text" }),
]

let client: Client | undefined

async function connect(jira = fakeJira([STORY, ...LINKED])) {
  const server = createServer({ jira, project: "KAN" })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
  return { client, jira }
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n")

afterEach(async () => {
  await client?.close()
  client = undefined
})

describe("tool list", () => {
  it("offers the Jira tools as read-only, with their input schemas", async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    expect(Object.keys(byName).sort()).toEqual(["get_story", "search_stories"])
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true)
    expect(byName.get_story!.inputSchema.required).toEqual(["key"])
    expect(byName.search_stories!.inputSchema.properties).toHaveProperty("status")
  })
})

describe("get_story", () => {
  it("returns the acceptance criteria and groups linked issues into test cases and past defects", async () => {
    const { client } = await connect()
    const out = textOf(await client.callTool({ name: "get_story", arguments: { key: "kan-10" } }))

    expect(out).toContain("# KAN-10: Edit a todo inline")
    expect(out).toContain("- Escape cancels the edit")
    expect(out).toMatch(/## Linked test cases \(1\)\n- KAN-11 \[Done\] Test: Double-click/)
    expect(out).toMatch(/## Linked past defects \(1\)\n- KAN-13 \[Done\] Escape kept/)
  })

  it("reports a malformed key and a missing issue as tool errors, not crashes", async () => {
    const { client } = await connect()
    const bad = await client.callTool({ name: "get_story", arguments: { key: "edit todo" } })
    const missing = await client.callTool({ name: "get_story", arguments: { key: "KAN-999" } })

    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toMatch(/not an issue key/)
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toMatch(/KAN-999 was not found/)
  })

  it("rejects arguments that do not match the schema", async () => {
    const { client } = await connect()
    const result = await client.callTool({ name: "get_story", arguments: { key: 10 } }).catch((e: Error) => e)
    const message = result instanceof Error ? result.message : textOf(result)
    expect(message).toMatch(/key/i)
    if (!(result instanceof Error)) expect(result.isError).toBe(true)
  })
})

describe("search_stories", () => {
  it("builds the JQL from the words and status, scoped to the project's stories", async () => {
    const { client, jira } = await connect()
    const out = textOf(await client.callTool({ name: "search_stories", arguments: { text: "edit", status: "Done" } }))

    expect(jira.queries[0]).toBe('project = "KAN" AND issuetype = Story AND text ~ "edit" AND status = "Done" ORDER BY key')
    expect(out).toContain("- KAN-10 [Done] Edit a todo inline")
  })

  it("says so when nothing matches", async () => {
    const { client } = await connect(fakeJira([]))
    expect(textOf(await client.callTool({ name: "search_stories", arguments: {} }))).toBe("No stories match.")
  })
})

describe("jqlString", () => {
  it("escapes quotes and backslashes so user text cannot break out of the JQL string", () => {
    expect(jqlString('a" OR project = X')).toBe('"a\\" OR project = X"')
    expect(jqlString("back\\slash")).toBe('"back\\\\slash"')
  })
})
