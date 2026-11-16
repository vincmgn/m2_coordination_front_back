import { createServer } from "node:http";

const DELAY_MS = Number(process.env.SMS_DELAY_MS ?? 1200);
const PORT = Number(process.env.PORT ?? 4000);

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/sms") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const to = String(JSON.parse(body || "{}").to ?? "");
    setTimeout(() => {
      const refused = to.endsWith("13");
      res.writeHead(refused ? 503 : 202, { "Content-Type": "application/json" });
      res.end(JSON.stringify(refused ? { error: "Opérateur indisponible" } : { status: "queued" }));
    }, DELAY_MS);
  });
}).listen(PORT, () => console.log(`Passerelle SMS simulée sur le port ${PORT} (délai ${DELAY_MS} ms)`));
