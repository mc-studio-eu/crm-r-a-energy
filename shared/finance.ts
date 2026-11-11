export const MAX_FINANCE_CENTS = 1_000_000_000_000
export const FINANCE_PAGE_SIZE = 75

export const FINANCE_TYPES = {
  signature: 'Commission fournisseur signée',
  part_signee: 'Part bénéficiaire signée',
  part_ra: 'Part R&A signée',
  entree_prevue: 'Encaissement prévu',
  sortie_prevue: 'Reversement prévu',
  entree_reelle: 'Encaissement reçu',
  sortie_reelle: 'Reversement payé',
} as const

export type FinanceType = keyof typeof FINANCE_TYPES

export interface FinanceBeneficiaire {
  id: string
  nom: string
  profil_id: string | null
  actif: boolean
}

export interface FinanceRepartition {
  id: string
  beneficiaire_id: string
  beneficiaire: string
  taux_bps: number
  fonction: string
  montant_cents: number
}

export interface FinancePaiement {
  id: string
  date_paiement: string
  montant_cents: number
  note: string | null
}

export interface FinanceEcheance {
  id: string
  repartition_id: string | null
  date_prevue: string
  montant_cents: number
  note: string | null
  paiements: FinancePaiement[]
}

export interface FinanceDossier {
  commission_cents: number | null
  repartitions: FinanceRepartition[]
  echeances: FinanceEcheance[]
}

export interface FinanceLigne {
  id: string
  prospect_id: string
  dossier: string
  societe: string
  fournisseur: string | null
  energie: string | null
  date_signature: string | null
  debut_livraison: string | null
  fin_livraison: string | null
  type: FinanceType
  date: string
  montant_cents: number | null
  beneficiaire: string | null
}

export interface FinanceTableau {
  admin: boolean
  total: number
  lignes: FinanceLigne[]
  mois: { mois: number, type: FinanceType, nombre: number, montant_cents: string | null }[]
  total_dossiers: number
  dossiers: (Pick<FinanceLigne, 'prospect_id' | 'dossier' | 'societe' | 'fournisseur' | 'energie' | 'date_signature' | 'debut_livraison' | 'fin_livraison'> & {
    montant_cents: number
    paye_cents: number
    reste_cents: number
    retard_cents: number
    prochaine_echeance: string | null
  })[]
  bilan_personnel: { paye_cents: string, reste_cents: string, retard_cents: string, prochaine_echeance: string | null } | null
  retards_admin: { encaissement_cents: string, reversement_cents: string } | null
  incomplets: { prospect_id: string, dossier: string, sans_date: boolean, sans_commission: boolean }[]
  total_incomplets: number
}

export interface FinanceAnnuaire {
  beneficiaires: FinanceBeneficiaire[]
  profils: { id: string, nom: string }[]
}

export type FinanceAction =
  | { action: 'commission', commission_cents: number, repartitions: { beneficiaire_id: string, taux_bps: number, fonction: string }[] }
  | { action: 'echeance', id?: string, repartition_id: string | null, date_prevue: string, montant_cents: number, note: string }
  | { action: 'paiement', id?: string, echeance_id: string, date_paiement: string, montant_cents: number, note: string }
  | { action: 'supprimer_echeance' | 'supprimer_paiement', id: string }

/** Parse a two-decimal user entry exactly, without passing through a float. */
export function parseFinanceDecimal(value: string, max: number): number | null {
  const match = /^([0-9]+)(?:[,.]([0-9]{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const scaled = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(scaled) && scaled <= max ? scaled : null
}

export function financeDecimal(value: number | null): string {
  if (value === null) return ''
  return `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`
}

const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

export function financeEuros(value: number | bigint | string | null): string {
  if (value === null) return '—'
  const cents = BigInt(value)
  const absolute = cents < 0n ? -cents : cents
  const parts = currency.formatToParts(absolute / 100n)
    .map(part => part.type === 'fraction' ? String(absolute % 100n).padStart(2, '0') : part.value)
    .join('')
  return cents < 0n ? `−${parts}` : parts
}

export function financeDate(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function financeToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date())
}
