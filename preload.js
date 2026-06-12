const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexGui", {
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  listDirectory: (relativePath) => ipcRenderer.invoke("fs:list", relativePath),
  readFile: (relativePath) => ipcRenderer.invoke("fs:read", relativePath),
  saveFile: (relativePath, content) => ipcRenderer.invoke("fs:save", relativePath, content),
  createFile: (parentPath, name) => ipcRenderer.invoke("fs:create-file", parentPath, name),
  createFolder: (parentPath, name) => ipcRenderer.invoke("fs:create-folder", parentPath, name),
  startTerminal: () => ipcRenderer.invoke("terminal:start"),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
  stopTerminal: (id) => ipcRenderer.invoke("terminal:stop", id),
  startChat: (prompt) => ipcRenderer.invoke("chat:start", prompt),
  stopChat: (id) => ipcRenderer.invoke("chat:stop", id),
  onTerminalData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
  onChatData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:data", handler);
    return () => ipcRenderer.removeListener("chat:data", handler);
  },
  onChatDone: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:done", handler);
    return () => ipcRenderer.removeListener("chat:done", handler);
  }
});
