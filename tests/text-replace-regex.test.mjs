// 正则查找替换回归：表达式标记、捕获替换、零宽插入与完整基线校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/features/preset/text-replace.js';

const prompt = (identifier, content, name = identifier) => ({identifier, name, content, enabled: true, injection_order: 7});
const planFor = (entries, options) => engine.createReplacementPlan(entries, {regex: true, ...options});

test('regex search supports raw patterns and slash flags without changing literal mode', () => {
  assert.equal(typeof engine.findSearchRanges, 'function');
  assert.deepEqual(engine.findSearchRanges('a1 A2 a3', 'a\\d', {regex: true}), [[0, 2], [6, 8]]);
  assert.deepEqual(engine.findSearchRanges('a1 A2 a3', '/a\\d/i', {regex: true}), [[0, 2], [3, 5], [6, 8]]);
  assert.deepEqual(engine.findSearchRanges('a1 A2 a3', '/a\\d/g', {regex: true, caseSensitive: false}), [[0, 2], [6, 8]]);
  assert.deepEqual(engine.findSearchRanges('a1 A2 a3', 'a\\d', {regex: true, caseSensitive: false}), [[0, 2], [6, 8]]);
  assert.deepEqual(engine.findSearchRanges('x a\\d y', 'a\\d'), [[2, 5]]);
  assert.deepEqual(engine.findLiteralRanges('x a\\d y', 'a\\d'), [[2, 5]]);
  assert.deepEqual(engine.findSearchRanges('foo\nBAR\nfoo', '/^foo$/gm', {regex: true}), [[0, 3], [8, 11]]);
  assert.deepEqual(engine.findSearchRanges('a\nb', '/a.b/s', {regex: true}), [[0, 3]]);
  assert.deepEqual(engine.findSearchRanges('path/end /', '/path\\/end/g', {regex: true}), [[0, 8]]);
});

test('regex plans resolve numbered and named captures independently for every match', () => {
  const source = [prompt('a', 'Ada:12 Bea:7', 'Ada:12')];
  const plan = planFor(source, {query: '(?<who>\\w+):(\\d+)', replacement: '$<who> [$2] $$ $& $3', fields: ['name', 'content']});
  assert.equal(plan.version, 1);
  assert.equal(plan.regex, true);
  assert.deepEqual(plan.matches.map(match => match.replacement), ['Ada [12] $ Ada:12 $3', 'Ada [12] $ Ada:12 $3', 'Bea [7] $ Bea:7 $3']);
  const result = engine.applyReplacementPlan(source, plan);
  assert.equal(result.entries[0].content, 'Ada [12] $ Ada:12 $3 Bea [7] $ Bea:7 $3');
  assert.equal(result.entries[0].name, 'Ada [12] $ Ada:12 $3');
  assert.equal(result.replacementCount, 3);
  assert.equal(source[0].content, 'Ada:12 Bea:7');
});

test('regex replacement prefix suffix and numeric fallbacks follow JavaScript substitution', () => {
  const source = [prompt('a', 'xabz')];
  const plan = planFor(source, {query: '(a)(b)?', replacement: "$`|$'|$01|$10|$2|$0|$00|$99|$<missing>"});
  assert.equal(plan.matches[0].replacement, 'x|z|a|a0|b|$0|$00|$99|$<missing>');
  assert.equal(engine.applyReplacementPlan(source, plan).entries[0].content, 'xx|z|a|a0|b|$0|$00|$99|$<missing>z');
  const optional = planFor([prompt('a', 'b')], {query: '(?<first>a)?b', replacement: '$1/$<first>/$<missing>'});
  assert.equal(optional.matches[0].replacement, '//');
});

test('regex partial application uses original positions and never rescans inserted text', () => {
  const source = [prompt('a', 'a1 a2 a3'), {...prompt('b', 'a4'), extension: {group: 'keep'}}];
  const snapshot = structuredClone(source);
  const plan = planFor(source, {query: 'a(\\d)', replacement: 'a$1a$1'});
  const result = engine.applyReplacementPlan(source, plan, [plan.matches[2].key, plan.matches[0].key]);
  assert.equal(result.entries[0].content, 'a1a1 a2 a3a3');
  assert.equal(result.entries[1], source[1]);
  assert.equal(result.entries[0].injection_order, 7);
  assert.deepEqual(result.changedIds, ['a']);
  assert.equal(result.replacementCount, 2);
  assert.deepEqual(source, snapshot);
});

