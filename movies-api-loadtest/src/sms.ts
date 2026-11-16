// Confirmation par SMS via le prestataire externe (passerelle simulée en local, cf. sms-passerelle/).
// Sans SMS_GATEWAY_URL, aucun SMS n'est envoyé. Le numéro part dans le corps de la requête, jamais dans la trace.
const GATEWAY = process.env.SMS_GATEWAY_URL;

export type SmsStatus = "SENT" | "FAILED";

export async function sendSms(to: string, text: string): Promise<SmsStatus | null> {
  if (!GATEWAY) return null;
  try {
    const res = await fetch(`${GATEWAY}/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "SENT" : "FAILED";
  } catch {
    return "FAILED";
  }
}
