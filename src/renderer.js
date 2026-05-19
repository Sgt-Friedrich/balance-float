const $ = (id) => document.getElementById(id);
let latestBalances = null;
let latestServers = null;
let compactMode = false;

function serviceIcon(name) {
  const service = String(name || '').toLowerCase();
  if (service.includes('deepseek')) return '../assets/deepseek.svg';
  if (service.includes('vultr')) return '../assets/vultr.svg';
  if (service.includes('aliyun') || service.includes('alibaba')) return '../assets/aliyun.svg';
  if (service.includes('tencent')) return '../assets/tencent.svg';
  return '../assets/icon.png';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function render(payload) {
  latestBalances = payload;
  const balances = $('balances');
  const empty = $('empty');
  balances.innerHTML = '';
  $('checkedAt').textContent = payload?.checkedAt ? `更新 ${payload.checkedAt}` : '未刷新';
  const items = payload?.items || [];
  empty.classList.toggle('hidden', items.length > 0);
  if (payload?.message) empty.textContent = payload.message;
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = `balance ${item.ok ? 'ok' : 'bad'}`;
    card.innerHTML = `
      <div class="balance-head">
        <span class="service">
          <img src="${serviceIcon(item.name)}" alt="${escapeHtml(item.name)} icon">
          <strong>${escapeHtml(item.name)}</strong>
        </span>
        <span>${item.available ? '可用' : '不可用'}</span>
      </div>
      <p>${escapeHtml(item.primary)}</p>
      <small>${escapeHtml(item.detail || '').replaceAll('\n', '<br>')}</small>
    `;
    balances.appendChild(card);
  });
  updateCompactSummary();
}

function renderServers(payload) {
  latestServers = payload;
  const servers = $('servers');
  const empty = $('serversEmpty');
  servers.innerHTML = '';
  $('checkedAt').textContent = payload?.checkedAt ? `更新 ${payload.checkedAt}` : '未刷新';
  const items = payload?.items || [];
  empty.classList.toggle('hidden', items.length > 0);
  empty.textContent = payload?.message || '暂无服务器数据';
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'server';
    card.innerHTML = `
      <div class="balance-head">
        <span class="service">
          <img src="${serviceIcon(item.provider)}" alt="${escapeHtml(item.provider)} icon">
          <strong>${escapeHtml(item.name)}</strong>
        </span>
        <span class="status">${escapeHtml(item.status)}</span>
      </div>
      <p>${escapeHtml(item.provider)} · ${escapeHtml(item.region || '未知地域')}</p>
      <small>${escapeHtml(item.ip || '无公网 IP')}${item.detail ? `<br>${escapeHtml(item.detail)}` : ''}</small>
    `;
    servers.appendChild(card);
  });
  updateCompactSummary();
}

function updateCompactSummary() {
  const balanceItems = latestBalances?.items || [];
  const serverItems = latestServers?.items || [];
  const okBalances = balanceItems.filter((item) => item.ok).length;
  const serverProblems = serverItems.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return status.includes('fail') || status.includes('error') || status.includes('stopped') || status.includes('unknown') || status.includes('获取失败');
  }).length;
  if (!balanceItems.length && !serverItems.length) {
    $('compactPrimary').textContent = '未刷新';
    $('compactSecondary').textContent = '点击刷新';
    return;
  }
  $('compactPrimary').textContent = `${okBalances}/${balanceItems.length || 0} 余额 · ${serverItems.length} 状态`;
  $('compactSecondary').textContent = serverProblems ? `${serverProblems} 项异常或未知` : '状态正常';
}

