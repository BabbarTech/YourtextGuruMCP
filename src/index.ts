import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance, AxiosError } from "axios";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";
import { pino } from "pino";

// Initialize logger (stderr only for STDIO transport)
const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  pino.destination({ dest: 2 }) // 2 = stderr
);

// =====================
// Utility Functions
// =====================

function asMcpContent(value: any) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text: text,
      },
    ],
  };
}

// Extract text from HTML page
async function extractTextFromUrl(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    const $ = cheerio.load(response.data);

    // Remove unwanted elements
    $("script, style, nav, header, footer, aside, noscript, iframe, form, button, meta, link, svg, img").remove();
    $("[class*='nav'], [class*='menu'], [class*='sidebar'], [class*='footer'], [class*='header'], [class*='comment'], [class*='ad-'], [class*='social'], [class*='cookie'], [class*='popup']").remove();

    // Try to find main content
    let mainContent = $("article, main, [role='main'], .content, .post-content, .entry-content, .article-content, #content").first();
    if (!mainContent.length) {
      mainContent = $("body");
    }

    // Extract and clean text
    let text = mainContent.text();
    text = text.replace(/\s+/g, " ").trim();

    logger.info(`Extracted ${text.length} characters from ${url}`);
    return text;
  } catch (error: any) {
    logger.error(`Failed to extract text from ${url}: ${error.message}`);
    throw new Error(`Failed to extract text from URL: ${error.message}`);
  }
}

// Determine optimization zone for a term
function getOptimizationZone(
  score: number,
  areas: {
    subOptimization?: [number, number];
    standardOptimization?: [number, number];
    strongOptimization?: [number, number];
    overOptimization?: [number, number];
  }
): { zone: string; emoji: string; description: string } {
  const sub = areas.subOptimization || [0, 0];
  const std = areas.standardOptimization || [0, 0];
  const strong = areas.strongOptimization || [0, 0];
  const over = areas.overOptimization || [0, 0];

  if (score < sub[0]) {
    return { zone: "absent", emoji: "⚪", description: "Terme absent ou très rare" };
  } else if (score <= sub[1]) {
    return { zone: "subOptimization", emoji: "🔵", description: "Sous-optimisé - à renforcer" };
  } else if (score <= std[1]) {
    return { zone: "standardOptimization", emoji: "🟢", description: "Optimisation normale - parfait" };
  } else if (score <= strong[1]) {
    return { zone: "strongOptimization", emoji: "🟠", description: "Sur-optimisation légère" };
  } else {
    return { zone: "overOptimization", emoji: "🔴", description: "Sur-optimisation forte" };
  }
}

// Format check results for better readability
function formatCheckResults(data: any): any {
  const soseo = data.SOSEO || 0;
  const dseo = data.DSEO || 0;
  const targetSoseoMin = data.target_soseo_min || data.target_SOSEO_min || 0;
  const targetSoseoMax = data.target_soseo_max || data.target_SOSEO_max || 100;
  const targetDseoMin = data.target_dseo_min || data.target_DSEO_min || 0;
  const targetDseoMax = data.target_dseo_max || data.target_DSEO_max || 100;

  const soseoStatus = soseo >= targetSoseoMin && soseo <= targetSoseoMax ? "✅ OK" : "⚠️ Hors cible";
  const dseoStatus = dseo <= targetDseoMax ? "✅ OK" : "🔴 Danger";

  const areas = data.areas || {};
  const scores = data.scores || {};

  // Categorize terms by zone
  const termsByZone: Record<string, Array<{ term: string; score: number; description: string }>> = {
    overOptimization: [],
    strongOptimization: [],
    standardOptimization: [],
    subOptimization: [],
    absent: []
  };

  for (const [term, score] of Object.entries(scores)) {
    const termAreas = {
      subOptimization: areas.subOptimization?.[term] as [number, number] | undefined,
      standardOptimization: areas.standardOptimization?.[term] as [number, number] | undefined,
      strongOptimization: areas.strongOptimization?.[term] as [number, number] | undefined,
      overOptimization: areas.overOptimization?.[term] as [number, number] | undefined,
    };
    const zoneInfo = getOptimizationZone(score as number, termAreas);
    termsByZone[zoneInfo.zone].push({
      term,
      score: score as number,
      description: zoneInfo.description
    });
  }

  return {
    summary: {
      SOSEO: {
        value: soseo,
        target: `${targetSoseoMin}-${targetSoseoMax}`,
        status: soseoStatus,
        interpretation: soseo < targetSoseoMin 
          ? "Contenu sous-optimisé - ajoutez plus de termes QBST"
          : soseo > targetSoseoMax 
            ? "Contenu sur-optimisé - réduisez certains termes"
            : "Contenu dans la plage optimale"
      },
      DSEO: {
        value: dseo,
        target: `0-${targetDseoMax}`,
        status: dseoStatus,
        interpretation: dseo > targetDseoMax
          ? "ATTENTION: Risque de sur-optimisation détecté!"
          : "Niveau de risque acceptable"
      }
    },
    termsByZone: {
      overOptimization: {
        emoji: "🔴",
        label: "Sur-optimisation forte (Zone rouge)",
        action: "À réduire si SOSEO > max",
        terms: termsByZone.overOptimization.slice(0, 15)
      },
      strongOptimization: {
        emoji: "🟠",
        label: "Sur-optimisation légère (Zone orange)",
        action: "À surveiller si SOSEO > max",
        terms: termsByZone.strongOptimization.slice(0, 15)
      },
      standardOptimization: {
        emoji: "🟢",
        label: "Optimisation normale (Zone verte)",
        action: "Parfait - maintenir",
        terms: termsByZone.standardOptimization.slice(0, 20)
      },
      subOptimization: {
        emoji: "🔵",
        label: "Sous-optimisation (Zone bleue)",
        action: "À renforcer",
        terms: termsByZone.subOptimization.slice(0, 20)
      }
    },
    rawData: data
  };
}

