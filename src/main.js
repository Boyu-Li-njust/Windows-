'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, Tray, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultData, normalizeData } = require('./task-model');

let mainWindow;
let tray;
let quitting = false;
let saveChain = Promise.resolve();
let expandedBounds = null;
let expandedSize = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

/**
 * @brief 返回任务数据与窗口偏好的本地存储路径。
 * @return 当前用户目录下的 JSON 文件路径。
 */
function getStorePath() {
  return path.join(app.getPath('userData'), 'desk-todo-data.json');
}

/**
 * @brief 读取并校验本地数据；文件不存在或损坏时返回安全默认值。
 * @return 标准化后的任务和窗口偏好。
 */
async function loadStore() {
  try {
    const content = await fs.readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(content);
    return {
      data: normalizeData(parsed.data),
      settings: {
        alwaysOnTop: Boolean(parsed.settings?.alwaysOnTop),
        locked: Boolean(parsed.settings?.locked),
        opacity: Number.isFinite(parsed.settings?.opacity) ? parsed.settings.opacity : 0.94,
        completedBehavior: ['keep', 'hide'].includes(parsed.settings?.completedBehavior) ? parsed.settings.completedBehavior : 'keep',
        bounds: parsed.settings?.bounds || null
      }
    };
  } catch {
    return { data: createDefaultData(), settings: { alwaysOnTop: false, locked: false, opacity: 0.94, completedBehavior: 'keep', bounds: null } };
  }
}

/**
 * @brief 串行写入本地数据，避免快速连续操作造成后一次保存被前一次覆盖。
 * @param payload 需要持久化的完整数据快照。
 * @return 写入任务对应的 Promise。
 */
function saveStore(payload) {
  saveChain = saveChain.then(async () => {
    await fs.mkdir(path.dirname(getStorePath()), { recursive: true });
    await fs.writeFile(getStorePath(), JSON.stringify(payload, null, 2), 'utf8');
  });
  return saveChain;
}

/**
 * @brief 将窗口恢复到可见屏幕区域，避免显示器变化后组件留在屏幕外。
 * @param bounds 上次保存的窗口位置和尺寸。
 * @return 可安全用于创建窗口的位置和尺寸。
 */
function getVisibleBounds(bounds) {
  const fallback = { width: 380, height: 620 };
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return fallback;
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const width = Math.min(Math.max(bounds.width || 380, 320), area.width);
  const height = Math.min(Math.max(bounds.height || 620, 360), area.height);
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height
  };
}

/**
 * @brief 在 Windows 上可靠地应用窗口置顶状态。
 * @param enabled 是否启用始终置顶。
 */
