-- =============================================================
-- Nouveaux rôles : régie interne / régie externe.
-- Les policies qui référencent ces valeurs sont dans la migration
-- suivante : un literal d'enum n'est utilisable qu'après commit de
-- la transaction qui l'ajoute (chaque fichier de migration est
-- exécuté dans sa propre transaction).
-- =============================================================

alter type user_role add value if not exists 'regie_interne';
alter type user_role add value if not exists 'regie_externe';
