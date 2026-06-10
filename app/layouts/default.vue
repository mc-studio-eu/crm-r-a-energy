<script setup lang="ts">
const { profile, load, isAdmin, isStaff } = useProfile()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()

await load()
watch(user, () => load())

async function logout() {
  await supabase.auth.signOut()
  navigateTo('/login')
}

type NavItem = { to: string, label: string, show: boolean, icon: string }

// icon = clé d'une icône SVG définie dans <NavIcon>
const nav = computed<NavItem[]>(() => [
  { to: '/', label: 'Tableau de bord', show: true, icon: 'home' },
  { to: '/prospects', label: 'Prospects', show: true, icon: 'users' },
  { to: '/rdv', label: 'Mes RDV', show: profile.value?.role === 'commercial', icon: 'calendar' },
  { to: '/planning', label: 'Planning', show: isStaff.value, icon: 'calendar' },
  { to: '/carte', label: 'Carte des RDV', show: isStaff.value, icon: 'map' },
  { to: '/admin/utilisateurs', label: 'Équipe', show: isAdmin.value, icon: 'team' },
  { to: '/admin/parametres', label: 'Paramètres', show: isAdmin.value, icon: 'cog' },
].filter(i => i.show))

// Barre du bas : 4 items max, le reste passe dans le panneau "Plus".
const MOBILE_TABS = 4
const bottomNav = computed(() => nav.value.slice(0, MOBILE_TABS))
const overflowNav = computed(() => nav.value.slice(MOBILE_TABS))

const sheetOpen = ref(false)
// Le bouton "Plus" est actif si la page courante est un item du panneau.
const overflowActive = computed(() =>
  overflowNav.value.some(i => i.to === '/' ? route.path === '/' : route.path.startsWith(i.to)))

// Ferme le panneau à chaque navigation.
watch(() => route.path, () => { sheetOpen.value = false })
</script>

<template>
  <div v-if="user" class="flex min-h-screen">
    <!-- Sidebar (desktop) -->
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
    <header class="fixed inset-x-0 top-0 z-20 flex items-center justify-between bg-primary px-4 py-3 text-white md:hidden">
      <span class="font-bold">R&A Energy CRM</span>
      <NuxtLink to="/profil" class="text-sm">{{ displayName(profile?.nom) }}</NuxtLink>
    </header>

    <main class="flex-1 px-4 pb-24 pt-16 md:ml-60 md:px-8 md:pb-10 md:pt-8">
      <slot />
    </main>

    <!-- Barre de navigation mobile (tab bar) -->
    <nav
      class="fixed inset-x-0 bottom-0 z-20 grid border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      :style="{ gridTemplateColumns: `repeat(${bottomNav.length + (overflowNav.length ? 1 : 0)}, minmax(0, 1fr))` }"
    >
      <NuxtLink
        v-for="item in bottomNav"
        :key="item.to"
        :to="item.to"
        class="flex flex-col items-center gap-0.5 py-2 text-[11px] text-gray-500 transition"
        active-class="!text-primary"
      >
        <NavIcon :name="item.icon" />
        <span class="max-w-full truncate px-0.5">{{ item.label }}</span>
      </NuxtLink>
      <button
        v-if="overflowNav.length"
        type="button"
        class="flex flex-col items-center gap-0.5 py-2 text-[11px] text-gray-500 transition"
        :class="{ '!text-primary': overflowActive || sheetOpen }"
        @click="sheetOpen = true"
      >
        <NavIcon name="menu" />
        <span>Plus</span>
      </button>
    </nav>

    <!-- Panneau "Plus" (mobile) -->
    <Transition name="sheet">
      <div v-if="sheetOpen" class="fixed inset-0 z-30 md:hidden" @click="sheetOpen = false">
        <div class="absolute inset-0 bg-black/40" />
        <div
          class="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          @click.stop
        >
          <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
          <nav class="space-y-1">
            <NuxtLink
              v-for="item in overflowNav"
              :key="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-700 transition hover:bg-secondary-light"
              active-class="!bg-secondary-light !text-primary"
            >
              <NavIcon :name="item.icon" />
              {{ item.label }}
            </NuxtLink>
            <NuxtLink
              to="/profil"
              class="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-700 transition hover:bg-secondary-light"
              active-class="!bg-secondary-light !text-primary"
            >
              <NavIcon name="user" />
              {{ profile?.nom ? displayName(profile.nom) : 'Mon profil' }}
              <span class="ml-auto text-xs font-normal capitalize text-gray-400">{{ profile?.role }}</span>
            </NuxtLink>
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
              @click="logout"
            >
              <NavIcon name="logout" />
              Se déconnecter
            </button>
          </nav>
        </div>
      </div>
    </Transition>
  </div>
  <div v-else>
    <slot />
  </div>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active > div:last-child,
.sheet-leave-active > div:last-child {
  transition: transform 0.25s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div:last-child,
.sheet-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
