<script setup lang="ts">
import { FOURNISSEURS } from '~~/shared/types'
import {
  FINANCE_PAGE_SIZE, FINANCE_TYPES, financeDate, financeEuros, financeToday,
  type FinanceAnnuaire, type FinanceBeneficiaire, type FinanceTableau, type FinanceType,
} from '~~/shared/finance'

const { isAdmin, load } = useProfile()
await load()

const annee = ref(Number(financeToday().slice(0, 4)))
const mois = ref('')
const societe = ref('')
const fournisseur = ref('')
const energie = ref('')
const beneficiaire = ref('')
const commercial = ref('')
const type = ref<FinanceType | ''>('')
const page = ref(1)
const dossiersPage = ref(1)
const libelleMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' })
const moisOptions = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, label: libelleMois.format(new Date(Date.UTC(2020, i, 1))),
}))

watch([annee, mois, societe, fournisseur, energie, beneficiaire, commercial, type], () => { page.value = 1 }, { flush: 'sync' })
watch([societe, fournisseur, energie], () => { dossiersPage.value = 1 }, { flush: 'sync' })

const { data: tableau, status, error, refresh } = await useFetch<FinanceTableau>('/api/finances', {
  query: computed(() => ({
    annee: annee.value,
    mois: mois.value || undefined,
    societe: societe.value || undefined,
    fournisseur: fournisseur.value || undefined,
    energie: energie.value || undefined,
    beneficiaire: beneficiaire.value || undefined,
    commercial: commercial.value || undefined,
    type: type.value || undefined,
    page: page.value,
    dossiers_page: dossiersPage.value,
  })),
  lazy: true, server: false,
})

interface FinanceFiltres {
  societes: { id: string, raison_sociale: string }[]
  beneficiaires: { id: string, nom: string }[]
  commerciaux: { id: string, nom: string }[]
}

const { data: filtres, error: erreurFiltres, refresh: refreshFiltres } = await useFetch<FinanceFiltres>('/api/finances/filtres', { immediate: isAdmin.value, lazy: true, server: false })
const { data: annuaire, error: erreurAnnuaire, refresh: refreshAnnuaire } = await useFetch<FinanceAnnuaire>('/api/beneficiaires', {
  query: { profils: '1' }, immediate: isAdmin.value, lazy: true, server: false,
})

const types = computed<FinanceType[]>(() => isAdmin.value && !beneficiaire.value
  ? ['signature', 'part_signee', 'part_ra', 'entree_prevue', 'entree_reelle', 'sortie_prevue', 'sortie_reelle']
  : ['part_signee', 'sortie_prevue', 'sortie_reelle'])
const moisVisibles = computed(() => moisOptions.filter(item => !mois.value || item.id === Number(mois.value)))
const chartGroups = computed(() => {
  const full = isAdmin.value && !beneficiaire.value
  return [
    { title: 'Commissions signées', series: full
      ? [{ key: 'signature' as const, label: 'Brute fournisseur', color: '#31694E' }, { key: 'part_ra' as const, label: 'Part R&A', color: '#BBC863' }]
      : [{ key: 'part_signee' as const, label: 'Part bénéficiaire', color: '#31694E' }] },
    { title: 'Échéances prévues', series: [
      ...(full ? [{ key: 'entree_prevue' as const, label: 'Encaissements', color: '#31694E' }] : []),
      { key: 'sortie_prevue' as const, label: 'Reversements', color: '#D99A39' },
    ] },
    { title: 'Paiements réalisés', series: [
      ...(full ? [{ key: 'entree_reelle' as const, label: 'Encaissements', color: '#31694E' }] : []),
      { key: 'sortie_reelle' as const, label: 'Reversements', color: '#6486B2' },
    ] },
  ]
})
function selectChart(month: number, selectedType: FinanceType) {
  mois.value = String(month)
  type.value = selectedType
}
const totalPages = computed(() => Math.max(1, Math.ceil((tableau.value?.total ?? 0) / FINANCE_PAGE_SIZE)))
const totalPagesDossiers = computed(() => Math.max(1, Math.ceil((tableau.value?.total_dossiers ?? 0) / FINANCE_PAGE_SIZE)))
watch(totalPages, count => { if (page.value > count) page.value = count })
watch(totalPagesDossiers, count => { if (dossiersPage.value > count) dossiersPage.value = count })
watch(types, options => { if (type.value && !options.includes(type.value)) type.value = '' })

