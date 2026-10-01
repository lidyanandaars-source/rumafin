export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

export function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected error'
  console.error(message)
  return json({ error: message }, message.toLowerCase().includes('authorized') ? 403 : 400)
}
