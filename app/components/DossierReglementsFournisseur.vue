<script setup lang="ts">
import { financeDate, financeDecimal, financeEuros, financeToday, MAX_FINANCE_CENTS, parseFinanceDecimal } from '~~/shared/finance'
import {
  MAX_ANNEE_REGLEMENT, MAX_LIBELLE_REGLEMENT, MAX_NOTE_REGLEMENT, MAX_TAUX_REGLEMENT_BPS,
  type ActionReglementFournisseur, type ReglementFournisseur,
} from '~~/shared/reglements-fournisseur'

const props = defineProps<{ prospectId: string }>()
const emit = defineEmits<{ reglementsModifies: [] }>()
const url = computed(() => `/api/prospects/${props.prospectId}/reglements-fournisseur`)
const { data: reglements, status, error: erreurLecture } = await useFetch<ReglementFournisseur[]>(url, {
  lazy: true, server: false,
})

type Edition = { type: 'planification', id?: string } | { type: 'reception', id: string, libelle: string }
const edition = ref<Edition | null>(null)
const champLibelle = ref<HTMLInputElement>()
const champDateReception = ref<HTMLInputElement>()
const champs = reactive({
  libelle: '', modeDate: '' as '' | 'date' | 'annee', datePrevue: '', anneePrevue: '' as number | '',
  montant: '', taux: '', note: '',
})
const reception = reactive({ date: '', montant: '' })
const enCours = ref(false)
const erreur = ref('')
const message = ref('')
const pourcentage = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 })

function cleEcheance(reglement: ReglementFournisseur) {
  return reglement.date_prevue ?? (reglement.annee_prevue === null ? '99999' : String(reglement.annee_prevue).padStart(4, '0'))
}

const echeancier = computed(() => [...(reglements.value ?? [])].sort((a, b) => cleEcheance(a).localeCompare(cleEcheance(b))))

async function ouvrirFormulaire(reglement?: ReglementFournisseur) {
  edition.value = { type: 'planification', id: reglement?.id }
  champs.libelle = reglement?.libelle ?? ''
  champs.modeDate = reglement?.date_prevue ? 'date' : reglement?.annee_prevue ? 'annee' : ''
  champs.datePrevue = reglement?.date_prevue ?? ''
  champs.anneePrevue = reglement?.annee_prevue ?? ''
  champs.montant = financeDecimal(reglement?.montant_cents ?? null)
  champs.taux = financeDecimal(reglement?.taux_bps ?? null)
  champs.note = reglement?.note ?? ''
  erreur.value = ''
  message.value = ''
  await nextTick()
  champLibelle.value?.focus()
}

async function ouvrirReception(reglement: ReglementFournisseur) {
  edition.value = { type: 'reception', id: reglement.id, libelle: reglement.libelle }
  reception.date = reglement.date_reception ?? financeToday()
  reception.montant = financeDecimal(reglement.montant_recu_cents ?? reglement.montant_cents)
  erreur.value = ''
  message.value = ''
  await nextTick()
  champDateReception.value?.focus()
}

function fermerFormulaire() {
  edition.value = null
  erreur.value = ''
}

async function modifierListe(action: ActionReglementFournisseur) {
  enCours.value = true
  erreur.value = ''
  message.value = ''
  try {
    const liste = reglements.value ?? []
    if (action.action === 'supprimer') {
      await $fetch(url.value, { method: 'POST', body: action })
      reglements.value = liste.filter(r => r.id !== action.id)
      if (edition.value?.id === action.id) fermerFormulaire()
      message.value = 'Règlement supprimé.'
    }
    else {
      const reglement = await $fetch<ReglementFournisseur>(url.value, { method: 'POST', body: action })
      reglements.value = action.id ? liste.map(r => r.id === action.id ? reglement : r) : [...liste, reglement]
      fermerFormulaire()
      message.value = {
        enregistrer: 'Règlement enregistré.',
        recevoir: 'Réception enregistrée dans Finances.',
        annuler_reception: 'Réception annulée.',
      }[action.action]
    }
    emit('reglementsModifies')
  }
  catch (e) {
    erreur.value = errorMessage(e, 'L’opération sur le règlement a échoué.')
  }
  finally {
    enCours.value = false
  }
}

