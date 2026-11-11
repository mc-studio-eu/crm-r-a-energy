<script setup lang="ts">
import {
  financeDate, financeDecimal, financeEuros, financeMontantsParTaux, financeTauxBps, financeToday, MAX_FINANCE_BENEFICIAIRES, MAX_FINANCE_CENTS, parseFinanceDecimal,
  type FinanceAction, type FinanceAnnuaire, type FinanceDossier, type FinanceEcheance, type FinancePaiement, type FinanceRepartitionSaisie,
} from '~~/shared/finance'

const props = defineProps<{ prospectId: string }>()
defineExpose({ actualiser: () => refresh() })
const url = computed(() => `/api/finances/${props.prospectId}`)
const { data: dossier, status, error: lectureErreur, refresh } = await useFetch<FinanceDossier>(url, { lazy: true, server: false })
const { data: annuaire, error: annuaireErreur } = await useFetch<FinanceAnnuaire>('/api/beneficiaires', { lazy: true, server: false })

const base = ref('')
type Part = { beneficiaire_id: string, fonction: string, saisie: 'taux' | 'montant', valeur: string }
const parts = ref<Part[]>([])
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
const echeancePaiement = computed(() => {
  const cible = edition.value
  return cible?.type === 'paiement' ? echeances.value.find(e => e.id === cible.echeance_id) : undefined
})
const commissionCents = computed(() => parseFinanceDecimal(base.value, MAX_FINANCE_CENTS))
const lignesParts = computed(() => {
  const commission = commissionCents.value
  const lignes = parts.value.map((part) => {
    const valeur = parseFinanceDecimal(part.valeur, part.saisie === 'montant' ? MAX_FINANCE_CENTS : 10_000)
    return {
      part,
      valeur,
      montant: part.saisie === 'montant' ? valeur : null,
      taux: part.saisie === 'taux' ? valeur : commission === null || valeur === null ? null : financeTauxBps(commission, valeur),
    }
  })
  if (commission !== null) {
    const parTaux = lignes.flatMap(ligne => ligne.part.saisie === 'taux' && ligne.taux !== null
      ? [{ ligne, beneficiaire_id: ligne.part.beneficiaire_id, taux_bps: ligne.taux }]
      : [])
    const montants = financeMontantsParTaux(commission, parTaux)
    parTaux.forEach(({ ligne }, index) => { ligne.montant = montants[index] ?? null })
  }
  return lignes
})

function modifierPart(part: Part, saisie: Part['saisie'], event: Event) {
  part.saisie = saisie
  part.valeur = (event.target as HTMLInputElement).value
}

function initialiserCommission() {
  base.value = financeDecimal(dossier.value?.commission_cents ?? null)
  parts.value = partsEnregistrees.value.map(part => ({
    beneficiaire_id: part.beneficiaire_id,
    fonction: part.fonction,
    saisie: part.saisie_montant ? 'montant' : 'taux',
    valeur: financeDecimal(part.saisie_montant ? part.montant_cents : part.taux_bps),
  }))
}

watch(dossier, (value, before) => {
  if (value && !before) initialiserCommission()
}, { immediate: true })

async function enregistrer(action: FinanceAction, succes: string) {
  if (enCours.value) return false
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
  const commission = commissionCents.value
  if (commission === null) {
    erreur.value = 'Saisissez une commission positive ou nulle, avec deux décimales au maximum.'
    return
  }
  const repartitions: FinanceRepartitionSaisie[] = []
  for (const { part, valeur } of lignesParts.value) {
    const fonction = part.fonction.trim()
    if (!part.beneficiaire_id || !fonction || repartitions.some(r => r.beneficiaire_id === part.beneficiaire_id)) {
      erreur.value = 'Choisissez des bénéficiaires distincts et renseignez leur fonction.'
      return
    }
    if (valeur === null) {
      erreur.value = part.saisie === 'montant'
        ? 'Saisissez un montant positif ou nul, avec deux décimales au maximum.'
        : 'Saisissez un pourcentage entre 0 et 100 %, avec deux décimales au maximum.'
      return
    }
    const champs = { beneficiaire_id: part.beneficiaire_id, fonction }
    repartitions.push(part.saisie === 'montant' ? { ...champs, montant_cents: valeur } : { ...champs, taux_bps: valeur })
  }
  if (repartitions.reduce((sum, part) => sum + (part.taux_bps ?? 0), 0) > 10_000) {
    erreur.value = 'La somme des pourcentages saisis ne peut pas dépasser 100 %.'
    return
  }
  if (lignesParts.value.reduce((sum, part) => sum + (part.montant ?? 0), 0) > commission) {
    erreur.value = 'La somme des montants des bénéficiaires ne peut pas dépasser la commission totale.'
    return
  }
  if (await enregistrer({ action: 'commission', commission_cents: commission, repartitions }, 'Commission enregistrée.')) {
    initialiserCommission()
  }
}

function totalPaye(echeance: FinanceEcheance) {
  return echeance.paiements.reduce((total, paiement) => total + paiement.montant_cents, 0)
}

