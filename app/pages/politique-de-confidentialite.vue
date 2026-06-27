<script setup lang="ts">
definePageMeta({ layout: false })

useHead({
  title: 'Politique de Confidentialité — R&A Energy',
  meta: [
    {
      name: 'description',
      content: 'Politique de confidentialité du CRM R&A Energy. Informations sur la collecte et le traitement de vos données, y compris l\'intégration avec Google Calendar.'
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
        <h1 class="text-3xl text-primary font-bold tracking-tight">Politique de Confidentialité</h1>
        <p class="text-sm text-gray-500 mt-2">Dernière mise à jour : 27 juin 2026</p>
      </div>

      <!-- Contenu -->
      <div class="space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 class="text-lg font-bold text-ink mb-2">1. Introduction</h2>
          <p>
            La présente Politique de Confidentialité décrit la manière dont l'application CRM interne de **R&A Energy** collecte, utilise et protège vos informations. Ce document s'adresse principalement aux collaborateurs et partenaires habilités à utiliser nos services de gestion de prospects et de prise de rendez-vous.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">2. Utilisation des données d'intégration Google (Google APIs)</h2>
          <p class="mb-3">
            Notre CRM interagit avec les services Google (notamment <strong>Google Calendar API</strong>) afin de simplifier la planification des rendez-vous et d'éviter les doubles saisies ou les conflits d'horaires.
          </p>
          <div class="bg-gray-50 rounded-lg p-4 border border-gray-205 mb-3">
            <h3 class="font-semibold text-primary mb-1">Quelles données sont lues et écrites ?</h3>
            <ul class="list-disc pl-5 space-y-1 text-sm text-gray-600">
              <li>
                <strong>Données de disponibilité (FreeBusy) :</strong> L'application interroge vos créneaux libres/occupés pour s'assurer que vous êtes disponible avant de vous attribuer un rendez-vous commercial.
              </li>
              <li>
                <strong>Création d'événements :</strong> Lorsqu'un rendez-vous est programmé dans le CRM par un téléprospecteur, l'application crée automatiquement un événement dans votre Google Agenda avec les détails du rendez-vous (nom du prospect, adresse géocodée et heure).
              </li>
              <li>
                <strong>Identifiants de connexion (Tokens) :</strong> L'application stocke de manière chiffrée vos jetons d'accès OAuth (access token et refresh token) pour maintenir la liaison avec votre agenda sans que vous ayez à vous reconnecter à chaque fois.
              </li>
            </ul>
          </div>
          <p class="text-sm font-medium text-ink">
            Note de conformité Google OAuth : L'utilisation des informations reçues par les API Google est conforme aux <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">règles de Google concernant les données utilisateur des services d'API</a>, y compris les exigences d'utilisation limitée.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">3. Partage et transfert des données</h2>
          <p>
            Nous ne vendons, n'échangeons et ne transférons aucune information personnelle ou liée à votre compte Google à des tiers. Les données de votre calendrier sont utilisées exclusivement pour le bon fonctionnement des fonctionnalités de planification interne de R&A Energy.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">4. Stockage et sécurité des données</h2>
          <p>
            Toutes les données sont stockées en toute sécurité au sein de notre infrastructure hébergée chez Supabase (base de données PostgreSQL sécurisée avec des règles de sécurité de niveau ligne - RLS) et chiffrées selon les standards de l'industrie. Les accès sont restreints aux seuls membres de l'équipe R&A Energy selon leur rôle (admin, télépro, commercial).
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">5. Révocation des accès et suppression des données</h2>
          <p class="mb-2">
            Vous conservez à tout moment le contrôle total de vos données et de votre connexion Google Calendar :
          </p>
          <ul class="list-disc pl-5 space-y-1">
            <li>
              Vous pouvez déconnecter votre compte Google Calendar en un clic depuis votre page <strong>Profil</strong> dans le CRM.
            </li>
            <li>
              Vous pouvez également révoquer définitivement les permissions d'accès accordées à notre CRM depuis les paramètres de votre compte Google, à la page <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Applications ayant accès à votre compte</a>.
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-lg font-bold text-ink mb-2">6. Contact</h2>
          <p>
            Pour toute question relative à cette politique ou pour exercer vos droits sur vos données personnelles, veuillez contacter le responsable d'administration à l'adresse email suivante : <a href="mailto:rgpd@ra-energy.fr" class="text-primary hover:underline font-medium">rgpd@ra-energy.fr</a>.
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
