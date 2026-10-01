import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { receiptSchema } from '../_shared/schemas.ts'
import { geminiJson } from '../_shared/ai.ts'
import { matchCategory } from '../_shared/preview.ts'

function toBase64(bytes:Uint8Array){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));return btoa(binary)}
function safeConfidence(v:any){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'receipt-extract',15)
    const body=await req.json();const householdId=String(body.household_id??'');const storagePath=String(body.storage_path??'');const mimeType=String(body.mime_type??'')
    if(!householdId||!storagePath)throw new Error('household_id and storage_path are required');await requireHouseholdAccess(admin,authUser.id,householdId,true)
    if(!storagePath.startsWith(`${householdId}/${authUser.id}/`))throw new Error('Receipt path does not belong to the current user')
    const allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(!allowed.includes(mimeType))throw new Error('Unsupported receipt MIME type')
    const{data:file,error:downloadError}=await admin.storage.from('receipts').download(storagePath);if(downloadError||!file)throw new Error('Receipt file could not be read')
    if(file.size>10*1024*1024)throw new Error('Receipt exceeds 10 MB limit')
    const{data:categories}=await admin.from('categories').select('name').eq('household_id',householdId).eq('is_archived',false)
    const categoryNames=(categories??[]).map((c:any)=>c.name).join(', ')
    const system=`Extract a household purchase receipt into JSON. Never invent unreadable or missing values. If a value is unclear, return null with low confidence and needs_review=true. Dates must use YYYY-MM-DD. Monetary values are plain numbers without currency symbols. For category_hint, choose one of the supplied household category names only when supported by the merchant/items; otherwise return null. Household categories: ${categoryNames}.`
    const model=Deno.env.get('GEMINI_RECEIPT_MODEL')??'gemini-3.8-flash';const bytes=new Uint8Array(await file.arrayBuffer())
    const result=await geminiJson<any>({model,system,prompt:'Extract this receipt. Preserve uncertainty. Check subtotal + tax - discount against total when readable.',schema:receiptSchema,media:{data:toBase64(bytes),mimeType}})
    const x=result.parsed
    for(const key of ['merchant','transaction_date','total','subtotal','tax','discount','payment_method','category_hint']){x[key].confidence=safeConfidence(x[key].confidence);if(x[key].confidence<0.7)x[key].needs_review=true}
    let arithmeticIssue=false
    if(x.subtotal.value!=null&&x.total.value!=null){const expected=Number(x.subtotal.value)+Number(x.tax.value??0)-Number(x.discount.value??0);if(Math.abs(expected-Number(x.total.value))>Math.max(1,Number(x.total.value)*0.01))arithmeticIssue=true}
    const overall=Math.min(...['merchant','transaction_date','total'].map(k=>safeConfidence(x[k].confidence)));const needsReview=arithmeticIssue||overall<0.9||['merchant','transaction_date','total'].some(k=>x[k].value==null||x[k].needs_review)
    const category=await matchCategory(admin,householdId,{category_hint:x.category_hint.value,merchant_hint:x.merchant.value,description:x.items.map((i:any)=>i.name).filter(Boolean).join(' ')})
    let account:any=null;if(x.payment_method.value){const hint=String(x.payment_method.value).replace(/[%_,]/g,' ');const{data}=await admin.from('accounts').select('id,name').eq('household_id',householdId).eq('is_active',true).ilike('name',`%${hint}%`).limit(1).maybeSingle();account=data}
    if(!account){const{data}=await admin.from('accounts').select('id,name').eq('household_id',householdId).eq('is_active',true).eq('account_type','CASH').limit(1).maybeSingle();account=data}
    let duplicates:any[]=[]
    if(x.total.value!=null&&x.transaction_date.value){const start=`${x.transaction_date.value}T00:00:00+07:00`;const end=`${x.transaction_date.value}T23:59:59.999+07:00`;let q=admin.from('transactions').select('id,merchant_name,description,total_amount,transaction_at').eq('household_id',householdId).eq('transaction_type','EXPENSE').eq('total_amount',x.total.value).is('deleted_at',null).gte('transaction_at',start).lte('transaction_at',end).limit(10);const{data}=await q;duplicates=data??[]}
    const{data:receipt,error:receiptError}=await admin.from('receipts').insert({household_id:householdId,uploaded_by:authUser.id,storage_path:storagePath,mime_type:mimeType,merchant:x.merchant.value,receipt_date:x.transaction_date.value,subtotal:x.subtotal.value,tax:x.tax.value,discount:x.discount.value,total:x.total.value,extraction_status:needsReview?'NEEDS_REVIEW':'EXTRACTED',overall_confidence:overall}).select('id').single();if(receiptError)throw receiptError
    if(x.items.length){const rows=x.items.map((i:any,index:number)=>({receipt_id:receipt.id,line_no:index+1,name:i.name,quantity:i.quantity,unit_price:i.unit_price,total:i.total,confidence:safeConfidence(i.confidence)}));const{error:itemError}=await admin.from('receipt_items').insert(rows);if(itemError)throw itemError}
    const{error:aiError}=await admin.from('ai_extractions').insert({household_id:householdId,user_id:authUser.id,source_type:'RECEIPT',provider:'gemini',model:result.model,prompt_version:'receipt-extractor-v1',schema_version:'v1',raw_input_reference:storagePath,raw_output:result.raw,normalized_output:x,confidence:overall,needs_review:needsReview});if(aiError)throw aiError
    const{data:pref}=await admin.from('user_preferences').select('receipt_retention').eq('user_id',authUser.id).maybeSingle();if(pref?.receipt_retention==='DELETE_AFTER_EXTRACTION')await admin.storage.from('receipts').remove([storagePath])
    return json({...x,overall_confidence:overall,needs_review:needsReview,arithmetic_issue:arithmeticIssue,duplicate_candidates:duplicates,receipt_id:receipt.id,storage_path:storagePath,suggested_account_id:account?.id??null,suggested_category_id:category?.id??null})
  }catch(e){return handleError(e)}
})
