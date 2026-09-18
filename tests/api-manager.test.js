// API 字段隔离、导入白名单与输入校验回归，不包含真实地址或用户密钥。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiProfile, planApiSwitch, importApiProfiles, readNativeApiProfiles, maskApiSecret } from '../src/features/api/api-manager.js';
test('密钥无论服务器是否开放明文均强制打码，短密钥不暴露任何字符', () => {
  assert.equal(maskApiSecret('sk-sensitive-example'), '••••••••ple');
  assert.equal(maskApiSecret('abc'), '••••••••');
  assert.equal(maskApiSecret('********xyz'), '••••••••xyz');
  assert.equal(maskApiSecret(undefined), '••••••••');
});
const profile = { id: 'scheme-a', name: '测试 API', source: 'custom', model: 'new-model', connection: { custom_url: 'https://example.com/v1' }, secretId: 'key-a' };
const settings = { chat_completion_source: 'custom', custom_model: 'old-model', custom_url: 'https://old.example/v1', preset_settings_openai: '保留预设', temp_openai: 1.2, prompts: [{ content: '不可变更' }], custom_include_body: '保留' };
test('仅 API 只生成地址与密钥变更，模型及预设不变', () => {
  const before = structuredClone(settings), plan = planApiSwitch(settings, profile, 'api');
  assert.deepEqual(plan.patch, { custom_url: profile.connection.custom_url });
  assert.equal(plan.secretId, 'key-a'); assert.deepEqual(settings, before);
});
test('仅模型不切地址、密钥、预设或生成参数', () => {
  const plan = planApiSwitch(settings, profile, 'model');
  assert.deepEqual(plan.patch, { custom_model: 'new-model' }); assert.equal(plan.secretId, null);
});
test('组合切换也只允许两个字段，拒绝跨来源与非法模式', () => {
  assert.deepEqual(planApiSwitch(settings, profile, 'both').patch, { custom_url: profile.connection.custom_url, custom_model: 'new-model' });
  assert.throws(() => planApiSwitch({ ...settings, chat_completion_source: 'claude' }, profile, 'both'));
  assert.throws(() => planApiSwitch(settings, profile, 'preset'));
});
test('导入旧脚本只读取方案数据，不携带脚本、明文密钥、预设或正则', () => {
  const [result] = importApiProfiles({ content: 'throw Error("must not execute")', data: { apiQuickSwitcher: { schemes: [{ ...profile, secret: 'private', snapshot: { presetName: '不要切换' }, connection: { ...profile.connection, prompts: '不应写入' } }] } } });
  assert.notEqual(result.id, profile.id); assert.equal(result.secretId, profile.secretId);
  assert.equal(result.snapshot, undefined); assert.equal(result.secret, undefined); assert.deepEqual(result.connection, profile.connection);
});
test('无效导入整批拒绝，URL 不接受脚本协议及内嵌凭据', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com?key=private']) assert.throws(() => normalizeApiProfile({ ...profile, connection: { custom_url: url } }));
  assert.throws(() => importApiProfiles({ profiles: [profile, { ...profile, source: 'unknown' }] }));
});

const native = {id:'native-a',name:'原生方案',mode:'cc',api:'custom','api-url':'https://relay.example/v1',model:'【中转】模型','secret-id':'key-a',preset:'不要导入','reasoning-template':'不要导入',exclude:[]};
test('原生方案只提取连接白名单，不修改原配置', () => {
  const before=structuredClone(native), [entry]=readNativeApiProfiles([native],[{id:'key-a'}]);
  assert.equal(entry.error,undefined); assert.equal(entry.profile.model,native.model);
  assert.equal(entry.profile.secretId,'key-a'); assert.equal(entry.profile.connection.custom_url,native['api-url']);
  assert.deepEqual(Object.keys(entry.profile).sort(),['id','name','source','model','connection','secretId','updatedAt'].sort());
  assert.deepEqual(native,before); assert.notEqual(entry.profile.id,native.id);
});
test('原生缺字段、排除字段、其他来源及失效密钥逐项给出原因', () => {
  for (const patch of [{mode:'tc'},{api:'openai'},{'api-url':''},{model:''},{'secret-id':undefined},{'secret-id':'missing'},{exclude:['model']},{exclude:['secret-id']},{id:''}]) {
    const [entry]=readNativeApiProfiles([{...native,...patch}],[{id:'key-a'}]);
    assert.ok(entry.error); assert.equal(entry.profile,undefined);
  }
  assert.deepEqual(readNativeApiProfiles([] ,[]),[]);
  assert.ok(readNativeApiProfiles([native,native],[{id:'key-a'}]).every(x=>x.error));
});

test('附加参数按方案保存和切换，模型单切及旧方案保留当前参数',()=>{
 const additional={custom_include_body:'top_k: 20\n',custom_exclude_body:'- frequency_penalty',custom_include_headers:'X-Route: relay'};
 const input={...profile,additional};const normalized=normalizeApiProfile(input);
 assert.deepEqual(normalized.additional,additional);assert.notEqual(normalized.additional,additional);
 assert.deepEqual(planApiSwitch(settings,input,'both').patch,{custom_url:profile.connection.custom_url,custom_model:profile.model,...additional});
 assert.deepEqual(planApiSwitch(settings,input,'model').patch,{custom_model:profile.model});
 assert.equal(Object.hasOwn(planApiSwitch(settings,profile,'both').patch,'custom_include_body'),false);
 assert.equal(planApiSwitch(settings,{...profile,additional:{}},'both').patch.custom_include_headers,'');
});

test('时间戳只接受有限值，空数组 id 不能绕过兜底',()=>{
 for(const updatedAt of [Infinity,-Infinity,NaN,'abc',undefined]){
 const {updatedAt:stamp}=normalizeApiProfile({...profile,updatedAt});
 assert.ok(Number.isFinite(stamp),`${String(updatedAt)} 应回落到当前时间`);
 }
 assert.equal(normalizeApiProfile({...profile,updatedAt:1234}).updatedAt,1234);
 assert.equal(normalizeApiProfile({...profile,updatedAt:'1234'}).updatedAt,1234);
 assert.ok(normalizeApiProfile({...profile,id:[]}).id.length>0);
 const [imported]=importApiProfiles({profiles:[{...profile,updatedAt:Infinity}]});
 assert.ok(Number.isFinite(imported.updatedAt));
});
