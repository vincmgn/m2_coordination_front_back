import { createRouter, createWebHistory } from 'vue-router'
import MoviesList from '@/views/MoviesList.vue'

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
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

export default router
