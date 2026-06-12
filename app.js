const api = window.codexGui;

const elements = {
  workspacePath: document.querySelector("#workspacePath"),
  fileTree: document.querySelector("#fileTree"),
  openWorkspaceButton: document.querySelector("#openWorkspaceButton"),
  newFileButton: document.querySelector("#newFileButton"),
  newFolderButton: document.querySelector("#newFolderButton"),
  refreshButton: document.querySelector("#refreshButton"),
  activeFileName: document.querySelector("#activeFileName"),
  fileState: document.querySelector("#fileState"),
  saveButton: document.querySelector("#saveButton"),
  editor: document.querySelector("#editor"),
  terminalTitle: document.querySelector("#terminalTitle"),
  terminalSurface: document.querySelector("#terminalSurface"),
  terminalStatus: document.querySelector("#terminalStatus"),
  restartTerminalButton: document.querySelector("#restartTerminalButton"),
  terminalClearButton: document.querySelector("#terminalClearButton"),
  terminalCtrlCButton: document.querySelector("#terminalCtrlCButton"),
  terminalFocusButton: document.querySelector("#terminalFocusButton"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  sendChatButton: document.querySelector("#sendChatButton"),
  stopChatButton: document.querySelector("#stopChatButton")
};

const state = {
  workspaceRoot: "",
  tree: [],
  loadedDirectories: new Map(),
  expandedDirectories: new Set(["."]),
  currentFile: null,
  dirty: false,
  terminalId: null,
  terminal: null,
  fitAddon: null,
  terminalResizeFrame: null,
  activeChatId: null,
  activeChatElement: null
};

init();

async function init() {
  bindEvents();
  bindIpcEvents();
  await loadWorkspace();
  await startTerminal();
  addMessage("system", "Ready", "Open a real folder, edit files in the middle, run commands below, and chat with Codex on the right.");
}

function bindEvents() {
  elements.openWorkspaceButton.addEventListener("click", openWorkspace);
  elements.refreshButton.addEventListener("click", refreshTree);
  elements.saveButton.addEventListener("click", saveCurrentFile);
  elements.newFileButton.addEventListener("click", () => createEntry("file"));
  elements.newFolderButton.addEventListener("click", () => createEntry("folder"));
  elements.restartTerminalButton.addEventListener("click", restartTerminal);
  elements.terminalClearButton.addEventListener("click", clearTerminal);
  elements.terminalCtrlCButton.addEventListener("click", () => sendTerminalInput("\u0003"));
  elements.terminalFocusButton.addEventListener("click", () => state.terminal?.focus());

  elements.editor.addEventListener("input", () => {
    if (!state.currentFile) {
      return;
    }

    state.dirty = true;
    renderFileState();
  });

  elements.editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveCurrentFile();
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const start = elements.editor.selectionStart;
      const end = elements.editor.selectionEnd;
      elements.editor.value = `${elements.editor.value.slice(0, start)}  ${elements.editor.value.slice(end)}`;
      elements.editor.selectionStart = start + 2;
      elements.editor.selectionEnd = start + 2;
      state.dirty = true;
      renderFileState();
    }
  });

  elements.chatForm.addEventListener("submit", sendChat);
  elements.stopChatButton.addEventListener("click", stopChat);
  window.addEventListener("resize", queueTerminalResize);
}

function bindIpcEvents() {
  api.onTerminalData(({ id, data }) => {
    if (!state.terminalId) {
      state.terminalId = id;
    }

    if (id === state.terminalId) {
      state.terminal?.write(data);
    }
  });

  api.onTerminalExit(({ id, code, signal }) => {
    if (id === state.terminalId) {
      state.terminal?.write(`\r\n[process exited: ${signal || (code ?? "done")}]\r\n`);
      state.terminalId = null;
      setTerminalStatus("Disconnected");
    }
  });

  api.onChatData(({ id, stream, data }) => {
    if (!state.activeChatId && state.activeChatElement) {
      state.activeChatId = id;
    }

    if (id !== state.activeChatId || !state.activeChatElement) {
      return;
    }

    appendToMessage(state.activeChatElement, stream === "stderr" ? stripAnsi(data) : stripAnsi(data));
  });

  api.onChatDone(async ({ id, code, signal, error, entries }) => {
    if (id !== state.activeChatId) {
      return;
    }

    if (error) {
      appendToMessage(state.activeChatElement, `\n${error}`);
    }

    appendToMessage(state.activeChatElement, `\n\n[Codex finished: ${signal || (code ?? "done")}]`);
    state.activeChatId = null;
    state.activeChatElement = null;
    setChatBusy(false);

    if (Array.isArray(entries)) {
      state.loadedDirectories.set(".", entries);
      renderTree();
    } else {
      await refreshTree();
    }
  });
}

async function loadWorkspace() {
  try {
    const workspace = await api.getWorkspace();
    applyWorkspace(workspace);
  } catch (error) {
    showError(error);
  }
}

