const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const {
  buildClaudeCodeUsage,
  buildCodexCombinedUsage,
  claudeUsagePath,
  readJsonSafe
} = require('./agent-usage');

const CONFIG_NAME = 'config.json';
const DEFAULT_CONFIG = {
  deepseekKey: '',
  vultrKey: '',
  aliyunAccessKeyId: '',
  aliyunAccessKeySecret: '',
  aliyunRegion: 'cn-hangzhou',
  tencentSecretId: '',
  tencentSecretKey: '',
  tencentRegion: 'ap-guangzhou',
  refreshMinutes: 15,
  opacity: 0.86,
  autoStart: false,
  startHidden: false,
  compactMode: false
};
const FULL_SIZE = { width: 330, height: 430 };
const COMPACT_SIZE = { width: 136, height: 54 };
const SECRET_FIELDS = [
  'deepseekKey',
  'vultrKey',
  'aliyunAccessKeyId',
  'aliyunAccessKeySecret',
  'tencentSecretId',
  'tencentSecretKey'
];

let tray;
let win;
let lastPayload = null;
let refreshTimer;
let agentRefreshTimer;
let agentPollTimer;
let agentWatchers = [];

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
    const config = { ...DEFAULT_CONFIG, ...raw };
    SECRET_FIELDS.forEach((field) => {
      config[field] = decryptSecret(raw[field]);
    });
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  const persisted = {
    ...DEFAULT_CONFIG,
    ...config,
    refreshMinutes: Math.max(1, Number(config.refreshMinutes) || DEFAULT_CONFIG.refreshMinutes),
    opacity: Math.min(1, Math.max(0.35, Number(config.opacity) || DEFAULT_CONFIG.opacity))
  };
  SECRET_FIELDS.forEach((field) => {
    persisted[field] = encryptSecret(config[field]);
  });
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function walkRecentFiles(root, predicate, limit = 60) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < 1000) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (predicate(entry.name)) {
        try {
          const stat = fs.statSync(fullPath);
          out.push({ path: fullPath, mtimeMs: stat.mtimeMs });
        } catch {}
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

function readFileTail(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '未知';
  return `$${Math.abs(amount).toFixed(2)}`;
}

function formatSignedUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '未知';
  return `${amount < 0 ? '-' : ''}${formatUsd(amount)}`;
}

function formatGb(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '未知';
  if (amount >= 1024) return `${(amount / 1024).toFixed(2)} TB`;
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} GB`;
}

function bytesToGb(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return amount / 1024 / 1024 / 1024;
}

function summarizeBandwidthGb(bandwidth) {
  const totals = Object.values(bandwidth || {}).reduce((summary, day) => {
    summary.inbound += bytesToGb(day.incoming_bytes);
    summary.outbound += bytesToGb(day.outgoing_bytes);
    return summary;
  }, { inbound: 0, outbound: 0 });
  return {
    ...totals,
    usage: Math.max(totals.inbound, totals.outbound)
  };
}

function metric(label, value) {
  return { label, value };
}

function publicConfig() {
  const config = readConfig();
  const result = { ...config };
  SECRET_FIELDS.forEach((field) => {
    result[`${field}Masked`] = maskKey(config[field]);
    result[field] = '';
  });
  return result;
}

function httpJson(url, options = {}, body = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  return net.fetch(url, {
    ...options,
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Balance-Float/1.0',
      ...(options.headers || {})
    },
    body,
    signal: controller.signal
  }).then(async (res) => {
    clearTimeout(timer);
    const responseBody = await res.text();
    let json = {};
    try {
      json = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      throw new Error(`HTTP ${res.status}: invalid JSON`);
    }
    if (!res.ok) {
      const message = json.error?.message || json.message || json.Response?.Error?.Message || responseBody || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return json;
  }).catch((error) => {
    clearTimeout(timer);
    if (error.name === 'AbortError') throw new Error('request timeout');
    throw error;
  });
}

function requestJson(url, token) {
  return httpJson(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Balance-Float/1.0'
    }
  });
}

function postJson(url, headers, payload) {
  const body = JSON.stringify(payload);
  return httpJson(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'application/json',
      'User-Agent': 'Balance-Float/1.0'
    }
  }, body);
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function aliyunSignedUrl(action, params, accessKeyId, accessKeySecret, region) {
  const query = {
    Action: action,
    Version: '2014-05-26',
    Format: 'JSON',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    RegionId: region,
    ...params
  };
  const canonical = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key])}`)
    .join('&');
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  query.Signature = crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
  const signed = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key])}`)
    .join('&');
  return `https://ecs.${region}.aliyuncs.com/?${signed}`;
}

