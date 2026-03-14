const { app, BrowserWindow, ipcMain } = require('electron')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function getNotebookPath(notebookName) {
  const nbDir = process.env.NB_DIR || path.join(process.env.HOME, '.nb')
  return path.join(nbDir, notebookName)
}

function getDefaultNotebook() {
  const nbDir = process.env.NB_DIR || path.join(process.env.HOME, '.nb')
  const currentFile = path.join(nbDir, '.current')
  try {
    if (fs.existsSync(currentFile)) {
      return fs.readFileSync(currentFile, 'utf-8').trim()
    }
  } catch (e) {}
  return 'home'
}

function getNotesRecursively(dir, basePath = '') {
  const notes = []
  if (!fs.existsSync(dir)) return notes
  
  const items = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const item of items) {
    if (item.name.startsWith('.')) continue
    
    const fullPath = path.join(dir, item.name)
    const relativePath = path.join(basePath, item.name)
    
    if (item.isDirectory()) {
      notes.push(...getNotesRecursively(fullPath, relativePath))
    } else if (item.name.endsWith('.md') || item.name.endsWith('.markdown')) {
      notes.push({ 
        filename: item.name, 
        fullPath,
        relativePath: relativePath.replace(/\.(md|markdown)$/, '')
      })
    }
  }
  
  return notes
}

function getGraphData(notebook = 'home') {
  const nodes = []
  const links = []
  const nodeMap = new Map()
  const existingNotes = new Set()
  let nodeId = 0
  const nbPath = getNotebookPath(notebook)

  function getOrCreateNode(name, notebookName = notebook, isExternal = false, hasFile = true) {
    const key = `${notebookName}:${name}`
    if (!nodeMap.has(key)) {
      const id = nodeId++
      nodeMap.set(key, { id, name, notebook: notebookName, isExternal, hasFile })
      nodes.push({ id, name, notebook: notebookName, isExternal, hasFile })
    }
    return nodeMap.get(key)
  }

  try {
    const notes = getNotesRecursively(nbPath)
    
    for (const note of notes) {
      existingNotes.add(note.relativePath)
    }
    
    const noteContents = {}
    for (const note of notes) {
      try {
        const content = fs.readFileSync(note.fullPath, 'utf-8')
        noteContents[note.relativePath] = content
        getOrCreateNode(note.relativePath, notebook, false, true)
      } catch (e) {
        console.error(`Error reading note ${note.fullPath}:`, e.message)
      }
    }

    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
    for (const [filepath, content] of Object.entries(noteContents)) {
      const sourceNode = getOrCreateNode(filepath, notebook, false, true)
      let match
      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[1].trim()
        let targetNotebook = notebook
        let targetName = linkTarget

        if (linkTarget.includes(':')) {
          const colonIndex = linkTarget.indexOf(':')
          targetNotebook = linkTarget.substring(0, colonIndex)
          targetName = linkTarget.substring(colonIndex + 1)
        }

        targetName = targetName.replace(/\.md$/, '').replace(/\.markdown$/, '')
        
        const isExternal = targetNotebook !== notebook
        const targetNode = getOrCreateNode(targetName, targetNotebook, isExternal, existingNotes.has(targetName))
        links.push({ source: sourceNode.id, target: targetNode.id })
      }
    }
  } catch (e) {
    console.error('Error getting graph data:', e.message)
  }

  return { nodes, links }
}

const createWindow = () => {
  const win = new BrowserWindow({
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile('src/index.html')

  win.webContents.on('did-finish-load', () => {
    const notebookArg = process.argv.find(arg => arg.startsWith('--notebook='))?.split('=')[1]
    const notebook = notebookArg || getDefaultNotebook()
    const graphData = getGraphData(notebook)
    win.webContents.send('graph-data', graphData)
  })
}

app.whenReady().then(() => {
  createWindow()
})
