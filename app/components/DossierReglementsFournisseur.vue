<script setup lang="ts">
import { financeDate, financeDecimal, financeEuros, MAX_FINANCE_CENTS, parseFinanceDecimal } from '~~/shared/finance'
import {
  MAX_ANNEE_REGLEMENT, MAX_LIBELLE_REGLEMENT, MAX_NOTE_REGLEMENT, MAX_TAUX_REGLEMENT_BPS,
  type ActionReglementFournisseur, type ReglementFournisseur,
} from '~~/shared/reglements-fournisseur'

const props = defineProps<{ prospectId: string }>()
const url = computed(() => `/api/prospects/${props.prospectId}/reglements-fournisseur`)
const { data: reglements, status, error: erreurLecture } = await useFetch<ReglementFournisseur[]>(url, {
  lazy: true, server: false,
})

const edition = ref<{ id?: string } | null>(null)
const champLibelle = ref<HTMLInputElement>()
const champs = reactive({
  libelle: '', modeDate: '' as '' | 'date' | 'annee', datePrevue: '', anneePrevue: '' as number | '',
  montant: '', taux: '', dateReception: '', note: '',
})
const enCours = ref(false)
const erreur = ref('')
const message = ref('')
const pourcentage = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 })

function cleEcheance(reglement: ReglementFournisseur) {
  return reglement.date_prevue ?? (reglement.annee_prevue === null ? '99999' : String(reglement.annee_prevue).padStart(4, '0'))
}

const echeancier = computed(() => [...(reglements.value ?? [])].sort((a, b) => cleEcheance(a).localeCompare(cleEcheance(b))))

async function ouvrirFormulaire(reglement?: ReglementFournisseur) {
  edition.value = { id: reglement?.id }
  champs.libelle = reglement?.libelle ?? ''
  champs.modeDate = reglement?.date_prevue ? 'date' : reglement?.annee_prevue ? 'annee' : ''
  champs.datePrevue = reglement?.date_prevue ?? ''
  champs.anneePrevue = reglement?.annee_prevue ?? ''
  champs.montant = financeDecimal(reglement?.montant_cents ?? null)
  champs.taux = financeDecimal(reglement?.taux_bps ?? null)
  champs.dateReception = reglement?.date_reception ?? ''
  champs.note = reglement?.note ?? ''
  erreur.value = ''
  message.value = ''
  await nextTick()
  champLibelle.value?.focus()
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
    if (action.action === 'supprimer') {
      await $fetch(url.value, { method: 'POST', body: action })
      reglements.value = (reglements.value ?? []).filter(r => r.id !== action.id)
      if (edition.value?.id === action.id) fermerFormulaire()
      message.value = 'Règlement supprimé.'
    }
    else {
      const reglement = await $fetch<ReglementFournisseur>(url.value, { method: 'POST', body: action })
      const liste = reglements.value ?? []
      reglements.value = action.id ? liste.map(r => r.id === action.id ? reglement : r) : [...liste, reglement]
      fermerFormulaire()
      message.value = 'Règlement enregistré.'
    }
  }
  catch (e) {
    erreur.value = errorMessage(e, 'L’opération sur le règlement a échoué.')
  }
  finally {
    enCours.value = false
  }
}

async function enregistrer() {
  if (!edition.value || enCours.value) return
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
    date_reception: champs.dateReception || null,
    note: champs.note.trim() || null,
  })
}

async function supprimer(reglement: ReglementFournisseur) {
  if (enCours.value || !confirm(`Supprimer le règlement « ${reglement.libelle} » ?`)) return
  await modifierListe({ action: 'supprimer', id: reglement.id })
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
          Suivez les versements convenus avec le fournisseur. Ce suivi est séparé du registre financier et ne met pas à jour les totaux de la page Finances.
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
      <form v-if="edition" class="rounded-lg border border-gray-200 bg-gray-50 p-4" @submit.prevent="enregistrer">
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
              <span class="label">Montant (€ HT, facultatif)</span>
              <input v-model="champs.montant" inputmode="decimal" class="input" placeholder="Ex. 1250,00">
            </label>
            <label>
              <span class="label">Part de la commission (%, facultatif)</span>
              <input v-model="champs.taux" inputmode="decimal" class="input" placeholder="Ex. 50">
            </label>
          </div>
          <label class="block sm:max-w-xs">
            <span class="label">Date de réception (facultative)</span>
            <input v-model="champs.dateReception" type="date" class="input" min="0001-01-01" max="9999-12-31">
            <span class="mt-1 block text-xs text-gray-600">Renseignez cette date pour marquer le règlement comme reçu.</span>
          </label>
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
                :class="r.date_reception ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'"
              >
                {{ r.date_reception ? 'Reçu' : 'Prévu' }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-600">
              {{ r.date_prevue ? `Prévu le ${financeDate(r.date_prevue)}` : r.annee_prevue ? `Prévu en ${r.annee_prevue}` : 'Échéance non précisée' }}
              <span v-if="r.montant_cents !== null"> · {{ financeEuros(r.montant_cents) }} HT</span>
              <span v-if="r.taux_bps !== null"> · {{ pourcentage.format(r.taux_bps / 10_000) }}</span>
              <span v-if="r.date_reception"> · Reçu le {{ financeDate(r.date_reception) }}</span>
            </p>
            <p v-if="r.note" class="mt-2 whitespace-pre-wrap break-words text-gray-600">{{ r.note }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="enCours" @click="ouvrirFormulaire(r)">
              Modifier
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
