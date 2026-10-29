<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref<string | null>(null)
const saving = ref(false)

// Retour à la page demandée avant la connexion (chemin interne uniquement).
const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/mes-seances'

async function submit() {
  saving.value = true
  error.value = null
  try {
    if (mode.value === 'login') await auth.login(email.value, password.value)
    else await auth.register(email.value, password.value, name.value)
    router.replace(redirect)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="auth">
    <h1>{{ mode === 'login' ? 'Connexion' : 'Créer un compte' }}</h1>

    <form class="form" @submit.prevent="submit">
      <label v-if="mode === 'register'" class="field">
        <span>Nom</span>
        <input v-model="name" required maxlength="60" autocomplete="name" />
      </label>
      <label class="field">
        <span>E-mail</span>
        <input v-model="email" type="email" required maxlength="254" autocomplete="email" />
      </label>
      <label class="field">
        <span>Mot de passe</span>
        <input
          v-model="password"
          type="password"
          required
          :minlength="mode === 'register' ? 8 : undefined"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        />
        <small v-if="mode === 'register'" class="muted">8 caractères minimum</small>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte' }}
      </button>
    </form>

    <p class="muted switch">
      <template v-if="mode === 'login'">
        Pas encore de compte ?
        <button type="button" class="link" @click="(mode = 'register'), (error = null)">Créer un compte</button>
      </template>
      <template v-else>
        Déjà inscrit ?
        <button type="button" class="link" @click="(mode = 'login'), (error = null)">Se connecter</button>
      </template>
    </p>
  </section>
</template>

<style scoped>
.auth {
  max-width: 380px;
  margin-inline: auto;
}

h1 {
  margin-top: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.switch {
  margin-top: 1.25rem;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}
</style>
