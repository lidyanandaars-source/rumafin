import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { financialQuerySchema } from '../_shared/schemas.ts'
import { geminiJson, groqJson } from '../_shared/ai.ts'

function jakartaToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(t:string)=>parts.find(p=>p.type===t)?.value??'';return `${get('year')}-${get('month')}-${get('day')}`}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{userClient,admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'financial-query',30)
    const body=await req.json();const householdId=String(body.household_id??'');const question=String(body.question??'').trim();if(!householdId||!question)throw new Error('household_id and question are required');await requireHouseholdAccess(admin,authUser.id,householdId,false)
    const today=jakartaToday();const system=`Translate a household-finance question into database filters only. Do not calculate any amount. Today in Asia/Jakarta is ${today}. Resolve relative periods such as bulan ini or bulan lalu to explicit YYYY-MM-DD from/to dates. metric must be expense, income, or net_cash_flow. If no category or merchant is requested, return null.`
    const primary=Deno.env.get('GEMINI_INTENT_MODEL')??'gemini-3.8-flash';const fallback=Deno.env.get('GROQ_INTENT_MODEL')??'openai/gpt-oss-20b';let filter:any
    try{filter=(await geminiJson<any>({model:primary,system,prompt:question,schema:financialQuerySchema})).parsed}catch(e){console.warn(e);filter=(await groqJson<any>({model:fallback,system,prompt:question,schema:financialQuerySchema,schemaName:'financial_query'})).parsed}
    const{data,error}=await userClient.rpc('get_financial_metric',{p_household_id:householdId,p_metric:filter.metric,p_from:filter.from,p_to:filter.to,p_category_hint:filter.category_hint,p_merchant_hint:filter.merchant_hint});if(error)throw error
    const value=Number((data as any).value??0);const formatted=new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value)
    const label=filter.metric==='expense'?'pengeluaran':filter.metric==='income'?'pemasukan':'net cash flow';const scope=[filter.category_hint&&`kategori ${filter.category_hint}`,filter.merchant_hint&&`merchant ${filter.merchant_hint}`].filter(Boolean).join(', ')
    return json({filters:filter,result:data,answer:`${label.charAt(0).toUpperCase()+label.slice(1)}${scope?` untuk ${scope}`:''} pada ${filter.from} sampai ${filter.to} adalah ${formatted}.`})
  }catch(e){return handleError(e)}
})
