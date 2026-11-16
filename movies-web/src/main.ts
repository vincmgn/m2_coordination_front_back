import './style.css'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { startTracing } from './tracing'

startTracing()

const app = createApp(App)

app.use(router)

app.mount('#app')
