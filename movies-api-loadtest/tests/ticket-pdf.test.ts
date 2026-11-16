import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderTicket } from "../src/ticket/renderer.js";
import { toTicketView } from "../src/ticket/view.js";

const view = toTicketView(
  {
    bookingId: "6560f1a2b3c4d5e6f7a8b9c0",
    screeningId: "573a1390f29313caabcd42e8-20261124-2100",
    seats: ["E6", "E5"],
    name: "Hélène Durand",
    createdAt: new Date("2026-11-21T08:30:00Z"),
  },
  { title: "Amélie", year: 2001 },
  new Date("2026-11-22T10:00:00Z"),
);

let pdf: Buffer;
let doc: PDFDocumentProxy;
let text: string;

before(async () => {
  pdf = await renderTicket(view);
  mkdirSync("tests/out", { recursive: true });
  writeFileSync("tests/out/billet-exemple.pdf", pdf);
  doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
});

describe("billet PDF", () => {
  it("est un PDF d'une page A4", async () => {
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(doc.numPages, 1);
    const [, , width, height] = (await doc.getPage(1)).view;
    assert.equal(Math.round(width!), 595);
    assert.equal(Math.round(height!), 842);
  });

  it("imprime les accents, la séance en heure de Paris et les sièges", () => {
    for (const expected of ["Hélène Durand", "Amélie", "2001", "mardi 24 novembre 2026", "21 h 00", "heure de Paris", "E5, E6", "places", "Salle 1"]) {
      assert.ok(text.includes(expected), `« ${expected} » absent de : ${text}`);
    }
    assert.ok(text.includes("Réservé le 21 novembre 2026 à 9 h 30"), text);
  });

  it("embarque ses polices : aucune police standard non embarquée", () => {
    const raw = pdf.toString("latin1");
    const fonts = [...new Set([...raw.matchAll(/\/BaseFont \/([^\s/]+)/g)].map((m) => m[1]))];
    assert.ok(fonts.length >= 2);
    for (const font of fonts) assert.match(font!, /^[A-Z]{6}\+DejaVuSans/, `police non embarquée : ${font}`);
    assert.equal((raw.match(/\/FontFile2 /g) ?? []).length, fonts.length);
  });

  it("est balisé (PDF/UA) : structure, langue, titre affiché", async () => {
    assert.ok(await (await doc.getPage(1)).getStructTree(), "pas d'arbre de structure");
    const raw = pdf.toString("latin1");
    assert.match(raw, /\/Lang \(fr-FR\)/);
    assert.match(raw, /\/DisplayDocTitle true/);
    assert.match(raw, /pdfuaid:part>1</);
    const { info } = (await doc.getMetadata()) as { info: { Title?: string } };
    assert.equal(info.Title, "Billet 6560f1a2b3c4d5e6f7a8b9c0");
  });
});
