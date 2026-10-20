// AI 缝合本地草稿操作：显式保存、目录选择恢复；替换输入前自动备份。
import {captureStitchDraft,restoreStitchDraft,createStitchDraftStore} from '../ai-stitch/drafts.js';
import {diagnosticLog} from '../../../shared/diagnostics.js';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const button=(text,fn)=>{const b=node('button',text);b.type='button';b.className='menu_button';b.addEventListener('click',fn);return b;};
export function createStitchDraftControls({session:s,isCurrent,askName,confirm,toast,onRestore,store=createStitchDraftStore()}){
 const element=node('div');element.className='pcm-ai-drafts';const status=node('small');status.setAttribute('role','status');let disposed=false,dialog=null,busy=false;
 const currentPage=()=>!disposed&&element.isConnected&&element.closest('dialog')?.open!==false&&!element.closest('.pcm-view-hidden,.pcm-hidden')&&isCurrent();
 const check=()=>{if(!currentPage())throw Error('主预设或页面已改变，请重新打开缝合页面');if(s.status==='generating'||s.status==='saving'||s.saveId)throw Error('请先结束当前任务并核验保存状态');};
 const run=async fn=>{if(busy)return;busy=true;save.disabled=restore.disabled=true;try{check();await fn();}catch(e){if(currentPage()){status.textContent='草稿操作未完成：'+(e.message||String(e));toast?.(status.textContent,'error');}}finally{busy=false;save.disabled=restore.disabled=false;}};
 const save=button('保存缝合草稿',()=>run(async()=>{
  const name=await askName('缝合草稿名称（保存在当前浏览器）',s.draftName||s.originalName+' · 缝合草稿');if(name===null)return;check();
  const finish=diagnosticLog.begin('ai-stitch-draft-save');try{const record=await captureStitchDraft(s,name);await store.put(record);s.draftId=record.id;s.draftName=record.name;
   if(!disposed)status.textContent='草稿已保存 · '+new Date(record.updatedAt).toLocaleTimeString();finish('success');
  }catch(error){finish('failed',error?.name);throw error;}
 }));
 const restore=button('恢复缝合草稿',()=>run(async()=>{
  const records=await store.list();check();dialog=node('dialog');dialog.className='pcm-stitch-draft-dialog';dialog.setAttribute('aria-label','恢复缝合草稿');const opened=dialog;
  const checkDialog=()=>{check();if(!opened.open)throw Error('恢复已取消');};
  const header=node('header'),list=node('div'),message=node('p');message.setAttribute('role','status');header.append(node('strong','缝合草稿'),button('关闭',()=>opened.close()));
  dialog.append(header,node('small','仅保存在当前浏览器；清理网站数据会删除草稿。恢复前会备份当前输入，方案需要重新核对。'),list,message);
  if(!records.length)list.append(node('p','还没有保存的缝合草稿。'));
  let acting=false;
  for(const record of records){const row=node('article'),title=node('strong',record.name),meta=node('small',(record.originalName||'主预设')+' · '+record.count+' 项材料 · '+new Date(record.updatedAt).toLocaleString()),actions=node('div');
   const load=button('恢复',async()=>{if(acting)return;acting=true;row.querySelectorAll('button').forEach(b=>b.disabled=true);const finish=diagnosticLog.begin('ai-stitch-draft-restore');try{
    checkDialog();const draft=await store.get(record.id);if(!draft)throw Error('草稿已被删除，请重新打开目录');checkDialog();
    if(s.sources.length||s.guidance||s.guidanceDraft||s.manualDrafts?.some(t=>t.trim())||Object.values(s.pickerState||{}).some(p=>p.selected?.size)){const backup=await captureStitchDraft(s,'恢复前备份 · '+new Date().toLocaleString());await store.put(backup);}
    checkDialog();const result=await restoreStitchDraft(draft,s,{isCurrent:()=>opened.open&&currentPage()});opened.close();finish('success');onRestore();toast?.(result.planRestored?'已恢复缝合草稿，请重新核对方案。':'已恢复材料和输入；请基于当前主预设重新生成方案。','success');
   }catch(e){finish('failed',e?.name);if(currentPage()&&opened.open)message.textContent='未恢复：'+(e.message||String(e));}finally{acting=false;row.querySelectorAll('button').forEach(b=>b.disabled=false);}});
   const remove=button('删除',async()=>{if(acting)return;acting=true;let finish;try{if(!await confirm('删除缝合草稿「'+record.name+'」？'))return;check();finish=diagnosticLog.begin('ai-stitch-draft-delete');await store.delete(record.id);row.remove();if(s.draftId===record.id){s.draftId=null;s.draftName='';}if(!list.children.length)list.append(node('p','还没有保存的缝合草稿。'));finish('success');}catch(e){finish?.('failed',e?.name);message.textContent='未删除：'+(e.message||String(e));}finally{acting=false;}});
   load.setAttribute('aria-label','恢复草稿 '+record.name);remove.setAttribute('aria-label','删除草稿 '+record.name);actions.append(load,remove);row.append(title,meta,actions);list.append(row);
  }
  opened.addEventListener('close',()=>{opened.remove();if(dialog===opened)dialog=null;},{once:true});(element.closest('.pcm-dialog')||document.body).append(opened);opened.showModal();
 }));
 element.append(save,restore,status);
 return {element,dispose(){disposed=true;dialog?.close();dialog?.remove();}};
}
