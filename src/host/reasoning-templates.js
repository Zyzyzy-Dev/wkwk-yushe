// 推理模板管理：先核对服务器副本，再保存/删除；同步真实模板列表但不应用草稿中的格式与开关。
import {readSnapshotReasoning} from './snapshot-reasoning.js';

const fields=['name','prefix','suffix','separator'];
const template=value=>{
  if(!value || fields.some(key=>typeof value[key]!=='string'))throw new Error('推理模板数据无效');
  return Object.fromEntries(fields.map(key=>[key,value[key]]));
};
const equivalent=(a,b)=>fields.every(key=>a?.[key]===b?.[key]);
const folded=name=>name.normalize('NFC').toLocaleLowerCase();
export function validateReasoningTemplateName(value){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>120||new TextEncoder().encode(value).length>250||new TextDecoder().decode(new TextEncoder().encode(value))!==value||/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/.test(value)||/[. ]$/.test(value)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value))throw new Error('模板名称过长或含文件名特殊字符，请使用较短的普通名称');
  return value;
}
export async function manageReasoningTemplate(payload, getHeaders, persistCurrent) {
  if(!['overwrite','saveAs','rename','delete'].includes(payload.action))throw new Error('未知的推理模板操作');
  if(typeof getHeaders!=='function')throw new Error('酒馆未提供模板保存接口');
  const [{reasoning_templates}, {power_user}, managers]=await Promise.all([import('/scripts/reasoning.js'),import('/scripts/power-user.js'),import('/scripts/preset-manager.js')]);
  if(!Array.isArray(reasoning_templates))throw new Error('推理模板列表尚未就绪');
  const select=managers.getPresetManager?.('reasoning')?.select?.[0]||document.getElementById('reasoning_select');
  async function request(url,body,json=true){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
    try{
      const response=await fetch(url,{method:'POST',headers:getHeaders(),body:JSON.stringify(body),cache:'no-cache',signal:abort.signal});
      if(!response.ok)throw new Error('推理模板操作失败（HTTP '+response.status+'）');
      return json?await response.json():null;
    }finally{clearTimeout(timer);}
  }
  async function read(){
    const data=await request('/api/settings/get',{});
    if(!Array.isArray(data.reasoning))throw new Error('酒馆未返回可核验的推理模板列表，请在酒馆设置中管理模板');
    const rows=data.reasoning.map(item=>typeof item==='string'?JSON.parse(item):item).map(template);
    if(new Set(rows.map(row=>folded(row.name))).size!==rows.length)throw new Error('推理模板存在重名，请先在酒馆中处理');
    return rows;
  }
  async function synchronize(rows,renameFrom,renameTo){
    reasoning_templates.splice(0,reasoning_templates.length,...rows);
    const before=power_user.reasoning.name;
    if(renameFrom===before && rows.some(row=>row.name===renameTo))power_user.reasoning.name=renameTo;
    if(!rows.some(row=>row.name===power_user.reasoning.name))power_user.reasoning.name=rows[0]?.name||'';
    if(select){
      select.replaceChildren(...rows.map(row=>{const option=document.createElement('option');option.value=row.name;option.textContent=row.name;return option;}));
      select.value=power_user.reasoning.name;
    }
    // Only the active template name can change on rename/delete; preserve its actual format and switches.
    if(before!==power_user.reasoning.name)await persistCurrent();
  }
  const before=await read(),action=payload.action;
  const expected=action==='saveAs'?null:template(payload.expected);
  const source=expected&&before.find(row=>row.name===expected.name);
  if(expected&&!equivalent(source,expected)){
    await synchronize(before);
    throw new Error('模板已被修改或删除，请重新打开快照编辑页后操作');
  }
  if(source)validateReasoningTemplateName(source.name);
  const name=action==='delete'?source.name:validateReasoningTemplateName(action==='overwrite'?source.name:payload.name);
  if(['saveAs','rename'].includes(action)&&before.some(row=>folded(row.name)===folded(name)))throw new Error('已有同名推理模板，请换一个名称');
  const next=action==='delete'?null:template({...((action==='rename')?source:payload.template),name});
  let wrote=false,renamed=false;
  try{
    if(next){
      wrote=true;
      const result=await request('/api/presets/save',{apiId:'reasoning',name,preset:next});
      if(result.name!==name)throw new Error('酒馆调整了模板名称，请刷新后核对');
      const saved=await read();
      if(!equivalent(saved.find(row=>row.name===name),next))throw new Error('未能确认模板保存成功，请刷新后核对');
      if(action==='rename'){
        if(!equivalent(saved.find(row=>row.name===source.name),source))throw new Error('新名称已保存，但原模板发生变化，已保留原模板');
        await request('/api/presets/delete',{apiId:'reasoning',name:source.name},false);renamed=true;
      }
    }else{wrote=true;await request('/api/presets/delete',{apiId:'reasoning',name:source.name},false);}
    const after=await read();
    if((action==='delete'||action==='rename')&&after.some(row=>row.name===source.name))throw new Error('未能确认原模板删除成功，请刷新后核对');
    if(next&&!equivalent(after.find(row=>row.name===name),next))throw new Error('模板保存结果已变化，请刷新后核对');
    await synchronize(after,renamed?source.name:undefined,renamed?name:undefined);
    return {...await readSnapshotReasoning(),selectedName:next?.name||null};
  }catch(error){
    if(wrote){
      try{await synchronize(await read());}catch{/* Preserve the original failure; never retry a write. */}
      throw new Error('模板操作未完整完成，请刷新核对模板列表：'+error.message);
    }
    throw error;
  }
}
