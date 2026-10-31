// 编辑器组开关兼容柏宝箱持久化格式，独立门控不修改成员自身开关。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPresetGroupEnabled } from '../src/features/preset/group-toggle.js';
import { installGroupGate } from '../src/features/preset/native-groups.js';

const fixture=()=>({prompts:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}]}],extensions:{other:{keep:1},baibaiToolkit:{presetPromptGroups:{unknown:7,groups:[{id:'g',name:'组',enabled:true,extra:9},{id:'h',enabled:false}],prompts:{a:{groupId:'g',extra:'x'},b:{groupId:'g'}}}}}});
test('只改变组enabled，保留成员对象、顺序和未知字段，输入不变',()=>{
 const p=fixture(),before=structuredClone(p),off=setPresetGroupEnabled(p,'g',false);
 assert.deepEqual(p,before);assert.equal(off.prompts,p.prompts);assert.equal(off.prompt_order,p.prompt_order);
 const expected=structuredClone(p);expected.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled=false;
 assert.deepEqual(off,expected);assert.deepEqual(setPresetGroupEnabled(off,'g',true),before);
});
test('保存再读取的组开关阻断供电但不改变成员开关，再开启恢复',()=>{
 const p=fixture(),order=p.prompt_order[0].order;let saved=JSON.parse(JSON.stringify(setPresetGroupEnabled(p,'g',false)));
 const manager={activeCharacter:{},getPromptOrderForCharacter:()=>order,isPromptDisabledForActiveCharacter:id=>!order.find(x=>x.identifier===id).enabled,getPromptCollection(){const out={collection:[],add(...items){this.collection.push(...items)}};order.filter(x=>x.enabled).forEach(x=>out.add({identifier:x.identifier}));return out;}};
 assert.equal(installGroupGate(manager,()=>saved.extensions.baibaiToolkit.presetPromptGroups,()=>true),true);
 assert.deepEqual(manager.getPromptCollection().collection,[]);assert.deepEqual(order.map(x=>x.enabled),[true,false]);
 saved=JSON.parse(JSON.stringify(setPresetGroupEnabled(saved,'g',true)));
 assert.deepEqual(manager.getPromptCollection().collection.map(x=>x.identifier),['a']);assert.deepEqual(order.map(x=>x.enabled),[true,false]);
});
test('缺失或重复分组标识不猜配、不创建新组',()=>{
 const p=fixture();assert.throws(()=>setPresetGroupEnabled(p,'missing',false),/分组/);
 p.extensions.baibaiToolkit.presetPromptGroups.groups.push({id:'g'});assert.throws(()=>setPresetGroupEnabled(p,'g',false),/分组/);
});
