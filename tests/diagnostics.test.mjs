// 诊断报告只允许固定环境字段和有限操作状态，不能带入私人业务数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticLog, formatDiagnosticReport, readHostDiagnostics} from '../src/shared/diagnostics.js';

test('diagnostic log retains bounded recent operations and tracks pending durations', () => {
  let now = 1_700_000_000_000;
  const log = createDiagnosticLog({now: () => now, limit: 3});
  const finish = log.begin('export-preset');
  now += 125;
  assert.equal(log.snapshot()[0].outcome, 'pending');
  assert.equal(log.snapshot()[0].durationMs, 125);
  finish('success');
  now += 500;
  assert.equal(log.snapshot()[0].durationMs, 125);
  finish('failed'); // A late duplicate completion must not change the result.
  assert.equal(log.snapshot()[0].outcome, 'success');
  for (const name of ['snapshot-save', 'ai-stitch-generate', 'read-preset']) log.begin(name)('failed', 'TypeError');
  assert.equal(log.snapshot().length, 3);
  assert.deepEqual(log.snapshot().map(row => row.operation), ['snapshot-save', 'ai-stitch-generate', 'read-preset']);
  const copy = log.snapshot();
  copy[0].operation = 'secret';
  assert.equal(log.snapshot()[0].operation, 'snapshot-save');
});

test('raw method, error names, UA and extra fields never escape into reports', () => {
  const secret = 'sk-secret-abc https://private.example/私密角色Alpha?key=123';
  const log = createDiagnosticLog({now: () => 1_700_000_000_000});
  log.begin(secret)('failed', secret);
  log.begin('ai-stitch-generate')('failed', 'AbortError');
  const report = formatDiagnosticReport({
    version: '1.9.10-test.1', now: 1_700_000_000_000,
    host: {kind: 'TauriTavern', version: '2.3.0', frontendVersion: '1.18.0', key: secret},
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/123.0.0.0 Edg/124.0.0.0 '+secret,
    records: [...log.snapshot(), {operation: secret, outcome: secret, error: secret, durationMs: secret, at: secret}],
    error: {message: secret, stack: secret}, payload: {content: secret},
  });
  assert.match(report, /1\.9\.10-test\.1/);
  assert.match(report, /TauriTavern 2\.3\.0/);
  assert.match(report, /Edge 124/);
  assert.match(report, /Windows/);
  for (const privatePart of ['sk-secret', 'private.example', '私密角色Alpha', 'AppleWebKit', 'Mozilla', 'AbortError']) assert.ok(!report.includes(privatePart), privatePart);
  assert.match(report, /已取消/);
});

test('report rejects attacker-controlled version, host and operation properties', () => {
  const report = formatDiagnosticReport({version: '1.9.9-secret', host: {kind: 'private-host', version: '1.2.3 private'}, userAgent: '', records: [{operation: '__proto__', outcome: 'constructor', error: 'toString', at: Infinity, durationMs: Infinity}], now: NaN});
  assert.ok(!report.includes('private'));
  assert.ok(!report.includes('secret'));
  assert.ok(!report.includes('[object'));
  assert.match(report, /未知/);
  assert.doesNotThrow(() => formatDiagnosticReport({records: null}));
});

test('host diagnostics distinguish TT app version from bundled frontend version', () => {
  assert.deepEqual(readHostDiagnostics({versionText: "SillyTavern 1.18.0 'release' (private-branch)"}), {kind: 'SillyTavern', version: '1.18.0', frontendVersion: '1.18.0'});
  assert.deepEqual(readHostDiagnostics({tauri: true, versionText: 'SillyTavern 1.18.0'}), {kind: 'TauriTavern', version: '未知', frontendVersion: '1.18.0'});
  assert.deepEqual(readHostDiagnostics({tauri: true, versionText: 'TauriTavern 2.3.0 private'}), {kind: 'TauriTavern', version: '2.3.0', frontendVersion: '未知'});
  assert.equal(readHostDiagnostics({versionText: '角色名 1.18.0'}).version, '未知');
});
