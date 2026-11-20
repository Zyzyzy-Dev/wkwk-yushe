// 分享文件下载使用酒馆宿主接口，浏览器发起、原生完成、用户取消分别反馈。
import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadJsonFile} from '../src/host/json-download.js';

test('writes a compact UTF-8 JSON snapshot file using the host download interface', async () => {
  const value={format:'wkwk-yushe.snapshot-share',version:1,snapshots:[{name:'中文😀'}]};
  let received;
  const result=await downloadJsonFile((...args)=>{received=args;},value,'配置/中文.json');
  assert.deepEqual(received,[JSON.stringify(value),'配置_中文.json','application/json;charset=utf-8',{throwOnFailure:true}]);
  assert.deepEqual(result,{status:'started'});
});

test('native completion, cancellation and failures keep distinct outcomes', async () => {
  for(const [reply,status] of [[{completed:true},'saved'],[{cancelled:true},'cancelled'],[{completed:false},'cancelled']]){
    assert.deepEqual(await downloadJsonFile(()=>reply,{},'demo.json'),{status});
  }
  await assert.rejects(downloadJsonFile(()=>({mode:'failed'}),{},'demo.json'),/导出/);
  await assert.rejects(downloadJsonFile(undefined,{},'demo.json'),/导出/);
});
