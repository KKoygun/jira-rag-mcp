import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { JiraIssue } from "../src/jira/client.js"
import { seedIssues } from "../src/rag/documents.js"
import { IndexStore } from "../src/rag/store.js"
import { createServer } from "../src/server.js"
import { jqlString } from "../src/tools/jiraTools.js"
import { FakeEmbedder, fakeJira, issue } from "./fakes.js"

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

async function connect(issues: JiraIssue[] = [STORY, ...LINKED]) {
  const jira = fakeJira(issues)
  const embedder = new FakeEmbedder()
  const store = new IndexStore(jira, "corpus", embedder, null)
  const server = createServer({ jira, project: "KAN", store })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
  return { client, jira, embedder }
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n")

afterEach(async () => {
  await client?.close()
  client = undefined
})

describe("tool list", () => {
  it("offers the Jira and RAG tools, all read-only, with their input schemas", async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    expect(Object.keys(byName).sort()).toEqual(["check_coverage", "get_story", "refresh_index", "search_stories", "search_test_assets"])
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true)
    expect(byName.get_story!.inputSchema.required).toEqual(["key"])
    expect(byName.search_test_assets!.inputSchema.required).toEqual(["query"])
  })

  it("offers the gap_analysis prompt, which points the assistant at both kinds of tool", async () => {
    const { client } = await connect()
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["gap_analysis"])
    const { messages } = await client.getPrompt({ name: "gap_analysis", arguments: { key: "KAN-10" } })
    const text = (messages[0]!.content as { text: string }).text
    expect(text).toContain("get_story for KAN-10")
    expect(text).toContain("check_coverage for KAN-10")
    expect(text).toMatch(/not from the similarity score/)
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
    const { client } = await connect([])
    expect(textOf(await client.callTool({ name: "search_stories", arguments: {} }))).toBe("No stories match.")
  })
})

describe("search_test_assets", () => {
  it("finds a test case with its steps and keeps to the requested kind", async () => {
    const { client } = await connect(seedIssues())
    const out = textOf(await client.callTool({ name: "search_test_assets", arguments: { query: "clear completed button hidden", kind: "test-case", limit: 3 } }))

    expect(out.split("\n")[0]).toMatch(/^1\. TC15 \[Test case · Done\] Test: Clear completed button is not shown/)
    expect(out).toContain("Expected result")
    expect(out).not.toMatch(/Past defect|\[Story/)
  })

  it("builds the index once and reuses it for later calls", async () => {
    const { client, embedder } = await connect(seedIssues())
    await client.callTool({ name: "search_test_assets", arguments: { query: "counter" } })
    const afterFirst = embedder.embedded
    await client.callTool({ name: "search_test_assets", arguments: { query: "filter" } })
    expect(afterFirst).toBe(35 + 1) // the corpus once, then the query
    expect(embedder.embedded).toBe(afterFirst + 1) // only the new query
  })
})

describe("check_coverage", () => {
  it("lists every acceptance criterion with candidate tests and related past defects, marking linked ones", async () => {
    const { client } = await connect(seedIssues())
    const out = textOf(await client.callTool({ name: "check_coverage", arguments: { key: "S06" } }))

    expect(out).toContain("# Coverage evidence for S06: Clear completed todos")
    expect(out.match(/^## AC\d/gm)).toHaveLength(3)
    expect(out).toMatch(/## AC3: The button is hidden while no item is completed\nClosest test cases:\n1\. TC15 \[Test case · Done · linked to S06\]/)
    expect(out).toMatch(/D06 \[Past defect · Done · linked to S06\] Clear completed button visible/)
  })

  it("prints an issue's details once, even when it matches several criteria", async () => {
    const { client } = await connect(seedIssues())
    const out = textOf(await client.callTool({ name: "check_coverage", arguments: { key: "S02" } }))
    const d02Lines = out.split("\n").filter((l) => /\bD02 \[Past defect/.test(l))
    expect(d02Lines.length).toBeGreaterThan(1)
    expect(out.match(/Escape left edit mode, which fired blur/g)).toHaveLength(1)
    expect(out).toContain("(details above)")
  })

  it("errors on a story that does not exist", async () => {
    const { client } = await connect(seedIssues())
    const result = await client.callTool({ name: "check_coverage", arguments: { key: "S99" } })
    expect(result.isError).toBe(true)
  })
})

describe("refresh_index", () => {
  it("re-reads Jira and re-embeds only what changed", async () => {
    const issues = seedIssues()
    const { client, embedder } = await connect(issues)
    await client.callTool({ name: "search_test_assets", arguments: { query: "counter" } })
    const before = embedder.embedded

    issues.find((i) => i.key === "TC17")!.summary = "Test: Footer says 1 item left for a single open todo"
    const out = textOf(await client.callTool({ name: "refresh_index", arguments: {} }))

    expect(out).toBe("Index rebuilt: 35 issues (9 stories, 18 test cases, 8 past defects).")
    expect(embedder.embedded).toBe(before + 1)
  })
})

describe("jqlString", () => {
  it("escapes quotes and backslashes so user text cannot break out of the JQL string", () => {
    expect(jqlString('a" OR project = X')).toBe('"a\\" OR project = X"')
    expect(jqlString("back\\slash")).toBe('"back\\\\slash"')
  })
})
