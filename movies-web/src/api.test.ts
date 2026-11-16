// Messages d'erreur de l'API : un refus métier garde le message du back, une panne affiche la référence de trace.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getMovie, listMyBookings } from './api'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })))
}

afterEach(() => vi.unstubAllGlobals())

describe('api : erreurs', () => {
  it('500 : message générique suivi de la référence de trace', async () => {
    answer(500, { error: 'Erreur interne du serveur' }, { 'X-Trace-Id': TRACE_ID })
    const error = await getMovie('573a1390f29313caabcd42e8').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(`Le service est momentanément indisponible. (réf. ${TRACE_ID})`)
    expect(error.traceId).toBe(TRACE_ID)
  })

  it('4xx : message du back, sans référence', async () => {
    answer(401, { error: 'Connexion requise' }, { 'X-Trace-Id': TRACE_ID })
    const error = await listMyBookings().catch((e) => e)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Connexion requise')
  })

  it('réponse correcte : le corps JSON est renvoyé tel quel', async () => {
    answer(200, [])
    await expect(listMyBookings()).resolves.toEqual([])
  })
})
