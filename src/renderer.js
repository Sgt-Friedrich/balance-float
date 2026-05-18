const $ = (id) => document.getElementById(id);

function render(payload) {
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
      <div>
        <strong>${item.name}</strong>
        <span>${item.available ? '可用' : '不可用'}</span>
      </div>
      <p>${item.primary}</p>
      <small>${(item.detail || '').replaceAll('\n', '<br>')}</small>
    `;
    balances.appendChild(card);
  });
}

async function loadConfig() {
  const config = await window.balanceApp.getConfig();
  $('refreshMinutes').value = config.refreshMinutes;
  $('opacity').value = config.opacity;
  $('autoStart').checked = config.autoStart;
  $('startHidden').checked = config.startHidden;
  $('deepseekMasked').textContent = config.deepseekKeyMasked ? `已保存 ${config.deepseekKeyMasked}` : '未保存';
  $('vultrMasked').textContent = config.vultrKeyMasked ? `已保存 ${config.vultrKeyMasked}` : '未保存';
}

$('refresh').addEventListener('click', async () => render(await window.balanceApp.refresh()));
$('hide').addEventListener('click', () => window.balanceApp.hide());
$('quit').addEventListener('click', () => window.balanceApp.quit());
$('settingsToggle').addEventListener('click', () => $('settings').classList.toggle('hidden'));
$('save').addEventListener('click', async () => {
  await window.balanceApp.saveConfig({
    deepseekKey: $('deepseekKey').value.trim(),
    vultrKey: $('vultrKey').value.trim(),
    refreshMinutes: Number($('refreshMinutes').value),
    opacity: Number($('opacity').value),
    autoStart: $('autoStart').checked,
    startHidden: $('startHidden').checked
  });
  $('deepseekKey').value = '';
  $('vultrKey').value = '';
  await loadConfig();
  $('settings').classList.add('hidden');
});

window.balanceApp.onUpdate(render);
loadConfig();