async function openWorkspace() {
  if (!(await confirmLoseChanges())) {
    return;
  }

  try {
    const workspace = await api.openWorkspace();

    if (!workspace) {
      return;
    }

    applyWorkspace(workspace);
    clearEditor();
    await startTerminal();
  } catch (error) {
    showError(error);
  }
}

function applyWorkspace(workspace) {
  state.workspaceRoot = workspace.root;
  state.loadedDirectories.clear();
  state.expandedDirectories = new Set(["."]);
  state.loadedDirectories.set(".", workspace.entries || []);
  elements.workspacePath.textContent = workspace.root;
  renderTree();
}

async function refreshTree() {
  try {
    const entries = await api.listDirectory(".");
    state.loadedDirectories.set(".", entries);
    renderTree();
  } catch (error) {
    showError(error);
  }
}

async function toggleDirectory(entry) {
  if (state.expandedDirectories.has(entry.path)) {
    state.expandedDirectories.delete(entry.path);
    renderTree();
    return;
  }

  try {
    const entries = await api.listDirectory(entry.path);
    state.loadedDirectories.set(entry.path, entries);
    state.expandedDirectories.add(entry.path);
    renderTree();
  } catch (error) {
    showError(error);
  }
}

async function openFile(entry) {
  if (!(await confirmLoseChanges())) {
    return;
  }

  try {
    const file = await api.readFile(entry.path);
    state.currentFile = file.path;
    state.dirty = false;
    elements.activeFileName.textContent = file.path;
    elements.editor.value = file.content;
    renderFileState();
    renderTree();
  } catch (error) {
    showError(error);
  }
}

async function saveCurrentFile() {
  if (!state.currentFile) {
    return;
  }

  try {
    const result = await api.saveFile(state.currentFile, elements.editor.value);
    state.currentFile = result.path;
    state.dirty = false;
    renderFileState("Saved");
    await refreshParentDirectory(result.path);
  } catch (error) {
    showError(error);
  }
}

async function createEntry(type) {
  const parentPath = getCurrentParentPath();
  const label = type === "file" ? "file" : "folder";
  const name = window.prompt(`New ${label} name`);

  if (!name) {
    return;
  }

  try {
    const result =
      type === "file"
        ? await api.createFile(parentPath, name)
        : await api.createFolder(parentPath, name);

    state.loadedDirectories.set(parentPath || ".", result.entries);
    state.expandedDirectories.add(parentPath || ".");
    renderTree();

    if (type === "file") {
      await openFile({ path: result.path, type: "file" });
    }
  } catch (error) {
    showError(error);
  }
}

function getCurrentParentPath() {
  if (!state.currentFile) {
    return ".";
  }

  const pieces = state.currentFile.split("/");
  pieces.pop();
  return pieces.join("/") || ".";
}

async function refreshParentDirectory(filePath) {
  const pieces = filePath.split("/");
  pieces.pop();
  const parent = pieces.join("/") || ".";
  const entries = await api.listDirectory(parent);
  state.loadedDirectories.set(parent, entries);
  renderTree();
}

function clearEditor() {
  state.currentFile = null;
  state.dirty = false;
  elements.editor.value = "";
  elements.activeFileName.textContent = "No file selected";
  renderFileState();
}

async function confirmLoseChanges() {
  if (!state.dirty) {
    return true;
  }

  return window.confirm("Discard unsaved editor changes?");
}

function renderTree() {
  elements.fileTree.replaceChildren(renderDirectory("."));
}

function renderDirectory(relativePath) {
  const fragment = document.createDocumentFragment();
  const entries = state.loadedDirectories.get(relativePath) || [];

  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `tree-row ${entry.type}${entry.path === state.currentFile ? " active" : ""}`;
    row.style.paddingLeft = relativePath === "." ? "8px" : "8px";
    row.dataset.path = entry.path;

    const icon = document.createElement("span");
    icon.textContent =
      entry.type === "directory"
        ? state.expandedDirectories.has(entry.path)
          ? "v"
          : ">"
        : fileIcon(entry.name);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = entry.name;

    row.append(icon, name);
    row.addEventListener("click", () => {
      if (entry.type === "directory") {
        toggleDirectory(entry);
      } else {
        openFile(entry);
      }
    });

    fragment.append(row);

    if (entry.type === "directory" && state.expandedDirectories.has(entry.path)) {
      const childWrapper = document.createElement("div");
      childWrapper.className = "tree-children";
      childWrapper.append(renderDirectory(entry.path));
      fragment.append(childWrapper);
    }
  }

  if (entries.length === 0 && relativePath === ".") {
    const empty = document.createElement("p");
    empty.className = "message system";
    empty.textContent = "No visible files in this folder.";
    fragment.append(empty);
  }

  return fragment;
}

function fileIcon(fileName) {
  const extension = fileName.split(".").pop().toLowerCase();

  if (["js", "ts", "jsx", "tsx"].includes(extension)) {
    return "JS";
  }

  if (["css", "scss"].includes(extension)) {
    return "CSS";
  }

  if (["html", "htm"].includes(extension)) {
    return "HTML";
  }

  if (["json", "toml", "yaml", "yml"].includes(extension)) {
    return "{}";
  }

  return "--";
}

