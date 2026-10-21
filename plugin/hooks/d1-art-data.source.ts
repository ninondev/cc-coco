type Art={helpers:{paper:string;palette:string;done:string;failed:string;arrive:string};ribbon:{tie:string};shed:{snake:string[];skin:string[];palette:Record<string,string>};trim:{fold:string}}
const data:Partial<Art>={},loading:Partial<Record<keyof Art,Promise<void>>>={}
export function d1Art<K extends keyof Art>(kind:K):Art[K]{const value=data[kind];if(!value)throw new TypeError();return value}
export function loadD1Art(kind:keyof Art,read:(path:string)=>Promise<string>):Promise<void>{
 if(!['helpers','ribbon','shed','trim'].includes(kind))return Promise.reject(new TypeError())
 if(data[kind])return Promise.resolve()
 return loading[kind]??=read(`hooks/d1-${kind}-art.json`).then(text=>{if(text.length>20000)throw new TypeError();const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError();data[kind]=value}).finally(()=>{delete loading[kind]})
}
