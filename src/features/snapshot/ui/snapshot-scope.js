// 快照范围选择控件：共用于当前设置保存与隔离草稿编辑，不访问宿主。
export const snapshotScopeLabels = {preset:'预设',worlds:'世界书',regex:'全局正则开关',reasoning:'推理设置'};
export function snapshotScopeText(scope) {
  return [...Object.keys(snapshotScopeLabels).filter(key=>scope[key]).map(key=>snapshotScopeLabels[key]),...(scope.preset&&scope.presetRegex?['预设正则快照']:[])].join('、');
}
export function createSnapshotScopePicker(scope, onChange = () => {}, {currentPresetRegex=false} = {}) {
  const element=document.createElement('fieldset');element.className='pcm-snapshot-scope-picker';
  const legend=document.createElement('legend');legend.textContent='保存范围';element.append(legend);
  for (const [key,text] of Object.entries(snapshotScopeLabels)) {
    const label=document.createElement('label');label.className='pcm-snapshot-check';
    const input=document.createElement('input');input.type='checkbox';input.className='pcm-native-switch';
    input.checked=scope[key];input.setAttribute('aria-label','保存'+text);
    input.addEventListener('change',()=>{scope[key]=input.checked;sync();onChange(key);});
    label.append(input,document.createTextNode(text));element.append(label);
  }
  const hint=document.createElement('small');hint.textContent='仅保存勾选项。角色正则不保存、不修改。';element.append(hint);
  let sub;
  if(currentPresetRegex){
    sub=document.createElement('div');sub.className='pcm-snapshot-preset-regex-option';
    const label=document.createElement('label');label.className='pcm-snapshot-check';
    const input=document.createElement('input');input.type='checkbox';input.className='pcm-native-switch';input.checked=scope.presetRegex===true;input.setAttribute('aria-label','预设正则快照');
    input.addEventListener('change',()=>{scope.presetRegex=input.checked;onChange('presetRegex');});
    label.append(input,document.createTextNode('预设正则快照'));sub.append(label);
    const text=document.createElement('small');text.textContent='保存当前预设正则开关状态，应用快照时随快照切换。';sub.append(text);element.append(sub);
  }
  function sync(){if(sub)sub.hidden=!scope.preset;}
  sync();
  return element;
}
