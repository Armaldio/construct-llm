import { LibSQLVector } from "@mastra/libsql";
import { MDocument } from "@mastra/rag";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { PDFParse } from "pdf-parse";
import { execSync } from "node:child_process";

interface EmbedderResult {
  embeddings: number[][];
}

const SCIRRA_EXAMPLES_URL = "https://github.com/Scirra/Construct-Example-Projects.git";
const TEMP_DIR = path.resolve(process.cwd(), "temp_projects");

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

async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  try {
    const files = await fs.readdir(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        await getAllFiles(filePath, arrayOfFiles);
      } else {
        const ext = path.extname(file).toLowerCase();
        if ([".json", ".js"].includes(ext)) {
          arrayOfFiles.push(filePath);
        }
      }
    }
  } catch (e) {
    // Directory might not exist
  }

  return arrayOfFiles;
}

async function main() {
  console.log("Starting unified pre-indexing of Manual and Example Projects...");
  const vStore = vectorStore;

  try {
    await vStore.createIndex({ indexName: "manual_content", dimension: 384 });
    await vStore.createIndex({ indexName: "snippet_content", dimension: 384 });
  } catch (e) {
    // Indexes might already exist
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
          ids.push(`${prefix}-chunk-${i}`.replace(/[^a-zA-Z0-9-]/g, "_"));
          metadata.push(chunk.metadata);
        }
      } catch (err) {
        console.error(`Failed to embed chunk ${i}:`, err);
      }
    }
    if (vectors.length > 0) {
      console.log(`Upserting ${vectors.length} vectors for ${prefix}...`);
      await vStore.upsert({ indexName, vectors, ids, metadata });
    }
  };

  // 1. Manual Indexing
  const pdfPath = path.join(process.cwd(), "assets", "construct-3.pdf");
  if (await fs.stat(pdfPath).catch(() => null)) {
    try {
      console.log("Processing manual PDF...");
      const dataBuffer = await fs.readFile(pdfPath);
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      const cleanedText = result.text.replace(
        /Construct 3 Official Manual\s+Page \d+ of \d+\s+-- \d+ of \d+ --/g,
        "",
      );

      const sectionRegex = /([A-Z0-9\s\n&]{3,})\nView online: (https:\/\/www\.construct\.net\/[^\s]+)/g;
      let lastIndex = 0;
      let match;
      const sections: { title: string; url: string; content: string }[] = [];

      while ((match = sectionRegex.exec(cleanedText)) !== null) {
        if (sections.length > 0) {
          sections[sections.length - 1].content = cleanedText.substring(lastIndex, match.index).trim();
        }
        sections.push({ title: match[1].trim().replace(/\n/g, " "), url: match[2], content: "" });
        lastIndex = match.index + match[0].length;
      }
      if (sections.length > 0) {
        sections[sections.length - 1].content = cleanedText.substring(lastIndex).trim();
      }

      for (const section of sections) {
        if (!section.content || section.content.length < 50) continue;
        const doc = MDocument.fromText(section.content, {
          metadata: { title: section.title, url: section.url, path: "assets/construct-3.pdf", type: "manual" },
        });
        const docChunks = await doc.chunk({ strategy: "recursive", maxSize: 800, overlap: 150 });
        await processAndUpsert(
          docChunks.map((c) => ({
            text: `### ${section.title}\nSource: ${section.url}\n\n${c.text}`,
            metadata: { text: c.text, title: section.title, url: section.url, path: "assets/construct-3.pdf", type: "manual" },
          })),
          `manual-${section.title.replace(/[^a-zA-Z0-9]/g, "-")}`,
          "manual_content",
        );
      }
    } catch (pdfError) {
      console.error("Failed to process manual PDF:", pdfError);
    }
  }

  // 2. Project Examples Indexing (Local + Remote)
  const allProjectRoots: string[] = [];
  async function findProjectRoots(dir: string) {
    if (!(await fs.stat(dir).catch(() => null))) return;
    const files = await fs.readdir(dir);
    if (files.includes("project.c3proj")) {
      allProjectRoots.push(dir);
      return;
    }
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file === ".git" || file === "node_modules") continue;
      if ((await fs.stat(fullPath)).isDirectory()) {
        await findProjectRoots(fullPath);
      }
    }
  }

  // A. Clone Scirra Repo (Remote)
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const repoName = "Construct-Example-Projects";
  const scirraTargetPath = path.join(TEMP_DIR, repoName);

  try {
    console.log(`Updating remote examples: ${SCIRRA_EXAMPLES_URL}...`);
    if (await fs.stat(scirraTargetPath).catch(() => null)) {
      console.log("Repo already exists, skipping clone.");
    } else {
      execSync(`git clone ${SCIRRA_EXAMPLES_URL} ${scirraTargetPath}`, { stdio: "inherit" });
    }
  } catch (e: any) {
    console.error(`Failed to clone remote project:`, e.message);
  }

  // B. Scan all sources
  console.log("Scanning for projects in examples/ and temp_projects/...");
  await findProjectRoots(path.join(process.cwd(), "examples"));
  await findProjectRoots(TEMP_DIR);

  console.log(`Found ${allProjectRoots.length} projects to index.`);

  for (const resolvedPath of allProjectRoots) {
    try {
      const projectName = path.basename(resolvedPath);
      console.log(`Indexing project: ${projectName}`);
      const allFiles = await getAllFiles(resolvedPath);
      for (const file of allFiles) {
        const relativePath = path.relative(resolvedPath, file).replace(/\\/g, "/");
        if (relativePath.includes(".uistate.json") || relativePath.includes(".git")) continue;
        const content = await fs.readFile(file, "utf8");
        const fileType = relativePath.split("/")[0] || "root";
        const textToEmbed = `Project: ${projectName}\nFile: ${relativePath}\nType: ${fileType}\nContent:\n${content}`;
        const doc = MDocument.fromText(textToEmbed, {
          metadata: { text: textToEmbed, project: projectName, path: relativePath, type: "project-file", fileType: fileType }
        });
        const chunks = await doc.chunk({ strategy: "recursive", maxSize: 2000, overlap: 200 });
        await processAndUpsert(
          chunks.map(c => ({ text: c.text, metadata: { ...c.metadata, text: c.text } })),
          `${projectName}-${relativePath.replace(/[^a-zA-Z0-9]/g, "-")}`,
          "snippet_content"
        );
      }
    } catch (e: any) {
      console.error(`Failed to index project ${resolvedPath}:`, e.message);
    }
  }

  console.log("Pre-indexing complete! Generated prebuilt-assets.db");
}

main().catch(console.error);
