import { ref } from 'vue'
import { ApiError, getMe, login as apiLogin, logout as apiLogout, register as apiRegister, type User } from '@/api'

// État de connexion partagé par toute l'application (un seul ref au niveau du module).
const user = ref<User | null>(null)
let loaded: Promise<void> | null = null

// Lit la session une seule fois ; les appels suivants attendent la même promesse.
function load() {
  loaded ??= getMe()
    .then((u) => {
      user.value = u
    })
    .catch((e) => {
      // 401 : pas connecté. Autre erreur (API hors ligne) : considéré comme déconnecté, nouvel essai au prochain appel.
      user.value = null
      if (!(e instanceof ApiError) || e.status !== 401) loaded = null
    })
  return loaded
}

export function useAuth() {
  return {
    user,
    load,
    async login(email: string, password: string) {
      user.value = await apiLogin(email, password)
    },
    async register(email: string, password: string, name: string) {
      user.value = await apiRegister(email, password, name)
    },
    async logout() {
      await apiLogout()
      user.value = null
    },
  }
}
