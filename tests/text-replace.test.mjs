// 预设查找替换回归：字面量与原文偏移、局部选择、字段白名单、失效预览和原子更新。
import test from 'node:test';
import assert from 'node:assert/strict';
import {findLiteralRanges, createReplacementPlan, applyReplacementPlan} from '../src/features/preset/text-replace.js';

const prompt = (identifier, content, name = identifier) => ({identifier, name, content, enabled: true, injection_order: 7});

test('literal search preserves significant whitespace, multiline CRLF and non-overlapping positions', () => {
  assert.deepEqual(findLiteralRanges('  alpha\r\n beta  ', ' \r\n'), []);
  assert.deepEqual(findLiteralRanges('  alpha\r\n beta  ', '\r\n '), [[7, 10]]);
  assert.deepEqual(findLiteralRanges('x  x', ' '), [[1, 2], [2, 3]]);
  assert.deepEqual(findLiteralRanges('aaaaa', 'aa'), [[0, 2], [2, 4]]);
  assert.deepEqual(findLiteralRanges('one ONE', 'one'), [[0, 3]]);
  assert.deepEqual(findLiteralRanges('one ONE', 'one', {caseSensitive: false}), [[0, 3], [4, 7]]);
  assert.throws(() => findLiteralRanges('abc', ''), /不能为空/);
});

test('case-insensitive Unicode matching retains original offsets without partial case-expansion matches', () => {
  assert.deepEqual(findLiteralRanges('İx İX 😀X', 'x', {caseSensitive: false}), [[1, 2], [4, 5], [8, 9]]);
  assert.deepEqual(findLiteralRanges('😀😀你好😀你好', '😀你好'), [[2, 6], [6, 10]]);
  assert.deepEqual(findLiteralRanges('𐐀x𐐨X', '𐐨x', {caseSensitive: false}), [[0, 3], [3, 6]]);
  assert.deepEqual(findLiteralRanges('Σσς Kk', 'σ', {caseSensitive: false}), [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(findLiteralRanges('İi', 'i', {caseSensitive: false}), [[1, 2]]);
  const entries = [prompt('unicode', 'İx İX 😀X')];
  assert.equal(applyReplacementPlan(entries, createReplacementPlan(entries, {query: 'x', replacement: 'Y', caseSensitive: false})).entries[0].content, 'İY İY 😀Y');
});

test('regex punctuation and replacement dollar sequences are literal, with no replacement rescanning', () => {
  for (const query of ['[a]+', '.*', '${x}', '\\', '(a)|b?', '^$', '<>&"', '\n', '{{getvar::name}}']) {
    assert.deepEqual(findLiteralRanges(`X${query}Y`, query, {caseSensitive: false}), [[1, 1 + query.length]]);
  }
  const entries = [prompt('a', 'find find')];
  const result = applyReplacementPlan(entries, createReplacementPlan(entries, {query: 'find', replacement: '$& $1 find'}));
  assert.equal(result.entries[0].content, '$& $1 find $& $1 find');
  assert.equal(result.replacementCount, 2);
});

test('partial selection applies original offsets and preserves untouched objects, config, order and input', () => {
  const entries = [prompt('a', 'cat cat cat'), {...prompt('b', 'cat'), extension: {group: 'keep'}}, prompt('c', 'unrelated')];
  const snapshot = structuredClone(entries);
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'much longer'});
  const result = applyReplacementPlan(entries, plan, [plan.matches[2].key, plan.matches[0].key]);
  assert.equal(result.entries[0].content, 'much longer cat much longer');
  assert.equal(result.entries[1], entries[1]);
  assert.equal(result.entries[2], entries[2]);
  assert.deepEqual(result.changedIds, ['a']);
  assert.equal(result.replacementCount, 2);
  assert.deepEqual(entries, snapshot);
  assert.equal(result.entries[0].identifier, 'a');
  assert.equal(result.entries[0].injection_order, 7);
  assert.equal(plan.entryCount, 2);
});

test('multi-field replacements retain full field baselines and count entries once', () => {
  const entries = [{...prompt('foo', 'foo\r\nfoo', 'foo title'), extension: {description: 'foo'}, system_prompt: 'foo'}];
  const plan = createReplacementPlan(entries, {query: 'foo', replacement: 'bar', fields: ['name', 'content']});
  assert.equal(plan.entryCount, 1);
  assert.equal(plan.matches.length, 3);
  assert.deepEqual(plan.baselines, [{id: 'foo', field: 'name', text: 'foo title'}, {id: 'foo', field: 'content', text: 'foo\r\nfoo'}]);
  assert.equal(plan.matches[2].before, 'foo');
  const result = applyReplacementPlan(entries, plan);
  assert.deepEqual(result.entries[0], {...entries[0], name: 'bar title', content: 'bar\r\nbar'});
  assert.equal(result.entries[0].extension, entries[0].extension);
  assert.equal(result.replacementCount, 3);
  for (const fields of [['identifier'], ['content', 'enabled'], ['__proto__'], []]) {
    assert.throws(() => createReplacementPlan(entries, {query: 'foo', replacement: 'bar', fields}), /字段/);
  }
});

