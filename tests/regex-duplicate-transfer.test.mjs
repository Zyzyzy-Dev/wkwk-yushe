// 重复正则 ID 的迁移回归：保留条目身份与同组顺序；元数据不能表达的跨组冲突仍须原子拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferRegexScripts, getRegexGroupModel } from '../src/features/preset/core.js';

const script = (id, name, extra = {}) => ({
  id, scriptName: name, findRegex: `/${name}/g`, replaceString: `<${name}>`,
  placement: [2], disabled: false, custom: { preserve: name }, ...extra,
});
const groups = mapping => ({
  version: 1, custom: { untouched: true },
  groups: [{ id: 'g', name: 'G', order: 0, collapsed: true, extra: 1 }, { id: 'h', name: 'H', order: 1 }],
  scripts: Object.fromEntries(Object.entries(mapping).map(([id, groupId], order) => [id, { groupId, order, extra: id }])),
  ungrouped: { name: '未分组', collapsed: false, extra: 2 },
});
const preset = (rows, mapping) => ({
  prompts: [], extensions: {
    regex_scripts: rows,
    other: { untouched: true },
    ...(mapping ? { baibaiToolkit: { other: 3, regexGroups: groups(mapping) } } : {}),
  },
});
const scripts = value => value.extensions.regex_scripts;
const meta = value => value.extensions.baibaiToolkit.regexGroups;
const visual = value => getRegexGroupModel(value).groups.map(group => [group.id, group.scripts.map(item => item.script.scriptName)]);

test('unrelated duplicated target IDs do not block a single migration or change existing identities and group metadata', () => {
  const source = preset([script('new', '新增')]);
  const target = preset([script('same', '第一条'), script('same', '第二条'), script('tail', '另一组')], { same: 'g', tail: 'h' });
  const sourceBefore = structuredClone(source), targetBefore = structuredClone(target);
  assert.deepEqual(transferRegexScripts(source, target, 'old', [0]), { count: 1, overwritten: 0 });
  assert.deepEqual(scripts(target).slice(0, 3), scripts(targetBefore));
  assert.deepEqual(meta(target).scripts.same, { groupId: 'g', extra: 'same' });
  assert.deepEqual(visual(target), [['g', ['第一条', '第二条']], ['h', ['另一组']], ['__ungrouped', ['新增']]]);
  assert.deepEqual(meta(target).groups, meta(targetBefore).groups);
  assert.deepEqual(meta(target).custom, meta(targetBefore).custom);
  assert.deepEqual(meta(target).ungrouped, meta(targetBefore).ungrouped);
  assert.deepEqual(target.extensions.other, targetBefore.extensions.other);
  assert.equal(target.extensions.baibaiToolkit.other, 3);
  assert.deepEqual(source, sourceBefore);
});

test('an imported duplicate-ID group preserves both scripts instead of dropping or renaming a member', () => {
  const source = preset([script('same', '成员甲'), script('same', '成员乙', { disabled: true })], { same: 'g' });
  const target = preset([]);
  const sourceBefore = structuredClone(source);
  transferRegexScripts(source, target, 'new', [1, 0]);
  assert.deepEqual(scripts(target), scripts(source));
  assert.deepEqual(visual(target), [['g', ['成员甲', '成员乙']]]);
  assert.equal(meta(target).scripts.same.groupId, 'g');
  assert.deepEqual(source, sourceBefore);
});

test('inserting between shared IDs rejects an order that a shared group record cannot preserve', () => {
  const source = preset([script('new', '新增')]);
  const target = preset([script('same', '第一条'), script('same', '第二条'), script('tail', '末尾')], { same: 'g', tail: 'g' });
  const before = structuredClone(target), extension = target.extensions;
  assert.throws(() => transferRegexScripts(source, target, 'old', [0], { targetGroupId: 'g', beforeIndex: 1 }), /顺序/);
  assert.deepEqual(target, before);
  assert.equal(target.extensions, extension);
  assert.throws(() => transferRegexScripts(preset([script('', '无编号')]), target, 'old', [0], { targetGroupId: 'g', beforeIndex: 1 }), /顺序/);
  assert.deepEqual(target, before);
  assert.equal(target.extensions, extension);
  transferRegexScripts(source, target, 'old', [0], { targetGroupId: 'g', beforeIndex: 2 });
  assert.deepEqual(visual(JSON.parse(JSON.stringify(target))), [['g', ['第一条', '第二条', '新增', '末尾']], ['h', []]]);
});

