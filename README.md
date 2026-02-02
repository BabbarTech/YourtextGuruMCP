# YourTextGuru MCP Server

Serveur MCP (Model Context Protocol) pour l'API YourTextGuru. Permet d'utiliser les fonctionnalités SEO de YourTextGuru directement depuis Claude Desktop.

## Fonctionnalités

### Guides SEO
- `ytg_create_guide` - Créer un nouveau guide SEO
- `ytg_list_guides` - Lister tous les guides (pagination par curseur)
- `ytg_get_guide` - Récupérer les détails d'un guide (QBST, targets SOSEO/DSEO)
- `ytg_delete_guide` - Supprimer un guide

### Analyse de contenu
- `ytg_check_text` - Analyser un texte par rapport à un guide
- `ytg_check_url` - Extraire et analyser le contenu d'une URL

### SERP & Concurrence
- `ytg_get_serp` - Analyse SERP du guide
- `ytg_get_paa` - Questions "People Also Ask"
- `ytg_get_related` - Recherches associées

### Brief SEO
- `ytg_get_brief` - Récupérer le brief SEO
- `ytg_create_brief` - Générer un brief SEO
- `ytg_analyze_brief` - Analyser un texte par rapport au brief
- `ytg_analyze_url_brief` - Analyser une URL par rapport au brief
- `ytg_get_brief_analysis` - Récupérer les résultats d'analyse
- `ytg_list_brief_analyses` - Lister les analyses

### SEO TXL (Génération de contenu)
- `ytg_seotxl_auto` - Générer du contenu optimisé à partir d'un texte
- `ytg_seotxl_outline` - Générer un plan de contenu
- `ytg_seotxl_questions` - Générer 20 questions FAQ
- `ytg_seotxl_rephrase` - Reformuler du contenu

### Utilitaires
- `ytg_get_status` - Vérifier le statut de l'API

## Installation

```bash
git clone https://github.com/Babbar/YourtextGuruMCP.git
cd ytgmcp
npm install
npm run build
```

## Configuration

Ajoutez le serveur MCP à votre configuration Claude Desktop (`claude_desktop_config.json`) :

**Windows :**
```json
{
  "mcpServers": {
    "yourtextguru": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\ytgmcp\\dist\\index.js"],
      "env": {
        "YTG_API_KEY": "votre_cle_api"
      }
    }
  }
}
```

**macOS/Linux :**
```json
{
  "mcpServers": {
    "yourtextguru": {
      "command": "node",
      "args": ["/chemin/vers/ytgmcp/dist/index.js"],
      "env": {
        "YTG_API_KEY": "votre_cle_api"
      }
    }
  }
}
```

## Utilisation

Une fois configuré, les outils YourTextGuru sont disponibles dans Claude Desktop.

### Exemple : Créer et utiliser un guide

1. **Créer un guide :**
```
Crée un guide SEO pour "recette de crêpes" en français (fr_FR)
```

2. **Lister les guides :**
```
Liste mes guides YourTextGuru
```

3. **Analyser un texte :**
```
Analyse ce texte par rapport au guide 12345 : [votre texte]
```

4. **Analyser une URL :**
```
Analyse la page https://example.com/article par rapport au guide 12345
```

5. **Générer du contenu :**
```
Génère un plan de contenu pour le guide 12345
```

## Scores SOSEO et DSEO

- **SOSEO** (Score d'Optimisation SEO) : Indique le niveau d'optimisation du contenu. Doit être dans l'intervalle cible (min-max).
- **DSEO** (Score de Danger SEO) : Indique le risque de sur-optimisation. Ne doit pas dépasser le max.

### Zones d'optimisation des termes

| Zone | Emoji | Description |
|------|-------|-------------|
| Rouge | 🔴 | Sur-optimisation forte |
| Orange | 🟠 | Sur-optimisation légère |
| Verte | 🟢 | Optimisation normale (idéal) |
| Bleue | 🔵 | Sous-optimisation |

## Prérequis

- Node.js >= 18.0.0
- Clé API YourTextGuru ([obtenir une clé](https://yourtext.guru/))
- (Optionnel) Clé API OpenAI configurée dans YourTextGuru pour les fonctionnalités SEO TXL

## Scripts disponibles

```bash
npm run build    # Compile TypeScript vers JavaScript
npm run dev      # Exécute en mode développement
npm start        # Exécute le serveur compilé
```

## Licence

MIT - Voir le fichier [LICENSE](LICENSE) pour plus de détails.
