// 调用真实编辑器拖入函数，验证副本落点/分组、实际开关、草稿引用和整批撤回。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clone,createIdentifier,findPromptOrderEntry} from '../src/features/preset/core.js';
import * as dropHelpers from '../src/features/preset/prompt-drop-copy.js';

const source=readFileSync(new URL('../src/ui/app.js',import.meta.url),'utf8');
function range(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const line=start=>range(start,'\n');
const code=[range('function moveSnapshot(','function setFreeSelect('),range('function movePrompt(','let outerScrollTouch='),range('function assignPromptToGroup(','function togglePromptGroup('),range('function getBaiBaiGroupState(','function prepareGroupDrag('),range('function applyDropGroup(','function onDragOver('),line('function promptEnabled('),line('function orderArray('),line('function syncOrderEnabled('),line('function rebuildCache('),line('function undoLast(')].join('\n');
const makePreset=(content,enabled)=>({
  prompts:[{identifier:'same',name:'角色要求',content,enabled:!enabled,unknown:{keep:true}},{identifier:'tail',name:'末尾',content:'tail'}],
  prompt_order:[{character_id:100001,order:[{identifier:'same',enabled},{identifier:'tail',enabled:true}]}],
  extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'原组'},{id:'h',name:'目标组'}],prompts:{same:{groupId:'g'},tail:{groupId:'h'}}}}}
});
function harness({overwrite=false,counterpart='same'}={}){
  const state={old:makePreset('source',false),new:makePreset('target',true),cache:{maps:{},ordered:{}},dirty:{old:false,new:false},dragged:{old:new Set(),new:new Set()},history:[]};
  const preferences={overwriteSameIdOnDrop:overwrite},notices=[];
  const deps={state,editorPreferences:preferences,clone,createIdentifier,...dropHelpers,promptOrderEntry:findPromptOrderEntry,listOrderIndex:{},rebuildComparisonCache(){},byId:side=>state.cache.maps[side],counterpartId:(side,id)=>typeof counterpart==='function'?counterpart(side,id,state):counterpart,pushUndo:action=>state.history.push(action),renderList(){},renderAll(){},hideCompare(){},updateUndoButton(){},pcmToastr:{success(text){notices.push({level:'success',text});},warning(text){notices.push({level:'warning',text});}},snapshotGroupChange:side=>state.history.push(api.moveSnapshot(side))};
  const api=new Function(...Object.keys(deps),code+'\nrebuildCache();return {movePrompt,movePrompts,assignPromptToGroup,assignPromptsToGroup,rebuildCache,placeDroppedPrompts:typeof placeDroppedPrompts==="function"?placeDroppedPrompts:null,moveSnapshot,undoLast};')(...Object.values(deps));
  return {state,preferences,notices,...api};
}

function renameId(h,side,from,to){
  const p=h.state[side];p.prompts.find(p=>p.identifier===from).identifier=to;
  for(const order of p.prompt_order)for(const item of order.order)if(item.identifier===from)item.identifier=to;
  const meta=p.extensions.baibaiToolkit.presetPromptGroups.prompts;meta[to]=meta[from];delete meta[from];h.rebuildCache();
}

test('unique exact-name row overwrite keeps target ID and undo restores target draft object',()=>{
  const h=harness({overwrite:true,counterpart:null});renameId(h,'old','same','source-id');
  const original=h.state.new.prompts[0],sourcePrompt=h.state.old.prompts[0],before=structuredClone(h.state.new),drafts=new WeakMap([[original,{content:'target draft'}],[sourcePrompt,{content:'source draft'}]]);
  const mapping=h.placeDroppedPrompts('old','new',['source-id'],'tail','h');
  assert.equal(mapping.get('source-id'),'same');assert.equal(h.state.new.prompts.length,2);
  assert.equal(h.state.new.prompts[0].content,'source');assert.equal(h.state.new.prompts[0].enabled,false);
  assert.equal(h.state.new.extensions.baibaiToolkit.presetPromptGroups.prompts.same.groupId,'h');
  assert.equal(h.state.old.prompts[0],sourcePrompt);assert.equal(sourcePrompt.identifier,'source-id');assert.equal(drafts.get(sourcePrompt).content,'source draft');
  h.undoLast();assert.deepEqual(h.state.new,before);assert.equal(h.state.new.prompts[0],original);assert.equal(drafts.get(original).content,'target draft');
});

