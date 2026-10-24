// 查找替换真实编辑器事务回归：读取 app 函数，验证未提交表单、跨预设撤回边界与草稿原子性。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReplacementPlan, applyReplacementPlan} from '../src/features/preset/text-replace.js';

const source = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, '实际编辑器函数边界存在：' + startMarker);
  return source.slice(start, end);
}
const contextCode = sliceBetween('function getTextReplaceContext(', 'function closeTextReplace(');
const transactionCode = sliceBetween('function applyTextReplacement(', 'function openTextReplace(');

const prompt = (identifier, content, name = identifier) => ({identifier, name, content, role: 'system', injection_position: 0, enabled: true});
function harness() {
  const left = {prompts: [prompt('a', 'old cat', 'old a')]};
  const right = {prompts: [prompt('a', 'cat first', 'cat title'), prompt('b', 'untouched', 'b title'), prompt('c', 'another body', 'c title')]};
  const state = {
    old: left, new: right, oldName: 'old preset', newName: 'new preset', tavernSource: {old: 'old', new: 'new'},
    multiSelect: {selected: {old: new Set(), new: new Set(['a'])}}, freeSelect: {enabled: false, oldId: null, newId: null},
    activeId: 'a', dirty: {old: false, new: false}, modified: {old: new Set(), new: new Set(['prior'])},
  };
  const inlineDrafts = new WeakMap(), textReplaceLineages = new WeakMap(), undo = [], warnings = [], variablePanels = new Map();
  let rebuilds = 0, renders = 0;
  const dependencies = {
    state, inlineDrafts, textReplaceLineages, singleSide: null, variablePanels,
    filtered: side => state[side].prompts.filter(entry => entry.identifier !== 'c'),
    getBaiBaiGroupState: () => ({groups: [{id: 'g1', name: 'Group 1'}], prompts: {a: {groupId: 'g1'}, b: {groupId: 'g1'}}}),
    applyReplacementPlan, clone: structuredClone, equalValues: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    pushUndo: action => undo.push(action), rebuildCache: () => { rebuilds++; }, renderAll: () => { renders++; },
    pcmToastr: {warning: message => warnings.push(message)},
  };
  const api = new Function(...Object.keys(dependencies), 'let variablePanel=null;\n' + contextCode + '\n' + transactionCode + '\nreturn {getTextReplaceContext,applyTextReplacement,undoTextReplacement,getTextReplaceLineage:typeof getTextReplaceLineage === "function" ? getTextReplaceLineage : undefined};')(...Object.values(dependencies));
  return {state, inlineDrafts, textReplaceLineages, undo, warnings, variablePanels, ...api, calls: () => ({rebuilds, renders})};
}
function preview(env, fields = ['content'], query = 'cat', replacement = 'dog') {
  const context = env.getTextReplaceContext('new');
  const plan = createReplacementPlan(context.entries, {query, replacement, fields});
  return {context, plan, keys: plan.matches.map(match => match.key)};
}
function apply(env, options = preview(env)) {
  return env.applyTextReplacement('new', options.plan, options.keys, options.context);
}

test('replacement browser receives the preset label and rendered order including uninjected entries', () => {
  const env = harness();
  env.state.cache = {ordered: {new: [env.state.new.prompts[1], env.state.new.prompts[0], env.state.new.prompts[2]]}};
  const context = env.getTextReplaceContext('new');
  assert.equal(context.presetName, 'new preset');
  assert.deepEqual(context.orderedIds, ['b', 'a', 'c']);
  assert.deepEqual(context.entries.map(entry => entry.identifier), ['a', 'b', 'c']);
  assert.deepEqual(context.groups[0].ids, ['a', 'b']);
});

test('editor undo refuses an old replacement after loading another preset with the same IDs', () => {
  const env = harness();
  apply(env);
  const different = {prompts: [prompt('a', 'independent preset text', 'different title')]};
  env.state.new = different;
  env.state.newName = 'another preset';
  env.state.dirty.new = false;
  env.state.modified.new = new Set(['other']);
  const snapshot = structuredClone(different);
  assert.equal(env.undoTextReplacement(env.undo[0]), false);
  assert.equal(env.state.new, different);
  assert.deepEqual(different, snapshot);
  assert.equal(env.state.dirty.new, false);
  assert.deepEqual([...env.state.modified.new], ['other']);
  assert.ok(env.warnings.length);
});

