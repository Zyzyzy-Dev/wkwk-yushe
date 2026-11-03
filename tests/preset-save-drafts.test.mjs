// 顶部保存真实函数回归：未提交表单先确认，取消/检查零请求，异步编辑和切换均保留草稿。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPendingPromptDraft,buildPresetDraftSnapshot} from '../src/features/preset/entry-drafts.js';

const source = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function applyTavernPreset(');
const end = source.indexOf('async function reloadSideFromTavern(', start);
assert.ok(start >= 0 && end > start, '真实保存和读回函数边界存在');
const saveCode = source.slice(start, end);
const preset = text => ({prompts: [{identifier: 'a', name: 'entry', content: text, role: 'system', injection_position: 0}]});

function harness() {
  const state = {
    old: preset('old side'), new: preset('new text'), oldName: 'old.json', newName: 'new.json',
    tavernSource: {old: 'old', new: 'new'}, dirty: {old: false, new: true},
    modified: {old: new Set(), new: new Set(['a'])}, dragged: {old: new Set(), new: new Set(['a'])},
    showDraftMarkers: {old:false,new:false},
  };
  let resolveRequest, rejectRequest, rebuilds = 0, renders = 0;
  const response = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  const inlineDrafts = new WeakMap(), requests = [], applied = [], notices = [], errors = [], confirmations = [], markerRefreshes = [];
  let controlSyncs=0, prefSaves=0;
  const dependencies = {
    state, inlineDrafts, clone: structuredClone, validate: value => value,isPendingPromptDraft,buildPresetDraftSnapshot,
    host: {request: (type, payload) => { requests.push({type, payload}); return response; }},
    pcmToast: (message, kind) => notices.push({message, kind}),
    console: {error: (...args) => errors.push(args)},
    rebuildCache: () => { rebuilds++; }, renderAll: () => { renders++; }, recordApply: args => applied.push(args),
    shell:()=>({}),choosePresetSave:options=>new Promise(resolve=>confirmations.push({options,resolve})),
    syncDraftControls:()=>{controlSyncs++;},refreshDraftIndicators:side=>markerRefreshes.push(side),saveUiPrefs:async()=>{prefSaves++;},
  };
  const save = new Function(...Object.keys(dependencies), saveCode + '\nconst originalApply=applyTavernPreset; applyTavernPreset=(...args)=>{recordApply(args);return originalApply(...args);};return saveSideToTavern;')(...Object.values(dependencies));
  return {state, inlineDrafts, save, requests, applied, notices, errors, confirmations,markerRefreshes,
    confirm:async choice=>{assert.ok(confirmations.length,'待确认窗口存在');confirmations.at(-1).resolve(choice);await Promise.resolve();},
    resolve: resolveRequest, reject: rejectRequest, calls: () => ({rebuilds, renders}),markerCalls:()=>({controlSyncs,prefSaves})};
}

test('top-level save with a pending inline draft waits for confirmation and cancellation preserves every field', async () => {
  const env = harness(), current = env.state.new, prompt = current.prompts[0];
  const draft = {...prompt, content: 'unsubmitted text', name: 'unsubmitted name', role: 'assistant', injection_position: 1};
  env.inlineDrafts.set(prompt, draft);
  const before = structuredClone(current);
  const pending=env.save('new');
  assert.equal(env.confirmations.length,1,'未提交的编辑必须先确认');
  assert.equal(env.requests.length,0);
  await env.confirm(null);await pending;
  assert.equal(env.requests.length, 0);
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.deepEqual(current, before);
  assert.equal(env.inlineDrafts.get(prompt), draft);
  assert.equal(env.state.dirty.new, true);
  assert.equal(env.notices.length,0);
});

test('top-level save without pending drafts sends an immutable snapshot and applies the actual readback', async () => {
  const env = harness(), original = env.state.new, old = env.state.old;
  const pending = env.save('new');
  assert.equal(env.confirmations.length,0,'已提交到预设的改动直接保存');
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].type, 'save-preset');
  assert.equal(env.requests[0].payload.name, 'new');
  assert.deepEqual(env.requests[0].payload.preset, original);
  assert.notEqual(env.requests[0].payload.preset, original);
  assert.notEqual(env.requests[0].payload.preset.prompts[0], original.prompts[0]);
  const fresh = {...preset('canonical readback'), returnedByHost: true};
  env.resolve(fresh);
  await pending;
  assert.equal(env.applied.length, 1);
  assert.deepEqual(env.applied[0], ['new', 'new', fresh]);
  assert.deepEqual(env.state.new, fresh);
  assert.notEqual(env.state.new, fresh);
  assert.equal(env.state.old, old);
  assert.equal(env.state.newName, 'new.json');
  assert.equal(env.state.dirty.new, false);
  assert.equal(env.state.modified.new.size, 0);
  assert.equal(env.state.dragged.new.size, 0);
  assert.deepEqual(env.calls(), {rebuilds: 1, renders: 1});
  assert.equal(env.notices.at(-1).kind, 'success');
});

