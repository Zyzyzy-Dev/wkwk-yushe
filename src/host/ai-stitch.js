// AI 缝合宿主适配：请求级密钥引用、独立消息、有限取消任务及读盘核验新建。
import {API_STORE_KEY,normalizeApiProfile,maskApiSecret} from '../features/api/api-manager.js';
import {clone} from '../features/preset/core.js';
import {createStitchDeadline,stitchAbortMessage} from '../features/preset/ai-stitch/timeout.js';
import {makeStitchInput,stitchContext,STITCH_INSTRUCTIONS,parseStitchResponse,assembleStitch} from '../features/preset/ai-stitch/core.js';
import {applyStitchOverrides,buildIndependentRequest,createOnlyStore,registerCreatedPreset} from './ai-stitch-transport.js';
const tasks=new Map(),profileVersions=new Map();let store;
async function env(){const [openai,script,extensions,lib]=await Promise.all([import('/scripts/openai.js'),import('/script.js'),import('/scripts/extensions.js'),import('/lib.js')]);return {openai,script,extensions,lib};}
async function json(url,body,script,signal){
 const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:script.getRequestHeaders(),...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`酒馆接口请求失败（${response.status}）`);
 return response.json();
}
async function connection(profileId,e){
 const version=await json('/version',undefined,e.script);
 // Only claim the upstream contract actually inspected. Derivative backends need a separate adapter.
 const match=/^1\.(\d+)\./.exec(String(version.pkgVersion||''));
 if(!match||Number(match[1])<18||version.agent&&!String(version.agent).includes('SillyTavern'))throw Error('独立密钥调用需要已核验的普通 ST 1.18+ 接口；此宿主/TT 尚未验证，未切换连接');
 let config;
 if(profileId){const profile=e.extensions.extension_settings[API_STORE_KEY]?.profiles?.find(p=>p.id===profileId);if(!profile)throw Error('API方案已删除');if(profileVersions.get(profileId)!==JSON.stringify(profile))throw Error('API方案已被修改，请重新打开面板核对后生成');config=normalizeApiProfile(clone(profile));}
 else {
  if(e.script.main_api!=='openai')throw Error('当前连接不是聊天补全；未切换到其他连接');
  const s=clone(e.openai.oai_settings),source=s.chat_completion_source;
  if(s.reverse_proxy)throw Error('当前反向代理凭据路径未验证，请选择已有 custom 方案');
  config={source,model:s[{custom:'custom_model',openai:'openai_model',openrouter:'openrouter_model'}[source]],connection:{custom_url:s.custom_url},additional:source==='custom'?{custom_include_body:s.custom_include_body,custom_exclude_body:s.custom_exclude_body,custom_include_headers:s.custom_include_headers}:{}};
 }
 const key={custom:'api_key_custom',openai:'api_key_openai',openrouter:'api_key_openrouter'}[config.source];if(!key)throw Error('此 provider 尚未验证独立请求；未自动更换模型');
 const keys=await json('/api/secrets/read',{},e.script);
 const list=keys[key];if(!Array.isArray(list))throw Error('当前后端未提供多密钥引用接口');
 config.secretId=profileId?config.secretId:list.find(k=>k.active)?.id;
 if(!config.secretId||!list.some(k=>k.id===config.secretId))throw Error('方案密钥不存在或当前连接没有活动密钥；未使用其他密钥');
 config.maskedSecret=maskApiSecret(list.find(k=>k.id===config.secretId).value);
 return config;
}
async function disk(e){const data=await json('/api/settings/get',{},e.script);if(!Array.isArray(data.openai_setting_names)||!Array.isArray(data.openai_settings)||data.openai_setting_names.length!==data.openai_settings.length)throw Error('宿主预设读盘接口格式未验证');return data.openai_setting_names.map((n,i)=>[n,typeof data.openai_settings[i]==='string'?JSON.parse(data.openai_settings[i]):data.openai_settings[i]]);}
async function persistence(e){
 if(store)return store;
 const {getPresetManager}=await import('/scripts/preset-manager.js'),manager=getPresetManager('openai');
 if(!manager)throw Error('宿主没有预设管理接口');
 store=createOnlyStore({read:()=>disk(e),write:async(name,preset)=>{const result=await json('/api/presets/save',{name,preset,apiId:'openai'},e.script);if(result.name!==name)throw Error('服务端改变了保存名称');},sync:(name,preset)=>{
  const select=document.querySelector('#settings_preset_openai');if(!select)throw Error('无法同步原生预设列表');
  const selected=select.value,{presets,preset_names}=manager.getPresetList();
  const index=registerCreatedPreset(presets,preset_names,name,preset);
  if(![...select.options].some(o=>o.textContent===name))select.add(new Option(name,String(index),false,false));select.value=selected;
 }});return store;
}
export async function handleAiStitch(method,payload={}){
 if(method==='ai-stitch-cancel'){tasks.get(payload.id)?.abort();return true;}
 const e=await env();
 if(method==='ai-stitch-presets')return Array.isArray(e.openai.openai_setting_names)?[...e.openai.openai_setting_names]:Object.keys(e.openai.openai_setting_names||{});
 if(method==='ai-stitch-connections')return [{id:'',name:'酒馆当前连接'},...(e.extensions.extension_settings[API_STORE_KEY]?.profiles||[]).map(p=>{profileVersions.set(p.id,JSON.stringify(p));return {id:p.id,name:p.name};})];
 if(method==='ai-stitch-connection'||method==='ai-stitch-models'){
  const config=await connection(payload.profileId,e);
  if(method==='ai-stitch-connection')return {url:config.connection.custom_url||({openai:'https://api.openai.com/v1',openrouter:'https://openrouter.ai/api/v1'}[config.source]),maskedSecret:config.maskedSecret,model:config.model};
  const body=applyStitchOverrides(buildIndependentRequest(config,[],s=>e.lib.yaml.parse(s)),payload.overrides,s=>e.lib.yaml.parse(s));
  const response=await json('/api/backends/chat-completions/status',{chat_completion_source:body.chat_completion_source,custom_url:body.custom_url,secret_id:body.secret_id,custom_include_headers:body.custom_include_headers},e.script);
  const models=response.data??response.models;
  if(response.error||!Array.isArray(models))throw Error('未取得模型列表，请重试或手动填写模型名称');
  return [...new Set(models.map(m=>typeof m==='string'?m:m?.id).filter(m=>typeof m==='string'&&m.length>0&&m.length<=500))].sort();
 }
 if(method==='ai-stitch-verify')return (await persistence(e)).verify(payload.id);
 if(method==='ai-stitch-create'){
  const input=makeStitchInput(payload.input.baseline,payload.input.sources,payload.input.guidance,payload.input.sessionId,payload.input.revision);
  const result=assembleStitch(input,payload.plan,new Set(payload.excluded||[]),{approvals:new Map(payload.approvals||[])});
  return (await persistence(e)).create({id:payload.id,name:payload.name,originalName:payload.originalName,preset:result.preset});
 }
 if(method==='ai-stitch-generate'){
  if(tasks.has(payload.id))throw Error('生成任务已存在');
  const deadline=createStitchDeadline(payload.timeoutMinutes),{controller}=deadline;tasks.set(payload.id,controller);
  try{
   const input=makeStitchInput(payload.input.baseline,payload.input.sources,payload.input.guidance,payload.input.sessionId,payload.input.revision);
   const config=await connection(payload.profileId,e);if(controller.signal.aborted)throw Error('已取消生成');
   if(payload.model!==undefined){if(typeof payload.model!=='string'||!payload.model.trim()||payload.model.length>500||/[\r\n\0]/.test(payload.model))throw Error('请输入有效模型名称');config.model=payload.model.trim();}
   const body=applyStitchOverrides(buildIndependentRequest(config,[{role:'system',content:STITCH_INSTRUCTIONS},{role:'user',content:JSON.stringify(stitchContext(input))}],s=>e.lib.yaml.parse(s)),payload.overrides,s=>e.lib.yaml.parse(s));
   const outputTokens=payload.outputTokens??16384;if(!Number.isInteger(outputTokens)||outputTokens<1024||outputTokens>131072)throw Error('输出上限必须为1024–131072之间的整数tokens');body.max_tokens=outputTokens;
   const response=await json('/api/backends/chat-completions/generate',body,e.script,controller.signal);
   if(controller.signal.aborted)throw Error('已取消生成');
   const choice=response.choices?.[0];if(!choice||choice.finish_reason==='length'||choice.finish_reason==='content_filter')throw Error('模型输出截断或被过滤；请检查输出上限或减少本次材料后重新生成，未保存不完整正文');
   return parseStitchResponse(choice.message?.content,2);
  }catch(error){if(controller.signal.aborted)throw Error(stitchAbortMessage(controller.signal));throw error;}
  finally{deadline.dispose();tasks.delete(payload.id);}
 }
 throw Error('未知AI缝合请求');
}