test('disabled same-name drag with different ID creates consecutively numbered independent copies',()=>{
  const h=harness();renameId(h,'old','same','source-id');const original=h.state.new.prompts[0];
  const first=h.movePrompt('old','new','source-id','tail'),second=h.movePrompt('old','new','source-id','tail');
  assert.notEqual(first,'source-id');assert.notEqual(first,'same');assert.notEqual(second,first);
  assert.equal(h.state.new.prompts.find(p=>p.identifier===first).name,'角色要求（1）');
  assert.equal(h.state.new.prompts.find(p=>p.identifier===second).name,'角色要求（2）');
  assert.equal(h.state.new.prompts.find(p=>p.identifier==='same'),original);
});

test('group-title drop overwrites body and switch using the same unique-name target ID',()=>{
  const h=harness({overwrite:true,counterpart:null});renameId(h,'old','same','source-id');
  const original=h.state.new.prompts[0];h.assignPromptToGroup('old','new','source-id','h');
  assert.equal(h.state.new.prompts.length,2);const changed=h.state.new.prompts.find(p=>p.identifier==='same');
  assert.equal(changed.content,'source');assert.equal(changed.enabled,false);
  assert.equal(h.state.new.extensions.baibaiToolkit.presetPromptGroups.prompts.same.groupId,'h');
  h.undoLast();assert.equal(h.state.new.prompts[0],original);assert.equal(h.state.new.extensions.baibaiToolkit.presetPromptGroups.prompts.same.groupId,'g');
});

test('same-ID group-title drop also replaces the body instead of only its switch',()=>{
  const h=harness({overwrite:true});h.assignPromptToGroup('old','new','same','h');
  assert.equal(h.state.new.prompts.find(p=>p.identifier==='same').content,'source');
});

test('duplicate names preserve original targets and explain the numbered copy',()=>{
  const h=harness({overwrite:true,counterpart:null});renameId(h,'old','same','source-id');
  h.state.new.prompts[1].name='角色要求';h.rebuildCache();const original=h.state.new.prompts.slice();
  const id=h.movePrompt('old','new','source-id',null);
  assert.equal(h.state.new.prompts.find(p=>p.identifier===id).name,'角色要求（1）');
  for(const p of original)assert.equal(h.state.new.prompts.find(x=>x.identifier===p.identifier),p);
  assert.equal(h.notices.filter(n=>n.level==='warning').length,1);assert.match(h.notices.at(-1).text,/副本/);
});

test('ID and name pointing at different targets must preserve both and make a numbered copy',()=>{
  const h=harness({overwrite:true,counterpart:'tail'});h.state.new.prompts[0].name='另一个用途';h.state.new.prompts[1].name='角色要求';h.rebuildCache();
  const original=h.state.new.prompts.slice(),id=h.movePrompt('old','new','same',null);
  assert(!['same','tail'].includes(id));assert.equal(h.state.new.prompts.find(p=>p.identifier===id).name,'角色要求（1）');
  for(const p of original)assert.equal(h.state.new.prompts.find(x=>x.identifier===p.identifier),p);
  assert.equal(h.notices.at(-1).level,'warning');
});