test('top-level save preserves direct model edits made while the host request is pending', async () => {
  const env = harness(), current = env.state.new;
  const pending = env.save('new');
  current.prompts[0].content = 'newer local text';
  const latest = structuredClone(current);
  assert.equal(env.requests[0].payload.preset.prompts[0].content, 'new text');
  env.resolve(preset('stale readback'));
  await pending;
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.deepEqual(current, latest);
  assert.equal(env.state.dirty.new, true);
  assert.deepEqual(env.calls(), {rebuilds: 0, renders: 0});
  assert.equal(env.notices.at(-1).kind, 'info');
});

test('top-level save preserves a newly created inline draft while the host request is pending', async () => {
  const env = harness(), current = env.state.new, prompt = current.prompts[0];
  env.state.dirty.new = false;
  const pending = env.save('new');
  const draft = {...prompt, role: 'assistant', injection_position: 1, name: 'later name'};
  env.inlineDrafts.set(prompt, draft);
  env.resolve(preset('stale readback'));
  await pending;
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.equal(env.inlineDrafts.get(prompt), draft);
  assert.equal(current.prompts[0].role, 'system');
  assert.equal(env.state.dirty.new, true);
  assert.deepEqual([...env.state.modified.new], ['a']);
});

test('top-level save never applies an old response to a newly loaded preset with identical IDs', async () => {
  const env = harness();
  const pending = env.save('new');
  const current = preset('newly loaded text');
  env.state.new = current;
  env.state.newName = 'different.json';
  env.state.tavernSource.new = 'different';
  env.state.dirty.new = false;
  env.resolve(preset('stale readback'));
  await pending;
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.equal(env.state.newName, 'different.json');
  assert.equal(env.state.tavernSource.new, 'different');
  assert.equal(env.state.dirty.new, false);
  assert.deepEqual(env.calls(), {rebuilds: 0, renders: 0});
});

test('top-level save also rejects an old response after only the active source binding changes', async () => {
  const env = harness(), current = env.state.new;
  const pending = env.save('new');
  env.state.tavernSource.new = 'another source';
  env.resolve(preset('stale readback'));
  await pending;
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.equal(env.state.tavernSource.new, 'another source');
  assert.equal(env.state.dirty.new, true);
});

test('top-level save host failure leaves the current model and later draft intact', async () => {
  const env = harness(), current = env.state.new, prompt = current.prompts[0];
  const pending = env.save('new');
  const draft = {...prompt, content: 'later unsaved input'};
  env.inlineDrafts.set(prompt, draft);
  env.reject(new Error('write failed'));
  await pending;
  assert.equal(env.applied.length, 0);
  assert.equal(env.state.new, current);
  assert.equal(env.inlineDrafts.get(prompt), draft);
  assert.equal(env.state.dirty.new, true);
  assert.deepEqual([...env.state.modified.new], ['a']);
  assert.equal(env.errors.length, 1);
  assert.equal(env.notices.at(-1).kind, 'error');
  assert.match(env.notices.at(-1).message, /write failed/);
});

test('top-level save rejects a missing readback without clearing the local dirty state', async () => {
  const env = harness(), current = env.state.new;
  const pending = env.save('new');
  env.resolve(null);
  await pending;
  assert.equal(env.state.new, current);
  assert.equal(env.state.dirty.new, true);
  assert.equal(env.notices.at(-1).kind, 'error');
  assert.deepEqual(env.calls(), {rebuilds: 0, renders: 0});
});