test('blank replacement deletes only selected literal text and retains surrounding CRLF and indentation', () => {
  const entries = [prompt('a', ' \r\n first\r\n second\r\n ')];
  const result = applyReplacementPlan(entries, createReplacementPlan(entries, {query: 'first\r\n ', replacement: ''}));
  assert.equal(result.entries[0].content, ' \r\n second\r\n ');
  const spaces = applyReplacementPlan(entries, createReplacementPlan(entries, {query: ' ', replacement: '\t'}));
  assert.equal(spaces.entries[0].content, '\t\r\n\tfirst\r\n\tsecond\r\n\t');
});

test('no-op hits are excluded and empty selection never modifies input', () => {
  const entries = [prompt('a', 'foo FOO')];
  const plan = createReplacementPlan(entries, {query: 'foo', replacement: 'foo', caseSensitive: false});
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0].before, 'FOO');
  assert.equal(applyReplacementPlan(entries, plan, []).entries, entries);
  assert.equal(applyReplacementPlan(entries, plan, new Set()).replacementCount, 0);
  assert.equal(applyReplacementPlan(entries, plan, new Set([plan.matches[0].key])).replacementCount, 1);
  assert.equal(applyReplacementPlan(entries, createReplacementPlan(entries, {query: 'foo', replacement: 'foo'})).entries, entries);
});

test('stale full-field baseline is rejected atomically even when the matching substring is unchanged', () => {
  const entries = [prompt('a', 'cat first'), prompt('b', 'cat second')];
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'dog'});
  const current = [entries[0], {...entries[1], content: 'cat changed elsewhere'}];
  const snapshot = structuredClone(current);
  assert.throws(() => applyReplacementPlan(current, plan), /已变化/);
  assert.deepEqual(current, snapshot);
  assert.equal(current[0], entries[0]);
  // Changes to unselected targets do not block a replacement the user still selected.
  const result = applyReplacementPlan(current, plan, [plan.matches[0].key]);
  assert.equal(result.entries[0].content, 'dog first');
  assert.equal(result.entries[1], current[1]);
});

test('baseline verification is field-specific and preserves live non-text config changes', () => {
  const entries = [prompt('a', 'cat', 'cat name')];
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'dog', fields: ['content', 'name']});
  const current = [{...entries[0], enabled: false, name: 'edited name'}];
  assert.throws(() => applyReplacementPlan(current, plan), /已变化/);
  const result = applyReplacementPlan(current, plan, [plan.matches[0].key]);
  assert.deepEqual(result.entries[0], {...current[0], content: 'dog'});
});

test('deleted, renamed or duplicated target IDs are rejected without touching other entries', () => {
  const entries = [prompt('a', 'cat'), prompt('b', 'cat')];
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'dog'});
  for (const current of [[entries[0]], [entries[0], {...entries[1], identifier: 'c'}], [...entries, {...entries[1]}]]) {
    const snapshot = structuredClone(current);
    assert.throws(() => applyReplacementPlan(current, plan), /ID/);
    assert.deepEqual(current, snapshot);
  }
  assert.throws(() => createReplacementPlan([entries[0], {...entries[0]}], {query: 'cat', replacement: 'dog'}), /ID/);
  assert.throws(() => createReplacementPlan([{content: 'cat'}], {query: 'cat', replacement: 'dog'}), /ID/);
});

test('forged range, duplicate keys, unknown selection and unauthorized fields fail atomically', () => {
  const entries = [prompt('a', 'cat cat')];
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'dog'});
  assert.throws(() => applyReplacementPlan(entries, plan, ['no such hit']), /所选命中/);
  assert.throws(() => applyReplacementPlan(entries, {...plan, matches: [...plan.matches, plan.matches[0]]}), /重复/);
  const badRange = structuredClone(plan);
  Object.assign(badRange.matches[0], {start: 1, end: 3, before: 'at', key: JSON.stringify(['a', 'content', 1, 3])});
  assert.throws(() => applyReplacementPlan(entries, badRange), /不符合查找/);
  const badField = structuredClone(plan);
  badField.fields.push('identifier');
  assert.throws(() => applyReplacementPlan(entries, badField), /字段/);
  assert.equal(entries[0].content, 'cat cat');
});

test('non-text optional fields remain absent and malformed queries are rejected', () => {
  const entries = [{identifier: 'missing'}, {identifier: 'null', name: null, content: 12}, prompt('a', 'cat')];
  const plan = createReplacementPlan(entries, {query: 'cat', replacement: 'dog', fields: ['name', 'content']});
  const result = applyReplacementPlan(entries, plan);
  assert.equal(result.entries[0], entries[0]);
  assert.equal(result.entries[1], entries[1]);
  for (const query of ['', null, undefined]) assert.throws(() => createReplacementPlan(entries, {query, replacement: 'dog'}), /不能为空/);
});
