// 分组删除的数据完整性：全部顺序表、未启用成员、扩展保留及草稿对象身份。
import test from 'node:test';
import assert from 'node:assert/strict';
import {removePresetGroup} from '../src/features/preset/group-delete.js';

function fixture(){return {
  prompts:[{identifier:'a',content:'A'},{identifier:'b',enabled:false},{identifier:'c'},{identifier:'d'}],
  prompt_order:[{character_id:1,order:[{identifier:'a',enabled:true},{identifier:'c'},'b','a']},{character_id:2,order:['orphan','c','b']},{character_id:3,custom:true}],
  extensions:{helper:{script:'preserve'},baibaiToolkit:{custom:true,presetPromptGroups:{groups:[{id:'g',name:'目标'},{id:'h',name:'其他'}],prompts:{a:{groupId:'g'},b:{groupId:'g'},d:{groupId:'g'},orphan:{groupId:'g'},c:{groupId:'h',extra:42}},version:1}}},extra:42
};}
test('仅解除分组保留全部正文、顺序及对象身份，且不修改输入',()=>{
  const input=fixture(),before=structuredClone(input),result=removePresetGroup(input,'g');
  assert.deepEqual(input,before);assert.equal(result.preset.prompts,input.prompts);assert.equal(result.preset.prompt_order,input.prompt_order);assert.deepEqual(result.removedIds,[]);
  assert.deepEqual(result.preset.extensions.baibaiToolkit.presetPromptGroups.groups,[{id:'h',name:'其他'}]);
  assert.deepEqual(result.preset.extensions.baibaiToolkit.presetPromptGroups.prompts,{c:{groupId:'h',extra:42}});
  assert.deepEqual(result.preset.extensions.helper,input.extensions.helper);
});
test('完整删除包含禁用、未注入成员及所有顺序表引用，不影响其他条目',()=>{
  const input=fixture(),before=structuredClone(input),result=removePresetGroup(input,'g',{deleteEntries:true});
  assert.deepEqual(input,before);assert.deepEqual(result.removedIds,['a','b','d']);
  assert.deepEqual(result.preset.prompts,[input.prompts[2]]);assert.equal(result.preset.prompts[0],input.prompts[2]);
  assert.deepEqual(result.preset.prompt_order,[{character_id:1,order:[{identifier:'c'}]},{character_id:2,order:['c']},{character_id:3,custom:true}]);
  assert.deepEqual(result.preset.extensions.helper,input.extensions.helper);assert.equal(result.preset.extra,42);
  assert.deepEqual(result.preset.extensions.baibaiToolkit.presetPromptGroups.prompts,{c:{groupId:'h',extra:42}});
});
test('空分组和无归属映射可删除，不移除任何条目',()=>{
  const input=fixture();input.extensions.baibaiToolkit.presetPromptGroups={groups:[{id:12,name:'空组'}]};
  const result=removePresetGroup(input,'12',{deleteEntries:true});
  assert.deepEqual(result.removedIds,[]);assert.deepEqual(result.preset.prompts,input.prompts);assert.deepEqual(result.preset.prompt_order,input.prompt_order);
  assert.deepEqual(result.preset.extensions.baibaiToolkit.presetPromptGroups.groups,[]);
});
test('不存在的分组拒绝操作，不修改预设',()=>{
  const input=fixture(),before=structuredClone(input);assert.throws(()=>removePresetGroup(input,'missing',{deleteEntries:true}),/分组已变化/);assert.deepEqual(input,before);
});
test('数字分组 ID 按同一分组处理，没有顺序表也可操作',()=>{
  const input=fixture();delete input.prompt_order;
  input.extensions.baibaiToolkit.presetPromptGroups={groups:[{id:12}],prompts:{a:{groupId:12}}};
  const result=removePresetGroup(input,'12',{deleteEntries:true});assert.deepEqual(result.removedIds,['a']);assert.equal('prompt_order' in result.preset,false);
});
