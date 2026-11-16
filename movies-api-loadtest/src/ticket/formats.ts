// Mise en forme des dates du billet. Le fuseau est écrit dans le code, jamais celui du serveur :
// le conteneur de l'API tourne en UTC, un getHours() y imprimerait 8 h 30 au lieu de 9 h 30 en hiver
// (et 7 h 30 en été). Intl.DateTimeFormat avec timeZone suit seul les changements d'heure.

export const PARIS = "Europe/Paris";

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Date civile de la séance, « 2026-11-24 » → « mardi 24 novembre 2026 ».
// La séance est déjà en heure de Paris (cf. identifiant de séance) : aucun fuseau à appliquer, UTC sert de calendrier neutre.
export function formatDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return DAY.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

// Heure de la séance, « 09:30 » → « 9 h 30 ».
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

// Instant enregistré en base (UTC), affiché en heure de Paris : « 24 novembre 2026 à 9 h 30 ».
export function formatInstant(at: Date) {
  const p = Object.fromEntries(INSTANT.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} à ${Number(p.hour)} h ${p.minute}`;
}
