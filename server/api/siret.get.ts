import { z } from 'zod'

const querySchema = z.object({ siret: z.string().regex(/^\d{14}$/, 'SIRET invalide (14 chiffres)') })

interface Etablissement {
  siret: string
  adresse: string | null
  code_postal: string | null
  libelle_commune: string | null
}

interface RechercheResult {
  nom_raison_sociale: string | null
  nom_complet: string | null
  siege: Etablissement | null
  matching_etablissements: Etablissement[] | null
}

/** Recherche d'un établissement par SIRET pour préremplir une fiche prospect. */
export default defineEventHandler(async (event) => {
  await requireRole(event)
  const { siret } = querySchema.parse(getQuery(event))

  const data = await $fetch<{ results: RechercheResult[] }>(
    'https://recherche-entreprises.api.gouv.fr/search',
    { query: { q: siret, page: 1, per_page: 1 } },
  ).catch(() => null)

  const result = data?.results?.[0]
  if (!result) {
    throw createError({ statusCode: 404, message: 'SIRET introuvable' })
  }

  const etab = result.matching_etablissements?.find(e => e.siret === siret)
    ?? (result.siege?.siret === siret ? result.siege : null)
    ?? result.siege

  return {
    raison_sociale: result.nom_raison_sociale ?? result.nom_complet ?? '',
    adresse: etab?.adresse ?? '',
    code_postal: etab?.code_postal ?? '',
    ville: etab?.libelle_commune ?? '',
  }
})