test('editor previews unsaved name/content and preserves non-text form fields through replace and undo', () => {
  const env = harness(), original = env.state.new.prompts[0];
  const before = structuredClone(original);
  const draft = {...original, name: 'draft cat title', content: 'draft cat\ncat', role: 'assistant', injection_position: 1};
  env.inlineDrafts.set(original, structuredClone(draft));
  const pending = preview(env, ['name', 'content']);
  assert.equal(pending.context.entries[0].name, draft.name);
  assert.equal(pending.context.entries[0].content, draft.content);
  assert.equal(pending.context.entries[0].role, 'system');
  assert.equal(pending.context.entries[0].injection_position, 0);
  assert.deepEqual(pending.context.selectedIds, ['a']);
  assert.deepEqual(pending.context.filteredIds, ['a', 'b']);
  assert.deepEqual(pending.context.groups, [{id: 'g1', name: 'Group 1', ids: ['a', 'b']}]);
  assert.deepEqual(apply(env, pending), {entryCount: 1, matchCount: 3});
  const changed = env.state.new.prompts[0];
  assert.equal(changed.content, 'draft dog\ndog');
  assert.equal(changed.name, 'draft dog title');
  assert.equal(changed.role, 'system');
  assert.equal(changed.injection_position, 0);
  assert.deepEqual(env.inlineDrafts.get(changed), {...draft, name: 'draft dog title', content: 'draft dog\ndog'});
  assert.equal(env.undo.length, 1);
  assert.equal(env.state.dirty.new, true);
  assert.deepEqual([...env.state.modified.new], ['prior', 'a']);
  assert.deepEqual(env.calls(), {rebuilds: 1, renders: 1});
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.deepEqual(env.state.new.prompts[0], before);
  assert.deepEqual(env.inlineDrafts.get(env.state.new.prompts[0]), draft);
  assert.equal(env.state.dirty.new, false);
  assert.deepEqual([...env.state.modified.new], ['prior']);
});

test('editor preserves other side, unmatched object identities, and unrelated unsaved drafts', () => {
  const env = harness(), other = env.state.old, otherPrompt = other.prompts[0], b = env.state.new.prompts[1], c = env.state.new.prompts[2];
  const otherSnapshot = structuredClone(other);
  const bDraft = {...b, content: 'draft not matching', role: 'user'};
  const cDraft = {...c, name: 'unsubmitted name', injection_position: 1};
  env.inlineDrafts.set(b, bDraft);
  env.inlineDrafts.set(c, cDraft);
  apply(env);
  assert.equal(env.state.old, other);
  assert.equal(env.state.old.prompts[0], otherPrompt);
  assert.deepEqual(other, otherSnapshot);
  assert.equal(env.state.new.prompts[1], b);
  assert.equal(env.state.new.prompts[2], c);
  assert.equal(env.inlineDrafts.get(b), bDraft);
  assert.equal(env.inlineDrafts.get(c), cDraft);
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[1], b);
  assert.equal(env.state.new.prompts[2], c);
  assert.equal(env.inlineDrafts.get(b), bDraft);
  assert.equal(env.inlineDrafts.get(c), cDraft);
  assert.deepEqual(other, otherSnapshot);
});

test('editor rejects stale previews after same-instance model or form changes without any partial write', () => {
  for (const change of [
    env => { env.state.new.prompts[0].content += ' changed'; },
    env => { env.inlineDrafts.set(env.state.new.prompts[0], {...env.state.new.prompts[0], content: 'later cat draft'}); },
    env => { env.state.multiSelect.selected.new.add('b'); },
  ]) {
    const env = harness(), pending = preview(env);
    change(env);
    const snapshot = structuredClone(env.state.new), draft = env.inlineDrafts.get(env.state.new.prompts[0]);
    assert.throws(() => apply(env, pending), /变化|重新预览/);
    assert.deepEqual(env.state.new, snapshot);
    assert.equal(env.inlineDrafts.get(env.state.new.prompts[0]), draft);
    assert.equal(env.undo.length, 0);
    assert.deepEqual(env.calls(), {rebuilds: 0, renders: 0});
    assert.equal(env.state.dirty.new, false);
  }
});

test('editor undo refuses to overwrite later unsaved text or non-text changes', () => {
  for (const edits of [{content: 'new post-replace text'}, {role: 'assistant'}]) {
    const env = harness();
    apply(env);
    const changed = env.state.new.prompts[0], later = {...changed, ...edits};
    env.inlineDrafts.set(changed, later);
    const snapshot = structuredClone(env.state.new);
    assert.equal(env.undoTextReplacement(env.undo[0]), false);
    assert.deepEqual(env.state.new, snapshot);
    assert.equal(env.inlineDrafts.get(changed), later);
    assert.equal(env.state.dirty.new, true);
    assert.deepEqual([...env.state.modified.new], ['prior', 'a']);
    assert.ok(env.warnings.length);
  }
});

