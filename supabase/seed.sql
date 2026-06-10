-- Seed de données de test (ticket 03)
-- Les comptes auth sont créés via l'API admin (supabase auth admin) ou le
-- script `npm run seed:users` côté projet — ici on seed les données métier
-- en supposant 3 users de test déjà créés avec ces UUID fixes.

-- Prospects de démo
insert into public.prospects
  (id, raison_sociale, siret, contact_nom, telephone, email, adresse, code_postal, ville, lat, lng, statut, source)
values
  ('11111111-1111-1111-1111-111111111101', 'Boulangerie Martin', '12345678900011', 'Paul Martin', '0612345678', 'contact@boulangerie-martin.fr', '12 rue de la République', '69002', 'Lyon', 45.7578, 4.8351, 'nouveau', 'Salon'),
  ('11111111-1111-1111-1111-111111111102', 'Garage Dupont', '2345678900012', 'Marie Dupont', '0623456789', 'garage.dupont@gmail.com', '45 avenue Berthelot', '69007', 'Lyon', 45.7402, 4.8417, 'a_rappeler', 'Téléprospection'),
  ('11111111-1111-1111-1111-111111111103', 'Restaurant Le Gourmet', '3456789000013', 'Jean Petit', '0634567890', 'legourmet@orange.fr', '8 place Bellecour', '69002', 'Lyon', 45.7575, 4.8320, 'rdv_place', 'Recommandation'),
  ('11111111-1111-1111-1111-111111111104', 'Pharmacie Centrale', '4567890100014', 'Sophie Blanc', '0645678901', 'pharma.centrale@free.fr', '3 cours Lafayette', '69003', 'Lyon', 45.7630, 4.8480, 'signe', 'Site web'),
  ('11111111-1111-1111-1111-111111111105', 'Imprimerie Moderne', '5678901200015', 'Luc Moreau', '0656789012', 'contact@imprimerie-moderne.fr', '22 rue Garibaldi', '69006', 'Lyon', 45.7685, 4.8520, 'perdu', 'Téléprospection');
