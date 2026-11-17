import { AdfNode, adfToText } from "./adf.js"

export type Fetch = typeof fetch

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
}

export interface IssueLink {
  type: string
  direction: "outward" | "inward"
  key: string
  summary: string
}

export interface JiraIssue {
  key: string
  type: string
  summary: string
  status: string
  statusCategory: string
  labels: string[]
  description: string
  links: IssueLink[]
  url: string
}

// What the server reads from Jira; tests pass a fake with the same shape
export type JiraReader = Pick<JiraClient, "getIssue" | "search" | "checkAccess">

export class JiraError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

interface RawIssue {
  key: string
  fields: {
    summary: string
    issuetype: { name: string }
    status: { name: string; statusCategory?: { key: string } }
    labels?: string[]
    description?: AdfNode | null
    issuelinks?: {
      type: { name: string; outward: string; inward: string }
      outwardIssue?: { key: string; fields: { summary: string } }
      inwardIssue?: { key: string; fields: { summary: string } }
    }[]
  }
}

const FIELDS = "summary,issuetype,status,labels,description,issuelinks"

// Jira Cloud REST API v3 with an API token. fetch is injectable so tests run against a fake.
export class JiraClient {
  private readonly base: string
  private readonly auth: string

  constructor(config: JiraConfig, private readonly fetchFn: Fetch = fetch) {
    this.base = config.baseUrl.replace(/\/$/, "")
    this.auth = "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")
  }

  // With a wrong token Jira Cloud does not refuse most calls: an issue comes back 404 and a
  // search comes back empty, as for an anonymous user. /myself is the call that says 401, so
  // it tells "not found" and "no results" apart from "bad credentials". Checked once per client.
  private access: Promise<void> | undefined

  checkAccess(): Promise<void> {
    this.access ??= this.request("GET", "/myself").then(
      () => undefined,
      (e) => {
        this.access = undefined
        if (e instanceof JiraError && (e.status === 401 || e.status === 403)) {
          throw new JiraError(e.status, `Jira rejected the credentials (${e.status}). Check JIRA_EMAIL and JIRA_API_TOKEN.`)
        }
        throw e
      }
    )
    return this.access
  }

  async getIssue(key: string): Promise<JiraIssue | null> {
    try {
      return this.toIssue(await this.request<RawIssue>("GET", `/issue/${encodeURIComponent(key)}?fields=${FIELDS}`))
    } catch (e) {
      if (e instanceof JiraError && e.status === 404) return null
      throw e
    }
  }

  // Follows nextPageToken, so a corpus larger than one page is read in full
  async search(jql: string, max = 500): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = []
    let next: string | undefined
    do {
      const body: Record<string, unknown> = { jql, fields: FIELDS.split(","), maxResults: Math.min(100, max - issues.length) }
      if (next) body.nextPageToken = next
      const page = await this.request<{ issues: RawIssue[]; nextPageToken?: string }>("POST", "/search/jql", body)
      issues.push(...page.issues.map((i) => this.toIssue(i)))
      next = page.nextPageToken
    } while (next && issues.length < max)
    return issues
  }

  async createIssue(fields: Record<string, unknown>): Promise<string> {
    return (await this.request<{ key: string }>("POST", "/issue", { fields })).key
  }

  async link(type: string, outwardKey: string, inwardKey: string): Promise<void> {
    await this.request("POST", "/issueLink", { type: { name: type }, outwardIssue: { key: outwardKey }, inwardIssue: { key: inwardKey } })
  }

  // Moves the issue to the named status; returns false if the workflow has no such transition
  async transitionTo(key: string, status: string): Promise<boolean> {
    const { transitions } = await this.request<{ transitions: { id: string; to: { name: string } }[] }>("GET", `/issue/${key}/transitions`)
    const t = transitions.find((x) => x.to.name.toLowerCase() === status.toLowerCase())
    if (!t) return false
    await this.request("POST", `/issue/${key}/transitions`, { transition: { id: t.id } })
    return true
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`
  }

  private toIssue(raw: RawIssue): JiraIssue {
    const f = raw.fields
    return {
      key: raw.key,
      type: f.issuetype.name,
      summary: f.summary,
      status: f.status.name,
      statusCategory: f.status.statusCategory?.key ?? "unknown",
      labels: f.labels ?? [],
      description: adfToText(f.description),
      links: (f.issuelinks ?? []).flatMap((l): IssueLink[] => {
        if (l.outwardIssue) return [{ type: l.type.outward, direction: "outward", key: l.outwardIssue.key, summary: l.outwardIssue.fields.summary }]
        if (l.inwardIssue) return [{ type: l.type.inward, direction: "inward", key: l.inwardIssue.key, summary: l.inwardIssue.fields.summary }]
        return []
      }),
      url: this.browseUrl(raw.key),
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchFn(`${this.base}/rest/api/3${path}`, {
      method,
      headers: { Authorization: this.auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    if (!response.ok) throw new JiraError(response.status, `Jira ${method} ${path.split("?")[0]} returned ${response.status}: ${text.slice(0, 300)}`)
    return (text ? JSON.parse(text) : {}) as T
  }
}
