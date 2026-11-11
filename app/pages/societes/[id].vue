<script setup lang="ts">
const route = useRoute()
const supabase = useSupabaseClient()
// Preserve old bookmarks without exposing any dossier beyond its existing RLS scope.
const { data } = await supabase.from('prospects').select('id').eq('societe_id', String(route.params.id)).limit(1).maybeSingle()
await navigateTo(data ? `/prospects/${data.id}` : '/prospects', { replace: true, redirectCode: 302 })
</script>

<template>
  <p>Redirection vers le dossier…</p>
</template>