async function enregistrer() {
  if (edition.value?.type !== 'planification' || enCours.value) return
  erreur.value = ''
  message.value = ''
  const libelle = champs.libelle.trim()
  if (!libelle) {
    erreur.value = 'Saisissez un libellé.'
    return
  }
  const montant = parseFinanceDecimal(champs.montant, MAX_FINANCE_CENTS)
  if (champs.montant.trim() && (montant === null || montant === 0)) {
    erreur.value = 'Saisissez un montant positif avec deux décimales au maximum.'
    return
  }
  const taux = parseFinanceDecimal(champs.taux, MAX_TAUX_REGLEMENT_BPS)
  if (champs.taux.trim() && (taux === null || taux === 0)) {
    erreur.value = 'Saisissez un pourcentage supérieur à zéro et inférieur ou égal à 100, avec deux décimales au maximum.'
    return
  }
  const annee = champs.modeDate === 'annee' && typeof champs.anneePrevue === 'number' ? champs.anneePrevue : null
  if (champs.modeDate === 'annee' && (annee === null || !Number.isInteger(annee) || annee < 1 || annee > MAX_ANNEE_REGLEMENT)) {
    erreur.value = 'Saisissez une année prévue valide.'
    return
  }
  await modifierListe({
    action: 'enregistrer',
    id: edition.value.id,
    libelle,
    date_prevue: champs.modeDate === 'date' ? champs.datePrevue : null,
    annee_prevue: annee,
    montant_cents: montant,
    taux_bps: taux,
    note: champs.note.trim() || null,
  })
}

async function enregistrerReception() {
  if (edition.value?.type !== 'reception' || enCours.value) return
  const montant = parseFinanceDecimal(reception.montant, MAX_FINANCE_CENTS)
  if (!montant) {
    erreur.value = 'Saisissez le montant reçu, supérieur à zéro, avec deux décimales au maximum.'
    return
  }
  await modifierListe({
    action: 'recevoir', id: edition.value.id, date_reception: reception.date, montant_recu_cents: montant,
  })
}

async function annulerReception(reglement: ReglementFournisseur) {
  const confirmation = reglement.montant_recu_cents === null
    ? 'Annuler la date de réception de ce règlement ?'
    : 'Annuler cette réception et retirer l’encaissement de Finances ?'
  if (enCours.value || !confirm(confirmation)) return
  await modifierListe({ action: 'annuler_reception', id: reglement.id })
}

async function supprimer(reglement: ReglementFournisseur) {
  const confirmation = reglement.montant_recu_cents === null
    ? `Supprimer le règlement « ${reglement.libelle} » ?`
    : `Supprimer le règlement « ${reglement.libelle} » et retirer l’encaissement de Finances ?`
  if (enCours.value || !confirm(confirmation)) return
  await modifierListe({ action: 'supprimer', id: reglement.id })
}

function statut(reglement: ReglementFournisseur) {
  if (reglement.montant_recu_cents !== null) return 'Reçu'
  return reglement.date_reception ? 'Réception à confirmer' : 'Prévu'
}
</script>

