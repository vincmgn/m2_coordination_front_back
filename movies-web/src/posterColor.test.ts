import { describe, expect, it } from 'vitest'
import { posterColor } from './posterColor'

const REFERENCE = { Psycho: '#ffb547', Amélie: '#7ce0c3', Heat: '#ff7a9a', Alien: '#b7a6ff', Vertigo: '#f3f1ec', Matrix: '#8fc9ff' }

describe('posterColor', () => {
  it.each(Object.entries(REFERENCE))('%s → %s (même couleur sur le billet PDF)', (title, color) => {
    expect(posterColor(title)).toBe(color)
  })
})
