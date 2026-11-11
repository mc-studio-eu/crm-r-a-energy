# Recette interface — 11 novembre 2026

Recette manuelle dans Chrome avec des données fictives et une copie temporaire de l’application. Les parcours complémentaires d’import et de finances utilisent des API simulées : les deux URL Supabase et la clé serveur pointaient vers un service local factice, les routes REST non prévues renvoyaient une erreur et un garde côté serveur refusait les `fetch` hors localhost. La feuille de style externe a été retirée de cette copie. Aucun appel Google n’a été lancé pendant ces parcours complémentaires.

- Société : ouverture de la liste et de la fiche, modification de la raison sociale avec actualisation du titre ; le formulaire de nouveau dossier préremplit la société sélectionnée.
- Rendez-vous : affichage d’un rendez-vous fictif, préremplissage de la date locale, de la durée et de l’étape, blocage d’une durée invalide. La sauvegarde complète n’a pas été validée.
- Import : sélection d’un fichier XLSX fictif, correspondance automatique des trois colonnes obligatoires, aperçu d’une ligne à 1 250 €, sélection puis confirmation et affichage de « 1 dossier importé ». Le serveur simulait les réponses de lecture, aperçu et confirmation : cela ne valide pas l’analyse réelle du classeur ni l’écriture en base.
- Finances administrateur : affichage d’une opération et de la synthèse mensuelle à 1 250 €. Dans un écran de test temporaire montant le composant financier du dossier, une modification de commission a reçu la réponse simulée « Commission enregistrée ». Le serveur de test ne persistait pas la modification.
- Finances personnelles : pour un profil commercial fictif, affichage d’une part de 250 €, de 50 € payés et de 200 € restants. La vue ne présentait ni commission fournisseur totale ni taux de répartition. Les données ont été fournies par une réponse simulée : cette observation ne valide pas les autorisations serveur ou RLS.

Ces vérifications ne remplacent pas les tests des API réelles, de la persistance ou de la synchronisation Google.
