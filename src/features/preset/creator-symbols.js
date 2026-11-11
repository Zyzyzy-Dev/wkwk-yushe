// 创作者符号的纯文本编辑计划：前缀逐个非空选中行添加，成对符号包裹完整选区。
export const CREATOR_SYMBOLS = Object.freeze([
  {id:'h1',label:'#',title:'一级标题',prefix:'# '},
  {id:'h2',label:'##',title:'二级标题',prefix:'## '},
  {id:'h3',label:'###',title:'三级标题',prefix:'### '},
  {id:'list',label:'-',title:'列表',prefix:'- '},
  {id:'quote',label:'>',title:'引用',prefix:'> '},
  {id:'bold',label:'**',title:'双星号包裹',open:'**',close:'**'},
  {id:'corner',label:'【】',title:'方头括号包裹',open:'【',close:'】'},
  {id:'square',label:'[]',title:'方括号包裹',open:'[',close:']'},
  {id:'brace',label:'{}',title:'花括号包裹',open:'{',close:'}'},
  {id:'macro',label:'{{}}',title:'双花括号包裹',open:'{{',close:'}}'},
  {id:'angle',label:'<>',title:'尖括号包裹',open:'<',close:'>'},
  {id:'paren',label:'()',title:'英文圆括号包裹',open:'(',close:')'},
  {id:'cjkParen',label:'（）',title:'中文圆括号包裹',open:'（',close:'）'},
  {id:'cjkQuote',label:'「」',title:'直角引号包裹',open:'「',close:'」'},
  {id:'cjkDoubleQuote',label:'『』',title:'双直角引号包裹',open:'『',close:'』'},
  {id:'quotePair',label:'""',title:'双引号包裹',open:'"',close:'"'},
  {id:'code',label:'` `',title:'反引号包裹',open:'`',close:'`'},
  {id:'h4',label:'####',title:'四级标题',prefix:'#### '},
  {id:'ordered',label:'1. 2.',title:'逐行编号列表',kind:'ordered'},
  {id:'separator',label:'---',title:'选区前插入分隔线',kind:'separator'},
  {id:'tag',label:'成对标签',title:'自定义成对标签',kind:'tag'},
]);
export const CREATOR_PRIMARY_IDS = Object.freeze(['h1','h2','h3','bold','corner','square']);

export function planCreatorSymbol(text, start, end, id, {tagName} = {}) {
  const symbol = CREATOR_SYMBOLS.find(item => item.id === id);
  if (!symbol || typeof text !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) throw Error('请重新选择要编辑的正文');
  const selected = text.slice(start, end);
  if (!selected.trim()) throw Error('请选择包含文字的正文');
  let replacement;
  if(symbol.kind==='tag') {
    const name=String(tagName??'').trim();
    if(!/^[\p{L}_][\p{L}\p{N}_.:-]{0,63}$/u.test(name))throw Error('标签名需以文字或下划线开头，最多64个字符，不含空格、尖括号或属性');
    replacement=`<${name}>${selected}</${name}>`;
  }else if(symbol.kind==='ordered'){
    let number=0;replacement=selected.replace(/[^\r\n]+/g,line=>line.trim()?`${++number}. ${line}`:line);
  }else if(symbol.kind==='separator'){
    const newline=text.includes('\r\n')?'\r\n':'\n',before=text.slice(0,start);
    const padding=!before||/(?:\r?\n){2}$/.test(before)?'':/\r?\n$/.test(before)?newline:newline+newline;
    replacement=padding+'---'+newline+newline+selected;
  }else replacement = symbol.prefix ? selected.replace(/[^\r\n]+/g, line => line.trim() ? symbol.prefix + line : line) : symbol.open + selected + symbol.close;
  return {before:text,start,end,replacement,selectionStart:start,selectionEnd:start + replacement.length};
}
