/**
 * Shared Responses API client. API keys stay on the Node server.
 * The test endpoint override is *only* enabled with NODE_ENV=test.
 */
export function responseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text).join('\n').trim();
}
export function serviceError(status, payload) {
  const upstream = String(payload?.error?.code || '');
  if (status === 401 || status === 403) return 'AI_KEY_INVALID';
  if (status === 429) return upstream === 'insufficient_quota' ? 'AI_NO_CREDITS' : 'AI_RATE_LIMIT';
  if (status === 400 && upstream === 'model_not_found') return 'AI_MODEL_UNAVAILABLE';
  if (status === 400 && /model/i.test(String(payload?.error?.message || ''))) return 'AI_MODEL_UNAVAILABLE';
  return 'AI_UPSTREAM';
}
const endpoint = () => process.env.NODE_ENV === 'test' && process.env.TEST_OPENAI_ENDPOINT
  ? process.env.TEST_OPENAI_ENDPOINT : 'https://api.openai.com/v1/responses';
export async function generateAI({ apiKey, model, instructions, input, outputFormat, maxOutputTokens=800, timeoutMs=30000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const config = { model, instructions, input, store: false, max_output_tokens: maxOutputTokens };
    if (outputFormat) config.text = {format: outputFormat};
    const response = await fetch(endpoint(), {
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
      body:JSON.stringify(config)
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) return {ok:false, code:serviceError(response.status,payload)};
    if (payload.status === 'incomplete') return {ok:false, code:'AI_INCOMPLETE'};
    const output = responseText(payload);
    return output ? {ok:true,text:output} : {ok:false,code:'AI_EMPTY'};
  } catch (e) {
    return {ok:false,code:e.name==='AbortError'?'AI_TIMEOUT':'AI_NETWORK'};
  } finally {clearTimeout(timer)}
}

export const CV_REVIEW_FORMAT = {
  type:'json_schema', name:'careerbrand_cv_review', strict:true,
  schema:{type:'object',additionalProperties:false,
    properties:{
      strengths:{type:'array',items:{type:'string'}},
      improvements:{type:'array',items:{type:'string'}},
      exampleRewrite:{type:'string'},
      clarifyingQuestions:{type:'array',items:{type:'string'}},
      limitations:{type:'string'}
    },
    required:['strengths','improvements','exampleRewrite','clarifyingQuestions','limitations']
  }
};
export function validateReview(text){
  let result;
  try { result=JSON.parse(text); } catch { return null }
  if(!result || typeof result!=='object') return null;
  for(const k of ['strengths','improvements','clarifyingQuestions'])
    if(!Array.isArray(result[k]) || !result[k].every(x=>typeof x==='string')) return null;
  if(typeof result.exampleRewrite!=='string' || typeof result.limitations!=='string') return null;
  return {
    strengths:result.strengths.slice(0,5).map(s=>s.slice(0,450)),
    improvements:result.improvements.slice(0,6).map(s=>s.slice(0,500)),
    exampleRewrite:result.exampleRewrite.slice(0,1800),
    clarifyingQuestions:result.clarifyingQuestions.slice(0,3).map(s=>s.slice(0,300)),
    limitations:result.limitations.slice(0,850)
  };
}
