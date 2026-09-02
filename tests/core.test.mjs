// 预设更新编辑器 · 纯功能核心回归测试（node --test 自动发现）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VAR_GET_RE,
  applyPresetToMemory,
  buildRows,
  clone,
  copyRegexScript,
  contentSimilarity,
  diffLines,
  equalValues,
  findPromptOrderEntry,
  getRegexGroupModel,
  getRegexScripts,
  pairRegexScripts,
  parseVarContent,
  reorderRegexScript,
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

test('regex scripts pair by ID, then by a unique exact name', () => {
  const oldPreset = { extensions: { regex_scripts: [
    { id: 'same-id', scriptName: 'renamed', findRegex: 'old' },
    { id: 'old-name-id', scriptName: 'same name', findRegex: 'old-name' },
    { id: 'duplicate-a', scriptName: 'duplicate' },
    { id: 'duplicate-b', scriptName: 'duplicate' },
  ] } };
  const newPreset = { extensions: { regex_scripts: [
    { id: 'same-id', scriptName: 'new name', findRegex: 'new' },
    { id: 'new-name-id', scriptName: 'same name', findRegex: 'new-name' },
    { id: 'duplicate-c', scriptName: 'duplicate' },
  ] } };
  const pairs = pairRegexScripts(oldPreset, newPreset);
  assert.deepEqual(pairs.find(pair => pair.oldIndex === 0), { oldIndex: 0, newIndex: 0, kind: 'id' });
  assert.deepEqual(pairs.find(pair => pair.oldIndex === 1), { oldIndex: 1, newIndex: 1, kind: 'name' });
  assert.equal(pairs.find(pair => pair.oldIndex === 2).newIndex, null);
  assert.equal(pairs.find(pair => pair.oldIndex === 3).newIndex, null);
  assert.equal(pairs.find(pair => pair.newIndex === 2).oldIndex, null);
  assert.deepEqual(getRegexScripts({}), []);
});

test('regex migration overwrites counterparts and inserts missing scripts near matched neighbors', () => {
  const oldPreset = { extensions: { regex_scripts: [
    { id: 'a', scriptName: 'A', findRegex: 'a' },
    { id: 'b', scriptName: 'B', findRegex: 'old-b', disabled: false },
    { id: 'c', scriptName: 'C', findRegex: 'c' },
  ] } };
  const newPreset = { prompts: [], extensions: { regex_scripts: [
    { id: 'a', scriptName: 'A', findRegex: 'a' },
    { id: 'b', scriptName: 'B', findRegex: 'new-b', disabled: true },
  ] } };

  assert.deepEqual(copyRegexScript(oldPreset, newPreset, 'old', 1), { mode: 'overwrite', index: 1 });
  assert.deepEqual(newPreset.extensions.regex_scripts[1], oldPreset.extensions.regex_scripts[1]);
  newPreset.extensions.regex_scripts[1].findRegex = 'independent';
  assert.equal(oldPreset.extensions.regex_scripts[1].findRegex, 'old-b');

  assert.deepEqual(copyRegexScript(oldPreset, newPreset, 'old', 2), { mode: 'insert', index: 2 });
  assert.deepEqual(newPreset.extensions.regex_scripts.map(script => script.id), ['a', 'b', 'c']);

  const reversedTarget = { prompts: [], extensions: { regex_scripts: [
    { id: 'c', scriptName: 'C', findRegex: 'c' },
    { id: 'a', scriptName: 'A', findRegex: 'a' },
  ] } };
  assert.deepEqual(copyRegexScript(oldPreset, reversedTarget, 'old', 1), { mode: 'insert', index: 2 });
  assert.deepEqual(reversedTarget.extensions.regex_scripts.map(script => script.id), ['c', 'a', 'b']);

  const emptyTarget = { prompts: [] };
  assert.deepEqual(copyRegexScript(oldPreset, emptyTarget, 'old', 0), { mode: 'insert', index: 0 });
  assert.equal(emptyTarget.extensions.regex_scripts[0].id, 'a');
});

