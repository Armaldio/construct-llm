# Objective
Design and implement a standalone MCP (Model Context Protocol) server for the Construct LLM app. The server will provide simple file search, reading, and listing tools for the currently active Construct 3 project, without relying on the app's vector embeddings. It will run as a separate Node.js process using stdio, making it directly usable by external AI clients (like Claude Desktop or Cursor).

# Key Files & Context
- `package.json`: Need to add the `@modelcontextprotocol/sdk` dependency and a `"bin"` entry.
- `src/mcp/utils.ts`: Utility to resolve the Electron `userData` path cross-platform and read `storage.json` to find the active project.
- `src/mcp/tools.ts`: Tool logic implementations.
- `src/mcp/server.ts`: The MCP server definition and setup using `StdioServerTransport`.
- `bin/mcp.js`: The executable CLI script.

# Implementation Steps

1. **Install Dependencies**:
   - Run `npm install @modelcontextprotocol/sdk`.

2. **Create Utility Module (`src/mcp/utils.ts`)**:
   - Implement `getUserDataPath()` which determines the OS-specific path for `construct-llm`'s `userData` directory (e.g., `~/.config/construct-llm` on Linux, `%APPDATA%\construct-llm` on Windows, `~/Library/Application Support/construct-llm` on macOS).
   - Implement `getActiveProject()` which reads `<userData>/storage.json`, parses `appState`, and returns the `Project` object for the `activeProjectId`.

3. **Implement MCP Tools (`src/mcp/tools.ts`)**:
   - Define schemas and execute functions for:
     - `get_active_project`: Returns information about the currently active Construct 3 project.
     - `list_project_files`: Recursively lists files inside the active project's directory.
     - `read_project_file`: Reads a specified file's contents from the active project.
     - `search_project_files`: Searches for text/regex within the active project files (using Node's `fs` or a child process for `grep`/`findstr`).

4. **Implement MCP Server (`src/mcp/server.ts`)**:
   - Instantiate the MCP `Server` from the SDK.
   - Register tool handlers mapping to `tools.ts`.
   - Setup `StdioServerTransport` to listen to `stdin` and output to `stdout`.

5. **Create CLI Entry Point (`bin/mcp.js`)**:
   - Create a simple script that uses `tsx` or standard Node execution to run `src/mcp/server.ts`.
   - Update `package.json` to include `"bin": { "construct-llm-mcp": "./bin/mcp.js" }` to allow global/local npx execution.

# Verification & Testing
- Verify the server starts and waits for stdio input via `npx tsx src/mcp/server.ts`.
- Mock a JSON-RPC request for `ListToolsRequest` and `CallToolRequest` to verify tools return correct file data based on `storage.json`.
- Test cross-platform path resolution logic to ensure `userData` is correctly located without the `electron` module (since this runs outside Electron).