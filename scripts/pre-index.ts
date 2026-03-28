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

async function pruneJson(obj: any): Promise<any> {
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(pruneJson));
  } else if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      if (key === "sid" || key === "uistate") continue;
      newObj[key] = await pruneJson(obj[key]);
    }
    return newObj;
  }
  return obj;
}

async function downloadLatestManual() {
  const manualUrl = "https://www.construct.net/en/make-games/manuals/construct-3";
  const assetsDir = path.join(process.cwd(), "assets");
  const targetPath = path.join(assetsDir, "construct-3.pdf");

  try {
    console.log(`[1/5] Checking for latest manual at ${manualUrl}...`);
    await fs.mkdir(assetsDir, { recursive: true });

    // Added 10s timeout to fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(manualUrl, { signal: controller.signal });
    clearTimeout(timeout);

    const html = await response.text();

    const pdfUrlMatch = html.match(
      /https?:\/\/construct-static\.com\/downloads\/[^"']*?construct-3\.pdf/,
    );

    if (pdfUrlMatch) {
      const pdfUrl = pdfUrlMatch[0];
      console.log(`[1/5] Found current manual link: ${pdfUrl}`);
      console.log("[1/5] Downloading latest manual...");
      execSync(`curl -L "${pdfUrl}" -o "${targetPath}"`, { stdio: "inherit" });
      console.log("[1/5] Manual download complete.");
    } else {
      console.warn("[1/5] Could not find the manual download link. Using existing file.");
    }
  } catch (e: any) {
    console.error("[1/5] Failed to automate manual download:", e.message);
  }
}

async function main() {
  console.log("=== Construct LLM Optimized Indexing Session ===");

  // 0. Clean old database and temporary files for a fresh start
  const dbPath = path.join(process.cwd(), "prebuilt-assets.db");
  const tempFiles = [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`];

  for (const f of tempFiles) {
    try {
      if (await fs.stat(f).catch(() => null)) {
        await fs.unlink(f);
        console.log(`[0/5] Cleaned up ${path.basename(f)}`);
      }
    } catch (e) {
      // Ignore
    }
  }

  // 1. Automate manual download to stay up to date
  await downloadLatestManual();

  // Initialize embedding model explicitly to show status
  console.log("[2/5] Initializing local embedding model (Xenova/all-MiniLM-L6-v2)...");
  console.log("      Note: The first run may take a minute to download model files.");
  await xenovaModel.initialize();
  console.log("[2/5] Embedding model ready.");

  // Initialize vector store AFTER cleanup to avoid stale handles
  const vStore = new LibSQLVector({
    id: "construct-projects",
    url: `file:${dbPath}`,
  });
  try {
    console.log("[3/5] Setting up vector indices...");
    await vStore.createIndex({ indexName: "manual_content", dimension: 384 });
    await vStore.createIndex({ indexName: "snippet_content", dimension: 384 });
  } catch (e) {
    // Indexes might already exist
  }

  const processAndUpsert = async (
    chunks: { text: string; metadata: Record<string, any> }[],
    projectName: string,
    indexName: string,
  ) => {
    if (chunks.length === 0) return;

    const vectors: number[][] = [];
    const ids: string[] = [];
    const metadata: Record<string, any>[] = [];

    // Increased batch size for faster embedding
    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const res = await embeddingModel.doEmbed({ values: batch.map((c) => c.text) });

        if (res && res.embeddings) {
          res.embeddings.forEach((embeddingArray: any, idx: number) => {
            vectors.push(Array.from(embeddingArray));
            // Unique ID per project + chunk index
            ids.push(`${projectName}-${i + idx}`.replace(/[^a-zA-Z0-9-]/g, "_"));
            metadata.push(batch[idx].metadata);
          });
        }
      } catch (err) {
        console.error(`      Failed to embed batch starting at ${i}:`, err);
      }
    }

    if (vectors.length > 0) {
      try {
        await vStore.upsert({ indexName, vectors, ids, metadata });
      } catch (upsertErr) {
        console.error(
          `      Failed to upsert ${vectors.length} vectors for ${projectName}:`,
          upsertErr,
        );
      }
    }
  };

  // 2. Manual Indexing
  const pdfPath = path.join(process.cwd(), "assets", "construct-3.pdf");
  if (await fs.stat(pdfPath).catch(() => null)) {
    try {
      console.log("[4/5] Parsing manual PDF...");
      const dataBuffer = await fs.readFile(pdfPath);
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      const cleanedText = result.text.replace(
        /Construct 3 Official Manual\s+Page \d+ of \d+\s+-- \d+ of \d+ --/g,
        "",
      );

      const sectionRegex =
        /([A-Z0-9\s\n&]{3,})\nView online: (https:\/\/www\.construct\.net\/[^\s]+)/g;
      let lastIndex = 0;
      let match;
      const sections: { title: string; url: string; content: string }[] = [];

      while ((match = sectionRegex.exec(cleanedText)) !== null) {
        if (sections.length > 0) {
          sections[sections.length - 1].content = cleanedText
            .substring(lastIndex, match.index)
            .trim();
        }
        sections.push({ title: match[1].trim().replace(/\n/g, " "), url: match[2], content: "" });
        lastIndex = match.index + match[0].length;
      }
      if (sections.length > 0) {
        sections[sections.length - 1].content = cleanedText.substring(lastIndex).trim();
      }

      console.log(`[4/5] Indexing ${sections.length} manual sections...`);
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
      console.log("[4/5] Manual indexing complete.");
    } catch (pdfError) {
      console.error("[4/5] Failed to process manual PDF:", pdfError);
    }
  }

  // 3. Clone Scirra Repo
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const scirraRepoName = "Construct-Example-Projects";
  const scirraTargetPath = path.join(TEMP_DIR, scirraRepoName);

  try {
    console.log(`[5/5] Updating remote examples: ${SCIRRA_EXAMPLES_URL}...`);
    if (!(await fs.stat(scirraTargetPath).catch(() => null))) {
      execSync(`git clone ${SCIRRA_EXAMPLES_URL} ${scirraTargetPath}`, { stdio: "inherit" });
    } else {
      console.log("[5/5] Remote examples already cloned.");
    }
  } catch (e: any) {
    console.error("[5/5] Failed to clone remote projects:", e.message);
  }

  // 4. Project Discovery
  const allProjectRoots: string[] = [];
  async function findProjectRoots(dir: string) {
    if (!(await fs.stat(dir).catch(() => null))) return;
    const files = await fs.readdir(dir);
    if (files.indexOf("project.c3proj") !== -1) {
      allProjectRoots.push(dir);
      return;
    }
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file === ".git" || file === "node_modules" || file === "temp_projects") continue;
      if ((await fs.stat(fullPath)).isDirectory()) {
        await findProjectRoots(fullPath);
      }
    }
  }

  console.log("[5/5] Scanning local and remote directories for projects...");
  await findProjectRoots(path.join(process.cwd(), "examples"));
  await findProjectRoots(TEMP_DIR);

  const totalProjects = allProjectRoots.length;
  console.log(`[5/5] Found ${totalProjects} projects to index.`);

  // 5. Parallel Project Indexing
  const CONCURRENCY = 5;
  console.log(`[5/5] Processing projects with concurrency pool size: ${CONCURRENCY}`);

  const projectQueue = [...allProjectRoots];
  let completedCount = 0;

  async function processNextProject() {
    if (projectQueue.length === 0) return;
    const resolvedPath = projectQueue.shift()!;
    const projectName = path.basename(resolvedPath);
    const currentId = ++completedCount;

    try {
      const allFiles = await getAllFiles(resolvedPath);
      const allProjectChunks: { text: string; metadata: Record<string, any> }[] = [];

      for (const file of allFiles) {
        const relativePath = path.relative(resolvedPath, file).replace(/\\/g, "/");
        if (relativePath.includes(".uistate.json") || relativePath.includes(".git")) continue;

        let content = await fs.readFile(file, "utf8");

        if (file.endsWith(".json")) {
          try {
            const json = JSON.parse(content);
            const pruned = await pruneJson(json);
            content = JSON.stringify(pruned);
          } catch (e) {}
        }

        const fileType = relativePath.split("/")[0] || "root";
        const textToEmbed = `Project: ${projectName}\nFile: ${relativePath}\nType: ${fileType}\nContent:\n${content}`;

        const doc = MDocument.fromText(textToEmbed, {
          metadata: {
            project: projectName,
            path: relativePath,
            type: "project-file",
            fileType: fileType,
          },
        });

        // Optimization: Increased maxSize to avoid warnings with minified JSON
        const docChunks = await doc.chunk({ strategy: "recursive", maxSize: 2000, overlap: 200 });

        allProjectChunks.push(
          ...docChunks.map((c) => ({ text: c.text, metadata: { ...c.metadata, text: c.text } })),
        );
      }

      process.stdout.write(
        `(${currentId}/${totalProjects}) Indexing ${projectName} [${allProjectChunks.length} chunks from ${allFiles.length} files]...\n`,
      );
      await processAndUpsert(allProjectChunks, projectName, "snippet_content");
    } catch (e: any) {
      console.error(`\n[!] Failed to index project ${projectName}:`, e.message);
    }
    await processNextProject();
  }

  // Start the pool
  await Promise.all(Array.from({ length: CONCURRENCY }).map(() => processNextProject()));

  console.log("\n=== Pre-indexing complete! Generated optimized prebuilt-assets.db ===");
}

main().catch(console.error);
