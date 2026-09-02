/* ============================================================================
   Une CVE collée dans la barre, les techniques correspondantes surlignées.

   Ce module ne fait que résoudre : il rend deux listes d'identifiants de
   techniques et ne touche à rien d'autre. C'est `views/matrix.js` qui décide de
   ce qu'il en fait.

   ------------------------------------------------------- direct et hérité

   Le NVD attribue à une CVE le CWE le plus précis qu'il connaisse. Ce CWE-là ne
   mène souvent nulle part dans ATT&CK ; ses ancêtres, si. Le fichier de données
   garde donc les deux séparés :

     - `direct` : les techniques du CWE réellement attribué. C'est un lien
       établi, de la vulnérabilité vers la technique.
     - `heritees` : celles qui ne viennent que d'un ancêtre du CWE, c'est-à-dire
       d'une famille de faiblesses. Deux tiers des CVE n'obtiennent une technique
       que par ce chemin, et ce qu'il désigne est réel mais large.

   Les mélanger reviendrait à faire passer une parenté lointaine pour une
   caractérisation. L'interface montre les deux, distinctement, et laisse couper
   les secondes.

   ---------------------------------------------------------------- le poids

   `cve-data.js` pèse 1,7 Mo : c'est 282 000 CVE. Il n'est donc pas dans le
   graphe de démarrage, il est importé à la première recherche. Qui n'utilise
   pas cette barre ne le télécharge jamais, et le démarrage ne bouge pas.

   L'import est un `import()` de module local, pas une requête : la page reste
   sans aucune sortie réseau, et `connect-src 'none'` reste vrai.
   ========================================================================= */

/* Ce qu'on accepte de coller : la forme officielle, mais aussi celle qu'on
   obtient en copiant depuis un tableur ou un rapport de scan — casse
   indifférente, espaces autour, préfixe absent. Refuser « cve 2021 44228 »
   parce qu'il manque deux tirets n'apprendrait rien à personne. */
const FORME = /^\s*(?:CVE[\s-]?)?(\d{4})[\s-](\d{4,7})\s*$/i;

/**
 * Reconnaît une saisie et la ramène à la forme canonique.
 * @returns {string|null} « CVE-2021-44228 », ou null si ce n'en est pas une
 */
export function normaliserCve(saisie) {
    const m = FORME.exec(String(saisie ?? ""));
    return m ? `CVE-${m[1]}-${String(Number(m[2]))}` : null;
}

/** Le fichier de données, une fois chargé. */
let donnees = null;
/** Promesse en cours, pour que deux frappes rapprochées ne chargent qu'une fois. */
let chargement = null;
/** Index millésime -> Map(numéro -> rang du couple), bâti au premier besoin. */
const index = new Map();

async function charger() {
    if (donnees) return donnees;
    if (!chargement) {
        chargement = import("./cve-data.js")
            .then(m => { donnees = m.default; return donnees; })
            .catch(e => { chargement = null; throw e; });
    }
    return chargement;
}

/**
 * L'index d'un millésime.
 *
 * Le fichier groupe les CVE par couple de résultat : une clé par couple, et la
 * liste des numéros qui le partagent. C'est ce qui rend le fichier trois fois
 * plus léger qu'une clé par CVE. On retourne le groupement à la première
 * consultation de l'année, et une seule fois : le plus gros millésime fait
 * 45 000 entrées, ce qui se bâtit en quelques millisecondes.
 */
function indexDe(annee) {
    if (index.has(annee)) return index.get(annee);
    const seaux = donnees.years?.[annee];
    if (!seaux) { index.set(annee, null); return null; }

    const carte = new Map();
    for (const [couple, numeros] of Object.entries(seaux)) {
        for (const n of numeros) carte.set(n, Number(couple));
    }
    index.set(annee, carte);
    return carte;
}

/**
 * Les techniques liées à une CVE.
 *
 * @param {string} saisie ce que le répondant a collé
 * @returns {Promise<null | {
 *   id: string, connue: boolean, horsPerimetre: boolean,
 *   direct: string[], heritees: string[]
 * }>} null si la saisie n'est pas une CVE du tout
 *
 * `connue: false` couvre deux cas qu'on ne peut pas distinguer sans embarquer
 * aussi les CVE sans résultat : une CVE inconnue du NVD, et une CVE connue dont
 * aucun CWE ne mène à une technique. `horsPerimetre` sépare au moins le cas où
 * le millésime lui-même n'est pas couvert — une CVE plus récente que la dernière
 * génération du fichier —, qui appelle un tout autre message.
 */
export async function techniquesDeCve(saisie) {
    const id = normaliserCve(saisie);
    if (!id) return null;

    await charger();

    const [, annee, numero] = /^CVE-(\d{4})-(\d+)$/.exec(id);
    const carte = indexDe(annee);
    const vide = { id, connue: false, horsPerimetre: !carte, direct: [], heritees: [] };
    if (!carte) return vide;

    const couple = carte.get(Number(numero));
    if (couple === undefined) return vide;

    const [direct, heritees] = donnees.sets[couple];
    const nom = i => donnees.techniques[i];
    return { id, connue: true, horsPerimetre: false, direct: direct.map(nom), heritees: heritees.map(nom) };
}

/** Ce que la table couvre, pour le dire dans l'interface plutôt que de le taire. */
export async function perimetreCve() {
    await charger();
    const annees = Object.keys(donnees.years ?? {}).sort();
    return {
        genere: donnees.generated,
        cwe: donnees.cwe,
        indexees: donnees.counts?.indexed ?? 0,
        premiere: annees[0] ?? null,
        derniere: annees[annees.length - 1] ?? null,
    };
}
