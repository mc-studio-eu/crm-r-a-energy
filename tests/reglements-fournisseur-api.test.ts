import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const dossierId = '00000000-0000-4000-8000-000000000001'
const reglementId = '00000000-0000-4000-8000-000000000002'

function routeGlobals(options: {
  role?: () => Promise<unknown>
  body?: Record<string, unknown>
  db?: () => unknown
}) {
  const requireRole = vi.fn(options.role ?? (async () => ({ id: 'admin', role: 'admin' })))
  const serverSupabaseClient = vi.fn(options.db ?? (() => ({})))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('requireRole', requireRole)
  vi.stubGlobal('getRouterParam', () => dossierId)
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue(options.body ?? {}))
  vi.stubGlobal('serverSupabaseClient', serverSupabaseClient)
  vi.stubGlobal('identifiantDossierReglement', (value: unknown) => value)
  vi.stubGlobal('actionReglementFournisseurSchema', {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  })
  vi.stubGlobal('COLONNES_REGLEMENT_FOURNISSEUR', 'id, libelle')
  vi.stubGlobal('leverErreurReglementFournisseur', (error: unknown) => { throw error })
  return { requireRole, serverSupabaseClient }
}

const validUpsert = {
  action: 'enregistrer',
  libelle: 'Versement contractuel',
  date_prevue: null,
  annee_prevue: 2027,
  montant_cents: null,
  taux_bps: null,
  date_reception: null,
  note: null,
}

describe('API des règlements fournisseur', () => {
  it('refuse le GET et le POST non-admin avant toute requête Supabase', async () => {
    const { requireRole, serverSupabaseClient } = routeGlobals({
      role: async () => { throw new Error('Admin requis') },
    })
    const { default: getHandler } = await import('../server/api/prospects/[id]/reglements-fournisseur.get')
    const { default: postHandler } = await import('../server/api/prospects/[id]/reglements-fournisseur.post')
    const event = {} as Parameters<typeof getHandler>[0]

    await expect(getHandler(event)).rejects.toThrow('Admin requis')
    await expect(postHandler(event)).rejects.toThrow('Admin requis')
    expect(requireRole).toHaveBeenCalledTimes(2)
    expect(requireRole).toHaveBeenCalledWith(event, ['admin'])
    expect(serverSupabaseClient).not.toHaveBeenCalled()
  })

  it('borne la modification et la suppression par le dossier et l’identifiant du règlement', async () => {
    const filters: Array<[string, string]> = []
    const builder = {
      eq(column: string, value: string) { filters.push([column, value]); return this },
      select: vi.fn(function (this: unknown) { return this }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: reglementId }, error: null }),
    }
    const table = {
      update: vi.fn(() => builder),
      delete: vi.fn(() => builder),
    }
    routeGlobals({ body: { ...validUpsert, id: reglementId }, db: () => ({ from: () => table }) })
    const { default: handler } = await import('../server/api/prospects/[id]/reglements-fournisseur.post')
    const event = {} as Parameters<typeof handler>[0]

    await handler(event)
    expect(table.update).toHaveBeenCalledWith({
      libelle: 'Versement contractuel', date_prevue: null, annee_prevue: 2027,
      montant_cents: null, taux_bps: null, date_reception: null, note: null,
    })
    expect(filters).toEqual([['prospect_id', dossierId], ['id', reglementId]])

    filters.length = 0
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ action: 'supprimer', id: reglementId }))
    await handler(event)
    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(filters).toEqual([['prospect_id', dossierId], ['id', reglementId]])
  })
})