async function fetchAliyunServers(config) {
  const data = await httpJson(aliyunSignedUrl('DescribeInstances', { PageSize: 50 }, config.aliyunAccessKeyId, config.aliyunAccessKeySecret, config.aliyunRegion));
  const instances = data.Instances?.Instance || [];
  return instances.map((instance) => {
    const publicIp = instance.PublicIpAddress?.IpAddress?.[0] || instance.EipAddress?.IpAddress || '';
    return {
      provider: 'Aliyun',
      name: instance.InstanceName || instance.InstanceId,
      status: instance.Status || 'Unknown',
      region: instance.RegionId || config.aliyunRegion,
      ip: publicIp,
      detail: `${instance.InstanceType || ''}${instance.ZoneId ? ` / ${instance.ZoneId}` : ''}`.trim()
    };
  });
}

function tencentSign(secretKey, date, service, stringToSign) {
  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  return crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
}

async function tencentPost(action, version, region, secretId, secretKey, payload) {
  const host = 'cvm.tencentcloudapi.com';
  const service = 'cvm';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(payload);
  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\ncontent-type;host\n${hashedPayload}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const signature = tencentSign(secretKey, date, service, stringToSign);
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
  const data = await postJson(`https://${host}`, {
    Authorization: authorization,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Region': region,
    'X-TC-Timestamp': String(timestamp)
  }, payload);
  if (data.Response?.Error) throw new Error(data.Response.Error.Message || data.Response.Error.Code);
  return data.Response || {};
}

async function fetchTencentServers(config) {
  const data = await tencentPost('DescribeInstances', '2017-03-12', config.tencentRegion, config.tencentSecretId, config.tencentSecretKey, { Limit: 100, Offset: 0 });
  const instances = data.InstanceSet || [];
  return instances.map((instance) => ({
    provider: 'Tencent',
    name: instance.InstanceName || instance.InstanceId,
    status: instance.InstanceState || 'Unknown',
    region: instance.Placement?.Zone || config.tencentRegion,
    ip: instance.PublicIpAddresses?.[0] || '',
    detail: `${instance.InstanceType || ''}${instance.PrivateIpAddresses?.[0] ? ` / 内网 ${instance.PrivateIpAddresses[0]}` : ''}`.trim()
  }));
}

async function fetchVultrServers(config) {
  const data = await requestJson('https://api.vultr.com/v2/instances?per_page=100', config.vultrKey);
  return Promise.all((data.instances || []).map(async (instance) => {
    let bandwidthDetail = '流量 暂无数据';
    let bandwidthMetric = metric('流量', '未知');
    try {
      const bandwidthData = await requestJson(`https://api.vultr.com/v2/instances/${instance.id}/bandwidth?date_range=31`, config.vultrKey);
      const used = summarizeBandwidthGb(bandwidthData.bandwidth);
      const allowedGb = Number(instance.allowed_bandwidth);
      const remainingGb = Number.isFinite(allowedGb) ? Math.max(allowedGb - used.usage, 0) : null;
      bandwidthMetric = metric('流量', Number.isFinite(allowedGb) ? `${formatGb(used.usage)} / ${formatGb(allowedGb)}` : formatGb(used.usage));
      bandwidthDetail = Number.isFinite(allowedGb)
        ? `流量已用 ${formatGb(used.usage)}, 剩余 ${formatGb(remainingGb)}\n入站 ${formatGb(used.inbound)}, 出站 ${formatGb(used.outbound)}`
        : `流量已用 ${formatGb(used.usage)}\n入站 ${formatGb(used.inbound)}, 出站 ${formatGb(used.outbound)}`;
    } catch (error) {
      bandwidthDetail = `流量获取失败: ${error.message}`;
    }
    return {
      provider: 'Vultr',
      name: instance.label || instance.hostname || instance.id,
      status: instance.power_status || instance.status || 'unknown',
      region: instance.region || '',
      ip: instance.main_ip || '',
      detail: `${bandwidthDetail}\n${instance.plan || ''}${instance.status ? ` / ${instance.status}` : ''}`,
      metrics: [
        bandwidthMetric,
        metric('CPU', `${instance.vcpu_count ?? '未知'} C`),
        metric('内存', Number.isFinite(Number(instance.ram)) ? `${formatGb(Number(instance.ram) / 1024)}` : '未知'),
        metric('磁盘', Number.isFinite(Number(instance.disk)) ? `${instance.disk} GB` : '未知')
      ]
    };
  }));
}

