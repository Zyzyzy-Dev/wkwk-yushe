// 预设更新编辑器 · 纯功能核心回归测试（node --test 自动发现）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VAR_GET_RE,
  applyPresetToMemory,
  buildRows,
  clone,
  contentSimilarity,
  diffLines,
  equalValues,
  findPromptOrderEntry,
  parseVarContent,
  shouldRefreshActivePreset,
  validatePreset,
} from '../src/core.js';

test('clone keeps preset data independent', () => {
  const source = { prompts: [{ identifier: 'a', content: 'old' }] };
  const copy = clone(source);
  copy.prompts[0].content = 'new';
  assert.equal(source.prompts[0].content, 'old');
});

test('preset validation rejects missing and duplicate identifiers', () => {
  assert.equal(validatePreset({ prompts: [{ identifier: 'a' }] }).prompts.length, 1);
  assert.throws(() => validatePreset({}), /prompts 数组/);
  assert.throws(
    () => validatePreset({ prompts: [{ identifier: 'a' }, { identifier: 'a' }] }),
    /条目 ID 重复/,
  );
});

test('comparison normalization preserves trigger and whitespace compatibility', () => {
  const explicitAll = {
    injection_trigger: ['swipe', 'normal', 'continue', 'quiet', 'regenerate', 'impersonate'],
    content: 'a b\n',
  };
  assert.equal(equalValues(explicitAll, { content: 'ab' }, false), false);
  assert.equal(equalValues(explicitAll, { content: 'ab' }, true), true);
});

test('prompt order picks character 100001, then the best covered entry', () => {
  const preferred = findPromptOrderEntry({
    prompts: [{ identifier: 'a' }],
    prompt_order: [
      { character_id: 0, order: [] },
      { character_id: 100001, order: [{ identifier: 'a' }] },
    ],
  });
  assert.equal(preferred.character_id, 100001);

  const covered = findPromptOrderEntry({
    prompts: [{ identifier: 'a' }, { identifier: 'b' }],
    prompt_order: [
      { character_id: 0, order: [{ identifier: 'a' }] },
      { character_id: 1, order: [{ identifier: 'a' }, { identifier: 'b' }] },
    ],
  });
  assert.equal(covered.character_id, 1);
});

test('content similarity keeps existing whitespace semantics', () => {
  assert.equal(contentSimilarity('', ''), 1);
  assert.equal(contentSimilarity('abc', 'abc'), 1);
  assert.equal(contentSimilarity('a b', 'ab', true), 1);
  assert.equal(contentSimilarity('abc', 'abd'), 0.5);
});

test('mixed-language diff uses English words and CJK characters', () => {
  const englishRows = buildRows(diffLines('Hello brave world', 'Hello new world'));
  assert.equal(englishRows.length, 2);
  assert.equal(englishRows[0].paired, true);
  assert.deepEqual(
    englishRows[0].segs.map(segment => [segment.t, segment.text]),
    [[' ', 'Hello '], ['-', 'brave'], ['+', 'new'], [' ', ' world']],
  );

  const cjkRows = buildRows(diffLines('你好世界', '你好世间'));
  assert.deepEqual(
    cjkRows[0].segs.map(segment => [segment.t, segment.text]),
    [[' ', '你好世'], ['-', '界'], ['+', '间']],
  );
});

test('variable parsing separates text and setvar macros', () => {
  const segments = parseVarContent('前{{setvar::名字::值}}后');
  assert.deepEqual(segments, [
    { type: 'text', value: '前' },
    { type: 'set', name: '名字', value: '值', raw: '{{setvar::名字::值}}' },
    { type: 'text', value: '后' },
  ]);
  assert.deepEqual(
    [...'{{getvar::名字}} {{getglobalvar::全局}}'.matchAll(VAR_GET_RE)].map(match => match[1]),
    ['名字', '全局'],
  );
});

test('save refreshes only when the saved preset is the currently active one', () => {
  assert.equal(shouldRefreshActivePreset('ActiveA', 'ActiveA'), true);
  assert.equal(shouldRefreshActivePreset('ActiveB', 'ActiveA'), false);
  assert.equal(shouldRefreshActivePreset('', 'ActiveA'), false); // 无法取得当前预设时不切换
  assert.equal(shouldRefreshActivePreset('ActiveA', 'activea'), false); // 名称大小写敏感
});

test('preset memory sync writes only existing slots', () => {
  const presets = [{ name: 'A' }, { name: 'B' }];
  const namesByIndex = { A: 0, B: 1 };
  const incoming = { name: 'A2' };

  assert.equal(applyPresetToMemory(presets, namesByIndex, 'A', incoming), true);
  assert.equal(presets[0], incoming);
  assert.equal(presets[1].name, 'B');

  assert.equal(applyPresetToMemory(presets, namesByIndex, 'Missing', incoming), false);
  assert.equal(applyPresetToMemory(presets, ['A', 'B'], 'B', incoming), true); // 数组式 preset_names
  assert.equal(presets[1], incoming);
  assert.equal(applyPresetToMemory(presets, ['A', 'B'], 'Nope', incoming), false);
  assert.equal(applyPresetToMemory('not-an-array', namesByIndex, 'A', incoming), false);
});
