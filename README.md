# CRM R&A Energy

CRM interne pour R&A Energy : gestion des prospects, prise de RDV par les telepros avec
vérification en temps réel de la disponibilité Google Calendar des commerciaux et du temps
de trajet (calcul d'itinéraire).

## Stack

- **Nuxt 4** full-stack (TypeScript, server routes Nitro)
- **Supabase** : Postgres + Auth + RLS (modules `@nuxtjs/supabase`)
- **Tailwind CSS 4** — charte graphique reprise de [ra-energy.fr](https://ra-energy.fr)
- **Google APIs** : Calendar (FreeBusy + Events), Geocoding, Routes
- **Vercel** : preview par PR, production sur `main`
- **Vitest** : tests unitaires de la logique métier

## Rôles

| Rôle | Accès |
|---|---|
| `admin` | Tout + gestion équipe + paramètres |
| `telepro` | Dossiers créés par lui, prise de RDV, planning global ; aucune finance |
| `commercial` | Ses prospects et ses RDV uniquement (RLS) |
| `regie_interne` | Ses dossiers, ses RDV et ses commissions personnelles |
| `regie_externe` | Ses dossiers et documents selon les droits historiques, ses commissions |
| `apporteur_externe` | Portail en lecture seule : ses dossiers signés résumés et ses propres commissions |

## Setup local

```bash
npm install
cp .env.example .env   # remplir les clés Supabase + Google
npm run dev
```

### Base de données

```bash
supabase link --project-ref <ref>
supabase db push          # applique les migrations
supabase db seed          # données de test (supabase/seed.sql)
```

Le premier compte se crée via le dashboard Supabase (Auth → Invite user), puis
un opérateur de confiance attribue explicitement `role = 'admin'` à sa ligne
`public.profiles` en base. Les métadonnées utilisateur ne confèrent aucun rôle
privilégié. Les invitations suivantes passent par l'écran Équipe de l'app.

Le [guide d'intégration](docs/integration-crm.md) décrit les sociétés multi-dossiers,
commissions, échéanciers, import Excel et la procédure de migration coordonnée.

### Variables d'environnement

Voir [.env.example](.env.example). En production, les renseigner dans Vercel
(environnements Preview + Production).

## Conventions

- **Commits** : [Conventional Commits](https://www.conventionalcommits.org/fr/) — `feat:`, `fix:`, `chore:`, `refactor:`…
- **Branches** : `main` protégée, une branche par ticket (`feat/05-fiches-prospects`), PR obligatoire
- **Tests** : `npm run test` — la logique métier critique (règle d'itinéraire, conflits de créneaux) est testée unitairement

## Structure

```
app/            pages, composants, composables, middleware (rôles)
server/api/     routes Nitro (admin users, checks RDV, OAuth Google, géocodage)
server/utils/   logique métier (règle trajet, checks RDV, clients Google/Supabase)
supabase/       migrations SQL versionnées + seed
shared/types/   types et constantes partagés client/serveur
tests/          tests unitaires Vitest
```
