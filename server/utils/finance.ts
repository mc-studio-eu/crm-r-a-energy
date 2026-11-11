import { z } from 'zod'
import { FINANCE_TYPES, MAX_FINANCE_BENEFICIAIRES, MAX_FINANCE_CENTS } from '~~/shared/finance'

const cents = z.number().int().min(1).max(MAX_FINANCE_CENTS)
const uuid = z.uuid()
const note = z.string().trim().max(500)
const repartition = z.object({ beneficiaire_id: uuid, fonction: z.string().trim().min(1).max(80) })

export const financeActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('commission'),
    commission_cents: z.number().int().min(0).max(MAX_FINANCE_CENTS),
    repartitions: z.array(z.union([
      repartition.extend({ taux_bps: z.number().int().min(0).max(10_000), montant_cents: z.never().optional() }),
      repartition.extend({ montant_cents: z.number().int().min(0).max(MAX_FINANCE_CENTS), taux_bps: z.never().optional() }),
    ])).max(MAX_FINANCE_BENEFICIAIRES),
  }),
  z.object({
    action: z.literal('echeance'),
    id: uuid.optional(),
    repartition_id: uuid.nullable(),
    date_prevue: z.iso.date(),
    montant_cents: cents,
    note,
  }),
  z.object({
    action: z.literal('paiement'),
    id: uuid.optional(),
    echeance_id: uuid,
    date_paiement: z.iso.date(),
    montant_cents: cents,
    note,
  }),
  z.object({ action: z.literal('supprimer_echeance'), id: uuid }),
  z.object({ action: z.literal('supprimer_paiement'), id: uuid }),
])

export const financeBeneficiaireSchema = z.object({
  nom: z.string().trim().min(1).max(150),
  profil_id: uuid.nullable(),
  actif: z.boolean(),
})

export const financeQuerySchema = z.object({
  annee: z.coerce.number().int().min(1900).max(2200),
  mois: z.coerce.number().int().min(1).max(12).optional(),
  societe: uuid.optional(),
  fournisseur: z.string().trim().min(1).max(50).optional(),
  energie: z.enum(['gaz', 'electricite']).optional(),
  beneficiaire: uuid.optional(),
  commercial: uuid.optional(),
  dossiers_page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  type: z.enum(Object.keys(FINANCE_TYPES) as (keyof typeof FINANCE_TYPES)[]).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
})

export function validerFinance<T>(schema: z.ZodType<T>, valeur: unknown): T {
  const result = schema.safeParse(valeur)
  if (!result.success) throw createError({ statusCode: 400, message: 'Vérifiez les dates, montants et champs renseignés.' })
  return result.data
}

export function financeIdentifiant(value: unknown) {
  return validerFinance(uuid, value)
}

export function leverErreurFinance(error: { code: string, message: string }): never {
  if (error.code === '22023') throw createError({ statusCode: 422, message: error.message })
  if (error.code === 'P0002') throw createError({ statusCode: 404, message: error.message })
  if (error.code === '42501') throw createError({ statusCode: 403, message: 'Accès financier refusé.' })
  if (error.code === '23503' || error.code === '23505' || error.code === '40001') {
    throw createError({ statusCode: 409, message: 'Ces données ont changé ou sont déjà utilisées. Actualisez et réessayez.' })
  }
  throw createError({ statusCode: 500, message: 'Impossible de traiter cette opération financière.' })
}
