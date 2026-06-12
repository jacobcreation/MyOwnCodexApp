const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const crypto = require("crypto");
const pty = require("node-pty");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("in-process-gpu");

let mainWindow;
let workspaceRoot = process.cwd();
const terminalSessions = new Map();
const chatSessions = new Map();

const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  ".parcel-cache",
  "coverage"
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#12110f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  for (const session of terminalSessions.values()) {
    session.process.kill();
  }
  for (const session of chatSessions.values()) {
    session.process.kill();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function ensureInsideWorkspace(relativePath = ".") {
  const targetPath = path.resolve(workspaceRoot, relativePath || ".");
  const rootWithSeparator = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : `${workspaceRoot}${path.sep}`;

  if (targetPath !== workspaceRoot && !targetPath.startsWith(rootWithSeparator)) {
    throw new Error("Path is outside the selected workspace.");
  }

  return targetPath;
}

function toRelativePath(absolutePath) {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));

  if (sample.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    const isControlCharacter = byte < 7 || (byte > 13 && byte < 32);
    if (isControlCharacter) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / sample.length > 0.1;
}

async function listDirectory(relativePath = ".") {
  const directoryPath = ensureInsideWorkspace(relativePath);
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") {
      continue;
    }

    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    const stats = await fs.stat(absolutePath);

    results.push({
      name: entry.name,
      path: toRelativePath(absolutePath),
      type: entry.isDirectory() ? "directory" : "file",
      size: stats.size,
      modifiedAt: stats.mtimeMs
    });
  }

  return results.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

ipcMain.handle("workspace:get", async () => {
  return {
    root: workspaceRoot,
    entries: await listDirectory(".")
  };
});

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Workspace",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  workspaceRoot = result.filePaths[0];
  restartTerminals();

  return {
    root: workspaceRoot,
    entries: await listDirectory(".")
  };
});

ipcMain.handle("fs:list", async (_event, relativePath) => {
  return listDirectory(relativePath || ".");
});

ipcMain.handle("fs:read", async (_event, relativePath) => {
  const filePath = ensureInsideWorkspace(relativePath);
  const stats = await fs.stat(filePath);

  if (stats.size > 8 * 1024 * 1024) {
    throw new Error("This file is larger than 8 MB. Open it with a dedicated editor.");
  }

  const buffer = await fs.readFile(filePath);

  if (looksBinary(buffer)) {
    throw new Error("This file cannot be opened because it appears to be binary.");
  }

  const content = buffer.toString("utf8");
  return {
    path: toRelativePath(filePath),
    content,
    modifiedAt: stats.mtimeMs
  };
});

ipcMain.handle("fs:save", async (_event, relativePath, content) => {
  const filePath = ensureInsideWorkspace(relativePath);
  await fs.writeFile(filePath, content, "utf8");
  const stats = await fs.stat(filePath);
  return {
    path: toRelativePath(filePath),
    modifiedAt: stats.mtimeMs
  };
});

ipcMain.handle("fs:create-file", async (_event, parentPath, name) => {
  const safeName = sanitizeName(name);
  const filePath = ensureInsideWorkspace(path.join(parentPath || ".", safeName));
  await fs.writeFile(filePath, "", { flag: "wx" });
  return {
    path: toRelativePath(filePath),
    entries: await listDirectory(parentPath || ".")
  };
});

ipcMain.handle("fs:create-folder", async (_event, parentPath, name) => {
  const safeName = sanitizeName(name);
  const folderPath = ensureInsideWorkspace(path.join(parentPath || ".", safeName));
  await fs.mkdir(folderPath);
  return {
    path: toRelativePath(folderPath),
    entries: await listDirectory(parentPath || ".")
  };
});

function sanitizeName(name) {
  const trimmed = String(name || "").trim();

  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
    throw new Error("Use a simple file or folder name.");
  }

  return trimmed;
}

ipcMain.handle("terminal:start", (event) => {
  const id = crypto.randomUUID();
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
  const args = process.platform === "win32" ? ["-NoLogo"] : ["-i"];
  const terminalProcess = pty.spawn(shell, args, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor"
    },
    name: "xterm-256color",
    cols: 120,
    rows: 28
  });

  terminalSessions.set(id, { process: terminalProcess, webContents: event.sender });

  terminalProcess.onData((data) => {
    event.sender.send("terminal:data", { id, data: data.toString() });
  });

  terminalProcess.onExit(({ exitCode, signal }) => {
    terminalSessions.delete(id);
    event.sender.send("terminal:exit", { id, code: exitCode, signal });
  });

  return { id, cwd: workspaceRoot };
});

ipcMain.handle("terminal:write", (_event, id, data) => {
  const session = terminalSessions.get(id);

  if (!session) {
    throw new Error("Terminal session is not running.");
  }

  session.process.write(data);
  return true;
});

ipcMain.handle("terminal:resize", (_event, id, cols, rows) => {
  const session = terminalSessions.get(id);

  if (!session) {
    return false;
  }

  if (cols > 1 && rows > 1) {
    session.process.resize(cols, rows);
  }

  return true;
});

ipcMain.handle("terminal:stop", (_event, id) => {
  const session = terminalSessions.get(id);

  if (session) {
    session.process.kill();
    terminalSessions.delete(id);
  }

  return true;
});

function restartTerminals() {
  for (const session of terminalSessions.values()) {
    session.process.kill();
  }
  terminalSessions.clear();
}

ipcMain.handle("chat:start", (event, prompt) => {
  const id = crypto.randomUUID();
  const codexProcess = spawn(
    "codex",
    [
      "--ask-for-approval",
      "never",
      "exec",
      "--cd",
      workspaceRoot,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-"
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NO_COLOR: "1"
      }
    }
  );

  chatSessions.set(id, { process: codexProcess });
  codexProcess.stdin.end(prompt);

  codexProcess.stdout.on("data", (data) => {
    event.sender.send("chat:data", { id, stream: "stdout", data: data.toString() });
  });

  codexProcess.stderr.on("data", (data) => {
    event.sender.send("chat:data", { id, stream: "stderr", data: data.toString() });
  });

  codexProcess.on("error", (error) => {
    chatSessions.delete(id);
    event.sender.send("chat:done", {
      id,
      code: 1,
      error: error.message
    });
  });

  codexProcess.on("exit", async (code, signal) => {
    chatSessions.delete(id);
    event.sender.send("chat:done", {
      id,
      code,
      signal,
      entries: await listDirectory(".").catch(() => [])
    });
  });

  return { id };
});

ipcMain.handle("chat:stop", (_event, id) => {
  const session = chatSessions.get(id);

  if (session) {
    session.process.kill();
    chatSessions.delete(id);
  }

  return true;
});
