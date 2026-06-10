/**
 * Affiche un nom de salarié lisible.
 * Si le champ `nom` n'a pas été renseigné, Supabase y stocke l'email :
 * on en dérive alors un prénom présentable (partie locale, séparateurs nettoyés).
 */
export function displayName(nom?: string | null): string {
  if (!nom) return '—'
  if (!nom.includes('@')) return nom

  const local = nom.split('@')[0] ?? nom
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || nom
}
