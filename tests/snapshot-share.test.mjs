// 快照分享边界使用合成配置，覆盖旧格式、嵌套过滤、输入限制与接收方副本。
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshotShare, readSnapshotShare, makeImportedSnapshots, MAX_SNAPSHOT_SHARE_COUNT, MAX_SNAPSHOT_SHARE_BYTES} from '../src/features/snapshot/snapshot-share.js';
import {validateSnapshot} from '../src/features/snapshot/snapshot.js';

function fixture(){
  return {
    id:'local', name:'方案', orderCharacterId:'private-avatar', presetName:'预设',
    createdAt:1, updatedAt:2, favorite:true, hidden:true, apiPlan:'private', editor:{content:'private'},
    scope:{preset:true,worlds:true,regex:true,presetRegex:true,reasoning:true},
    entries:[{identifier:'p',name:'条目',enabled:false,content:'private'}],
    groups:[{id:'g',name:'组',enabled:true,memberIds:['private']}],worldNames:['书'],
    resources:{version:1,worlds:{global:['书'],character:['private'],chat:[]},
      worldEntries:[{name:'private',entries:[]},{name:'书',entries:[{uid:'1',name:'词条',content:'private',
        settings:{disable:true,key:['天气'],keysecondary:[],depth:4,scanDepth:null,matchWholeWords:null,role:null,delayUntilRecursion:2,group:'天气',groupWeight:100,
          extensions:{secret:'private'},content:'private',characterFilter:{names:['private']},automationId:'private'}}]}],
      regex:{global:[{id:'r',name:'规则',enabled:true,replaceString:'private'}],preset:[{id:'private'}],character:[{id:'private'}]}},
    presetRegex:{version:1,owner:{apiId:'openai',presetName:'预设',connection:'private'},switches:[{id:'pr',name:'独立规则',enabled:false,definitionFingerprint:'v1:0123456789abcdef',findRegex:'private'}]},
    reasoning:{version:2,auto_parse:true,name:'解析',prefix:'[',suffix:']',separator:'\n',auto_expand:false,show_hidden:false,add_to_prompts:false,max_additions:2,secret:'private'},
  };
}

test('exports only selected global settings and switches and round-trips compact JSON',()=>{
  const original=fixture(),before=structuredClone(original);
  const bundle=buildSnapshotShare([original]), [row]=readSnapshotShare(JSON.parse(JSON.stringify(bundle)));
  assert.equal(bundle.format,'wkwk-yushe.snapshot-share');assert.equal(bundle.version,1);
  assert.deepEqual(bundle.snapshots,[row]);
  assert.deepEqual(row.resources.worlds,{global:['书']});
  assert.deepEqual(row.resources.worldEntries[0].entries[0].settings,{disable:true,key:['天气'],keysecondary:[],depth:4,scanDepth:null,matchWholeWords:null,role:null,delayUntilRecursion:2,group:'天气',groupWeight:100});
  assert.deepEqual(row.resources.regex,{global:[{id:'r',name:'规则',enabled:true}],preset:[],character:[]});
  assert.equal(row.presetRegex.switches[0].definitionFingerprint,'v1:0123456789abcdef');
  assert.equal(row.reasoning.max_additions,2);
  for(const field of ['id','orderCharacterId','createdAt','updatedAt','favorite','hidden','editor','apiPlan']) assert.equal(Object.hasOwn(row,field),false);
  assert.doesNotMatch(JSON.stringify(bundle),/private/);
  row.resources.worldEntries[0].entries[0].settings.key.push('mutated');
  assert.deepEqual(original,before);assert.deepEqual(bundle.snapshots[0].resources.worldEntries[0].entries[0].settings.key,['天气']);
});

test('inactive scopes drop saved fields, legacy snapshots retain mount-only behavior',()=>{
  const local=fixture();local.scope={preset:false,worlds:false,regex:false,reasoning:true};
  const [row]=readSnapshotShare(buildSnapshotShare([local]));
  assert.deepEqual(row.entries,[]);assert.deepEqual(row.groups,[]);assert.deepEqual(row.worldNames,[]);
  for(const key of ['presetName','presetRegex','resources'])assert.equal(row[key],undefined);
  const legacy={id:'a',name:'原始',orderCharacterId:7,presetName:'旧',worldNames:['书'],entries:[{identifier:'p',enabled:true}],groups:[]};
  const [copy]=makeImportedSnapshots(buildSnapshotShare([legacy]),[]);
  assert.deepEqual(copy.worldNames,['书']);assert.equal(copy.resources,undefined);
  assert.equal(copy.scope.presetRegex,false);assert.equal(copy.scope.regex,false);assert.equal(copy.orderCharacterId,100001);
  assert.equal(validateSnapshot(copy),copy);
});