async function fetchDeepSeekServiceStatus() {
  try {
    const data = await httpJson('https://status.deepseek.com/api/v2/status.json');
    return [{
      provider: 'DeepSeek',
      name: 'API 服务',
      status: data.status?.indicator || 'unknown',
      region: 'status.deepseek.com',
      ip: '',
      detail: data.status?.description || ''
    }];
  } catch (error) {
    return [{
      provider: 'DeepSeek',
      name: 'API 服务',
      status: 'unknown',
      region: 'status.deepseek.com',
      ip: '',
      detail: error.message
    }];
  }
}

async function refreshServers() {
  const config = readConfig();
  const jobs = [fetchDeepSeekServiceStatus()];
  const jobNames = ['DeepSeek'];
  if (config.vultrKey) {
    jobs.push(fetchVultrServers(config));
    jobNames.push('Vultr');
  }
  if (config.aliyunAccessKeyId && config.aliyunAccessKeySecret) {
    jobs.push(fetchAliyunServers(config));
    jobNames.push('Aliyun');
  }
  if (config.tencentSecretId && config.tencentSecretKey) {
    jobs.push(fetchTencentServers(config));
    jobNames.push('Tencent');
  }

  const checkedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const settled = await Promise.allSettled(jobs);
  const items = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      return;
    }
    items.push({
      provider: jobNames[index],
      name: 'Instance list',
      status: 'Fetch failed',
      region: '',
      ip: '',
      detail: result.reason?.message || 'Unknown error'
    });
  });
  const payload = {
    checkedAt,
    items,
    message: jobs.length === 1 ? 'Add Vultr / Aliyun / Tencent credentials to view cloud servers' : ''
  };
  if (win && !win.isDestroyed()) win.webContents.send('servers:update', payload);
  return payload;
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
  const balance = Number(account.balance);
  const pendingCharges = Number(account.pending_charges);
  const net = balance + pendingCharges;
  const hasNumbers = Number.isFinite(balance) && Number.isFinite(pendingCharges);
  const primary = hasNumbers && net < 0
    ? `剩余额度 ${formatUsd(net)}`
    : hasNumbers
      ? `预计应付 ${formatUsd(net)}`
      : `账面余额 ${account.balance ?? '未知'}`;
  return {
    name: 'Vultr',
    ok: true,
    available: true,
    primary,
    detail: `账面余额 ${formatSignedUsd(account.balance)}, 本月待结算 ${formatUsd(account.pending_charges)}${account.last_payment_date ? `\n上次付款 ${account.last_payment_date}` : ''}`
  };
}

function findLatestCodexRateLimits(match = () => true) {
  const roots = [
    path.join(app.getPath('home'), '.codex', 'sessions'),
    path.join(app.getPath('home'), '.codex', 'archived_sessions')
  ].filter((dir) => fs.existsSync(dir));
  const files = roots.flatMap((root) => walkRecentFiles(root, (name) => name.endsWith('.jsonl'), 80))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 120);

  for (const file of files) {
    const text = readFileTail(file.path);
    if (!text.includes('"rate_limits"')) continue;
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.includes('"rate_limits"')) continue;
      try {
        const event = JSON.parse(line);
        const rateLimits = event?.payload?.rate_limits;
        if ((rateLimits?.primary || rateLimits?.secondary) && match(rateLimits, event)) {
          return { timestamp: event.timestamp, source: file.path, rate_limits: rateLimits };
        }
      } catch {}
    }
  }
  return null;
}

