import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Bm25, tokenize } from "../src/rag/bm25.js"
import { docsFromIssues, seedDocs, seedIssues } from "../src/rag/documents.js"
import { KnowledgeIndex } from "../src/rag/knowledgeIndex.js"
import { acceptanceCriteria } from "../src/tools/ragTools.js"
import { FakeEmbedder } from "./fakes.js"

describe("documents", () => {
  it("turns the seed into 35 documents of the right kinds, linked to their stories", () => {
    const docs = seedDocs()
    const count = (kind: string) => docs.filter((d) => d.kind === kind).length
    expect([count("story"), count("test-case"), count("past-defect")]).toEqual([9, 18, 8])
    expect(docs.find((d) => d.seedId === "tc16")).toMatchObject({ kind: "test-case", stories: ["S07"] })
  })

  it("adds the story title only when contextual is on", () => {
    const plain = docsFromIssues(seedIssues()).find((d) => d.seedId === "tc08")!
    const contextual = docsFromIssues(seedIssues(), { contextual: true }).find((d) => d.seedId === "tc08")!
    expect(plain.text.startsWith("Test case: Test: Unticking")).toBe(true)
    expect(contextual.text.startsWith("Story: Mark a todo as complete\nTest case:")).toBe(true)
  })
})

describe("BM25", () => {
  it("keeps route-like tokens and drops stopwords", () => {
    expect(tokenize("The address ends in #/active")).toEqual(["address", "ends", "active"])
  })

  it("ranks the document with the rarer matching term first", () => {
    const scores = new Bm25(["escape cancels the edit", "enter saves the edit", "footer counter"]).scores("escape edit")
    expect(scores[0]).toBeGreaterThan(scores[1]!)
    expect(scores[2]).toBe(0)
  })
})

describe("KnowledgeIndex", () => {
  it("filters by kind and returns the closest document first", async () => {
    const index = await KnowledgeIndex.build(seedDocs(), new FakeEmbedder())
    const hits = await index.search("footer reads 1 item left", { kinds: ["past-defect"], k: 3 })
    expect(hits.every((h) => h.doc.kind === "past-defect")).toBe(true)
    expect(hits[0]!.doc.seedId).toBe("d08")
  })

  it("keyword mode returns only documents that share a word with the query", async () => {
    const index = await KnowledgeIndex.build(seedDocs(), new FakeEmbedder())
    expect(await index.search("zzzz qqqq", { mode: "keyword" })).toEqual([])
  })

  it("saves and loads, and ignores a file made with another model", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rag-")), "index.json")
    const embedder = new FakeEmbedder()
    const built = await KnowledgeIndex.build(seedDocs(), embedder)
    built.save(file)

    expect(KnowledgeIndex.load(file, embedder)?.size).toBe(35)
    expect(KnowledgeIndex.load(file, Object.assign(new FakeEmbedder(), { model: "other" }))).toBeNull()
  })

  it("reuses vectors for unchanged text when rebuilding", async () => {
    const embedder = new FakeEmbedder()
    const first = await KnowledgeIndex.build(seedDocs(), embedder)
    const docs = seedDocs()
    docs[0]!.text += "\n- one more criterion"
    await KnowledgeIndex.build(docs, embedder, first)
    expect(embedder.embedded).toBe(35 + 1)
  })
})

describe("acceptanceCriteria", () => {
  it("reads the bullets under the heading and stops at the next section", () => {
    const text = "As a user...\nAcceptance criteria\n- First\n- Second\nNotes\nnot a criterion"
    expect(acceptanceCriteria(text)).toEqual(["First", "Second"])
  })

  it("falls back to the whole description when there is no such heading", () => {
    expect(acceptanceCriteria("Just a paragraph")).toEqual(["Just a paragraph"])
    expect(acceptanceCriteria("")).toEqual([])
  })
})
