const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  onGraphData: (callback) => {
    ipcRenderer.on('graph-data', (event, data) => callback(data))
  }
})