test('imports fresh local copies with local order node, unique bounded names within the batch and fresh timestamps',()=>{
  const source=fixture();source.name='😀'.repeat(60);
  const existing=[{id:'local',name:source.name,favorite:true}],before=structuredClone(existing);
  const bundle=buildSnapshotShare([source,source]);
  const copies=makeImportedSnapshots(bundle,existing,77);
  assert.deepEqual(existing,before);assert.equal(new Set(copies.map(x=>x.id)).size,2);
  assert.equal(new Set([...existing,...copies].map(x=>x.name)).size,3);
  for(const copy of copies){
    assert.notEqual(copy.id,source.id);assert.equal(validateSnapshot(copy),copy);assert.equal(copy.orderCharacterId,77);
    assert.ok(copy.name.length<=120);assert.ok(copy.name.isWellFormed());
    assert.ok(copy.createdAt>2);assert.equal(copy.updatedAt,copy.createdAt);assert.equal(copy.favorite,undefined);
  }
  assert.notEqual(makeImportedSnapshots(bundle,existing)[0].id,copies[0].id);
});

test('malformed, foreign or private fields reject the entire incoming batch',()=>{
  for(const change of [
    b=>b.version++, b=>b.format='foreign', b=>b.id='x', b=>b.snapshots[1].id='foreign',
    b=>delete b.snapshots[1].scope, b=>b.snapshots[1].scope.presetRegex='true',
    b=>b.snapshots[1].resources.regex.character.push({id:'x',name:'x',enabled:true}),
    b=>b.snapshots[1].resources.worldEntries[0].entries[0].settings.extensions={unknown:true},
    b=>b.snapshots[1].resources.worldEntries[0].entries[0].settings.group=['not text'],
    b=>b.snapshots[1].entries.push(b.snapshots[1].entries[0]), b=>b.snapshots[1].entries[0].name={content:'bad'},
    b=>b.snapshots[1].resources.version=99,b=>b.snapshots[1].worldNames=[],
    b=>b.snapshots[1].presetRegex.switches[0].definitionFingerprint=['v1:0123456789abcdef'],
    b=>b.snapshots[1].reasoning.max_additions=1000,b=>b.snapshots[1].scope.worlds=false,
    b=>b.snapshots[1].entries[0]=JSON.parse('{"identifier":"p","enabled":true,"name":"p","__proto__":{}}'),
  ]){
    const bundle=buildSnapshotShare([fixture(),fixture()]);change(bundle);
    assert.throws(()=>readSnapshotShare(bundle));
    const existing=[];assert.throws(()=>makeImportedSnapshots(bundle,existing));assert.deepEqual(existing,[]);
  }
});

test('limits are symmetric for snapshot count and actual compact UTF-8 bytes',()=>{
  assert.throws(()=>buildSnapshotShare([]));assert.throws(()=>buildSnapshotShare(Array(MAX_SNAPSHOT_SHARE_COUNT+1).fill(fixture())));
  const local=fixture(),[row]=buildSnapshotShare([local]).snapshots;
  const bundle={format:'wkwk-yushe.snapshot-share',version:1,snapshots:[row]};
  const room=MAX_SNAPSHOT_SHARE_BYTES-Buffer.byteLength(JSON.stringify(bundle));
  const padding='中'.repeat(Math.floor(room/3))+'x'.repeat(room%3);
  row.reasoning.prefix+=padding;local.reasoning.prefix+=padding;
  assert.equal(Buffer.byteLength(JSON.stringify(buildSnapshotShare([local]))),MAX_SNAPSHOT_SHARE_BYTES);
  assert.equal(readSnapshotShare(bundle)[0].reasoning.prefix,row.reasoning.prefix);
  row.reasoning.prefix+='x';local.reasoning.prefix+='x';
  assert.throws(()=>buildSnapshotShare([local]),/8/);assert.throws(()=>readSnapshotShare(bundle),/8/);
});

test('rejects sparse batches before export, import, and persistence',()=>{
  const sparse=Array(2);
  sparse[0]=fixture();
  assert.throws(()=>buildSnapshotShare(sparse));
  const bundle=buildSnapshotShare([fixture()]);bundle.snapshots.length=2;
  assert.throws(()=>readSnapshotShare(bundle));
  assert.throws(()=>makeImportedSnapshots(bundle,[]));
});

test('incoming malformed preset node cannot become a persistent local snapshot',()=>{
  const bundle=buildSnapshotShare([fixture()]);
  for(const node of [NaN,Infinity,'',{},null]) assert.throws(()=>makeImportedSnapshots(bundle,[],node));
  assert.equal(makeImportedSnapshots(bundle,[],'0')[0].orderCharacterId,'0');
});
