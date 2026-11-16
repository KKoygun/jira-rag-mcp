import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { JiraClient } from "./jira/client.js"
import { registerJiraTools } from "./tools/jiraTools.js"

export interface ServerDeps {
  jira: Pick<JiraClient, "getIssue" | "search">
  project: string
}

// Builds the server without a transport, so tests can connect a client in memory
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "jira-rag-mcp", version: "0.1.0" })
  registerJiraTools(server, deps.jira, deps.project)
  return server
}
