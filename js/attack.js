/* ============================================================================
   Chargement des données MITRE ATT&CK Enterprise.

   Les données sont embarquées, pas téléchargées. `js/attack-data.js` est produit
   par `tools/build-attack.mjs` à partir du bundle STIX publié par MITRE, réduit
   à ce que l'interface affiche.

   Pourquoi. Le bundle complet pèse 53,8 Mo pour 26 086 objets, dont l'interface
   ne lit que 15 tactiques, 697 techniques, 44 mitigations et 1 448 relations
   « mitigates » — 93 % des relations et tout le reste du référentiel ne servent
   jamais. Le télécharger à chaque démarrage coûtait 0,5 s sur une connexion
   directe, quand le cache répondait, et 15,9 s derrière un proxy d'entreprise
   qui déchiffre le trafic : un tel intermédiaire relaie le flux décompressé, si
   bien que les 5,95 Mo gzippés redevenaient 53,8 Mo sur le fil. Aucun réglage de
   cache ne rattrape ça, parce que la taille du fichier est le problème.

   Le fichier embarqué pèse 1,25 Mo, soit 39 fois moins avant compression — le
   seul chiffre qui compte quand un intermédiaire décompresse tout. Il est
   importé comme un module : plus de `fetch`, donc plus de CORS, plus de cache à
   espérer, plus de réessais, et la carte d'imports du document le versionne
   comme le reste du graphe.

   Contrepartie assumée : la matrice affiche la version générée, et ne suit plus
   MITRE toute seule. Relancer `node tools/build-attack.mjs` à chaque
   publication.

   Ce module ne porte plus que la reconstruction des index — `Map`, `Set` et
   références partagées ne se sérialisent pas, et les rebâtir coûte quelques
   microsecondes sur 697 techniques.
   ========================================================================= */

import DATA from "./attack-data.js";

/**
 * Rebâtit les index de travail depuis les données plates.
 *
 * Séparée de `loadAttack` pour que le banc d'essai puisse l'exercer sur un jeu
 * de données réduit et déterministe, sans dépendre du fichier généré.
 */
export function construire(data) {
    const tactics = data.tactics;
    const techniques = data.techniques;
    const subs = techniques.flatMap(t => t.subs);

    const byId = new Map(techniques.map(t => [t.id, t]));
    const allTechById = new Map([...techniques, ...subs].map(t => [t.id, t]));

    const mitigations = data.mitigations;
    const mitigationById = new Map(mitigations.map(m => [m.id, m]));

    /* --- couverture par case ---
       Une mitigation peut viser une sous-technique. On rattache alors la
       couverture à la technique parente pour que la case de la matrice, qui
       n'affiche que les techniques parentes, reflète la couverture réelle. */
    const coverage = new Map();          // id technique parente -> Set(id mitigation)
    for (const mitigation of mitigations) {
        for (const targetId of mitigation.techniques) {
            const parentId = String(targetId).split(".")[0];
            if (!byId.has(parentId)) continue;
            if (!coverage.has(parentId)) coverage.set(parentId, new Set());
            coverage.get(parentId).add(mitigation.id);
        }
    }

    /* --- index par tactique, dans l'ordre du site --- */
    const byTactic = new Map(
        tactics.map(t => [
            t.shortname,
            techniques
                .filter(tech => tech.tactics.includes(t.shortname))
                .sort((a, b) => a.name.localeCompare(b.name, "en")),
        ])
    );

    const platforms = [...new Set(techniques.flatMap(t => t.platforms))].sort((a, b) => a.localeCompare(b, "fr"));

    return {
        version: data.version,
        modified: data.modified,
        tactics,
        techniques,
        subTechniques: subs,
        techniqueById: byId,
        allTechniqueById: allTechById,
        mitigations,
        mitigationById,
        byTactic,
        coverage,
        platforms,
        counts: {
            tactics: tactics.length,
            techniques: techniques.length,
            subTechniques: subs.length,
            mitigations: mitigations.length,
            uncovered: techniques.filter(t => !coverage.has(t.id)).length,
        },
    };
}

/**
 * Charge la matrice Enterprise.
 *
 * Reste asynchrone et garde son rapport d'avancement : `main.js` affiche un
 * écran de démarrage autour de cet appel, et rien n'oblige à le démonter parce
 * que l'attente a disparu. Il n'y a plus qu'une étape, et elle est immédiate.
 *
 * @param {(msg: string, ratio?: number) => void} onProgress
 */
export async function loadAttack(onProgress = () => {}) {
    onProgress(`ATT&CK Enterprise v${DATA.version} — construction de la matrice…`, 1);
    return construire(DATA);
}
