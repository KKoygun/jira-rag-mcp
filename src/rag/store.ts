import path from "node:path"
import { JiraClient } from "../jira/client.js"
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
    private readonly jira: Pick<JiraClient, "search">,
    private readonly jql: string,
    private readonly embedder: Embedder,
    private readonly file: string | null = DEFAULT_INDEX_FILE
  ) {}

  get(): Promise<KnowledgeIndex> {
    this.current ??= (async () => {
      const saved = this.file ? KnowledgeIndex.load(this.file, this.embedder) : null
      return saved ?? this.rebuild()
    })()
    // A failed build should not stick: the next call tries again
    this.current.catch(() => (this.current = undefined))
    return this.current
  }

  async refresh(): Promise<KnowledgeIndex> {
    const previous = await this.current?.catch(() => undefined)
    this.current = this.rebuild(previous)
    return this.current
  }

  private async rebuild(previous?: KnowledgeIndex): Promise<KnowledgeIndex> {
    const issues = await this.jira.search(this.jql)
    const index = await KnowledgeIndex.build(docsFromIssues(issues), this.embedder, previous)
    if (this.file) index.save(this.file)
    return index
  }
}
