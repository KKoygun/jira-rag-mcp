// Jira Cloud stores rich text as Atlassian Document Format (ADF), a JSON tree.
// The seed writes it from plain sections; the RAG reads it back as plain text.

export interface AdfNode {
  type: string
  version?: number // only on the root doc node
  text?: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
}

export interface Section {
  heading?: string
  paragraph?: string
  bullets?: string[]
  numbered?: string[]
}

const text = (value: string): AdfNode => ({ type: "text", text: value })
const paragraph = (value: string): AdfNode => ({ type: "paragraph", content: [text(value)] })
const list = (type: "bulletList" | "orderedList", items: string[]): AdfNode => ({
  type,
  content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
})

export function toAdf(sections: Section[]): AdfNode {
  const content: AdfNode[] = []
  for (const s of sections) {
    if (s.heading) content.push({ type: "heading", attrs: { level: 3 }, content: [text(s.heading)] })
    if (s.paragraph) content.push(paragraph(s.paragraph))
    if (s.bullets) content.push(list("bulletList", s.bullets))
    if (s.numbered) content.push(list("orderedList", s.numbered))
  }
  return { version: 1, type: "doc", content }
}

// Block nodes end a line, list items get a marker, so the text keeps the structure an
// embedding model and a reader both need ("Acceptance criteria" followed by its bullets).
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return ""
  const lines: string[] = []

  const inline = (n: AdfNode): string =>
    n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inline).join("")

  const walk = (n: AdfNode, marker?: string): void => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        lines.push((marker ?? "") + inline(n))
        return
      case "bulletList":
      case "orderedList":
        ;(n.content ?? []).forEach((item, i) => {
          const m = n.type === "bulletList" ? "- " : `${i + 1}. `
          ;(item.content ?? []).forEach((child, j) => walk(child, j === 0 ? m : "  "))
        })
        return
      case "codeBlock":
        lines.push(inline(n))
        return
      default:
        ;(n.content ?? []).forEach((child) => walk(child, marker))
    }
  }

  walk(node)
  return lines.filter((l) => l.trim() !== "").join("\n")
}
