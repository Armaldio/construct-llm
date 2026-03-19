import { LibSQLVector } from "@mastra/libsql";
import { MDocument } from "@mastra/rag";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

interface EmbedderResult {
  embeddings: number[][];
}

// Setup Xenova local embedder wrapper
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
    // Convert to flat array of arrays
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
  async doEmbed({ values }: { values: string[] }): Promise<EmbedderResult> {
    const embeddings = await xenovaModel.embed(values);
    return { embeddings };
  },
};

const vectorStore = new LibSQLVector({
  id: "construct-projects",
  url: "file:prebuilt-assets.db",
});

async function main() {
  console.log("Starting pre-indexing of global assets...");
  const vStore = vectorStore;

  try {
    await vStore.createIndex({ indexName: "manual_content", dimension: 384 });
    await vStore.createIndex({ indexName: "snippet_content", dimension: 384 });
  } catch (e) {
    // Indexes might already exist, ignore error
  }

  const processAndUpsert = async (
    chunks: { text: string; metadata: Record<string, any> }[],
    prefix: string,
    indexName: string,
  ) => {
    const vectors: number[][] = [];
    const ids: string[] = [];
    const metadata: Record<string, any>[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const res = await embeddingModel.doEmbed({ values: [chunk.text] });

        if (res && res.embeddings && res.embeddings[0]) {
          const embeddingArray = Array.from(res.embeddings[0]);
          vectors.push(embeddingArray);
          ids.push(`global-${prefix}-chunk-${i}`.replace(/[^a-zA-Z0-9-]/g, "_"));
          metadata.push(chunk.metadata);
        }
      } catch (err) {
        console.error(`Failed to embed chunk ${i}:`, err);
      }
    }
    if (vectors.length > 0) await vStore.upsert({ indexName, vectors, ids, metadata });
  };

  // 1. Manual
  const pdfPath = path.join(process.cwd(), "assets", "construct-3.pdf");
  const dataBuffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();

  // Clean boilerplate: Page X of Y and -- X of Y --
  const cleanedText = result.text.replace(
    /Construct 3 Official Manual\s+Page \d+ of \d+\s+-- \d+ of \d+ --/g,
    "",
  );

  // Split into sections using the "View online:" pattern
  // We want to capture the text BEFORE "View online" as the title, and the URL itself
  const sectionRegex = /([A-Z0-9\s\n&]{3,})\nView online: (https:\/\/www\.construct\.net\/[^\s]+)/g;

  let lastIndex = 0;
  let match;
  const sections: { title: string; url: string; content: string }[] = [];

  while ((match = sectionRegex.exec(cleanedText)) !== null) {
    if (sections.length > 0) {
      sections[sections.length - 1].content = cleanedText.substring(lastIndex, match.index).trim();
    }
    sections.push({
      title: match[1].trim().replace(/\n/g, " "),
      url: match[2],
      content: "", // will be filled in next iteration or after loop
    });
    lastIndex = match.index + match[0].length;
  }

  if (sections.length > 0) {
    sections[sections.length - 1].content = cleanedText.substring(lastIndex).trim();
  }

  console.log(`Found ${sections.length} manual sections. Processing...`);

  for (const section of sections) {
    if (!section.content || section.content.length < 50) continue;

    const doc = MDocument.fromText(section.content, {
      metadata: {
        title: section.title,
        url: section.url,
        path: "assets/construct-3.pdf",
        type: "manual",
      },
    });

    // Smaller chunks for manual to be more precise
    const docChunks = await doc.chunk({ strategy: "recursive", maxSize: 800, overlap: 150 });

    await processAndUpsert(
      docChunks.map((c) => ({
        text: `### ${section.title}\nSource: ${section.url}\n\n${c.text}`,
        metadata: {
          text: c.text,
          title: section.title,
          url: section.url,
          path: "assets/construct-3.pdf",
          type: "manual",
        },
      })),
      `manual-${section.title.replace(/[^a-zA-Z0-9]/g, "-")}`,
      "manual_content",
    );
  }

  // 2. Snippets
  const snippetsDir = path.join(process.cwd(), "snippets");
  const files = await fs.readdir(snippetsDir);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const content = await fs.readFile(path.join(snippetsDir, file), "utf8");
    const text = `Snippet: ${file}\nDescription: Example of valid Construct 3 JSON.\nContent:\n${content}`;
    console.log(`Processing snippet ${file}`);
    await processAndUpsert(
      [{ text, metadata: { text, path: `snippets/${file}`, type: "snippet" } }],
      `snippet-${file}`,
      "snippet_content",
    );
  }

  console.log("Pre-indexing complete! Generated prebuilt-assets.db");
}

main().catch(console.error);
