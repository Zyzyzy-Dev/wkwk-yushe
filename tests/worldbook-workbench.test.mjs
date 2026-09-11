// 世界书工作台纯测：安全规范化、跨书配对、原子迁移排序和预设转换。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as wb from '../src/worldbook-workbench.js';

const book = () => ({ custom: { keep: [1, 2] }, entries: {
  5: { uid: 5, comment: '甲', content: 'alpha', displayIndex: 2, order: 77, custom: { a: 1 } },
  8: { uid: 8, comment: '乙', content: 'beta', displayIndex: 0, order: 88, disable: true },
} });

test('native normalization preserves unknown metadata, missing defaults and original references', () => {
  const source = book(), before = structuredClone(source), result = wb.normalizeWorkbenchBook(source);
  assert.deepEqual(result, before); assert.notEqual(result.entries[5], source.entries[5]);
  assert.deepEqual(wb.workbenchEntries(result).map(row => row.id), ['8', '5']);
  assert.equal(wb.workbenchEntries(result)[0].entry, result.entries[8]);
  assert.equal('constant' in result.entries[5], false); assert.deepEqual(source, before);
});

test('character books map standard and extension settings and reserve explicit IDs before allocation', () => {
  const source = { character_book: { name: '嵌入', custom: 42, entries: [
    { name: '空ID', content: '', keys: ['a'], enabled: false, insertion_order: 45, position: 'after_char', extensions: { depth: 6, position: 4, role: 2, exclude_recursion: true, private: 9 } },
    { id: 0, content: 'zero', keys: [], enabled: true, position: 'before_char' },
  ] } };
  const before = structuredClone(source), result = wb.normalizeWorkbenchBook(source);
  assert.equal(result.name, '嵌入'); assert.equal(result.custom, 42);
  const row = wb.workbenchEntries(result)[0].entry;
  assert.notEqual(row.uid, 0); assert.equal(row.comment, '空ID'); assert.equal(row.disable, true);
  assert.equal(row.position, 4); assert.equal(row.role, 2); assert.equal(row.order, 45);
  assert.equal(row.excludeRecursion, true); assert.equal(row.extensions.private, 9);
  assert.deepEqual(row.key, ['a']); assert.deepEqual(source, before);
});

test('normalization rejects unsafe JSON, duplicate UIDs and invalid entry settings', () => {
  const cycle = {}; cycle.self = cycle;
  const invalid = [null, {}, { entries: { 0: { content: null } } },
    JSON.parse('{"entries":{},"__proto__":{}}'), { entries: {}, custom: cycle },
    { entries: {}, custom: undefined }, { entries: {}, custom: NaN }, { entries: {}, custom: new Date() },
    { entries: { 0: { uid: 1, content: '' }, 1: { uid: 1, content: '' } } }];
  for (const value of invalid) assert.throws(() => wb.normalizeWorkbenchBook(value));
  for (const patch of [{ key: [5] }, { disable: 'false' }, { position: Infinity }, { depth: '4' }, { probability: 101 }, { role: 9 }, { comment: [] }]) {
    assert.throws(() => wb.normalizeWorkbenchBook({ entries: { 0: { content: '', ...patch } } }));
  }
});

test('cross-book pairing uses unique names and content, never shared UID alone', () => {
  const left = { entries: { 0: { uid: 0, comment: 'A', content: 'old' }, 1: { uid: 1, comment: 'B', content: 'same' } } };
  const right = { entries: { 0: { uid: 0, comment: 'Unrelated', content: 'other' }, 8: { uid: 8, comment: 'A', content: 'new' }, 9: { uid: 9, comment: 'Renamed', content: 'same' } } };
  assert.deepEqual(wb.compareWorldbooks(left, right), [
    { leftId: '0', rightId: '8', status: 'content' }, { leftId: '1', rightId: '9', status: 'settings' }, { leftId: null, rightId: '0', status: 'only' },
  ]);
  assert.equal(wb.compareWorldbooks({ entries: { 1: { comment: 'A', content: 'a b', displayIndex: 3 } } }, { entries: { 9: { comment: 'A', content: 'ab', displayIndex: 0 } } }, { ignoreWhitespace: true })[0].status, 'same');
});

test('ambiguous duplicate names and bodies remain unpaired', () => {
  const value = { entries: { 0: { comment: 'A', content: 'x' }, 1: { comment: 'A', content: 'x' } } };
  assert.equal(wb.compareWorldbooks(value, value).filter(row => row.status === 'only').length, 4);
});

test('copy allocates collision-free IDs, preserves full entries and source, and inserts by display order', () => {
  const source = book(), target = book(), before = structuredClone(source);
  const result = wb.transferWorldEntries(source, target, ['5', '8'], { beforeId: '5' });
  assert.equal(result.ids.length, 2); assert.ok(result.ids.every(id => !['5', '8'].includes(id)));
  assert.deepEqual(wb.workbenchEntries(result.book).map(row => row.id), ['8', ...result.ids, '5']);
  assert.deepEqual(result.book.entries[result.ids[0]].custom, { a: 1 });
  assert.equal(result.book.entries[result.ids[1]].disable, true);
  assert.deepEqual(source, before); assert.deepEqual(target, before);
});

