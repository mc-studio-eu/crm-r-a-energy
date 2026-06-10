<template>
  <div class="max-w-3xl">
    <h1 class="mb-6 text-2xl">Nouveau prospect</h1>
    <div class="card">
      <ProspectForm @saved="id => navigateTo(`/prospects/${id}`)" />
    </div>
  </div>
</template>
