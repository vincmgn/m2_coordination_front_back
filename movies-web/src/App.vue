<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="header">
    <div class="container header-inner">
      <RouterLink to="/" class="logo">🎬 Movies</RouterLink>
      <nav class="nav">
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
  background: var(--surface);
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
  gap: 0.5rem;
}

.logo {
  font-size: 1.25rem;
  font-weight: 700;
  text-decoration: none;
}

main {
  padding-block: 1.5rem 3rem;
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
