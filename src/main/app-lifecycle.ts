import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setGlobalMainWindow, getGlobalMainWindow, globalStore, globalDbPath } from "./mastra";
import { appState, loadState } from "./state";
import { startWatchingProject, sleep } from "./utils";
import { setupIpcHandlers } from "./ipc";
import { getLatestDbAssetUrl, downloadFile } from "./downloader";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

export let isStartupComplete = false;

export const createWindow = () => {
  let mainWindow = getGlobalMainWindow();
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  setGlobalMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  return mainWindow;
};

export function setupAppLifecycle() {
  app.on("ready", async () => {
    await loadState();
    const mainWindow = createWindow();

    // Check if global DB exists
    const dbExists = existsSync(globalDbPath);
    let dbReady = dbExists;

    if (!dbExists) {
      console.log("[App] Database missing. Starting download...");
      try {
        const owner = "armaldio"; // Placeholder or from config
        const repo = "construct-llm";
        const tagName = "database-assets";

        mainWindow?.webContents.send("startup-progress", {
          message: "Fetching database info...",
          percent: 0,
        });

        const downloadUrl = await getLatestDbAssetUrl(owner, repo, tagName);
        if (downloadUrl) {
          await downloadFile(downloadUrl, globalDbPath, (p) => {
            mainWindow?.webContents.send("startup-progress", {
              message: `Downloading database... (${p.percent}%)`,
              percent: p.percent,
              loaded: p.transferred,
              total: p.total,
            });
          });
          dbReady = true;
        } else {
          console.error("[App] Could not find database asset in release.");
          mainWindow?.webContents.send("startup-progress", {
            message: "Error: Database asset not found.",
            error: true,
          });
        }
      } catch (err: any) {
        console.error("[App] Download failed:", err);
        mainWindow?.webContents.send("startup-progress", {
          message: `Download failed: ${err.message}`,
          error: true,
        });
      }
    }

    if (dbReady) {
      // Quick check if global DB is valid
      try {
        const dummyVector = new Array(384).fill(0.1);
        await globalStore.query({
          indexName: "manual_content",
          queryVector: dummyVector,
          topK: 1,
        });
      } catch (e: any) {
        console.warn(`Initial manual DB check failed: ${e.message}`);
      }
    }

    // Setup IPC handlers now that window is available
    setupIpcHandlers();

    ipcMain.handle("is-startup-complete", () => isStartupComplete);

    await sleep(500);
    if (appState.activeProjectId) {
      const p = appState.projects.find((p) => p.id === appState.activeProjectId);
      if (p) {
        startWatchingProject(p.id, p.path);
      }
    }

    isStartupComplete = true;
    if (mainWindow) {
      mainWindow.webContents.send("startup-complete");
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("will-quit", () => {
    // Perform any final cleanup of DB connections if needed
    console.log("[App] Quitting... cleaning up resources.");
  });
}
