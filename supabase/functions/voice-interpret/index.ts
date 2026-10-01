import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { financialCommandSchema } from '../_shared/schemas.ts'
import { geminiJson, groqJson } from '../_shared/ai.ts'

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'voice-interpret',30)
    const body=await req.json();const householdId=String(body.household_id??'');const transcript=String(body.transcript??'').trim();const audioPath=body.audio_path?String(body.audio_path):null
    if(!householdId||!transcript)throw new Error('household_id and transcript are required');await requireHouseholdAccess(admin,authUser.id,householdId,true)
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(t:string)=>parts.find(p=>p.type===t)?.value??'';const today=`${get('year')}-${get('month')}-${get('day')}`
    const system=`You convert Indonesian household-finance voice commands into JSON only. Never invent an amount, account, category, merchant, date, or transaction selector. If uncertain, return null for the uncertain field and lower confidence. Do not execute SQL. Supported intents: CREATE_TRANSACTION, UPDATE_TRANSACTION, DELETE_TRANSACTION, FIND_TRANSACTION, CREATE_CATEGORY, GET_FINANCIAL_SUMMARY. Today in Asia/Jakarta is ${today}. Interpret sehari-hari amounts accurately: 85 ribu=85000, 1,5 juta=1500000. For delete/update, put matching criteria in selector and proposed edits in changes.`
    const primary=Deno.env.get('GEMINI_INTENT_MODEL')??'gemini-3.8-flash';const fallback=Deno.env.get('GROQ_INTENT_MODEL')??'openai/gpt-oss-20b'
    let parsed:any;let raw:any;let provider='gemini';let model=primary
    try{const r=await geminiJson<any>({model:primary,system,prompt:transcript,schema:financialCommandSchema});parsed=r.parsed;raw=r.raw;model=r.model}catch(e){console.warn('Gemini intent failed',e);provider='groq';const r=await groqJson<any>({model:fallback,system,prompt:transcript,schema:financialCommandSchema,schemaName:'financial_command'});parsed=r.parsed;raw=r.raw;model=r.model}
    if(typeof parsed.confidence!=='number'||!parsed.intent)throw new Error('AI returned an invalid command')
    const needsReview=parsed.confidence<0.9||parsed.amount==null&&parsed.intent==='CREATE_TRANSACTION'
    const{error:aiError}=await admin.from('ai_extractions').insert({household_id:householdId,user_id:authUser.id,source_type:'VOICE',provider,model,prompt_version:'voice-intent-v1',schema_version:'v1',raw_input_reference:audioPath,raw_output:raw,normalized_output:parsed,confidence:parsed.confidence,needs_review:needsReview});if(aiError)throw aiError
    const{data:command,error:cmdError}=await admin.from('voice_commands').insert({user_id:authUser.id,household_id:householdId,audio_path:audioPath,transcript,intent:parsed.intent,parsed_payload:parsed,confidence:parsed.confidence,status:'PARSED'}).select('id').single();if(cmdError)throw cmdError
    return json({command_id:command.id,transcript,command:parsed})
  }catch(e){return handleError(e)}
})