test('direct save confirmation includes closed entry drafts on this side without touching the other side or source', async () => {
  const env=harness(), current=env.state.new, other=env.state.old;
  current.prompts.push({identifier:'b',name:'closed',content:'before',injection_trigger:['normal','continue'],custom:{keep:true}});
  const first=current.prompts[0], second=current.prompts[1], draft={content:'{{random::A::B}}'};
  env.inlineDrafts.set(first,draft);env.inlineDrafts.set(second,{name:'closed edited',content:'after',trigger:'normal'});
  const otherDraft={content:'other side untouched'};env.inlineDrafts.set(other.prompts[0],otherDraft);
  const before=structuredClone(current),pending=env.save('new');
  assert.equal(env.confirmations.length,1);assert.equal(env.requests.length,0);await env.confirm('save');
  assert.equal(env.requests.length,1);
  const payload=env.requests[0].payload.preset;
  assert.equal(payload.prompts[0].content,'{{random::A::B}}');
  assert.equal(payload.prompts[1].name,'closed edited');assert.equal(payload.prompts[1].content,'after');
  assert.deepEqual(payload.prompts[1].injection_trigger,['normal','continue']);
  assert.deepEqual(payload.prompts[1].custom,{keep:true});
  assert.deepEqual(current,before);assert.equal(env.inlineDrafts.get(first),draft);
  env.resolve(payload);await pending;
  assert.deepEqual(env.state.new,payload);assert.equal(env.state.dirty.new,false);
  assert.equal(env.state.old,other);assert.equal(env.inlineDrafts.get(other.prompts[0]),otherDraft);
  assert.equal(env.notices.at(-1).kind,'success');
});

test('confirmed direct save failure preserves original model and every pending draft', async () => {
  const env=harness(),current=env.state.new,prompt=current.prompts[0],draft={content:'pending text',role:'assistant'};
  env.inlineDrafts.set(prompt,draft);
  const before=structuredClone(current),pending=env.save('new');
  assert.equal(env.confirmations.length,1);await env.confirm('save');
  assert.equal(env.requests.length,1);env.reject(Error('network unavailable'));await pending;
  assert.equal(env.state.new,current);assert.deepEqual(current,before);assert.equal(env.inlineDrafts.get(prompt),draft);
  assert.equal(env.applied.length,0);assert.equal(env.notices.at(-1).kind,'error');
});

test('confirmed direct save keeps a draft edited again during the request', async () => {
  const env=harness(),current=env.state.new,prompt=current.prompts[0];
  env.inlineDrafts.set(prompt,{content:'first pending'});const pending=env.save('new');
  assert.equal(env.confirmations.length,1);await env.confirm('save');
  assert.equal(env.requests.length,1);
  const newer={content:'second pending'};env.inlineDrafts.set(prompt,newer);
  env.resolve(env.requests[0].payload.preset);await pending;
  assert.equal(env.applied.length,0);assert.equal(env.state.new,current);assert.equal(env.inlineDrafts.get(prompt),newer);
  assert.equal(env.state.dirty.new,true);assert.equal(env.notices.at(-1).kind,'info');
});

test('confirmed direct save keeps a local revert to the original while a pending draft is saving', async () => {
  const env=harness(),current=env.state.new,prompt=current.prompts[0];
  env.inlineDrafts.set(prompt,{content:'first pending'});const pending=env.save('new');
  assert.equal(env.confirmations.length,1);await env.confirm('save');
  assert.equal(env.requests.length,1);env.inlineDrafts.delete(prompt);
  env.resolve(env.requests[0].payload.preset);await pending;
  assert.equal(env.applied.length,0);assert.equal(env.state.new,current);assert.equal(prompt.content,'new text');
});

test('an unchanged remembered form permits saving without a confirmation', async () => {
  const env=harness(),prompt=env.state.new.prompts[0];
  env.inlineDrafts.set(prompt,{name:prompt.name,role:'system',trigger:'',injection_position:'0',injection_depth:'4',injection_order:'100',content:prompt.content});
  const pending=env.save('new');assert.equal(env.requests.length,1);assert.equal(env.confirmations.length,0);
  assert.deepEqual(env.requests[0].payload.preset,env.state.new);
  env.resolve(env.requests[0].payload.preset);await pending;assert.equal(env.notices.at(-1).kind,'success');
});

