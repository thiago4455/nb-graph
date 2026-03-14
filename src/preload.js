const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  onGraphData: (callback) => {
    ipcRenderer.on('graph-data', (event, data) => callback(data))
  },
  openNode: (nodeName) => {
    ipcRenderer.invoke('open-node', nodeName)
  }
})
