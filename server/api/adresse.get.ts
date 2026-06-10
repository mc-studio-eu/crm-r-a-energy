import { z } from 'zod'

const querySchema = z.object({ q: z.string().min(3) })

interface BanFeature {
  properties: {
    label: string
    name: string
    postcode: string
    city: string
  }
  geometry: { coordinates: [number, number] }
}

/** Autocomplétion d'adresse (Base Adresse Nationale) à la saisie d'une fiche prospect. */
export default defineEventHandler(async (event) => {
  await requireRole(event)
  const { q } = querySchema.parse(getQuery(event))

  const data = await $fetch<{ features: BanFeature[] }>(
    'https://api-adresse.data.gouv.fr/search/',
    { query: { q, limit: 5, type: 'housenumber', autocomplete: 1 } },
  ).catch(() => null)

  return (data?.features ?? []).map(f => ({
    label: f.properties.label,
    adresse: f.properties.name,
    code_postal: f.properties.postcode,
    ville: f.properties.city,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }))
})
