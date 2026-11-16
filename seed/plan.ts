// Turns the demo stories into the Jira issues to create. Pure: no I/O, so the seed script,
// the offline corpus and the tests can all use it.
import { Section } from "../src/jira/adf.js"
import { STORIES, SeedDefect, SeedStory, SeedTest } from "./todomvc.js"

export interface Planned {
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
