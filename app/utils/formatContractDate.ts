const formatDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' })

export function formatContractDate(date: string | null) {
  const value = date ? Date.parse(date) : NaN
  return Number.isNaN(value) ? '—' : formatDate.format(value)
}
