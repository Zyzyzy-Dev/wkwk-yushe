// 预设与世界书主题选择菜单：锚定控件、键盘选择、视口约束与事件清理。
export function createWorkbenchSelects(parent) {
  let opened=null,sequence=0;
  function close(restore=false){if(!opened)return;const {menu,anchor,controller}=opened;opened=null;controller.abort();menu.remove();anchor.setAttribute('aria-expanded','false');anchor.removeAttribute('aria-controls');if(restore&&anchor.isConnected)anchor.focus({preventScroll:true});}
  function create({className,label,value,choices,onChange,key,minWidth=230,formatValue}){
    const anchor=document.createElement('button');anchor.type='button';anchor.dataset.wbSelectKey=key;anchor.className=className+' pcm-wb-select';anchor.setAttribute('aria-label',label);anchor.setAttribute('aria-haspopup','listbox');anchor.setAttribute('aria-expanded','false');function display(){const full=choices.find(([key])=>key===value)?.[1]||value;anchor.textContent=formatValue?formatValue(value,full):full;anchor.title=full;if(formatValue)anchor.setAttribute('aria-label',label+'：'+full);}display();
    Object.defineProperty(anchor,'value',{get:()=>value,set:next=>{value=next;display();}});
    function open(){
      if(anchor.disabled)return;if(opened?.anchor===anchor){close(true);return;}close();
      const menu=document.createElement('div');menu.className='pcm-wb-select-menu';menu.id='pcm-wb-options-'+(++sequence);menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);
      const controller=new AbortController(),options={signal:controller.signal};opened={menu,anchor,controller};anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-controls',menu.id);
      let selected=Math.max(0,choices.findIndex(([key])=>key===value));const items=[];
      function focus(index){selected=(index+items.length)%items.length;items.forEach((item,i)=>item.tabIndex=i===selected?0:-1);items[selected].focus({preventScroll:true});items[selected].scrollIntoView({block:'nearest'});}
      function choose(index){const next=choices[index][0];close(true);if(next!==value){anchor.value=next;onChange(next);queueMicrotask(()=>{const replacement=[...parent.querySelectorAll('.pcm-wb-select')].find(item=>item.dataset.wbSelectKey===key);replacement?.focus({preventScroll:true});});}}
      choices.forEach(([key,text],index)=>{const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.setAttribute('aria-label',text);item.setAttribute('aria-selected',String(key===value));item.textContent=text;item.tabIndex=-1;item.addEventListener('click',event=>{event.stopPropagation();choose(index);});menu.append(item);items.push(item);});
      parent.append(menu);
      const r=anchor.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
      const headerBottom=parent.querySelector('.pcm-wb-header')?.getBoundingClientRect().bottom||top;
      const floor=Math.max(top+8,headerBottom+4),bottom=top+height-8,below=Math.max(0,bottom-r.bottom-5),above=Math.max(0,r.top-5-floor),down=below>=Math.min(260,choices.length*40)||below>=above;
      const menuWidth=Math.min(Math.max(r.width,minWidth),width-16),available=Math.max(40,down?below:above);
      Object.assign(menu.style,{width:menuWidth+'px',maxHeight:Math.min(340,available)+'px',left:Math.max(left+8,Math.min(r.left,left+width-menuWidth-8))+'px'});
      const h=menu.getBoundingClientRect().height;menu.style.top=Math.max(floor,Math.min(down?r.bottom+5:r.top-h-5,bottom-h))+'px';focus(selected);
      menu.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End','Escape','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Escape')close(true);else if(event.key==='Enter'||event.key===' ')choose(selected);else focus(event.key==='Home'?0:event.key==='End'?items.length-1:selected+(event.key==='ArrowDown'?1:-1));}else if(event.key==='Tab')close();},options);
      document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&!anchor.contains(event.target))close();},{...options,capture:true});
      document.addEventListener('scroll',event=>{if(!menu.contains(event.target))close();},{...options,capture:true});window.addEventListener('resize',()=>close(),options);
    }
    anchor.addEventListener('click',event=>{event.stopPropagation();open();});anchor.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}});return anchor;
  }
  return {create,close,destroy:close};
}
