<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const config = useRuntimeConfig()
const email = ref('')
const sent = ref(false)
const loading = ref(false)

async function send() {
  loading.value = true
  await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${config.public.appUrl}/reset-password`,
  })
  loading.value = false
  sent.value = true
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-app-bg px-4">
    <div class="card w-full max-w-sm">
      <h1 class="mb-4 text-lg text-primary">Mot de passe oublié</h1>
      <p v-if="sent" class="text-sm text-gray-600">
        Si un compte existe pour cette adresse, un email de réinitialisation a été envoyé.
      </p>
      <form v-else class="space-y-4" @submit.prevent="send">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" type="email" required class="input">
        </div>
        <button type="submit" class="btn-primary w-full" :disabled="loading">Envoyer le lien</button>
      </form>
      <NuxtLink to="/login" class="mt-4 block text-center text-sm text-primary hover:underline">
        Retour à la connexion
      </NuxtLink>
    </div>
  </div>
</template>
