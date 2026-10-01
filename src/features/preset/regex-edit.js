// 正则草稿修改：精确补丁及柏宝箱 version 1 分组元数据，不调用宿主或执行表达式。
import {getRegexScripts,createIdentifier,clone} from './core.js';
export function editRegexScript(preset,index,patch){
 const script=getRegexScripts(preset)[index];if(!script)throw new Error('正则已不存在');
 const allowed=['scriptName','findRegex','replaceString','trimStrings','placement','disabled','runOnEdit','substituteRegex','markdownOnly','promptOnly','minDepth','maxDepth'];
 for(const key of ['minDepth','maxDepth'])if(key in patch&&patch[key]!==null&&(!Number.isInteger(patch[key])||patch[key]<-1))throw new Error('深度需要非负整数、-1（不限）或留空');
 const min=Object.hasOwn(patch,'minDepth')?patch.minDepth:script.minDepth,max=Object.hasOwn(patch,'maxDepth')?patch.maxDepth:script.maxDepth;if(('minDepth' in patch||'maxDepth' in patch)&&min!=null&&max!=null&&min>=0&&max>=0&&min>max)throw new Error('最小深度不能大于最大深度');
 for(const key of allowed)if(Object.hasOwn(patch,key))script[key]=clone(patch[key]);return script;
}
function groupState(preset){
 preset.extensions??={};preset.extensions.baibaiToolkit??={};const toolkit=preset.extensions.baibaiToolkit;
 if(toolkit.regexGroups&&toolkit.regexGroups.version!==1)throw new Error('未知正则分组版本，保留原数据');
 toolkit.regexGroups??={version:1,groups:[],scripts:{},ungrouped:{name:'未分组',collapsed:false}};return toolkit.regexGroups;
}
export function groupRegexScripts(preset,indexes,name){
 name=String(name).trim();if(!name)throw new Error('请输入分组名称');const scripts=getRegexScripts(preset),chosen=new Set(indexes);const group=groupState(preset),id=createIdentifier();
 const ids=new Set();for(const script of scripts){if(!script.id||ids.has(script.id))script.id=createIdentifier();ids.add(script.id);}
 group.groups.push({id,name,order:group.groups.length,collapsed:false});let order=0;
 scripts.forEach((script,index)=>{if(chosen.has(index))group.scripts[script.id]={...group.scripts[script.id],groupId:id,order:order++};});return id;
}
export function renameRegexGroup(preset,id,name){const group=groupState(preset).groups.find(x=>x.id===id);if(!group)throw new Error('分组已不存在');name=String(name).trim();if(!name)throw new Error('请输入分组名称');group.name=name;}
export function removeRegexGroup(preset,id){const g=groupState(preset);g.groups=g.groups.filter(x=>x.id!==id);for(const meta of Object.values(g.scripts))if(meta.groupId===id)meta.groupId='__ungrouped';g.groups.forEach((x,i)=>x.order=i);}
export function deleteRegexScripts(preset,indexes){const scripts=getRegexScripts(preset),remove=new Set(indexes),g=preset?.extensions?.baibaiToolkit?.regexGroups;preset.extensions.regex_scripts=scripts.filter((s,i)=>!remove.has(i));const remaining=new Set(preset.extensions.regex_scripts.map(s=>s.id));if(g?.scripts)for(const s of scripts.filter((s,i)=>remove.has(i)))if(!remaining.has(s.id))delete g.scripts[s.id];}
