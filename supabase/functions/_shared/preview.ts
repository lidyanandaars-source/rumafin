function norm(value?: string | null) { return (value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim() }

function jakartaDate(offsetDays=0) {
  const date=new Date(Date.now()+offsetDays*86_400_000)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const get=(t:string)=>parts.find(p=>p.type===t)?.value??''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function resolveDate(command:any, selector=false) {
  const source=selector?(command.selector??{}):command
  if(source.date)return source.date
  const ref=selector?source.relative_date:source.date_reference
  if(selector&&!ref)return null
  return ref==='YESTERDAY'?jakartaDate(-1):jakartaDate(0)
}

async function matchAccount(admin:any,householdId:string,hint?:string|null) {
  const {data}=await admin.from('account_balances').select('id,name,account_type,current_balance').eq('household_id',householdId).eq('is_active',true)
  const accounts=data??[];if(!accounts.length)return null
  const n=norm(hint)
  if(n){const exact=accounts.find((a:any)=>norm(a.name)===n);if(exact)return exact;const partial=accounts.find((a:any)=>norm(a.name).includes(n)||n.includes(norm(a.name)));if(partial)return partial}
  return accounts.find((a:any)=>a.account_type==='CASH')??accounts[0]
}

const keywordMap: Array<[RegExp,string[]]> = [
  [/makan|nasi|restoran|restaurant|bakmi|kopi|coffee|gofood|grabfood|delivery/i,['food','restaurant','coffee','delivery']],
  [/belanja|supermarket|indomaret|alfamart|grocer/i,['groceries','food']],
  [/bensin|bbm|fuel|pertamina|shell/i,['fuel','transport']],
  [/parkir|parking/i,['parking']], [/tol|toll/i,['toll']], [/grab|gocar|taxi/i,['taxi','transport']],
  [/listrik|pln/i,['electricity','housing']], [/internet|wifi|indihome/i,['internet','housing']], [/air|pdam/i,['water','housing']],
  [/popok|diaper/i,['diapers','child']], [/obat|dokter|hospital|clinic|kesehatan/i,['healthcare']],
  [/gaji|salary/i,['salary','income']], [/bonus/i,['bonus','income']]
]

export async function matchCategory(admin:any,householdId:string,command:any) {
  const merchant=norm(command.merchant_hint??command.selector?.merchant)
  if(merchant){
    const {data:rule}=await admin.from('merchant_category_rules').select('category_id,category:categories(id,name,color)').eq('household_id',householdId).eq('merchant_normalized',merchant).maybeSingle()
    if(rule?.category)return rule.category
    const {data:history}=await admin.from('transactions').select('splits:transaction_splits(category_id,category:categories(id,name,color))').eq('household_id',householdId).ilike('merchant_name',`%${merchant.replace(/[%_,]/g,' ')}%`).is('deleted_at',null).order('transaction_at',{ascending:false}).limit(5)
    const found=history?.flatMap((t:any)=>t.splits??[]).find((s:any)=>s.category)?.category;if(found)return found
  }
  const {data}=await admin.from('categories').select('id,name,color,parent_id').eq('household_id',householdId).eq('is_archived',false)
  const categories=data??[];const hint=norm(command.category_hint);const text=norm([command.description,command.merchant_hint,command.selector?.description,command.selector?.merchant].filter(Boolean).join(' '))
  if(hint){const exact=categories.find((c:any)=>norm(c.name)===hint);if(exact)return exact;const partial=categories.find((c:any)=>norm(c.name).includes(hint)||hint.includes(norm(c.name)));if(partial)return partial}
  for(const [re,names] of keywordMap){if(re.test(text)){for(const name of names){const c=categories.find((x:any)=>norm(x.name).includes(name));if(c)return c}}}
  return categories.find((c:any)=>norm(c.name)==='others')??null
}

export async function findCandidates(admin:any,householdId:string,command:any) {
  const selector=command.selector??{};let query=admin.from('transactions').select('id,transaction_type,transaction_at,merchant_name,description,total_amount,currency,source').eq('household_id',householdId).is('deleted_at',null).order('transaction_at',{ascending:false}).limit(20)
  const date=resolveDate(command,true);if(date){query=query.gte('transaction_at',`${date}T00:00:00+07:00`).lte('transaction_at',`${date}T23:59:59.999+07:00`)}
  if(selector.amount!=null)query=query.eq('total_amount',selector.amount)
  const term=norm(selector.merchant||selector.description);if(term){const safe=term.replace(/[%_,()]/g,' ');query=query.or(`merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`)}
  const {data,error}=await query;if(error)throw error;return data??[]
}

export async function buildPreview(admin:any,householdId:string,command:any) {
  if(command.intent==='CREATE_TRANSACTION'){
    const amount=Number(command.amount);const account=await matchAccount(admin,householdId,command.account_hint);const category=command.transaction_type==='TRANSFER'?null:await matchCategory(admin,householdId,command)
    const missing:string[]=[];if(!Number.isFinite(amount)||amount<=0)missing.push('nominal');if(!account)missing.push('akun');if(command.transaction_type!=='TRANSFER'&&!category)missing.push('kategori')
    const date=resolveDate(command,false);const prepared={total_amount:Number.isFinite(amount)?amount:undefined,account_id:account?.id,account_name:account?.name,category_id:category?.id,category_name:category?.name,description:command.description,merchant_name:command.merchant_hint,transaction_at:`${date}T12:00:00+07:00`,transaction_type:command.transaction_type??'EXPENSE',currency:command.currency??'IDR'}
    return{intent:command.intent,requires_confirmation:true,message:missing.length?`Perlu review manual: ${missing.join(', ')} belum jelas.`:'Periksa transaksi berikut sebelum disimpan.',prepared,candidates:[]}
  }
  if(['UPDATE_TRANSACTION','DELETE_TRANSACTION','FIND_TRANSACTION'].includes(command.intent)){
    const candidates=await findCandidates(admin,householdId,command)
    return{intent:command.intent,requires_confirmation:command.intent!=='FIND_TRANSACTION',message:candidates.length===0?'Tidak menemukan transaksi yang cocok.':candidates.length===1?'Ditemukan satu transaksi yang cocok.':`Ditemukan ${candidates.length} transaksi yang cocok. Pilih satu.`,candidates}
  }
  return{intent:command.intent,requires_confirmation:true,message:'Perintah ini belum didukung pada MVP.',candidates:[]}
}
