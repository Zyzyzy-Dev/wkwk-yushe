// 执行真实宿主保存核验闭包：未安装柏宝箱时，导入分组的 JSON 对象键序不影响保存结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const host = fs.readFileSync(new URL('../src/host/host.js', import.meta.url), 'utf8');
const start = host.indexOf('  const select = data => ({', host.indexOf('async function installNativeGroupControls()'));
const end = host.indexOf('  const start = () => { nativeGroupController', start);
assert.ok(start >= 0 && end > start);
const factory = new Function('extensions', 'openai', 'script', 'readSnapshotPersistence', host.slice(start, end) + ';return saveSettingsChecked;');
const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, reorder(value[key])])) : value;
function fixture() {
    return { extension_settings: { regex: [{id:'r1',scriptName:'正则',disabled:false,findRegex:'x'}] },
        oai_settings: { extensions: { baibaiToolkit: { presetPromptGroups: { groups: [
            { id:'g1',name:'导入组',enabled:true,collapsed:false },
            { id:'g2',name:'另一组',enabled:false,collapsed:true },
        ], prompts: {a:{groupId:'g1',order:0},b:{groupId:'g2',order:1}} } } } } };
}
function save(data, transform = reorder, asString = true) {
    let persisted, saves = 0;
    const checked = factory({extension_settings:data.extension_settings},{oai_settings:data.oai_settings},
        {saveSettings:async()=>{saves++;persisted=transform(JSON.parse(JSON.stringify(data)));}},
        async()=>({settings:asString?JSON.stringify(persisted):persisted}));
    return {checked, saves:()=>saves};
}
for (const asString of [true,false]) test(`无柏宝箱，分组字段键序改变仍确认保存：settings ${asString?'string':'object'}`, async()=>{
    const data=fixture(), original=structuredClone(data);
    assert.equal(data.extension_settings.baiBaiToolkit,undefined);
    assert.notEqual(JSON.stringify(data),JSON.stringify(reorder(data)));
    const run=save(data,reorder,asString);await run.checked();assert.equal(run.saves(),1);assert.deepEqual(data,original);
});
test('柏宝箱设置缓存、偏好和未知嵌套字段的键序也不影响核验',async()=>{
    const data=fixture();data.extension_settings.baiBaiToolkit={regexListGroups:{version:1,scopes:{global:{groups:[{name:'正则组',id:'rg'}],scripts:{r1:{order:0,groupId:'rg'}}}}}};
    data.extension_settings.preset_compare_native_groups={regex:true,preset:true};
    data.oai_settings.extensions.baibaiToolkit.extra={z:1,a:{y:2,b:3}};
    await save(data).checked();
});
for(const [name,mutate] of [
    ['折叠未保存',d=>d.oai_settings.extensions.baibaiToolkit.presetPromptGroups.groups[0].collapsed=true],
    ['分组数组被重排',d=>d.oai_settings.extensions.baibaiToolkit.presetPromptGroups.groups.reverse()],
    ['成员归属丢失',d=>delete d.oai_settings.extensions.baibaiToolkit.presetPromptGroups.prompts.a],
    ['正则开关未保存',d=>d.extension_settings.regex[0].disabled=true],
    ['预设分组缺失',d=>delete d.oai_settings.extensions.baibaiToolkit],
]) test(`真实差异仍拒绝：${name}`,async()=>{
    await assert.rejects(save(fixture(),d=>{mutate(d);return reorder(d)}).checked(),/未确认分组设置已保存/);
});