function applyAlwaysOnTop(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (enabled) {
    // 透明、无任务栏窗口在 floating 层级下可能仍被普通应用覆盖。
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.moveTop();
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
}

/**
 * @brief 创建无任务栏、可透明显示的桌面任务窗口并注册窗口生命周期。
 * @param settings 已读取的窗口偏好。
 */
function createWindow(settings) {
  const appIcon = path.join(__dirname, 'assets', 'taskbar-icon.ico');
  mainWindow = new BrowserWindow({
    ...getVisibleBounds(settings.bounds),
      minWidth: 64,
      minHeight: 64,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    resizable: true,
    hasShadow: false,
    title: '桌面待办',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  applyAlwaysOnTop(Boolean(settings.alwaysOnTop));
  mainWindow.setOpacity(Math.min(Math.max(settings.opacity, 0.55), 1));
  expandedBounds = mainWindow.getBounds();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    applyAlwaysOnTop(Boolean(settings.alwaysOnTop));
  });
  mainWindow.webContents.once('did-finish-load', () => {
    // 某些显卡或透明窗口环境不会触发 ready-to-show，加载完成后兜底显示。
    if (!mainWindow.isVisible()) mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

/**
 * @brief 创建系统托盘入口，使隐藏窗口仍可快速新增、切换置顶或退出。
 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'taskbar-icon.ico'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('桌面待办');
  tray.on('click', () => toggleWindow(false));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示／隐藏', click: () => toggleWindow(false) },
    { label: '快速添加', click: () => toggleWindow(true) },
    { type: 'separator' },
    { label: '切换置顶', click: () => mainWindow.webContents.send('command', 'toggle-always-on-top') },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

/**
 * @brief 显示或隐藏主窗口，并可在显示后直接聚焦新增输入框。
 * @param focusAdd 是否进入快速新增状态。
 */
function toggleWindow(focusAdd) {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !focusAdd) {
    mainWindow.hide();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  if (focusAdd) mainWindow.webContents.send('command', 'focus-add');
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  app.setAppUserModelId('com.desktodo.app');
  const store = await loadStore();
  createWindow(store.settings);
  createTray();
  globalShortcut.register('CommandOrControl+Alt+T', () => toggleWindow(true));

  ipcMain.handle('store:load', () => store);
  ipcMain.handle('startup:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('startup:set', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('shortcut:create', async () => {
    const shortcutPath = path.join(app.getPath('desktop'), '桌面待办.lnk');
    const shortcutIcon = path.join(__dirname, 'assets', 'floating-icon.ico');
    // shell.writeShortcutLink 要求 args 是字符串；传数组会生成无法启动的 .lnk。
    const target = process.execPath;
    const args = process.defaultApp ? `"${app.getAppPath()}"` : '';
    const created = shell.writeShortcutLink(shortcutPath, 'create', {
      target,
      args,
      description: '打开桌面待办任务清单',
      icon: shortcutIcon,
      iconIndex: 0,
      workingDirectory: app.getAppPath()
    });
    return { created, shortcutPath };
  });
  ipcMain.handle('store:save', async (_event, payload) => {
    const safePayload = {
      data: normalizeData(payload.data),
      settings: {
        alwaysOnTop: Boolean(payload.settings?.alwaysOnTop),
        locked: Boolean(payload.settings?.locked),
        opacity: Math.min(Math.max(Number(payload.settings?.opacity) || 0.94, 0.55), 1),
        completedBehavior: ['keep', 'hide'].includes(payload.settings?.completedBehavior) ? payload.settings.completedBehavior : 'keep',
        bounds: mainWindow.getBounds()
      }
    };
    applyAlwaysOnTop(safePayload.settings.alwaysOnTop);
    mainWindow.setOpacity(safePayload.settings.opacity);
    mainWindow.setMovable(!safePayload.settings.locked);
    await saveStore(safePayload);
    return safePayload;
  });
  ipcMain.on('window:hide', () => mainWindow.hide());
  ipcMain.handle('window:get-position', () => mainWindow.getPosition());
  ipcMain.on('window:move-by', (_event, dx, dy) => {
    if (!mainWindow || !mainWindow.isMovable()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(x + Number(dx || 0)), Math.round(y + Number(dy || 0)), false);
  });
  ipcMain.on('window:set-position', (_event, x, y) => {
    if (!mainWindow || !mainWindow.isMovable()) return;
    mainWindow.setPosition(Math.round(Number(x)), Math.round(Number(y)), false);
  });
  ipcMain.on('window:set-compact', (_event, compact) => {
    if (compact) {
      const currentBounds = mainWindow.getBounds();
      // 只保存正常窗口尺寸；位置始终以悬浮图标当前所在位置为准。
      expandedSize = { width: currentBounds.width, height: currentBounds.height };
      expandedBounds = currentBounds;
      mainWindow.setSize(76, 76, true);
      // 悬浮条始终保持置顶，不受普通窗口模式设置影响。
      applyAlwaysOnTop(true);
    } else if (expandedSize || expandedBounds) {
      const [x, y] = mainWindow.getPosition();
      const size = expandedSize || expandedBounds;
      mainWindow.setBounds({ x, y, width: size.width, height: size.height }, true);
    }
    // Windows 调整透明窗口尺寸后可能重建原生窗口层级，需要重新置顶。
    if (mainWindow.isAlwaysOnTop()) applyAlwaysOnTop(true);
  });
  // 紧凑图标窗口很小，使用原生菜单避免右键配置项被窗口边界裁切。
  ipcMain.on('window:show-menu', () => {
    if (!mainWindow) return;
    const menu = Menu.buildFromTemplate([
      {
        label: '透明度', submenu: [100, 90, 75, 60].map((value) => ({
          label: `${value}%`, click: () => mainWindow.webContents.send('command', `set-opacity:${value / 100}`)
        }))
      },
      { type: 'separator' },
      { label: '恢复任务框图', click: () => mainWindow.webContents.send('command', 'restore-window') }
    ]);
    menu.popup({ window: mainWindow });
  });
  ipcMain.on('window:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.on('window:minimize', () => mainWindow.minimize());
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (event) => event.preventDefault());
