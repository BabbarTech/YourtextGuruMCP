# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [1.0.0] - 2024-01-29

### Ajouté
- Gestion complète des guides SEO
  - Création de guides (`ytg_create_guide`)
  - Liste des guides avec pagination par curseur (`ytg_list_guides`)
  - Récupération des détails d'un guide avec QBST (`ytg_get_guide`)
  - Suppression de guides (`ytg_delete_guide`)
- Analyse de contenu
  - Analyse de texte (`ytg_check_text`)
  - Extraction et analyse d'URL (`ytg_check_url`)
- Données SERP et concurrence
  - Analyse SERP (`ytg_get_serp`)
  - Questions PAA (`ytg_get_paa`)
  - Recherches associées (`ytg_get_related`)
- Brief SEO
  - Récupération du brief (`ytg_get_brief`)
  - Génération du brief (`ytg_create_brief`)
  - Analyse de texte par rapport au brief (`ytg_analyze_brief`)
  - Analyse d'URL par rapport au brief (`ytg_analyze_url_brief`)
  - Récupération des résultats d'analyse (`ytg_get_brief_analysis`)
  - Liste des analyses (`ytg_list_brief_analyses`)
- SEO TXL (génération de contenu IA)
  - Génération de contenu optimisé (`ytg_seotxl_auto`)
  - Génération de plan de contenu (`ytg_seotxl_outline`)
  - Génération de questions FAQ (`ytg_seotxl_questions`)
  - Reformulation de contenu (`ytg_seotxl_rephrase`)
- Utilitaires
  - Vérification du statut de l'API (`ytg_get_status`)
- Cache des requêtes API (TTL: 1 heure)
- Gestion du rate limiting avec retry automatique
- Logging structuré avec Pino
