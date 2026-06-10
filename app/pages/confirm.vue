<script setup lang="ts">
// Callback Supabase auth (magic links / invitations) — redirige une fois la session établie.
definePageMeta({ layout: false })

const user = useSupabaseUser()

watch(user, (u) => {
  if (u) navigateTo('/reset-password')
}, { immediate: true })
</script>

<template>
  <div class="flex min-h-screen items-center justify-center text-sm text-gray-500">
    Connexion en cours…
  </div>
</template>