function fournisseurNom(value: string | null) {
  return Object.entries(FOURNISSEURS).find(([key]) => key === value)?.[1] ?? value ?? '—'
}

function energieNom(value: string | null) {
  return value === 'gaz' ? 'Gaz' : value === 'electricite' ? 'Électricité' : '—'
}

function ligneMois(m: number, t: FinanceType) {
  return tableau.value?.mois.find(row => row.mois === m && row.type === t)
}

function totalType(t: FinanceType) {
  return (tableau.value?.mois ?? []).filter(row => row.type === t && row.montant_cents !== null)
    .reduce((sum, row) => sum + BigInt(row.montant_cents ?? '0'), 0n)
}

const edition = reactive({ id: '', nom: '', profil_id: '', actif: true })
const sauvegarde = ref(false)
const erreurEdition = ref('')
const confirmation = ref('')
const formulaireAnnuaire = ref<HTMLElement>()

async function modifierBeneficiaire(b?: FinanceBeneficiaire) {
  edition.id = b?.id ?? ''
  edition.nom = b?.nom ?? ''
  edition.profil_id = b?.profil_id ?? ''
  edition.actif = b?.actif ?? true
  erreurEdition.value = ''
  confirmation.value = ''
  if (b) {
    await nextTick()
    formulaireAnnuaire.value?.querySelector('input')?.focus()
  }
}

async function actualiserAnnuaire() {
  await Promise.all([refreshAnnuaire(), refreshFiltres(), refresh()])
}

async function enregistrerBeneficiaire() {
  sauvegarde.value = true
  erreurEdition.value = ''
  confirmation.value = ''
  try {
    const payload = { nom: edition.nom, profil_id: edition.profil_id || null, actif: edition.actif }
    if (edition.id) {
      await $fetch(`/api/beneficiaires/${edition.id}`, { method: 'PATCH', body: payload })
    }
    else {
      await $fetch('/api/beneficiaires', { method: 'POST', body: payload })
    }
    await modifierBeneficiaire()
    await actualiserAnnuaire()
    confirmation.value = 'Bénéficiaire enregistré.'
  }
  catch (e) {
    erreurEdition.value = errorMessage(e)
  }
  finally {
    sauvegarde.value = false
  }
}

