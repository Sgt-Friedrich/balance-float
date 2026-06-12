const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildClaudeCodeUsage,
  buildCodexCombinedUsage,
  readJsonSafe
} = require('../src/agent-usage');

function withTempFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-float-test-'));
  const file = path.join(dir, 'sample.json');
  fs.writeFileSync(file, contents, 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempFile('\uFEFF{"ok":true}', (file) => {
  assert.deepStrictEqual(readJsonSafe(file), { ok: true });
});

const claude = buildClaudeCodeUsage({
  model: { display_name: 'Sonnet 4.6' },
  rate_limits: {
    five_hour: { used_percentage: 15, resets_at: 1781254200 },
    seven_day: { used_percentage: 21, resets_at: 1781424000 }
  }
}, { claudeCount: 1, claudeCliFound: true });
assert.strictEqual(claude.ok, true);
assert.strictEqual(claude.primary, '剩余 5h 85% / Week 79%');
assert.strictEqual(claude.detail, '');
assert.strictEqual(claude.usageRings.length, 2);
assert.match(claude.usageRings[0].resetLabel, /^\d{2}(:\d{2}|\/\d{2})$/);

const codex = buildCodexCombinedUsage({
  model: 'gpt-5.3-codex',
  shared: {
    rate_limits: {
      primary: { used_percent: 10, resets_at: 1781254200 },
      secondary: { used_percent: 20, resets_at: 1781424000 }
    }
  },
  spark: null,
  sparkRun: null
});
assert.strictEqual(codex.name, 'Codex / Spark');
assert.strictEqual(codex.ok, true);
assert.match(codex.primary, /Codex 90% \/ 80%/);
assert.match(codex.primary, /Spark 90% \/ 80%/);
assert.strictEqual(codex.detail, 'Spark uses Codex pool');
assert.strictEqual(codex.usageRings.length, 4);

console.log('agent-usage tests passed');
