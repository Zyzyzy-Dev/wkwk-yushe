// 仅同步指定来源的酒馆助手绑定；编辑器不编辑此字段，禁止借用其它活动预设的数据。
import {clone} from '../shared/clone.js';

export function withPresetHelperBinding(preset,source){
  const result=clone(preset);
  if(source?.extensions&&Object.hasOwn(source.extensions,'tavern_helper')){
    if(!result.extensions||typeof result.extensions!=='object'||Array.isArray(result.extensions))result.extensions={};
    result.extensions.tavern_helper=clone(source.extensions.tavern_helper);
  }else if(result.extensions&&typeof result.extensions==='object'){
    delete result.extensions.tavern_helper;
  }
  return result;
}
