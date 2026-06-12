const fs = require('fs');
const path = require('path');

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function remainingPercent(usedValue) {
  const used = clampPercent(usedValue);
  return used === null ? null : Math.max(0, Math.min(100, 100 - used));
}

function formatPercent(value) {
  const number = clampPercent(value);
  return number === null ? 'n/a' : `${Math.round(number)}%`;
}

function formatRemaining(value) {
  const remaining = remainingPercent(value);
  return remaining === null ? 'n/a' : `${Math.round(remaining)}%`;
}

function formatReset(value, now = new Date()) {
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'n/a';

  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function usageRing(label, usedValue, resetValue) {
  const remaining = remainingPercent(usedValue);
  return {
    label,
    usedPercent: clampPercent(usedValue),
    remainingPercent: remaining,
    resetLabel: formatReset(resetValue)
  };
}

function resetExpired(primary, secondary) {
  const now = Date.now() / 1000;
  const resets = [primary?.resets_at, secondary?.resets_at]
    .map(Number)
    .filter(Number.isFinite);
  return resets.length > 0 && resets.every((value) => value < now);
}

function codexLimitItem(rateLimits, labelPrefix, ringPrefix) {
  const primary = rateLimits?.primary;
  const secondary = rateLimits?.secondary;
  return {
    summary: `${labelPrefix} ${formatRemaining(primary?.used_percent)} / ${formatRemaining(secondary?.used_percent)}`,
    rings: [
      usageRing(`${ringPrefix} 5h`, primary?.used_percent, primary?.resets_at),
      usageRing(`${ringPrefix} W`, secondary?.used_percent, secondary?.resets_at)
    ]
  };
}

function buildCodexCombinedUsage({ shared, spark, sparkRun, model }) {
  const sharedRates = shared?.rate_limits || {};
  const sparkRates = spark?.rate_limits || {};
  const sparkHasOwnPool = Boolean(spark?.rate_limits);
  const sparkSource = sparkHasOwnPool && !resetExpired(sparkRates.primary, sparkRates.secondary)
    ? sparkRates
    : sharedRates;

  const codex = codexLimitItem(sharedRates, 'Codex', 'C');
  const sparkItem = codexLimitItem(sparkSource, 'Spark', 'S');
  const hasRate = codex.rings.some((ring) => ring.remainingPercent !== null)
    || sparkItem.rings.some((ring) => ring.remainingPercent !== null);

  if (!hasRate) {
    return {
      name: 'Codex / Spark',
      ok: false,
      available: true,
      primary: 'Usage not found',
      detail: `model ${model || 'unknown'}${sparkRun?.timestamp ? `\nlast Spark ${formatReset(sparkRun.timestamp)}` : ''}`,
      usageRings: []
    };
  }

  return {
    name: 'Codex / Spark',
    ok: true,
    available: true,
    primary: `${codex.summary}\n${sparkItem.summary}`,
    detail: sparkHasOwnPool && sparkSource === sparkRates ? 'Spark independent pool' : 'Spark uses Codex pool',
    usageRings: [
      ...codex.rings,
      ...sparkItem.rings
    ]
  };
}

function buildClaudeCodeUsage(cache, stats = {}) {
  const rate = cache?.rate_limits || {};
  const fiveHour = rate.five_hour || rate.session || {};
  const weekly = rate.weekly || rate.seven_day || {};
  const hasRate = Number.isFinite(Number(fiveHour.used_percentage)) || Number.isFinite(Number(weekly.used_percentage));
  const isTestCache = cache?.model?.display_name === 'Claude Test';

  if (hasRate && !isTestCache) {
    return {
      name: 'Claude Code',
      ok: true,
      available: Number(stats.claudeCount || 0) > 0,
      primary: `剩余 5h ${formatRemaining(fiveHour.used_percentage)} / Week ${formatRemaining(weekly.used_percentage)}`,
      detail: '',
      usageRings: [
        usageRing('5h', fiveHour.used_percentage, fiveHour.resets_at),
        usageRing('Week', weekly.used_percentage, weekly.resets_at)
      ]
    };
  }

  return {
    name: 'Claude Code',
    ok: Boolean(stats.claudeCliFound),
    available: Boolean(stats.claudeCliFound),
    primary: stats.claudeCliFound ? 'CLI installed' : 'CLI not found',
    detail: `desktop processes ${stats.claudeCount || 0}, memory ${stats.claudeMemMb || 0} MB\nCLI ${stats.claudeCliFound ? 'found' : 'not found'}\nwaiting for Claude Code CLI statusLine rate_limits\nClaude Desktop does not update this cache${isTestCache ? '\ncurrent cache is test data' : ''}`,
    usageRings: []
  };
}

function claudeUsagePath(homeDir) {
  return path.join(homeDir, '.claude', 'usage-status.json');
}

module.exports = {
  buildClaudeCodeUsage,
  buildCodexCombinedUsage,
  claudeUsagePath,
  formatReset,
  readJsonSafe,
  stripBom,
  usageRing
};