function findLatestCodexModelRun(modelSlug) {
  const roots = [
    path.join(app.getPath('home'), '.codex', 'sessions'),
    path.join(app.getPath('home'), '.codex', 'archived_sessions')
  ].filter((dir) => fs.existsSync(dir));
  const files = roots.flatMap((root) => walkRecentFiles(root, (name) => name.endsWith('.jsonl'), 80))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 120);

  for (const file of files) {
    const text = readFileTail(file.path);
    if (!text.includes(modelSlug)) continue;
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.includes(modelSlug)) continue;
      try {
        const event = JSON.parse(line);
        if (event?.payload?.model === modelSlug || JSON.stringify(event).includes(modelSlug)) {
          return { timestamp: event.timestamp, source: file.path };
        }
      } catch {}
    }
  }
  return null;
}

function readCodexModel() {
  try {
    const config = fs.readFileSync(path.join(app.getPath('home'), '.codex', 'config.toml'), 'utf8');
    return config.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] || 'unknown';
  } catch {
    return 'unknown';
  }
}

function runPowerShellJson(script, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 256 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
    child.unref?.();
  });
}

async function getAgentProcessStats() {
  const script = `
$items = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(Codex|codex|claude)$' } | ForEach-Object {
  [pscustomobject]@{ name = $_.ProcessName; mem = [math]::Round($_.WorkingSet64 / 1MB, 1) }
}
$codex = @($items | Where-Object { $_.name -match '^(Codex|codex)$' })
$claude = @($items | Where-Object { $_.name -eq 'claude' })
$claudeCli = $null -ne (Get-Command claude -ErrorAction SilentlyContinue)
[pscustomobject]@{
  codexCount = $codex.Count
  claudeCount = $claude.Count
  claudeCliFound = $claudeCli
  codexMemMb = [math]::Round((($codex | Measure-Object -Property mem -Sum).Sum), 1)
  claudeMemMb = [math]::Round((($claude | Measure-Object -Property mem -Sum).Sum), 1)
} | ConvertTo-Json -Compress
`;
  return await runPowerShellJson(script) || { codexCount: 0, claudeCount: 0, codexMemMb: 0, claudeMemMb: 0 };
}

async function fetchCodexCombinedUsage() {
  const stats = await getAgentProcessStats();
  const shared = findLatestCodexRateLimits((rateLimits) => rateLimits?.limit_id === 'codex' && !rateLimits?.limit_name);
  const spark = findLatestCodexRateLimits((rateLimits) => {
    const name = String(rateLimits?.limit_name || '');
    return rateLimits?.limit_id === 'codex_bengalfox' || /spark/i.test(name);
  });
  const item = buildCodexCombinedUsage({
    shared,
    spark,
    sparkRun: findLatestCodexModelRun('gpt-5.3-codex-spark'),
    model: readCodexModel()
  });
  return { ...item, available: Number(stats.codexCount || 0) > 0 };
}

async function fetchClaudeCodeUsage() {
  const stats = await getAgentProcessStats();
  const cache = readJsonSafe(claudeUsagePath(app.getPath('home')));
  return buildClaudeCodeUsage(cache, stats);
}

async function refreshBalances() {
  const config = readConfig();
  const jobs = [];
  const labels = [];
  if (config.deepseekKey) jobs.push(fetchDeepSeek(config.deepseekKey));
  if (config.deepseekKey) labels.push('DeepSeek');
  if (config.vultrKey) jobs.push(fetchVultr(config.vultrKey));
  if (config.vultrKey) labels.push('Vultr');
  jobs.push(fetchCodexCombinedUsage());
  labels.push('Codex / Spark');
  jobs.push(fetchClaudeCodeUsage());
  labels.push('Claude Code');

  const checkedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const settled = await Promise.allSettled(jobs);
  lastPayload = {
    checkedAt,
    items: settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        name: labels[index] || 'Agent',
        ok: false,
        available: false,
        primary: 'Fetch failed',
        detail: result.reason?.message || 'Unknown error'
      };
    })
  };
  if (win && !win.isDestroyed()) win.webContents.send('balances:update', lastPayload);
  updateTray();
  return lastPayload;
}

async function refreshAll() {
  await Promise.allSettled([refreshBalances(), refreshServers()]);
}

function positionWindow() {
  if (!win) return;
  const [width, height] = win.getSize();
  const bounds = targetBounds({ width, height });
  win.setPosition(bounds.x, bounds.y);
}

