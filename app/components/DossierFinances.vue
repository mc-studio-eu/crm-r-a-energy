<script setup lang="ts">
import {
  financeDate, financeDecimal, financeEuros, financeToday, MAX_FINANCE_CENTS, parseFinanceDecimal,
  type FinanceAction, type FinanceAnnuaire, type FinanceDossier, type FinanceEcheance, type FinancePaiement,
} from '~~/shared/finance'

const props = defineProps<{ prospectId: string }>()
const url = computed(() => `/api/finances/${props.prospectId}`)
const { data: dossier, status, error: lectureErreur, refresh } = await useFetch<FinanceDossier>(url, { lazy: true, server: false })
const { data: annuaire, error: annuaireErreur } = await useFetch<FinanceAnnuaire>('/api/beneficiaires', { lazy: true, server: false })

const base = ref('')
const parts = ref<{ beneficiaire_id: string, taux: string, fonction: string }[]>([])
const erreur = ref('')
const message = ref('')
const enCours = ref(false)
const formulaire = ref<HTMLElement>()
type Edition =
  | { type: 'echeance', id?: string, repartition_id: string }
  | { type: 'paiement', id?: string, echeance_id: string }
const edition = ref<Edition | null>(null)
const mouvement = reactive({ date: '', montant: '', note: '' })
const beneficiaires = computed(() => annuaire.value?.beneficiaires ?? [])
const partsEnregistrees = computed(() => dossier.value?.repartitions ?? [])
const echeances = computed(() => dossier.value?.echeances ?? [])

function initialiserCommission() {
  base.value = financeDecimal(dossier.value?.commission_cents ?? null)
  parts.value = partsEnregistrees.value.map(part => ({
    beneficiaire_id: part.beneficiaire_id,
    taux: financeDecimal(part.taux_bps),
    fonction: part.fonction,
  }))
}

watch(dossier, (value, before) => {
  if (value && !before) initialiserCommission()
}, { immediate: true })

async function enregistrer(action: FinanceAction, succes: string) {
  enCours.value = true
  erreur.value = ''
  message.value = ''
  try {
    await $fetch<{ id: string }>(url.value, { method: 'POST', body: action })
    await refresh()
    message.value = succes
    return true
  }
  catch (error) {
    erreur.value = errorMessage(error)
    return false
  }
  finally {
    enCours.value = false
  }
}

async function enregistrerCommission() {
  const commission = parseFinanceDecimal(base.value, MAX_FINANCE_CENTS)
  if (commission === null) {
    erreur.value = 'Saisissez une commission positive ou nulle, avec deux décimales au maximum.'
    return
  }
  const repartitions = parts.value.map(part => ({
    beneficiaire_id: part.beneficiaire_id,
    taux_bps: parseFinanceDecimal(part.taux, 10_000) ?? -1,
    fonction: part.fonction.trim(),
  }))
  if (repartitions.some(part => !part.beneficiaire_id || !part.fonction || part.taux_bps < 0)
    || new Set(repartitions.map(part => part.beneficiaire_id)).size !== repartitions.length
    || repartitions.reduce((sum, part) => sum + part.taux_bps, 0) > 10_000) {
    erreur.value = 'Choisissez des bénéficiaires distincts avec une fonction et des taux dont la somme ne dépasse pas 100 %.'
    return
  }
  if (await enregistrer({ action: 'commission', commission_cents: commission, repartitions }, 'Commission enregistrée.')) {
    initialiserCommission()
  }
}

function totalPaye(echeance: FinanceEcheance) {
  return echeance.paiements.reduce((total, paiement) => total + paiement.montant_cents, 0)
}

async function ouvrirMouvement(cible: Edition, date: string, montant: number | null, note: string | null) {
  edition.value = cible
  mouvement.date = date
  mouvement.montant = financeDecimal(montant)
  mouvement.note = note ?? ''
  erreur.value = ''
  message.value = ''
  await nextTick()
  formulaire.value?.querySelector('input')?.focus()
}

function ouvrirEcheance(e?: FinanceEcheance) {
  return ouvrirMouvement(
    { type: 'echeance', id: e?.id, repartition_id: e?.repartition_id ?? '' },
    e?.date_prevue ?? financeToday(), e?.montant_cents ?? null, e?.note ?? null,
  )
}

function ouvrirPaiement(e: FinanceEcheance, paiement?: FinancePaiement) {
  return ouvrirMouvement(
    { type: 'paiement', id: paiement?.id, echeance_id: e.id },
    paiement?.date_paiement ?? financeToday(), paiement?.montant_cents ?? e.montant_cents - totalPaye(e),
    paiement?.note ?? null,
  )
}

