import { createRouter, createWebHistory } from 'vue-router'
import MoviesList from '@/views/MoviesList.vue'
import { useAuth } from '@/composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'movies', component: MoviesList },
    { path: '/movies/new', name: 'movie-new', component: () => import('@/views/MovieForm.vue'), meta: { requiresAdmin: true } },
    { path: '/movies/:id', name: 'movie', component: () => import('@/views/MovieDetail.vue'), props: true },
    {
      path: '/movies/:id/edit',
      name: 'movie-edit',
      component: () => import('@/views/MovieForm.vue'),
      props: true,
      meta: { requiresAdmin: true },
    },
    {
      path: '/seances/:id',
      name: 'screening',
      component: () => import('@/views/SeatBooking.vue'),
      props: true,
    },
    { path: '/cinemas', name: 'cinemas', component: () => import('@/views/CinemasNearby.vue') },
    { path: '/connexion', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/mes-seances',
      name: 'my-screenings',
      component: () => import('@/views/MyScreenings.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// Pages réservées aux comptes connectés : sinon, détour par la connexion puis retour à la page demandée.
router.beforeEach(async (to) => {
  const { user, load } = useAuth()
  await load()
  if ((to.meta.requiresAuth || to.meta.requiresAdmin) && !user.value) return { name: 'login', query: { redirect: to.fullPath } }
  // Confort seulement : la vraie barrière est le back (403 pour un compte ordinaire).
  if (to.meta.requiresAdmin && !user.value?.admin) return { name: 'movies' }
})

export default router
