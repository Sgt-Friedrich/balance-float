const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const CONFIG_NAME = 'config.json';
const DEFAULT_CONFIG = {
  deepseekKey: '',
  vultrKey: '',
  refreshMinutes: 15,
  opacity: 0.86,
  autoStart: false,
  startHidden: false
};

let tray;
let win;
let lastPayload = null;
let refreshTimer;

const appIcon = () => {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  return nativeImage.createFromPath(iconPath);
};

const configPath = () => path.join(app.getPath('userData'), CONFIG_NAME);

function encryptSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) return `plain:${value}`;
  return `enc:${safeStorage.encryptString(value).toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  if (value.startsWith('plain:')) return value.slice(6);
  if (!value.startsWith('enc:')) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  } catch {
    return '';
  }
}

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      deepseekKey: decryptSecret(raw.deepseekKey),
      vultrKey: decryptSecret(raw.vultrKey)
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  const persisted = {
    ...DEFAULT_CONFIG,
    ...config,
    refreshMinutes: Math.max(1, Number(config.refreshMinutes) || DEFAULT_CONFIG.refreshMinutes),
    opacity: Math.min(1, Math.max(0.35, Number(config.opacity) || DEFAULT_CONFIG.opacity)),
    deepseekKey: encryptSecret(config.deepseekKey),
    vultrKey: encryptSecret(config.vultrKey)
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function publicConfig() {
  const config = readConfig();
  return {
    ...config,
    deepseekKeyMasked: maskKey(config.deepseekKey),
    vultrKeyMasked: maskKey(config.vultrKey),
    deepseekKey: '',
    vultrKey: ''
  };
}

function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Balance-Float/1.0'
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = {};
        try {
          json = body ? JSON.parse(body) : {};
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: invalid JSON`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = json.error?.message || json.message || body || `HTTP ${res.statusCode}`;
          reject(new Error(message));
          return;
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchDeepSeek(key) {
  const data = await requestJson('https://api.deepseek.com/user/balance', key);
  const balances = Array.isArray(data.balance_infos) ? data.balance_infos : [];
  const total = balances.map((item) => `${item.currency} ${item.total_balance}`).join(' / ') || '未知';
  return {
    name: 'DeepSeek',
    ok: true,
    available: Boolean(data.is_available),
    primary: total,
    detail: balances.map((item) => `${item.currency}: 赠金 ${item.granted_balance}, 充值 ${item.topped_up_balance}`).join('\n')
  };
}

async function fetchVultr(key) {
  const data = await requestJson('https://api.vultr.com/v2/account', key);
  const account = data.account || {};
  return {
    name: 'Vultr',
    ok: true,
    available: true,
    primary: `余额 ${account.balance ?? '未知'}`,
    detail: `待结算 ${account.pending_charges ?? '未知'}${account.last_payment_date ? `\n上次付款 ${account.last_payment_date}` : ''}`
  };
}

async function refreshBalances() {
  const config = readConfig();
  const jobs = [];
  if (config.deepseekKey) jobs.push(fetchDeepSeek(config.deepseekKey));
  if (config.vultrKey) jobs.push(fetchVultr(config.vultrKey));

  const checkedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  if (!jobs.length) {
    lastPayload = { checkedAt, items: [], message: '请先在设置中填写 API Key' };
  } else {
    const settled = await Promise.allSettled(jobs);
    lastPayload = {
      checkedAt,
      items: settled.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        return {
          name: index === 0 && config.deepseekKey ? 'DeepSeek' : 'Vultr',
          ok: false,
          available: false,
          primary: '获取失败',
          detail: result.reason?.message || '未知错误'
        };
      })
    };
  }
  if (win && !win.isDestroyed()) win.webContents.send('balances:update', lastPayload);
  updateTray();
  return lastPayload;
}

function positionWindow() {
  if (!win) return;
  const display = screen.getPrimaryDisplay().workArea;
  const [width, height] = win.getSize();
  win.setPosition(display.x + display.width - width - 18, display.y + 18);
}

function createWindow() {
  const config = readConfig();
  win = new BrowserWindow({
    width: 330,
    height: 230,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    opacity: config.opacity,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer.html'));
  win.once('ready-to-show', () => {
    positionWindow();
    if (!config.startHidden) win.show();
    refreshBalances();
  });
  win.on('blur', () => {
    if (readConfig().startHidden) return;
  });
}

function showWindow() {
  if (!win) createWindow();
  positionWindow();
  win.show();
  win.focus();
}

function hideWindow() {
  if (win) win.hide();
}

function updateTray() {
  if (!tray) return;
  const status = lastPayload?.items?.map((item) => `${item.name}: ${item.primary}`).join('\n') || 'Balance Float';
  tray.setToolTip(status);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示余额窗', click: showWindow },
    { label: '立即刷新', click: refreshBalances },
    { label: '隐藏', click: hideWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}

function scheduleRefresh(minutes) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshBalances, Math.max(1, minutes) * 60 * 1000);
}

function createTray() {
  tray = new Tray(appIcon());
  tray.on('click', () => {
    if (win?.isVisible()) hideWindow();
    else showWindow();
  });
  updateTray();
}

function syncLoginItem(autoStart) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(autoStart),
    path: process.execPath
  });
}

ipcMain.handle('config:get', () => publicConfig());
ipcMain.handle('config:save', (_event, patch) => {
  const current = readConfig();
  const next = {
    ...current,
    ...patch,
    deepseekKey: patch.deepseekKey || current.deepseekKey,
    vultrKey: patch.vultrKey || current.vultrKey
  };
  writeConfig(next);
  syncLoginItem(next.autoStart);
  if (win) win.setOpacity(next.opacity);
  scheduleRefresh(next.refreshMinutes);
  refreshBalances();
  return publicConfig();
});
ipcMain.handle('balances:refresh', refreshBalances);
ipcMain.handle('window:hide', hideWindow);
ipcMain.handle('window:quit', () => app.quit());

app.whenReady().then(() => {
  const config = readConfig();
  syncLoginItem(config.autoStart);
  createWindow();
  createTray();
  scheduleRefresh(config.refreshMinutes);
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {});
