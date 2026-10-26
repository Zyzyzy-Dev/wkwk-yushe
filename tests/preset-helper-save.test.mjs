// 真实宿主保存路径回归：编辑器旧副本不能覆盖后来绑定的助手脚本。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withPresetHelperBinding} from '../src/host/preset-helper-binding.js';
const source=readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const readCode=source.slice(source.indexOf('function readPresetByName('),source.indexOf('async function getPresetManager('));
const saveCode=source.slice(source.indexOf("  if (method === 'save-preset')"),source.indexOf('  throw new Error(`未知宿主请求：'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function fixture({active='Other',live,stored}={}){
 const script=id=>({scripts:[{type:'script',id,content:'synthetic',data:{keep:1},export_with:{data:false}}]});
 const entries=[stored??{prompts:[],extensions:{tavern_helper:script('latest'),hostOnly:{keep:true}}}],writes=[];
 const manager={getSelectedPresetName:()=>active,getPresetList:()=>({presets:entries,preset_names:{Bound:0}}),savePreset:async(name,preset)=>{writes.push({name,preset});entries[0]=structuredClone(preset);}};
 const input={prompts:[{identifier:'a',content:'edited text'}],custom_url:'https://synthetic.invalid',extensions:{tavern_helper:script('stale'),other:{edited:true}}};
 const deps={clone:structuredClone,withPresetHelperBinding,getPresetManager:async()=>manager,openaiModule:{oai_settings:live},shouldRefreshActivePreset:(a,b)=>a===b,applyPresetToMemory:(ps,ns,name,preset)=>ps[ns[name]]=structuredClone(preset)};
 const code=readCode+'\n'+saveCode.replaceAll("import('/scripts/openai.js')",'Promise.resolve(openaiModule)');
 return {input,writes,entries,save:()=>new AsyncFunction(...Object.keys(deps),'method','payload',code)(...Object.values(deps),'save-preset',{name:'Bound',preset:input})};
}
test('save preserves latest exact-source helper without applying export cleanup or losing edited fields',async()=>{
 const e=fixture(),before=structuredClone(e.input),saved=await e.save();
 assert.equal(saved.extensions.tavern_helper.scripts[0].id,'latest');
 assert.deepEqual(saved.extensions.tavern_helper.scripts[0].data,{keep:1});
 assert.equal(saved.prompts[0].content,'edited text');assert.deepEqual(saved.extensions.other,{edited:true});
 assert.equal(saved.custom_url,'https://synthetic.invalid');assert.deepEqual(e.input,before);
});
test('active source uses immediate helper memory before the helper delayed preset write',async()=>{
 const live={preset_settings_openai:'Bound',extensions:{tavern_helper:{scripts:[{id:'just-bound'}]}}};
 const e=fixture({active:'Bound',live});assert.equal((await e.save()).extensions.tavern_helper.scripts[0].id,'just-bound');
});
test('other active preset helper is never copied into saved source',async()=>{
 const e=fixture({active:'Other',live:{preset_settings_openai:'Other',extensions:{tavern_helper:{scripts:[{id:'wrong'}]}}}});
 assert.equal((await e.save()).extensions.tavern_helper.scripts[0].id,'latest');
});
test('removed binding stays removed after saving an older editor copy',async()=>{
 const e=fixture({stored:{prompts:[],extensions:{}}});assert.equal(Object.hasOwn((await e.save()).extensions,'tavern_helper'),false);
});
