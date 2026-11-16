import { ref } from 'vue'
import { ApiError, getMe, login as apiLogin, logout as apiLogout, register as apiRegister, type User } from '@/api'

const user = ref<User | null>(null)
let loaded: Promise<void> | null = null

function load() {
  loaded ??= getMe()
    .then((u) => {
      user.value = u
    })
    .catch((e) => {
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
