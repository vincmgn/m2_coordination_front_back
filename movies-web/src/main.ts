import './style.css'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { startTracing } from './tracing'

// Avant createApp : le premier fetch de l'application est déjà tracé.
startTracing()

const app = createApp(App)

app.use(router)

app.mount('#app')
