import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function setup(body: Record<string, unknown>) {
  const existing = { id: 'rdv', prospect_id: 'dossier', commercial_id: 'disabled', statut: 'planifie', debut: '2026-11-11T10:00:00Z', fin: '2026-11-11T11:00:00Z', lieu_lat: 48, lieu_lng: 2 }
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('requireRole', vi.fn().mockResolvedValue({ id: 'admin', role: 'admin' }))
  vi.stubGlobal('getRouterParam', () => 'rdv')
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue(body))
  vi.stubGlobal('supabaseAdmin', () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: existing }) }) }), update }) }))
  const access = vi.fn().mockResolvedValue({ id: 'dossier' })
  const intervenant = vi.fn().mockRejectedValue(new Error('Intervenant inactif'))
  const sync = vi.fn().mockResolvedValue({ status: 'synced' })
  vi.stubGlobal('requireVisibleProspect', access)
  vi.stubGlobal('requireRdvIntervenant', intervenant)
  vi.stubGlobal('syncRdvCalendar', sync)
  const { default: handler } = await import('../server/api/rdv/[id].patch')
  return { handler, update, access, intervenant, sync }
}

describe('Modification des rendez-vous après désactivation d’un intervenant', () => {
  it('permet à l’admin d’annuler et synchroniser après contrôle du dossier', async () => {
    const { handler, intervenant, update, access, sync } = await setup({ statut: 'annule' })
    // The handler's event is unused by these platform mocks.
    await handler({} as Parameters<typeof handler>[0])
    expect(access).toHaveBeenCalled()
    expect(intervenant).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ statut: 'annule' })
    expect(sync).toHaveBeenCalledWith('rdv')
  })
  it('refuse une nouvelle planification pour un intervenant inactif', async () => {
    const { handler, intervenant, update } = await setup({ debut: '2026-11-11T10:15:00Z' })
    await expect(handler({} as Parameters<typeof handler>[0])).rejects.toThrow('Intervenant inactif')
    expect(intervenant).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
