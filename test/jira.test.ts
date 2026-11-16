import { describe, expect, it } from "vitest"
import { adfToText, toAdf } from "../src/jira/adf.js"
import { JiraClient, JiraError } from "../src/jira/client.js"
import { plan } from "../scripts/seed-jira.js"
import { STORIES } from "../seed/todomvc.js"

interface Call {
  method: string
  url: string
  body: any
  auth: string | undefined
}

// Stands in for fetch: answers each call with the next scripted reply and records the request
function fakeFetch(...replies: { status?: number; body: unknown }[]) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization })
    const reply = replies.shift() ?? { status: 500, body: { error: "no scripted reply" } }
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body), { status }) // 204 must have no body
  }) as typeof fetch
  return { fn, calls }
}

const config = { baseUrl: "https://acme.atlassian.net/", email: "qa@example.com", apiToken: "token" }

const rawIssue = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  fields: { summary: `Summary ${key}`, issuetype: { name: "Story" }, status: { name: "Done", statusCategory: { key: "done" } }, labels: ["rag-demo"], ...extra },
})

describe("ADF", () => {
  it("round-trips headings, paragraphs and both list kinds to readable text", () => {
    const doc = toAdf([
      { paragraph: "As a user I want things." },
      { heading: "Acceptance criteria", bullets: ["First rule", "Second rule"] },
      { heading: "Steps", numbered: ["Open the app", "Press Enter"] },
    ])
    expect(adfToText(doc)).toBe(
      ["As a user I want things.", "Acceptance criteria", "- First rule", "- Second rule", "Steps", "1. Open the app", "2. Press Enter"].join("\n")
    )
  })

  it("puts version on the root doc node, where Jira expects it", () => {
    expect(toAdf([{ paragraph: "x" }])).toMatchObject({ version: 1, type: "doc" })
    expect(toAdf([{ paragraph: "x" }])).not.toHaveProperty("attrs")
  })

  it("returns an empty string for a missing description", () => {
    expect(adfToText(null)).toBe("")
  })
})

describe("JiraClient", () => {
  it("reads an issue with its description as text and its links in both directions", async () => {
    const { fn, calls } = fakeFetch({
      body: rawIssue("KAN-4", {
        description: toAdf([{ heading: "Acceptance criteria", bullets: ["Enter adds the item"] }]),
        issuelinks: [
          { type: { name: "Relates", outward: "relates to", inward: "relates to" }, outwardIssue: { key: "KAN-5", fields: { summary: "Test A" } } },
          { type: { name: "Blocks", outward: "blocks", inward: "is blocked by" }, inwardIssue: { key: "KAN-9", fields: { summary: "Bug B" } } },
        ],
      }),
    })
    const issue = await new JiraClient(config, fn).getIssue("KAN-4")

    expect(issue).toMatchObject({
      key: "KAN-4",
      status: "Done",
      statusCategory: "done",
      description: "Acceptance criteria\n- Enter adds the item",
      url: "https://acme.atlassian.net/browse/KAN-4",
      links: [
        { type: "relates to", direction: "outward", key: "KAN-5", summary: "Test A" },
        { type: "is blocked by", direction: "inward", key: "KAN-9", summary: "Bug B" },
      ],
    })
    expect(calls[0]!.url).toMatch(/^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/issue\/KAN-4\?fields=/)
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("qa@example.com:token").toString("base64")}`)
  })

  it("returns null for a missing issue but throws on an auth failure", async () => {
    expect(await new JiraClient(config, fakeFetch({ status: 404, body: {} }).fn).getIssue("KAN-404")).toBeNull()
    await expect(new JiraClient(config, fakeFetch({ status: 401, body: {} }).fn).getIssue("KAN-1")).rejects.toThrow(JiraError)
  })

  it("follows nextPageToken until every page is read", async () => {
    const { fn, calls } = fakeFetch(
      { body: { issues: [rawIssue("KAN-4"), rawIssue("KAN-5")], nextPageToken: "p2" } },
      { body: { issues: [rawIssue("KAN-6")] } }
    )
    const issues = await new JiraClient(config, fn).search("labels = rag-demo")

    expect(issues.map((i) => i.key)).toEqual(["KAN-4", "KAN-5", "KAN-6"])
    expect(calls).toHaveLength(2)
    expect(calls[1]!.body).toMatchObject({ jql: "labels = rag-demo", nextPageToken: "p2" })
  })

  it("transitions by target status name and reports when the workflow has none", async () => {
    const transitions = { transitions: [{ id: "31", to: { name: "Done" } }] }
    const { fn, calls } = fakeFetch({ body: transitions }, { status: 204, body: {} }, { body: transitions })
    const jira = new JiraClient(config, fn)

    expect(await jira.transitionTo("KAN-4", "done")).toBe(true)
    expect(calls[1]!.body).toEqual({ transition: { id: "31" } })
    expect(await jira.transitionTo("KAN-4", "Reopened")).toBe(false)
  })
})

describe("seed plan", () => {
  const items = plan()

  it("gives every item a unique seed label so re-runs find it instead of duplicating", () => {
    const seedLabels = items.map((i) => i.labels.find((l) => l.startsWith("seed-")))
    expect(new Set(seedLabels).size).toBe(items.length)
  })

  it("links every test case and defect to a story that exists", () => {
    const storyIds = new Set(STORIES.map((s) => s.id))
    for (const i of items.filter((i) => i.type !== "Story")) expect(storyIds).toContain(i.storySeedId)
  })

  it("keeps the deliberate gaps the RAG demo relies on", () => {
    const byId = Object.fromEntries(STORIES.map((s) => [s.id, s]))
    expect(byId.s09!.tests).toHaveLength(0) // new story, nothing covers it
    expect(byId.s02!.tests.some((t) => /escape/i.test(t.summary + t.steps.join()))).toBe(false) // Escape untested, d02 hit it
  })
})
