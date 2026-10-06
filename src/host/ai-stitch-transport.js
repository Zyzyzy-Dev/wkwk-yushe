// AI 缝合的独立请求与新建事务；不读取密钥明文，不修改活动连接。
import { clone, equalValues } from '../features/preset/core.js';
const canonical = name => String(name).normalize('NFC').replace(/\.json$/i,'').toLocaleLowerCase();
export function registerCreatedPreset(presets,names,name,preset){
 let index=Array.isArray(names)?names.indexOf(name):Object.hasOwn(names,name)?Number(names[name]):-1;
 if(index<0){index=presets.length;presets.push(clone(preset));if(Array.isArray(names))names.push(name);else Object.defineProperty(names,name,{value:index,writable:true,configurable:true,enumerable:true});}
 else presets[index]=clone(preset);
 return index;
}
export function validateNewName(name, originalName, names) {
 if(typeof name!=='string'||!name.trim()||name!==name.trim()||new TextEncoder().encode(name).length>200||/[<>:"/\\|?*\x00-\x1f\x80-\x9f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw Error('新预设名称包含不安全字符或过长');
 if(canonical(name)===canonical(originalName))throw Error('禁止覆盖原主预设');
 if(names.some(n=>canonical(n)===canonical(name)))throw Error('名称已存在，请使用递增后缀或新名称');
}
export function buildIndependentRequest(config, messages, parseYaml=JSON.parse) {
 const {source,model,secretId}=config;
 if(!['custom','openai','openrouter'].includes(source))throw Error('此连接来源尚未验证独立调用；请使用 custom、OpenAI 或 OpenRouter');
 if(!model||!secretId)throw Error('连接缺少模型或密钥引用');
 const body={chat_completion_source:source,model,secret_id:secretId,messages:clone(messages),stream:false,max_tokens:6000,temperature:0.2};
 if(source==='custom')body.custom_url=config.connection.custom_url;
 for(const [key,value] of Object.entries(config.additional||{})) {
  if(value===null||value===undefined||value==='')continue;
  if(typeof value!=='string')throw Error('附加参数结构无效');
  if(!value.trim())continue;
  let parsed;try{parsed=parseYaml(value);}catch{throw Error('附加参数无法解析，请检查 YAML');}
  const forbidden=new Set(['messages','model','stream','max_tokens','max_completion_tokens','prompt','tools','tool_choice','functions','function_call','n','secret_id','chat_completion_source','custom_url','reverse_proxy','proxy_password','__proto__','constructor','prototype']);
  const fields=key==='custom_exclude_body'?parsed:Object.keys(parsed||{});
  if(!Array.isArray(fields)||!parsed||typeof parsed!=='object'||(key!=='custom_exclude_body'&&Array.isArray(parsed)))throw Error('附加参数结构无效');
  if(fields.some(k=>typeof k!=='string'||forbidden.has(k)||key==='custom_include_headers'&&/authorization|api[-_]key|cookie|host/i.test(k)))throw Error('附加参数与独立请求的消息、模型、输出上限或认证约束冲突');
  body[key]=value;
 }
 return body;
}
export function createOnlyStore({read,write,sync}) {
 const jobs=new Map();let tail=Promise.resolve();
 async function verify(id) {
  const job=jobs.get(id);if(!job)throw Error('没有待核验保存');
  let entries;
  try{entries=await read();}catch(error){throw Error('保存状态待核验：读取预设列表失败（'+(error.message||error.name||'未知读取错误')+'）；请只读复查。');}
  const entry=entries.find(([name])=>name===job.name);
  if(!entry)throw Error('保存状态待核验：磁盘列表尚未找到新预设'+(job.writeError?'；写入请求报告：'+job.writeError:'')+'。请只读复查，勿换名称重复保存。');
  if(!equalValues(entry[1],job.preset))throw Error('保存状态待核验：已找到新预设，但读回内容与提交内容不一致；未覆盖文件。');
  try{await sync(job.name,clone(entry[1]));}catch(error){throw Error('新预设已写入且内容核验通过，但同步原生列表失败（'+(error.message||error.name||'未知同步错误')+'）；只读复查可重试同步，不会再次写入。');}
  job.result={name:job.name};return {name:job.name,preset:clone(job.preset)};
 }
 async function run(args) {
  const existing=jobs.get(args.id);if(existing){if(existing.name!==args.name||!equalValues(existing.preset,args.preset))throw Error('保存事务已固定，必须先核验原事务');return existing.result?{name:existing.name,preset:clone(existing.preset)}:verify(args.id);}
  try{const disk=await read();validateNewName(args.name,args.originalName,disk.map(([n])=>n));}catch(error){error.name='StitchNotWritten';throw error;}
  jobs.set(args.id,{name:args.name,preset:clone(args.preset)});
  try{await write(args.name,clone(args.preset));}catch(error){jobs.get(args.id).writeError=error.message||error.name||'未知写入错误';/* May have committed. Never blindly retry a write. */}
  return verify(args.id);
 }
 return {create(args){const next=tail.then(()=>run(args));tail=next.catch(()=>{});return next;},verify};
}

// 手动连接覆盖只作用于当前请求；密钥通过宿主 custom 请求头发送，不写密钥库。
export function applyStitchOverrides(body,overrides={},parseYaml=JSON.parse){
 const result=clone(body),url=overrides.url,key=overrides.key;
 if(url===undefined&&key===undefined)return result;
 if(body.chat_completion_source!=='custom')throw Error('临时URL/密钥编辑目前仅支持custom兼容接口；请选择custom方案，未修改原连接');
 if(url!==undefined){let parsed;try{parsed=new URL(url);}catch{throw Error('请输入完整的http或https URL');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('URL必须为http或https，且不能包含登录凭据');result.custom_url=url;}
 if(key!==undefined){if(typeof key!=='string'||!key.trim()||/[\r\n\0]/.test(key))throw Error('临时密钥不能为空或包含换行');const headers=body.custom_include_headers?parseYaml(body.custom_include_headers):{};result.custom_include_headers=JSON.stringify({...headers,Authorization:'Bearer '+key});}
 return result;
}
