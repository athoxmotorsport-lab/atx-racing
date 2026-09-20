# ATX Racing — publication SEO (20 septembre 2026)

## Livraison

Le site HTML/CSS/JavaScript existant est conservé, ainsi que l'authentification Steam, Supabase, le Collector ACC, les classements, les archives et les notifications. Cette publication ne déploie aucune nouvelle migration ni aucun secret Supabase.

### Changements apportés
- Photo du profil pilote agrandie à 128 × 128 px, sans déformer l'image ; taille légèrement réduite sur les écrans très étroits. Avatar du header inchangé.
- Balises Open Graph et Twitter complétées sur les principales pages publiques, avec titres et descriptions propres à chaque page et image partagée ATX Racing.
- `sitemap.xml` actualisé pour les pages publiques effectivement modifiées. `robots.txt` conservé : il pointe déjà vers le sitemap.
- Les pages historiques Monza (9 septembre 2026) et Nürburgring GP (11 septembre 2026) indiquent `EventCompleted` dans leurs données structurées, sans les réinjecter dans le calendrier.
- `course.html?event=...` reste accessible aux visiteurs mais sa page HTML générique n'est plus proposée comme page canonique indexable. Les archives statiques et la page Archives restent indexables.
- Connexion anticipée à l'API Supabase sur les pages qui en dépendent, sans exposer de clé.
- Rafraîchissement de la version CSS pour faire apparaître la nouvelle taille du profil sans avoir à vider manuellement le cache.

### Ce qui reste volontairement inchangé
- Les données de résultats, leurs classements et les filtres calendrier/archives.
- Les notifications en cloche et les rappels de course.
- Les URLs publiques et les règles d'accès du site.
- Les photos hébergées dans Supabase ou Steam : seul leur **affichage** change.

## Publication

Le dépôt GitHub est la source du site GitHub Pages. Les modifications étant déjà enregistrées sur la branche `main`, il n'est **pas nécessaire** de réimporter un ZIP dans ce même dépôt. Utilisez son archive GitHub pour une sauvegarde complète de la version.

- Accueil : https://athoxmotorsport-lab.github.io/atx-racing/
- Sitemap : https://athoxmotorsport-lab.github.io/atx-racing/sitemap.xml
- Fichier robots : https://athoxmotorsport-lab.github.io/atx-racing/robots.txt
- Télécharger le dépôt complet : https://github.com/athoxmotorsport-lab/atx-racing/archive/refs/heads/main.zip

Le ZIP complet du dépôt contient également le code source et les migrations Supabase ; pour transférer **uniquement le site statique** chez un autre hébergeur, ne publiez pas le répertoire `supabase/` et ne publiez jamais un fichier `.env` ou un webhook Discord.

## Validation après publication

1. Ouvrez l'accueil, le calendrier, les archives, les classements et le profil sur ordinateur et mobile.
2. Vérifiez que la cloche et la connexion Steam continuent de fonctionner ; vérifiez la photo à 128 px sur la page profil.
3. Vérifiez que les courses terminées n'apparaissent pas au calendrier, mais restent accessibles dans les archives.
4. Dans Google Search Console, ajoutez ou contrôlez le sitemap `https://athoxmotorsport-lab.github.io/atx-racing/sitemap.xml` et inspectez l'URL d'accueil.
5. Utilisez le test des résultats enrichis de Google sur les pages statiques d'événement si vous souhaitez confirmer leur balisage de course.

### Limite connue

Les détails de toutes les courses créées dynamiquement via `course.html?event=...` ne disposent pas encore de pages HTML pré-générées uniques. Pour les rendre **individuellement indexables et partageables avec leurs propres aperçus**, il faudra produire une page statique par course avec ses propres titre, description, URL canonique et données structurées lors de sa publication. Cette amélioration exige un générateur côté serveur ou une étape de publication et ne se résout pas correctement par une simple balise ajoutée dans le navigateur.

L'apparition sur Google et le positionnement ne sont pas garantis : ils dépendent ensuite de l'exploration et de l'indexation par les moteurs de recherche.