function targetBounds(size) {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - size.width - 18,
    y: display.y + 18,
    width: size.width,
    height: size.height
  };
}

function applyCompactMode(compactMode) {
  if (!win || win.isDestroyed()) return;
  const size = compactMode ? COMPACT_SIZE : FULL_SIZE;
  win.setMinimumSize(size.width, size.height);
  win.setMaximumSize(size.width, size.height);
  win.setBounds(targetBounds(size), false);
  win.webContents.send('window:mode', { compactMode });
}

function createWindow() {
  const config = readConfig();
  const size = config.compactMode ? COMPACT_SIZE : FULL_SIZE;
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
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
    applyCompactMode(config.compactMode);
    if (!config.startHidden) win.show();
    refreshAll();
  });
  win.on('blur', () => {
    if (readConfig().startHidden) return;
  });
}

function showWindow() {
  if (!win) createWindow();
  applyCompactMode(readConfig().compactMode);
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
    { label: '立即刷新', click: refreshAll },
    { label: readConfig().compactMode ? '完整模式' : '缩略模式', click: () => setCompactMode(!readConfig().compactMode) },
    { label: '隐藏', click: hideWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}

function scheduleRefresh(minutes) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, Math.max(1, minutes) * 60 * 1000);
}

function scheduleAgentRefresh(delayMs = 1000) {
  if (agentRefreshTimer) clearTimeout(agentRefreshTimer);
  agentRefreshTimer = setTimeout(() => {
    agentRefreshTimer = null;
    refreshBalances();
  }, delayMs);
}

function watchIfExists(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;
  try {
    const watcher = fs.watch(filePath, options, () => scheduleAgentRefresh());
    agentWatchers.push(watcher);
  } catch {}
}

function watchAgentUsageFiles() {
  agentWatchers.forEach((watcher) => {
    try {
      watcher.close();
    } catch {}
  });
  agentWatchers = [];
  const home = app.getPath('home');
  watchIfExists(path.join(home, '.claude', 'usage-status.json'));
  watchIfExists(path.join(home, '.codex', 'sessions'), { recursive: true });
  watchIfExists(path.join(home, '.codex', 'archived_sessions'), { recursive: true });
}

function scheduleAgentPolling() {
  if (agentPollTimer) clearInterval(agentPollTimer);
  agentPollTimer = setInterval(() => scheduleAgentRefresh(0), 10000);
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

function normalizeOpacity(opacity) {
  return Math.min(1, Math.max(0.35, Number(opacity) || DEFAULT_CONFIG.opacity));
}

function setCompactMode(compactMode) {
  const current = readConfig();
  writeConfig({ ...current, compactMode: Boolean(compactMode) });
  applyCompactMode(Boolean(compactMode));
  updateTray();
  return publicConfig();
}

function previewOpacity(opacity) {
  const nextOpacity = normalizeOpacity(opacity);
  if (win && !win.isDestroyed()) win.setOpacity(nextOpacity);
  return nextOpacity;
}

ipcMain.handle('config:get', () => publicConfig());
ipcMain.handle('config:save', (_event, patch) => {
  const current = readConfig();
  const next = {
    ...current,
    ...patch
  };
  SECRET_FIELDS.forEach((field) => {
    next[field] = patch[field] || current[field];
  });
  writeConfig(next);
  syncLoginItem(next.autoStart);
  if (win) win.setOpacity(next.opacity);
  applyCompactMode(next.compactMode);
  scheduleRefresh(next.refreshMinutes);
  refreshAll();
  return publicConfig();
});
ipcMain.handle('balances:refresh', refreshBalances);
ipcMain.handle('servers:refresh', refreshServers);
ipcMain.handle('window:compact', (_event, compactMode) => setCompactMode(compactMode));
ipcMain.handle('window:opacity-preview', (_event, opacity) => previewOpacity(opacity));
ipcMain.handle('window:hide', hideWindow);
ipcMain.handle('window:quit', () => app.quit());

app.whenReady().then(() => {
  const config = readConfig();
  syncLoginItem(config.autoStart);
  createWindow();
  createTray();
  scheduleRefresh(config.refreshMinutes);
  watchAgentUsageFiles();
  scheduleAgentPolling();
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {});
