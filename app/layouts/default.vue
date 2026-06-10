<script setup lang="ts">
const { profile, load, isAdmin, isStaff } = useProfile()
const supabase = useSupabaseClient()
const user = useSupabaseUser()

await load()
watch(user, () => load())

async function logout() {
  await supabase.auth.signOut()
  navigateTo('/login')
}

const nav = computed(() => [
  { to: '/', label: 'Tableau de bord', show: true },
  { to: '/prospects', label: 'Prospects', show: true },
  { to: '/rdv', label: 'Mes RDV', show: profile.value?.role === 'commercial' },
  { to: '/planning', label: 'Planning', show: isStaff.value },
  { to: '/carte', label: 'Carte des RDV', show: isStaff.value },
  { to: '/admin/utilisateurs', label: 'Équipe', show: isAdmin.value },
  { to: '/admin/parametres', label: 'Paramètres', show: isAdmin.value },
].filter(i => i.show))
</script>

<template>
  <div v-if="user" class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="fixed inset-y-0 left-0 hidden w-60 flex-col bg-primary text-white md:flex">
      <div class="flex items-center gap-2 px-5 py-6">
        <span class="text-lg font-bold" style="font-family: Manrope, sans-serif">R&A Energy</span>
        <span class="rounded bg-secondary/30 px-1.5 py-0.5 text-xs font-medium text-secondary">CRM</span>
      </div>
      <nav class="flex-1 space-y-1 px-3">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
          active-class="!bg-secondary/25 !text-white font-medium"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
      <div class="border-t border-white/10 p-4">
        <NuxtLink to="/profil" class="block truncate text-sm font-medium hover:underline">
          {{ profile?.nom ? displayName(profile.nom) : 'Mon profil' }}
        </NuxtLink>
        <p class="text-xs text-white/60 capitalize">{{ profile?.role }}</p>
        <button class="mt-2 text-xs text-white/70 hover:text-white" @click="logout">
          Se déconnecter
        </button>
      </div>
    </aside>

    <!-- Header mobile -->
    <header class="fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-primary px-4 py-3 text-white md:hidden">
      <span class="font-bold">R&A Energy CRM</span>
      <NuxtLink to="/profil" class="text-sm">{{ displayName(profile?.nom) }}</NuxtLink>
    </header>

    <main class="flex-1 px-4 pb-10 pt-16 md:ml-60 md:px-8 md:pt-8">
      <slot />
    </main>
  </div>
  <div v-else>
    <slot />
  </div>
</template>
