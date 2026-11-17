import path from "node:path"
import { PROJECT_ROOT } from "../paths.js"

export interface Embedder {
  // Stored with the index, so vectors from another model are never mixed in
  readonly model: string
  embed(texts: string[]): Promise<number[][]>
}

// all-MiniLM-L6-v2 running inside Node through ONNX: no API key, no cost, and the same
// vectors on every machine. The 8-bit build (about 23 MB) scores within a few hundredths
// of the full one on this corpus. Downloaded from Hugging Face once, then read from cache.
export class LocalEmbedder implements Embedder {
  readonly model = "Xenova/all-MiniLM-L6-v2:q8"
  private pipe: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | undefined

  constructor(private readonly cacheDir = path.join(PROJECT_ROOT, ".index", "models")) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    this.pipe ??= (async () => {
      const { pipeline, env } = await import("@huggingface/transformers")
      env.cacheDir = this.cacheDir
      return (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })) as never
    })()
    const run = await this.pipe
    const vectors: number[][] = []
    // Small batches keep memory flat for a bigger corpus
    for (let i = 0; i < texts.length; i += 32) {
      vectors.push(...(await run(texts.slice(i, i + 32), { pooling: "mean", normalize: true })).tolist())
    }
    return vectors
  }
}
