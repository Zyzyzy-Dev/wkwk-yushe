// 控制 IndexedDB 的请求与事务事件顺序，检验提交边界、双仓操作和目录读取范围。
import test from 'node:test';
import assert from 'node:assert/strict';

async function harness(t) {
  const storage=await import('../src/ui/project-storage.js?case='+encodeURIComponent(t.name));
  const calls=[];
  let tx, requestError, getAllResult=[];
  const db={
    transaction(stores,mode){
      tx={stores,mode,abort(){this.onabort?.();},objectStore(name){
        const request=(method,arg)=>{
          calls.push({name,method,arg});
          if(name==='projectCatalog'&&requestError)throw requestError;
          return {result:method==='getAll'?getAllResult:undefined};
        };
        return {put:value=>request('put',value),delete:id=>request('delete',id),get:id=>request('get',id),getAll:()=>request('getAll')};
      }};
      return tx;
    },
  };
  const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){
    const request={result:db};
    queueMicrotask(()=>request.onsuccess());
    return request;
  }}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete globalThis.indexedDB;});
  return {storage,calls,transaction:()=>tx,setError:error=>{requestError=error;},setRows:rows=>{getAllResult=rows;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const saved={id:'p',name:'合成项目',updatedAt:7,old:{body:'旧'},new:{body:'新'},formDrafts:{draft:'草稿'}};

for(const [method,input,operation] of [['writeProject',saved,'put'],['removeProject','p','delete']]){
  test(method+' waits for commit and rejects a late transaction abort',async t=>{
    const h=await harness(t);
    let settled=false;
    const pending=h.storage[method](input);
    pending.then(()=>{settled=true;},()=>{settled=true;});
    await tick();
    const tx=h.transaction();
    assert.equal(settled,false);
    assert.equal(tx.mode,'readwrite');
    assert.deepEqual(new Set(tx.stores),new Set(['projects','projectCatalog']));
    assert.deepEqual(h.calls,[{name:'projects',method:operation,arg:input},{name:'projectCatalog',method:operation,arg:operation==='put'?{id:'p',name:'合成项目',updatedAt:7}:'p'}]);
    tx.error=Error('quota');
    tx.onabort();
    await assert.rejects(pending,/quota/);
  });
}
test('failing to enqueue the catalog write aborts the already queued project write',async t=>{
  const h=await harness(t);
  h.setError(Error('metadata write failed'));
  await assert.rejects(h.storage.writeProject(saved),/metadata write failed/);
  assert.deepEqual(h.calls.map(call=>call.name),['projects','projectCatalog']);
});
test('listing reads catalog records by recency and loading fetches only the requested body',async t=>{
  const h=await harness(t);
  h.setRows([{id:'a',name:'甲',updatedAt:10},{id:'b',name:'乙',updatedAt:30}]);
  const list=h.storage.listProjects();
  await tick();
  h.transaction().oncomplete();
  assert.deepEqual((await list).map(row=>row.id),['b','a']);
  const body=h.storage.readProject('a');
  await tick();
  h.transaction().oncomplete();
  await body;
  assert.deepEqual(h.calls,[{name:'projectCatalog',method:'getAll',arg:undefined},{name:'projects',method:'get',arg:'a'}]);
});
