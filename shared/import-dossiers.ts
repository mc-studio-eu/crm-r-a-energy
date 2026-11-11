import { ASSIGNABLE_ROLES, type Fournisseur, type ProspectStatut, type UserRole } from './types'

export const IMPORT_MAX_MB = 2
export const IMPORT_MAX_BYTES = IMPORT_MAX_MB * 1024 * 1024
export const IMPORT_MAX_ROWS = 1000
export const IMPORT_MAX_COLUMNS = 64

export const IMPORT_COLUMNS = {
  raison_sociale: { label: 'Société', required: true, aliases: ['raison sociale', 'entreprise', 'nom société', 'client'] },
  commission_ht: { label: 'Commission HT', required: true, aliases: ['commission € ht', 'commission', 'commission ht €', 'montant ht'] },
  statut: { label: 'Statut', required: false, aliases: ['état', 'statut dossier'] },
  siret: { label: 'SIRET', required: false, aliases: ['n° siret', 'numéro siret'] },
  fournisseur: { label: 'Fournisseur', required: false, aliases: ['fournisseur énergie'] },
  energie: { label: 'Énergie', required: false, aliases: ['type énergie'] },
  date_signature: { label: 'Date de signature', required: false, aliases: ['date signature', 'signature'] },
  debut_livraison: { label: 'Début de livraison', required: false, aliases: ['début livraison', 'date début', 'date début livraison'] },
  fin_livraison: { label: 'Fin de livraison', required: false, aliases: ['fin livraison', 'date fin', 'date fin livraison'] },
  assigne_a: { label: 'Commercial ou régie', required: false, aliases: ['commercial', 'régie', 'assigné à', 'intervenant'] },
  teleprospecteur_id: { label: 'Téléprospecteur', required: false, aliases: ['télépro', 'téléprospection'] },
} as const

export type ImportColumn = keyof typeof IMPORT_COLUMNS
export const IMPORT_COLUMN_KEYS = Object.keys(IMPORT_COLUMNS) as ImportColumn[]
export type ImportMapping = Partial<Record<ImportColumn, number>>
export type ImportStatusMapping = Record<string, ProspectStatut>
export type ImportCell = string | number | Date | boolean | null
export type ImportProfile = { id: string, nom: string, role: UserRole }
export type ImportSelection = { line: number, allowDuplicate: boolean, fournisseur: string | null }

export interface ImportSheet {
  name: string
  headers: string[]
  rows: number
}

export interface ImportDossier {
  raison_sociale: string
  siret: string | null
  commission_cents: number | null
  statut: ProspectStatut | null
  fournisseur: string | null
  energie: 'gaz' | 'electricite' | null
  date_signature: string | null
  debut_livraison: string | null
  fin_livraison: string | null
  assigne_a: string | null
  teleprospecteur_id: string | null
}

export interface ImportRow {
  line: number
  dossier: ImportDossier
  statusLabel: string
  errors: string[]
  duplicateInCrm: boolean
  duplicateInFile: boolean
}

export interface ImportPreview {
  rows: ImportRow[]
  unknownStatuses: { key: string, label: string }[]
  profiles: ImportProfile[]
  fournisseurs: Fournisseur[]
}

export interface ImportResult {
  count: number
  dossiers: { line: number, id: string }[]
}

export function normalizeImportText(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[_\s]+/g, ' ').trim()
}

export function inferImportMapping(headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeImportText)
  const mapping: ImportMapping = {}
  for (const key of IMPORT_COLUMN_KEYS) {
    const { label, aliases } = IMPORT_COLUMNS[key]
    const labels = [key, label, ...aliases].map(normalizeImportText)
    const matches = normalized.flatMap((header, index) => labels.includes(header) ? [index] : [])
    if (matches.length === 1 && !Object.values(mapping).includes(matches[0]!)) {
      mapping[key] = matches[0]
    }
  }
  return mapping
}

export function importCellText(cell: ImportCell) {
  return cell instanceof Date
    ? Number.isFinite(cell.getTime()) ? cell.toISOString().slice(0, 10) : ''
    : String(cell ?? '').trim()
}

export function isBlankImportRow(row: ImportCell[]) {
  return row.every(cell => !importCellText(cell))
}

const MAX_COMMISSION_CENTS = 1_000_000_000_000