test('double clicking save sends one request until the first finishes', async () => {
  const env=harness(),first=env.save('new'),second=env.save('new');
  assert.equal(env.requests.length,1);env.resolve(env.requests[0].payload.preset);await Promise.all([first,second]);
  assert.equal(env.applied.length,1);
});

test('two columns bound to the same native preset cannot save it concurrently', async () => {
  const env=harness();env.state.tavernSource.old='new';
  const first=env.save('new'),second=env.save('old');
  assert.equal(env.requests.length,1);env.resolve(env.requests[0].payload.preset);await Promise.all([first,second]);
  assert.equal(env.state.old.prompts[0].content,'old side');
});

test('checking pending entries enables this side triangle markers without saving or toggling existing checks off',async()=>{
  for(const alreadyEnabled of [false,true]){
    const env=harness(),current=env.state.new,prompt=current.prompts[0],draft={content:'not submitted'};
    env.inlineDrafts.set(prompt,draft);env.state.showDraftMarkers.new=alreadyEnabled;
    const pending=env.save('new');assert.equal(env.confirmations.length,1);await env.confirm('check');await pending;
    assert.equal(env.requests.length,0);assert.equal(env.state.new,current);assert.equal(env.inlineDrafts.get(prompt),draft);
    assert.deepEqual(env.state.showDraftMarkers,{old:false,new:true});assert.deepEqual(env.markerRefreshes,['new']);
    assert.deepEqual(env.markerCalls(),{controlSyncs:1,prefSaves:1});assert.deepEqual(env.calls(),{rebuilds:0,renders:0});
  }
});

test('a cancelled confirmation releases side and preset name guards for another save attempt',async()=>{
  const env=harness();env.inlineDrafts.set(env.state.new.prompts[0],{content:'not submitted'});
  const first=env.save('new');assert.equal(env.confirmations.length,1);await env.confirm(null);await first;
  const next=env.save('new');assert.equal(env.confirmations.length,2);await env.confirm('save');
  assert.equal(env.requests.length,1);env.resolve(env.requests[0].payload.preset);await next;
});

test('a second save on the same side or native name cannot open another confirmation',async()=>{
  const env=harness();env.inlineDrafts.set(env.state.new.prompts[0],{content:'not submitted'});env.state.tavernSource.old='new';
  const first=env.save('new'),sameSide=env.save('new'),sameName=env.save('old');
  assert.equal(env.confirmations.length,1);assert.equal(env.requests.length,0);
  await env.confirm('save');assert.equal(env.requests.length,1);env.resolve(env.requests[0].payload.preset);
  await Promise.all([first,sameSide,sameName]);assert.equal(env.applied.length,1);
});

for(const change of ['draft','model','preset','source'])test('confirmation cannot save after '+change+' changes while waiting',async()=>{
  const env=harness(),original=env.state.new,prompt=original.prompts[0];
  env.inlineDrafts.set(prompt,{content:'pending at confirmation'});
  const pending=env.save('new');assert.equal(env.confirmations.length,1);
  if(change==='draft')env.inlineDrafts.set(prompt,{content:'later pending'});
  if(change==='model')prompt.content='newer submitted model';
  if(change==='preset')env.state.new=preset('switched preset');
  if(change==='source')env.state.tavernSource.new='another binding';
  const latest=env.state.new,before=structuredClone(latest),latestDraft=env.inlineDrafts.get(prompt);
  await env.confirm('save');await pending;
  assert.equal(env.requests.length,0);assert.equal(env.applied.length,0);assert.equal(env.state.new,latest);
  assert.deepEqual(latest,before);assert.equal(env.inlineDrafts.get(prompt),latestDraft);assert.equal(env.notices.at(-1).kind,'info');
});

test('local file saves continue to direct users to export without a confirmation or host write',async()=>{
  const env=harness();env.state.tavernSource.new=null;env.inlineDrafts.set(env.state.new.prompts[0],{content:'pending'});
  await env.save('new');assert.equal(env.requests.length,0);assert.equal(env.confirmations.length,0);assert.match(env.notices[0].message,/导出/);
});
