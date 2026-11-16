export function safeRedirect(asked: unknown, fallback = '/mes-seances') {
  if (typeof asked !== 'string' || asked.length > 500) return fallback
  if (!/^\/(?![/\\])/.test(asked) || /[\u0000-\u001f\u007f]/.test(asked)) return fallback
  return asked
}
