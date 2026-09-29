# Bearing — démo founders avec suivi d'usage

Site statique : `index.html` (la démo, inchangée à une ligne près : l'inclusion de `track.js`)
et `track.js` (suivi d'usage envoyé à Supabase, projet `bearing-demo`).

## Déployer sur Vercel

1. vercel.com → **Add New… → Project** → importer ce repo.
2. Framework preset : **Other**. Pas de build command, output directory : `./`.
3. Deploy. Aucune variable d'environnement n'est nécessaire : la clé Supabase utilisée est la clé
   *publishable*, prévue pour être publique. Elle permet seulement d'**insérer** des événements :
   personne ne peut lire les données depuis le navigateur.

## Envoyer un lien personnalisé à chaque founder

```
https://<ton-site>.vercel.app/?f=jean-acme
https://<ton-site>.vercel.app/?f=marie-fooai
```

Le tag `f` est mémorisé dans le navigateur, donc une deuxième visite sans le paramètre reste
attribuée au même founder. Les paramètres `utm_source`, `utm_medium` et `utm_campaign` sont aussi
enregistrés.

## Ce qui est mesuré

| Événement | Ce qu'il te dit |
|---|---|
| `session_start` | appareil, taille d'écran, langue, fuseau horaire, referrer, n° de visite (retour ?) |
| `page_view` | landing ou dashboard |
| `time` (`kind` = page / section / modal / tour_step) | temps **actif** : onglet visible et interaction depuis moins de 60 s |
| `scroll_depth` | 25 / 50 / 75 / 100 % sur la landing et sur le dashboard |
| `click` | chaque bouton ou lien, avec son libellé et la zone de la page |
| `dead_click` | clic sur un élément non cliquable (KPI, graphique) : curiosité ou confusion |
| `rage_click` | 3 clics rapides sur le même élément : frustration |
| `disabled_click` | clic sur « Add my data » avant d'avoir coché le consentement |
| `modal_open` / `modal_close` | formulaire d'accès (avec le CTA d'origine : hero, nav, bas de page) |
| `field_focus` / `field_change` / `form_invalid` / `form_abandon` | friction dans le formulaire |
| `form_submit` | email, société, rôle, date de la dernière levée |
| `tour_step` / `tour_complete` / `tour_skip` / `tour_restart` | progression dans le tour guidé |
| `consent_toggle` / `add_data_click` | signaux d'intention les plus forts |
| `copy_text` | texte copié par le visiteur |
| `idle`, `tab_hidden`, `tab_visible`, `page_leave`, `page_reload` | engagement réel |

## Dashboard d'analyse (équipe uniquement)

`https://<ton-site>.vercel.app/insights#k=<clé>` : vue d'ensemble, insights automatiques, entonnoir,
temps par section et étape du tour, clics et frictions, formulaire, audience, puis le **parcours
détaillé de chaque founder, session par session** (chronologie, temps par zone).

- La clé n'est **jamais** dans le code. Supabase n'en stocke que le hash SHA-256
  (`private.insights_keys`), et la fonction `public.insights_events(p_key)` refuse tout appel sans
  la bonne clé. Elle est placée après `#`, donc elle n'est envoyée ni à Vercel ni dans les referrers.
- Page en `noindex` et sans cache (`vercel.json`).
- Changer de clé : `update private.insights_keys set key_hash = encode(extensions.digest('<nouvelle clé>', 'sha256'), 'hex');`
- Les robots (capture d'écran Vercel, navigateurs headless) sont ignorés par le tracker et exclus
  des analyses. Les tags commençant par `test`, `qa` ou `dev` sont masqués par défaut
  (case « Inclure les tests »).

## Lire les résultats (Supabase → SQL Editor)

Les vues du schéma `analytics` ne sont pas exposées à l'API publique.

```sql
-- Un founder par ligne, trié par intérêt (score heuristique de 0 à 9)
select * from analytics.founders order by interest_score desc, active_seconds desc;

-- Entonnoir global
select * from analytics.funnel order by step;

-- Temps moyen par page / section / étape du tour / modale
select * from analytics.time_by_area;

-- Boutons et éléments les plus cliqués
select * from analytics.clicks;

-- Parcours complet d'un founder, dans l'ordre
select * from analytics.journey where founder_tag = 'jean-acme';

-- Détail par session (onglet)
select * from analytics.sessions order by first_seen desc;
```

Calcul du score d'intérêt : formulaire envoyé +2, consentement coché +2, « Add my data » +2,
tour terminé +1, action de l'assistant cliquée +1, visite de retour +1, plus de 3 minutes
actives +1.
