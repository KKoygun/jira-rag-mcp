import { z } from "zod"
import { JiraConfig } from "./jira/client.js"

const Schema = z.object({
  JIRA_BASE_URL: z.string().url("JIRA_BASE_URL must be a URL, e.g. https://acme.atlassian.net"),
  JIRA_EMAIL: z.string().email("JIRA_EMAIL must be the account's email address"),
  JIRA_API_TOKEN: z.string().min(1, "JIRA_API_TOKEN is required (id.atlassian.com → Security → API tokens)"),
  JIRA_PROJECT: z.string().min(1).default("KAN"),
})

export interface Config {
  jira: JiraConfig
  project: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${String(i.path[0])}: ${i.message}`).join("\n")
    throw new Error(`jira-rag-mcp configuration error:\n${problems}`)
  }
  const e = parsed.data
  return { jira: { baseUrl: e.JIRA_BASE_URL, email: e.JIRA_EMAIL, apiToken: e.JIRA_API_TOKEN }, project: e.JIRA_PROJECT }
}
