<script setup lang="ts">
definePageMeta({ layout: false })

useHead({
  title: 'Conditions Générales d\'Utilisation — R&A Energy',
  meta: [
    {
      name: 'description',
      content: 'Conditions Générales d\'Utilisation du CRM R&A Energy. Modalités d\'accès et règles régissant l\'utilisation du service.'
    }
  ]
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-app-bg px-4 py-12 md:py-20">
    <div class="mx-auto w-full max-w-3xl card">
      <!-- En-tête -->
      <div class="mb-8 border-b border-gray-150 pb-6">
        <NuxtLink to="/login" class="inline-flex items-center text-sm font-medium text-primary hover:underline mb-4">
          ← Retour à la connexion
        </NuxtLink>
        <h1 class="text-3xl text-primary font-bold tracking-tight">Conditions Générales d'Utilisation</h1>
        <p class="text-sm text-gray-500 mt-2">Dernière mise à jour : 27 juin 2026</p>
      </div>

      <!-- Contenu -->
      <div class="space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 class="text-lg font-bold text-ink mb-2">1. Description du Service</h2>
          <p>
            L'application CRM R&A Energy est un outil interne développé pour et par <strong>R&A Energy</strong>. Elle permet la gestion des fiches prospects, le suivi des dossiers clients, et la planification optimale des rendez-vous pour nos équipes commerciales et de téléprospection.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">2. Conditions d'Accès</h2>
          <p>
            L'accès à l'application est strictement restreint aux collaborateurs, agents et partenaires contractuels autorisés par R&A Energy. Chaque utilisateur dispose d'un compte personnel créé sur invitation de l'administrateur. Il est strictement interdit de partager ses accès ou d'accorder à des tiers l'accès à la plateforme.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">3. Intégrations avec les Services Tiers (Google API)</h2>
          <p class="mb-2">
            Afin d'assurer sa mission de planification d'itinéraires et d'agendas, l'application s'intègre avec des outils tiers, notamment <strong>Google Calendar</strong>.
          </p>
          <ul class="list-disc pl-5 space-y-1">
            <li>
              En associant votre compte Google au CRM, vous autorisez l'application à consulter vos disponibilités de calendrier (statuts libre/occupé) et à insérer ou modifier des événements représentant des rendez-vous prospects.
            </li>
            <li>
              Cette association est optionnelle mais nécessaire pour bénéficier des fonctions d'attribution automatique et d'inscription dans votre agenda de travail.
            </li>
            <li>
              Le service décline toute responsabilité en cas de dysfonctionnement de l'API Google ou de modifications apportées directement par l'utilisateur à son agenda sans passer par l'interface du CRM.
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">4. Utilisation Acceptable et Obligations de l'Utilisateur</h2>
          <p class="mb-2">
            En utilisant cette application, vous vous engagez à :
          </p>
          <ul class="list-disc pl-5 space-y-1">
            <li>
              Fournir des informations exactes lors de la qualification des prospects et de la planification des rendez-vous.
            </li>
            <li>
              Respecter les règles de confidentialité des données personnelles de nos clients et prospects conformément au RGPD.
            </li>
            <li>
              Ne pas perturber ou tenter d'interrompre l'intégrité ou le bon fonctionnement des serveurs ou du réseau du CRM.
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">5. Propriété Intellectuelle</h2>
          <p>
            Tous les contenus (textes, images, codes source, interfaces, logos, etc.) figurant sur cette application sont la propriété exclusive de R&A Energy ou de ses partenaires techniques. Toute reproduction, modification ou distribution non autorisée de ces éléments est strictement interdite sous peine de poursuites.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">6. Limitation de Responsabilité</h2>
          <p>
            R&A Energy s'efforce de maintenir l'outil accessible et opérationnel 24h/24. Toutefois, le CRM est fourni "en l'état". Nous ne pouvons garantir une disponibilité ininterrompue ou exempte d'erreurs techniques. Nous ne saurions être tenus responsables de pertes indirectes de données ou de retards dans la prise de rendez-vous causés par des pannes de réseau ou de services tiers (tels que Google Maps ou Google Calendar).
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">7. Modifications des Conditions</h2>
          <p>
            R&A Energy se réserve le droit de modifier les présentes Conditions Générales d'Utilisation à tout moment pour les adapter aux évolutions techniques ou légales. Les utilisateurs en seront informés par toute notification appropriée sur l'application.
          </p>
        </section>
      </div>

      <!-- Pied de page -->
      <div class="mt-10 border-t border-gray-150 pt-6 text-center text-xs text-gray-400">
        © 2026 R&A Energy. Tous droits réservés.
      </div>
    </div>
  </div>
</template>
