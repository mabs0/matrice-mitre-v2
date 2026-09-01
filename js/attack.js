/* ============================================================================
   Chargement des données MITRE ATT&CK Enterprise.

   La fraîcheur repose sur une seule règle : l'index des versions est relu sans
   cache à chaque chargement, donc on découvre toujours la dernière version
   publiée. L'URL du bundle contient son numéro de version, elle est donc
   immuable — on laisse le cache HTTP du navigateur la servir. Une nouvelle
   version de MITRE veut dire une nouvelle URL, donc un nouveau téléchargement :
   la matrice reste juste, et un simple rechargement redevient quasi instantané.

   Le bundle pèse ~53 Mo brut, servi en gzip (~9 Mo sur le fil). Le décodage
   JSON ne coûte que ~80 ms : le temps d'attente est du transfert, d'où la
   progression en octets affichée pendant le chargement.

   Le dépôt mitre/cti est déprécié : la source de référence est attack-stix-data.
   ========================================================================= */

const INDEX_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/index.json";
const COLLECTION = "Enterprise ATT&CK";

/** Résout la version Enterprise la plus récente publiée par MITRE. */
async function resolveLatest() {
    const resp = await fetch(INDEX_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`index.json : HTTP ${resp.status}`);
    const index = await resp.json();

    const collection = index.collections.find(c => c.name === COLLECTION);
    if (!collection) throw new Error(`Collection « ${COLLECTION} » absente de l'index.`);

    // index.json liste les versions de la plus récente à la plus ancienne, mais
    // on ne s'appuie pas sur cet ordre : on trie explicitement.
    const versions = [...collection.versions].sort(
        (a, b) => cmpVersion(b.version, a.version)
    );
    const latest = versions[0];
    if (!latest) throw new Error("Aucune version Enterprise dans l'index.");
    return { version: latest.version, url: latest.url, modified: latest.modified };
}

function cmpVersion(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

/**
 * Rapport moyen entre la taille décompressée du bundle et sa taille sur le fil.
 * `content-length` donne la taille compressée alors que le flux rend les octets
 * décompressés : sans ce facteur on ne peut pas afficher de jauge.
 *
 * Mesuré à 9,04 sur la v19.2 (53,8 Mo pour 5,95 Mo). Il valait 5,94 sur la
 * v19.1 (53,3 Mo pour 9,0 Mo) : le rapport n'est donc *pas* stable d'une
 * version à l'autre, contrairement à ce qui était supposé ici — à taille
 * décompressée quasi identique, MITRE a publié la 19.2 nettement mieux
 * compressée. Une valeur trop basse ne ralentit rien, mais elle fait plafonner
 * la jauge à 99 % avant la fin : avec 5,9 sur la 19.2, elle y arrivait aux deux
 * tiers du transfert et le dernier tiers paraissait figé.
 *
 * À revérifier à chaque version majeure. L'estimation ne sert qu'à l'affichage —
 * elle est bornée à 99 % jusqu'à la fin réelle du transfert.
 */
const GZIP_RATIO = 9.0;

/**
 * Charge et normalise la matrice Enterprise.
 * @param {(msg: string, ratio?: number) => void} onProgress ratio estimé dans [0,1]
 */
export async function loadAttack(onProgress = () => {}) {
    onProgress("Recherche de la dernière version publiée…");
    const release = await resolveLatest();

    // Sans ratio : on ne sait pas encore si la taille à recevoir sera annoncée.
    // Passer 0 ici affichait une jauge déterminée avant même de savoir qu'on
    // saurait la remplir.
    onProgress(`ATT&CK Enterprise v${release.version} — téléchargement…`);
    const text = await fetchWithProgress(release.url, release.version, onProgress);

    onProgress("Construction de la matrice…", 1);
    return normalise(JSON.parse(text), release);
}

const ATTEMPTS = 3;

/**
 * Télécharge le bundle, en réessayant avant d'abandonner.
 *
 * Un seul échec suffisait à condamner le chargement, alors que les deux causes
 * observées cèdent toutes les deux à un nouvel essai :
 *
 *  — GitHub répond parfois 400 sur ce fichier, le plus gros du dépôt (51 Mio),
 *    quand un nœud de diffusion doit le chercher à froid ; la requête suivante
 *    passe. C'est ce qui se produit dans les heures qui suivent la publication
 *    d'une version.
 *  — `force-cache` sert une réponse déjà en cache *sans jamais la revalider*.
 *    Une entrée fautive retenue par le navigateur est donc rejouée à chaque
 *    rechargement : la page échoue en navigation normale et fonctionne en
 *    navigation privée, sur la même machine et le même réseau.
 *
 * D'où la stratégie : premier essai sur le cache — l'URL porte le numéro de
 * version, elle est immuable, et une relecture y est gratuite —, puis essais
 * suivants en `reload`, qui court-circuitent le cache et écartent du même coup
 * l'entrée fautive.
 */
async function fetchWithProgress(url, version, onProgress) {
    let last;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            return await download(url, version, onProgress, attempt === 1 ? "force-cache" : "reload");
        } catch (err) {
            last = err;
            if (attempt === ATTEMPTS) break;
            // Sans ratio : la jauge repart en va-et-vient plutôt que de rester
            // figée sur l'avancement de la tentative abandonnée.
            onProgress(`ATT&CK Enterprise v${version} — échec du téléchargement, nouvel essai…`);
            await new Promise(r => setTimeout(r, 700 * attempt));
        }
    }
    throw last;
}

