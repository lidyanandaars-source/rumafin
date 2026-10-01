import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { buildPreview } from '../_shared/preview.ts'
import { normalizeFinancialCandidate, validateFinancialCandidate } from '../_shared/financial-command.ts'

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'transaction-command-preview',60)
    const body=await req.json();const householdId=String(body.household_id??'');const commandId=String(body.command_id??'')
    if(!householdId||!commandId)throw new Error('household_id and command_id are required');await requireHouseholdAccess(admin,authUser.id,householdId,true)
    const{data:row,error}=await admin.from('voice_commands').select('id,user_id,household_id,transcript,parsed_payload,status').eq('id',commandId).eq('household_id',householdId).single();if(error||!row)throw new Error('Voice command not found');if(row.user_id!==authUser.id)throw new Error('Not authorized for this command')
    const command=normalizeFinancialCandidate(row.parsed_payload,row.transcript)
    validateFinancialCandidate(command,row.transcript)
    const preview=await buildPreview(admin,householdId,command)
    await admin.from('voice_commands').update({status:'AWAITING_CONFIRMATION'}).eq('id',commandId)
    return json({command_id:commandId,...preview})
  }catch(e){return handleError(e)}
})
