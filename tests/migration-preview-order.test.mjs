// 手动预览排序只调整本次迁入条目，完整保留已验证计划和预设字段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, applyMigration } from '../src/features/preset/migration.js';
import { moveMigrationEntry } from '../src/features/preset/migration-order.js';
const preset=ids=>({prompts:ids.map(identifier=>({identifier,name:identifier,content:'正文 '+identifier,extra:{keep:true}})),prompt_order:[{character_id:100001,order:ids.map(identifier=>({identifier,enabled:identifier!=='x',extra:1}))},{character_id:7,order:[]}],extra:{keep:1}});
const ids=plan=>plan.result.prompt_order[0].order.map(r=>r.identifier);
function fixture(){
 const source=preset(['a','x','b','c','y','d']),target=preset(['a','b','c','d']);
 for(const p of [source,target])p.extensions={baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'甲',enabled:false},{id:'h',name:'乙',enabled:true}],prompts:Object.fromEntries(p.prompts.map(r=>[r.identifier,{groupId:['a','x','b'].includes(r.identifier)?'g':'h',extra:9}]))}}};
 target.prompts.push({identifier:'tail',name:'未注入',content:'保留'});
 return {source,target,plan:planMigration(source,target,['x','y'])};
}
test('允许任意交换迁入顺序，既有目标相对顺序及输入不变',()=>{
 const {source,target,plan}=fixture(),before=JSON.stringify([source,target,plan]);
 const next=moveMigrationEntry(plan,'y',{beforeId:'x',groupId:'g'});
 assert.deepEqual(ids(next),['a','y','x','b','c','d']);assert.equal(JSON.stringify([source,target,plan]),before);
 assert.deepEqual(next.previewOrder.map(r=>r.id),['a','y','x','b','c','d','tail']);assert.equal(next.previewOrder.at(-1).injected,false);
 assert.deepEqual(applyMigration(source,target,next),next.result);
});
test('跨组保留成员开关/未知字段/目标组供电及其他生效顺序表',()=>{
 const {plan}=fixture(),next=moveMigrationEntry(plan,'x',{beforeId:'d',groupId:'h'});
 assert.deepEqual(ids(next),['a','b','c','y','x','d']);
 const before=plan.result,after=next.result;
 assert.deepEqual(after.prompts,before.prompts);assert.deepEqual(after.prompt_order[1],before.prompt_order[1]);
 assert.deepEqual(after.prompt_order[0].order.find(r=>r.identifier==='x'),before.prompt_order[0].order.find(r=>r.identifier==='x'));
 assert.deepEqual(after.extensions.baibaiToolkit.presetPromptGroups.groups,before.extensions.baibaiToolkit.presetPromptGroups.groups);
 assert.deepEqual(after.extensions.baibaiToolkit.presetPromptGroups.prompts.x,{groupId:'h',extra:9});
 assert.equal(next.entries.find(r=>r.id==='x').groupId,'h');assert.equal(next.previewOrder.find(r=>r.id==='x').groupName,'乙');
});
test('移到首末和未分组不产生未注入条目或删除未知成员字段',()=>{
 const {plan}=fixture();let next=moveMigrationEntry(plan,'x',{beforeId:'a',groupId:''});next=moveMigrationEntry(next,'y',{beforeId:null,groupId:''});
 assert.deepEqual(ids(next),['x','a','b','c','d','y']);assert.deepEqual(next.result.extensions.baibaiToolkit.presetPromptGroups.prompts.x,{extra:9});
 assert.equal(next.previewOrder.find(r=>r.id==='y').injected,true);assert.equal(next.previewOrder.at(-1).id,'tail');
});
for(const [label,id,placement] of [
 ['原目标行','a',{beforeId:'b',groupId:'g'}],['不存在的条目','bad',{beforeId:'a',groupId:'g'}],
 ['未注入落点','x',{beforeId:'tail',groupId:''}],['不存在的落点','x',{beforeId:'bad',groupId:''}],
 ['不存在的分组','x',{beforeId:'d',groupId:'bad'}],['拆开其他分组','x',{beforeId:'d',groupId:'g'}]
])test(`拒绝${label}且不修改计划`,()=>{const {plan}=fixture(),before=JSON.stringify(plan);assert.throws(()=>moveMigrationEntry(plan,id,placement));assert.equal(JSON.stringify(plan),before)});
test('原有签名保留，外部变动仍无法应用拖动后的计划',()=>{
 const {source,target,plan}=fixture(),next=moveMigrationEntry(plan,'x',{beforeId:null,groupId:'h'});target.extra.keep=2;
 assert.throws(()=>applyMigration(source,target,next),/变化/);
});
test('无分组元数据的迁入移动不新增无关字段',()=>{
 const source=preset(['a','x','b']),target=preset(['a','b']);const next=moveMigrationEntry(planMigration(source,target,['x']),'x',{beforeId:null,groupId:''});
 assert.deepEqual(ids(next),['a','b','x']);assert.equal(next.result.extensions,undefined);
});
