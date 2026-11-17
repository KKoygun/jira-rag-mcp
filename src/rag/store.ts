import path from "node:path"
import { JiraReader } from "../jira/client.js"
import { docsFromIssues } from "./documents.js"
import { PROJECT_ROOT } from "../paths.js"
import { Embedder } from "./embedder.js"
import { KnowledgeIndex } from "./knowledgeIndex.js"

export const DEFAULT_INDEX_FILE = path.join(PROJECT_ROOT, ".index", "index.json")

// Stories plus anything labelled as a test case or past defect
export function defaultJql(project: string): string {
  return `project = "${project}" AND (issuetype = Story OR labels in ("test-case", "past-defect")) ORDER BY key`
}

// Keeps one index per server: read from disk if there is one, otherwise built from Jira on
// first use. refresh() re-reads Jira and re-embeds only the issues whose text changed.
export class IndexStore {
  private current: Promise<KnowledgeIndex> | undefined

  constructor(
    private readonly jira: Pick<JiraReader, "search" | "checkAccess">,
    private readonly jql: string,
    private readonly embedder: Embedder,
    private readonly file: string | null = DEFAULT_INDEX_FILE
  ) {}

  get(): Promise<KnowledgeIndex> {
    this.current ??= (async () => {
      const saved = this.file ? KnowledgeIndex.load(this.file, this.embedder) : null
      // An empty saved index is treated as missing, so it gets rebuilt
      return saved?.size ? saved : this.rebuild()
    })()
    // A failed build should not stick: the next call tries again
    this.current.catch(() => (this.current = undefined))
    return this.current
  }

  // On failure the index in use stays as it was, so searches keep working
  async refresh(): Promise<KnowledgeIndex> {
    const previous = await this.current?.catch(() => undefined)
    try {
      const index = await this.rebuild(previous)
      this.current = Promise.resolve(index)
      return index
    } catch (e) {
      this.current = previous ? Promise.resolve(previous) : undefined
      throw e
    }
  }

  // A wrong token gives an empty search rather than an error, so the credentials are checked
  // first, and an empty result never replaces an index: it is reported and the old one is kept.
  private async rebuild(previous?: KnowledgeIndex): Promise<KnowledgeIndex> {
    await this.jira.checkAccess()
    const issues = await this.jira.search(this.jql)
    if (!issues.length) {
      throw new Error(`Jira returned no issues for: ${this.jql}
Check JIRA_PROJECT and RAG_JQL.${previous ? " The existing index was kept." : ""}`)
    }
    const index = await KnowledgeIndex.build(docsFromIssues(issues), this.embedder, previous)
    if (this.file) index.save(this.file)
    return index
  }
}