/** Null signifie « inconnue ». Une valeur mal formée est signalée dans l’aperçu. */
export function parseImportCommission(cell: ImportCell): number | null {
  if (cell === null || (typeof cell === 'string' && !cell.trim())) return null

  // Excel stocke parfois un résultat arrondi à quelques unités de précision binaire.
  if (typeof cell === 'number') {
    const scaled = cell * 100
    const cents = Math.round(scaled)
    if (cell < 0 || cents > MAX_COMMISSION_CENTS || !Number.isSafeInteger(cents)
      || Math.abs(scaled - cents) > Math.max(1e-8, Number.EPSILON * scaled)) {
      throw new Error('Commission HT invalide')
    }
    return cents
  }

  if (typeof cell !== 'string') throw new Error('Commission HT invalide')
  const text = cell.trim().replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '').trim().replace(/[\u00a0\u202f]/g, ' ')
  const amount = /^(\d+|\d{1,3}(?: \d{3})+)(?:[,.](\d{1,2}))?$/.exec(text)
  const cents = amount && Number(amount[1]!.replaceAll(' ', '')) * 100 + Number((amount[2] ?? '').padEnd(2, '0'))
  if (cents === null || cents > MAX_COMMISSION_CENTS || !Number.isSafeInteger(cents)) {
    throw new Error('Commission HT invalide')
  }
  return cents
}

function isoDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 9999) throw new Error('Date invalide')
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('Date invalide')
  }
  return date.toISOString().slice(0, 10)
}

export function parseImportDate(cell: ImportCell, epoch1904 = false): string | null {
  if (cell instanceof Date) return isoDate(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate())
  const text = importCellText(cell)
  if (!text) return null

  if (typeof cell === 'number' && Number.isInteger(cell) && cell >= (epoch1904 ? 0 : 1) && (epoch1904 || cell !== 60)) {
    const start = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, cell < 60 ? 31 : 30)
    const date = new Date(start + cell * 86_400_000)
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const french = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(text)
  if (french) return isoDate(Number(french[4]), Number(french[3]), Number(french[1]))
  throw new Error('Date invalide')
}

const STATUS_ALIASES = new Map<string, ProspectStatut>([
  ['en cours', 'en_cours'], ['nouveau', 'en_cours'], ['a rappeler', 'en_cours'],
  ['rdv place', 'rdv_place'], ['rendez vous place', 'rdv_place'], ['rendez-vous place', 'rdv_place'],
  ['signe', 'signe'], ['perdu', 'perdu'],
])
const ENERGIES = new Map<string, NonNullable<ImportDossier['energie']>>([
  ['gaz', 'gaz'], ['electricite', 'electricite'], ['elec', 'electricite'],
])

function companyNameWithoutEnergy(name: string) {
  const suffix = /\s*\(([^()]*)\)$/.exec(name)
  return suffix && suffix.index > 0 && ENERGIES.has(normalizeImportText(suffix[1]!))
    ? name.slice(0, suffix.index).trimEnd()
    : name
}

type ImportCompany = Pick<ImportDossier, 'raison_sociale' | 'siret' | 'energie'>

export function companyMatchesImport(a: ImportCompany, b: ImportCompany) {
  if (a.energie && b.energie && a.energie !== b.energie) return false
  const aName = normalizeImportText(companyNameWithoutEnergy(a.raison_sociale))
  return (a.siret !== null && a.siret === b.siret)
    || (aName !== '' && aName === normalizeImportText(companyNameWithoutEnergy(b.raison_sociale)))
}