// =====================
// API Configuration
// =====================

const API_BASE_URL = "https://yourtext.guru/api/v2";
const API_KEY = process.env.YTG_API_KEY;

if (!API_KEY) {
  logger.error("YTG_API_KEY environment variable is required");
  process.exit(1);
}

// Cache configuration (1 hour = 3600 seconds)
const cache = new NodeCache({ stdTTL: 3600 });

// Rate limiting state
let rateLimitRemaining: number | null = null;

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
});

// Response interceptor for rate limit handling
apiClient.interceptors.response.use(
  (response) => {
    if (response.headers["x-ratelimit-remaining"]) {
      rateLimitRemaining = parseInt(response.headers["x-ratelimit-remaining"]);
    }
    return response;
  },
  async (error: AxiosError) => {
    if (error.response?.status === 429) {
      logger.warn("Rate limit exceeded, waiting 60 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return apiClient.request(error.config!);
    }
    return Promise.reject(error);
  }
);

// Helper function to make API calls
async function makeApiCall(
  endpoint: string,
  method: string,
  data?: any,
  params?: any,
  useCache: boolean = true
): Promise<any> {
  const cacheKey = `${method}:${endpoint}:${JSON.stringify(data || {})}:${JSON.stringify(params || {})}`;

  if (useCache) {
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for ${cacheKey}`);
      return cachedData;
    }
  }

  try {
    logger.info(`API call: ${method} ${endpoint}`);
    const response = await apiClient.request({
      method,
      url: endpoint,
      data,
      params,
    });

    const result = {
      endpoint,
      timestamp: new Date().toISOString(),
      rateLimitRemaining,
      data: response.data,
    };

    if (useCache) {
      cache.set(cacheKey, result);
    }

    logger.info({
      endpoint,
      method,
      rateLimitRemaining,
      timestamp: new Date().toISOString(),
    });

    return result;
  } catch (error: any) {
    logger.error(`API call failed: ${error.message}`);

    if (error.response?.status === 401) {
      throw new Error("Invalid API key. Please check your YTG_API_KEY environment variable.");
    } else if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded. Please wait and try again.");
    } else if (error.response?.status === 400) {
      throw new Error(`Bad request: ${error.response?.data?.message || error.message}`);
    } else if (error.response?.status === 404) {
      throw new Error(`Endpoint not found: ${endpoint}`);
    } else {
      throw new Error(
        `API error (${error.response?.status || "unknown"}): ${error.message}`
      );
    }
  }
}

// =====================
// Tools Definitions
// =====================

const tools = [
  // --------------------
  // GUIDES
  // --------------------
  {
    name: "ytg_create_guide",
    description: `Crée un nouveau guide SEO YourTextGuru pour une requête donnée.
Le guide contient les termes saillants QBST (Query Based Salient Terms) nécessaires pour afficher un contenu sur les résultats d'un moteur de recherche.
La génération prend quelques minutes. Utilisez ytg_get_guide pour récupérer le guide une fois prêt.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Le mot-clé ou la requête cible pour le guide SEO (obligatoire)" },
        lang: {
          type: "string",
          description: "Code langue au format locale - OBLIGATOIRE (ex: fr_FR, en_US, en_GB, de_DE, es_ES, it_IT, pt_BR)"
        },
        type: {
          type: "string",
          enum: ["google", "bing"],
          description: "Type de moteur de recherche",
          default: "google"
        },
      },
      required: ["query", "lang"],
    },
  },
  {
    name: "ytg_list_guides",
    description: "Liste tous les guides SEO disponibles dans le compte YourTextGuru. Utilise une pagination par curseur (lastId).",
    inputSchema: {
      type: "object",
      properties: {
        lastId: {
          type: "number",
          description: "ID du dernier guide reçu pour obtenir les suivants (pagination par curseur). 0 ou omis pour commencer.",
          default: 0
        },
        status: {
          type: "string",
          enum: ["in_progress", "waiting", "ready", "error"],
          description: "Filtrer par statut du guide"
        },
        lang: {
          type: "string",
          description: "Filtrer par code langue (ex: fr_FR, en_US)"
        },
        apiOnly: {
          type: "number",
          enum: [0, 1],
          description: "1 = afficher uniquement les guides créés via API"
        },
        projectId: {
          type: "number",
          description: "Filtrer par ID de projet"
        },
        groupId: {
          type: "number",
          description: "Filtrer par ID de groupe"
        },
      },
      required: [],
    },
  },
  {
    name: "ytg_get_guide",
    description: `Récupère les détails complets d'un guide SEO incluant les QBST (Query Based Salient Terms).

Les QBST sont les termes essentiels pour ranquer sur une requête:
- 1grams: Mots simples importants
- 2grams: Expressions de 2 mots pour contexte (à utiliser dans une même phrase ou un même paragraphe)
- 3grams: Expressions de 3 mots pour contexte (à utiliser dans une même phrase ou un même paragraphe)
- entities: Entités nommées (personnes, lieux, marques...)

Le guide inclut aussi les targets minimales et maximales des scores SOSEO (Score d'optimisation) DSEO (score de danger) recommandés.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant unique du guide" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_delete_guide",
    description: "Supprime un guide SEO.",
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant unique du guide à supprimer" },
      },
      required: ["guideId"],
    },
  },

  // --------------------
  // ANALYSE DE CONTENU
  // --------------------
  {
    name: "ytg_check_text",
    description: `Analyse un texte par rapport à un guide SEO pour évaluer son niveau d'optimisation.

Retourne les scores SOSEO (optimisation) et DSEO (sur-optimisation), ainsi que l'analyse détaillée de chaque terme QBST avec sa zone d'optimisation:
- Zone bleue (subOptimization): Terme sous-utilisé
- Zone verte (standardOptimization): Niveau optimal d'optimisation
- Zone orange (strongOptimization): Sur-optimisation légère (acceptable dans une certaine mesure)
- Zone rouge (overOptimization): Sur-optimisation forte (augmente le DSEO, à surveiller)`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO à utiliser" },
        text: { type: "string", description: "Le texte à analyser (contenu de l'article, page web, etc.)" },
      },
      required: ["guideId", "text"],
    },
  },
  {
    name: "ytg_check_url",
    description: `Extrait le contenu d'une URL et l'analyse par rapport à un guide SEO.

Cette fonction récupère automatiquement le texte de la page web et effectue l'analyse SOSEO/DSEO comme ytg_check_text.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO à utiliser" },
        url: { type: "string", description: "L'URL de la page à analyser" },
      },
      required: ["guideId", "url"],
    },
  },

  // --------------------
  // SERP & CONCURRENCE
  // --------------------
  {
    name: "ytg_get_serp",
    description: `Récupère l'analyse SERP (Search Engine Results Page) pour un guide.

Montre les positions des concurrents, leurs URLs, et leurs scores SOSEO/DSEO pour comprendre le niveau d'optimisation nécessaire pour ranquer.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_get_paa",
    description: `Récupère les questions "People Also Ask" (Autres questions posées) pour un guide.

Ces questions sont celles que Google affiche dans les résultats de recherche. Les traiter dans votre contenu peut améliorer votre visibilité.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_get_related",
    description: `Récupère les recherches associées pour un guide.

Ces recherches sont suggérées par Google en bas de page de résultats. Elles peuvent inspirer du contenu complémentaire ou des variations de mots-clés.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },

  // --------------------
  // BRIEF SEO
  // --------------------
  {
    name: "ytg_get_brief",
    description: `Récupère le brief SEO d'un guide.

Le brief SEO est une analyse thématique générée par IA qui identifie les sujets et objectifs que votre contenu devrait traiter pour être complet et pertinent.

Note: Nécessite une clé API OpenAI configurée dans votre compte YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_create_brief",
    description: `Génère le brief SEO pour un guide.

Le brief est généré par IA (OpenAI) et identifie les sujets et objectifs que votre contenu devrait traiter.

Note: Nécessite une clé API OpenAI configurée dans votre compte YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_analyze_brief",
    description: `Analyse un texte par rapport au brief SEO pour vérifier la couverture des objectifs.

L'analyse vérifie si votre contenu traite les sujets et objectifs identifiés dans le brief SEO. Chaque objectif sera marqué comme:
- DONE: Objectif traité de manière satisfaisante
- NEED_MORE: Objectif partiellement traité, à développer
- MISSING: Objectif non traité

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
        text: { type: "string", description: "Le texte à analyser" },
      },
      required: ["guideId", "text"],
    },
  },
  {
    name: "ytg_analyze_url_brief",
    description: `Extrait le contenu d'une URL et l'analyse par rapport au brief SEO.

Combine l'extraction de texte et l'analyse du brief en une seule opération.

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
        url: { type: "string", description: "L'URL de la page à analyser" },
      },
      required: ["guideId", "url"],
    },
  },
  {
    name: "ytg_get_brief_analysis",
    description: `Récupère le résultat d'une analyse de brief SEO.

Montre le statut de chaque objectif du brief:
- DONE: ✅ Objectif traité
- NEED_MORE: ⚠️ À développer
- MISSING: ❌ Non traité`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
        analyzeId: { type: "number", description: "L'identifiant de l'analyse (retourné par ytg_analyze_brief)" },
      },
      required: ["guideId", "analyzeId"],
    },
  },
  {
    name: "ytg_list_brief_analyses",
    description: "Liste toutes les analyses de brief effectuées pour un guide.",
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },

  // --------------------
  // SEO TXL (Génération de contenu)
  // --------------------
  {
    name: "ytg_seotxl_auto",
    description: `Génère du contenu optimisé à partir de textes fournis.

SEO TXL Auto prend un texte en entrée et le transforme en contenu optimisé pour le guide SEO spécifié.

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
        text: { type: "string", description: "Le texte source à optimiser" },
      },
      required: ["guideId", "text"],
    },
  },
  {
    name: "ytg_seotxl_outline",
    description: `Génère un plan de création de contenu basé sur le guide SEO.

SEO TXL Outline crée une structure de contenu (titres, sous-titres, sections) optimisée pour les termes QBST du guide.

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_seotxl_questions",
    description: `Génère 20 questions de style FAQ basées sur le guide SEO.

SEO TXL Questions produit des questions pertinentes pour créer une section FAQ optimisée.

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
      },
      required: ["guideId"],
    },
  },
  {
    name: "ytg_seotxl_rephrase",
    description: `Reformule le contenu fourni en l'optimisant pour le guide SEO.

SEO TXL Rephrase prend un texte existant et le reformule en intégrant les termes QBST du guide.

Note: Nécessite une clé API OpenAI configurée dans YourTextGuru.`,
    inputSchema: {
      type: "object",
      properties: {
        guideId: { type: "number", description: "L'identifiant du guide SEO" },
        text: { type: "string", description: "Le texte à reformuler" },
      },
      required: ["guideId", "text"],
    },
  },

  // --------------------
  // STATUS
  // --------------------
  {
    name: "ytg_get_status",
    description: "Vérifie le statut de l'API YourTextGuru et du compte.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// =====================
// MCP Resource: YourTextGuru Metrics Dictionary
// =====================

const YTG_METRICS_URI = "instructions://yourtextguru-metrics";
const YTG_METRICS_NAME = "YourTextGuru — Dictionnaire des métriques SEO";
const YTG_METRICS_DESCRIPTION = "Définitions officielles des métriques YourTextGuru (QBST, SOSEO, DSEO, zones d'optimisation).";

const YTG_METRICS_MD = `# YourTextGuru — Dictionnaire des métriques SEO

Ce document décrit les métriques et concepts utilisés par YourTextGuru pour l'analyse et l'optimisation SEO de contenus.

## QBST (Query Based Salient Terms)

Les **QBST** (Query Based Salient Terms) sont les termes saillants basés sur la requête. Ce sont les mots-clés et expressions **essentiels pour ranquer** sur une requête donnée dans les moteurs de recherche.

### Types de QBST

| Type | Description | Exemple |
|------|-------------|---------|
| **1grams** | Mots simples importants | "voiture", "électrique", "prix" |
| **2grams** | Expressions de 2 mots | "voiture électrique", "meilleur prix" |
| **3grams** | Expressions de 3 mots | "acheter voiture électrique", "comparatif prix voiture" |
| **entities** | Entités nommées (personnes, lieux, marques) | "Tesla", "Paris", "Elon Musk" |

> **Important**: Les termes présents dans le top des QBST sont **indispensables** pour ranquer. Ils doivent être présents dans votre contenu de manière naturelle.

## Scores d'optimisation

### SOSEO (Score Optimization SEO)

Le **SOSEO** mesure le niveau d'optimisation global de votre contenu par rapport aux termes QBST du guide.

| Plage | Interprétation |
|-------|----------------|
| < target_soseo_min | **Sous-optimisé** - Le contenu manque de termes QBST importants |
| target_soseo_min - target_soseo_max | **Optimal** - Le contenu est bien optimisé |
| > target_soseo_max | **Sur-optimisé** - Trop de répétitions, risque de pénalité |

> **Objectif**: Maintenir le SOSEO dans l'intervalle [target_soseo_min, target_soseo_max] recommandé par le guide.

### DSEO (Danger SEO)

Le **DSEO** mesure le risque de sur-optimisation (bourrage de mots-clés).

| Plage | Interprétation |
|-------|----------------|
| 0 - target_dseo_max | **Acceptable** - Pas de risque de pénalité |
| > target_dseo_max | **Danger** - Risque de pénalité pour sur-optimisation |

> **Attention**: Un DSEO élevé indique une sur-représentation des mots-clés qui pourrait être pénalisée par Google.

## Zones d'optimisation par terme

Chaque terme QBST est évalué et classé dans une zone d'optimisation basée sur sa fréquence dans le contenu.

| Zone | Couleur | Description | Action recommandée |
|------|---------|-------------|-------------------|
| **subOptimization** | 🔵 Bleu | Terme sous-utilisé ou absent | Ajouter des occurrences |
| **standardOptimization** | 🟢 Vert | Niveau optimal | Maintenir |
| **strongOptimization** | 🟠 Orange | Sur-optimisation légère | Surveiller, acceptable |
| **overOptimization** | 🔴 Rouge | Sur-optimisation forte | Réduire impérativement |

> **Note**: Il est acceptable d'avoir quelques termes en zone orange. La zone rouge doit être évitée car elle peut déclencher des pénalités algorithmiques.

## Brief SEO

Le **Brief SEO** est une analyse thématique générée par IA (via OpenAI) qui identifie les sujets et objectifs que votre contenu devrait traiter.

### Statuts d'objectifs

| Statut | Emoji | Description |
|--------|-------|-------------|
| **DONE** | ✅ | Objectif traité de manière satisfaisante |
| **NEED_MORE** | ⚠️ | Objectif partiellement traité, à développer |
| **MISSING** | ❌ | Objectif non traité |

> **Conseil**: Un contenu complet devrait couvrir au moins 70-80% des objectifs du brief.

## Bonnes pratiques

1. **Générez un guide** pour votre requête cible avant de rédiger
2. **Intégrez naturellement** les termes QBST dans votre contenu
3. **Visez la zone verte** pour les termes les plus importants
4. **Évitez la zone rouge** qui indique une sur-optimisation
5. **Utilisez le brief SEO** pour structurer votre contenu thématiquement
6. **Analysez la SERP** pour comprendre le niveau d'optimisation des concurrents

---
*Dernière mise à jour: Documentation MCP YourTextGuru*
`;

// =====================
// Create MCP Server
// =====================

const server = new Server(
  {
    name: "yourtextguru-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Handle resource listing
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: YTG_METRICS_URI,
        mimeType: "text/markdown",
        name: YTG_METRICS_NAME,
        description: YTG_METRICS_DESCRIPTION,
      },
    ],
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === YTG_METRICS_URI) {
    return {
      contents: [
        { uri, mimeType: "text/markdown", text: YTG_METRICS_MD },
      ],
    };
  }
  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
});

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args && name !== "ytg_get_status") {
    throw new McpError(ErrorCode.InvalidParams, "Arguments are required for this tool");
  }

  try {
    switch (name) {
      // --------------------
      // GUIDES
      // --------------------
      case "ytg_create_guide": {
        const query = args!.query as string;
        const lang = args!.lang as string;
        const type = (args!.type as string) || "google";

        // Validation du paramètre lang obligatoire
        if (!lang) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Le paramètre 'lang' est obligatoire (ex: fr_FR, en_US, en_GB)"
          );
        }

        const result = await makeApiCall("/guides", "POST", null, { query, lang, type }, false);
        
        const guide = result.data;
        return asMcpContent({
          message: "Guide SEO créé avec succès!",
          guideId: guide.id,
          query: guide.query,
          lang: guide.lang,
          type: guide.type,
          ready: guide.ready,
          status: guide.ready ? "✅ Prêt à utiliser" : "⏳ En cours de génération",
          note: guide.ready 
            ? "Le guide est prêt. Utilisez ytg_get_guide pour récupérer les termes QBST."
            : "Le guide est en cours de génération. Attendez quelques minutes puis utilisez ytg_get_guide."
        });
      }

      case "ytg_list_guides": {
        // Construire les paramètres de requête (pagination par curseur + filtres)
        const params: Record<string, any> = {};

        if (args?.lastId) {
          params.lastId = args.lastId as number;
        }
        if (args?.status) {
          params.status = args.status as string;
        }
        if (args?.lang) {
          params.lang = args.lang as string;
        }
        if (args?.apiOnly !== undefined) {
          params.apiOnly = args.apiOnly as number;
        }
        if (args?.projectId) {
          params.projectId = args.projectId as number;
        }
        if (args?.groupId) {
          params.groupId = args.groupId as number;
        }

        const result = await makeApiCall("/guides", "GET", null, params);

        const guides = Array.isArray(result.data) ? result.data : [];

        // Calculer le nextLastId pour la pagination (plus grand ID dans les résultats)
        const maxId = guides.length > 0
          ? Math.max(...guides.map((g: any) => g.id))
          : null;

        return asMcpContent({
          pagination: {
            lastId: args?.lastId || 0,
            nextLastId: maxId,
            hasMore: guides.length > 0,
            tip: maxId
              ? `Pour obtenir les guides suivants, utilisez lastId=${maxId}`
              : "Fin des résultats"
          },
          filters: {
            status: args?.status || null,
            lang: args?.lang || null,
            apiOnly: args?.apiOnly || null,
            projectId: args?.projectId || null,
            groupId: args?.groupId || null,
          },
          count: guides.length,
          guides: guides.map((g: any) => ({
            id: g.id,
            query: g.query,
            lang: g.lang,
            type: g.type,
            status: g.ready ? "✅ Prêt" : g.error ? "❌ Erreur" : g.status === "waiting" ? "⏳ En attente" : "🔄 En cours",
            ready: g.ready,
            createdAt: g.createdAt
          }))
        });
      }

      case "ytg_get_guide": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}`, "GET");

        // Structure API: result.data = { data: {...guideInfo}, target_SOSEO_min, ... }
        const guide = result.data.data;  // Les infos du guide sont dans data.data
        const response = result.data;    // Les targets sont au niveau racine de data

        return asMcpContent({
          guideId: guide.id,
          query: guide.query,
          lang: guide.lang,
          type: guide.type,
          status: guide.ready ? "✅ Prêt" : guide.error ? "❌ Erreur" : "⏳ En cours de génération",
          targets: {
            SOSEO: {
              min: response.target_SOSEO_min,
              max: response.target_SOSEO_max,
              description: "Score d'optimisation - doit être dans cet intervalle"
            },
            DSEO: {
              min: response.target_DSEO_min,
              max: response.target_DSEO_max,
              description: "Score de danger - ne pas dépasser le max"
            }
          },
          QBST: {
            description: "Query Based Salient Terms - Termes essentiels pour ranquer",
            "1grams": guide["1grams"]?.slice(0, 40) || [],
            "2grams": guide["2grams"]?.slice(0, 25) || [],
            "3grams": guide["3grams"]?.slice(0, 15) || [],
            entities: guide.entities?.slice(0, 15) || []
          },
          tip: "Utilisez ytg_check_text ou ytg_check_url pour analyser votre contenu par rapport à ce guide."
        });
      }

      case "ytg_delete_guide": {
        const guideId = args!.guideId as number;

        await makeApiCall(`/guides/${guideId}`, "DELETE", null, null, false);
        
        return asMcpContent({
          message: `Guide #${guideId} supprimé avec succès.`
        });
      }

      // --------------------
      // ANALYSE DE CONTENU
      // --------------------
      case "ytg_check_text": {
        const guideId = args!.guideId as number;
        const text = args!.text as string;

        const result = await makeApiCall(`/guides/${guideId}/check`, "POST", { text }, null, false);
        
        return asMcpContent(formatCheckResults(result.data));
      }

      case "ytg_check_url": {
        const guideId = args!.guideId as number;
        const url = args!.url as string;

        // Extract text from URL
        const text = await extractTextFromUrl(url);
        
        // Check the text
        const result = await makeApiCall(`/guides/${guideId}/check`, "POST", { text }, null, false);
        
        return asMcpContent({
          url,
          extractedText: text,
          textLength: text.length,
          ...formatCheckResults(result.data)
        });
      }

      // --------------------
      // SERP & CONCURRENCE
      // --------------------
      case "ytg_get_serp": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/serp`, "GET");
        const serp = result.data;

        return asMcpContent({
          guideId,
          date: serp.date,
          lang: serp.lang,
          intents: serp.intents || [],
          serps: (serp.serps || []).map((s: any) => ({
            position: s.position,
            url: s.url,
            scores: s.scores,
            length: s.length
          })),
          tip: "Comparez vos scores SOSEO/DSEO avec ceux des concurrents bien positionnés."
        });
      }

      case "ytg_get_paa": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/paa`, "GET");
        
        return asMcpContent({
          guideId,
          query: result.data.query,
          paa: result.data.paa || [],
          tip: "Intégrez ces questions comme sous-titres (H2/H3) dans votre contenu et fournissez des réponses claires."
        });
      }

      case "ytg_get_related": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/related`, "GET");
        
        return asMcpContent({
          guideId,
          query: result.data.query,
          related: result.data.related || [],
          tip: "Ces recherches peuvent inspirer de nouveaux contenus ou des sections à ajouter."
        });
      }

      // --------------------
      // BRIEF SEO
      // --------------------
      case "ytg_get_brief": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/brief`, "GET");
        const brief = result.data;

        if (brief.openAIError) {
          return asMcpContent({
            error: true,
            message: `Erreur OpenAI: ${brief.openAIError}`,
            tip: "Vérifiez que votre clé API OpenAI est correctement configurée dans YourTextGuru."
          });
        }

        if (!brief.brief) {
          return asMcpContent({
            message: "Le brief SEO n'est pas encore généré pour ce guide.",
            tip: "Utilisez ytg_create_brief pour le générer (nécessite une clé API OpenAI dans YourTextGuru)."
          });
        }

        return asMcpContent({
          guideId,
          brief: brief.brief,
          openAICost: brief.openAICost,
          tip: "Utilisez ytg_analyze_brief pour vérifier si votre contenu couvre ces objectifs."
        });
      }

      case "ytg_create_brief": {
        const guideId = args!.guideId as number;

        try {
          await makeApiCall(`/guides/${guideId}/brief`, "POST", null, null, false);
          
          return asMcpContent({
            message: `Brief SEO en cours de génération pour le guide #${guideId}.`,
            tip: "La génération peut prendre quelques instants. Utilisez ytg_get_brief pour récupérer le résultat."
          });
        } catch (error: any) {
          if (error.message.toLowerCase().includes("openai") || error.message.toLowerCase().includes("api key")) {
            return asMcpContent({
              error: true,
              message: error.message,
              tip: "Pour utiliser le brief SEO, configurez votre clé API OpenAI dans YourTextGuru."
            });
          }
          throw error;
        }
      }

      case "ytg_analyze_brief": {
        const guideId = args!.guideId as number;
        const text = args!.text as string;

        const result = await makeApiCall(`/guides/${guideId}/brief/analyze`, "POST", { text }, null, false);
        
        return asMcpContent({
          message: "Analyse du brief lancée!",
          analyzeId: result.data.id,
          guideId,
          tip: `Utilisez ytg_get_brief_analysis avec guideId=${guideId} et analyzeId=${result.data.id} pour récupérer les résultats.`
        });
      }

      case "ytg_analyze_url_brief": {
        const guideId = args!.guideId as number;
        const url = args!.url as string;

        // Extract text from URL
        const text = await extractTextFromUrl(url);
        
        // Launch brief analysis
        const result = await makeApiCall(`/guides/${guideId}/brief/analyze`, "POST", { text }, null, false);
        
        return asMcpContent({
          message: "Analyse du brief lancée pour l'URL!",
          url,
          extractedText: text,
          textLength: text.length,
          analyzeId: result.data.id,
          guideId,
          tip: `Utilisez ytg_get_brief_analysis avec guideId=${guideId} et analyzeId=${result.data.id} pour récupérer les résultats.`
        });
      }

      case "ytg_get_brief_analysis": {
        const guideId = args!.guideId as number;
        const analyzeId = args!.analyzeId as number;

        const result = await makeApiCall(`/guides/${guideId}/brief/analyze/${analyzeId}`, "GET");
        const analysis = result.data;

        if (analysis.status === "IN_PROGRESS") {
          return asMcpContent({
            status: "⏳ En cours",
            message: "L'analyse est encore en cours.",
            tip: `Réessayez dans quelques instants avec ytg_get_brief_analysis (guideId=${guideId}, analyzeId=${analyzeId}).`
          });
        }

        if (analysis.status === "ERROR") {
          return asMcpContent({
            status: "❌ Erreur",
            error: analysis.openAIError || "Erreur inconnue"
          });
        }

        // Calculate coverage
        const briefLink = analysis.briefLink || {};
        let done = 0, needMore = 0, missing = 0;
        const objectives: any[] = [];

        for (const [objective, status] of Object.entries(briefLink)) {
          const emoji = status === "DONE" ? "✅" : status === "NEED_MORE" ? "⚠️" : "❌";
          objectives.push({ objective, status, emoji });
          if (status === "DONE") done++;
          else if (status === "NEED_MORE") needMore++;
          else missing++;
        }

        const total = done + needMore + missing;
        const coverage = total > 0 ? Math.round((done / total) * 100) : 0;

        return asMcpContent({
          guideId,
          analyzeId,
          status: "✅ Terminé",
          coverage: `${coverage}%`,
          summary: {
            done: { count: done, percentage: total > 0 ? Math.round((done / total) * 100) : 0 },
            needMore: { count: needMore, percentage: total > 0 ? Math.round((needMore / total) * 100) : 0 },
            missing: { count: missing, percentage: total > 0 ? Math.round((missing / total) * 100) : 0 }
          },
          objectives,
          analyze: analysis.analyze,
          openAICost: analysis.openAICost,
          recommendations: [
            "Développez les sections marquées NEED_MORE",
            "Ajoutez du contenu pour couvrir les objectifs MISSING",
            "Les objectifs DONE sont bien traités, maintenez ce niveau"
          ]
        });
      }

      case "ytg_list_brief_analyses": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/brief/analyze`, "GET");
        const analyses = result.data || [];

        return asMcpContent({
          guideId,
          count: analyses.length,
          analyses: analyses.map((a: any) => ({
            id: a.id,
            status: a.status === "SUCCESS" ? "✅" : a.status === "ERROR" ? "❌" : "⏳",
            statusText: a.status,
            createdAt: a.createdAt ? new Date(a.createdAt * 1000).toISOString() : null
          })),
          tip: "Utilisez ytg_get_brief_analysis avec l'ID souhaité pour voir les détails."
        });
      }

      // --------------------
      // SEO TXL (Génération de contenu)
      // --------------------
      case "ytg_seotxl_auto": {
        const guideId = args!.guideId as number;
        const text = args!.text as string;

        const result = await makeApiCall(`/guides/${guideId}/seotxl/auto`, "POST", { text }, null, false);

        return asMcpContent({
          message: "Contenu généré avec succès!",
          guideId,
          content: result.data.content,
          openAICost: result.data.openAICost,
          openAIError: result.data.openAIError || null
        });
      }

      case "ytg_seotxl_outline": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/seotxl/outline`, "POST", null, null, false);

        return asMcpContent({
          message: "Plan de contenu généré avec succès!",
          guideId,
          content: result.data.content,
          openAICost: result.data.openAICost,
          openAIError: result.data.openAIError || null
        });
      }

      case "ytg_seotxl_questions": {
        const guideId = args!.guideId as number;

        const result = await makeApiCall(`/guides/${guideId}/seotxl/questions`, "POST", null, null, false);

        return asMcpContent({
          message: "Questions FAQ générées avec succès!",
          guideId,
          content: result.data.content,
          openAICost: result.data.openAICost,
          openAIError: result.data.openAIError || null
        });
      }

      case "ytg_seotxl_rephrase": {
        const guideId = args!.guideId as number;
        const text = args!.text as string;

        const result = await makeApiCall(`/guides/${guideId}/seotxl/rephrase`, "POST", { text }, null, false);

        return asMcpContent({
          message: "Texte reformulé avec succès!",
          guideId,
          content: result.data.content,
          openAICost: result.data.openAICost,
          openAIError: result.data.openAIError || null
        });
      }

      // --------------------
      // STATUS
      // --------------------
      case "ytg_get_status": {
        const result = await makeApiCall("/status", "GET", null, null, false);

        return asMcpContent({
          status: "✅ Connecté",
          apiStatus: result.data,
          rateLimitRemaining,
          tip: "L'API est fonctionnelle et prête à être utilisée."
        });
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
    }
  } catch (error: any) {
    logger.error(`Tool execution failed: ${error.message}`);
    throw new McpError(ErrorCode.InternalError, error.message || "Tool execution failed");
  }
});

// =====================
// Start Server
// =====================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("YourTextGuru MCP Server started successfully");
}

main().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});
