import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { TicketView } from "./view.js";

const require = createRequire(import.meta.url);
const FONTS = {
  regular: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"),
  bold: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"),
  display: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf"),
};

const C = {
  night: "#0d0d11",
  ink: "#17171d",
  soft: "#4b5563",
  muted: "#6b7280",
  line: "#e5e7eb",
  dash: "#c7cad1",
  accent: "#ffb547",
  accentInk: "#9a5b00",
  stub: "#fff8ec",
};

const PAGE_W = 595;
const PAGE_H = 842;
const X = 48;
const Y = 56;
const W = PAGE_W - 2 * X;
const H = 300;
const BAND = 46;
const RADIUS = 14;
const STUB = 156;
const PX = X + W - STUB;
const PAD = 20;

type Font = keyof typeof FONTS;

export function renderTicket(v: TicketView): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    pdfVersion: "1.7",
    subset: "PDF/UA" as PDFKit.Mixins.PDFSubsets,
    tagged: true,
    lang: "fr-FR",
    displayTitle: true,
    info: { Title: `Billet ${v.reference}`, Author: v.cinema, Subject: "Billet de cinéma" },
  });
  for (const [name, path] of Object.entries(FONTS)) doc.registerFont(name, path);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const root = doc.struct("Document");
  doc.addStructure(root);

  const text = (
    value: string,
    x: number,
    y: number,
    o: { font?: Font; size?: number; color?: string; width?: number; height?: number; align?: "left" | "center" | "right"; spacing?: number; type?: string } = {},
  ) => {
    doc
      .font(o.font ?? "regular")
      .fontSize(o.size ?? 10)
      .fillColor(o.color ?? C.ink)
      .text(value, x, y, {
        width: o.width,
        height: o.height,
        ellipsis: o.height ? "…" : undefined,
        align: o.align,
        characterSpacing: o.spacing ?? 0,
        lineGap: 1,
        structParent: root,
        structType: o.type ?? "P",
      });
  };
  const label = (value: string, x: number, y: number, width?: number, align?: "left" | "center") =>
    text(value.toUpperCase(), x, y, { font: "bold", size: 7, color: C.muted, spacing: 1.2, width, align });
  const decor = (draw: () => void) => {
    doc.markContent("Artifact", { type: "Layout" });
    doc.save();
    draw();
    doc.restore();
    doc.endMarkedContent();
  };

  decor(() => {
    doc.roundedRect(X, Y, W, H, RADIUS).fill("#ffffff");
    doc.save();
    doc.roundedRect(X, Y, W, H, RADIUS).clip();
    doc.rect(PX, Y, STUB, H).fill(C.stub);
    doc.rect(X, Y, W, BAND).fill(C.night);
    doc.rect(X, Y + BAND, W, 3).fill(C.accent);
    doc.restore();
    doc.roundedRect(X, Y, W, H, RADIUS).lineWidth(1).strokeColor(C.line).stroke();
    doc
      .moveTo(PX, Y + 12)
      .lineTo(PX, Y + H - 12)
      .dash(3, { space: 4 })
      .lineWidth(1)
      .strokeColor(C.dash)
      .stroke()
      .undash();
    for (const cy of [Y, Y + H]) doc.circle(PX, cy, 10).fill("#ffffff");
    doc.path(`M ${PX - 10} ${Y + H} A 10 10 0 0 1 ${PX + 10} ${Y + H}`).lineWidth(1).strokeColor(C.line).stroke();
    doc.circle(X + PAD + 5, Y + BAND / 2, 5).fill(C.accent);
  });

  text("MOVIES", X + PAD + 16, Y + 14, { font: "display", size: 16, color: "#ffffff", spacing: 1.5 });
  text("BILLET DE CINÉMA", X + PAD, Y + 19, { font: "bold", size: 7.5, color: C.accent, spacing: 2, width: PX - X - 2 * PAD, align: "right", type: "H1" });
  text("CONTRÔLE", PX, Y + 19, { font: "bold", size: 7.5, color: "#ffffff", spacing: 2, width: STUB, align: "center" });

  const posterX = X + PAD;
  const posterY = Y + BAND + 3 + 20;
  const posterW = 100;
  const posterH = 150;
  decor(() => {
    doc.roundedRect(posterX, posterY, posterW, posterH, 10).fill(v.posterColor);
    if (v.posterColor === "#f3f1ec") doc.roundedRect(posterX, posterY, posterW, posterH, 10).lineWidth(0.75).strokeColor(C.line).stroke();
    const t = v.movieTitle.toUpperCase();
    doc.font("display").fontSize(14);
    const h = Math.min(doc.heightOfString(t, { width: posterW - 20, lineGap: -2 }), 70);
    doc.fillColor(C.night).text(t, posterX + 10, posterY + posterH - 10 - h, { width: posterW - 20, height: 70, ellipsis: "…", lineGap: -2 });
  });

  const colX = posterX + posterW + 20;
  const colW = PX - PAD - colX;
  label("Film", colX, posterY);
  const titleSize = [22, 18, 15].find((size) => doc.font("display").fontSize(size).heightOfString(v.movieTitle, { width: colW, lineGap: 1 }) <= 70) ?? 15;
  text(v.movieTitle, colX, posterY + 12, { font: "display", size: titleSize, color: C.ink, width: colW, height: 70, type: "H2" });
  if (v.movieYear) text(v.movieYear, colX, doc.y + 2, { size: 10, color: C.muted });
  label("Au nom de", colX, posterY + posterH - 44);
  text(v.spectatorName, colX, posterY + posterH - 32, { font: "bold", size: 12, width: colW, height: 32 });

  const rowY = posterY + posterH + 20;
  const cols: [string, string, string, number][] = [
    ["Date", v.day, "", 182],
    ["Heure", v.time, "heure de Paris", 66],
    ["Salle", v.room, "", PX - PAD - posterX - 182 - 66],
  ];
  let cx = posterX;
  for (const [name, value, hint, width] of cols) {
    label(name, cx, rowY, width);
    text(value, cx, rowY + 11, { font: "bold", size: 11, width, height: 15 });
    if (hint) text(hint, cx, rowY + 27, { size: 7, color: C.muted, width });
    cx += width;
  }

  const sx = PX + 14;
  const sw = STUB - 28;
  label("Admet", sx, posterY, sw, "center");
  text(v.placeCount, sx, posterY + 9, { font: "display", size: 40, color: C.ink, width: sw, align: "center" });
  text(v.placeLabel, sx, posterY + 56, { size: 9, color: C.soft, width: sw, align: "center" });
  label("Sièges", sx, posterY + 80, sw, "center");
  text(v.seats, sx, posterY + 91, { font: "bold", size: 12, color: C.accentInk, width: sw, height: 32, align: "center" });

  const qrSize = 74;
  const qrX = PX + (STUB - qrSize) / 2;
  const qrY = Y + H - qrSize - 34;
  const qr = QRCode.create(`MOVIES:${v.reference}`, { errorCorrectionLevel: "M" }).modules;
  const cell = qrSize / qr.size;
  root.add(
    doc.struct("Figure", { alt: `Code QR de la réservation n° ${v.reference}` }, () => {
      doc.rect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12).fill("#ffffff");
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) if (qr.get(r, c)) doc.rect(qrX + c * cell, qrY + r * cell, cell + 0.02, cell + 0.02);
      }
      doc.fill(C.night);
    }),
  );
  text(`N° ${v.reference.slice(-8).toUpperCase()}`, sx, qrY + qrSize + 10, { font: "bold", size: 7.5, color: C.soft, width: sw, align: "center", spacing: 1 });

  let y = Y + H + 40;
  text("Bon à savoir", X, y, { font: "display", size: 14, type: "H2" });
  y += 26;
  const tips = [
    "Présentez ce billet à l'entrée de la salle, imprimé ou sur votre téléphone.",
    "Les portes ouvrent 20 minutes avant la séance.",
    `${v.cinema}, ${v.address}.`,
    "Les horaires de ce billet sont en heure de Paris.",
  ];
  for (const tip of tips) {
    decor(() => doc.rect(X, y + 3.5, 5, 5).fill(C.accent));
    text(tip, X + 16, y, { size: 10, color: C.soft, width: W - 16 });
    y += 19;
  }

  y += 14;
  decor(() => doc.roundedRect(X, y, W, 50, 10).fill("#f7f7f8"));
  label("Réservation", X + 16, y + 11);
  text(`n° ${v.reference}`, X + 16, y + 24, { font: "bold", size: 10, color: C.ink, width: 230 });
  label("Historique", X + 260, y + 11);
  text(`Réservé le ${v.bookedOn}`, X + 260, y + 24, { size: 9, color: C.soft, width: W - 276 });

  const footY = PAGE_H - 52;
  decor(() => doc.moveTo(X, footY).lineTo(X + W, footY).lineWidth(0.5).strokeColor(C.line).stroke());
  text(`${v.cinema} · document personnel`, X, footY + 10, { size: 7.5, color: C.muted, width: W / 2 });
  text(`Billet édité le ${v.issuedOn} (heure de Paris)`, X + W / 2, footY + 10, { size: 7.5, color: C.muted, width: W / 2, align: "right" });

  root.end();
  doc.end();
  return done;
}
