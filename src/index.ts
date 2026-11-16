#!/usr/bin/env node
// stdio entry point for MCP clients (Claude Code, Claude Desktop, Cursor).
// stdout carries the protocol, so nothing else may print there: logs go to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import dotenv from "dotenv"
import { loadConfig } from "./config.js"
import { JiraClient } from "./jira/client.js"
import { createServer } from "./server.js"

async function main(): Promise<void> {
  dotenv.config({ quiet: true })
  const config = loadConfig()
  const server = createServer({ jira: new JiraClient(config.jira), project: config.project })
  await server.connect(new StdioServerTransport())
  console.error(`jira-rag-mcp ready · ${config.jira.baseUrl} · project ${config.project}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
