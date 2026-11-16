// Billet PDF d'une réservation : récupéré par fetch (cookie de session, même origine via /api), jamais par un lien direct.
// Un lien direct afficherait le JSON d'une erreur (409, 404…) dans un onglet ; ici chaque code devient une phrase.
// Contrat : GET /screenings/mine/:bookingId/ticket.pdf[?download=true] (cf. movies-api-loadtest/src/routes/tickets.ts).

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const MESSAGES: Record<number, string> = {
  401: 'Votre session a expiré. Reconnectez-vous.',
  404: 'Cette réservation est introuvable.',
  409: "Cette réservation a été annulée : elle n'a plus de billet.",
}
export const FALLBACK = "Le billet n'a pas pu être préparé. Réessayez dans un instant."
export const OFFLINE = 'Connexion impossible : vérifiez votre réseau, puis réessayez.'

// « Enregistrer » : délai avant de libérer l'URL du blob, le temps que le navigateur écrive le fichier.
export const REVOKE_AFTER_MS = 60_000

export class TicketError extends Error {
  constructor(
    message: string,
    readonly status = 0, // 0 : pas de réponse (hors ligne)
  ) {
    super(message)
    this.name = 'TicketError'
  }
}

export const ticketUrl = (bookingId: string, download = false) =>
  `${BASE_URL}/screenings/mine/${encodeURIComponent(bookingId)}/ticket.pdf${download ? '?download=true' : ''}`

// Nom proposé par le serveur (Content-Disposition), sinon un nom neutre construit avec l'identifiant.
export function filenameFrom(header: string | null, bookingId: string) {
  const name = header?.match(/filename="?([^";]+)"?/)?.[1]?.trim()
  // Pas de chemin dans un nom de fichier.
  return name && !/[\\/]/.test(name) ? name : `billet-${bookingId}.pdf`
}

export async function fetchTicket(bookingId: string, download = false): Promise<{ blob: Blob; filename: string }> {
  let r: Response
  try {
    r = await fetch(ticketUrl(bookingId, download), {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf, application/json' },
    })
  } catch {
    throw new TicketError(OFFLINE) // fetch ne rejette que sans réponse : réseau coupé, API injoignable
  }
  // Un 404 a aussi un corps : sans ce test, on enregistrerait du JSON sous le nom d'un PDF.
  if (!r.ok) {
    let message = MESSAGES[r.status] ?? FALLBACK
    const traceId = r.headers.get('X-Trace-Id')
    if (r.status >= 500 && traceId) message += ` (réf. ${traceId})`
    throw new TicketError(message, r.status)
  }
  // Un 200 qui n'est pas un PDF : page HTML d'un proxy, d'un portail Wi-Fi ou de l'index du front (route inconnue).
  if (!(r.headers.get('Content-Type') ?? '').startsWith('application/pdf')) throw new TicketError(FALLBACK, r.status)
  return { blob: await r.blob(), filename: filenameFrom(r.headers.get('Content-Disposition'), bookingId) }
}

// --- Affichage ---------------------------------------------------------------------------------
// Tout ce qui touche au navigateur passe par cet objet : les tests le remplacent par un faux.

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

// Onglet ouvert AVANT l'attente : ouvert pendant le clic, il n'est pas bloqué comme fenêtre surgissante.
// Le fetch vérifie la réponse (erreur → phrase, onglet refermé) ; une fois le billet confirmé, l'onglet affiche
// l'URL du serveur et non un blob: : le bouton « Télécharger » du lecteur PDF du navigateur relit l'URL affichée.
// Avec un blob révoqué il échouait (« Vérifiez votre connexion »), et sinon nommait le fichier d'après l'UUID du blob.
// Ici il relit le serveur (cookie de session, même origine) et prend le nom de Content-Disposition.
// Prix : le PDF est fabriqué deux fois (≈ 23 Ko, quelques dizaines de ms).
export async function openTicket(bookingId: string, browser: Browser): Promise<void> {
  const tab = browser.openTab()
  try {
    await fetchTicket(bookingId)
    tab.show(ticketUrl(bookingId))
  } catch (e) {
    tab.close() // pas d'onglet vide
    throw e
  }
}

// Enregistrer : aucun onglet, le nom vient du serveur (download=true → attachment).
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
      // Fenêtre bloquée malgré tout : on affiche le PDF dans l'onglet courant plutôt que rien.
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
    a.download = filename // sans lui, le navigateur choisit un nom aléatoire
    document.body.append(a)
    a.click()
    a.remove()
  },
}
