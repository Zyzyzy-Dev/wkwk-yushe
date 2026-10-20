// 快照收藏回归：稳定展示、宿主串行保存、失败回滚与绑定隔离。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sortSnapshotFavorites} from '../src/features/snapshot/snapshot.js';
import {searchSnapshotNames} from '../src/features/snapshot/ui/snapshot-panel.js';

test('收藏排序稳定，搜索和取消收藏保留原顺序与原对象',()=>{
  const snapshots=[{id:'a',name:'日常 A'},{id:'b',name:'日常 B',favorite:true},{id:'c',name:'战斗 C'},{id:'d',name:'日常 D',favorite:true}];
  const before=structuredClone(snapshots);
  assert.deepEqual(sortSnapshotFavorites(snapshots).map(s=>s.id),['b','d','a','c']);
  assert.deepEqual(sortSnapshotFavorites(searchSnapshotNames(snapshots,'日常')).map(s=>s.id),['b','d','a']);
  assert.equal(sortSnapshotFavorites(snapshots)[0],snapshots[1]);
  assert.deepEqual(snapshots,before);
  delete snapshots[1].favorite;delete snapshots[3].favorite;
  assert.deepEqual(sortSnapshotFavorites(snapshots).map(s=>s.id),['a','b','c','d']);
});

const source=fs.readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const serial=source.slice(source.indexOf('function snapshotSerial('),source.indexOf('\nasync function withSnapshotTimeout('));
const handler=source.slice(source.indexOf('async function handleSnapshotRequest('),source.indexOf('\nasync function installSnapshotBindings('));
function harness(save=async()=>{}){
  const store={snapshots:[{id:'a',name:'原快照',entries:[{identifier:'p',enabled:true}],legacy:{untouched:true}},{id:'b',name:'其他快照'}],characterBindings:{'a.png':'b'}};
  let calls=0,notifications=0;
  const deps={snapshotEnvironment:async()=>({}),snapshotStore:()=>store,snapshotContext:()=>({}),snapshotList:()=>structuredClone(store),saveSnapshotSettings:async()=>{calls++;await save(store);},snapshotNotify:()=>{notifications++;},normalizeSnapshotName:name=>name.trim()};
  const execute=new Function(...Object.keys(deps),'let snapshotQueue=Promise.resolve(),snapshotBusy=0;'+serial+handler+';return handleSnapshotRequest;')(...Object.values(deps));
  return {store,execute,calls:()=>calls,notifications:()=>notifications};
}
test('宿主收藏只修改标志，重命名和重复请求保留收藏，不改条目或绑定',async()=>{
  const h=harness(),before=structuredClone(h.store);
  await h.execute('snapshot-favorite',{id:'a',favorite:true});
  assert.deepEqual(h.store.snapshots[0],{...before.snapshots[0],favorite:true});
  await h.execute('snapshot-favorite',{id:'a',favorite:true});assert.equal(h.calls(),1);
  await h.execute('snapshot-rename',{id:'a',name:'新名称'});assert.equal(h.store.snapshots[0].favorite,true);
  await h.execute('snapshot-favorite',{id:'a',favorite:false});
  assert.equal(Object.hasOwn(h.store.snapshots[0],'favorite'),false);
  assert.deepEqual(h.store.characterBindings,before.characterBindings);
  assert.deepEqual(h.store.snapshots.map(s=>s.id),['a','b']);
});
test('保存失败回滚原快照数组，下一次操作仍可继续',async()=>{
  let fail=true;const h=harness(async()=>{if(fail)throw Error('disk failed');});const original=h.store.snapshots;
  await assert.rejects(h.execute('snapshot-favorite',{id:'a',favorite:true}),/disk failed/);
  assert.equal(h.store.snapshots,original);assert.equal(h.store.snapshots[0].favorite,undefined);
  fail=false;await h.execute('snapshot-favorite',{id:'a',favorite:true});assert.equal(h.store.snapshots[0].favorite,true);
});
test('收藏请求串行执行，等待保存后才取消收藏',async()=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});let writes=0;
  const h=harness(async()=>{if(++writes===1){entered();await new Promise(resolve=>{release=resolve;});}});
  const first=h.execute('snapshot-favorite',{id:'a',favorite:true});await started;
  const second=h.execute('snapshot-favorite',{id:'a',favorite:false});await Promise.resolve();
  assert.equal(h.calls(),1);assert.equal(h.store.snapshots[0].favorite,true);release();
  await Promise.all([first,second]);assert.equal(h.calls(),2);assert.equal(h.store.snapshots[0].favorite,undefined);
});
test('无效收藏请求不写设置',async()=>{
  const h=harness();
  await assert.rejects(h.execute('snapshot-favorite',{id:'missing',favorite:true}),/已删除/);
  for(const favorite of [undefined,'true',1,null])await assert.rejects(h.execute('snapshot-favorite',{id:'a',favorite}),/收藏状态无效/);
  assert.equal(h.calls(),0);assert.equal(h.store.snapshots[0].favorite,undefined);
});
