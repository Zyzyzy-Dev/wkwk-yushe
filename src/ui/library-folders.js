// 快照／API 的列表内分组模式、归组弹窗和组标题操作；选中状态不写入宿主。
import {createIdentifier} from '../features/preset/core.js';
import {moveLibraryItems,validateLibraryFolders} from '../shared/library-folders.js';
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const button=(label,action)=>{const b=node('button','',label);b.type='button';b.addEventListener('click',action);return b;};
const copy=v=>JSON.parse(JSON.stringify(v));
const icon=(label,path,action)=>{
  const b=button('',action);b.className='pcm-api-icon';b.title=label;b.setAttribute('aria-label',label);
  b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
  return b;
};
export function folderCardTargets(list,folders,visible,folded,filtering,activeIds=[],actions){
  if(!folders?.length)return ()=>list;
  const targets=new Map(),assigned=new Map(folders.flatMap(f=>f.items.map(id=>[id,f.id]))),active=new Set(activeIds);
  const visibleByFolder=new Map();
  for(const item of visible){const id=assigned.get(item.id)||'';if(!visibleByFolder.has(id))visibleByFolder.set(id,[]);visibleByFolder.get(id).push(item);}
  for(const f of [...folders,{id:'',name:'未分组'}]){
    const entries=visibleByFolder.get(f.id)||[];
    if(!entries.length&&(filtering||!f.id))continue;
    const wrap=node('section','pcm-library-folder'),head=node('header','pcm-library-folder-heading'),body=node('div','pcm-library-folder-body');
    const toggle=button('',()=>{if(!filtering){if(folded.has(f.id))folded.delete(f.id);else folded.add(f.id);}setOpen(body.hidden);});
    function setOpen(open){body.hidden=!open;toggle.setAttribute('aria-expanded',String(open));}
    toggle.className='pcm-library-folder-head';toggle.append(node('strong','',f.name),node('small','',entries.length+' 项'));
    if(entries.some(e=>active.has(e.id)))toggle.append(node('small','pcm-api-active-badge','含已启用方案'));
    head.append(toggle);
    if(f.id&&actions){
      const tools=node('span','pcm-library-folder-actions');
      tools.append(icon('重命名分组','m14 5 5 5 M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z',()=>actions.rename(f.id)),
        icon('删除分组','M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',()=>actions.remove(f.id)));
      head.append(tools);
    }
    setOpen(filtering||!folded.has(f.id));wrap.append(head,body);list.append(wrap);
    if(!entries.length)body.append(node('small','pcm-library-folder-empty','空分组'));
    for(const item of entries)targets.set(item.id,body);
  }
  return id=>targets.get(id)||list;
}

