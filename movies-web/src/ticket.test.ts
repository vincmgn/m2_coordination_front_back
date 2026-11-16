// Billet PDF côté front : contrat de l'appel, traduction des codes, onglet et mémoire.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type Browser,
  FALLBACK,
  fetchTicket,
  filenameFrom,
  MESSAGES,
  OFFLINE,
  openTicket,
  REVOKE_AFTER_MS,
  saveTicket,
  TicketError,
  ticketUrl,
} from './ticket'

const ID = '6560f1a2b3c4d5e6f7a8b9c0'
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

const pdf = (disposition = `inline; filename="billet-${ID}.pdf"`) =>
  new Response(new Blob(['%PDF-1.7 faux'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition },
  })

const problem = (status: number, error = 'détail technique', headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function answer(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function fakeBrowser() {
  const tab = { show: vi.fn(), close: vi.fn() }
  let pending: (() => void) | null = null
  const b = {
    openTab: vi.fn(() => tab),
    createObjectURL: vi.fn(() => 'blob:billet'),
    revokeObjectURL: vi.fn(),
    later: vi.fn((fn: () => void) => {
      pending = fn
    }),
    save: vi.fn(),
  } satisfies Browser
  return { b, tab, runLater: () => pending?.() }
}

afterEach(() => vi.unstubAllGlobals())

describe('Contrat', () => {
  it("URL : un identifiant seulement, download=true pour l'enregistrement", () => {
    expect(ticketUrl(ID)).toBe(`/api/screenings/mine/${ID}/ticket.pdf`)
    expect(ticketUrl(ID, true)).toBe(`/api/screenings/mine/${ID}/ticket.pdf?download=true`)
  })

  it('nom du fichier : celui du serveur, sinon un nom neutre avec le numéro', () => {
    expect(filenameFrom(`attachment; filename="billet-${ID}.pdf"`, ID)).toBe(`billet-${ID}.pdf`)
    expect(filenameFrom('inline; filename=billet-42.pdf', ID)).toBe('billet-42.pdf')
    expect(filenameFrom(null, ID)).toBe(`billet-${ID}.pdf`)
    expect(filenameFrom('inline', ID)).toBe(`billet-${ID}.pdf`)
    expect(filenameFrom('attachment; filename="../../x.pdf"', ID)).toBe(`billet-${ID}.pdf`)
  })

  it('envoie le cookie de session et accepte un PDF ou une erreur JSON', async () => {
    const fetchMock = answer(pdf())
    await fetchTicket(ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/screenings/mine/${ID}/ticket.pdf`)
    expect(init?.credentials).toBe('same-origin')
    expect((init?.headers as Record<string, string>).Accept).toBe('application/pdf, application/json')
  })
})

describe('Récupération du PDF', () => {
  it('200 PDF : le blob et le nom proposé par le serveur', async () => {
    answer(pdf(`attachment; filename="billet-${ID}.pdf"`))
    const { blob, filename } = await fetchTicket(ID, true)
    expect(blob.type).toBe('application/pdf')
    expect(filename).toBe(`billet-${ID}.pdf`)
  })

  it.each([401, 404, 409])('traduit %i en phrase, jamais le détail technique', async (status) => {
    answer(problem(status))
    await expect(fetchTicket(ID)).rejects.toEqual(new TicketError(MESSAGES[status]!, status))
  })

  it('500 : message générique avec la référence de trace', async () => {
    answer(problem(500, 'Erreur interne du serveur', { 'X-Trace-Id': TRACE_ID }))
    await expect(fetchTicket(ID)).rejects.toThrow(`${FALLBACK} (réf. ${TRACE_ID})`)
  })

  it("refuse une réponse 200 qui n'est pas un PDF (page HTML d'un proxy ou du front)", async () => {
    answer(new Response('<!doctype html><title>Connexion</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    await expect(fetchTicket(ID)).rejects.toEqual(new TicketError(FALLBACK, 200))
  })

  it('hors ligne : fetch rejette, phrase dédiée', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchTicket(ID)).rejects.toEqual(new TicketError(OFFLINE, 0))
  })
})

describe('Affichage et mémoire', () => {
  it("ouvre l'onglet avant l'attente, puis y affiche l'URL du serveur une fois le PDF vérifié", async () => {
    const { b, tab } = fakeBrowser()
    const fetchMock = answer(pdf())
    const pending = openTicket(ID, b)
    // Ouvert pendant le clic, avant toute réponse : sinon le navigateur le bloque.
    expect(b.openTab).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await pending
    expect(b.openTab.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!)
    // Pas de blob: : le bouton « Télécharger » du lecteur PDF relit cette URL, avec le nom donné par le serveur.
    expect(tab.show).toHaveBeenCalledWith(`/api/screenings/mine/${ID}/ticket.pdf`)
    expect(b.createObjectURL).not.toHaveBeenCalled()
  })

  it("referme l'onglet vide en cas d'erreur", async () => {
    const { b, tab } = fakeBrowser()
    answer(problem(409))
    await expect(openTicket(ID, b)).rejects.toThrow(MESSAGES[409])
    expect(tab.close).toHaveBeenCalled()
    expect(tab.show).not.toHaveBeenCalled()
    expect(b.createObjectURL).not.toHaveBeenCalled()
  })

  it("enregistrer : download=true, nom du serveur, aucun onglet, URL libérée", async () => {
    const { b, runLater } = fakeBrowser()
    const fetchMock = answer(pdf(`attachment; filename="billet-${ID}.pdf"`))
    await saveTicket(ID, b)
    expect(fetchMock.mock.calls[0]![0]).toContain('?download=true')
    expect(b.openTab).not.toHaveBeenCalled()
    expect(b.save).toHaveBeenCalledWith('blob:billet', `billet-${ID}.pdf`)
    expect(b.later).toHaveBeenCalledWith(expect.any(Function), REVOKE_AFTER_MS)
    runLater()
    expect(b.revokeObjectURL).toHaveBeenCalledWith('blob:billet')
  })
})
