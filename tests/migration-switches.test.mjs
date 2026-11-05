// 一键迁移：跨组边界、独立开关、手动覆盖，以及草稿不可变性。
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMigration,planMigration,applyMigration} from '../src/features/preset/migration.js';
import {moveMigrationEntry} from '../src/features/preset/migration-order.js';
import {analyzeSwitchSync,previewSwitches,finalizeMigrationSwitches} from '../src/features/preset/migration-switches.js';
function make(groups,off=[],closed=[]){
  const ids=Object.keys(groups);
  return {prompts:ids.map(id=>({identifier:id,name:'名称'+id,content:'正文'+id})),prompt_order:[{character_id:100001,order:ids.map(identifier=>({identifier,enabled:!off.includes(identifier),custom:17}))}],
    extensions:{baibaiToolkit:{presetPromptGroups:{groups:[...new Set(Object.values(groups).filter(Boolean))].map(id=>({id,name:id,enabled:!closed.includes(id)})),prompts:Object.fromEntries(ids.filter(id=>groups[id]).map(id=>[id,{groupId:groups[id]}]))}}}};
}
const ids=p=>p.prompt_order[0].order.map(e=>e.identifier),meta=p=>p.extensions.baibaiToolkit.presetPromptGroups;
for(const customGroup of ['自用',''])test('新版组多出一行：在组后按源顺序补入，旧侧分组='+customGroup,()=>{
  const a=make({a:'文风',b:'文风',x:customGroup,y:customGroup,z:customGroup,c:'排版'},['z']);
  const b=make({a:'文风',b:'文风',n:'文风',c:'排版'});
  assert.deepEqual(analyzeMigration(a,b).candidates.filter(c=>c.defaultSelected).map(c=>c.id),['x','y','z']);
  const plan=planMigration(a,b,['z','x','y']);assert.deepEqual(plan.errors,[]);
  assert.deepEqual(ids(plan.result),['a','b','n','x','y','z','c']);assert.ok(plan.entries.every(e=>e.boundaryFallback&&!e.groupId));
  assert.equal(plan.result.prompt_order[0].order.find(r=>r.identifier==='z').enabled,false);
  assert.deepEqual(meta(plan.result).groups,meta(b).groups);assert.equal(meta(plan.result).prompts.z?.groupId,undefined);
});
test('不越过另一参照强行移至边界；脱离原已关组须手选',()=>{
  const a=make({a:'L',x:'K',b:'L',c:'R'},[],['K']),b=make({a:'L',n:'L',b:'L',c:'R'});
  assert.ok(planMigration(a,b,['x']).errors.length);
  delete meta(a).prompts.b; a.prompt_order[0].order.splice(2,1);
  assert.match(analyzeMigration(a,b).candidates.find(i=>i.id==='x').defaultReason,/来源组已关闭/);
});
test('复用同一个编号的不同条目按实际对应写入，新的和未注入的保持',()=>{
  const a=make({1:'',2:''},['1']),b=make({1:'',2:'',3:'',4:''});
  [b.prompts[0].name,b.prompts[1].name]=[b.prompts[1].name,b.prompts[0].name];
  [b.prompts[0].content,b.prompts[1].content]=[b.prompts[1].content,b.prompts[0].content];
  b.prompt_order[0].order.pop();
  const stored=JSON.stringify([a,b]),sync=analyzeSwitchSync(a,b),plan=planMigration(a,b,[]);
  const view=previewSwitches(plan.result,sync,new Map());assert.deepEqual([...view.writes],[['p:2',false]]);
  assert.equal(view.tags.get('p:2'),'开关已同步');
  const result=applyMigration(a,b,finalizeMigrationSwitches(plan,view));assert.deepEqual(result.prompt_order[0].order.map(r=>r.enabled),[true,false,true]);
  assert.equal(result.prompt_order[0].order[1].custom,17);assert.equal(analyzeSwitchSync(a,result).changes.size,0);assert.equal(JSON.stringify([a,b]),stored);
});
test('组总开关不改变成员开关，跳过新版独有成员、拆分、合并和不确定的复用编号',()=>{
  const a=make({a:'A',b:'A',c:'B',d:'B',e:'D',f:'E',1:''},['a','1'],['A','B','D','E']);
  const b=make({a:'A',b:'A',c:'B',d:'B',n:'B',e:'F',f:'F',1:''});
  b.prompts.find(p=>p.identifier==='1').name='不相关';b.prompts.find(p=>p.identifier==='1').content='另一份无关正文';
  const sync=analyzeSwitchSync(a,b);assert.deepEqual([...sync.changes.keys()].sort(),['g:A','p:a']);assert.equal(sync.skippedGroups,2);
  const split=structuredClone(b);meta(split).prompts.b.groupId='B';assert.ok(!analyzeSwitchSync(a,split).changes.has('g:A'));
  const withExtra=structuredClone(b);meta(withExtra).prompts.n.groupId='A';
  const view=previewSwitches(withExtra,sync,new Map());assert.ok(!view.writes.has('g:A'));assert.equal(view.values.get('p:b'),true);
});
test('手动开关优先，未注入不创建顺序记录，字符串顺序保留其他节点',()=>{
  const a=make({a:'G',b:'G'},['a'],['G']),b=make({a:'G',b:'G',tail:''});b.prompt_order[0].order=['a','b'];b.prompt_order.push({character_id:1,order:['a']});
  const sync=analyzeSwitchSync(a,b),plan=planMigration(a,b,[]);
  const view=previewSwitches(plan.result,sync,new Map([['p:a',true],['p:tail',false],['p:b',false]]));
  assert.equal(view.tags.get('p:a'),'手动调整');assert.equal(view.writes.has('p:a'),false);
  const next=finalizeMigrationSwitches(plan,view);assert.equal(next.switchCount,3);assert.deepEqual(next.result.prompt_order,[{character_id:100001,order:['a',{identifier:'b',enabled:false}]},{character_id:1,order:['a']}]);
  assert.equal(next.result.prompts[2].enabled,false);assert.equal(meta(next.result).groups[0].enabled,false);assert.equal(plan.result.prompts[2].enabled,undefined);
});
test('跳过不规范开关；每次拖动保留独立的中间位置和归组',()=>{
  const a=make({a:'G',b:'G',x:'',c:'H'},['b']),b=make({a:'G',b:'G',c:'H'});
  b.prompt_order[0].order[1].enabled=null;assert.ok(!analyzeSwitchSync(a,b).changes.has('p:b'));
  const p=planMigration(a,b,['x']),p1=moveMigrationEntry(p,'x',{beforeId:'a',groupId:'G'}),p2=moveMigrationEntry(p1,'x',{groupId:'H'});
  assert.deepEqual(ids(p.result),['a','b','x','c']);assert.deepEqual(ids(p1.result),['x','a','b','c']);assert.deepEqual(ids(p2.result),['a','b','c','x']);
  assert.equal(meta(p.result).prompts.x?.groupId,undefined);assert.equal(meta(p1.result).prompts.x.groupId,'G');assert.equal(meta(p2.result).prompts.x.groupId,'H');
  assert.equal(moveMigrationEntry(p2,'x',{groupId:'H'}),p2);
});