async function enregistrerMouvement() {
  const cible = edition.value
  if (!cible) return
  const montant = parseFinanceDecimal(mouvement.montant, MAX_FINANCE_CENTS)
  if (montant === null || montant <= 0) {
    erreur.value = 'Saisissez un montant supérieur à zéro, avec deux décimales au maximum.'
    return
  }
  const champs = { id: cible.id, montant_cents: montant, note: mouvement.note }
  const action: FinanceAction = cible.type === 'echeance'
    ? { action: 'echeance', ...champs, date_prevue: mouvement.date, repartition_id: cible.repartition_id || null }
    : { action: 'paiement', ...champs, date_paiement: mouvement.date, echeance_id: cible.echeance_id }
  if (await enregistrer(action, cible.type === 'echeance' ? 'Échéance enregistrée.' : 'Paiement enregistré.')) {
    edition.value = null
  }
}

async function supprimerMouvement(type: 'echeance' | 'paiement', id: string) {
  if (!confirm(type === 'echeance' ? 'Supprimer cette échéance ?' : 'Supprimer ce paiement du registre ?')) return
  const action = type === 'echeance' ? 'supprimer_echeance' : 'supprimer_paiement'
  if (await enregistrer({ action, id }, 'Correction enregistrée.') && edition.value?.id === id) {
    edition.value = null
  }
}

function sens(e: FinanceEcheance) {
  return e.repartition_id
    ? `Reversement · ${partsEnregistrees.value.find(part => part.id === e.repartition_id)?.beneficiaire ?? 'Bénéficiaire'}`
    : 'Encaissement fournisseur'
}
</script>

