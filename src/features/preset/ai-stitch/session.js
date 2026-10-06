// 独立缝合会话：原基线快照、修订和任务令牌阻止取消后的响应污染草稿。
import {clone,createIdentifier} from '../core.js';
export function createStitchSession({side,name,baseline,dirty=false,source=null}){
 return {id:createIdentifier(),side,originalName:source||name.replace(/\.json$/i,''),baseline:clone(baseline),dirty,source,
  name:name.replace(/\.json$/i,'')+'-AI缝合-'+createIdentifier(),sources:[],guidance:'',profileId:'',revision:0,status:'idle',plan:null,excluded:new Set(),approvals:new Map(),previousPreview:null,task:null,saveId:null,
  touch(){this.previousPreview=null;this.approvals.clear();this.revision++;this.plan=null;this.excluded.clear();this.status='idle';this.task=null;},
  begin(){if(this.status==='generating'||this.status==='saving')throw Error('已有任务正在进行');this.previousPreview=this.plan?{plan:this.plan,excluded:new Set(this.excluded),approvals:new Map(this.approvals)}:null;this.plan=null;this.excluded.clear();this.approvals.clear();this.status='generating';this.task=createIdentifier();return {id:this.task,revision:this.revision};},
  accept(token,plan){if(this.task!==token.id||this.revision!==token.revision||this.status!=='generating')return false;this.previousPreview=null;this.approvals.clear();this.plan=plan;this.status='preview';this.task=null;return true;},
  cancel(){this.task=null;if(this.previousPreview){Object.assign(this,this.previousPreview);this.previousPreview=null;}this.status=this.plan?'preview':'idle';},
 };
}
