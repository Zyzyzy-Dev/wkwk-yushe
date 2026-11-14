// 运行真实应用撤回函数，防止临时库历史跨预设覆盖及保存期间并发修改。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ui/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function undoLast(){'),source.indexOf('\n\nfunction el(',source.indexOf('function undoLast(){')));
test('stale library undo does not write into a replacement preset',()=>{
 const previous={prompts:[{identifier:'a',content:'old'}]},current={prompts:[{identifier:'new',content:'new'}],prompt_order:[],extensions:{keep:true}};
 const snapshot=JSON.stringify(current),state={old:current,history:[{type:'move',tempLibrary:true,side:'old',preset:previous,promptOrder:['a'],prompts:new Map([['a',previous.prompts[0]]]),promptOrderData:[],extensionsBefore:{old:true},draggedBefore:[]}],dragged:{old:new Set()},dirty:{old:false}};
 const context={state,clone:structuredClone,updateUndoButton(){},pcmToastr:{warning(){}},hideCompare(){},rebuildCache(){},renderAll(){},isSideSavePending(){return false},getTextReplaceLineage(){return {savedRevision:0}}};vm.runInNewContext(fn+';undoLast();',context);
 assert.equal(JSON.stringify(current),snapshot);assert.equal(state.dirty.old,false);
});
test('library undo waits while its preset is saving and keeps the history entry',()=>{
 const current={prompts:[],prompt_order:[]},action={type:'move',tempLibrary:true,side:'old',preset:current},state={old:current,history:[action]};
 vm.runInNewContext(fn+';undoLast();',{state,isSideSavePending(){return true},pcmToastr:{warning(){}}});
 assert.equal(state.history.length,1);assert.equal(state.history[0],action);assert.deepEqual(current,{prompts:[],prompt_order:[]});
});
