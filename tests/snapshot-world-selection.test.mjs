// 运行宿主真实世界书选择边界：无选择框时仍使用原生设置接口，拒绝缺失数据与静默失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/host/host.js', import.meta.url), 'utf8');
const start = source.indexOf('function snapshotWorldSelection(') >= 0
  ? source.indexOf('function snapshotWorldSelection(') : source.indexOf('function setSnapshotWorlds(');
const end = source.indexOf('\n// 同步当前预设的所有活动副本', start);
assert.ok(start >= 0 && end > start);
function setup({select = null, native = true, ignore = false} = {}) {
  const state = {globalSelect:['A'], charLore:[{name:'角色',extraBooks:['C']}]};
  const world = {
    world_names:['A','B','C'], selected_world_info:['A'], world_info:state,
    onWorldInfoChange() {this.selected_world_info=select.options.filter(o=>o.selected).map(o=>this.world_names[Number(o.value)]);},
  };
  if (native) world.updateWorldInfoSettings = (settings, names) => {
    assert.deepEqual(settings, {}, '不得传入其他世界书设置');
    if (!ignore) world.selected_world_info=names;
  };
  const run = new Function('document', 'selectedSnapshotWorlds', 'snapshotWorldSettings',
    source.slice(start, end) + ';return setSnapshotWorlds;')(
      {getElementById:()=>select}, env=>[...env.world.selected_world_info], env=>env.world.world_info);
  return {world, state, apply:names=>run({world},names)};
}

test('数据已加载但选择框不存在时仍能切换挂载并保持角色附加书', () => {
  const f=setup(), names=['B','A'];f.apply(names);
  assert.deepEqual(f.world.selected_world_info,['B','A']);
  assert.deepEqual(f.state.globalSelect,['B','A']);
  assert.deepEqual(f.state.charLore,[{name:'角色',extraBooks:['C']}]);
  names.push('C');
  assert.deepEqual(f.world.selected_world_info,['B','A'],'原生状态不得引用调用方数组');
});
test('选择框选项未挂载时原生接口也能清空或切换挂载', () => {
  const f=setup({select:{options:[]}});f.apply(['B']);
  assert.deepEqual(f.state.globalSelect,['B']);f.apply([]);
  assert.deepEqual(f.state.globalSelect,[]);
});
test('旧宿主无设置接口时保留原选择框路径', () => {
  const select={options:[{value:'0',selected:true},{value:'1',selected:false},{value:'2',selected:false}]};
  const f=setup({native:false,select});f.apply(['B']);
  assert.deepEqual(f.world.selected_world_info,['B']);
  assert.deepEqual(f.state.globalSelect,['B']);
});
test('没有接口和选择框时拒绝，不能只改持久设置而伪装挂载成功', () => {
  const f=setup({native:false});assert.throws(()=>f.apply(['B']));
  assert.deepEqual(f.world.selected_world_info,['A']);
  assert.deepEqual(f.state.globalSelect,['A']);
});
test('未知世界书或尚未加载列表必须在调用原生写入前拒绝', () => {
  const f=setup();assert.throws(()=>f.apply(['missing']));
  assert.deepEqual(f.state.globalSelect,['A']);
  f.world.world_names=undefined;assert.throws(()=>f.apply([]));
  assert.deepEqual(f.world.selected_world_info,['A']);
});
test('原生接口静默未切换不能报告成功或把错误值写进持久设置', () => {
  const f=setup({ignore:true});assert.throws(()=>f.apply(['B']));
  assert.deepEqual(f.state.globalSelect,['A']);
});