test('replace preserves target UID and display order but replaces every other entry field', () => {
  const target = book(), source = { entries: { 1: { uid: 1, content: 'replacement', order: 3, private: true } } };
  const result = wb.transferWorldEntries(source, target, ['1'], { mode: 'replace', targetId: '8' });
  assert.deepEqual(result.ids, ['8']);
  assert.deepEqual(result.book.entries[8], { uid: 8, content: 'replacement', order: 3, private: true, displayIndex: 0 });
  assert.deepEqual(result.book.entries[5], target.entries[5]);
  assert.throws(() => wb.transferWorldEntries(book(), target, ['5', '8'], { mode: 'replace', targetId: '8' }));
});

test('reordering changes displayIndex only and rejects stale or self anchors atomically', () => {
  const source = book(), before = structuredClone(source);
  const result = wb.reorderWorldEntries(source, ['5'], { beforeId: '8' });
  assert.deepEqual(wb.workbenchEntries(result.book).map(row => row.id), ['5', '8']);
  assert.equal(result.book.entries[5].order, 77); assert.equal(result.book.entries[8].order, 88);
  for (const options of [{ afterId: '5' }, { beforeId: 'missing' }, { beforeId: '8', afterId: '8' }, { placement: 'bad' }]) assert.throws(() => wb.reorderWorldEntries(source, ['5'], options));
  assert.throws(() => wb.transferWorldEntries(source, source, ['missing']));
  assert.deepEqual(source, before);
});

test('preset conversion follows active prompt_order, skips markers and preserves individual switches', () => {
  const preset = { prompts: [
    { identifier: 'a', name: 'A', content: 'a', role: 'assistant', injection_depth: 6, injection_position: 1, injection_order: 22 },
    { identifier: 'b', content: 'b', enabled: false }, { identifier: 'c', content: 'c' }, { identifier: 'marker', marker: true },
  ], prompt_order: [{ character_id: 100001, order: [{ identifier: 'b', enabled: false }, { identifier: 'a', enabled: true }, { identifier: 'marker', enabled: true }] }] };
  const before = structuredClone(preset), entries = wb.presetWorkbenchEntries(preset);
  assert.deepEqual(entries.map(row => [row.id, row.enabled]), [['b', false], ['a', true], ['c', false]]);
  const converted = wb.insertPresetWorldEntries(book(), entries, { placement: 'start' });
  const rows = converted.ids.map(id => converted.book.entries[id]);
  assert.equal(rows[0].disable, true); assert.equal(rows[0].constant, true);
  assert.equal(rows[1].role, 2); assert.equal(rows[1].position, 4); assert.equal(rows[1].depth, 6); assert.equal(rows[1].order, 22);
  assert.equal(rows[2].position, 0); assert.deepEqual(rows[1].key, []);
  assert.deepEqual(preset, before);
  assert.equal(wb.insertPresetWorldEntries(book(), entries.slice(0, 1), { trigger: 'keyword' }).book.entries[0].constant, false);
});

test('blank entry defaults to enabled constant with native settings and independent arrays', () => {
  const source = book(), result = wb.createWorkbenchEntry(source, { beforeId: '5' });
  const row = result.book.entries[result.ids[0]];
  assert.equal(row.content, ''); assert.equal(row.constant, true); assert.equal(row.disable, false); assert.equal(row.order, 100);
  assert.deepEqual(wb.workbenchEntries(result.book).map(item => item.id), ['8', ...result.ids, '5']);
  assert.deepEqual(source, book());
});

test('explicit invalid IDs and invalid standard positions are rejected instead of silently allocated or reset', () => {
  for (const id of [null, false, -1, 1.5, '01', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => wb.normalizeWorkbenchBook({ entries: { 0: { uid: id, content: '' } } }));
    assert.throws(() => wb.normalizeWorkbenchBook({ entries: [{ id, content: '' }] }));
  }
  assert.throws(() => wb.normalizeWorkbenchBook({ entries: [{ content: '', position: 'bogus' }] }));
});

test('validation never executes accessors and refuses non-JSON array holes', () => {
  let calls = 0;
  const unsafe = { entries: {} };
  Object.defineProperty(unsafe, 'custom', { enumerable: true, get() { calls++; return 1; } });
  assert.throws(() => wb.normalizeWorkbenchBook(unsafe)); assert.equal(calls, 0);
  assert.throws(() => wb.normalizeWorkbenchBook({ entries: {}, custom: Array(2) }));
});

test('transfers fail atomically on bad destination or later invalid input and detach nested data', () => {
  const source = book(), before = structuredClone(source);
  assert.throws(() => wb.transferWorldEntries(source, source, ['5'], { beforeId: 'gone' }));
  assert.throws(() => wb.insertPresetWorldEntries(source, [{ content: 'valid' }, { content: {} }]));
  assert.deepEqual(source, before);
  const result = wb.transferWorldEntries(source, source, ['5']);
  result.book.entries[result.ids[0]].custom.a = 99;
  assert.equal(result.book.entries[5].custom.a, 1); assert.deepEqual(source, before);
});
