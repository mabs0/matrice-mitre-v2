/* Génère js/attack-data.js depuis le bundle STIX publié par MITRE.

   Lancé à la main quand MITRE publie une version, jamais au runtime :

       node tools/build-attack.mjs            # dernière version publiée
       node tools/build-attack.mjs --fichier chemin/vers/bundle.json

   Pourquoi ce script existe. Le site téléchargeait le bundle complet à chaque
   démarrage : 53,8 Mo de JSON, 26 086 objets STIX, dont il n'affiche que 15
   tactiques, 697 techniques, 44 mitigations et 1 448 relations « mitigates ».
   Tout le reste — logiciels malveillants, groupes, campagnes, analytics,
   stratégies de détection, et 93 % des relations — n'est jamais lu.

   Le coût n'était pas théorique. Derrière un proxy d'entreprise qui déchiffre
   et inspecte le trafic, la réponse arrive décompressée : 53,8 Mo réellement
   transférés au lieu des 5,95 Mo gzippés, mesurés à 15,9 s de démarrage contre
   0,5 s sur une connexion directe. Aucun réglage de cache n'y peut rien, parce
   que le problème est la taille du fichier, pas le transport.

   Le fichier généré pèse 1,38 Mo — 39 fois moins avant compression, ce qui est
   le chiffre qui compte quand un intermédiaire décompresse tout.

   Ce que le script ne fait pas : construire les index. Les `Map`, les `Set` et
   les références partagées de la structure de travail ne se sérialisent pas, et
   les reconstruire au chargement coûte quelques microsecondes sur 697
   techniques. Le fichier ne porte donc que des données plates ; `attack.js`
   rebâtit le reste.

   Contrepartie assumée : la matrice ne suit plus MITRE toute seule. Elle affiche
   la version générée ici, et il faut relancer ce script à chaque publication. */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const INDEX_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/index.json";
const COLLECTION = "Enterprise ATT&CK";
const OUT = fileURLToPath(new URL("../js/attack-data.js", import.meta.url));

const isLive = o => !o.x_mitre_deprecated && !o.revoked;
const attackId = o => o.external_references?.find(r => r.source_name?.startsWith("mitre-"))?.external_id
    ?? o.external_references?.[0]?.external_id
    ?? null;
const attackUrl = o => o.external_references?.find(r => r.source_name?.startsWith("mitre-"))?.url
    ?? o.external_references?.[0]?.url
    ?? null;

