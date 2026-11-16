<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { user, logout } = useAuth()

async function signOut() {
  await logout()
  router.push('/')
}
</script>

<template>
  <header class="header">
    <div class="container header-inner">
      <RouterLink to="/" class="logo"><span class="lamp" aria-hidden="true" />Movies</RouterLink>
      <nav class="nav">
        <template v-if="user">
          <RouterLink to="/mes-seances" class="btn">Mes séances</RouterLink>
          <button class="btn" :title="user.email" @click="signOut">Déconnexion ({{ user.name }})</button>
        </template>
        <RouterLink v-else to="/connexion" class="btn">Connexion</RouterLink>
        <RouterLink to="/movies/new" class="btn btn-primary">+ Ajouter un film</RouterLink>
      </nav>
    </div>
  </header>

  <main class="container">
    <RouterView />
  </main>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 0.75rem;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.5rem;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.25rem;
  font-stretch: 125%;
  font-weight: 900;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  text-decoration: none;
}

/* Lampe du projecteur. */
.lamp {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 24px var(--accent);
}

.nav .router-link-active:not(.btn-primary) {
  background: var(--text);
  border-color: var(--text);
  color: var(--bg);
}

main {
  padding-block: 2.5rem 5rem;
}
</style>

<style>
.container {
  width: 100%;
  max-width: 1200px;
  margin-inline: auto;
  padding-inline: 16px;
}
</style>