function statutPaiement(e: FinanceEcheance) {
  const paye = totalPaye(e)
  if (paye >= e.montant_cents) return { libelle: 'Payé', classe: 'bg-primary/10 text-primary' }
  if (paye > 0) return { libelle: 'Partiellement payé', classe: 'bg-amber-100 text-amber-800' }
  return { libelle: 'Non payé', classe: 'bg-gray-100 text-gray-700' }
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

async function marquerCommePaye(e: FinanceEcheance) {
  const solde = e.montant_cents - totalPaye(e)
  if (enCours.value || solde <= 0 || e.repartition_id || e.reglement_fournisseur_id) return
  if (await enregistrer({
    action: 'paiement', echeance_id: e.id, montant_cents: solde,
    date_paiement: financeToday(), note: '',
  }, 'Échéance marquée comme payée. Les finances sont à jour.')) {
    if (edition.value?.type === 'paiement' && edition.value.echeance_id === e.id) edition.value = null
  }
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
          <div v-for="({ part, montant, taux }, index) in lignesParts" :key="index" class="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(5rem,1fr)_minmax(8rem,1fr)_auto]">
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
              <input
                :value="part.saisie === 'taux' ? part.valeur : financeDecimal(taux)"
                inputmode="decimal" class="input" placeholder="0,00" :required="part.saisie === 'taux'"
                @input="modifierPart(part, 'taux', $event)"
              >
            </label>
            <label>
              <span class="label">Montant (€ HT)</span>
              <input
                :value="part.saisie === 'montant' ? part.valeur : financeDecimal(montant)"
                inputmode="decimal" class="input" placeholder="0,00" :required="part.saisie === 'montant'"
                @input="modifierPart(part, 'montant', $event)"
              >
            </label>
            <button type="button" class="btn-secondary justify-self-start" @click="parts.splice(index, 1)">
              Retirer
            </button>
          </div>
          <p v-if="parts.some(part => part.saisie === 'montant')" class="text-xs text-gray-600">
            Le pourcentage calculé à partir d’un montant est arrondi à deux décimales.
          </p>
          <p v-if="annuaireErreur" role="alert" class="text-sm text-red-700">
            {{ errorMessage(annuaireErreur) }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" class="btn-primary">
              Enregistrer la commission
            </button>
            <button
              v-if="parts.length < MAX_FINANCE_BENEFICIAIRES" type="button" class="btn-secondary"
              :disabled="!beneficiaires.some(b => b.actif && !parts.some(p => p.beneficiaire_id === b.id))"
              @click="parts.push({ beneficiaire_id: '', saisie: 'taux', valeur: '', fonction: 'Apporteur' })"
            >
              Ajouter un bénéficiaire
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
              {{ edition.id ? 'Corriger' : 'Ajouter' }} {{ edition.type === 'echeance' ? 'une échéance' : echeancePaiement && !echeancePaiement.repartition_id ? 'un paiement fournisseur reçu' : 'un paiement' }}
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
            <p v-if="echeancePaiement && !echeancePaiement.repartition_id" class="text-sm text-gray-600">
              Échéance fournisseur du {{ financeDate(echeancePaiement.date_prevue) }}.
              Saisissez le montant réellement reçu et sa date. Le solde complet passe l’échéance à « Payé » ; un montant inférieur la passe à « Partiellement payé ».
            </p>
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
        <div v-for="e in echeances" :key="e.id" class="rounded-lg border border-gray-200 p-3">
          <div v-if="e.reglement_fournisseur_id" class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              <strong>{{ e.note || 'Encaissement fournisseur' }}</strong>
              <span v-if="e.paiements[0]"> · {{ financeEuros(e.paiements[0].montant_cents) }} HT reçus le {{ financeDate(e.paiements[0].date_paiement) }}</span>
            </p>
          </div>
          <details v-else>
            <summary class="cursor-pointer text-sm">
              <strong>{{ sens(e) }}</strong> · {{ financeDate(e.date_prevue) }} · {{ financeEuros(e.montant_cents) }}
              <span class="ml-1 text-gray-600">({{ financeEuros(totalPaye(e)) }} {{ e.repartition_id ? 'versés' : 'reçus' }})</span>
              <span class="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium" :class="statutPaiement(e).classe">
                {{ statutPaiement(e).libelle }}{{ e.repartition_id ? '' : ' par le fournisseur' }}
              </span>
            </summary>
            <p v-if="e.note" class="mt-2 break-words text-sm text-gray-600">
              {{ e.note }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button v-if="!e.repartition_id && totalPaye(e) < e.montant_cents" type="button" class="btn-secondary" :disabled="enCours" @click="ouvrirPaiement(e)">
                Paiement partiel ou autre date
              </button>
              <button v-if="e.repartition_id" type="button" class="btn-secondary" :disabled="enCours || totalPaye(e) >= e.montant_cents" @click="ouvrirPaiement(e)">
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
          <div v-if="!e.reglement_fournisseur_id && !e.repartition_id" class="mt-3 flex flex-wrap items-center gap-3">
            <button v-if="totalPaye(e) < e.montant_cents" type="button" class="btn-secondary" :disabled="enCours" @click="marquerCommePaye(e)">
              Marquer comme payé
            </button>
            <span v-if="totalPaye(e) < e.montant_cents" class="text-sm text-gray-600">
              {{ financeEuros(e.montant_cents - totalPaye(e)) }} HT · Paiement daté d’aujourd’hui
            </span>
            <span v-else class="text-sm text-primary">Échéance payée par le fournisseur.</span>
          </div>
        </div>
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