function renderFileState(label) {
  elements.saveButton.disabled = !state.currentFile || !state.dirty;

  if (!state.currentFile) {
    elements.fileState.textContent = "Ready";
    return;
  }

  elements.fileState.textContent = state.dirty ? "Unsaved" : label || "Saved";
}

async function startTerminal() {
  try {
    ensureTerminal();
    setTerminalStatus("Connecting");
    const session = await api.startTerminal();
    state.terminalId = session.id;
    elements.terminalTitle.textContent = session.cwd;
    clearTerminal();
    setTerminalStatus("Connected");
    queueTerminalResize();
    state.terminal?.focus();
  } catch (error) {
    setTerminalStatus("Error");
    showError(error);
  }
}

async function restartTerminal() {
  if (state.terminalId) {
    await api.stopTerminal(state.terminalId).catch(() => {});
  }

  clearTerminal();
  await startTerminal();
}

async function sendChat(event) {
  event.preventDefault();

  const prompt = elements.chatInput.value.trim();
  if (!prompt || state.activeChatId) {
    return;
  }

  addMessage("user", "You", prompt);
  const assistant = addMessage("assistant", "Codex", "");
  state.activeChatElement = assistant;
  elements.chatInput.value = "";
  setChatBusy(true);

  try {
    const { id } = await api.startChat(prompt);
    state.activeChatId = id;
  } catch (error) {
    appendToMessage(assistant, error.message);
    state.activeChatElement = null;
    state.activeChatId = null;
    setChatBusy(false);
  }
}

async function stopChat() {
  if (!state.activeChatId) {
    return;
  }

  await api.stopChat(state.activeChatId);
  state.activeChatId = null;
  appendToMessage(state.activeChatElement, "\n[Stopped]");
  state.activeChatElement = null;
  setChatBusy(false);
}

function setChatBusy(isBusy) {
  elements.sendChatButton.disabled = isBusy;
  elements.stopChatButton.disabled = !isBusy;
  elements.chatInput.disabled = isBusy;
}

function addMessage(kind, label, content) {
  const message = document.createElement("article");
  message.className = `message ${kind}`;

  const heading = document.createElement("p");
  heading.className = "label";
  heading.textContent = label;

  const body = document.createElement("pre");
  body.textContent = content;

  message.append(heading, body);
  elements.chatLog.append(message);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  return message;
}

function appendToMessage(message, content) {
  if (!message) {
    return;
  }

  const body = message.querySelector("pre");
  body.textContent += content;
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function showError(error) {
  const message = error && error.message ? error.message : String(error);
  addMessage("system", "Error", message);
}

function ensureTerminal() {
  if (state.terminal) {
    return;
  }

  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    cursorInactiveStyle: "outline",
    fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    tabStopWidth: 2,
    allowTransparency: true,
    theme: {
      background: "#0f1410",
      foreground: "#d5f2cf",
      cursor: "#8be18b",
      cursorAccent: "#0f1410",
      selectionBackground: "rgba(139, 225, 139, 0.28)",
      black: "#111612",
      red: "#ff7f6e",
      green: "#8be18b",
      yellow: "#f1bd67",
      blue: "#82cfff",
      magenta: "#ff9fd2",
      cyan: "#7de8dc",
      white: "#e7f2e1",
      brightBlack: "#55604f",
      brightRed: "#ff9d91",
      brightGreen: "#acf7ac",
      brightYellow: "#ffd696",
      brightBlue: "#abdfff",
      brightMagenta: "#ffbbe2",
      brightCyan: "#b1f7ee",
      brightWhite: "#fbfff8"
    }
  });
  const fitAddon = new FitAddon.FitAddon();

  term.loadAddon(fitAddon);
  term.open(elements.terminalSurface);
  term.onData((data) => {
    sendTerminalInput(data);
  });
  term.onResize(({ cols, rows }) => {
    resizeTerminal(cols, rows);
  });

  elements.terminalSurface.addEventListener("click", () => {
    term.focus();
  });

  state.terminal = term;
  state.fitAddon = fitAddon;
}

function clearTerminal() {
  if (state.terminal) {
    state.terminal.clear();
    state.terminal.reset();
  }
}

function queueTerminalResize() {
  if (!state.terminal || !state.fitAddon) {
    return;
  }

  if (state.terminalResizeFrame) {
    cancelAnimationFrame(state.terminalResizeFrame);
  }

  state.terminalResizeFrame = requestAnimationFrame(() => {
    state.terminalResizeFrame = null;
    state.fitAddon.fit();
    resizeTerminal(state.terminal.cols, state.terminal.rows);
  });
}

async function sendTerminalInput(data) {
  if (!state.terminalId) {
    return;
  }

  await api.writeTerminal(state.terminalId, data);
}

async function resizeTerminal(cols, rows) {
  if (!state.terminalId || !cols || !rows) {
    return;
  }

  await api.resizeTerminal(state.terminalId, cols, rows);
}

function setTerminalStatus(label) {
  elements.terminalStatus.textContent = label;
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