export function createLibraryGrouping({parent,toolbar,list,label,read,isBusy,render,onSave,onRemove}){
  let mode=false,working=false,disposed=false,dialogClose=null;
  const selected=new Set(),toggle=button('分组',()=>{
    if(blocked())return;mode=!mode;selected.clear();render();toggle.focus({preventScroll:true});
  }),save=button('保存分组',openSave),count=node('small','pcm-library-selection-count');
  toggle.className='pcm-library-mode';save.className='pcm-library-save';count.setAttribute('role','status');
  toolbar.append(toggle,save,count);
  const blocked=()=>disposed||working||isBusy()||!read();
  function update(){
    const data=read(),available=new Set(data?.items.map(i=>i.id)||[]);
    for(const id of selected)if(!available.has(id))selected.delete(id);
    parent.classList.toggle('pcm-library-selecting',mode);
    toggle.setAttribute('aria-pressed',String(mode));toggle.disabled=blocked();
    save.hidden=count.hidden=!mode;save.disabled=blocked()||!selected.size;
    const shown=new Set([...list.querySelectorAll('[data-library-item]')].map(e=>e.dataset.libraryItem));
    const hidden=[...selected].filter(id=>!shown.has(id)).length;
    count.textContent='已选 '+selected.size+' 项'+(hidden?'（含筛选外 '+hidden+' 项）':'');
    for(const card of list.querySelectorAll('[data-library-item]')){
      const chosen=selected.has(card.dataset.libraryItem);card.classList.toggle('is-group-selected',mode&&chosen);
      if(mode){card.setAttribute('role','checkbox');card.setAttribute('aria-checked',String(chosen));card.tabIndex=0;
        for(const b of card.querySelectorAll('button'))b.disabled=true;
      }else{card.removeAttribute('role');card.removeAttribute('aria-checked');card.removeAttribute('tabindex');}
    }
  }
  function select(event){
    if(!mode)return;
    const card=event.target.closest?.('[data-library-item]');if(!card||!list.contains(card))return;
    if(event.type==='keydown'&&(event.target!==card||!['Enter',' '].includes(event.key)))return;
    event.preventDefault();event.stopImmediatePropagation();if(blocked())return;
    const id=card.dataset.libraryItem;if(selected.has(id))selected.delete(id);else selected.add(id);
    update();card.focus({preventScroll:true});
  }
  list.addEventListener('click',select,true);list.addEventListener('keydown',select,true);
  function dialog(title,build){
    if(blocked()||dialogClose)return;
    const el=node('dialog','pcm-api-modal pcm-library-dialog'),box=node('div','pcm-library-dialog-box'),status=node('p','pcm-snapshot-status'),footer=node('div','pcm-library-tools');
    el.setAttribute('aria-label',title);status.setAttribute('role','status');box.append(node('h3','',title));el.append(box);parent.append(el);
    const opener=document.activeElement,outer=parent.closest('dialog');let saving=false;
    const close=(force=false)=>{if(saving&&!force)return;if(el.open)el.close();el.remove();dialogClose=null;outer?.removeEventListener('close',outerClose);if(!disposed)(opener?.isConnected?opener:toggle).focus({preventScroll:true});};
    const outerClose=e=>{if(e.target===outer)close(true);};outer?.addEventListener('close',outerClose);
    dialogClose=()=>close(true);
    function action(label,task,danger=false){
      const b=button(label,async()=>{
        if(saving||disposed)return;
        saving=working=true;update();for(const input of box.querySelectorAll('button,input,select'))input.disabled=true;status.textContent='正在保存…';
        try{await task();if(!disposed)render();saving=working=false;close();if(!disposed)update();}
        catch(error){saving=working=false;if(!disposed&&el.isConnected){for(const input of box.querySelectorAll('button,input,select'))input.disabled=false;status.textContent=error.message||'保存失败';sync?.();update();}}
      });
      if(danger)b.className='pcm-library-danger';footer.append(b);return b;
    }
    footer.append(button('取消',()=>close()));
    const sync=build({box,action,status});box.append(status,footer);
    el.addEventListener('cancel',e=>{e.preventDefault();close();});el.showModal();
    (box.querySelector('input')||footer.firstElementChild).focus();sync?.();
  }
  function openSave(){
    if(blocked()||!selected.size)return;
    const data=read(),expected=copy(data.folders||[]),items=data.items.map(i=>({id:i.id,name:i.name})),ids=[...selected];
    dialog('保存分组',({box,action})=>{
      let joining=false;
      const choices=node('div','pcm-library-tools'),name=node('input'),target=node('select');
      name.setAttribute('aria-label','分组名称');name.placeholder='输入新分组名称';name.maxLength=80;
      target.setAttribute('aria-label','已有分组');for(const f of expected){const o=node('option','',f.name);o.value=f.id;target.append(o);}
      const fresh=button('新建分组',()=>{joining=false;sync();name.focus();}),existing=button('加入已有分组',()=>{joining=true;sync();target.focus();});
      choices.append(fresh,existing);box.append(node('p','','将所选 '+ids.length+' 个'+label+'保存到：'),choices,name,target);
      action('保存分组',async()=>{
        if(joining&&!expected.length)throw Error('暂无已有分组，请先新建分组');
        const id=joining?target.value:createIdentifier();
        const draft=moveLibraryItems(joining?expected:[...expected,{id,name:name.value,items:[]}],ids,id);
        const folders=validateLibraryFolders(expected,expected,draft,items);await onSave({expected,folders});selected.clear();
      });
      function sync(){fresh.setAttribute('aria-pressed',String(!joining));existing.setAttribute('aria-pressed',String(joining));existing.disabled=!expected.length;name.hidden=joining;target.hidden=!joining;}
      return sync;
    });
  }
  function rename(id){
    if(blocked())return;const expected=copy(read().folders||[]),f=expected.find(f=>f.id===id);if(!f)return;
    const items=read().items.map(i=>({id:i.id}));
    dialog('重命名分组',({box,action})=>{
      const name=node('input');name.value=f.name;name.maxLength=80;name.setAttribute('aria-label','分组名称');box.append(name);
      action('保存',async()=>{const folders=validateLibraryFolders(expected,expected,expected.map(g=>g.id===id?{...g,name:name.value}:g),items);await onSave({expected,folders});});
    });
  }
  function remove(id){
    if(blocked())return;const data=read(),expected=copy(data.folders||[]),f=expected.find(f=>f.id===id);if(!f)return;
    const expectedItems=copy(f.items.map(id=>data.items.find(i=>i.id===id)));
    dialog('删除分组',({box,action})=>{
      box.append(node('p','','如何处理分组「'+f.name+'」？组中共有 '+f.items.length+' 个'+label+'（包含筛选隐藏的方案）。'),
        node('p','','解除分组：保留方案和绑定，移到未分组。'),
        node('p','','删除分组及组中方案：删除这些已保存方案，相关绑定将解除或失效。'));
      action('解除分组',()=>onRemove({id,expected,deleteItems:false}));
      action('删除分组及组中方案',()=>onRemove({id,expected,deleteItems:true,expectedItems}),true);
    });
  }
  update();
  return {update,actions:{rename,remove},decorate(card,item){card.dataset.libraryItem=item.id;card.setAttribute('aria-label',item.name);},
    destroy(){disposed=true;dialogClose?.();list.removeEventListener('click',select,true);list.removeEventListener('keydown',select,true);}};
}