test('editor content-only replacement leaves an unsaved name in the form and model name unchanged', () => {
  const env = harness(), original = env.state.new.prompts[0];
  const draft = {...original, name: 'pending cat name', content: 'pending cat text', role: 'user'};
  env.inlineDrafts.set(original, draft);
  apply(env);
  const changed = env.state.new.prompts[0];
  assert.equal(changed.name, original.name);
  assert.equal(changed.content, 'pending dog text');
  assert.deepEqual(env.inlineDrafts.get(changed), {...draft, content: 'pending dog text'});
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.deepEqual(env.state.new.prompts[0], original);
  assert.deepEqual(env.inlineDrafts.get(env.state.new.prompts[0]), draft);
});

test('editor rejects conflicting variable draft and treats an empty replacement selection as a no-op', () => {
  const env = harness(), pending = preview(env), snapshot = structuredClone(env.state.new);
  env.variablePanels.set('new', {panel: {hasDraft: () => true}});
  assert.throws(() => apply(env, pending), /变量面板/);
  assert.deepEqual(env.state.new, snapshot);
  assert.equal(env.undo.length, 0);
  env.variablePanels.clear();
  assert.deepEqual(apply(env, {...pending, keys: []}), {matchCount: 0, entryCount: 0});
  assert.deepEqual(env.state.new, snapshot);
  assert.equal(env.undo.length, 0);
  assert.deepEqual(env.calls(), {rebuilds: 0, renders: 0});
});

test('editor undo restores replaced text while preserving later toggle and prompt_order changes', () => {
  const env = harness();
  env.state.new.prompt_order = [{character_id: 100001, order: [{identifier: 'a', enabled: true}, {identifier: 'b', enabled: true}]}];
  const original = structuredClone(env.state.new.prompts[0]);
  apply(env, preview(env, ['name', 'content']));
  // The real enabled toggle writes these fields without adding its own undo action.
  env.state.new.prompts[0].enabled = false;
  env.state.new.prompt_order[0].order[0].enabled = false;
  assert.equal(env.undo.length, 1);
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[0].content, original.content);
  assert.equal(env.state.new.prompts[0].name, original.name);
  assert.equal(env.state.new.prompts[0].enabled, false);
  assert.equal(env.state.new.prompt_order[0].order[0].enabled, false);
  assert.equal(env.state.dirty.new, true);
});

test('editor undo after a confirmed export marks reverted text dirty instead of claiming it is saved', () => {
  const env = harness();
  apply(env);
  env.state.dirty.new = false;
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[0].content, 'cat first');
  assert.equal(env.state.dirty.new, true);
});

test('editor undo refuses a target field changed after replacement even without an inline form', () => {
  const env = harness();
  apply(env);
  env.state.new.prompts[0].content = 'later external edit';
  const snapshot = structuredClone(env.state.new);
  assert.equal(env.undoTextReplacement(env.undo[0]), false);
  assert.deepEqual(env.state.new, snapshot);
  assert.equal(env.state.dirty.new, true);
});

test('editor undo accepts internally inherited lineage after an intervening preset clone and reversal', () => {
  const env = harness();
  apply(env);
  const afterReplace = structuredClone(env.state.new);
  const lineage = env.getTextReplaceLineage(env.state.new);
  // Internal operations may clone a preset. Their adapter explicitly carries the lineage;
  // this unit test covers the replacement undo boundary after that operation is reversed.
  const moved = structuredClone(env.state.new);
  moved.prompts.reverse();
  env.textReplaceLineages.set(moved, lineage);
  env.state.new = moved;
  const moveReversed = structuredClone(afterReplace);
  env.textReplaceLineages.set(moveReversed, lineage);
  env.state.new = moveReversed;
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[0].content, 'cat first');
  assert.equal(env.state.dirty.new, false);
});

test('editor undo rejects a freshly loaded identical preset without explicitly inherited lineage', () => {
  const env = harness();
  apply(env);
  const reloaded = structuredClone(env.state.new), snapshot = structuredClone(reloaded);
  env.state.new = reloaded;
  assert.equal(env.undoTextReplacement(env.undo[0]), false);
  assert.deepEqual(reloaded, snapshot);
});

test('editor undo stays dirty after an intervening export even if later toggles restore the original settings', () => {
  const env = harness();
  apply(env);
  env.getTextReplaceLineage(env.state.new).savedRevision++;
  env.state.dirty.new = false;
  env.state.new.prompts[0].enabled = false;
  env.state.dirty.new = true;
  env.state.new.prompts[0].enabled = true;
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[0].content, 'cat first');
  assert.equal(env.state.dirty.new, true);
});

test('editor content-only undo preserves a later direct name edit and keeps the preset dirty', () => {
  const env = harness();
  apply(env);
  env.state.new.prompts[0].name = 'new independent title';
  assert.equal(env.undoTextReplacement(env.undo[0]), true);
  assert.equal(env.state.new.prompts[0].content, 'cat first');
  assert.equal(env.state.new.prompts[0].name, 'new independent title');
  assert.equal(env.state.dirty.new, true);
});
