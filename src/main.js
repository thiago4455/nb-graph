const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const { execSync, exec } = require('child_process')
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
        relativePath: relativePath
      })
    }
  }
  
  return notes
}

function extractTitle(content, filename) {
  const lines = content.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      return trimmed.substring(2).trim()
    }
  }
  
  if (content.includes('---')) {
    const yamlMatch = content.match(/title:\s*(.+)/)
    if (yamlMatch) {
      return yamlMatch[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  
  return filename.replace(/[^/]+\//, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
}

function extractMetadata(content) {
  const metadata = {}
  if (!content.includes('---')) return metadata
  
  const yamlMatch = content.match(/---\n([\s\S]*?)\n---/)
  if (!yamlMatch) return metadata
  
  const yamlContent = yamlMatch[1]
  const lines = yamlContent.split('\n')
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    
    const key = line.substring(0, colonIndex).trim()
    let value = line.substring(colonIndex + 1).trim()
    value = value.replace(/^["']|["']$/g, '')
    
    if (key && value) {
      metadata[key] = value
    }
  }
  
  return metadata
}

function getGraphData(notebook = 'home') {
  const nodes = []
  const links = []
  const nodeMap = new Map()
  const existingNotes = new Set()
  const linkCounts = new Map()
  let nodeId = 0
  const nbPath = getNotebookPath(notebook)

  function getOrCreateNode(name, notebookName = notebook, isExternal = false, hasFile = true, title = null, metadata = null) {
    const key = `${notebookName}:${name}`
    if (!nodeMap.has(key)) {
      const id = nodeId++
      nodeMap.set(key, { id, name, notebook: notebookName, isExternal, hasFile, title: title || name, metadata })
      nodes.push({ id, name, notebook: notebookName, isExternal, hasFile, title: title || name, metadata })
    }
    return nodeMap.get(key)
  }

  try {
    const notes = getNotesRecursively(nbPath)
    
    for (const note of notes) {
      existingNotes.add(note.relativePath)
    }
    
    const noteContents = {}
    const noteMetadata = {}
    for (const note of notes) {
      try {
        const content = fs.readFileSync(note.fullPath, 'utf-8')
        const title = extractTitle(content, note.filename)
        const metadata = extractMetadata(content)
        noteContents[note.relativePath] = content
        noteMetadata[note.relativePath] = metadata
        getOrCreateNode(note.relativePath, notebook, false, true, title, metadata)
      } catch (e) {
        console.error(`Error reading note ${note.fullPath}:`, e.message)
      }
    }

    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
    for (const [filepath, content] of Object.entries(noteContents)) {
      const sourceNode = getOrCreateNode(filepath, notebook, false, true)
      let match
      while ((match = linkRegex.exec(content)) !== null) {
        let linkTarget = match[1].trim()
        let targetNotebook = notebook
        let targetName = linkTarget

        if (linkTarget.includes(':')) {
          const colonIndex = linkTarget.indexOf(':')
          targetNotebook = linkTarget.substring(0, colonIndex).trim()
          targetName = linkTarget.substring(colonIndex + 1)
        }

        targetName = targetName.trim()
        
        const isExternal = targetNotebook !== notebook
        const targetNode = getOrCreateNode(targetName, targetNotebook, isExternal, existingNotes.has(targetName))
        links.push({ source: sourceNode.id, target: targetNode.id })
      }
    }

    for (const node of nodes) {
      node.linkCount = links.filter(l => l.source === node.id || l.target === node.id).length
    }
  } catch (e) {
    console.error('Error getting graph data:', e.message)
  }

  return { nodes, links }
}

const createWindow = () => {
  const win = new BrowserWindow({
    frame: false,
    backgroundColor: '#000000',
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
    const nbPath = getNotebookPath(notebook)

    const sendGraphData = () => {
      const graphData = getGraphData(notebook)
      win.webContents.send('graph-data', graphData)
    }

    sendGraphData()

    let debounceTimer
    fs.watch(nbPath, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.md') || filename.endsWith('.markdown') || filename.includes('.bookmark'))) {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(sendGraphData, 500)
      }
    })
  })
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('open-node', (event, nodeName) => {
    const doiMatch = nodeName.match(/^articles\/([^/]+)\.bookmark(\.md)?$/)
    if (doiMatch) {
      const doi = doiMatch[1].replace(/_/g, '/')
      exec(`kitty --hold bash -c "source ~/.bashrc && nb article ${doi}"`)
    } else {
      exec(`kitty --hold bash -c "source ~/.bashrc && nb edit ${nodeName}.md"`)
    }
  })
})