test('zero-width regex matches advance by Unicode code points and allow selected insertion', () => {
  assert.equal(typeof engine.findSearchRanges, 'function');
  assert.deepEqual(engine.findSearchRanges('😀x', '/(?=.)/gu', {regex: true}), [[0, 0], [2, 2]]);
  assert.deepEqual(engine.findSearchRanges('😀', '/(?:)/gu', {regex: true}), [[0, 0], [2, 2]]);
  assert.deepEqual(engine.findSearchRanges('😀', '/(?:)/g', {regex: true}), [[0, 0], [1, 1], [2, 2]]);
  const source = [prompt('a', '😀x')];
  const plan = planFor(source, {query: '/(?=.)/gu', replacement: '|'});
  assert.equal(engine.applyReplacementPlan(source, plan).entries[0].content, '|😀|x');
  assert.equal(engine.applyReplacementPlan(source, plan, [plan.matches[1].key]).entries[0].content, '😀|x');
  const empty = planFor([prompt('a', '')], {query: '^$', replacement: 'empty'});
  assert.equal(engine.applyReplacementPlan([prompt('a', '')], empty).entries[0].content, 'empty');
});

test('invalid and empty regex expressions fail before constructing an empty result', () => {
  for (const query of ['', '//', '//g', '/foo/gg', '/foo/z', '/foo/ii', '[', '/x/uv']) {
    assert.throws(() => planFor([], {query, replacement: 'x'}), /不能为空|正则/);
  }
  assert.throws(() => planFor([], {query: 'x', replacement: 'y', regex: 'true'}), /正则/);
});

test('regex no-ops are excluded and old literal version-one plans remain compatible', () => {
  const source = [prompt('a', 'one ONE')];
  const noop = planFor(source, {query: '/one/gi', replacement: '$&'});
  assert.equal(noop.matches.length, 0);
  assert.equal(engine.applyReplacementPlan(source, noop).entries, source);
  const oldPlan = engine.createReplacementPlan(source, {query: 'one', replacement: '$&'});
  delete oldPlan.regex;
  assert.equal(engine.applyReplacementPlan(source, oldPlan).entries[0].content, '$& ONE');
});

test('regex plans reject changed fields and forged resolved replacement atomically', () => {
  const source = [prompt('a', 'cat1 first'), prompt('b', 'cat2 second')];
  const plan = planFor(source, {query: 'cat(\\d)', replacement: 'dog$1'});
  const current = [source[0], {...source[1], content: 'cat2 changed'}];
  const snapshot = structuredClone(current);
  assert.throws(() => engine.applyReplacementPlan(current, plan), /已变化/);
  assert.deepEqual(current, snapshot);
  assert.equal(engine.applyReplacementPlan(current, plan, [plan.matches[0].key]).entries[0].content, 'dog1 first');
  const forged = structuredClone(plan);
  forged.matches[0].replacement = 'unexpected';
  assert.throws(() => engine.applyReplacementPlan(source, forged), /替换|命中/);
  const forgedRange = structuredClone(plan);
  Object.assign(forgedRange.matches[0], {start: 1, end: 4, before: 'at1', key: JSON.stringify(['a', 'content', 1, 4])});
  assert.throws(() => engine.applyReplacementPlan(source, forgedRange), /不符合查找/);
  assert.equal(source[0].content, 'cat1 first');
});

test('search and plan reject excessive matches instead of truncating the operation', () => {
  assert.equal(typeof engine.findSearchRanges, 'function');
  assert.throws(() => engine.findSearchRanges('a'.repeat(100001), 'a', {regex: true}), /过多|上限/);
  assert.throws(() => planFor([prompt('a', 'a'.repeat(60000)), prompt('b', 'a'.repeat(60000))], {query: 'a', replacement: 'b'}), /过多|上限/);
});

test('regex expansion rejects oversized cumulative output before allocating a result', () => {
  const source = [prompt('a', 'a'.repeat(5000))];
  assert.throws(() => planFor(source, {query: 'a', replacement: '$`$`$`$`'}), /替换结果过大/);
  assert.equal(source[0].content.length, 5000);
  // Applying a hand-built plan must enforce the same limit, even for a selected hit.
  const plan = planFor(source, {query: 'a', replacement: 'b'});
  plan.replacement = '$`$`$`$`';
  plan.matches[0].replacement = '';
  assert.throws(() => engine.applyReplacementPlan(source, plan, [plan.matches[0].key]), /替换结果过大/);
});
