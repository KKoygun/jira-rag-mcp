import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { JiraReader } from "./jira/client.js"
import { IndexStore } from "./rag/store.js"
import { registerJiraTools } from "./tools/jiraTools.js"
import { registerRagTools } from "./tools/ragTools.js"

export interface ServerDeps {
  jira: JiraReader
  project: string
  store: IndexStore
}

// Builds the server without a transport, so tests can connect a client in memory
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "jira-rag-mcp", version: "0.1.0" })
  registerJiraTools(server, deps.jira, deps.project)
  registerRagTools(server, deps.jira, deps.store)

  server.registerPrompt(
    "gap_analysis",
    {
      title: "Test gap analysis for a story",
      description: "Checks each acceptance criterion of a story against existing test cases and past defects, and drafts the missing tests.",
      argsSchema: { key: z.string().describe("Story key, e.g. KAN-10") },
    },
    ({ key }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Do a test gap analysis for ${key}.`,
              `1. Call get_story for ${key}, then check_coverage for ${key}.`,
              "2. For each acceptance criterion, decide from the test steps and expected results, not from the similarity score, whether a test really checks it: covered, partly covered or not covered.",
              "3. Point out criteria that a past defect already broke but no test guards; those are the riskiest gaps.",
              "4. Answer with a table (criterion · verdict · evidence by issue key), then draft the missing test cases with steps and expected results.",
              "5. If a browser tool such as Playwright MCP is available, offer to check one uncovered criterion against the running app.",
            ].join("\n"),
          },
        },
      ],
    })
  )

  return server
}
