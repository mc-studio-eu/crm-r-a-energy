import type { H3Event } from 'h3'
import type { UserRole } from '~~/shared/types'

export async function requireVisibleProspect(event: H3Event, id: string) {
  const client = await serverSupabaseClient(event)
  const { data, error } = await client.from('prospects').select('id, raison_sociale').eq('id', id).single<{ id: string, raison_sociale: string }>()
  if (error || !data) throw createError({ statusCode: 404, message: 'Dossier inaccessible' })
  return data
}

export async function requireRdvIntervenant(me: { id: string, role: UserRole }, id: string) {
  if (me.role === 'regie_interne' && me.id !== id) throw createError({ statusCode: 403, message: 'Vous pouvez uniquement prendre vos propres rendez-vous' })
  const { data } = await supabaseAdmin().from('profiles').select('id, actif, role').eq('id', id).single()
  if (!data?.actif || !['commercial', 'regie_interne', 'regie_externe'].includes(data.role)) {
    throw createError({ statusCode: 400, message: 'Intervenant inactif ou non autorisé' })
  }
}
