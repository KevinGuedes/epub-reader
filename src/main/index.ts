import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import { openDatabase, type Db } from './db'
import { registerIpc } from './ipc'
import { isInside, Library } from './library'

// Book covers are served to the renderer through cover://book/<id> (must be registered before app is ready).
protocol.registerSchemesAsPrivileged([
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// Linux: the window class (X11) / app id (Wayland) must match the installed .desktop file, otherwise the shell can't
// associate the open window with its icon and shows a generic one. Must be set before the app is ready.
app.commandLine.appendSwitch('class', 'epub-reader')
app.setDesktopName('epub-reader.desktop')

let mainWindow: BrowserWindow | null = null
let db: Db | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#d9c8b4',
    title: 'EPUB Reader',
    // Window/taskbar icon on Linux (packaged builds also get it from electron-builder's build/icon.png).
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Developer tools are only wired up when running from source (the menu that normally offers them is gone).
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      const toggle = input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))
      if (toggle) {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  // Links inside books open in the system browser; the app itself never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol: scheme } = new URL(url)
      if (scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:') void shell.openExternal(url)
    } catch {
      /* malformed URL: ignore */
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    const coversDir = join(userData, 'covers')
    mkdirSync(coversDir, { recursive: true })

    db = openDatabase(join(userData, 'library.db'))
    const library = new Library(db, coversDir)

    protocol.handle('cover', (request) => {
      const id = Number(new URL(request.url).pathname.slice(1))
      const file = Number.isSafeInteger(id) ? library.getCoverPath(id) : null
      if (!file || !isInside(coversDir, resolve(file))) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    })

    registerIpc(db, library)

    // No application menu: its default accelerators (Ctrl +/-/0 zoom, F11, Ctrl+F...) would shadow the reader's own.
    Menu.setApplicationMenu(null)
    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => db?.close())
}
