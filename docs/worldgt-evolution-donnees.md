# WorldGT — évolution des données sans réinitialisation

## État constaté le 20 septembre 2026

La production utilise déjà `events`, `results`, `registrations`, `drivers`, `acc_sessions`, `acc_session_results`, `acc_laps` et les fonctions Steam/Collector. Les événements WGT existants portent un code WGT dans leur titre ou nom de serveur et un `event_type` sprint/endurance ; la fonction `public-gtworld` ne les reconnaissait pas lorsqu'elle exigeait un titre commençant par SPRINT/ENDU. La migration de l'historique ou la suppression des tables existantes n'est pas nécessaire pour changer les menus.

Dans la base de production, aucune entrée n'est enregistrée dans `registrations` à la date de l'audit. La correspondance pilote → équipage → équipe n'est donc pas renseignée. **Le calcul actuel de WorldGT ne peut pas produire un classement d'équipages fiable.** Ne pas présenter ce mécanisme comme déjà opérationnel.

## Schéma complémentaire proposé (NON APPLIQUÉ)

1. `events.race_category` : catégorie explicite WGT/DR/OL pour les nouveaux événements. Renseigner l'historique **après validation** des anciennes dénominations ; pendant la transition conserver le classement par code serveur/titre.
2. `championship_seasons` : identifiant et saison WorldGT ; `championship_rounds` : association d'une course réelle (`events.id`) à sa saison et à son format Sprint ou Endurance. Deux courses Sprint de 60 minutes doivent produire deux manches scorées distinctement, y compris lorsqu'elles ont lieu la même soirée.
3. `championship_teams` : identifiant stable de l'équipe et nom affiché ; ne pas déduire l'identité d'une équipe du seul nom de profil d'un pilote.
4. `championship_entries` : identifiant stable de l'équipage engagé pour une course, `round_id`, `team_id`, identifiant d'inscription / numéro de voiture ACC, position, statut et bonus éventuel. Plusieurs équipages peuvent représenter la même équipe lors d'une manche.
5. `championship_entry_drivers` : association entre équipage et pilote effectivement participant ; contrainte d'unicité (manche, pilote) pour éviter d'attribuer deux fois la même manche au même pilote. Conserver l'historique si un pilote change d'équipage d'une manche à l'autre.
6. Vue/fonction de calcul : calculer **une fois** les points de l'équipage d'après le résultat officiel, attribuer ce montant à chaque pilote participant, puis agréger au niveau de l'équipe sans multiplier les points par le nombre de pilotes. Appliquer les pénalités/DSQ avant le classement définitif et le bonus meilleur tour selon le règlement.
7. Maintenir `acc_session_results` et `acc_laps` inchangés pour les meilleurs tours globaux FP/Q/R, même lorsque l'événement est classé WGT/DR/OL. Ne pas réécrire les tables d'authentification Steam, les rôles, les audits ou les imports ACC.

## Choix de règlement à confirmer avant migration et publication des points

- Lorsqu'une même équipe engage **plusieurs équipages** dans une manche, le classement de l'équipe additionne-t-il les points de **tous ses équipages**, ou ne retient-il que le meilleur résultat ?
- Le bonus de +2 pour le meilleur tour revient-il à l'équipage qui l'a réalisé, avec +2 pour chacun de ses pilotes participants, et une seule fois pour l'équipe ? Les égalités de meilleur tour et les pilotes inscrits mais non partants doivent aussi être définis.

## Plan de déploiement

Après validation des règles : créer une migration additive avec contraintes et index, backfiller les anciennes inscriptions **seulement après contrôle manuel des équipages réels**, adapter les fonctions d'administration, d'importation et les deux classements WorldGT, ajouter tests de non-régression et de sécurité RLS, puis déployer les fonctions Edge et le site ensemble. Conserver les anciens liens HTML (dont `gtworld.html`) et ne supprimer aucune donnée historique.
