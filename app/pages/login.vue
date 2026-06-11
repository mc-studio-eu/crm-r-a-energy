<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function login() {
  loading.value = true
  error.value = ''
  const { error: err } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (err) {
    error.value = err.message.includes('Invalid')
      ? 'Email ou mot de passe incorrect'
      : err.message
    return
  }
  await navigateTo('/', { replace: true })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-app-bg px-4">
    <div class="card w-full max-w-sm">
      <div class="mb-6 text-center">
        <h1 class="text-xl text-primary">R&A Energy</h1>
        <p class="text-sm text-gray-500">Connexion au CRM</p>
      </div>
      <form class="space-y-4" @submit.prevent="login">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" type="email" required class="input" autocomplete="email">
        </div>
        <div>
          <label class="label" for="password">Mot de passe</label>
          <PasswordInput id="password" v-model="password" autocomplete="current-password" />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          {{ loading ? 'Connexion…' : 'Se connecter' }}
        </button>
        <NuxtLink to="/mot-de-passe-oublie" class="block text-center text-sm text-primary hover:underline">
          Mot de passe oublié ?
        </NuxtLink>
      </form>
    </div>
  </div>
</template>
