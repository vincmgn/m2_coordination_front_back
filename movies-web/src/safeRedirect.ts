// Page où revenir après la connexion : un chemin interne seulement, sinon « Mes séances ».
// Refusés : « //site.example » et « /\site.example » (le navigateur les lit comme une autre origine),
// « https://… », « javascript:… », et tout caractère de contrôle (tabulation, retour à la ligne glissés dans l'URL).
export function safeRedirect(asked: unknown, fallback = '/mes-seances') {
  if (typeof asked !== 'string' || asked.length > 500) return fallback
  if (!/^\/(?![/\\])/.test(asked) || /[\u0000-\u001f\u007f]/.test(asked)) return fallback
  return asked
}
