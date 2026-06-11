import { z } from 'zod'

const bodySchema = z.object({
  role: z.enum(['admin', 'telepro', 'commercial']).optional(),
  actif: z.boolean().optional(),
  nom: z.string().min(1).optional(),
})

/** Activer/désactiver un compte ou changer le rôle (admin, ticket 04). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))

  if (id === me.id && body.actif === false) {
    throw createError({ statusCode: 400, message: 'Impossible de désactiver son propre compte' })
  }

  const admin = supabaseAdmin()
  const { error } = await admin.from('profiles').update(body).eq('id', id)
  if (error) throw createError({ statusCode: 500, message: error.message })

  // Un compte désactivé ne peut plus se connecter : on bannit côté auth.
  if (body.actif !== undefined) {
    await admin.auth.admin.updateUserById(id, {
      ban_duration: body.actif ? 'none' : '876000h',
    })
  }

  return { ok: true }
})