<template>
  <section class="card space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg">
        Finances du dossier
      </h2>
      <NuxtLink to="/finances#beneficiaires" class="text-sm font-medium text-primary hover:underline">
        Gérer les bénéficiaires
      </NuxtLink>
    </div>

    <p v-if="lectureErreur" role="alert" class="text-sm text-red-700">
      {{ errorMessage(lectureErreur) }}
    </p>
    <p v-else-if="!dossier && status === 'pending'" class="text-sm text-gray-500">
      Chargement des finances…
    </p>
    <template v-else-if="dossier">
      <form class="space-y-3 rounded-lg border border-gray-200 p-4" @submit.prevent="enregistrerCommission">
        <fieldset :disabled="enCours" class="space-y-3">
          <legend class="mb-2 text-sm font-semibold">
            Commission et répartitions
          </legend>
          <label class="block max-w-xs">
            <span class="label">Commission totale fournisseur (€ HT)</span>
            <input v-model="base" class="input" inputmode="decimal" placeholder="0,00" required>
          </label>
          <div v-for="(part, index) in parts" :key="index" class="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_auto]">
            <label>
              <span class="label">Bénéficiaire {{ index + 1 }}</span>
              <select v-model="part.beneficiaire_id" class="input" required>
                <option value="" disabled>
                  Choisir un bénéficiaire
                </option>
                <option v-if="part.beneficiaire_id && !beneficiaires.some(b => b.id === part.beneficiaire_id)" :value="part.beneficiaire_id">
                  {{ partsEnregistrees.find(r => r.beneficiaire_id === part.beneficiaire_id)?.beneficiaire }}
                </option>
                <option v-for="b in beneficiaires" :key="b.id" :value="b.id" :disabled="!b.actif && b.id !== part.beneficiaire_id">
                  {{ b.nom }}{{ b.actif ? '' : ' (désactivé)' }}
                </option>
              </select>
            </label>
            <label>
              <span class="label">Fonction</span>
              <input v-model="part.fonction" class="input" maxlength="80" placeholder="Apporteur, commercial…" required>
            </label>
            <label>
              <span class="label">Part (%)</span>
              <input v-model="part.taux" inputmode="decimal" class="input" placeholder="0,00" required>
            </label>
            <button type="button" class="btn-secondary" @click="parts.splice(index, 1)">
              Retirer
            </button>
          </div>
          <p v-if="annuaireErreur" role="alert" class="text-sm text-red-700">
            {{ errorMessage(annuaireErreur) }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" class="btn-primary">
              Enregistrer la commission
            </button>
            <button
              v-if="parts.length < 2" type="button" class="btn-secondary"
              :disabled="!beneficiaires.some(b => b.actif && !parts.some(p => p.beneficiaire_id === b.id))"
              @click="parts.push({ beneficiaire_id: '', taux: '', fonction: 'Apporteur' })"
            >
              Ajouter une part
            </button>
          </div>
        </fieldset>
        <ul v-if="partsEnregistrees.length" class="text-sm text-gray-600">
          <li v-for="part in partsEnregistrees" :key="part.id">
            {{ part.beneficiaire }} ({{ part.fonction }}) : <strong>{{ financeEuros(part.montant_cents) }} HT</strong> enregistrés
          </li>
        </ul>
      </form>

      <div v-if="dossier.commission_cents !== null" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="font-semibold">
            Échéances et paiements HT
          </h3>
          <button type="button" class="btn-secondary" :disabled="enCours" @click="ouvrirEcheance()">
            Nouvelle échéance
          </button>
        </div>
        <form v-if="edition" ref="formulaire" class="space-y-3 rounded-lg bg-gray-50 p-4" @submit.prevent="enregistrerMouvement">
          <fieldset :disabled="enCours" class="space-y-3">
            <legend class="mb-2 text-sm font-semibold">
              {{ edition.id ? 'Corriger' : 'Ajouter' }} {{ edition.type === 'echeance' ? 'une échéance' : 'un paiement' }}
            </legend>
            <label v-if="edition.type === 'echeance' && !edition.id" class="block">
              <span class="label">Flux</span>
              <select v-model="edition.repartition_id" class="input">
                <option value="">
                  Encaissement fournisseur
                </option>
                <option v-for="part in partsEnregistrees" :key="part.id" :value="part.id">
                  Reversement · {{ part.beneficiaire }}
                </option>
              </select>
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <label>
                <span class="label">{{ edition.type === 'echeance' ? 'Date prévue' : 'Date du paiement' }}</span>
                <input v-model="mouvement.date" type="date" class="input" required>
              </label>
              <label>
                <span class="label">Montant (€ HT)</span>
                <input v-model="mouvement.montant" inputmode="decimal" class="input" required>
              </label>
            </div>
            <label class="block">
              <span class="label">Note (facultatif)</span>
              <input v-model="mouvement.note" class="input" maxlength="500">
            </label>
            <div class="flex flex-wrap gap-2">
              <button type="submit" class="btn-primary">
                Enregistrer
              </button>
              <button type="button" class="btn-secondary" @click="edition = null">
                Annuler
              </button>
            </div>
          </fieldset>
        </form>
        <p v-if="!echeances.length" class="text-sm text-gray-500">
          Aucune échéance enregistrée.
        </p>
        <details v-for="e in echeances" :key="e.id" class="rounded-lg border border-gray-200 p-3">
          <summary class="cursor-pointer text-sm">
            <strong>{{ sens(e) }}</strong> · {{ financeDate(e.date_prevue) }} · {{ financeEuros(e.montant_cents) }}
            <span class="ml-1 text-gray-600">({{ financeEuros(totalPaye(e)) }} payés)</span>
          </summary>
          <p v-if="e.note" class="mt-2 break-words text-sm text-gray-600">
            {{ e.note }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-secondary" :disabled="enCours || totalPaye(e) >= e.montant_cents" @click="ouvrirPaiement(e)">
              Ajouter un paiement
            </button>
            <button type="button" class="btn-secondary" :disabled="enCours" @click="ouvrirEcheance(e)">
              Corriger l’échéance
            </button>
            <button
              v-if="!e.paiements.length" type="button" class="btn-secondary"
              :disabled="enCours" @click="supprimerMouvement('echeance', e.id)"
            >
              Supprimer l’échéance
            </button>
          </div>
          <ul v-if="e.paiements.length" class="mt-3 divide-y divide-gray-100 text-sm">
            <li v-for="p in e.paiements" :key="p.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <span class="min-w-0 break-words">
                {{ financeDate(p.date_paiement) }} · <strong>{{ financeEuros(p.montant_cents) }}</strong>
                <span v-if="p.note" class="text-gray-600"> · {{ p.note }}</span>
              </span>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary" :disabled="enCours" @click="ouvrirPaiement(e, p)">
                  Corriger
                </button>
                <button type="button" class="btn-secondary" :disabled="enCours" @click="supprimerMouvement('paiement', p.id)">
                  Supprimer
                </button>
              </div>
            </li>
          </ul>
        </details>
      </div>
      <p v-if="erreur" role="alert" class="text-sm text-red-700">
        {{ erreur }}
      </p>
      <p v-else-if="message" role="status" class="text-sm text-primary">
        {{ message }}
      </p>
    </template>
  </section>
</template>
