// Seeds the TodoMVC demo (seed/todomvc.ts) into a Jira project: stories, test cases as Tasks
// labelled test-case, and past defects as Bugs labelled past-defect, each linked to its story.
//   npm run seed:jira              create what is missing (safe to run again)
//   npm run seed:jira -- --dry-run print the plan, call nothing
import "dotenv/config"
import { loadConfig } from "../src/config.js"
import { toAdf } from "../src/jira/adf.js"
import { JiraClient } from "../src/jira/client.js"
import { plan } from "../seed/plan.js"

async function main(): Promise<void> {
  const items = plan()
  const counts = { Story: 0, Task: 0, Bug: 0 }
  for (const i of items) counts[i.type]++
  console.log(`Seed plan: ${counts.Story} stories, ${counts.Task} test cases, ${counts.Bug} past defects\n`)

  if (process.argv.includes("--dry-run")) {
    for (const i of items) console.log(`  ${i.seedId.padEnd(5)} ${i.type.padEnd(5)} ${i.status.padEnd(6)} ${i.summary}`)
    return
  }

  const config = loadConfig()
  const jira = new JiraClient(config.jira)
  const keys = new Map<string, string>()
  let created = 0

  for (const item of items) {
    const [existing] = await jira.search(`project = "${config.project}" AND labels = "seed-${item.seedId}"`, 1)
    let key = existing?.key
    if (!key) {
      key = await jira.createIssue({
        project: { key: config.project },
        issuetype: { name: item.type },
        summary: item.summary,
        labels: item.labels,
        description: toAdf(item.description),
      })
      created++
    }
    keys.set(item.seedId, key)

    if (item.storySeedId) {
      const storyKey = keys.get(item.storySeedId)!
      const alreadyLinked = existing?.links.some((l) => l.key === storyKey)
      if (!alreadyLinked) await jira.link("Relates", key, storyKey)
    }

    if (!existing || existing.status.toLowerCase() !== item.status.toLowerCase()) {
      if (item.status !== "To Do" && !(await jira.transitionTo(key, item.status))) {
        console.warn(`  ! ${key}: no transition to "${item.status}" in this workflow`)
      }
    }
    console.log(`  ${existing ? "exists " : "created"} ${key.padEnd(7)} ${item.type.padEnd(5)} ${item.summary}`)
  }

  console.log(`\n${created} created, ${items.length - created} already there. Browse: ${jira.browseUrl(keys.get("s01")!)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