function cmpVersion(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

/** Résout la version Enterprise la plus récente publiée par MITRE. */
async function resolveLatest() {
    const resp = await fetch(INDEX_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`index.json : HTTP ${resp.status}`);
    const index = await resp.json();

    const collection = index.collections.find(c => c.name === COLLECTION);
    if (!collection) throw new Error(`Collection « ${COLLECTION} » absente de l'index.`);

    // index.json liste les versions de la plus récente à la plus ancienne, mais
    // on ne s'appuie pas sur cet ordre : on trie explicitement.
    const versions = [...collection.versions].sort((a, b) => cmpVersion(b.version, a.version));
    const latest = versions[0];
    if (!latest) throw new Error("Aucune version Enterprise dans l'index.");
    return latest;
}

/**
 * Réduit le bundle STIX aux données plates dont l'interface a besoin.
 *
 * L'ordre des tactiques vient de `tactic_refs` de l'objet x-mitre-matrix : il
 * est déjà celui du site, donc aucune liste d'identifiants n'est codée en dur.
 * C'est ce qui permet d'absorber sans rien changer une évolution comme la v19,
 * où Defense Evasion s'est scindée en Stealth et Defense Impairment.
 */
export function reduire(bundle, release) {
    const objects = bundle.objects || [];
    const byStixId = new Map(objects.map(o => [o.id, o]));

    const matrix = objects.find(o => o.type === "x-mitre-matrix" && isLive(o));
    const tacticById = new Map(
        objects.filter(o => o.type === "x-mitre-tactic" && isLive(o)).map(o => [o.id, o])
    );
    const orderedRefs = matrix?.tactic_refs?.length ? matrix.tactic_refs : [...tacticById.keys()];

    const tactics = orderedRefs
        .map(ref => tacticById.get(ref))
        .filter(Boolean)
        .map(t => ({
            stixId: t.id,
            id: attackId(t),
            name: t.name,
            shortname: t.x_mitre_shortname,
            description: t.description || "",
            url: attackUrl(t),
        }));

    /* --- techniques et sous-techniques --- */
    const patterns = objects.filter(o => o.type === "attack-pattern" && isLive(o));
    const toTechnique = o => ({
        stixId: o.id,
        id: attackId(o),
        name: o.name,
        description: o.description || "",
        url: attackUrl(o),
        platforms: o.x_mitre_platforms || [],
        tactics: (o.kill_chain_phases || [])
            .filter(p => p.kill_chain_name === "mitre-attack")
            .map(p => p.phase_name),
        isSub: !!o.x_mitre_is_subtechnique,
        subs: [],
    });

    const techniques = patterns.filter(o => !o.x_mitre_is_subtechnique).map(toTechnique);
    const subs = patterns.filter(o => o.x_mitre_is_subtechnique).map(toTechnique);

    const byId = new Map(techniques.map(t => [t.id, t]));
    for (const s of subs) {
        // Un identifiant de sous-technique est toujours « Txxxx.yyy ».
        const parent = byId.get(String(s.id).split(".")[0]);
        if (parent) parent.subs.push(s);
    }
    for (const t of techniques) t.subs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    /* --- mitigations --- */
    const mitigations = objects
        .filter(o => o.type === "course-of-action" && isLive(o))
        .map(o => ({
            stixId: o.id,
            id: attackId(o),
            name: o.name,
            description: o.description || "",
            url: attackUrl(o),
            techniques: [],   // identifiants de techniques (parentes et sous-techniques)
        }))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const mitigationByStix = new Map(mitigations.map(m => [m.stixId, m]));
    const allTechById = new Map([...techniques, ...subs].map(t => [t.id, t]));

    /* --- relations « mitigates » ---
       Seules ces 1 448 relations sur 21 262 sont lues. La couverture par case de
       la matrice n'est pas sérialisée : elle se déduit exactement de ces listes,
       et `attack.js` la rebâtit au chargement. */
    for (const rel of objects) {
        if (rel.type !== "relationship" || rel.relationship_type !== "mitigates") continue;
        if (rel.x_mitre_deprecated || rel.revoked) continue;

        const mitigation = mitigationByStix.get(rel.source_ref);
        const target = byStixId.get(rel.target_ref);
        if (!mitigation || !target || target.type !== "attack-pattern") continue;

        const targetId = attackId(target);
        if (!targetId || !allTechById.has(targetId)) continue;
        mitigation.techniques.push(targetId);
    }

    return { version: release.version, modified: release.modified, tactics, techniques, mitigations };
}

/* ------------------------------------------------------------------ écriture */

/* Le corps ci-dessous ne s'exécute que si ce fichier est lancé directement.
   `reduire` est importée par le banc d'essai, qui s'en sert pour fabriquer son
   jeu de données réduit à partir de son mini-bundle synthétique : la réduction
   éprouvée par les tests est alors exactement celle qui produit le fichier
   publié, et non une seconde implémentation qui pourrait diverger. */
if (import.meta.url !== pathToFileURL(process.argv[1] ?? "").href) {
    // Importé comme module : rien à faire.
} else {

const argFichier = process.argv.indexOf("--fichier");
let bundle, release;

if (argFichier !== -1) {
    const chemin = process.argv[argFichier + 1];
    if (!chemin) throw new Error("--fichier attend un chemin");
    console.log(`Lecture de ${chemin}…`);
    bundle = JSON.parse(readFileSync(chemin, "utf8"));
    release = { version: "local", modified: new Date().toISOString() };
} else {
    console.log("Recherche de la dernière version publiée…");
    release = await resolveLatest();
    console.log(`ATT&CK Enterprise v${release.version} — téléchargement…`);
    const resp = await fetch(release.url);
    if (!resp.ok) throw new Error(`bundle v${release.version} : HTTP ${resp.status}`);
    const texte = await resp.text();
    console.log(`  ${(texte.length / 1048576).toFixed(1)} Mo reçus`);
    bundle = JSON.parse(texte);
}

const data = reduire(bundle, release);

/* Les données sont posées en JSON dans une chaîne plutôt qu'en littéral
   d'objet : `JSON.parse` est nettement plus rapide que l'analyse syntaxique du
   même contenu écrit en JavaScript, et sur plus d'un mégaoctet ça se voit au
   démarrage. Le guillemet simple et l'antislash sont échappés parce que la
   chaîne est délimitée par des guillemets simples. */
const charge = JSON.stringify(data).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

writeFileSync(OUT, `/* Généré par tools/build-attack.mjs — ne pas modifier à la main.

   ATT&CK Enterprise v${data.version}, publiée le ${data.modified}.
   Réduit aux données que l'interface affiche : ${data.tactics.length} tactiques,
   ${data.techniques.length} techniques parentes, ${data.techniques.reduce((n, t) => n + t.subs.length, 0)} sous-techniques,
   ${data.mitigations.length} mitigations, ${data.mitigations.reduce((n, m) => n + m.techniques.length, 0)} rattachements mitigation -> technique.

   Pour régénérer après une publication de MITRE :  node tools/build-attack.mjs */

export default JSON.parse('${charge}');
`);

const octets = Buffer.byteLength(charge);
console.log(`\n${OUT}`);
console.log(`  ${data.tactics.length} tactiques, ${data.techniques.length} techniques parentes, `
            + `${data.techniques.reduce((n, t) => n + t.subs.length, 0)} sous-techniques, `
            + `${data.mitigations.length} mitigations`);
console.log(`  ${(octets / 1048576).toFixed(2)} Mo`);

}
