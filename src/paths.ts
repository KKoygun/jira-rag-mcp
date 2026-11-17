import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// MCP clients (IntelliJ, Claude Desktop, Cursor) start the server from their own working
// directory, so .env and the index are found from this file's location instead: the nearest
// folder with a package.json, which works from src/ (tsx) and from dist/ (built).
function findRoot(start: string): string {
  let dir = start
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
  return dir
}

export const PROJECT_ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)))
