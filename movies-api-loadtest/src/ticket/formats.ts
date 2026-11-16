export const PARIS = "Europe/Paris";

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function formatDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return DAY.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export function formatTime(time: string) {
  const [h, m] = time.split(":");
  return `${Number(h)} h ${m}`;
}

const INSTANT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: PARIS,
});

export function formatInstant(at: Date) {
  const p = Object.fromEntries(INSTANT.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} à ${Number(p.hour)} h ${p.minute}`;
}
