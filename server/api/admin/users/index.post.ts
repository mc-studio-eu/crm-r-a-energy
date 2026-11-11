import { z } from 'zod'

const bodySchema = z.object({
  email: z.string().email(),
  nom: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe', 'apporteur_externe']),
})

/** Création de compte salarié par l'admin uniquement — invitation par email (ticket 04). */
export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin'])
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Les paramètres de l’invitation sont invalides.' })
  const body = parsed.data

  const admin = supabaseAdmin()
  const config = useRuntimeConfig()

  const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, {
    data: { nom: body.nom, role: body.role },
    redirectTo: `${config.public.appUrl}/reset-password`,
  })
  if (error) throw createError({ statusCode: 400, message: error.message })

  const { error: profileError } = await admin.from('profiles').update({ role: body.role }).eq('id', data.user.id)
  if (profileError) throw createError({ statusCode: 500, message: 'Compte créé mais rôle non attribué. Corrigez le rôle dans Équipe.' })

  return { id: data.user.id, email: body.email }
})
