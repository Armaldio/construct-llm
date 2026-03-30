import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { IncomingMessage } from "node:http";
import AdmZip from "adm-zip";

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

export async function getLatestDbAssetUrl(
  owner: string,
  repo: string,
  tagName: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`;
    const options = {
      headers: {
        "User-Agent": "Construct-LLM-App",
      },
    };

    https
      .get(url, options, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: any) => (data += chunk));
        res.on("end", () => {
          try {
            const release = JSON.parse(data);
            const asset = release.assets?.find((a: any) => a.name === "prebuilt-assets.db.zip");
            resolve(asset?.browser_download_url || null);
          } catch (e) {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

export function downloadFile(
  url: string,
  targetPath: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let existingSize = 0;
    if (fs.existsSync(targetPath)) {
      existingSize = fs.statSync(targetPath).size;
    }

    const options = {
      headers: {
        "User-Agent": "Construct-LLM-App",
        ...(existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {}),
      },
    };

    const request = https.get(url, options, (response: IncomingMessage) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location!, targetPath, onProgress)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode === 416) {
        // Range not satisfiable -> file already complete or server doesn't support it
        return resolve();
      }

      if (response.statusCode !== 200 && response.statusCode !== 206) {
        return reject(new Error(`Server responded with ${response.statusCode}`));
      }

      const totalSize = parseInt(response.headers["content-length"] || "0", 10) + existingSize;
      const fileStream = fs.createWriteStream(targetPath, { flags: existingSize > 0 ? "a" : "w" });

      let downloaded = existingSize;

      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress({
          percent: totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0,
          transferred: downloaded,
          total: totalSize,
        });
      });

      response.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });

      fileStream.on("error", (err: Error) => {
        // fs.unlink(targetPath, () => {}); // Delete partial file on error? Maybe not if we want resume
        reject(err);
      });
    });

    request.on("error", (err: Error) => {
      reject(err);
    });
  });
}

export async function decompressFile(zipPath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(targetDir, true);
      // Optional: Delete the zip after extraction
      fs.unlinkSync(zipPath);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
