import { z } from 'zod'
import { USER_ROLES } from '~~/shared/types'

const bodySchema = z.strictObject({
  role: z.enum(USER_ROLES).optional(),
  actif: z.boolean().optional(),
  nom: z.string().trim().min(1).max(120).optional(),
}).refine(body => Object.keys(body).length > 0)

/** Activer/désactiver un compte ou changer le rôle (admin, ticket 04). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!id || !z.uuid().safeParse(id).success || !parsed.success) {
    throw createError({ statusCode: 400, message: 'Les paramètres du compte sont invalides.' })
  }
  const body = parsed.data

  if (id === me.id && body.actif === false) {
    throw createError({ statusCode: 400, message: 'Impossible de désactiver son propre compte' })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin.from('profiles').update(body).eq('id', id).select('id').maybeSingle()
  if (error) throw createError({ statusCode: 500, message: error.message })
  if (!data) throw createError({ statusCode: 404, message: 'Compte introuvable.' })

  // Un compte désactivé ne peut plus se connecter : on bannit côté auth.
  if (body.actif !== undefined) {
    const { error: authError } = await admin.auth.admin.updateUserById(id, {
      ban_duration: body.actif ? 'none' : '876000h',
    })
    if (authError) throw createError({ statusCode: 502, message: 'Le statut CRM a été enregistré. La mise à jour de l’accès au compte a échoué.' })
  }

  return { ok: true }
})
