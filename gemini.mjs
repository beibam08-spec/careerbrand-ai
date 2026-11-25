/** CareerBrand AI Gemini adapter. Server only: never expose the key to a browser. */
const canonicalRole = role => role === 'assistant' ? 'model' : 'user';
export function buildGeminiRequest({instructions,input,outputFormat,maxOutputTokens=900}) {
  const turns = Array.isArray(input) ? input : [];
  const contents = turns.filter(turn => turn && ['user','assistant'].includes(turn.role))
    .slice(-12).map(turn => ({role:canonicalRole(turn.role),parts:[{text:String(turn.content ?? '').slice(0,9000)}]}));
  const generationConfig = { maxOutputTokens, temperature:0.35 };
  if (outputFormat) {
    generationConfig.responseMimeType = 'application/json';
    const s=outputFormat.schema;
    // Gemini accepts a subset of JSON Schema. Drop unsupported constraints.
    const convert = node => {
      const o={type:String(node.type).toUpperCase()};
      if(node.properties)o.properties=Object.fromEntries(Object.entries(node.properties).map(([k,v])=>[k,convert(v)]));
      if(node.items)o.items=convert(node.items);
      if(node.required)o.required=node.required;
      return o;
    };
    generationConfig.responseSchema=convert(s);
  }
  return {systemInstruction:{parts:[{text:instructions}]},contents,generationConfig};
}
export function geminiText(payload){
  return (payload?.candidates?.[0]?.content?.parts || [])
    .filter(p=>typeof p?.text==='string').map(p=>p.text).join('\n').trim();
}
export function geminiError(status,payload){
  if(status===401 || status===403)return 'AI_KEY_INVALID';
  if(status===404 || /not found|not supported|unsupported model/i.test(String(payload?.error?.message || '')))return 'AI_MODEL_UNAVAILABLE';
  if(status===429)return 'AI_RATE_LIMIT';
  if(status>=500)return 'AI_UPSTREAM';
  return 'AI_UPSTREAM';
}
export async function generateGemini({apiKey,model,instructions,input,outputFormat,maxOutputTokens=900,timeoutMs=30000}){
  if(!/^[a-z0-9._-]+$/i.test(model))return {ok:false,code:'AI_MODEL_UNAVAILABLE'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  // Tests may route to an in-process fake API. Never allow this in deployed environments.
  const url=process.env.NODE_ENV==='test' && process.env.TEST_GEMINI_ENDPOINT
    ? process.env.TEST_GEMINI_ENDPOINT
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  try{
    const response=await fetch(url,{method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify(buildGeminiRequest({instructions,input,outputFormat,maxOutputTokens}))});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)return {ok:false,code:geminiError(response.status,payload)};
    const txt=geminiText(payload);
    return txt?{ok:true,text:txt}:{ok:false,code:payload?.promptFeedback?.blockReason?'AI_BLOCKED':'AI_EMPTY'};
  }catch(e){return {ok:false,code:e.name==='AbortError'?'AI_TIMEOUT':'AI_NETWORK'};}
  finally{clearTimeout(timer)}
}
