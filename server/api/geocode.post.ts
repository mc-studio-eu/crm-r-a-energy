import { z } from 'zod'

const bodySchema = z.object({ adresse: z.string().min(3) })

/** Géocodage d'adresse à la saisie d'une fiche prospect (ticket 05). */
export default defineEventHandler(async (event) => {
  await requireRole(event)
  const { adresse } = bodySchema.parse(await readBody(event))
  const result = await geocodeAddress(adresse)
  if (!result) {
    throw createError({ statusCode: 422, message: 'Adresse introuvable' })
  }
  return result
})