async function supprimerBeneficiaire(b: FinanceBeneficiaire) {
  if (!confirm(`Supprimer le bénéficiaire « ${b.nom} » ?`)) return
  sauvegarde.value = true
  erreurEdition.value = ''
  confirmation.value = ''
  try {
    await $fetch(`/api/beneficiaires/${b.id}`, { method: 'DELETE' })
    if (edition.id === b.id) await modifierBeneficiaire()
    if (beneficiaire.value === b.id) beneficiaire.value = ''
    await actualiserAnnuaire()
    confirmation.value = 'Bénéficiaire supprimé.'
  }
  catch (e) {
    erreurEdition.value = errorMessage(e)
  }
  finally {
    sauvegarde.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl">
          {{ isAdmin ? 'Finances' : 'Mes commissions' }}
        </h1>
        <p class="mt-1 text-sm text-gray-600">
          {{ isAdmin ? 'Commissions, échéances et règlements des dossiers.' : 'Votre part sur les dossiers signés et le suivi de vos reversements.' }}
        </p>
      </div>
      <a v-if="isAdmin" href="#beneficiaires" class="btn-secondary">Gérer les bénéficiaires</a>
    </header>

    <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {{ errorMessage(error) }}
    </p>
    <p v-else-if="!tableau" class="text-sm text-gray-600">
      Chargement des finances…
    </p>

    <template v-if="!isAdmin && tableau">
      <div v-if="tableau.bilan_personnel" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card">
          <p class="text-sm text-gray-600">Déjà payé</p>
          <p class="mt-1 text-xl font-semibold">{{ financeEuros(tableau.bilan_personnel.paye_cents) }} HT</p>
        </div>
        <div class="card">
          <p class="text-sm text-gray-600">Reste à percevoir</p>
          <p class="mt-1 text-xl font-semibold">{{ financeEuros(tableau.bilan_personnel.reste_cents) }} HT</p>
        </div>
        <div class="card">
          <p class="text-sm text-gray-600">Dont en retard</p>
          <p class="mt-1 text-xl font-semibold">{{ financeEuros(tableau.bilan_personnel.retard_cents) }} HT</p>
        </div>
        <div class="card">
          <p class="text-sm text-gray-600">Première échéance non soldée</p>
          <p class="mt-1 text-xl font-semibold">{{ financeDate(tableau.bilan_personnel.prochaine_echeance) }}</p>
        </div>
      </div>
      <section class="card">
        <h2 class="mb-3 text-lg">
          Mes dossiers signés
        </h2>
        <p v-if="!tableau.dossiers.length" class="text-sm text-gray-600">
          Aucun dossier signé ne vous attribue de commission.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="table-base">
            <thead>
              <tr>
                <th>Dossier</th>
                <th>Signature / livraison</th>
                <th>Ma part HT</th>
                <th>Payé HT</th>
                <th>Reste HT</th>
                <th>Échéance non soldée</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in tableau.dossiers" :key="d.prospect_id">
                <td>
                  <strong>{{ d.dossier }}</strong>
                  <br>
                  <span class="text-xs text-gray-600">{{ fournisseurNom(d.fournisseur) }} · {{ energieNom(d.energie) }}</span>
                </td>
                <td class="whitespace-nowrap">
                  {{ d.date_signature ? financeDate(d.date_signature) : 'Signature non datée' }}
                  <br>
                  <span class="text-xs text-gray-600">{{ financeDate(d.debut_livraison) }} → {{ financeDate(d.fin_livraison) }}</span>
                </td>
                <td class="whitespace-nowrap">{{ financeEuros(d.montant_cents) }}</td>
                <td class="whitespace-nowrap">{{ financeEuros(d.paye_cents) }}</td>
                <td class="whitespace-nowrap">{{ financeEuros(d.reste_cents) }}</td>
                <td class="whitespace-nowrap">
                  {{ financeDate(d.prochaine_echeance) }}
                  <span v-if="d.retard_cents" class="block text-xs text-amber-800">{{ financeEuros(d.retard_cents) }} en retard</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="totalPagesDossiers > 1" class="mt-3 flex items-center justify-end gap-3 text-sm">
          <button type="button" class="btn-secondary" :disabled="dossiersPage <= 1 || status === 'pending'" @click="dossiersPage--">Précédent</button>
          <span>{{ dossiersPage }} / {{ totalPagesDossiers }}</span>
          <button type="button" class="btn-secondary" :disabled="dossiersPage >= totalPagesDossiers || status === 'pending'" @click="dossiersPage++">Suivant</button>
        </div>
      </section>
    </template>

    <section class="card">
      <h2 class="mb-3 text-lg">
        Période et filtres
      </h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label>
          <span class="label">Année</span>
          <input
            :value="annee" class="input" type="number" min="1900" max="2200"
            @change="annee = Math.max(1900, Math.min(2200, Number(($event.target as HTMLInputElement).value) || Number(financeToday().slice(0, 4))))"
          >
        </label>
        <label>
          <span class="label">Mois</span>
          <select v-model="mois" class="input">
            <option value="">Toute l’année</option>
            <option v-for="item in moisOptions" :key="item.id" :value="String(item.id)">{{ item.label }}</option>
          </select>
        </label>
        <template v-if="isAdmin">
          <label>
            <span class="label">Dossier</span>
            <select v-model="societe" class="input">
              <option value="">Tous</option>
              <option v-for="s in filtres?.societes" :key="s.id" :value="s.id">{{ s.raison_sociale }}</option>
            </select>
          </label>
          <label>
            <span class="label">Commercial / régie</span>
            <select v-model="commercial" class="input">
              <option value="">Tous</option>
              <option v-for="c in filtres?.commerciaux" :key="c.id" :value="c.id">{{ c.nom }}</option>
            </select>
          </label>
          <label>
            <span class="label">Fournisseur</span>
            <select v-model="fournisseur" class="input">
              <option value="">Tous</option>
              <option v-for="(label, value) in FOURNISSEURS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            <span class="label">Énergie</span>
            <select v-model="energie" class="input">
              <option value="">Toutes</option>
              <option value="gaz">Gaz</option>
              <option value="electricite">Électricité</option>
            </select>
          </label>
          <label>
            <span class="label">Bénéficiaire</span>
            <select v-model="beneficiaire" class="input">
              <option value="">Tous</option>
              <option v-for="b in filtres?.beneficiaires" :key="b.id" :value="b.id">{{ b.nom }}</option>
            </select>
          </label>
        </template>
      </div>
      <p v-if="isAdmin && erreurFiltres" role="alert" class="mt-2 text-sm text-red-700">
        {{ errorMessage(erreurFiltres) }}
      </p>
    </section>

    <section v-if="isAdmin && tableau?.retards_admin" class="card">
      <h2 class="text-lg">Échéances en retard</h2>
      <p class="mb-3 mt-1 text-sm text-gray-600">Montants encore dus au-delà de la date prévue, toutes dates confondues.</p>
      <dl class="grid gap-3 sm:grid-cols-2">
        <div v-if="!beneficiaire">
          <dt class="text-sm text-gray-600">Encaissements fournisseur en retard</dt>
          <dd class="font-semibold">{{ financeEuros(tableau.retards_admin.encaissement_cents) }} HT</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-600">Reversements en retard</dt>
          <dd class="font-semibold">{{ financeEuros(tableau.retards_admin.reversement_cents) }} HT</dd>
        </div>
      </dl>
    </section>

    <section v-if="isAdmin && tableau?.total_incomplets" class="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 class="font-semibold text-amber-900">
        Dossiers signés à compléter ({{ tableau.total_incomplets }})
      </h2>
      <p class="my-2 text-sm text-amber-900">
        Une signature sans date ne figure pas dans le mois correspondant. Une commission manquante reste à renseigner.
      </p>
      <details class="text-sm text-amber-900">
        <summary class="cursor-pointer font-medium">Voir les dossiers</summary>
        <ul class="mt-2 space-y-1">
          <li v-for="d in tableau.incomplets" :key="d.prospect_id">
            <NuxtLink :to="`/prospects/${d.prospect_id}`" class="font-medium underline">{{ d.dossier }}</NuxtLink>
            · {{ [d.sans_date && 'date de signature', d.sans_commission && 'commission HT'].filter(Boolean).join(', ') }}
          </li>
        </ul>
        <p v-if="tableau.total_incomplets > tableau.incomplets.length" class="mt-2">
          Les {{ tableau.incomplets.length }} premiers dossiers sont affichés. Affinez les filtres pour réduire la liste.
        </p>
      </details>
    </section>

    <div v-if="tableau" class="grid gap-4 xl:grid-cols-3">
      <FinanceMonthlyChart
        v-for="chart in chartGroups" :key="chart.title" :title="chart.title" :series="chart.series"
        :months="moisVisibles" :values="tableau.mois" @select="selectChart"
      />
    </div>

    <section v-if="tableau" class="card" :aria-busy="status === 'pending'">
      <h2 class="text-lg">
        Synthèse mensuelle HT
      </h2>
      <p class="mb-3 mt-1 text-sm text-gray-600">
        Les montants sont rattachés à la date de signature, à la date prévue ou à la date du règlement selon la colonne.
      </p>
      <div class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Mois</th>
              <th v-for="t in types" :key="t" class="min-w-28">{{ FINANCE_TYPES[t] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in moisVisibles" :key="m.id">
              <th scope="row" class="capitalize">{{ m.label }}</th>
              <td v-for="t in types" :key="t" class="whitespace-nowrap">
                {{ financeEuros(ligneMois(m.id, t)?.montant_cents ?? null) }}
                <span v-if="t === 'signature' && ligneMois(m.id, t)" class="block text-xs text-gray-600">
                  {{ ligneMois(m.id, t)?.nombre }} dossier(s)
                </span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td v-for="t in types" :key="t" class="whitespace-nowrap font-semibold">{{ financeEuros(totalType(t)) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <section v-if="tableau" class="card" :aria-busy="status === 'pending'">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 class="text-lg">
          Détail des opérations <span class="text-sm font-normal text-gray-600">({{ tableau.total }})</span>
        </h2>
        <label>
          <span class="label">Type d’opération</span>
          <select v-model="type" class="input">
            <option value="">Tous</option>
            <option v-for="t in types" :key="t" :value="t">{{ FINANCE_TYPES[t] }}</option>
          </select>
        </label>
      </div>
      <p v-if="!tableau.lignes.length" class="text-sm text-gray-600">
        Aucune opération pour ces filtres.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Date</th>
              <th>Dossier</th>
              <th>Opération</th>
              <th>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in tableau.lignes" :key="`${l.type}-${l.id}`">
              <td class="whitespace-nowrap">{{ financeDate(l.date) }}</td>
              <td>
                <NuxtLink v-if="isAdmin" :to="`/prospects/${l.prospect_id}`" class="font-semibold text-primary hover:underline">{{ l.dossier }}</NuxtLink>
                <strong v-else>{{ l.dossier }}</strong>
                <span class="block text-xs text-gray-600">{{ fournisseurNom(l.fournisseur) }} · {{ energieNom(l.energie) }}</span>
              </td>
              <td>
                {{ FINANCE_TYPES[l.type] }}
                <span v-if="isAdmin && l.beneficiaire" class="block text-xs text-gray-600">{{ l.beneficiaire }}</span>
              </td>
              <td class="whitespace-nowrap">{{ l.montant_cents === null ? 'À renseigner' : financeEuros(l.montant_cents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="totalPages > 1" class="mt-3 flex items-center justify-end gap-3 text-sm">
        <button type="button" class="btn-secondary" :disabled="page <= 1 || status === 'pending'" @click="page--">Précédent</button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button type="button" class="btn-secondary" :disabled="page >= totalPages || status === 'pending'" @click="page++">Suivant</button>
      </div>
    </section>

    <section v-if="isAdmin" id="beneficiaires" class="card scroll-mt-6 space-y-4">
      <div>
        <h2 class="text-lg">Bénéficiaires</h2>
        <p class="mt-1 text-sm text-gray-600">
          Un bénéficiaire peut exister sans compte CRM. Lier un compte lui permet de consulter ses propres commissions.
        </p>
      </div>
      <form ref="formulaireAnnuaire" class="rounded-lg bg-gray-50 p-4" @submit.prevent="enregistrerBeneficiaire">
        <fieldset :disabled="sauvegarde" class="grid items-end gap-3 sm:grid-cols-2">
          <legend class="mb-2 text-sm font-semibold">{{ edition.id ? 'Modifier le bénéficiaire' : 'Nouveau bénéficiaire' }}</legend>
          <label>
            <span class="label">Nom</span>
            <input v-model="edition.nom" class="input" maxlength="150" required>
          </label>
          <label>
            <span class="label">Compte CRM (facultatif)</span>
            <select v-model="edition.profil_id" class="input">
              <option value="">Aucun compte lié</option>
              <option v-for="p in annuaire?.profils" :key="p.id" :value="p.id">{{ p.nom }}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="edition.actif" type="checkbox">
            Actif pour les nouvelles répartitions
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary">{{ edition.id ? 'Enregistrer' : 'Créer le bénéficiaire' }}</button>
            <button v-if="edition.id" type="button" class="btn-secondary" @click="modifierBeneficiaire()">Annuler</button>
          </div>
        </fieldset>
      </form>
      <p v-if="erreurEdition || erreurAnnuaire" role="alert" class="text-sm text-red-700">
        {{ erreurEdition || errorMessage(erreurAnnuaire) }}
      </p>
      <p v-else-if="confirmation" role="status" class="text-sm text-primary">{{ confirmation }}</p>
      <p v-if="annuaire && !annuaire.beneficiaires.length" class="text-sm text-gray-600">
        Aucun bénéficiaire enregistré.
      </p>
      <div v-else-if="annuaire?.beneficiaires.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Compte CRM</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in annuaire.beneficiaires" :key="b.id">
              <td class="font-semibold">{{ b.nom }}</td>
              <td>{{ b.profil_id ? annuaire.profils.find(p => p.id === b.profil_id)?.nom ?? 'Compte lié' : '—' }}</td>
              <td>{{ b.actif ? 'Actif' : 'Désactivé' }}</td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn-secondary" :disabled="sauvegarde" @click="modifierBeneficiaire(b)">Modifier</button>
                  <button type="button" class="btn-secondary" :disabled="sauvegarde" @click="supprimerBeneficiaire(b)">Supprimer</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
