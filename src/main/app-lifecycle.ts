import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  setGlobalMainWindow,
  getGlobalMainWindow,
  globalStore,
} from "./mastra";
import { appState, loadState } from "./state";
import { syncProjectToVectorStore, sleep } from "./utils";
import { setupIpcHandlers } from "./ipc";

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
    // Quick check if global DB exists and has rows
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

    await loadState();
    const mainWindow = createWindow();

    // Setup IPC handlers now that window is available
    setupIpcHandlers();

    ipcMain.handle("is-startup-complete", () => isStartupComplete);

    await sleep(500);
    if (appState.activeProjectId) {
      const p = appState.projects.find((p) => p.id === appState.activeProjectId);
      if (p) {
        await syncProjectToVectorStore(p.path);
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
}
