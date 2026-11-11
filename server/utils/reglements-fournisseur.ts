import { z } from 'zod'
import { MAX_FINANCE_CENTS } from '~~/shared/finance'
import {
  MAX_ANNEE_REGLEMENT, MAX_LIBELLE_REGLEMENT, MAX_NOTE_REGLEMENT, MAX_TAUX_REGLEMENT_BPS,
} from '~~/shared/reglements-fournisseur'

export const COLONNES_REGLEMENT_FOURNISSEUR = 'id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note'

const date = z.iso.date().refine(value => !value.startsWith('0000-')).nullable()
const uuid = z.uuid()

export const actionReglementFournisseurSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('enregistrer'),
    id: uuid.optional(),
    libelle: z.string().trim().min(1).max(MAX_LIBELLE_REGLEMENT),
    date_prevue: date,
    annee_prevue: z.number().int().min(1).max(MAX_ANNEE_REGLEMENT).nullable(),
    montant_cents: z.number().int().min(1).max(MAX_FINANCE_CENTS).nullable(),
    taux_bps: z.number().int().min(1).max(MAX_TAUX_REGLEMENT_BPS).nullable(),
    date_reception: date,
    note: z.string().trim().max(MAX_NOTE_REGLEMENT).nullable(),
  }),
  z.strictObject({ action: z.literal('supprimer'), id: uuid }),
]).refine(action => action.action === 'supprimer' || action.date_prevue === null || action.annee_prevue === null)

export function identifiantDossierReglement(value: unknown) {
  const result = uuid.safeParse(value)
  if (!result.success) throw createError({ statusCode: 400, message: 'Identifiant de dossier invalide.' })
  return result.data
}

export function leverErreurReglementFournisseur(error: { code: string }): never {
  if (error.code === '42501') throw createError({ statusCode: 403, message: 'Accès aux règlements fournisseur refusé.' })
  if (error.code === '23503') throw createError({ statusCode: 404, message: 'Dossier introuvable.' })
  if (error.code === '23514') throw createError({ statusCode: 400, message: 'Vérifiez les champs du règlement.' })
  throw createError({ statusCode: 500, message: 'Impossible de traiter les règlements fournisseur.' })
}
