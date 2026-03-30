import { LibSQLVector } from "@mastra/libsql";
import { MDocument } from "@mastra/rag";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { PDFParse } from "pdf-parse";
import { execSync } from "node:child_process";
import { createClient } from "@libsql/client";
import crypto from "node:crypto";

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
        const start = i * dim;
        const end = (i + 1) * dim;
        result.push(Array.from(outputs.data.slice(start, end)));
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
        const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

        // SKIP IMAGES (Explicitly)
        if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg"].includes(ext)) continue;

        // SKIP LIBRARIES AND MINIFIED FILES
        if (file.endsWith(".min.js") || file.endsWith(".js.map") || relativePath.includes("/files/"))
          continue;

        if ([".json", ".js", ".ts"].includes(ext)) {
          arrayOfFiles.push(filePath);
        }
      }
    }
  } catch (e) {
    // Directory might not exist
  }

  return arrayOfFiles;
}

// Optimized synchronous pruneJson to avoid microtask overhead
function pruneJson(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(pruneJson);
  } else if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      // 1. GLOBAL PRUNING
      if (key === "sid" || key === "uistate") continue;

      // 2. LAYOUT PRUNING
      if (key === "tilemapData" && obj[key] && typeof obj[key] === "object") {
        const { data, ...rest } = obj[key];
        newObj[key] = rest; // Keep dimensions, lose the massive encoded string
        continue;
      }

      if (key === "instances" && Array.isArray(obj[key])) {
        const instances = obj[key];
        const summarized: any[] = [];
        const instanceGroups: Map<string, { count: number; data: any }> = new Map();

        for (const inst of instances) {
          const { uid, sid, world, ...rest } = inst;
          const pruned = pruneJson(rest);
          const keyString = JSON.stringify(pruned);

          if (instanceGroups.has(keyString)) {
            instanceGroups.get(keyString)!.count++;
          } else {
            instanceGroups.set(keyString, { count: 1, data: pruned });
          }
        }

        for (const [_, group] of instanceGroups) {
          if (group.count > 1) {
            summarized.push({ ...group.data, _count: group.count });
          } else {
            summarized.push(group.data);
          }
        }

        newObj[key] = summarized;
        continue;
      }

      // 3. OBJECT TYPE / ANIMATION PRUNING
      if (key === "frames" && Array.isArray(obj[key])) {
        newObj[key] = obj[key].map((frame: any) => {
          const {
            collisionPoly,
            imageSpriteId,
            originX,
            originY,
            originalSource,
            exportFormat,
            exportQuality,
            fileType,
            ...rest
          } = frame;
          return rest;
        });
        continue;
      }

      newObj[key] = pruneJson(obj[key]);
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(manualUrl, { signal: controller.signal });
    clearTimeout(timeout);

    const html = await response.text();
    const pdfUrlMatch = html.match(/https?:\/\/construct-static\.com\/downloads\/[^"']*?construct-3\.pdf/);

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

  const dbPath = path.join(process.cwd(), "prebuilt-assets.db");
  console.log(`[0/5] Using persistent database at ${path.basename(dbPath)}`);

  await downloadLatestManual();

  console.log("[2/5] Initializing local embedding model (Xenova/all-MiniLM-L6-v2)...");
  await xenovaModel.initialize();
  console.log("[2/5] Embedding model ready.");

  const vStore = new LibSQLVector({
    id: "construct-projects",
    url: `file:${dbPath}`,
  });
  
  try {
    console.log("[3/5] Setting up vector indices...");
    await vStore.createIndex({ indexName: "manual_content", dimension: 384 });
    await vStore.createIndex({ indexName: "snippet_content", dimension: 384 });
  } catch (e) {}

  // Raw client for idempotency checks and cleanup
  const client = createClient({ url: `file:${dbPath}` });

  const processAndUpsert = async (
    chunks: { text: string; metadata: Record<string, any> }[],
    projectName: string,
    indexName: string,
  ) => {
    if (chunks.length === 0) return;

    const vectors: number[][] = [];
    const ids: string[] = [];
    const metadata: Record<string, any>[] = [];

    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const res = await embeddingModel.doEmbed({ values: batch.map((c) => c.text) });
        if (res && res.embeddings) {
          res.embeddings.forEach((embeddingArray: any, idx: number) => {
            vectors.push(Array.from(embeddingArray));
            // Use stable IDs to allow upsert logic
            const chunkPath = batch[idx].metadata.path.replace(/[^a-zA-Z0-9-]/g, "_");
            ids.push(`${projectName}-${chunkPath}-${i + idx}`);
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
        console.error(`      Failed to upsert ${vectors.length} vectors for ${projectName}:`, upsertErr);
      }
    }
  };

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
      if ((await fs.stat(fullPath).catch(() => ({ isDirectory: () => false }))).isDirectory()) {
         await findProjectRoots(fullPath);
      }
    }
  }

  console.log("[5/5] Scanning directories for projects...");
  await findProjectRoots(path.join(process.cwd(), "examples"));
  await findProjectRoots(TEMP_DIR);

  const totalProjects = allProjectRoots.length;
  console.log(`[5/5] Found ${totalProjects} projects to index.`);

  const CONCURRENCY = parseInt(process.env.INDEX_CONCURRENCY || "4", 10);
  console.log(`[5/5] Processing projects with concurrency: ${CONCURRENCY}`);

  const projectQueue = [...allProjectRoots];
  let completedCount = 0;

  async function processNextProject() {
    if (projectQueue.length === 0) return;
    const resolvedPath = projectQueue.shift()!;
    const projectName = path.basename(resolvedPath);
    const currentId = ++completedCount;

    try {
      // Idempotency: Fetch existing hashes for this project
      const existingRows = await client.execute({
        sql: "SELECT metadata FROM snippet_content WHERE json_extract(metadata, '$.project') = ?",
        args: [projectName],
      });
      const indexedFiles = new Map<string, string>();
      for (const row of existingRows.rows) {
        if (row.metadata) {
          try {
            const meta = JSON.parse(row.metadata as string);
            if (meta.path && meta.hash) indexedFiles.set(meta.path, meta.hash);
          } catch (e) {}
        }
      }

      const allFiles = await getAllFiles(resolvedPath);
      const allProjectChunks: { text: string; metadata: Record<string, any> }[] = [];
      const filesToProcess: string[] = [];

      // Pass 1: Quick hash check
      for (const file of allFiles) {
        const relativePath = path.relative(resolvedPath, file).replace(/\\/g, "/");
        if (relativePath.includes(".uistate.json") || relativePath.includes(".git")) continue;
        
        const content = await fs.readFile(file, "utf8");
        const hash = crypto.createHash("sha256").update(content).digest("hex");

        if (indexedFiles.get(relativePath) === hash) continue;

        // Content changed or new file! Clear old chunks and re-index
        await client.execute({
           sql: "DELETE FROM snippet_content WHERE json_extract(metadata, '$.path') = ? AND json_extract(metadata, '$.project') = ?",
           args: [relativePath, projectName]
        });
        filesToProcess.push(file);
      }

      if (filesToProcess.length === 0) {
        console.log(`[${new Date().toLocaleTimeString()}] (${currentId}/${totalProjects}) Skipping ${projectName} (No changes).`);
        return processNextProject();
      }

      // Pass 2: Parallel process dirty files
      const FILE_CONCURRENCY = 10;
      for (let i = 0; i < filesToProcess.length; i += FILE_CONCURRENCY) {
        const batch = filesToProcess.slice(i, i + FILE_CONCURRENCY);
        const results = await Promise.all(batch.map(async (file) => {
          const relativePath = path.relative(resolvedPath, file).replace(/\\/g, "/");
          const content = await fs.readFile(file, "utf8");
          const hash = crypto.createHash("sha256").update(content).digest("hex");

          let processedContent = content;
          if (file.endsWith(".json")) {
            try {
              processedContent = JSON.stringify(pruneJson(JSON.parse(content)), null, 2);
            } catch (e) {}
          }

          const fileType = relativePath.split("/")[0] || "root";
          const doc = MDocument.fromText(`Project: ${projectName}\nFile: ${relativePath}\nType: ${fileType}\nContent:\n${processedContent}`, {
            metadata: { project: projectName, path: relativePath, type: "project-file", fileType, hash },
          });

          const docChunks = await doc.chunk({
            strategy: "recursive", maxSize: 2000, overlap: 200,
            separators: ["\n\n", "\n", " ", "}", "]", ";", ","],
          });

          return docChunks.map(c => ({
            text: c.text,
            metadata: { project: projectName, path: relativePath, type: "project-file", fileType, text: c.text, hash }
          }));
        }));
        results.forEach(chunks => allProjectChunks.push(...chunks));
      }

      const timestamp = new Date().toLocaleTimeString();
      process.stdout.write(`[${timestamp}] (${currentId}/${totalProjects}) Indexing ${projectName} [${allProjectChunks.length} chunks from ${filesToProcess.length} changed files]...\n`);
      await processAndUpsert(allProjectChunks, projectName, "snippet_content");
    } catch (e: any) {
      console.error(`\n[!] Failed to index project ${projectName}:`, e.message);
    }
    await processNextProject();
  }

  await Promise.all(Array.from({ length: CONCURRENCY }).map(() => processNextProject()));

  console.log("\n[6/6] Finalizing database (VACUUM)...");
  try {
    execSync(`sqlite3 "${dbPath}" "VACUUM;"`, { stdio: "inherit" });
  } catch (e) {}

  console.log("\n=== Pre-indexing complete! ===");
}

main().catch(console.error);
