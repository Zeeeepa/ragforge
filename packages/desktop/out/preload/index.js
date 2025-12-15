"use strict";
const electron = require("electron");
const electronAPI = {
  docker: {
    check: () => electron.ipcRenderer.invoke("docker:check"),
    getInstallInstructions: () => electron.ipcRenderer.invoke("docker:getInstallInstructions")
  },
  neo4j: {
    check: () => electron.ipcRenderer.invoke("neo4j:check"),
    ensure: () => electron.ipcRenderer.invoke("neo4j:ensure"),
    start: () => electron.ipcRenderer.invoke("neo4j:start"),
    stop: () => electron.ipcRenderer.invoke("neo4j:stop"),
    getConnectionInfo: () => electron.ipcRenderer.invoke("neo4j:getConnectionInfo"),
    onProgress: (callback) => {
      electron.ipcRenderer.on("neo4j:progress", (_, msg) => callback(msg));
      return () => electron.ipcRenderer.removeAllListeners("neo4j:progress");
    }
  },
  shell: {
    openExternal: (url) => electron.ipcRenderer.invoke("shell:openExternal", url)
  },
  dialog: {
    selectFolder: () => electron.ipcRenderer.invoke("dialog:selectFolder")
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
