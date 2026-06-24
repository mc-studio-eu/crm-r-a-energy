<script setup lang="ts">
// Page d'atterrissage de l'invitation admin ET du reset password.
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const password = ref('')
const confirm = ref('')
const error = ref('')
const loading = ref(false)
const ready = ref(false)

// Le lien d'invitation / reset arrive avec le token dans le hash de l'URL
// (#access_token=...&refresh_token=...&type=recovery). On établit la session
// à partir de ce token avant de pouvoir mettre à jour le mot de passe.
onMounted(async () => {
  // Si une session existe déjà (passage par /confirm), rien à faire.
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    ready.value = true
    return
  }

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const errorDescription = params.get('error_description')

  if (errorDescription) {
    error.value = decodeURIComponent(errorDescription)
    return
  }

  if (!accessToken || !refreshToken) {
    error.value = 'Lien invalide ou expiré. Veuillez redemander une invitation.'
    return
  }

  const { error: err } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (err) {
    error.value = err.message
    return
  }

  // Nettoie le token de l'URL puis active le formulaire.
  history.replaceState(null, '', window.location.pathname)
  ready.value = true
})

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
        <button type="submit" class="btn-primary w-full" :disabled="loading || !ready">Enregistrer</button>
      </form>
    </div>
  </div>
</template>
