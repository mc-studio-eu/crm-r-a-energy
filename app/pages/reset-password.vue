<script setup lang="ts">
// Page d'atterrissage de l'invitation admin ET du reset password.
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const password = ref('')
const confirm = ref('')
const error = ref('')
const loading = ref(false)

async function save() {
  if (password.value !== confirm.value) {
    error.value = 'Les mots de passe ne correspondent pas'
    return
  }
  loading.value = true
  const { error: err } = await supabase.auth.updateUser({ password: password.value })
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  navigateTo('/')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-app-bg px-4">
    <div class="card w-full max-w-sm">
      <h1 class="mb-4 text-lg text-primary">Définir mon mot de passe</h1>
      <form class="space-y-4" @submit.prevent="save">
        <div>
          <label class="label" for="password">Nouveau mot de passe</label>
          <PasswordInput id="password" v-model="password" :minlength="8" autocomplete="new-password" />
        </div>
        <div>
          <label class="label" for="confirm">Confirmation</label>
          <PasswordInput id="confirm" v-model="confirm" :minlength="8" autocomplete="new-password" />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">Enregistrer</button>
      </form>
    </div>
  </div>
</template>
