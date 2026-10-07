// 缝合生成专用的可配置等待时间；RPC 比请求多留30秒清理，不影响其他功能。
export function stitchTimeoutMs(minutes=15){
 if(typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<1||minutes>60)throw Error('生成等待时间须为1–60分钟');
 return Math.round(minutes*60000);
}
export function stitchRpcTimeoutMs(minutes){return stitchTimeoutMs(minutes)+30000;}
export function createStitchDeadline(minutes){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new DOMException('生成等待超时','TimeoutError')),stitchTimeoutMs(minutes));
 return {controller,dispose:()=>clearTimeout(timer)};
}
export function stitchAbortMessage(signal){
 return signal.reason?.name==='TimeoutError'?'生成等待超时，已停止本次请求。输入和草稿仍保留，可增加等待分钟数后重试。':'生成已手动取消，输入和草稿仍保留';
}
