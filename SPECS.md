# Spécifications v1 — CRM R&A Energy

> Document de cadrage (ticket 01). Statuts, rôles et choix d'APIs proposés ci-dessous,
> **à valider formellement avec le client** avant la mise en production.

## Utilisateurs et rôles

| Rôle | User story principale |
|---|---|
| **Telepro** | Je qualifie des prospects par téléphone et je place des RDV pour les commerciaux sans risque de doublon ni de trajet impossible. |
| **Commercial** | Je vois mes RDV (app + Google Agenda) et mes prospects assignés, je mets à jour le statut après visite. |
| **Admin** | Je gère les comptes salariés, je paramètre l'outil et je supervise toute l'activité. |

### Permissions

- **Admin** : tout, + écran Équipe (invitations, rôles, désactivation) et Paramètres
- **Telepro** : tous les prospects/RDV en lecture-écriture, prise de RDV, planning global
- **Commercial** : uniquement ses prospects assignés et ses RDV (appliqué par RLS Postgres)

## Pipeline de statuts prospect

`Nouveau` → `À rappeler` → `RDV placé` → `Signé` / `Perdu`

Chaque changement est historisé automatiquement (auteur + horodatage).

## Statuts RDV

`Planifié` / `Honoré` / `Annulé` / `No-show`

## Choix techniques tranchés

| Sujet | Décision | Justification |
|---|---|---|
| API itinéraire | **Google Routes API** (TRAFFIC_AWARE) | Cohérence avec l'écosystème Google déjà requis (Calendar, Geocoding), trafic temps réel ; cache 1 h côté serveur pour limiter les coûts |
| Google Calendar | **Lecture dispo (FreeBusy) + création/synchro de l'événement** | La création d'event évite la double saisie au commercial ; OAuth par commercial avec refresh token |
| Géocodage | Google Geocoding API à la saisie de la fiche | lat/lng stockées, nécessaires au calcul d'itinéraire |
| Règle de faisabilité RDV | `temps de trajet + marge ≤ temps disponible` ; marge **paramétrable par l'admin** (défaut 15 min) ; vérifie aussi le trajet vers le RDV suivant | |
| Point de départ | Dernier RDV du jour avant le créneau, sinon adresse de base du commercial (profil) | |

## Écrans v1

1. Login / reset password (invitation par email, pas d'inscription publique)
2. Tableau de bord (compteurs pipeline + RDV du jour)
3. Liste prospects (recherche, filtres statut/commercial/ville, tri, pagination)
4. Fiche prospect (infos, RDV liés, historique, changement de statut 1 clic, prise de RDV)
5. Mes RDV (commercial) — liste groupée par jour
6. Planning global par commercial (admin/telepro)
7. Équipe (admin) — invitations, rôles, activation
8. Paramètres (admin) — marge d'itinéraire
9. Profil — coordonnées, adresse de départ, connexion Google Agenda

## Hors scope v1

- Application mobile native (le site est responsive desktop/tablette)
- Email/SMS automatiques aux prospects
- Facturation / devis
- Import en masse de prospects (CSV) — candidat v1.1
