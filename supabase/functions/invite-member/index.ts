import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'invite-member',10)
    const body=await req.json();const householdId=String(body.household_id??'');const email=String(body.email??'').trim().toLowerCase();const role=String(body.role??'MEMBER')
    if(!householdId||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Valid household_id and email are required');if(!['ADMIN','MEMBER','VIEWER'].includes(role))throw new Error('Invalid role')
    const callerRole=await requireHouseholdAccess(admin,authUser.id,householdId,false);if(!['OWNER','ADMIN'].includes(callerRole))throw new Error('Only owner/admin can invite members')
    const{data:profile}=await admin.from('profiles').select('id').ilike('email',email).maybeSingle()
    if(profile?.id){const{error}=await admin.from('household_members').upsert({household_id:householdId,user_id:profile.id,role},{onConflict:'household_id,user_id'});if(error)throw error;await admin.from('audit_logs').insert({household_id:householdId,actor_user_id:authUser.id,action:'MEMBER_ADDED',entity_type:'member',entity_id:profile.id,after_data:{email,role},source:'MANUAL'});return json({message:'Pengguna yang sudah terdaftar langsung ditambahkan ke household.'})}
    const{data:pending}=await admin.from('household_invitations').select('id').eq('household_id',householdId).eq('email',email).is('accepted_at',null).maybeSingle();let invite:any;if(pending?.id){const{data,error}=await admin.from('household_invitations').update({role,invited_by:authUser.id,expires_at:new Date(Date.now()+7*86_400_000).toISOString()}).eq('id',pending.id).select('token').single();if(error)throw error;invite=data}else{const{data,error}=await admin.from('household_invitations').insert({household_id:householdId,email,role,invited_by:authUser.id,expires_at:new Date(Date.now()+7*86_400_000).toISOString()}).select('token').single();if(error)throw error;invite=data}
    const appUrl=Deno.env.get('APP_URL')??'http://localhost:5173';const{error:authError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:appUrl,data:{household_invite_token:invite.token}});if(authError)throw authError
    return json({message:'Invitation email dikirim. Keanggotaan akan aktif setelah pengguna menerima undangan.'})
  }catch(e){return handleError(e)}
})