test('multi-select row and group-title drops use pre-move matching and a single undo',()=>{
  for(const group of [false,true]){
    const h=harness({overwrite:true,counterpart:(_side,id,state)=>state.new.prompts.find(p=>p.identifier==='same').content==='target'?id:null});
    const originals=h.state.new.prompts.slice();
    if(group)h.assignPromptsToGroup('old','new',['same','tail'],'h');else h.placeDroppedPrompts('old','new',['same','tail'],null,'h');
    assert.equal(h.state.new.prompts.length,2,'later candidates must not be re-evaluated after the first overwrite');
    assert.equal(h.state.history.length,1);assert.equal(h.notices.filter(n=>n.level==='warning').length,0);
    assert.equal(h.state.new.prompts.find(p=>p.identifier==='same').content,'source');
    h.undoLast();assert.equal(h.state.new.prompts[0],originals[0]);assert.equal(h.state.new.prompts[1],originals[1]);
  }
});
test('same-id drag off inserts a copy at the requested position and keeps original object drafts',()=>{
  const h=harness(),original=h.state.new.prompts[0],sourcePrompt=h.state.old.prompts[0],drafts=new WeakMap([[original,{content:'pending target'}],[sourcePrompt,{content:'pending source'}]]);
  const id=h.movePrompt('old','new','same','tail');
  assert.notEqual(id,'same');assert.equal(h.state.new.prompts.find(p=>p.identifier==='same'),original);
  assert.deepEqual(h.state.new.prompt_order[0].order.map(p=>p.identifier),['same',id,'tail']);
  assert.equal(h.state.new.prompts.find(p=>p.identifier===id).name,'角色要求（1）');
  assert.equal(h.state.new.prompts.find(p=>p.identifier===id).enabled,false);assert.equal(h.state.new.prompt_order[0].order.find(p=>p.identifier===id).enabled,false);
  assert.equal(drafts.get(original).content,'pending target');assert.equal(drafts.get(sourcePrompt).content,'pending source');
  h.undoLast();assert.equal(h.state.new.prompts.length,2);assert.equal(h.state.new.prompts[0],original);assert.equal(drafts.get(original).content,'pending target');
});
test('default enabled drag retains safe overwrite and same-side reorder never duplicates',()=>{
  const h=harness({overwrite:true});assert.equal(h.movePrompt('old','new','same','tail'),'same');
  assert.equal(h.state.new.prompts.length,2);assert.equal(h.state.new.prompts[0].content,'source');
  h.preferences.overwriteSameIdOnDrop=false;const original=h.state.new.prompts[0];h.movePrompt('new','new','same',null);
  assert.equal(h.state.new.prompts.length,2);assert.equal(h.state.new.prompts.at(-1),original);assert.equal(original.name,'角色要求');
});
test('group assignment creates the numbered copy and leaves existing member in its group',()=>{
  const h=harness(),original=h.state.new.prompts[0];h.assignPromptToGroup('old','new','same','h');
  const copy=h.state.new.prompts.find(p=>!['same','tail'].includes(p.identifier)),meta=h.state.new.extensions.baibaiToolkit.presetPromptGroups;
  assert(copy);assert.equal(copy.name,'角色要求（1）');assert.equal(meta.prompts[copy.identifier].groupId,'h');assert.equal(meta.prompts.same.groupId,'g');
  assert.equal(h.state.new.prompts.find(p=>p.identifier==='same'),original);
});
test('row drop places only the new target IDs in the destination group and batch undo restores originals',()=>{
  const h=harness(),original=h.state.new.prompts[0];assert(h.placeDroppedPrompts,'shared row-drop commit must exist');
  const mapping=h.placeDroppedPrompts('old','new',['same','tail'],null,'h');
  assert.equal(mapping.size,2);assert.notEqual(mapping.get('same'),'same');assert.notEqual(mapping.get('tail'),'tail');
  const meta=h.state.new.extensions.baibaiToolkit.presetPromptGroups;
  assert.equal(meta.prompts.same.groupId,'g');assert.equal(meta.prompts[mapping.get('same')].groupId,'h');
  assert.equal(h.state.history.length,1);h.undoLast();assert.equal(h.state.new.prompts.length,2);assert.equal(h.state.new.prompts[0],original);assert.equal(h.state.new.extensions.baibaiToolkit.presetPromptGroups.prompts.same.groupId,'g');
});
test('enabled mode keeps ambiguous same-ID pairing safe and disabled mode does not overwrite another counterpart',()=>{
  const h=harness({overwrite:true,counterpart:null});const id=h.movePrompt('old','new','same',null);assert.notEqual(id,'same');assert.equal(h.state.new.prompts.find(p=>p.identifier==='same').content,'target');
  const off=harness({counterpart:'tail'}),tail=off.state.new.prompts[1],copyId=off.movePrompt('old','new','same',null);assert(!['same','tail'].includes(copyId));assert.equal(off.state.new.prompts.find(p=>p.identifier==='tail'),tail);
});
test('cross-side same-ID drop keeps the target boundary instead of using the source next row',()=>{
  const code=range('function processDragAt(','function onTouchEnd('),list={dataset:{list:'new'}},targetRow={dataset:{dragId:'same',dragSide:'new'}},sourceRow={dataset:{dragId:'same',dragSide:'old'}};
  const hit={closest:selector=>selector==='.pcm-list'?list:selector==='.pcm-row'?targetRow:null};let excluded;
  const deps={document:{elementFromPoint:()=>hit},dragIdsFor:()=>null,clearDropMarker(){},markDropTarget:(row,event,ids)=>{excluded=ids;return 'same';},nextOrderedRowId:()=> 'source-next',groupIdForRow:()=>null};
  const run=new Function(...Object.keys(deps),code+';return processDragAt;')(...Object.values(deps));
  const drag={holding:true,mx:100,my:100,x:0,y:0,row:sourceRow};run(drag);
  assert.equal(drag.beforeId,'same');assert.equal(drag.targetSide,'new');assert.equal(excluded,null);
});
