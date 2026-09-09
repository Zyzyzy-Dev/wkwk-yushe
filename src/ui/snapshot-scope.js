// 快照范围选择控件：共用于当前设置保存与隔离草稿编辑，不访问宿主。
export const snapshotScopeLabels = {preset:'预设',worlds:'世界书',regex:'正则'};
export function createSnapshotScopePicker(scope, onChange = () => {}) {
  const element=document.createElement('fieldset');element.className='pcm-snapshot-scope-picker';
  const legend=document.createElement('legend');legend.textContent='保存范围';element.append(legend);
  for (const [key,text] of Object.entries(snapshotScopeLabels)) {
    const label=document.createElement('label');label.className='pcm-snapshot-check';
    const input=document.createElement('input');input.type='checkbox';input.className='pcm-native-switch';
    input.checked=scope[key];input.setAttribute('aria-label','保存'+text);
    input.addEventListener('change',()=>{scope[key]=input.checked;onChange();});
    label.append(input,document.createTextNode(text));element.append(label);
  }
  const hint=document.createElement('small');hint.textContent='只保存勾选项；应用时，未勾选的设置保持当前状态。';element.append(hint);
  return element;
}
