// 双向绑定选择弹窗：只保存引用，不在编辑绑定时切换设置。
export async function chooseApiSnapshotBinding({host, parent, apiId, snapshotId}) {
  const data = await host.request('api-manager-links');
  const dialog = document.createElement('dialog'); dialog.className = 'pcm-api-modal pcm-binding-modal';
  const form = document.createElement('form'); form.className = 'pcm-api-editor';
  const title = document.createElement('h3'); title.textContent = apiId ? '绑定设置快照' : '绑定 API';
  const select = document.createElement('select'); select.setAttribute('aria-label', title.textContent);
  const link = data.links.find(item=>apiId ? item.apiId===apiId : item.snapshotId===snapshotId);
  select.add(new Option('请选择方案', ''));
  for (const item of apiId ? data.snapshots : data.profiles) select.add(new Option(item.name,item.id));
  select.value = (apiId ? link?.snapshotId : link?.apiId) || '';
  const hint = document.createElement('p'); hint.textContent = '双向绑定：切换任一方案时同时应用另一方；重新绑定会替换双方原绑定。';
  const status = document.createElement('p'); status.setAttribute('role','status');
  const actions = document.createElement('div'); actions.className = 'pcm-snapshot-actions';
  form.append(title,hint,select,status,actions); dialog.append(form); parent.append(dialog);
  return new Promise(resolve=>{
    let busy=false;
    const close = value => {if(busy)return;dialog.close();dialog.remove();resolve(value);};
    const action = (label,callback) => {const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',callback);actions.append(b);};
    const save = async cancel => {
      if(busy)return;
      if(!cancel&&!select.value){status.textContent='请选择方案';return;}
      busy=true;for(const b of actions.children)b.disabled=true;
      try {await host.request('api-manager-bind',{apiId:apiId || (cancel?undefined:select.value),snapshotId:snapshotId || (cancel?undefined:select.value),cancel});busy=false;close(true);}
      catch(error){status.textContent=error.message;busy=false;for(const b of actions.children)b.disabled=false;}
    };
    action('保存绑定',()=>save(false));action('取消绑定',()=>save(true));action('关闭',()=>close(false));
    form.addEventListener('submit',event=>{event.preventDefault();void save(false);});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});dialog.showModal();
  });
}
