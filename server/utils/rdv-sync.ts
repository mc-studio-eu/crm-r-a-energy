import { randomUUID } from 'node:crypto'

/** Durable event IDs make a retry after a lost response safe. A lease serializes retries. */
export async function syncRdvCalendar(id: string) {
  const admin = supabaseAdmin()
  const lock = randomUUID()
  const { data: claimed, error: claimError } = await admin.rpc('claim_rdv_sync', { p_id: id, p_lock: lock })
  if (claimError) throw createError({ statusCode: 500, message: 'Synchronisation indisponible' })
  if (!claimed) return { status: 'pending' }
  let revision: number | undefined
  try {
    const { data: rdv, error } = await admin.from('rdv').select('*, prospects(raison_sociale)').eq('id', id).single()
    if (error || !rdv) throw new Error('RDV inaccessible')
    revision = rdv.google_sync_revision
    const { data: credentials } = await admin.from('google_credentials').select('refresh_token').eq('profile_id', rdv.commercial_id).single()
    if (!credentials) {
      await admin.from('rdv').update({ google_sync_status: 'disconnected', google_sync_error: null }).eq('id', id).eq('google_sync_revision', revision)
      return { status: 'disconnected' }
    }
    const token = await refreshAccessToken(credentials.refresh_token)
    const eventId = rdv.google_event_id ?? `crm${id.replaceAll('-', '')}g${rdv.google_event_generation}`
    if (rdv.statut === 'annule') {
      await deleteCalendarEvent(token, eventId)
      const { error: saved } = await admin.from('rdv').update({ google_event_id: null, google_sync_status: 'synced', google_sync_error: null }).eq('id', id).eq('google_sync_revision', revision)
      if (saved) throw saved
    }
    else {
      const input = {
        id: eventId, summary: `${rdv.qualification ?? 'RDV'} — ${rdv.prospects?.raison_sociale ?? 'Dossier'}`,
        description: `Dossier : ${useRuntimeConfig().public.appUrl}/prospects/${rdv.prospect_id}`,
        location: rdv.lieu ?? undefined, start: rdv.debut, end: rdv.fin,
      }
      if (rdv.google_event_id) await updateCalendarEvent(token, eventId, input)
      else {
        try { await createCalendarEvent(token, input) }
        catch (e) {
          if (googleHttpStatus(e) !== 409) throw e
          await updateCalendarEvent(token, eventId, input)
        }
      }
      const { error: saved } = await admin.from('rdv').update({ google_event_id: eventId, google_sync_status: 'synced', google_sync_error: null }).eq('id', id).eq('google_sync_revision', revision)
      if (saved) throw saved
    }
    return { status: 'synced' }
  }
  catch {
    let update = admin.from('rdv').update({ google_sync_status: 'error', google_sync_error: 'Échec Google Agenda. Vérifiez la connexion puis relancez la synchronisation.' }).eq('id', id)
    if (revision !== undefined) update = update.eq('google_sync_revision', revision)
    await update
    return { status: 'error' }
  }
  finally {
    await admin.from('rdv').update({ google_sync_lock: null, google_sync_locked_at: null }).eq('id', id).eq('google_sync_lock', lock)
  }
}
