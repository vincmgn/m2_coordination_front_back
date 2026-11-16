// Une recherche dans le navigateur doit produire UNE trace : le span « GET » du navigateur (movies-web),
// et sous lui, rattaché par traceparent, le span serveur de l'API (movies-api).
import { expect, test } from '@playwright/test'

const JAEGER = process.env.JAEGER_URL ?? 'http://localhost:16686'

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  attributes?: { key: string; value: Record<string, unknown> }[]
}

// API v3 de Jaeger 2.x : la trace au format OTLP. Renvoie les spans par service.
async function spansByService(traceId: string) {
  const res = await fetch(`${JAEGER}/api/v3/traces/${traceId}`)
  if (!res.ok) return {}
  const body = (await res.json()) as {
    result?: { resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] }; scopeSpans: { spans: OtlpSpan[] }[] }[] }
  }
  const result: Record<string, OtlpSpan[]> = {}
  for (const rs of body.result?.resourceSpans ?? []) {
    const service = rs.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue ?? '?'
    result[service] = [...(result[service] ?? []), ...rs.scopeSpans.flatMap((ss) => ss.spans)]
  }
  return result
}

test('une recherche produit une trace front puis back', async ({ page }) => {
  await page.goto('/')
  const requestPromise = page.waitForRequest((r) => r.url().includes('/api/movies/search'))
  await page.getByLabel('Rechercher par titre, genre ou année').fill('godfather')
  const request = await requestPromise

  // 1. Le navigateur envoie traceparent : 00-<trace 32 hex>-<span 16 hex>-01.
  const traceparent = (await request.allHeaders())['traceparent']
  expect(traceparent, 'traceparent absent').toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  const [, traceId, browserSpanId] = traceparent!.split('-')

  // 2. Dans Jaeger, la même trace contient le span du navigateur et, pour enfant, le span serveur de l'API.
  //    Le navigateur exporte par lots (≈ 5 s) : on attend que les deux côtés soient arrivés.
  await expect
    .poll(
      async () => {
        const spans = await spansByService(traceId!)
        const browser = spans['movies-web']?.find((s) => s.spanId === browserSpanId)
        const server = spans['movies-api']?.find((s) => s.parentSpanId === browserSpanId)
        return { browser: browser?.name ?? null, serverParent: server?.parentSpanId ?? null }
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toEqual({ browser: 'GET', serverParent: browserSpanId })

  // 3. La saisie ne quitte pas le navigateur : url.full du span sans « ?q=… ».
  const browser = (await spansByService(traceId!))['movies-web']!.find((s) => s.spanId === browserSpanId)!
  const url = browser.attributes?.find((a) => a.key === 'url.full')?.value.stringValue
  expect(url).toMatch(/\/api\/movies\/search$/)
})
