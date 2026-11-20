// 用酒馆事件前后两个目录模拟重名、半完成、旧文件迟到与持久化失败，不操作真实用户数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import {watchSnapshotPresetRenames} from '../src/host/snapshot-preset-rename.js';

const event={apiId:'openai',oldName:'A',newName:'A1'};
function fixture(){
  const events=new Map(), notes=[];
  const state={disk:['A'],names:['A'],writes:0,fail:false,status:null};
  const base={id:'s',name:'本机',presetName:'A',orderCharacterId:100001,entries:[],groups:[],worldNames:[]};
  const store={snapshots:[base,{...base,id:'i',name:'导入',importedShare:true},{...base,id:'w',scope:{preset:false,worlds:true,regex:false}}]};
  const env={manager:{getPresetList:()=>({preset_names:state.names})}};
  const script={event_types:{PRESET_RENAMED_BEFORE:'before',PRESET_RENAMED:'after'},eventSource:{on:(key,fn)=>events.set(key,fn)}};
  let queued=Promise.resolve();
  watchSnapshotPresetRenames({script,environment:async()=>env,storeFor:()=>store,
    diskNames:async()=>{if(state.disk instanceof Error)throw state.disk;return state.disk;},
    serial:fn=>(queued=fn()),save:async()=>{state.writes++;if(state.fail)throw Error('写入失败');},
    pendingSave:()=>state.status,notify:(level,message)=>notes.push({level,message})});
  return {state,notes,store,before:(data=event)=>events.get('before')(data),
    after:async(data=event)=>{events.get('after')(data);await queued.catch(()=>{});}};
}

test('改名仅更新事件开始时已有且启用了预设范围的快照，重复完成事件只写一次',async()=>{
  const f=fixture(), original=f.store.snapshots;
  await f.before();
  const late={...original[1],id:'late'};
  f.store.snapshots=[...original,late];
  f.state.names=f.state.disk=['A1'];
  await f.after();await f.after();
  assert.deepEqual(f.store.snapshots.map(s=>s.presetName),['A1','A1','A','A']);
  assert.equal(f.store.snapshots[2],original[2]);assert.equal(f.store.snapshots[3],late);
  assert.equal(f.state.writes,1);assert.equal(f.notes[0].level,'success');
  await f.before({apiId:'openai',oldName:'A1',newName:'A2'});
  f.state.names=f.state.disk=['A2'];
  await f.after({apiId:'openai',oldName:'A1',newName:'A2'});
  assert.deepEqual(f.store.snapshots.map(s=>s.presetName),['A2','A2','A','A']);
});

test('预先重名、仅大小写不同的目标、半完成、目录不可读均保持原指向',async()=>{
  for(const [pre,post] of [
    [['A','A1'],['A1']], [['A','a1'],['A1']], [['A'],['A','A1']], [['A'],[]],
    [new Error('无法读取'),['A1']], [['A'],new Error('读取失败')],
  ]) {
    const f=fixture(),original=f.store.snapshots;
    f.state.disk=pre;await f.before();
    f.state.names=['A1'];f.state.disk=post;await f.after();
    assert.equal(f.store.snapshots,original);assert.equal(f.state.writes,0);
    assert.equal(f.notes[0].level,'warning');
  }
});

test('缺少前置事件、非聊天补全预设或事件名称对不上时不改快照',async()=>{
  const f=fixture(),original=f.store.snapshots;
  await f.after();await f.before({...event,apiId:'instruct'});await f.after({...event,apiId:'instruct'});
  await f.before();await f.after({...event,oldName:'B'});
  assert.equal(f.store.snapshots,original);assert.equal(f.state.writes,0);assert.equal(f.notes.length,0);
});

test('写入失败恢复原快照；已请求保存但回读失败时保留待核验提示',async()=>{
  const f=fixture(),original=f.store.snapshots;
  await f.before();f.state.names=f.state.disk=['A1'];f.state.fail=true;await f.after();
  assert.equal(f.store.snapshots,original);assert.match(f.notes.at(-1).message,/写入失败/);
  f.state.names=f.state.disk=['A'];await f.before();f.state.names=f.state.disk=['A1'];
  f.state.fail=false;f.state.status={verified:false,message:'保存待核验'};await f.after();
  assert.equal(f.store.snapshots[0].presetName,'A1');assert.deepEqual(f.notes.at(-1),{level:'warning',message:'保存待核验'});
});