test('BaiBai regex groups render by group metadata and keep ungrouped scripts', () => {
  const preset = { extensions: {
    regex_scripts: [
      { id: 'a', scriptName: 'A' },
      { id: 'b', scriptName: 'B' },
      { id: 'c', scriptName: 'C' },
    ],
    baibaiToolkit: { regexGroups: {
      version: 1,
      groups: [
        { id: 'late', name: '后置', order: 1, collapsed: true },
        { id: 'early', name: '前置', order: 0, collapsed: false },
      ],
      scripts: {
        a: { groupId: 'early', order: 1 },
        b: { groupId: 'early', order: 0 },
        c: { groupId: 'missing-group', order: 0 },
      },
      ungrouped: { name: '散装', collapsed: false },
    } },
  } };
  const model = getRegexGroupModel(preset);
  assert.equal(model.enabled, true);
  assert.deepEqual(model.groups.map(group => group.name), ['前置', '后置', '散装']);
  assert.deepEqual(model.groups[0].scripts.map(item => item.script.id), ['b', 'a']);
  assert.deepEqual(model.groups[2].scripts.map(item => item.script.id), ['c']);
});

test('regex migration preserves BaiBai groups and supports explicit drop targets', () => {
  const oldPreset = { extensions: {
    regex_scripts: [
      { id: 'a', scriptName: 'A' },
      { id: 'b', scriptName: 'B' },
    ],
    baibaiToolkit: { regexGroups: {
      version: 1,
      groups: [{ id: 'cleanup', name: '清理', order: 0, collapsed: true }],
      scripts: { a: { groupId: 'cleanup', order: 0 }, b: { groupId: 'cleanup', order: 1 } },
      ungrouped: { name: '未分组', collapsed: false },
    } },
  } };
  const newPreset = { extensions: {
    regex_scripts: [{ id: 'z', scriptName: 'Z' }],
    baibaiToolkit: { regexGroups: {
      version: 1,
      groups: [{ id: 'target', name: '目标组', order: 0, collapsed: false }],
      scripts: { z: { groupId: 'target', order: 0 } },
      ungrouped: { name: '未分组', collapsed: false },
    } },
  } };

  copyRegexScript(oldPreset, newPreset, 'old', 0);
  assert.equal(newPreset.extensions.baibaiToolkit.regexGroups.groups[1].id, 'cleanup');
  assert.deepEqual(newPreset.extensions.baibaiToolkit.regexGroups.scripts.a, { groupId: 'cleanup', order: 0 });

  copyRegexScript(oldPreset, newPreset, 'old', 1, { targetGroupId: 'target', beforeId: 'z' });
  assert.deepEqual(newPreset.extensions.regex_scripts.map(script => script.id), ['b', 'z', 'a']);
  assert.deepEqual(newPreset.extensions.baibaiToolkit.regexGroups.scripts.b, { groupId: 'target', order: 0 });
  assert.deepEqual(newPreset.extensions.baibaiToolkit.regexGroups.scripts.z, { groupId: 'target', order: 1 });
});

test('same-side regex drag reorders a BaiBai group and updates compact orders', () => {
  const preset = { extensions: {
    regex_scripts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    baibaiToolkit: { regexGroups: {
      version: 1,
      groups: [{ id: 'g', name: '组', order: 0, collapsed: false }],
      scripts: {
        a: { groupId: 'g', order: 0 },
        b: { groupId: 'g', order: 1 },
        c: { groupId: '__ungrouped', order: 0 },
      },
      ungrouped: { name: '未分组', collapsed: false },
    } },
  } };
  assert.deepEqual(reorderRegexScript(preset, 1, { targetGroupId: 'g', beforeId: 'a' }), { index: 0 });
  assert.deepEqual(preset.extensions.regex_scripts.map(script => script.id), ['b', 'a', 'c']);
  assert.deepEqual(preset.extensions.baibaiToolkit.regexGroups.scripts.b, { groupId: 'g', order: 0 });
  assert.deepEqual(preset.extensions.baibaiToolkit.regexGroups.scripts.a, { groupId: 'g', order: 1 });
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
