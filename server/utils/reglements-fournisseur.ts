import { z } from 'zod'
import { MAX_FINANCE_CENTS } from '~~/shared/finance'
import {
  MAX_ANNEE_REGLEMENT, MAX_LIBELLE_REGLEMENT, MAX_NOTE_REGLEMENT, MAX_TAUX_REGLEMENT_BPS,
} from '~~/shared/reglements-fournisseur'

export const COLONNES_REGLEMENT_FOURNISSEUR = 'id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, montant_recu_cents, note'

const date = z.iso.date().refine(value => !value.startsWith('0000-'))
const uuid = z.uuid()
const montant = z.number().int().min(1).max(MAX_FINANCE_CENTS)

export const actionReglementFournisseurSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('enregistrer'),
    id: uuid.optional(),
    libelle: z.string().trim().min(1).max(MAX_LIBELLE_REGLEMENT),
    date_prevue: date.nullable(),
    annee_prevue: z.number().int().min(1).max(MAX_ANNEE_REGLEMENT).nullable(),
    montant_cents: montant.nullable(),
    taux_bps: z.number().int().min(1).max(MAX_TAUX_REGLEMENT_BPS).nullable(),
    note: z.string().trim().max(MAX_NOTE_REGLEMENT).nullable(),
  }),
  z.strictObject({
    action: z.literal('recevoir'),
    id: uuid,
    date_reception: date,
    montant_recu_cents: montant,
  }),
  z.strictObject({ action: z.literal('annuler_reception'), id: uuid }),
  z.strictObject({ action: z.literal('supprimer'), id: uuid }),
]).refine(action => action.action !== 'enregistrer' || action.date_prevue === null || action.annee_prevue === null)

export function identifiantDossierReglement(value: unknown) {
  const result = uuid.safeParse(value)
  if (!result.success) throw createError({ statusCode: 400, message: 'Identifiant de dossier invalide.' })
  return result.data
}

export function leverErreurReglementFournisseur(error: { code: string, message: string }): never {
  if (error.code === '42501') throw createError({ statusCode: 403, message: 'Accès aux règlements fournisseur refusé.' })
  if (error.code === '22023') throw createError({ statusCode: 422, message: error.message })
  if (error.code === 'P0002') throw createError({ statusCode: 404, message: error.message })
  if (error.code === '23503') throw createError({ statusCode: 404, message: 'Dossier introuvable.' })
  if (error.code === '23514') throw createError({ statusCode: 400, message: 'Vérifiez les champs du règlement.' })
  if (error.code === '40001') throw createError({ statusCode: 409, message: 'Les données ont changé. Actualisez la fiche puis réessayez.' })
  throw createError({ statusCode: 500, message: 'Impossible de traiter les règlements fournisseur.' })
}
