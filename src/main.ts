import { app } from "electron";
import started from "electron-squirrel-startup";
import { setupAppLifecycle } from "./main/app-lifecycle";

// Handle startup early
if (started) {
  app.quit();
}

// System-wide GPU settings
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

// Initialize application lifecycle and Electron events
setupAppLifecycle();
