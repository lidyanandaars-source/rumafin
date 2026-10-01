function extractGeminiText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p: any) => p.text ?? '').join('')
  if (!text) throw new Error('Gemini returned no usable output')
  return text
}

export async function geminiJson<T>(args: { model: string; system: string; prompt: string; schema: unknown; media?: { data: string; mimeType: string } }) {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY is not configured')
  const parts: any[] = [{ text: args.prompt }]
  if (args.media) parts.push({ inline_data: { mime_type: args.media.mimeType, data: args.media.data } })
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`, {
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({ systemInstruction:{parts:[{text:args.system}]}, contents:[{role:'user',parts}], generationConfig:{temperature:0.1,responseMimeType:'application/json',responseJsonSchema:args.schema} })
  })
  if (!response.ok) throw new Error(`Gemini API ${response.status}: ${(await response.text()).slice(0,500)}`)
  const raw = await response.json(); const text = extractGeminiText(raw)
  return { parsed: JSON.parse(text) as T, raw, model: raw.modelVersion ?? args.model }
}

export async function groqJson<T>(args: { model: string; system: string; prompt: string; schema: unknown; schemaName: string }) {
  const key = Deno.env.get('GROQ_API_KEY'); if (!key) throw new Error('GROQ_API_KEY is not configured')
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:args.model,messages:[{role:'system',content:args.system},{role:'user',content:args.prompt}],temperature:0,response_format:{type:'json_schema',json_schema:{name:args.schemaName,strict:true,schema:args.schema}}})})
  if(!response.ok) throw new Error(`Groq API ${response.status}: ${(await response.text()).slice(0,500)}`)
  const raw=await response.json();const text=raw?.choices?.[0]?.message?.content;if(!text)throw new Error('Groq returned no usable output')
  return{parsed:JSON.parse(text) as T,raw,model:raw.model??args.model}
}
