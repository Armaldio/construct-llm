import { LibSQLVector } from "@mastra/libsql";
import { pipeline } from "@xenova/transformers";

class XenovaEmbedder {
  private embedder: any;
  async initialize() {
    if (!this.embedder) {
      this.embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
  }
  async embed(texts: string[]): Promise<number[][]> {
    await this.initialize();
    const outputs = await this.embedder(texts, { pooling: "mean", normalize: true });
    const num_texts = texts.length;
    const dim = 384;
    const result: number[][] = [];
    for (let i = 0; i < num_texts; i++) {
      result.push(Array.from(outputs.data.slice(i * dim, (i + 1) * dim)));
    }
    return result;
  }
}

const xenovaModel = new XenovaEmbedder();
const embeddingModel = {
  specificationVersion: "v1",
  provider: "xenova",
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxEmbeddingsPerCall: 100,
  async doEmbed({ values }: { values: string[] }) {
    const embeddings = await xenovaModel.embed(values);
    return { embeddings };
  },
};

const vStore = new LibSQLVector({
  id: "construct-projects",
  url: "file:prebuilt-assets.db",
});

async function main() {
  console.log("Debugging manual_content...");

  const queryText = "How do I use global variables?";
  const res = await embeddingModel.doEmbed({ values: [queryText] });
  const queryVector = res.embeddings[0];

  const results = await vStore.query({
    indexName: "manual_content",
    queryVector,
    topK: 2,
  });

  console.log("Manual Results:", JSON.stringify(results, null, 2));
}

main().catch(console.error);
