// 导出与撤回交错回归：运行 app 的真实导出和替换事务函数，明确保存结果不能清除较新的修改状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReplacementPlan, applyReplacementPlan} from '../src/features/preset/text-replace.js';

const source = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, '实际函数边界存在：' + startMarker);
  return source.slice(start, end);
}
const contextCode = sliceBetween('function getTextReplaceContext(', 'function closeTextReplace(');
const transactionCode = sliceBetween('function applyTextReplacement(', 'function openTextReplace(');
const exportCode = sliceBetween('async function exportPreset(', 'function rowById(');
const preset = text => ({prompts: [{identifier: 'a', name: 'entry', content: text, enabled: true}]});

function harness() {
  const state = {
    old: preset('other side'), new: preset('cat before'), oldName: 'old.json', newName: 'new.json',
    tavernSource: {old: 'old', new: 'new'}, dirty: {old: false, new: false}, modified: {old: new Set(), new: new Set()},
    multiSelect: {selected: {old: new Set(), new: new Set()}}, freeSelect: {enabled: false}, activeId: 'a',
  };
  let resolveRequest, rejectRequest;
  const response = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  const inlineDrafts = new WeakMap(), textReplaceLineages = new WeakMap(), exportingPresets = new Set();
  const undo = [], requests = [], notices = [], summaries = [], button = {disabled: false};
  const dependencies = {
    state, inlineDrafts, textReplaceLineages, exportingPresets, singleSide: null, variablePanels: new Map(),
    filtered: side => state[side].prompts, getBaiBaiGroupState: () => null,
    clone: structuredClone, equalValues: (a, b) => JSON.stringify(a) === JSON.stringify(b), applyReplacementPlan,
    pushUndo: action => undo.push(action), rebuildCache: () => {}, renderAll: () => {},
    pcmToastr: {warning: message => notices.push({message, kind: 'warning'})},
    pcmToast: (message, kind) => notices.push({message, kind}), console: {error: () => {}},
    host: {request: (type, payload) => { requests.push({type, payload}); return response; }},
    document: {querySelector: () => button}, updateSummary: side => summaries.push({side, dirty: state.dirty[side]}),
  };
  const api = new Function(...Object.keys(dependencies), 'let variablePanel=null;\n' + contextCode + '\n' + transactionCode + '\n' + exportCode + '\nreturn {getTextReplaceContext,applyTextReplacement,undoTextReplacement,getTextReplaceLineage,exportPreset};')(...Object.values(dependencies));
  return {state, inlineDrafts, textReplaceLineages, exportingPresets, undo, requests, notices, summaries, button, resolve: resolveRequest, reject: rejectRequest, ...api};
}
function replaceText(env) {
  const context = env.getTextReplaceContext('new');
  const plan = createReplacementPlan(context.entries, {query: 'cat', replacement: 'dog'});
  env.applyTextReplacement('new', plan, plan.matches.map(match => match.key), context);
  return env.undo.at(-1);
}

test('confirmed export after an actual replacement undo marks the reverted editor text dirty', async () => {
  const env = harness(), action = replaceText(env), lineage = env.getTextReplaceLineage(env.state.new);
  const pending = env.exportPreset('new');
  assert.equal(env.requests[0].payload.preset.prompts[0].content, 'dog before');
  assert.equal(env.undoTextReplacement(action), true);
  assert.equal(env.state.new.prompts[0].content, 'cat before');
  assert.equal(env.state.dirty.new, false);
  env.resolve({status: 'saved'});
  await pending;
  assert.equal(env.state.new.prompts[0].content, 'cat before');
  assert.equal(env.state.dirty.new, true);
  assert.equal(lineage.savedRevision, 1);
  assert.equal(env.button.disabled, false);
  assert.equal(env.exportingPresets.size, 0);
});

test('confirmed export with unchanged editor content clears dirty and advances the save revision', async () => {
  const env = harness();
  replaceText(env);
  const current = env.state.new, lineage = env.getTextReplaceLineage(current), pending = env.exportPreset('new');
  assert.equal(env.button.disabled, true);
  assert.equal(env.requests[0].type, 'export-preset');
  assert.equal(env.requests[0].payload.name, 'new-已编辑.json');
  assert.notEqual(env.requests[0].payload.preset, current);
  env.resolve({status: 'saved'});
  await pending;
  assert.equal(env.state.new, current);
  assert.equal(env.state.dirty.new, false);
  assert.equal(lineage.savedRevision, 1);
  assert.equal(env.summaries.at(-1).dirty, false);
  assert.equal(env.button.disabled, false);
});

test('confirmed export preserves dirty state after an internal preset clone changes text in the same lineage', async () => {
  const env = harness();
  replaceText(env);
  const lineage = env.getTextReplaceLineage(env.state.new), pending = env.exportPreset('new');
  const cloned = structuredClone(env.state.new);
  cloned.prompts[0].content = 'internal newer text';
  env.textReplaceLineages.set(cloned, lineage);
  env.state.new = cloned;
  env.state.dirty.new = false;
  env.resolve({status: 'saved'});
  await pending;
  assert.equal(env.state.new, cloned);
  assert.equal(cloned.prompts[0].content, 'internal newer text');
  assert.equal(env.state.dirty.new, true);
  assert.equal(lineage.savedRevision, 1);
});

test('an old confirmed export never changes the dirty flag of a different newly loaded preset', async () => {
  const env = harness();
  replaceText(env);
  const pending = env.exportPreset('new');
  const loaded = preset('newly loaded independent text');
  env.state.new = loaded;
  env.state.newName = 'different.json';
  env.state.dirty.new = false;
  const loadedLineage = env.getTextReplaceLineage(loaded);
  env.resolve({status: 'saved'});
  await pending;
  assert.equal(env.state.new, loaded);
  assert.equal(env.state.newName, 'different.json');
  assert.equal(env.state.dirty.new, false);
  assert.equal(loadedLineage.savedRevision, 0);
});

for (const status of ['cancelled', 'started', 'invalid']) {
  test('export status ' + status + ' does not clear pending edits or advance confirmed-save revision', async () => {
    const env = harness();
    replaceText(env);
    const current = env.state.new, lineage = env.getTextReplaceLineage(current), pending = env.exportPreset('new');
    env.resolve({status});
    await pending;
    assert.equal(env.state.new, current);
    assert.equal(env.state.dirty.new, true);
    assert.equal(lineage.savedRevision, 0);
    assert.equal(env.button.disabled, false);
    assert.equal(env.exportingPresets.size, 0);
    assert.equal(env.summaries.length, 0);
  });
}

test('export host failure preserves pending text and allows a later retry', async () => {
  const env = harness();
  replaceText(env);
  const current = env.state.new, lineage = env.getTextReplaceLineage(current), pending = env.exportPreset('new');
  env.reject(new Error('export failed'));
  await pending;
  assert.equal(env.state.new, current);
  assert.equal(env.state.dirty.new, true);
  assert.equal(lineage.savedRevision, 0);
  assert.equal(env.button.disabled, false);
  assert.equal(env.exportingPresets.size, 0);
  assert.equal(env.notices.at(-1).kind, 'error');
});

test('export suppresses a duplicate request while the first request is pending', async () => {
  const env = harness();
  replaceText(env);
  const pending = env.exportPreset('new');
  await env.exportPreset('new');
  assert.equal(env.requests.length, 1);
  env.resolve({status: 'started'});
  await pending;
  assert.equal(env.state.dirty.new, true);
  assert.equal(env.exportingPresets.size, 0);
});
