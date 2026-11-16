// Demo QA knowledge for the TodoMVC app (https://demo.playwright.dev/todomvc), seeded into Jira
// by npm run seed:jira. Built so the RAG has something real to find:
//   - coverage differs on purpose: some stories are fully tested, S02 and S05 only partly,
//     and S09 (search) is new with no test cases at all
//   - test cases and defects often use other words than their story ("page refresh",
//     "browser storage" vs "reload", "localStorage"), so keyword search alone falls short
// Every issue gets the label rag-demo plus its own seed-<id> label, which keeps re-runs idempotent.

export interface SeedStory {
  id: string
  summary: string
  area: string
  status: "Done" | "To Do"
  story: string
  acceptance: string[]
  tests: SeedTest[]
  defects: SeedDefect[]
}

export interface SeedTest {
  id: string
  summary: string
  preconditions?: string
  steps: string[]
  expected: string
}

export interface SeedDefect {
  id: string
  summary: string
  steps: string[]
  expected: string
  actual: string
  rootCause: string
  fix: string
}

export const STORIES: SeedStory[] = [
  {
    id: "s01",
    summary: "Add a todo item",
    area: "add",
    status: "Done",
    story: "As a user I want to type a task and press Enter so I can capture it quickly.",
    acceptance: [
      "Pressing Enter in the \"What needs to be done?\" field adds the text as a new item at the bottom of the list",
      "Leading and trailing spaces are trimmed before the item is saved",
      "An empty or whitespace-only entry is not added",
      "The input field is cleared after an item is added",
    ],
    tests: [
      {
        id: "tc01",
        summary: "Add a single todo with Enter",
        steps: ["Open the app with an empty list", "Type \"Buy milk\" in the new todo field", "Press Enter"],
        expected: "\"Buy milk\" is shown as the only item and the input field is empty again",
      },
      {
        id: "tc02",
        summary: "Several new todos keep the order they were entered in",
        steps: ["Enter \"Buy milk\", \"Call the bank\" and \"Book flights\" one after another"],
        expected: "The list shows the three items top to bottom in the same order",
      },
      {
        id: "tc03",
        summary: "Blank input does not create a todo",
        steps: ["Type only spaces in the new todo field", "Press Enter"],
        expected: "No item is created and the list stays empty",
      },
      {
        id: "tc04",
        summary: "Surrounding spaces are removed from a new todo",
        steps: ["Type \"   Walk the dog   \"", "Press Enter"],
        expected: "The item reads \"Walk the dog\" without spaces before or after",
      },
    ],
    defects: [
      {
        id: "d01",
        summary: "Pressing Enter on a field with only spaces created an empty todo",
        steps: ["Type three spaces in the new todo field", "Press Enter"],
        expected: "Nothing is added",
        actual: "An item with no visible text appeared in the list and counted as 1 item left",
        rootCause: "The length check ran on the raw input before trimming, so \"   \" passed it",
        fix: "Trim first, then reject empty text. Covered by the blank input test case.",
      },
    ],
  },
  {
    id: "s02",
    summary: "Edit a todo inline",
    area: "edit",
    status: "Done",
    story: "As a user I want to fix a typo in a task without deleting and re-adding it.",
    acceptance: [
      "Double-clicking a todo's text turns it into an edit field holding the current text",
      "Pressing Enter or leaving the field saves the trimmed text",
      "Pressing Escape cancels the edit and keeps the original text",
      "Saving an empty text deletes the todo",
    ],
    tests: [
      {
        id: "tc05",
        summary: "Double-click opens the edit field with the current text",
        preconditions: "One item \"Buy milk\" exists",
        steps: ["Double-click the item text"],
        expected: "An edit field appears containing \"Buy milk\", and the checkbox and delete button are hidden",
      },
      {
        id: "tc06",
        summary: "Enter saves the edited text",
        preconditions: "One item \"Buy milk\" exists",
        steps: ["Double-click the item", "Replace the text with \"Buy oat milk\"", "Press Enter"],
        expected: "The item now reads \"Buy oat milk\"",
      },
    ],
    defects: [
      {
        id: "d02",
        summary: "Escape kept the half-typed text instead of discarding the edit",
        steps: ["Double-click an item", "Type extra characters", "Press Escape"],
        expected: "The item shows its original text",
        actual: "The changed text was saved",
        rootCause: "Escape left edit mode, which fired blur, and the blur handler saved the field",
        fix: "Escape now sets a cancelled flag that the blur handler checks before saving",
      },
      {
        id: "d03",
        summary: "Finished todos could not be opened for editing by double-click",
        steps: ["Complete an item", "Double-click its text"],
        expected: "The edit field opens",
        actual: "Nothing happened",
        rootCause: "The completed style set pointer-events: none on the label",
        fix: "Removed pointer-events from the completed style; strike-through only",
      },
    ],
  },
  {
    id: "s03",
    summary: "Mark a todo as complete",
    area: "complete",
    status: "Done",
    story: "As a user I want to tick off a task when it is done.",
    acceptance: [
      "Checking an item's checkbox marks it completed and shows its text struck through",
      "Unchecking a completed item makes it active again",
      "The items-left counter updates straight away",
    ],
    tests: [
      {
        id: "tc07",
        summary: "Ticking the checkbox marks the todo as done",
        steps: ["Add \"Buy milk\"", "Click its checkbox"],
        expected: "The item is struck through and the footer says 0 items left",
      },
      {
        id: "tc08",
        summary: "Unticking a done todo makes it active again",
        preconditions: "\"Buy milk\" is completed",
        steps: ["Click its checkbox again"],
        expected: "The strike-through is gone and the footer says 1 item left",
      },
    ],
    defects: [],
  },
  {
    id: "s04",
    summary: "Toggle all todos at once",
    area: "toggle-all",
    status: "Done",
    story: "As a user with many tasks I want to complete or reopen all of them in one click.",
    acceptance: [
      "The \"Mark all as complete\" control completes every item",
      "Clicking it again makes every item active",
      "Its checked state always shows whether every item is completed, also after items are added or deleted",
    ],
    tests: [
      {
        id: "tc09",
        summary: "Mark all as complete finishes every todo",
        preconditions: "Three active items exist",
        steps: ["Click \"Mark all as complete\""],
        expected: "All three are completed and the footer says 0 items left",
      },
      {
        id: "tc10",
        summary: "Mark all as complete clicked twice reopens every todo",
        preconditions: "Three completed items exist",
        steps: ["Click \"Mark all as complete\""],
        expected: "All three are active again",
      },
    ],
    defects: [
      {
        id: "d04",
        summary: "Mark-all checkbox stayed ticked after deleting the only completed item",
        steps: ["Add one item and complete it", "Add a second, active item", "Delete the completed item"],
        expected: "The mark-all checkbox is unticked because an active item remains",
        actual: "It stayed ticked",
        rootCause: "Its state was recalculated only when an item was toggled, not when one was deleted",
        fix: "The checked state is now derived from the list on every render",
      },
    ],
  },
  {
    id: "s05",
    summary: "Filter todos by status",
    area: "filter",
    status: "Done",
    story: "As a user I want to see only open or only finished tasks.",
    acceptance: [
      "All, Active and Completed links filter the list",
      "The address changes to #/, #/active or #/completed",
      "The selected link is highlighted",
      "The selected filter is kept after reloading the page",
    ],
    tests: [
      {
        id: "tc11",
        summary: "Active view hides finished todos",
        preconditions: "One active and one completed item",
        steps: ["Click Active"],
        expected: "Only the active item is listed and the address ends in #/active",
      },
      {
        id: "tc12",
        summary: "Completed view lists only finished todos",
        preconditions: "One active and one completed item",
        steps: ["Click Completed"],
        expected: "Only the completed item is listed",
      },
      {
        id: "tc13",
        summary: "The chosen view link is highlighted",
        steps: ["Click Active"],
        expected: "The Active link has the selected style and All does not",
      },
    ],
    defects: [
      {
        id: "d05",
        summary: "Completed view jumped back to All after refreshing the browser",
        steps: ["Open the Completed view", "Refresh the browser"],
        expected: "The Completed view is still shown",
        actual: "All items were shown and the All link was highlighted",
        rootCause: "The router read the address only on hashchange events, never on page load",
        fix: "The router reads the current hash once at start-up",
      },
    ],
  },
  {
    id: "s06",
    summary: "Clear completed todos",
    area: "clear",
    status: "Done",
    story: "As a user I want to remove all finished tasks in one go.",
    acceptance: [
      "The \"Clear completed\" button removes every completed item",
      "Active items are not touched",
      "The button is hidden while no item is completed",
    ],
    tests: [
      {
        id: "tc14",
        summary: "Clear completed removes only the finished todos",
        preconditions: "Two completed items and one active item",
        steps: ["Click \"Clear completed\""],
        expected: "Only the active item remains",
      },
      {
        id: "tc15",
        summary: "Clear completed button is not shown when nothing is finished",
        preconditions: "Only active items exist",
        steps: ["Look at the footer"],
        expected: "There is no \"Clear completed\" button",
      },
    ],
    defects: [
      {
        id: "d06",
        summary: "Clear completed button visible while no item was finished",
        steps: ["Add two items without completing them"],
        expected: "No \"Clear completed\" button",
        actual: "The button was shown and did nothing when clicked",
        rootCause: "Its visibility was bound to the total number of items instead of the completed ones",
        fix: "Visibility now depends on the completed count",
      },
    ],
  },
  {
    id: "s07",
    summary: "Keep todos after reload",
    area: "persistence",
    status: "Done",
    story: "As a user I want my list to still be there when I come back later.",
    acceptance: [
      "Items, their completed state and their order are saved in localStorage",
      "They are restored when the page is opened again",
      "Text with emoji and non-Latin characters is kept exactly",
    ],
    tests: [
      {
        id: "tc16",
        summary: "Todos survive a page refresh",
        preconditions: "Two items exist, one of them completed",
        steps: ["Refresh the browser tab"],
        expected: "Both items are back from browser storage, in the same order, and the first is still completed",
      },
    ],
    defects: [
      {
        id: "d07",
        summary: "Todos containing emoji disappeared after reopening the app",
        steps: ["Add \"Pay rent 🏠\"", "Close the tab and open the app again"],
        expected: "The item is still there",
        actual: "The whole list was empty",
        rootCause: "The save code base64-encoded the list with btoa, which throws on characters outside Latin-1, so nothing was written",
        fix: "The list is stored with plain JSON.stringify",
      },
    ],
  },
  {
    id: "s08",
    summary: "Show how many items are left",
    area: "counter",
    status: "Done",
    story: "As a user I want to know at a glance how much is still open.",
    acceptance: [
      "The footer shows the number of active items",
      "It reads \"1 item left\" for one and \"N items left\" otherwise, including \"0 items left\"",
    ],
    tests: [
      {
        id: "tc17",
        summary: "Footer uses the singular for one open todo",
        steps: ["Add one item"],
        expected: "The footer reads \"1 item left\"",
      },
      {
        id: "tc18",
        summary: "Footer counts only open todos",
        preconditions: "Three items, one of them completed",
        steps: ["Look at the footer"],
        expected: "The footer reads \"2 items left\"",
      },
    ],
    defects: [
      {
        id: "d08",
        summary: "Footer said \"1 items left\"",
        steps: ["Add one item"],
        expected: "\"1 item left\"",
        actual: "\"1 items left\"",
        rootCause: "The plural rule checked count > 0 instead of count !== 1",
        fix: "Singular only when the count is exactly 1",
      },
    ],
  },
  {
    id: "s09",
    summary: "Search todos by text",
    area: "search",
    status: "To Do",
    story: "As a user with a long list I want to find a task by typing part of its text.",
    acceptance: [
      "A search field above the list shows only items whose text contains the typed words",
      "Matching ignores upper and lower case",
      "Search works together with the All, Active and Completed views",
      "Clearing the search field shows the full list again",
    ],
    tests: [],
    defects: [],
  },
]
