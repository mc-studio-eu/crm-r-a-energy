import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-06-01',
  devtools: { enabled: true },

  modules: ['@nuxtjs/supabase', '@nuxt/eslint', '@vueuse/nuxt'],

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/mot-de-passe-oublie', '/reset-password'],
    },
    cookieOptions: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },

  runtimeConfig: {
    // Server only — set via env vars (local .env + Vercel)
    supabaseServiceRoleKey: '',
    googleClientId: '',
    googleClientSecret: '',
    googleMapsApiKey: '',
    public: {
      appUrl: process.env.NUXT_PUBLIC_APP_URL,
    },
  },

  app: {
    head: {
      title: 'CRM — R&A Energy',
      htmlAttrs: { lang: 'fr' },
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'shortcut icon', type: 'image/x-icon', href: '/favicon.ico' }
      ]
    },
  },
})