async function loadConfig() {
  const config = await window.balanceApp.getConfig();
  $('refreshMinutes').value = config.refreshMinutes;
  $('opacity').value = config.opacity;
  $('autoStart').checked = config.autoStart;
  $('startHidden').checked = config.startHidden;
  $('compactMode').checked = config.compactMode;
  $('aliyunRegion').value = config.aliyunRegion;
  $('tencentRegion').value = config.tencentRegion;
  $('deepseekMasked').textContent = config.deepseekKeyMasked ? `已保存 ${config.deepseekKeyMasked}` : '未保存';
  $('vultrMasked').textContent = config.vultrKeyMasked ? `已保存 ${config.vultrKeyMasked}` : '未保存';
  $('aliyunAccessKeyIdMasked').textContent = config.aliyunAccessKeyIdMasked ? `已保存 ${config.aliyunAccessKeyIdMasked}` : '未保存';
  $('aliyunAccessKeySecretMasked').textContent = config.aliyunAccessKeySecretMasked ? `已保存 ${config.aliyunAccessKeySecretMasked}` : '未保存';
  $('tencentSecretIdMasked').textContent = config.tencentSecretIdMasked ? `已保存 ${config.tencentSecretIdMasked}` : '未保存';
  $('tencentSecretKeyMasked').textContent = config.tencentSecretKeyMasked ? `已保存 ${config.tencentSecretKeyMasked}` : '未保存';
}

function applyCompactMode(nextCompactMode) {
  compactMode = Boolean(nextCompactMode);
  document.body.classList.toggle('compact', compactMode);
  $('compactPanel').classList.toggle('hidden', !compactMode);
  $('balancesView').classList.toggle('hidden', compactMode || document.querySelector('.tab.active')?.dataset.view !== 'balances');
  $('serversView').classList.toggle('hidden', compactMode || document.querySelector('.tab.active')?.dataset.view !== 'servers');
  $('settings').classList.add('hidden');
  $('compactToggle').textContent = compactMode ? '▢' : '▣';
  $('compactToggle').title = compactMode ? '完整模式' : '缩略模式';
  updateCompactSummary();
}

function setView(view) {
  if (compactMode) return;
  $('balancesView').classList.toggle('hidden', view !== 'balances');
  $('serversView').classList.toggle('hidden', view !== 'servers');
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
}

$('refresh').addEventListener('click', async () => {
  if (!$('serversView').classList.contains('hidden')) renderServers(await window.balanceApp.refreshServers());
  else render(await window.balanceApp.refresh());
});
$('hide').addEventListener('click', () => window.balanceApp.hide());
$('quit').addEventListener('click', () => window.balanceApp.quit());
$('settingsToggle').addEventListener('click', () => $('settings').classList.toggle('hidden'));
$('compactToggle').addEventListener('click', async () => {
  const config = await window.balanceApp.setCompactMode(!compactMode);
  $('compactMode').checked = config.compactMode;
});
$('compactPanel').addEventListener('dblclick', async () => {
  const config = await window.balanceApp.setCompactMode(false);
  $('compactMode').checked = config.compactMode;
});
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
$('save').addEventListener('click', async () => {
  await window.balanceApp.saveConfig({
    deepseekKey: $('deepseekKey').value.trim(),
    vultrKey: $('vultrKey').value.trim(),
    aliyunAccessKeyId: $('aliyunAccessKeyId').value.trim(),
    aliyunAccessKeySecret: $('aliyunAccessKeySecret').value.trim(),
    aliyunRegion: $('aliyunRegion').value.trim() || 'cn-hangzhou',
    tencentSecretId: $('tencentSecretId').value.trim(),
    tencentSecretKey: $('tencentSecretKey').value.trim(),
    tencentRegion: $('tencentRegion').value.trim() || 'ap-guangzhou',
    refreshMinutes: Number($('refreshMinutes').value),
    opacity: Number($('opacity').value),
    autoStart: $('autoStart').checked,
    startHidden: $('startHidden').checked,
    compactMode: $('compactMode').checked
  });
  $('deepseekKey').value = '';
  $('vultrKey').value = '';
  $('aliyunAccessKeyId').value = '';
  $('aliyunAccessKeySecret').value = '';
  $('tencentSecretId').value = '';
  $('tencentSecretKey').value = '';
  await loadConfig();
  $('settings').classList.add('hidden');
});

window.balanceApp.onUpdate(render);
window.balanceApp.onServersUpdate(renderServers);
window.balanceApp.onModeChange((payload) => applyCompactMode(payload.compactMode));
loadConfig().then(async () => {
  const config = await window.balanceApp.getConfig();
  applyCompactMode(config.compactMode);
});
