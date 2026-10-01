import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { buildPreview } from '../_shared/preview.ts'

function n(v:any){return v==null?null:Number(v)}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{userClient,admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'transaction-command-commit',30)
    const body=await req.json();const householdId=String(body.household_id??'');const commandId=String(body.command_id??'');const selected=body.selected_transaction_id?String(body.selected_transaction_id):null
    if(!householdId||!commandId)throw new Error('household_id and command_id are required');await requireHouseholdAccess(admin,authUser.id,householdId,true)
    const{data:row,error}=await admin.from('voice_commands').select('*').eq('id',commandId).eq('household_id',householdId).single();if(error||!row)throw new Error('Voice command not found');if(row.user_id!==authUser.id)throw new Error('Not authorized for this command');if(row.status==='EXECUTED'&&row.execution_transaction_id)return json({transaction_id:row.execution_transaction_id,idempotent:true})
    const command=row.parsed_payload;const preview=await buildPreview(admin,householdId,command);let txId:string|null=null

    if(command.intent==='CREATE_TRANSACTION'){
      const p=preview.prepared;if(!p?.total_amount||!p.account_id||!p.transaction_at)throw new Error('Command is incomplete. Please add the transaction manually.')
      if(p.transaction_type==='TRANSFER')throw new Error('Voice transfer is reserved for the next release; use manual transfer for now.')
      if(!p.category_id)throw new Error('Category is unclear. Please add the transaction manually.')
      const amount=Number(p.total_amount);const movement=command.transaction_type==='INCOME'?amount:-amount
      const payload={household_id:householdId,transaction_type:command.transaction_type??'EXPENSE',transaction_at:p.transaction_at,timezone:'Asia/Jakarta',merchant_name:command.merchant_hint??null,description:command.description??null,notes:null,total_amount:amount,currency:command.currency??'IDR',source:'VOICE',idempotency_key:row.idempotency_key,splits:[{category_id:p.category_id,amount,description:command.description??null}],movements:[{account_id:p.account_id,amount:movement}]}
      const{data,error:rpcError}=await userClient.rpc('create_financial_transaction',{p_payload:payload});if(rpcError)throw rpcError;txId=(data as any).id
    } else if(['UPDATE_TRANSACTION','DELETE_TRANSACTION'].includes(command.intent)) {
      const candidates=preview.candidates??[];let target:any
      if(selected)target=candidates.find((c:any)=>c.id===selected);else if(candidates.length===1)target=candidates[0]
      if(!target)throw new Error(candidates.length?'Choose exactly one matching transaction.':'No matching transaction found.')
      if(command.intent==='DELETE_TRANSACTION'){
        const{error:deleteError}=await userClient.rpc('soft_delete_transaction',{p_transaction_id:target.id});if(deleteError)throw deleteError;txId=target.id
      } else {
        const{data:full,error:fetchError}=await admin.from('transactions').select('*,splits:transaction_splits(*),movements:account_movements(*)').eq('id',target.id).single();if(fetchError||!full)throw new Error('Target transaction not found')
        const changes=command.changes??{};const newAmount=n(changes.amount)??Number(full.total_amount)
        if(changes.amount!=null&&(full.splits?.length??0)>1)throw new Error('This transaction has multiple splits. Edit it manually to avoid changing split proportions unexpectedly.')
        let splits=(full.splits??[]).map((s:any)=>({category_id:s.category_id,amount:changes.amount!=null?newAmount:Number(s.amount),description:s.description}))
        let movements=(full.movements??[]).map((m:any)=>({account_id:m.account_id,amount:Number(m.amount)>=0?newAmount:-newAmount}))
        if(changes.category_hint){
          const categoryPreview=await buildPreview(admin,householdId,{intent:'CREATE_TRANSACTION',transaction_type:full.transaction_type,amount:newAmount,currency:full.currency,date:changes.date,account_hint:null,category_hint:changes.category_hint,merchant_hint:changes.merchant_name??full.merchant_name,description:changes.description??full.description})
          if(!categoryPreview.prepared?.category_id)throw new Error('New category is unclear. Edit manually.');splits=splits.map((s:any)=>({...s,category_id:categoryPreview.prepared.category_id}))
        }
        if(changes.account_hint){
          const accountPreview=await buildPreview(admin,householdId,{intent:'CREATE_TRANSACTION',transaction_type:full.transaction_type,amount:newAmount,currency:full.currency,date:changes.date,account_hint:changes.account_hint,category_hint:null,merchant_hint:null,description:null})
          if(!accountPreview.prepared?.account_id)throw new Error('New account is unclear. Edit manually.');movements=movements.map((m:any)=>({...m,account_id:accountPreview.prepared.account_id}))
        }
        const payload={household_id:householdId,transaction_type:full.transaction_type,transaction_at:changes.date?`${changes.date}T12:00:00+07:00`:full.transaction_at,timezone:full.timezone,merchant_name:changes.merchant_name??full.merchant_name,description:changes.description??full.description,notes:full.notes,total_amount:newAmount,currency:full.currency,source:'VOICE',splits,movements}
        const{data,error:updateError}=await userClient.rpc('update_financial_transaction',{p_transaction_id:target.id,p_payload:payload});if(updateError)throw updateError;txId=(data as any).id
      }
    } else throw new Error('This command cannot be committed from the voice transaction flow.')

    await admin.from('voice_commands').update({status:'EXECUTED',execution_transaction_id:txId}).eq('id',commandId)
    return json({transaction_id:txId})
  }catch(e){return handleError(e)}
})
