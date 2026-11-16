import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTracing } from './tracing'

const received: { url: string; headers: Headers }[] = []
const exporter = new InMemorySpanExporter()

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      received.push({ url: String(url), headers: new Headers(init?.headers) })
      return new Response('{"query":"","items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  startTracing({ processor: new SimpleSpanProcessor({ exporter }) })
})

beforeEach(() => {
  received.length = 0
  exporter.reset()
})

const spanOf = (headers: Headers) =>
  vi.waitFor(() => {
    const spanId = headers.get('traceparent')?.split('-')[2]
    const span = exporter.getFinishedSpans().find((s) => s.spanContext().spanId === spanId)
    if (!span) throw new Error(`span ${spanId} pas encore terminé`)
    return span
  })

describe('traces du navigateur', () => {
  it('ajoute un en-tête traceparent W3C échantillonné', async () => {
    const { listGenres } = await import('./api')
    await listGenres()
    expect(received[0]?.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('le span du fetch porte la trace et l’identifiant envoyés dans traceparent', async () => {
    const { listGenres } = await import('./api')
    await listGenres()
    const [, traceId] = received[0]!.headers.get('traceparent')!.split('-')
    const span = await spanOf(received[0]!.headers)
    expect(span.spanContext().traceId).toBe(traceId)
    expect(span.attributes['http.request.method']).toBe('GET')
  })

  it('la saisie d’une recherche ne reste pas dans url.full', async () => {
    const { searchMovies } = await import('./api')
    await searchMovies('dupont cardiologue', new AbortController().signal)
    expect(received[0]?.url).toContain('q=dupont')
    const span = await spanOf(received[0]!.headers)
    const url = String(span.attributes['url.full'])
    expect(url).toContain('/movies/search')
    expect(url).not.toContain('?')
    expect(url).not.toContain('dupont')
  })
})
