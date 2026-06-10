<script setup lang="ts">
import { ROLES, type UserRole } from '~~/shared/types'

const { data: users, refresh } = await useAsyncData('admin-users', () =>
  $fetch<any[]>('/api/admin/users'))

const form = reactive({ email: '', nom: '', role: 'commercial' as UserRole })
const inviting = ref(false)
const error = ref('')
const success = ref('')

async function invite() {
  inviting.value = true
  error.value = ''
  success.value = ''
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: { ...form } })
    success.value = `Invitation envoyée à ${form.email}`
    form.email = ''
    form.nom = ''
    refresh()
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Erreur lors de l\'invitation'
  }
  inviting.value = false
}

async function update(id: string, body: Record<string, unknown>) {
  await $fetch(`/api/admin/users/${id}`, { method: 'PATCH', body })
  refresh()
}
</script>

<template>
  <div class="max-w-4xl">
    <h1 class="mb-6 text-2xl">Équipe</h1>

    <!-- Invitation -->
    <div class="card mb-6">
      <h2 class="mb-3 text-base">Inviter un salarié</h2>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="invite">
        <div class="min-w-48 flex-1">
          <label class="label">Nom</label>
          <input v-model="form.nom" required class="input">
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
      <p v-if="success" class="mt-2 text-sm text-green-700">{{ success }}</p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>

    <!-- Liste -->
    <div class="card overflow-x-auto !p-0">
      <table class="table-base">
        <thead>
          <tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Agenda Google</th><th>Statut</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="font-medium">{{ u.nom }}</td>
            <td class="text-gray-500">{{ u.email }}</td>
            <td>
              <select
                class="rounded border border-gray-200 px-2 py-1 text-xs"
                :value="u.role"
                @change="update(u.id, { role: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="(label, r) in ROLES" :key="r" :value="r">{{ label }}</option>
              </select>
            </td>
            <td>
              <span :class="u.google_calendar_connected ? 'text-green-700' : 'text-gray-400'" class="text-xs">
                {{ u.google_calendar_connected ? '✓ Connecté' : 'Non connecté' }}
              </span>
            </td>
            <td>
              <span :class="u.actif ? 'text-green-700' : 'text-red-600'" class="text-xs font-medium">
                {{ u.actif ? 'Actif' : 'Désactivé' }}
              </span>
            </td>
            <td>
              <button
                class="text-xs underline"
                :class="u.actif ? 'text-red-600' : 'text-green-700'"
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
