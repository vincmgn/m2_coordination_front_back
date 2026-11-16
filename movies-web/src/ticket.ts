const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const MESSAGES: Record<number, string> = {
  401: 'Votre session a expiré. Reconnectez-vous.',
  404: 'Cette réservation est introuvable.',
  409: "Cette réservation a été annulée : elle n'a plus de billet.",
  429: 'Trop de billets demandés en peu de temps. Réessayez dans une minute.',
}
export const FALLBACK = "Le billet n'a pas pu être préparé. Réessayez dans un instant."
export const OFFLINE = 'Connexion impossible : vérifiez votre réseau, puis réessayez.'

export const REVOKE_AFTER_MS = 60_000

export class TicketError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'TicketError'
  }
}

export const ticketUrl = (bookingId: string, download = false) =>
  `${BASE_URL}/screenings/mine/${encodeURIComponent(bookingId)}/ticket.pdf${download ? '?download=true' : ''}`

export function filenameFrom(header: string | null, bookingId: string) {
  const name = header?.match(/filename="?([^";]+)"?/)?.[1]?.trim()
  return name && !/[\\/]/.test(name) ? name : `billet-${bookingId}.pdf`
}

async function requestTicket(bookingId: string, download: boolean): Promise<Response> {
  let r: Response
  try {
    r = await fetch(ticketUrl(bookingId, download), {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf, application/json' },
    })
  } catch {
    throw new TicketError(OFFLINE)
  }
  if (!r.ok) {
    let message = MESSAGES[r.status] ?? FALLBACK
    const traceId = r.headers.get('X-Trace-Id')
    if (r.status >= 500 && traceId) message += ` (réf. ${traceId})`
    throw new TicketError(message, r.status)
  }
  if (!(r.headers.get('Content-Type') ?? '').startsWith('application/pdf')) throw new TicketError(FALLBACK, r.status)
  return r
}

export async function fetchTicket(bookingId: string, download = false): Promise<{ blob: Blob; filename: string }> {
  const r = await requestTicket(bookingId, download)
  return { blob: await r.blob(), filename: filenameFrom(r.headers.get('Content-Disposition'), bookingId) }
}

export interface Tab {
  show(url: string): void
  close(): void
}

export interface Browser {
  openTab(): Tab
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  later(fn: () => void, ms: number): void
  save(url: string, filename: string): void
}

export async function openTicket(bookingId: string, browser: Browser): Promise<void> {
  const tab = browser.openTab()
  try {
    const r = await requestTicket(bookingId, false)
    await r.body?.cancel().catch(() => {})
    tab.show(ticketUrl(bookingId))
  } catch (e) {
    tab.close()
    throw e
  }
}

export async function saveTicket(bookingId: string, browser: Browser): Promise<void> {
  const { blob, filename } = await fetchTicket(bookingId, true)
  const url = browser.createObjectURL(blob)
  browser.save(url, filename)
  browser.later(() => browser.revokeObjectURL(url), REVOKE_AFTER_MS)
}

export const realBrowser: Browser = {
  openTab() {
    const win = window.open('', '_blank')
    if (win) win.document.title = 'Préparation du billet…'
    return {
      show: (url) => (win ? win.location.replace(url) : window.location.assign(url)),
      close: () => win?.close(),
    }
  },
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  later: (fn, ms) => void setTimeout(fn, ms),
  save(url, filename) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.append(a)
    a.click()
    a.remove()
  },
}
