export function societeSearch(terme: string) {
  const recherche = terme.trim()
  if (!recherche) return null

  if (/^\d[\d\s]*$/.test(recherche)) {
    return { champ: 'siret', motif: `%${recherche.replace(/\s/g, '')}%` }
  }
  return { champ: 'raison_sociale', motif: `%${recherche.replace(/[\\%_]/g, '\\$&')}%` }
}
