export type UserRole = 'admin' | 'telepro' | 'commercial'

export type ProspectStatut = 'nouveau' | 'a_rappeler' | 'rdv_place' | 'signe' | 'perdu'

export type RdvStatut = 'planifie' | 'honore' | 'annule' | 'no_show'

export const PROSPECT_STATUTS: Record<ProspectStatut, string> = {
  nouveau: 'Nouveau',
  a_rappeler: 'À rappeler',
  rdv_place: 'RDV placé',
  signe: 'Signé',
  perdu: 'Perdu',
}

export const RDV_STATUTS: Record<RdvStatut, string> = {
  planifie: 'Planifié',
  honore: 'Honoré',
  annule: 'Annulé',
  no_show: 'No-show',
}

export const ROLES: Record<UserRole, string> = {
  admin: 'Admin',
  telepro: 'Télépro',
  commercial: 'Commercial',
}

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
  notes: string | null
  assigne_a: string | null
  cree_par: string | null
  archive: boolean
  created_at: string
  updated_at: string
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
  google_event_id: string | null
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
