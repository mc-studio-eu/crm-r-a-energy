export const USER_ROLES = ['admin', 'administratif', 'telepro', 'commercial', 'regie_interne', 'regie_externe', 'apporteur_externe'] as const
export type UserRole = typeof USER_ROLES[number]

export type ProspectStatut = 'en_cours' | 'rdv_place' | 'signe' | 'perdu'
export type ProspectHistoriqueStatut = ProspectStatut | 'nouveau' | 'a_rappeler'

export type RdvStatut = 'planifie' | 'honore' | 'annule' | 'no_show'

export const PROSPECT_STATUTS: Record<ProspectStatut, string> = {
  en_cours: 'En cours',
  rdv_place: 'RDV placé',
  signe: 'Signé',
  perdu: 'Perdu',
}

export const PROSPECT_HISTORICAL_STATUTS: Record<ProspectHistoriqueStatut, string> = {
  ...PROSPECT_STATUTS,
  nouveau: 'Nouveau',
  a_rappeler: 'À rappeler',
}

/** Couleurs hex des statuts prospect — utilisées par les graphiques du dashboard. */
export const PROSPECT_STATUT_COLORS: Record<ProspectStatut, string> = {
  en_cours: '#3B82F6',
  rdv_place: '#BBC863',
  signe: '#31694E',
  perdu: '#9CA3AF',
}

export interface Fournisseur {
  code: string
  nom: string
  actif: boolean
}

export type Energie = 'gaz' | 'electricite'
export const ENERGIES: Record<Energie, string> = {
  gaz: 'Gaz',
  electricite: 'Électricité',
}

export type RdvQualification = 'R1' | 'R2'
export const RDV_QUALIFICATIONS: Record<RdvQualification, string> = {
  R1: 'R1',
  R2: 'R2',
}

export type GoogleSyncStatus = 'pending' | 'synced' | 'error' | 'disconnected'

export const RDV_STATUTS: Record<RdvStatut, string> = {
  planifie: 'Planifié',
  honore: 'Honoré',
  annule: 'Annulé',
  no_show: 'No-show',
}

export const ROLES: Record<UserRole, string> = {
  admin: 'Admin',
  administratif: 'Administratif',
  telepro: 'Télépro',
  commercial: 'Commercial',
  regie_interne: 'Régie interne',
  regie_externe: 'Régie externe',
  apporteur_externe: 'Apporteur externe',
}

/** Rôles assignables à un prospect / RDV (dropdowns d'assignation). */
export const ASSIGNABLE_ROLES: UserRole[] = ['commercial', 'regie_interne', 'regie_externe']

export const FINANCE_ROLES: UserRole[] = ['admin', 'commercial', 'regie_interne', 'regie_externe', 'apporteur_externe']

export interface Profile {
  id: string
  role: UserRole
  nom: string
  telephone: string | null
  adresse_depart: string | null
  depart_lat: number | null
  depart_lng: number | null
  actif: boolean
  google_calendar_connected: boolean
}

export interface Prospect {
  id: string
  societe_id: string
  raison_sociale: string
  siret: string | null
  contact_nom: string | null
  telephone: string | null
  email: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  lat: number | null
  lng: number | null
  statut: ProspectStatut
  source: string | null
  scoring_entreprise: number | null
  teleprospecteur_id: string | null
  fournisseur: string | null
  energie: Energie | null
  date_signature: string | null
  debut_livraison: string | null
  fin_livraison: string | null
  notes: string | null
  assigne_a: string | null
  cree_par: string | null
  archive: boolean
  created_at: string
  updated_at: string
}

export interface Societe {
  id: string
  raison_sociale: string
  siret: string | null
}

export interface ProspectDocument {
  id: string
  prospect_id: string
  nom: string
  storage_path: string
  mime_type: string | null
  taille: number | null
  uploade_par: string | null
  created_at: string
}

export interface Rdv {
  id: string
  prospect_id: string
  commercial_id: string
  debut: string
  fin: string
  lieu: string | null
  lieu_lat: number | null
  lieu_lng: number | null
  statut: RdvStatut
  qualification: RdvQualification | null
  google_event_id: string | null
  google_sync_status: GoogleSyncStatus
  google_sync_error: string | null
  temps_trajet_min: number | null
  notes: string | null
  created_at: string
}

export interface RdvCheckResult {
  ok: boolean
  disponibilite: { ok: boolean; conflit?: { debut: string; fin: string } | null }
  trajet: {
    ok: boolean
    tempsTrajetMin: number | null
    tempsDisponibleMin: number | null
    margeMin: number
    motif?: string
  }
}
