import { z } from 'zod'

const querySchema = z.object({ q: z.string().min(3, 'Recherche trop courte') })

interface Etablissement {
  siret: string
  adresse: string | null
  code_postal: string | null
  libelle_commune: string | null
}

interface RechercheResult {
  siren: string | null
  nom_raison_sociale: string | null
  nom_complet: string | null
  siege: Etablissement | null
}

/** Recherche d'entreprises par nom/raison sociale pour proposer des fiches prospect. */
export default defineEventHandler(async (event) => {
  await requireRole(event)
  const { q } = querySchema.parse(getQuery(event))

  const data = await $fetch<{ results: RechercheResult[] }>(
    'https://recherche-entreprises.api.gouv.fr/search',
    { query: { q, page: 1, per_page: 8 } },
  ).catch(() => null)

  return (data?.results ?? []).map((r) => {
    const etab = r.siege
    return {
      raison_sociale: r.nom_raison_sociale ?? r.nom_complet ?? '',
      siret: etab?.siret ?? '',
      adresse: etab?.adresse ?? '',
      code_postal: etab?.code_postal ?? '',
      ville: etab?.libelle_commune ?? '',
    }
  }).filter(r => r.raison_sociale)
})
