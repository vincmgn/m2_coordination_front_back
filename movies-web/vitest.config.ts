import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests unitaires (Vitest + happy-dom) : src/**/*.test.ts. Les tests de bout en bout (Playwright) sont dans e2e/.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
