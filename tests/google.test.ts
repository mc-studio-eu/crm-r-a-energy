import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCalendarEvent, deleteCalendarEvent, getBusySlotsExcept } from '../server/utils/google'

afterEach(() => vi.unstubAllGlobals())

describe('Google Calendar retry and conflict behavior', () => {
  it('passes a stable event ID so retries cannot create duplicate events', async () => {
    const fetch = vi.fn().mockResolvedValue({ id: 'crm123' })
    vi.stubGlobal('$fetch', fetch)
    const input = { id: 'crm123', summary: 'R1', start: '2026-11-11T10:00:00Z', end: '2026-11-11T11:00:00Z' }
    await createCalendarEvent('token', input)
    await createCalendarEvent('token', input)
    expect(fetch.mock.calls.map(c => c[1].body.id)).toEqual(['crm123', 'crm123'])
  })
  it('only treats missing/deleted events as successful cancellation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    for (const status of [404, 410]) {
      fetch.mockRejectedValueOnce({ status })
      await expect(deleteCalendarEvent('token', 'id')).resolves.toBeUndefined()
    }
    fetch.mockRejectedValueOnce({ status: 503 })
    await expect(deleteCalendarEvent('token', 'id')).rejects.toEqual({ status: 503 })
  })
  it('excludes only this event, keeps overlapping events and follows pagination', async () => {
    const start = '2026-11-11T10:00:00Z', end = '2026-11-11T11:00:00Z'
    const busy = { start: { dateTime: start }, end: { dateTime: end } }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ nextPageToken: 'next', items: [{ id: 'self', ...busy }, { id: 'other', ...busy }, { id: 'free', transparency: 'transparent', ...busy }] })
      .mockResolvedValueOnce({ items: [{ id: 'all-day', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } }] })
    vi.stubGlobal('$fetch', fetch)
    expect(await getBusySlotsExcept('token', start, end, 'self')).toEqual([{ start, end }, { start, end }])
    expect(fetch.mock.calls[1]?.[1].query.pageToken).toBe('next')
  })
})
