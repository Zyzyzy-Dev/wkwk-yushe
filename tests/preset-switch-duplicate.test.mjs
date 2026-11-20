// 编辑器真实入口回归：换预设按栏隔离撤回，复制继承当前注入顺序的状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clone, findPromptOrderEntry, validatePreset} from '../src/features/preset/core.js';

const source = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  const lines = source.slice(start).split(/\r?\n/);
  if (lines[0].endsWith('}')) return lines[0];
  return lines.slice(0, lines.findIndex(line => line === '}') + 1).join('\n');
}
const fixture = () => ({
  extensions: {custom:'keep'},
  prompts: [{identifier:'entry', name:'标题', content:'正文', enabled:true, custom:{value:1}}, {identifier:'tail'}],
  prompt_order: [{character_id:100001, order:[{identifier:'entry', enabled:false}, 'tail']}, {character_id:7, order:['tail']}],
});
function harness() {
  const state = {old:fixture(), new:fixture(), dirty:{}, tavernSource:{}, history:[], modified:{old:new Set(),new:new Set()}, dragged:{old:new Set(),new:new Set()}};
  const button = {}, notices = [], picked = new Map([['B',fixture()]]);
  const functions = ['pushUndo','updateUndoButton','undoLast','onTavernPickerClick','chooseTavernPreset','loadFile','moveSnapshot','duplicatePrompt','promptEnabled','replaceImportedPreset','discardSideUndo'];
  const deps = {state, clone, validate:validatePreset, promptOrderEntry:findPromptOrderEntry, listOrderIndex:{},
    byId:side=>new Map(state[side].prompts.map(p=>[p.identifier,p])), createIdentifier:()=>'copy',
    getBaiBaiGroupState:()=>null, tavernPresetPickerData:picked,
    document:{querySelector:()=>null, querySelectorAll:()=>[button]}, pcmToastr:{success(){}, error:e=>notices.push(e)},
    rebuildCache(){}, renderAll(){}, resetImportedGroups(){}, hideCompare(){}};
  const code = functions.map(functionSource).join('\n') + `
    let tavernPresetPickerSide='old';
    function snapshotGroupChange(side){pushUndo(moveSnapshot(side));}
    return {duplicatePrompt, undoLast, loadFile, choose(side) {
      const event = data => ({target:{closest:()=>({dataset:data})},stopImmediatePropagation(){this.stopped=true;}});
      onTavernPickerClick(event({action:'pull-tavern',side}));
      const click=event({action:'choose-tavern',presetName:'B'});
      onTavernPickerClick(click); if(!click.stopped)chooseTavernPreset('B');
    }};
  `;
  return {state, button, notices, ...new Function(...Object.keys(deps),code)(...Object.values(deps))};
}
for (const side of ['old','new']) for (const route of ['file','tavern']) {
  test(`${side} ${route} import drops only that pane's actions, including actions buried under later edits`, async () => {
    const e=harness(), other=side==='old'?'new':'old', otherBefore=clone(e.state[other]);
    e.duplicatePrompt(side,'entry');e.duplicatePrompt(other,'entry');
    e.state.history.push({type:'edit',side,id:'entry',before:{identifier:'entry',content:'stale'},modifiedBefore:[]});
    if(route==='tavern')e.choose(side);
    else await e.loadFile(side,{name:'A.json', text:async()=>JSON.stringify(fixture())});
    assert.deepEqual(e.state.history.map(h=>h.side),[other]);
    const loaded=clone(e.state[side]);assert.equal(e.button.disabled,false);
    e.undoLast();assert.deepEqual(e.state[side],loaded);assert.deepEqual(e.state[other],otherBefore);
    assert.equal(e.button.disabled,true);
  });
}
test('invalid file selection preserves history for the current preset',async()=>{
  const e=harness();e.duplicatePrompt('old','entry');const before=e.state.old;
  await e.loadFile('old',{name:'bad.json',text:async()=>'{}'});
  assert.equal(e.state.old,before);assert.equal(e.state.history.length,1);assert.equal(e.notices.length,1);
});
for(const [label,body,order,enabled] of [
  ['order off',true,[{identifier:'entry',enabled:false},'tail'],false],
  ['order on',false,[{identifier:'entry',enabled:true},'tail'],true],
  ['string order',false,['entry','tail'],false],
  ['implicit enabled',undefined,['entry','tail'],true],
  ['un-injected',false,['tail'],false],
  ['empty order',false,[],false],
  ['absent order',false,null,false],
]) test('duplicate inherits '+label+' without changing other injection memberships',()=>{
  const e=harness(),preset=e.state.old,original=preset.prompts[0];
  original.enabled=body;
  if(order===null)delete preset.prompt_order;
  else preset.prompt_order[0].order=clone(order);
  const before=clone(preset),alt=clone(preset.prompt_order?.[1]);
  e.duplicatePrompt('old','entry');const copy=preset.prompts[1];
  assert.equal(copy.enabled,enabled);assert.deepEqual(copy.custom,original.custom);assert.notEqual(copy.custom,original.custom);
  assert.deepEqual(preset.prompt_order?.[1],alt);assert.equal(original.enabled,body);
  const active=findPromptOrderEntry(preset)?.order||[], explicit=order?.some(item=>(item.identifier||item)==='entry');
  if(explicit){assert.equal(active[1].identifier,'copy');assert.equal(active[1].enabled,enabled);}
  else assert.deepEqual(active,order||[]);
  assert.equal(e.state.history.length,1);e.undoLast();assert.deepEqual(e.state.old.prompts,before.prompts);
});