/**
 * Le corps annoncé est-il compressé ?
 *
 * On ne peut pas le demander : `content-encoding` n'est pas dans la liste
 * blanche CORS, et GitHub ne l'expose pas — `headers.get` rend `null` que le
 * flux soit compressé ou non. Reste l'ordre de grandeur, et il est franc : le
 * bundle pèse ~54 Mo en clair contre ~6 Mo gzippé, un facteur dix. Tout ce qui
 * est annoncé au-delà de 20 Mo est donc déjà du texte décompressé, et sa taille
 * est la taille finale : la multiplier viserait dix fois trop haut.
 *
 * Ce cas n'est pas théorique. Derrière un proxy d'entreprise qui déchiffre et
 * inspecte le trafic, la réponse arrive décompressée et `content-encoding`
 * disparaît : `content-length` vaut alors les 54 Mo réels. Sans ce test la
 * jauge annonçait ~480 Mo à recevoir et rampait jusqu'à 11 % avant de sauter
 * d'un coup à la fin.
 */
function estCompresse(annoncee) {
    return annoncee > 0 && annoncee < 20 * 1024 * 1024;
}

/** Un essai de téléchargement, en rendant compte de l'avancement réel. */
async function download(url, version, onProgress, cache) {
    const resp = await fetch(url, { cache });
    if (!resp.ok) throw new Error(`bundle v${version} : HTTP ${resp.status}`);

    if (!resp.body?.getReader) return resp.text();      // pas de flux : lecture directe

    // `content-length` n'est pas toujours là : un proxy d'entreprise qui relaie
    // le flux en le réécrivant le supprime, et il n'y a alors aucune taille à
    // viser. On rend la main sans ratio, la barre reste indéterminée, et le
    // compteur d'octets continue de montrer que ça avance.
    const annoncee = Number(resp.headers.get("content-length")) || 0;
    let estimated = annoncee * (estCompresse(annoncee) ? GZIP_RATIO : 1);

    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        // L'estimation peut aussi être fausse dans l'autre sens : un
        // intermédiaire qui décompresse le flux annonce déjà la taille finale,
        // et la multiplier par le rapport de compression vise six fois trop
        // haut. Dès qu'on a reçu plus que prévu, on cesse de s'en servir plutôt
        // que de coincer la jauge à 99 % jusqu'à la fin.
        if (estimated && received > estimated) estimated = 0;

        const mb = (received / 1048576).toFixed(1);
        if (estimated) {
            const ratio = Math.min(0.99, received / estimated);
            onProgress(`ATT&CK Enterprise v${version} — ${mb} Mo sur ~${(estimated / 1048576).toFixed(0)} Mo`, ratio);
        } else {
            onProgress(`ATT&CK Enterprise v${version} — ${mb} Mo lus`);
        }
    }

    onProgress(`ATT&CK Enterprise v${version} — ${(received / 1048576).toFixed(1)} Mo reçus`, 1);
    return new TextDecoder().decode(concat(chunks, received));
}

function concat(chunks, total) {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
}

/* -------------------------------------------------------------------------- */

const isLive = o => !o.x_mitre_deprecated && !o.revoked;
const attackId = o => o.external_references?.find(r => r.source_name?.startsWith("mitre-"))?.external_id
    ?? o.external_references?.[0]?.external_id
    ?? null;
const attackUrl = o => o.external_references?.find(r => r.source_name?.startsWith("mitre-"))?.url
    ?? o.external_references?.[0]?.url
    ?? null;

/**
 * Réduit le bundle STIX à ce dont l'interface a besoin.
 *
 * L'ordre des tactiques vient de `tactic_refs` de l'objet x-mitre-matrix : il
 * est déjà celui du site, donc aucune liste d'identifiants n'est codée en dur.
 * C'est ce qui permet d'absorber sans rien changer une évolution comme la v19,
 * où Defense Evasion s'est scindée en Stealth et Defense Impairment.
 */
function normalise(bundle, release) {
    const objects = bundle.objects || [];
    const byStixId = new Map(objects.map(o => [o.id, o]));

    const matrix = objects.find(o => o.type === "x-mitre-matrix" && isLive(o));
    const tacticById = new Map(
        objects.filter(o => o.type === "x-mitre-tactic" && isLive(o)).map(o => [o.id, o])
    );

    const orderedRefs = matrix?.tactic_refs?.length
        ? matrix.tactic_refs
        : [...tacticById.keys()];

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

    const mitigationById = new Map(mitigations.map(m => [m.id, m]));
    const mitigationByStix = new Map(mitigations.map(m => [m.stixId, m]));

    /* --- relations « mitigates » ---
       Une mitigation peut viser une sous-technique. On rattache alors la
       couverture à la technique parente pour que la case de la matrice, qui
       n'affiche que les techniques parentes, reflète la couverture réelle. */
    const allTechById = new Map([...techniques, ...subs].map(t => [t.id, t]));
    const coverage = new Map();          // id technique parente -> Set(id mitigation)

    for (const rel of objects) {
        if (rel.type !== "relationship" || rel.relationship_type !== "mitigates") continue;
        if (rel.x_mitre_deprecated || rel.revoked) continue;

        const mitigation = mitigationByStix.get(rel.source_ref);
        const target = byStixId.get(rel.target_ref);
        if (!mitigation || !target || target.type !== "attack-pattern") continue;

        const targetId = attackId(target);
        if (!targetId || !allTechById.has(targetId)) continue;

        mitigation.techniques.push(targetId);

        const parentId = String(targetId).split(".")[0];
        if (!byId.has(parentId)) continue;
        if (!coverage.has(parentId)) coverage.set(parentId, new Set());
        coverage.get(parentId).add(mitigation.id);
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
        version: release.version,
        modified: release.modified,
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
