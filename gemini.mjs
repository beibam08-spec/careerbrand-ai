import { setTimeout as delay } from 'node:timers/promises';

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
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(p=>typeof p?.text==='string').map(p=>p.text).join('\n').trim();
}
export function geminiError(status, payload) {
  if (status === 401) return 'AI_KEY_INVALID';
  if (status === 403) return 'AI_PROVIDER_FORBIDDEN';
  if (status === 404) return 'AI_MODEL_UNAVAILABLE';
  if (status === 400) {
    const message = String(payload?.error?.message || '');
    return /not found|unsupported model|model.*not supported/i.test(message)
      ? 'AI_MODEL_UNAVAILABLE' : 'AI_PROVIDER_BAD_REQUEST';
  }
  if (status === 429) return 'AI_RATE_LIMIT';
  if (status === 503) return 'AI_BUSY';
  return 'AI_UPSTREAM';
}

function logGeminiFailure(status, reason) {
  console.error('[careerbrand_gemini_error]', JSON.stringify({httpStatus:status, reason}));
}

export async function generateGemini({apiKey,model,instructions,input,outputFormat,maxOutputTokens=900,timeoutMs=30000}){
  if(!/^[a-z0-9._-]+$/i.test(model))return {ok:false,code:'AI_MODEL_UNAVAILABLE'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const url=process.env.NODE_ENV==='test' && process.env.TEST_GEMINI_ENDPOINT
    ? process.env.TEST_GEMINI_ENDPOINT
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const retryCount=Math.max(0,Math.min(2,Number.parseInt(process.env.GEMINI_503_RETRIES??'1',10)||0));
  try{
    const body=JSON.stringify(buildGeminiRequest({instructions,input,outputFormat,maxOutputTokens}));
    for(let attempt=0;attempt<=retryCount;attempt++){
      if(controller.signal.aborted)return {ok:false,code:'AI_TIMEOUT'};
      const response=await fetch(url,{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body});
      const payload=await response.json().catch(()=>({}));
      if(response.status===503 && attempt<retryCount){
        logGeminiFailure(503, 'OVERLOAD_RETRY');
        await delay(500 * 2 ** attempt, undefined, {signal:controller.signal});
        continue;
      }
      if(!response.ok){
        const code=geminiError(response.status,payload);
        logGeminiFailure(response.status,code);
        return {ok:false,code};
      }
      const txt=geminiText(payload);
      if(payload?.candidates?.[0]?.finishReason==='MAX_TOKENS')return {ok:false,code:'AI_OUTPUT_TRUNCATED'};
      if(txt)return {ok:true,text:txt};
      logGeminiFailure(response.status, 'NO_TEXT_OUTPUT');
      return {ok:false,code:payload?.promptFeedback?.blockReason?'AI_BLOCKED':'AI_EMPTY'};
    }
    return {ok:false,code:'AI_BUSY'};
  }catch(e){
    const reason=e.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR';
    logGeminiFailure(null, reason);
    return {ok:false,code:reason==='TIMEOUT'?'AI_TIMEOUT':'AI_NETWORK'};
  }finally{clearTimeout(timer)}
}
