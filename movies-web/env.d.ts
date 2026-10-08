/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de l'API (par défaut /api, relayé par le proxy Vite en dev). */
  readonly VITE_API_URL?: string
}
