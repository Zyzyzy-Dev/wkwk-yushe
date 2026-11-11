// 首页预设编辑设置：三个紧凑分区，滑动开关与快捷入口高亮按钮逐项保存，失败保留原状态。
import {normalizeEditorPreferences} from '../editor-preferences.js';

export function openEditorSettings({parent,host,onPreferences}) {
  if(parent.querySelector('.pcm-editor-settings'))return;
  const doc=parent.ownerDocument,previous=doc.activeElement;
  const modal=doc.createElement('dialog');modal.className='pcm-modal pcm-editor-settings';modal.setAttribute('aria-label','预设编辑设置');
  modal.innerHTML=`<div class="pcm-modal-box"><header><h2>预设编辑设置</h2><button type="button" class="menu_button" data-settings-close aria-label="关闭设置">×</button></header>
    <div class="pcm-editor-settings-options">
      <div class="pcm-editor-setting"><div class="pcm-editor-setting-row"><span id="pcm-collapse-setting-label">导入预设时，预设分组默认折叠</span><button type="button" class="pcm-setting-switch" role="switch" aria-checked="false" aria-labelledby="pcm-collapse-setting-label" data-editor-preference="collapseGroups"><span></span></button></div></div>
      <div class="pcm-editor-setting"><div>开启预设编辑快捷入口：</div><div class="pcm-editor-shortcuts"><button type="button" class="pcm-api-entry-toggle" aria-pressed="false" data-editor-preference="floating">悬浮球</button><button type="button" class="pcm-api-entry-toggle" aria-pressed="false" data-editor-preference="quickReply">快速回复</button></div></div>
      <div class="pcm-editor-setting"><div class="pcm-editor-setting-row"><span id="pcm-creator-setting-label">创作者模式</span><button type="button" class="pcm-setting-switch" role="switch" aria-checked="false" aria-labelledby="pcm-creator-setting-label" aria-describedby="pcm-creator-setting-description" data-editor-preference="creatorMode"><span></span></button></div><small id="pcm-creator-setting-description">开启后在预设条目正文中选中文字后会显示符号工具栏，可以快捷添加对应符号</small></div>
    </div><p class="pcm-editor-settings-status" role="status">正在读取设置…</p></div>`;
  const status=modal.querySelector('[role=status]'),controls=[...modal.querySelectorAll('[data-editor-preference]')];
  let preferences=normalizeEditorPreferences(),closed=false;
  function render(busy=false){for(const button of controls){const value=preferences[button.dataset.editorPreference];button.disabled=busy;button.setAttribute(button.getAttribute('role')==='switch'?'aria-checked':'aria-pressed',String(value));}}
  const finish=()=>{if(closed)return;closed=true;parent.removeEventListener('close',finish);modal.close();modal.remove();if(previous?.isConnected)previous.focus({preventScroll:true});};
  for(const button of controls)button.addEventListener('click',async()=>{
    const key=button.dataset.editorPreference;render(true);status.textContent='正在保存…';
    try{preferences=normalizeEditorPreferences(await host.request('preset-editor-preferences',{[key]:!preferences[key]}));onPreferences(preferences);if(!closed)status.textContent='';}
    catch(error){if(!closed)status.textContent='保存失败：'+error.message;}
    finally{if(!closed)render();}
  });
  render(true);
  modal.querySelector('[data-settings-close]').addEventListener('click',finish);
  modal.addEventListener('click',event=>event.stopPropagation());
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish();}});
  modal.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish();});
  modal.addEventListener('close',finish);parent.addEventListener('close',finish);parent.append(modal);modal.showModal();
  void host.request('preset-editor-preferences').then(value=>{if(closed)return;preferences=normalizeEditorPreferences(value);onPreferences(preferences);render();status.textContent='';})
    .catch(error=>{if(!closed)status.textContent='读取失败：'+error.message+'。请关闭后重试。';});
}
