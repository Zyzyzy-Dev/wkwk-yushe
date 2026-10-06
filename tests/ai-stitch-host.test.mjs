// 独立请求和只新建保存边界；模拟 I/O，断言实际适配器的行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStitchOverrides, buildIndependentRequest, createOnlyStore } from '../src/host/ai-stitch-transport.js';
import {registerCreatedPreset} from '../src/host/ai-stitch-transport.js';
test('新建缓存注册后可按原生名称索引读取，原项目不变',()=>{const original={prompts:[]},fresh={prompts:[{content:'新'}]},presets=[original],names={'主':0};registerCreatedPreset(presets,names,'新',fresh);assert.equal(names['新'],1);assert.deepEqual(presets[1],fresh);assert.equal(presets[0],original);});
test('写入前冲突有可安全修改名称的错误类型',async()=>{const store=createOnlyStore({read:async()=>[['same',{}]],write:()=>assert.fail(),sync:()=>{}});await assert.rejects(store.create({id:'j',name:'same',originalName:'main',preset:{}}),{name:'StitchNotWritten'});});
test('独立方案使用指定 secret_id，消息不继承聊天，配置不变', () => {
 const config={source:'custom',model:'m',secretId:'other',connection:{custom_url:'https://example.org/v1'},additional:{}};
 const before=structuredClone(config), messages=[{role:'user',content:'synthetic'}];
 const body=buildIndependentRequest(config,messages);
 assert.equal(body.secret_id,'other');assert.deepEqual(body.messages,messages);assert.equal(body.stream,false);assert.deepEqual(config,before);
});
test('拒绝附加参数替换隔离消息、模型和认证头',()=>{
 for(const additional of [{custom_include_body:'messages: []'},{custom_exclude_body:'- model'},{custom_include_headers:'Authorization: bad'}])
 assert.throws(()=>buildIndependentRequest({source:'custom',model:'m',secretId:'a',connection:{custom_url:'https://e.test'},additional},[],s=>s.includes('Authorization')?{Authorization:'bad'}:s.includes('-')?['model']:{messages:[]}),/附加/);
});
test('附加参数不能覆盖或删除面板指定的输出上限',()=>{
 for(const additional of [{custom_include_body:'{"max_tokens":1}'},{custom_include_body:'{"max_completion_tokens":1}'},{custom_exclude_body:'["max_tokens"]'}])assert.throws(()=>buildIndependentRequest({source:'custom',model:'m',secretId:'a',connection:{custom_url:'https://e.test'},additional},[]),/输出上限/);
});
test('新建拒绝原名称别名和磁盘同名，无写入',async()=>{
 let writes=0; const store=createOnlyStore({read:async()=>[['taken',{prompts:[]}]],write:async()=>writes++,sync:()=>{}});
 for(const name of ['MAIN.json','taken','../x']) await assert.rejects(store.create({id:name,name,originalName:'main',preset:{prompts:[]}}));
 assert.equal(writes,0);
});
test('写入结果丢失只读复查，重复点击不产生第二个文件',async()=>{
 let writes=0,disk=[];const preset={prompts:[{content:'\r\n 😀 '}]};
 const store=createOnlyStore({read:async()=>disk,write:async(name,p)=>{writes++;disk=[[name,p]];throw Error('lost response');},sync:()=>{}});
 const args={id:'job',name:'fresh-unique',originalName:'main',preset};
 const result=await store.create(args);assert.deepEqual(result.preset,preset);
 await store.create(args);assert.equal(writes,1);
});
test('核验不明时禁止重写，允许只读恢复',async()=>{
 let writes=0,disk=[],fail=false;const preset={prompts:[]};
 const store=createOnlyStore({read:async()=>{if(fail)throw Error();return disk;},write:async(n,p)=>{writes++;disk=[[n,p]];fail=true;},sync:()=>{}});
 const args={id:'job',name:'unique',originalName:'main',preset};
 await assert.rejects(store.create(args),/待核验/);await assert.rejects(store.create(args),/待核验/);assert.equal(writes,1);
 fail=false;assert.deepEqual((await store.verify('job')).preset,preset);
});

test('保存核验区分读取、缺失、内容差异和已写入后的同步失败，复查不重写',async()=>{
 for(const state of ['read','missing','different','sync']){
  let disk=[],writes=0,stage=false,recovered=false;
  const store=createOnlyStore({read:async()=>{if(stage&&!recovered&&state==='read')throw Error('HTTP 503');return stage&&!recovered&&state==='missing'?[]:stage&&!recovered&&state==='different'?[['new',{changed:true}]]:disk;},write:async(n,p)=>{writes++;disk=[[n,p]];stage=true;},sync:()=>{if(!recovered&&state==='sync')throw Error('列表控件缺失');}});
  const pattern={read:/读取预设列表失败.*503/,missing:/尚未找到新预设/,different:/内容不一致/,sync:/已写入且内容核验通过.*同步原生列表失败/}[state];
  await assert.rejects(store.create({id:'j',name:'new',originalName:'old',preset:{prompts:[]}}),pattern);
  await assert.rejects(store.verify('j'),pattern);assert.equal(writes,1);
  recovered=true;assert.equal((await store.verify('j')).name,'new');assert.equal(writes,1);
 }
});

test('临时URL和密钥仅覆盖custom请求，原请求不变且输入需合法',()=>{
 const original={chat_completion_source:'custom',custom_url:'https://original.test/v1',secret_id:'saved',custom_include_headers:'{"X-Test":"keep"}'};
 const result=applyStitchOverrides(original,{url:'https://temporary.test/v1',key:'SYNTHETIC_KEY'});
 assert.equal(result.custom_url,'https://temporary.test/v1');assert.equal(JSON.parse(result.custom_include_headers).Authorization,'Bearer SYNTHETIC_KEY');assert.equal(JSON.parse(result.custom_include_headers)['X-Test'],'keep');assert.equal(original.custom_url,'https://original.test/v1');assert.equal(JSON.parse(original.custom_include_headers).Authorization,undefined);
 for(const overrides of [{url:'javascript:alert(1)'},{url:'https://user:pass@example.test'},{key:'bad\nkey'}])assert.throws(()=>applyStitchOverrides(original,overrides));
 assert.throws(()=>applyStitchOverrides({chat_completion_source:'openai'},{key:'x'}),/仅支持custom/);
 assert.deepEqual(applyStitchOverrides(original),original);
});
test('附加参数非字符串报结构无效，空值与纯空白跳过',()=>{
 const make=value=>buildIndependentRequest({source:'custom',model:'m',secretId:'a',connection:{custom_url:'https://e.test'},additional:{custom_include_body:value}},[]);
 for(const v of [false,{},[],1])assert.throws(()=>make(v),/附加参数结构无效/);
 for(const v of [null,undefined,'','  '])assert.equal('custom_include_body' in make(v),false);
});
test('新建成功后只保留一份预设副本，重复提交与核验返回值不变',async()=>{
 const preset={prompts:[{content:'新'}]};let disk=[];const store=createOnlyStore({read:async()=>disk,write:async(n,p)=>{disk=[[n,p]];},sync:()=>{}});
 const first=await store.create({id:'j',name:'n',originalName:'m',preset});assert.deepEqual(first,{name:'n',preset});
 const again=await store.create({id:'j',name:'n',originalName:'m',preset});assert.deepEqual(again,first);assert.notEqual(again.preset,first.preset);
 assert.deepEqual(await store.verify('j'),first);
});
