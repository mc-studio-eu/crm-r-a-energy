<script setup lang="ts">
const { isStaff, isRegie } = useProfile()
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="mb-6 text-2xl">Nouveau dossier</h1>
    <div v-if="!isStaff && !isRegie" class="card">
      <p class="text-sm text-gray-600">La création de dossiers est réservée aux administrateurs, aux téléprospecteurs et aux régies.</p>
      <NuxtLink to="/prospects" class="mt-3 inline-block text-sm text-primary hover:underline">Retour aux dossiers</NuxtLink>
    </div>
    <div v-else class="card">
      <ProspectForm @saved="id => navigateTo(`/prospects/${id}`)" />
    </div>
  </div>
</template>
