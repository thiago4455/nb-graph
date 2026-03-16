const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  onGraphData: (callback) => {
    ipcRenderer.on('graph-data', (event, data, is3D) => callback(data, is3D))
  },
  openNode: (nodeName) => {
    ipcRenderer.invoke('open-node', nodeName)
  },
  openExternal: (url) => {
    ipcRenderer.invoke('open-external', url)
  }
})
