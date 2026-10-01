import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { matchCategory } from '../_shared/preview.ts'
import { geminiJson } from '../_shared/ai.ts'

const schema={type:'object',additionalProperties:false,properties:{category_name:{type:['string','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['category_name','confidence']} as const
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'ai-categorize',40)
    const body=await req.json();const householdId=String(body.household_id??'');const merchant=String(body.merchant??'');const description=String(body.description??'');if(!householdId)throw new Error('household_id is required');await requireHouseholdAccess(admin,authUser.id,householdId,true)
    const deterministic=await matchCategory(admin,householdId,{merchant_hint:merchant,description})
    if(deterministic&&deterministic.name!=='Others')return json({category_id:deterministic.id,category_name:deterministic.name,confidence:1,source:'HOUSEHOLD_RULE_OR_HISTORY'})
    const{data:categories}=await admin.from('categories').select('id,name').eq('household_id',householdId).eq('is_archived',false).neq('transaction_type','INCOME');const names=(categories??[]).map((c:any)=>c.name)
    const model=Deno.env.get('GEMINI_INTENT_MODEL')??'gemini-3.8-flash';const r=await geminiJson<any>({model,system:`Choose the most appropriate household expense category from this exact list: ${names.join(', ')}. If uncertain return null.`,prompt:`Merchant: ${merchant}\nDescription: ${description}`,schema})
    const selected=(categories??[]).find((c:any)=>c.name===r.parsed.category_name);return json({category_id:selected?.id??deterministic?.id??null,category_name:selected?.name??deterministic?.name??null,confidence:selected?Number(r.parsed.confidence):0,source:selected?'AI':'FALLBACK'})
  }catch(e){return handleError(e)}
})
