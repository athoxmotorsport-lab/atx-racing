# WorldGT — règle de classement confirmée

L'unité du classement WorldGT est **l'équipe engagée dans la course**, c'est-à-dire l'équipage, et non une écurie mère regroupant plusieurs équipes. Une équipe telle que « ATX Motorsport Team 1 », composée de Dylan et Tim, finit première : Team 1 marque 50 points, Dylan marque 50 points et Tim marque 50 points. Une équipe différente classée troisième marque 30 points, et chacun de ses pilotes participants marque 30 points. Il n'y a **aucune addition entre Team 1, Team 2, Team X, etc.** Chaque équipe conserve sa propre ligne dans le classement général ; au fil des manches, son total reflète les points des résultats de **cette même équipe**.

Le bonus de +2 pour le meilleur tour bénéficie à l'équipe qui le réalise et **à chacun de ses pilotes participants**, sans attribuer le bonus uniquement au pilote auteur du tour. Chaque pilote reçoit les mêmes points de résultat et de bonus que son équipage sur la manche disputée. Si la composition d'une équipe change entre deux manches, créditer uniquement les pilotes qui ont participé à la manche concernée.

## État technique et conservation des données

La base existante contient `events`, `results`, `registrations`, `drivers`, `acc_sessions`, `acc_session_results` et `acc_laps` ; ces tables et les données Steam/Collector doivent être conservées. À l'audit du 20 septembre 2026, `registrations` ne contenait aucune correspondance pilote-équipe : le site **ne peut donc pas encore calculer correctement** les points WorldGT à partir des équipages sans renseigner ces correspondances.

Pour chaque manche, identifier l'équipe engagée (nom/identifiant d'équipe de course, numéro de voiture et pilotes réellement participants), récupérer sa position officielle et son meilleur tour, établir **un seul** résultat de manche par équipe, puis attribuer le même montant de points (position et bonus) à chaque pilote de cette équipe. Le classement général WorldGT affiche les équipes engagées individuellement ; le classement des pilotes affiche les sommes de leurs propres résultats par manche. Ne jamais calculer les points de l'équipe en totalisant les points de ses deux pilotes et ne pas regrouper plusieurs équipes sous une écurie mère.

Les deux courses Sprint d'une soirée sont deux manches scorées distinctement. Les meilleurs temps de référence continuent à intégrer les sessions FP/Q/R sans changement de leurs données ni de leur affichage.

## Déploiement

La règle ci-dessus remplace intégralement les anciennes hypothèses de regroupement d'équipes et les anciennes questions de bonus. Avant la mise en production, adapter et tester la correspondance équipe-pilotes et les deux endpoints de classement, conserver l'historique et les autorisations, puis déployer les fonctions et le site de concert. Aucune migration destructive et aucune modification de production ne découlent de ce document.
