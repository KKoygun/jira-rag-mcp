// Seeds the TodoMVC demo (seed/todomvc.ts) into a Jira project: stories, test cases as Tasks
// labelled test-case, and past defects as Bugs labelled past-defect, each linked to its story.
//   npm run seed:jira              create what is missing (safe to run again)
//   npm run seed:jira -- --dry-run print the plan, call nothing
import "dotenv/config"
import { loadConfig } from "../src/config.js"
import { Section, toAdf } from "../src/jira/adf.js"
import { JiraClient } from "../src/jira/client.js"
import { STORIES, SeedDefect, SeedStory, SeedTest } from "../seed/todomvc.js"

interface Planned {
  seedId: string
  type: "Story" | "Task" | "Bug"
  summary: string
  labels: string[]
  status: string
  description: Section[]
  storySeedId?: string
}

function storyIssue(s: SeedStory): Planned {
  return {
    seedId: s.id,
    type: "Story",
    summary: s.summary,
    labels: ["rag-demo", `area-${s.area}`, `seed-${s.id}`],
    status: s.status,
    description: [{ paragraph: s.story }, { heading: "Acceptance criteria", bullets: s.acceptance }],
  }
}

function testIssue(s: SeedStory, t: SeedTest): Planned {
  return {
    seedId: t.id,
    type: "Task",
    summary: `Test: ${t.summary}`,
    labels: ["rag-demo", "test-case", `area-${s.area}`, `seed-${t.id}`],
    status: "Done",
    description: [
      ...(t.preconditions ? [{ heading: "Preconditions", paragraph: t.preconditions }] : []),
      { heading: "Steps", numbered: t.steps },
      { heading: "Expected result", paragraph: t.expected },
    ],
    storySeedId: s.id,
  }
}

function defectIssue(s: SeedStory, d: SeedDefect): Planned {
  return {
    seedId: d.id,
    type: "Bug",
    summary: d.summary,
    labels: ["rag-demo", "past-defect", `area-${s.area}`, `seed-${d.id}`],
    status: "Done",
    description: [
      { heading: "Steps to reproduce", numbered: d.steps },
      { heading: "Expected", paragraph: d.expected },
      { heading: "Actual", paragraph: d.actual },
      { heading: "Root cause", paragraph: d.rootCause },
      { heading: "Fix", paragraph: d.fix },
    ],
    storySeedId: s.id,
  }
}

export function plan(stories: SeedStory[] = STORIES): Planned[] {
  return stories.flatMap((s) => [storyIssue(s), ...s.tests.map((t) => testIssue(s, t)), ...s.defects.map((d) => defectIssue(s, d))])
}

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

// Run only as a script; tests import plan() without touching Jira
if (process.argv[1]?.endsWith("seed-jira.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
