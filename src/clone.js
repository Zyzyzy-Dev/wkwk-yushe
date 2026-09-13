// 配置数据克隆：保留原生支持的类型，为响应式普通对象/数组提供无代理副本。
export function clone(value) {
  const native = globalThis.structuredClone;
  if (typeof native === 'function') {
    try { return native(value); }
    catch (error) { if (error.name !== 'DataCloneError') throw error; }
  }
  const seen = new WeakMap();
  const copy = input => {
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'function' || typeof input === 'symbol') throw new TypeError('配置包含不能克隆的函数或 Symbol');
      return input;
    }
    if (seen.has(input)) return seen.get(input);
    const proto = Object.getPrototypeOf(input);
    const array = Array.isArray(input);
    if (!array && proto !== Object.prototype && proto !== null) {
      if (typeof native === 'function') { const output = native(input); seen.set(input,output); return output; }
      throw new TypeError('当前环境不能克隆此配置类型');
    }
    const output = array ? new Array(input.length) : {};
    seen.set(input, output);
    // Reading enumerable values unwraps nested proxies without modifying their source.
    for (const key of Object.keys(input)) Object.defineProperty(output,key,{value:copy(input[key]),enumerable:true,writable:true,configurable:true});
    return output;
  };
  return copy(value);
}
