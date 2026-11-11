export const MAX_LIBELLE_REGLEMENT = 150
export const MAX_NOTE_REGLEMENT = 500
export const MAX_ANNEE_REGLEMENT = 9999
export const MAX_TAUX_REGLEMENT_BPS = 10_000

export interface ReglementFournisseurChamps {
  libelle: string
  date_prevue: string | null
  annee_prevue: number | null
  montant_cents: number | null
  taux_bps: number | null
  date_reception: string | null
  note: string | null
}

export interface ReglementFournisseur extends ReglementFournisseurChamps {
  id: string
}

export type ActionReglementFournisseur =
  | ({ action: 'enregistrer', id?: string } & ReglementFournisseurChamps)
  | { action: 'supprimer', id: string }