export function parseImportRows(
  sheet: ImportCell[][],
  mapping: ImportMapping,
  statuses: ImportStatusMapping,
  profiles: ImportProfile[],
  epoch1904 = false,
  fournisseurs: Fournisseur[] = [],
): ImportPreview {
  const rows: ImportRow[] = []
  const unknown = new Map<string, string>()
  const fournisseursParNom = new Map(fournisseurs.map(f => [normalizeImportText(f.nom), f]))
  const fournisseursParCode = new Map(fournisseurs.map(f => [normalizeImportText(f.code), f]))

  for (const [index, row] of sheet.entries()) {
    if (index === 0 || isBlankImportRow(row)) continue
    const errors: string[] = []
    const cell = (key: ImportColumn) => row[mapping[key] ?? -1] ?? null
    const text = (key: ImportColumn) => importCellText(cell(key))
    function checked<T>(key: ImportColumn, parse: (cell: ImportCell) => T): T | null {
      try {
        return parse(cell(key))
      } catch {
        errors.push(`${IMPORT_COLUMNS[key].label} invalide.`)
        return null
      }
    }
    function assignee(key: 'assigne_a' | 'teleprospecteur_id', roles: UserRole[]) {
      const value = normalizeImportText(text(key))
      if (!value) return null
      const matches = profiles.filter(profile => roles.includes(profile.role)
        && (profile.id === value || normalizeImportText(profile.nom) === value))
      if (matches.length === 1) return matches[0]!.id
      errors.push(matches.length ? `${IMPORT_COLUMNS[key].label} ambigu. Indiquez son identifiant.` : `${IMPORT_COLUMNS[key].label} introuvable.`)
      return null
    }

    const raisonSociale = text('raison_sociale')
    if (!raisonSociale || raisonSociale.length > 255 || typeof cell('raison_sociale') !== 'string' || raisonSociale.includes('\0')) {
      errors.push('Société manquante ou invalide (255 caractères maximum).')
    }
    const siret = text('siret').replace(/\s/g, '') || null
    if (siret && !/^\d{14}$/.test(siret)) errors.push('Le SIRET doit contenir 14 chiffres.')

    const rawStatus = text('statut')
    const statusLabel = rawStatus.slice(0, 255)
    const statusKey = normalizeImportText(statusLabel)
    const status = rawStatus.length > 255 ? null
      : STATUS_ALIASES.get(statusKey) ?? (Object.hasOwn(statuses, statusKey) ? statuses[statusKey] : null) ?? 'signe'
    if (rawStatus.length > 255) {
      errors.push('Statut invalide (255 caractères maximum).')
    } else if (statusKey && !STATUS_ALIASES.has(statusKey)) {
      unknown.set(statusKey, statusLabel)
    }

    const fournisseurSaisi = text('fournisseur')
    const cleFournisseur = normalizeImportText(fournisseurSaisi)
    const fournisseur = fournisseursParNom.get(cleFournisseur) ?? fournisseursParCode.get(cleFournisseur)
    const energy = normalizeImportText(text('energie'))
    const energie = ENERGIES.get(energy) ?? null
    if (fournisseurSaisi && !fournisseur) errors.push('Fournisseur inconnu.')
    if (fournisseur && !fournisseur.actif) errors.push('Fournisseur désactivé.')
    if (energy && !energie) errors.push('Énergie inconnue. Utilisez Gaz ou Électricité.')
    const date_signature = checked('date_signature', value => parseImportDate(value, epoch1904))
    const debut_livraison = checked('debut_livraison', value => parseImportDate(value, epoch1904))
    const fin_livraison = checked('fin_livraison', value => parseImportDate(value, epoch1904))
    if (debut_livraison && fin_livraison && fin_livraison < debut_livraison) {
      errors.push('La fin de livraison précède le début.')
    }

    const nomSaisi = raisonSociale.slice(0, 255)
    const nomDossier = energie && nomSaisi
      ? `${companyNameWithoutEnergy(nomSaisi)} (${energie === 'electricite' ? 'Élec' : 'Gaz'})`
      : nomSaisi
    if (raisonSociale.length <= 255 && nomDossier.length > 255) {
      errors.push('La société dépasse 255 caractères avec le suffixe de l’énergie.')
    }
    const dossier: ImportDossier = {
      raison_sociale: nomDossier,
      siret: siret?.slice(0, 32) ?? null,
      statut: status ?? null,
      commission_cents: checked('commission_ht', parseImportCommission),
      fournisseur: fournisseur?.actif ? fournisseur.code : null,
      energie,
      date_signature,
      debut_livraison,
      fin_livraison,
      assigne_a: assignee('assigne_a', ASSIGNABLE_ROLES),
      teleprospecteur_id: assignee('teleprospecteur_id', ['telepro']),
    }
    const matching = errors.length ? [] : rows.filter(other => !other.errors.length && companyMatchesImport(dossier, other.dossier))
    for (const other of matching) other.duplicateInFile = true
    rows.push({
      line: index + 1,
      dossier,
      statusLabel,
      errors,
      duplicateInCrm: false,
      duplicateInFile: matching.length > 0,
    })
  }
  return { rows, unknownStatuses: Array.from(unknown, ([key, label]) => ({ key, label })), profiles, fournisseurs }
}
