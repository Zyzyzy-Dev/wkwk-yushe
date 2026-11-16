// 显示完整性回归：同一批原生行下的标题丢失、挪位、隐藏残留不能被缓存忽略。
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNativeGroupLayout, nativeGroupLayoutIntact } from '../src/host/native-group-layout.js';

function element(classes = [], pcmNg) {
    const names = new Set(classes);
    return { classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) },
        dataset: { pcmNg }, parentNode: null, nextElementSibling: null };
}
function fixture() {
    const list = element(['pcm-native-groups']), row = element(['pcm-ng-hidden', 'pcm-ng-off']);
    const header = element([], 'header'), select = element([], 'assign');
    row.parentNode = header.parentNode = list; select.parentNode = row; header.nextElementSibling = row;
    const owned = [header, select]; list.querySelectorAll = () => owned;
    return { list, row, header, select, owned, saved: captureNativeGroupLayout(list, [row]) };
}
test('完整布局可复用，开关禁用变化不使标题缓存失效', () => {
    const f=fixture();f.header.disabled=true;f.row.textContent='new token count';
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),true);
});
test('标题被删除而原生行仍在时必须重建', () => {
    const f=fixture();f.header.parentNode=null;f.owned.shift();
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
test('同数量的新节点不冒充旧标题', () => {
    const f=fixture();const replacement=element([],'header');replacement.parentNode=f.list;
    f.owned[0]=replacement;f.header.parentNode=null;
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
test('标题被挪到错误行前不能复用', () => {
    const f=fixture();f.header.nextElementSibling=element();
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
test('正则归组下拉框被删除不能复用', () => {
    const f=fixture();f.select.parentNode=null;f.owned.pop();
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
for(const name of ['pcm-ng-hidden','pcm-ng-off'])test(`原生行 ${name} 状态被清理必须刷新`,()=>{
    const f=fixture();f.row.classList.remove(name);
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
test('分组根样式丢失不能复用',()=>{
    const f=fixture();f.list.classList.remove('pcm-native-groups');
    assert.equal(nativeGroupLayoutIntact(f.list,f.saved),false);
});
test('关闭分组时的空显示快照有效，意外插入控件仍会失效',()=>{
    const list=element(),row=element();row.parentNode=list;const nodes=[];list.querySelectorAll=()=>nodes;
    const saved=captureNativeGroupLayout(list,[row]);assert.equal(nativeGroupLayoutIntact(list,saved),true);
    nodes.push(element([],'header'));assert.equal(nativeGroupLayoutIntact(list,saved),false);
});
