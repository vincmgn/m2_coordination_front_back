import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safeRedirect'

describe('safeRedirect', () => {
  it('garde un chemin interne', () => {
    expect(safeRedirect('/seances/abc?x=1')).toBe('/seances/abc?x=1')
  })
  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\t/evil.example', '', undefined, ['/a']])(
    'refuse %j',
    (value) => {
      expect(safeRedirect(value)).toBe('/mes-seances')
    },
  )
})
