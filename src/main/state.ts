import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { AppState, Project } from "./types";

export let appState: AppState = { projects: [], activeProjectId: null };
export let encryptedApiKeys: Record<string, string> = {};

export const storagePath = path.join(app.getPath("userData"), "storage.json");
export const keysPath = path.join(app.getPath("userData"), "keys.bin");

export async function saveState() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeys, ...stateToSave } = appState;
    await fs.writeFile(storagePath, JSON.stringify(stateToSave, null, 2));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

export async function loadState() {
  try {
    const data = await fs.readFile(storagePath, "utf8");
    appState = JSON.parse(data);
  } catch (e) {
    appState = { projects: [], activeProjectId: null };
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = await fs.readFile(keysPath);
      try {
        encryptedApiKeys = JSON.parse(safeStorage.decryptString(buffer));
        console.log("[DEBUG] API keys loaded successfully using safeStorage.");
      } catch (e) {
        // Maybe it was saved as plain text before safeStorage was available or vice-versa?
        const text = buffer.toString();
        encryptedApiKeys = JSON.parse(text);
        console.log("[DEBUG] API keys loaded as plain text (safeStorage decryption failed).");
      }
    } else {
      console.warn(
        "[WARNING] safeStorage is not available. Attempting to load API keys as plain text.",
      );
      const data = await fs.readFile(keysPath, "utf8");
      encryptedApiKeys = JSON.parse(data);
    }
  } catch (e) {
    encryptedApiKeys = {};
  }
}

export async function saveKeys(keys: Record<string, string>) {
  // Trim keys to avoid whitespace issues
  const trimmedKeys: Record<string, string> = {};
  Object.keys(keys).forEach((k) => {
    trimmedKeys[k] = keys[k].trim();
  });

  encryptedApiKeys = { ...encryptedApiKeys, ...trimmedKeys };
  if (safeStorage.isEncryptionAvailable()) {
    try {
      await fs.writeFile(keysPath, safeStorage.encryptString(JSON.stringify(encryptedApiKeys)));
      console.log("[DEBUG] API keys saved successfully using safeStorage.");
    } catch (e: unknown) {
      const err = e as Error;
      console.error("[ERROR] Failed to save API keys with safeStorage:", err.message);
    }
  } else {
    console.error("[ERROR] safeStorage not available. Saving API keys as plain text.");
    await fs.writeFile(keysPath, JSON.stringify(encryptedApiKeys));
  }
}

export function setActiveProjectId(id: string | null) {
  appState.activeProjectId = id;
}

export function setAppState(s: AppState) {
  appState = s;
}

export function getActiveProject(): Project | undefined {
  if (!appState.activeProjectId) return undefined;
  return appState.projects.find((p) => p.id === appState.activeProjectId);
}
