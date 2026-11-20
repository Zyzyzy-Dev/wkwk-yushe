// 从本机酒馆的预设列表明确选定新目标；关闭或取消时不修改快照。
export function chooseSnapshotPreset(parent, snapshot, names, signal) {
  const dialog = document.createElement('dialog');
  dialog.className = 'pcm-api-modal pcm-binding-modal pcm-snapshot-preset-dialog';
  dialog.setAttribute('aria-label','重新指定预设');
  const form = document.createElement('form');
  form.className = 'pcm-api-editor';
  const heading = document.createElement('h3');
  heading.textContent = '重新指定预设';
  const hint = document.createElement('p');
  hint.textContent = '快照「'+snapshot.name+'」当前指向「'+snapshot.presetName+'」。将保留原有开关，下次应用时使用所选预设。';
  const select = document.createElement('select');
  select.setAttribute('aria-label','目标预设');
  select.add(new Option('请选择目标预设',''));
  for (const name of names) if (name!==snapshot.presetName) select.add(new Option(name,name));
  const actions = document.createElement('div');
  actions.className = 'pcm-snapshot-actions';
  const cancel = document.createElement('button'), confirm = document.createElement('button');
  cancel.type='button'; cancel.textContent='取消';
  confirm.type='submit'; confirm.textContent='确认更改'; confirm.disabled=true;
  select.onchange=()=>{confirm.disabled=!select.value;};
  if (select.options.length===1) hint.textContent+=' 本机暂无其他可选预设。';
  actions.append(cancel,confirm);form.append(heading,hint,select,actions);dialog.append(form);parent.append(dialog);
  return new Promise(resolve=>{
    let settled=false;
    function finish(value) {
      if(settled)return;
      settled=true;
      signal.removeEventListener('abort',dismiss);
      if(dialog.open)dialog.close();
      dialog.remove();resolve(value);
    }
    const dismiss=()=>finish(null);
    signal.addEventListener('abort',dismiss,{once:true});
    cancel.onclick=dismiss;
    form.onsubmit=event=>{event.preventDefault();if(select.value)finish(select.value);};
    dialog.oncancel=event=>{event.preventDefault();dismiss();};
    dialog.onclose=dismiss;
    if(signal.aborted)dismiss();else dialog.showModal();
  });
}
