<script setup lang="ts">
import { ROLES, type UserRole } from '~~/shared/types'

interface AdminUser {
  id: string
  nom: string
  email: string | null
  role: UserRole
  actif: boolean
  google_calendar_connected: boolean
}

const { data: users, error: loadError, refresh } = await useFetch<AdminUser[]>('/api/admin/users')
const { profile } = useProfile()

const form = reactive({ email: '', nom: '', role: 'commercial' as UserRole })
const inviting = ref(false)
const error = ref('')
const success = ref('')
const editing = ref<{ id: string, nom: string } | null>(null)
const updating = ref(false)
const updateError = ref('')
const updateSuccess = ref('')

async function invite() {
  inviting.value = true
  error.value = ''
  success.value = ''
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: { ...form, nom: form.nom.trim() } })
    success.value = `Invitation envoyée à ${form.email}`
    form.email = ''
    form.nom = ''
    await refresh()
  }
  catch (e: unknown) {
    error.value = errorMessage(e, 'Erreur lors de l\'invitation')
  }
  inviting.value = false
}

async function update(id: string, body: Partial<Pick<AdminUser, 'role' | 'actif' | 'nom'>>) {
  if (updating.value) return false
  updating.value = true
  updateError.value = ''
  updateSuccess.value = ''
  try {
    await $fetch(`/api/admin/users/${id}`, { method: 'PATCH', body })
    updateSuccess.value = 'Compte mis à jour.'
    if (profile.value?.id === id) {
      profile.value = { ...profile.value, ...body }
      if (profile.value.role !== 'admin') await navigateTo(profile.value.role === 'apporteur_externe' ? '/finances' : '/')
    }
    return true
  } catch (e) {
    updateError.value = errorMessage(e, 'Impossible de mettre à jour ce compte.')
    return false
  } finally {
    await refresh()
    updating.value = false
  }
}

async function changeRole(user: AdminUser, event: Event) {
  const select = event.target as HTMLSelectElement
  if (!await update(user.id, { role: select.value as UserRole })) {
    select.value = users.value?.find(p => p.id === user.id)?.role ?? user.role
  }
}

async function saveName() {
  if (!editing.value) return
  const { id, nom } = editing.value
  if (!nom.trim()) {
    updateError.value = 'Saisissez un nom.'
    return
  }
  if (await update(id, { nom: nom.trim() })) editing.value = null
}
</script>

<template>
  <div class="max-w-4xl">
    <h1 class="mb-6 text-2xl">Équipe</h1>
    <p class="mb-4 text-sm text-gray-600">Les comptes actifs apparaissent dans les sélecteurs selon leur rôle.</p>

    <!-- Invitation -->
    <div class="card mb-6">
      <h2 class="mb-3 text-base">Inviter un salarié</h2>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="invite">
        <div class="min-w-48 flex-1">
          <label class="label">Nom</label>
          <input v-model="form.nom" required maxlength="120" class="input">
        </div>
        <div class="min-w-56 flex-1">
          <label class="label">Email</label>
          <input v-model="form.email" type="email" required class="input">
        </div>
        <div>
          <label class="label">Rôle</label>
          <select v-model="form.role" class="input">
            <option v-for="(label, r) in ROLES" :key="r" :value="r">{{ label }}</option>
          </select>
        </div>
        <button type="submit" class="btn-primary" :disabled="inviting">Inviter</button>
      </form>
      <p v-if="success" class="mt-2 text-sm text-primary">{{ success }}</p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>

    <!-- Liste -->
    <p v-if="loadError" class="mb-3 text-sm text-red-600" role="alert">
      Impossible de charger les comptes. <button type="button" class="underline" @click="refresh()">Réessayer</button>
    </p>
    <p v-if="updateError" class="mb-3 text-sm text-red-600" role="alert">{{ updateError }}</p>
    <p v-if="updateSuccess" class="mb-3 text-sm text-primary" role="status">{{ updateSuccess }}</p>
    <div class="card overflow-x-auto !p-0">
      <table class="table-base">
        <thead>
          <tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Agenda Google</th><th>Statut</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="font-medium">
              <form v-if="editing?.id === u.id" class="space-y-1" @submit.prevent="saveName">
                <input v-model="editing.nom" class="input min-w-40" aria-label="Nom du compte" required maxlength="120" :disabled="updating">
                <div class="flex gap-2 text-xs">
                  <button type="submit" class="text-primary underline" :disabled="updating">Enregistrer</button>
                  <button type="button" class="text-gray-600 underline" :disabled="updating" @click="editing = null">Annuler</button>
                </div>
              </form>
              <template v-else>
                {{ u.nom }}
                <button type="button" class="block text-xs text-primary underline" :aria-label="`Renommer ${u.nom}`" :disabled="updating" @click="editing = { id: u.id, nom: u.nom }">Renommer</button>
              </template>
            </td>
            <td class="text-gray-500">{{ u.email }}</td>
            <td>
              <select
                class="rounded border border-gray-200 px-2 py-1 text-xs"
                :aria-label="`Rôle de ${u.nom}`"
                :value="u.role"
                :disabled="updating"
                @change="changeRole(u, $event)"
              >
                <option v-for="(label, r) in ROLES" :key="r" :value="r">{{ label }}</option>
              </select>
            </td>
            <td>
              <span :class="u.google_calendar_connected ? 'text-primary' : 'text-gray-400'" class="text-xs">
                {{ u.google_calendar_connected ? '✓ Connecté' : 'Non connecté' }}
              </span>
            </td>
            <td>
              <span :class="u.actif ? 'text-primary' : 'text-red-600'" class="text-xs font-medium">
                {{ u.actif ? 'Actif' : 'Désactivé' }}
              </span>
            </td>
            <td>
              <button
                type="button"
                class="text-xs underline"
                :class="u.actif ? 'text-red-600' : 'text-primary'"
                :disabled="updating || u.id === profile?.id"
                @click="update(u.id, { actif: !u.actif })"
              >
                {{ u.actif ? 'Désactiver' : 'Réactiver' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
