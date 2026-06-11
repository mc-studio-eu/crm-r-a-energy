/** Extrait un message lisible d'une erreur $fetch / inconnue. */
export function errorMessage(e: unknown, fallback = 'Une erreur est survenue'): string {
  if (typeof e === 'object' && e !== null) {
    const err = e as { data?: { message?: string, statusMessage?: string }, statusMessage?: string, message?: string }
    return err.data?.message ?? err.data?.statusMessage ?? err.statusMessage ?? err.message ?? fallback
  }
  return fallback
}
