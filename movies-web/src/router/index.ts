import { createRouter, createWebHistory } from 'vue-router'
import MoviesList from '@/views/MoviesList.vue'
import { useAuth } from '@/composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'movies', component: MoviesList },
    { path: '/movies/new', name: 'movie-new', component: () => import('@/views/MovieForm.vue') },
    { path: '/movies/:id', name: 'movie', component: () => import('@/views/MovieDetail.vue'), props: true },
    {
      path: '/movies/:id/edit',
      name: 'movie-edit',
      component: () => import('@/views/MovieForm.vue'),
      props: true,
    },
    {
      path: '/seances/:id',
      name: 'screening',
      component: () => import('@/views/SeatBooking.vue'),
      props: true,
    },
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
  if (to.meta.requiresAuth && !user.value) return { name: 'login', query: { redirect: to.fullPath } }
})

export default router