<template>
  <section class="card space-y-4" aria-labelledby="reglements-fournisseur-titre">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="reglements-fournisseur-titre" class="text-lg">
          Règlements fournisseur
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          Confirmez une réception pour enregistrer le montant reçu dans Finances.
        </p>
      </div>
      <button v-if="status === 'success' && !edition" type="button" class="btn-primary" :disabled="enCours" @click="ouvrirFormulaire()">
        Ajouter un règlement
      </button>
    </div>

    <p v-if="erreurLecture" role="alert" class="text-sm text-red-700">
      {{ errorMessage(erreurLecture, 'Les règlements fournisseur n’ont pas pu être chargés.') }}
    </p>
    <p v-else-if="status === 'pending' || status === 'idle'" role="status" class="text-sm text-gray-600">
      Chargement des règlements…
    </p>
    <template v-else>
      <form v-if="edition?.type === 'planification'" class="rounded-lg border border-gray-200 bg-gray-50 p-4" @submit.prevent="enregistrer">
        <fieldset :disabled="enCours" class="space-y-3">
          <legend class="mb-2 text-sm font-semibold">
            {{ edition.id ? 'Modifier le règlement' : 'Nouveau règlement' }}
          </legend>
          <label class="block">
            <span class="label">Libellé</span>
            <input ref="champLibelle" v-model="champs.libelle" class="input" :maxlength="MAX_LIBELLE_REGLEMENT" placeholder="Ex. 50 % au démarrage, solde à la livraison" required>
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="label">Échéance prévue</span>
              <select v-model="champs.modeDate" class="input">
                <option value="">Non précisée</option>
                <option value="date">Date précise</option>
                <option value="annee">Année seule</option>
              </select>
            </label>
            <label v-if="champs.modeDate === 'date'">
              <span class="label">Date prévue</span>
              <input v-model="champs.datePrevue" type="date" class="input" min="0001-01-01" max="9999-12-31" required>
            </label>
            <label v-else-if="champs.modeDate === 'annee'">
              <span class="label">Année prévue</span>
              <input v-model.number="champs.anneePrevue" type="number" class="input" min="1" :max="MAX_ANNEE_REGLEMENT" step="1" placeholder="2028" required>
            </label>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="label">Montant prévu (€ HT, facultatif)</span>
              <input v-model="champs.montant" inputmode="decimal" class="input" placeholder="Ex. 1250,00">
            </label>
            <label>
              <span class="label">Part de la commission (%, facultatif)</span>
              <input v-model="champs.taux" inputmode="decimal" class="input" placeholder="Ex. 50">
            </label>
          </div>
          <label class="block">
            <span class="label">Note (facultative)</span>
            <textarea v-model="champs.note" class="input" rows="2" :maxlength="MAX_NOTE_REGLEMENT" />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary">
              {{ enCours ? 'Enregistrement…' : 'Enregistrer le règlement' }}
            </button>
            <button type="button" class="btn-secondary" @click="fermerFormulaire">
              Annuler
            </button>
          </div>
        </fieldset>
      </form>

      <form v-else-if="edition?.type === 'reception'" class="rounded-lg border border-gray-200 bg-gray-50 p-4" @submit.prevent="enregistrerReception">
        <fieldset :disabled="enCours" class="space-y-3">
          <legend class="mb-2 text-sm font-semibold">
            Réception · {{ edition.libelle }}
          </legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="label">Date de réception</span>
              <input ref="champDateReception" v-model="reception.date" type="date" class="input" min="0001-01-01" :max="financeToday()" required>
            </label>
            <label>
              <span class="label">Montant reçu (€ HT)</span>
              <input v-model="reception.montant" class="input" inputmode="decimal" required>
            </label>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary">
              {{ enCours ? 'Enregistrement…' : 'Enregistrer la réception' }}
            </button>
            <button type="button" class="btn-secondary" @click="fermerFormulaire">
              Annuler
            </button>
          </div>
        </fieldset>
      </form>

      <p v-if="!echeancier.length && !edition" class="text-sm text-gray-600">
        Aucun règlement fournisseur enregistré.
      </p>
      <ul v-else-if="echeancier.length" class="space-y-2">
        <li v-for="r in echeancier" :key="r.id" class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="min-w-0 font-semibold break-words">{{ r.libelle }}</p>
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="r.montant_recu_cents !== null ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'"
              >
                {{ statut(r) }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-600">
              {{ r.date_prevue ? `Prévu le ${financeDate(r.date_prevue)}` : r.annee_prevue ? `Prévu en ${r.annee_prevue}` : 'Échéance non précisée' }}
              <span v-if="r.montant_cents !== null"> · {{ financeEuros(r.montant_cents) }} HT</span>
              <span v-if="r.taux_bps !== null"> · {{ pourcentage.format(r.taux_bps / 10_000) }}</span>
            </p>
            <p v-if="r.date_reception" class="mt-1 text-xs text-gray-600">
              {{ r.montant_recu_cents === null
                ? `Date de réception saisie : ${financeDate(r.date_reception)}`
                : `${financeEuros(r.montant_recu_cents)} HT reçus le ${financeDate(r.date_reception)}` }}
            </p>
            <p v-if="r.note" class="mt-2 whitespace-pre-wrap break-words text-gray-600">{{ r.note }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="enCours" @click="ouvrirReception(r)">
              {{ r.montant_recu_cents !== null ? 'Corriger la réception' : 'Marquer comme reçu' }}
            </button>
            <button type="button" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="enCours" @click="ouvrirFormulaire(r)">
              Modifier
            </button>
            <button
              v-if="r.date_reception" type="button" class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="enCours" @click="annulerReception(r)"
            >
              Annuler la réception
            </button>
            <button type="button" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="enCours" @click="supprimer(r)">
              Supprimer
            </button>
          </div>
        </li>
      </ul>
    </template>
    <p v-if="erreur" role="alert" class="text-sm text-red-700">{{ erreur }}</p>
    <p v-else-if="message" role="status" class="text-sm text-primary">{{ message }}</p>
  </section>
</template>