test('same-side drag cannot split shared-ID siblings around another row', () => {
  const target = preset([script('same', '第一条'), script('same', '第二条'), script('tail', '末尾')], { same: 'g', tail: 'g' });
  const before = structuredClone(target), extension = target.extensions;
  assert.throws(() => transferRegexScripts(target, target, 'old', [0], { targetGroupId: 'g', beforeIndex: null }), /顺序/);
  assert.deepEqual(target, before);
  assert.equal(target.extensions, extension);
  transferRegexScripts(target, target, 'old', [0,1], { targetGroupId:'g', beforeIndex:null });
  assert.deepEqual(visual(target), [['g', ['末尾', '第一条', '第二条']], ['h', []]]);
});

test('a unique source row repeatedly updates its name-matched duplicate without stealing its sibling identity', () => {
  const source = preset([script('same', '第二条', { replaceString: '已更新' })], { same: 'g' });
  const target = preset([script('same', '第一条'), script('same', '第二条')], { same: 'h' });
  const first = structuredClone(scripts(target)[0]);
  for (let iteration = 0; iteration < 3; iteration++) {
    assert.deepEqual(transferRegexScripts(source, target, 'old', [0]), { count: 1, overwritten: 1 });
    assert.deepEqual(scripts(target)[0], first);
    assert.deepEqual(scripts(target)[1], scripts(source)[0]);
    assert.deepEqual(visual(target), [['g', []], ['h', ['第一条', '第二条']]]);
  }
});

test('ambiguous duplicate names are added without guessing a counterpart, while preserving existing shared metadata', () => {
  const source = preset([script('same', '同名'), script('same', '同名')], { same: 'g' });
  const target = preset([script('same', '同名', { replaceString: '旧甲' }), script('same', '同名', { replaceString: '旧乙' })], { same: 'g' });
  const before = structuredClone(target);
  assert.deepEqual(transferRegexScripts(source, target, 'old', [0, 1]), { count: 2, overwritten: 0 });
  assert.deepEqual(scripts(target).slice(0, 2), scripts(before));
  assert.deepEqual(scripts(target).slice(2), scripts(source));
  assert.deepEqual(meta(target).scripts.same, { groupId: 'g', extra: 'same' });
});

test('splitting a shared ID across groups is rejected atomically instead of assigning both rows to the last group', () => {
  const target = preset([script('same', '第一条'), script('same', '第二条'), script('tail', '末尾')], { same: 'g', tail: 'h' });
  const before = structuredClone(target), extension = target.extensions;
  assert.throws(() => transferRegexScripts(target, target, 'old', [0], { targetGroupId: 'h', beforeIndex: 2 }), /不同分组/);
  assert.deepEqual(target, before);
  assert.equal(target.extensions, extension);
});

test('a cross-preset shared-ID collision in different groups cannot overwrite unrelated target group membership', () => {
  const source = preset([script('same', '新甲'), script('same', '新乙')], { same: 'g' });
  const target = preset([script('same', '原条目')], { same: 'h' });
  const before = structuredClone([source, target]);
  assert.throws(() => transferRegexScripts(source, target, 'old', [0, 1]), /不同分组/);
  assert.deepEqual([source, target], before);
});

test('ambiguous ID-only anchors and invalid groups still fail without any partial metadata update', () => {
  for (const options of [{ beforeId: 'same' }, { targetGroupId: 'missing', beforeIndex: null }]) {
    const source = preset([script('new', '新增')]);
    const target = preset([script('same', '第一条'), script('same', '第二条')], { same: 'g' });
    const before = structuredClone([source, target]);
    assert.throws(() => transferRegexScripts(source, target, 'old', [0], options));
    assert.deepEqual([source, target], before);
  }
});

test('unrelated missing IDs and metadata survive a shared-ID group migration', () => {
  const source = preset([script('new', '新增')]);
  const target = preset([script('same', '第一条'), script('same', '第二条'), script('', '无编号'), script('tail', '末尾')], {same:'g',tail:'g'});
  meta(target).scripts.orphan = { groupId: 'h', order: 88, custom: { preserve: true } };
  transferRegexScripts(source, target, 'old', [0], { targetGroupId: 'g', beforeIndex: 3 });
  assert.deepEqual(visual(target), [['g', ['第一条', '第二条', '新增', '末尾']], ['h', []], ['__ungrouped', ['无编号']]]);
  assert.deepEqual(scripts(target).map(item => item.id), ['same', 'same', 'new', 'tail', '']);
  assert.deepEqual(meta(target).scripts.orphan, { groupId: 'h', order: 88, custom: { preserve: true } });
});

test('a group mixing shared and missing IDs is rejected before host normalization can reorder rows', () => {
  const source = preset([script('new','新增')]);
  const target = preset([script('same','甲'),script('same','乙'),script('','空甲'),script('','空乙'),script('tail','尾')], {});
  const before=structuredClone(target),extension=target.extensions;
  assert.throws(()=>transferRegexScripts(source,target,'old',[0]),/无 ID/);
  assert.deepEqual(target,before);
  assert.equal(target.extensions,extension);
});
