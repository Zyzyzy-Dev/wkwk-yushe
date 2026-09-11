// 批量正则迁移回归：原子写入、固定配对、视觉顺序、精确锚点及分组配置保真。
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferRegexScripts as transfer, getRegexGroupModel } from '../src/core.js';
const script=(id, extra={})=>({id,scriptName:id,findRegex:'/'+id+'/g',replaceString:'',disabled:false,...extra});
const preset=(ids,groups)=>({prompts:[],extensions:{custom:{keep:true},regex_scripts:ids.map(id=>typeof id==='string'?script(id):id),...(groups?{baibaiToolkit:{other:true,regexGroups:groups}}:{})}});
const ids=p=>p.extensions.regex_scripts.map(s=>s.id);
const group=(mapping,orders={})=>({version:1,custom:'preserved',groups:[{id:'g',name:'G',order:0,custom:true},{id:'h',name:'H',order:1}],scripts:Object.fromEntries(Object.entries(mapping).map(([id,groupId],i)=>[id,{groupId,order:orders[id]??i,unknown:id}])),ungrouped:{name:'默认',custom:1}});

test('batch inserts and overwrites as one ordered block at an explicit anchor, preserving the source',()=>{
  const a=preset(['a',script('b',{disabled:true,unknown:{x:[1]}}),'c']),b=preset(['z',script('b',{findRegex:'different'}),'y']);const saved=structuredClone(a);
  assert.deepEqual(transfer(a,b,'old',[2,1,0],{beforeIndex:0,beforeId:'z'}),{count:3,overwritten:1});
  assert.deepEqual(ids(b),['a','b','c','z','y']);assert.deepEqual(a,saved);assert.deepEqual(b.extensions.regex_scripts[1],a.extensions.regex_scripts[1]);
  b.extensions.regex_scripts[1].unknown.x.push(2);assert.deepEqual(a,saved);assert.deepEqual(b.extensions.custom,{keep:true});
});
test('explicit list end moves an overwritten counterpart and respects source visual order',()=>{
  const a=preset(['a','b','c'],group({a:'g',b:'g',c:'h'},{a:2,b:1})),b=preset(['a','z']);
  transfer(a,b,'old',[0,1],{beforeIndex:null,beforeId:null});assert.deepEqual(ids(b),['z','b','a']);
  assert.equal(b.extensions.baibaiToolkit,undefined);
});
test('same-side batch removes first, keeps source order and resolves selected anchors',()=>{
  const p=preset(['a','b','c','d','e']);transfer(p,p,'old',[3,1],{beforeIndex:0});assert.deepEqual(ids(p),['b','d','a','c','e']);
  transfer(p,p,'new',[0,1],{beforeIndex:1});assert.deepEqual(ids(p),['b','d','a','c','e']);
  transfer(p,p,'old',[1,0],{beforeIndex:null});assert.deepEqual(ids(p),['a','c','e','b','d']);
});
test('group tail insertion stays before the next group and preserves unknown group metadata',()=>{
  const a=preset(['a','b']),b=preset(['z','y','q'],group({z:'g',y:'g',q:'h'}));
  transfer(a,b,'old',[1,0],{targetGroupId:'g',beforeIndex:null,beforeId:null});
  assert.deepEqual(ids(b),['z','y','a','b','q']);const g=b.extensions.baibaiToolkit.regexGroups;
  assert.deepEqual(g.scripts.a,{groupId:'g',order:2});assert.equal(g.scripts.z.unknown,'z');assert.equal(g.groups[0].custom,true);assert.equal(g.custom,'preserved');assert.equal(g.ungrouped.custom,1);
});
test('batch adopts empty groups and normalizes metadata order by actual displayed order',()=>{
  const a=preset(['a','b']),b=preset(['z','y'],group({z:'h',y:'h'},{z:8,y:0}));
  transfer(a,b,'old',[0,1],{targetGroupId:'g',beforeIndex:null});assert.deepEqual(ids(b),['a','b','y','z']);
  assert.deepEqual(getRegexGroupModel(b).groups.map(g=>g.scripts.map(i=>i.script.id)),[['a','b'],['y','z']]);
});
test('click migration retains counterparts and near-neighbor placement without changing source',()=>{
  const a=preset(['a','b','c','d']),b=preset(['a','d']);transfer(a,b,'old',[1,2]);assert.deepEqual(ids(b),['a','b','c','d']);
  const source=preset(['b','x'],group({b:'g',x:'g'})),dest=preset(['b','z'],group({b:'h',z:'h'}));
  transfer(source,dest,'old',[0,1]);assert.equal(dest.extensions.baibaiToolkit.regexGroups.scripts.b.groupId,'h');assert.equal(dest.extensions.baibaiToolkit.regexGroups.scripts.x.groupId,'g');
});
test('pairing is fixed for a batch: duplicate source names never overwrite a just inserted item',()=>{
  const a=preset([script('a',{scriptName:'same'}),script('b',{scriptName:'same'})]),b=preset([]);
  transfer(a,b,'old',[0,1]);assert.deepEqual(ids(b),['a','b']);
  const c=preset([script('c',{scriptName:'same'})]);transfer(a,c,'new',[0,1],{beforeIndex:null});assert.deepEqual(ids(c),['c','a','b']);
});
test('unique name counterparts use source IDs and clear only replaced target group metadata',()=>{
  const a=preset([script('a',{scriptName:'same'})]),b=preset([script('b',{scriptName:'same'}),'z'],group({b:'g',z:'h'}));
  transfer(a,b,'new',[0],{targetGroupId:'h',beforeIndex:null});assert.deepEqual(ids(b),['z','a']);const g=b.extensions.baibaiToolkit.regexGroups;
  assert.equal(g.scripts.b,undefined);assert.deepEqual(g.scripts.a,{groupId:'h',order:1,unknown:'b'});
});
test('index anchors handle missing and repeated IDs without choosing the wrong row',()=>{
  const a=preset(['a']),b=preset([script('',{scriptName:'one'}),script('',{scriptName:'two'})]);transfer(a,b,'old',[0],{beforeIndex:1,beforeId:null});assert.deepEqual(ids(b),['','a','']);
  const c=preset(['z','z']);transfer(a,c,'old',[0],{beforeIndex:1,beforeId:'z'});assert.deepEqual(ids(c),['z','a','z']);
});
test('invalid later selection, stale anchor or invalid group leaves both presets unchanged',()=>{
  for(const [indexes,options] of [[[0,9],{}],[[0],{beforeIndex:99}],[[0],{targetGroupId:'gone'}],[[0],{beforeId:'gone'}],[[0],{targetGroupId:'g',beforeIndex:1}]]){
    const a=preset(['a','b']),b=preset(['z','y'],group({z:'g',y:'h'})),snap=structuredClone([a,b]);
    assert.throws(()=>transfer(a,b,'old',indexes,options));assert.deepEqual([a,b],snap);
  }
});
test('dragging a selected block over its counterpart preserves a meaningful insertion anchor',()=>{
  const a=preset(['a','b']),b=preset(['z','a','b','y']);transfer(a,b,'old',[0,1],{beforeIndex:1});assert.deepEqual(ids(b),['z','a','b','y']);
});

test('grouped scripts without IDs keep their visual order beside ID-bearing ungrouped scripts',()=>{
  const a=preset(['b']),b=preset(['z',script('',{scriptName:'one'}),script('',{scriptName:'two'}),'a'],group({z:'g'}));
  transfer(a,b,'old',[0],{targetGroupId:'__ungrouped',beforeIndex:null});
  assert.deepEqual(getRegexGroupModel(b).groups.flatMap(g=>g.scripts.map(i=>i.script.scriptName)),['z','one','two','a','b']);
  transfer(b,b,'old',[4],{targetGroupId:'__ungrouped',beforeIndex:2});
  assert.deepEqual(getRegexGroupModel(b).groups.flatMap(g=>g.scripts.map(i=>i.script.scriptName)),['z','one','b','two','a']);
});
