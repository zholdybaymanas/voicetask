// Internal helper: write one row to api_usage. Never throws — usage
// logging is best-effort and must not affect the actual API response.
//
// `sb` is the service-role Supabase client created in the calling
// endpoint. Pass null/undefined and the call no-ops.
export async function logUsage(sb, row) {
  if (!sb) return
  try {
    const { error } = await sb.from('api_usage').insert(row)
    if (error) console.warn('[api_usage] insert failed:', error.message)
  } catch (err) {
    console.warn('[api_usage] insert threw:', err)
  }
}
