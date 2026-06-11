import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { serverSupabaseUser, serverSupabaseClient } from '#supabase/server'
import type { UserRole } from '~~/shared/types'

/** Client service-role : bypass RLS, usage serveur uniquement. */
export function supabaseAdmin() {
  const config = useRuntimeConfig()
  return createClient(
    process.env.SUPABASE_URL!,
    config.supabaseServiceRoleKey,
    { auth: { persistSession: false } },
  )
}

/** Vérifie l'authentification et (optionnellement) le rôle. Renvoie le profil. */
export async function requireRole(event: H3Event, roles?: UserRole[]) {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }
  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, nom, actif, adresse_depart, depart_lat, depart_lng, google_calendar_connected')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.actif) {
    throw createError({ statusCode: 403, message: 'Compte désactivé' })
  }
  if (roles && !roles.includes(profile.role)) {
    throw createError({ statusCode: 403, message: 'Accès refusé pour ce rôle' })
  }
  return profile
}

export { serverSupabaseClient }
