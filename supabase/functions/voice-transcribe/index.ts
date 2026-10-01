import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{admin,authUser}=await requireUser(req);await rateLimit(admin,authUser.id,'voice-transcribe',20)
    const form=await req.formData();const file=form.get('file');const householdId=String(form.get('household_id')??'')
    if(!(file instanceof File))throw new Error('Audio file is required');if(!householdId)throw new Error('household_id is required')
    await requireHouseholdAccess(admin,authUser.id,householdId,true)
    if(file.size>25*1024*1024)throw new Error('Audio exceeds 25 MB limit')
    const allowed=['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/flac','video/webm'];if(file.type&&!allowed.includes(file.type))throw new Error('Unsupported audio format')
    const key=Deno.env.get('GROQ_API_KEY');if(!key)throw new Error('GROQ_API_KEY is not configured')
    const primary=Deno.env.get('GROQ_TRANSCRIPTION_MODEL')??'whisper-large-v3-turbo';const fallback=Deno.env.get('GROQ_TRANSCRIPTION_FALLBACK_MODEL')??'whisper-large-v3'
    async function call(model:string){const body=new FormData();body.append('file',file,file.name||'voice.webm');body.append('model',model);body.append('response_format','json');body.append('language','id');body.append('temperature','0');const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body});if(!r.ok)throw new Error(`Groq transcription ${r.status}: ${(await r.text()).slice(0,300)}`);return await r.json()}
    let result:any;let model=primary;try{result=await call(primary)}catch(e){console.warn(e);model=fallback;result=await call(fallback)}
    const transcript=String(result.text??'').trim();if(!transcript)throw new Error('No transcript detected')
    let audioPath:string|null=null
    const{data:pref}=await admin.from('user_preferences').select('voice_retention').eq('user_id',authUser.id).maybeSingle()
    if(pref?.voice_retention&&pref.voice_retention!=='NEVER'){
      audioPath=`${householdId}/${authUser.id}/${crypto.randomUUID()}.${file.name.split('.').pop()||'webm'}`
      const bytes=new Uint8Array(await file.arrayBuffer());const{error:uploadError}=await admin.storage.from('voice-recordings').upload(audioPath,bytes,{contentType:file.type||'audio/webm'});if(uploadError){console.warn('Voice retention upload failed',uploadError);audioPath=null}
      if(pref.voice_retention==='24_HOURS'){
        const cutoff=new Date(Date.now()-86_400_000).toISOString();const{data:old}=await admin.from('voice_commands').select('id,audio_path').eq('user_id',authUser.id).lt('created_at',cutoff).not('audio_path','is',null).limit(30)
        const paths=(old??[]).map((x:any)=>x.audio_path).filter(Boolean);if(paths.length){await admin.storage.from('voice-recordings').remove(paths);await admin.from('voice_commands').update({audio_path:null}).in('id',(old??[]).map((x:any)=>x.id))}
      }
    }
    return json({transcript,model,audio_path:audioPath})
  }catch(e){return handleError(e)}
})
