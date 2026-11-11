# Dossiers, commissions et import — intégration novembre 2026

## Parcours livré

- **Une fiche unique** : un dossier représente une société. Raison sociale, SIRET, contacts, contrat et commissions se modifient depuis le dossier. Il n’existe plus de menu ni de formulaire société séparé. Les anciennes URL société redirigent vers le dossier correspondant.
- **Dossiers** : quatre statuts, énergie, fournisseur, source, intervenants et dates contractuelles. R1/R2 qualifie chaque rendez-vous, indépendamment du statut du dossier.
- **Finances** : le panneau du dossier permet de saisir la commission fournisseur HT, deux bénéficiaires maximum, leurs fonctions et pourcentages, les échéances et les paiements partiels. L’annuaire des bénéficiaires se trouve dans Finances. Un bénéficiaire peut exister sans compte ; l’admin peut lui rattacher un compte existant.
- **Commissions personnelles** : les comptes autorisés voient uniquement leurs propres parts sur les dossiers signés, leurs échéances et leurs paiements. Les apporteurs externes n’accèdent pas aux fiches opérationnelles, aux notes ni aux documents.
- **Import Excel** : depuis Dossiers → Importer Excel. Télécharger le modèle, sélectionner une feuille, associer les colonnes et vérifier les erreurs avant confirmation. Les doublons potentiels peuvent être exclus ou créés explicitement comme dossiers indépendants ; aucune fusion ni aucun rattachement à un dossier existant. XLSX de 2 Mio maximum, avec protection sur la taille décompressée. Les valeurs financières absentes restent inconnues ; aucune répartition ou écriture de paiement n’est créée automatiquement.
- **Google Agenda** : synchronisation CRM vers Google uniquement. L’état apparaît sur chaque rendez-vous ; « Réessayer » reprend un échec sans créer un deuxième événement. Reconnecter l’agenda dans Profil si nécessaire. Synchroniser l’annulation avant de replanifier un ancien événement.

## Règles financières

Les montants sont stockés en centimes et les taux en centièmes de pourcentage. La répartition utilise les plus forts restes pour garantir l’exactitude au centime, notamment sur une commission de 0,01 € partagée à 50/50. La part R&A est le solde de la commission brute après les parts attribuées.

Chaque paiement est rattaché à une échéance. Plusieurs échéances et paiements sont possibles par flux. On ne peut dépasser le montant d’une échéance ni la commission/part disponible. Avant de réduire une commission, corriger les échéances incompatibles ; les paiements déjà enregistrés ne sont jamais effacés implicitement. Les corrections et suppressions explicites sont journalisées dans `finance_audit`, inaccessible aux utilisateurs du navigateur.

Les tableaux mensuels distinguent signature, échéance prévue et paiement réel. Les soldes personnels restent calculés sur tous les dossiers signés, même si la signature date d’une autre année. Les dossiers signés incomplets sont signalés. Ces indicateurs servent au suivi commercial, sans calcul de TVA ni émission de virements.

## Mise en service

1. Sauvegarder la base et répéter la migration sur une copie de préproduction. Les migrations du 8 novembre pour fournisseur/téléprospecteur doivent précéder celles du 11 novembre.
2. Appliquer les fichiers dans l’ordre de leurs noms. Le fichier d’ajout des enums doit être validé dans une transaction séparée avant les migrations suivantes ; `supabase db push` conserve ce découpage.
3. Coordonner la mise à jour du serveur avec la migration `access_security` : les anciens serveurs utilisent `profiles.google_refresh_token`, déplacé dans `google_credentials`. Prévoir une fenêtre de maintenance, sans faire cohabiter l’ancien serveur et le nouveau schéma.
4. Vérifier les comptes admins et les rôles. Les rôles privilégiés ne sont plus lus dans les métadonnées utilisateur : l’API d’invitation les attribue après création. Le premier admin doit être établi par un opérateur de confiance directement en base.
5. Vérifier les totaux avant/après reprise : mêmes dossiers, documents et RDV ; aucune commission inventée. Créer/rattacher les bénéficiaires et compléter les dates manquantes.
6. Effectuer la recette réelle Google avec Tamim dans l’environnement choisi : connexion, création, déplacement, annulation et reconnexion. Aucun événement Google réel ni migration distante n’a été exécuté pendant l’implémentation.

Pour revenir en arrière, restaurer une sauvegarde cohérente avec la version du serveur. Ne pas supprimer les nouvelles tables si des écritures financières ont été saisies.

### Simplification dossier = société

La migration `20261111000007_dossier_unique.sql` conserve la table société comme détail interne pour les jointures financières, avec une relation un-à-un. Si plusieurs dossiers étaient liés à une même société, elle sépare leurs identités internes sans modifier leurs identifiants, leurs rendez-vous, leurs documents ni leurs finances. Elle autorise la modification de l’identité via le dossier selon ses droits existants et désactive les anciennes opérations de fusion/rattachement. Déployer cette migration avant la nouvelle interface.

### Règlements fournisseur

Dans chaque dossier, les administrateurs actifs peuvent consigner plusieurs versements convenus avec le fournisseur. Une ligne peut se limiter à un libellé (par exemple « 50 % au démarrage »). Elle peut aussi préciser une date ou une année, un montant HT, un pourcentage et une note. La date de réception fait passer le règlement de « Prévu » à « Reçu ».

Appliquer `20261111000009_reglements_fournisseur.sql` avant de déployer la section. Cet échéancier est indépendant du registre financier : ses lignes ne sont pas reprises dans les totaux ou tableaux de la page Finances.

## Vérification reproductible

```sh
npm ci
npm run lint
npm test
npm run build
```

Les tests de base utilisent PostgreSQL embarqué (PGlite) et exécutent toutes les migrations. Seuls les schémas Supabase `auth` et `storage` sont simulés. Ils vérifient RLS, droits de colonnes, reprise historique, calculs et transactions financières, confidentialité des tableaux et idempotence des imports. Les appels Google des tests unitaires sont simulés.

Les tests PGlite ne remplacent pas une recette concurrente multi-connexion sur Supabase : les RPC sérialisent les écritures financières par dossier et les confirmations d’import par lot. Vérifier ce comportement sur préproduction avant ouverture à plusieurs opérateurs.
