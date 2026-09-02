/* Génère js/cve-data.js : la table « CVE -> techniques ATT&CK ».

   Lancé à la main, jamais au runtime :

       node tools/build-cve.mjs                    # télécharge tout
       node tools/build-cve.mjs --flux chemin/     # réutilise des flux NVD déjà là

   ---------------------------------------------------------------- la chaîne

   Il n'existe aucune table « CVE -> technique ». Ce que publient le NIST et
   MITRE, ce sont quatre tables qui se recouvrent, et le lien s'obtient en les
   joignant :

       CVE  --(flux NVD, champ « weaknesses »)-->  CWE
       CWE  --(arbre « ChildOf » du catalogue CWE)-->  CWE ancêtres
       CWE  --(« Related_Attack_Patterns »)-->  CAPEC
       CAPEC --(« Taxonomy_Mapping » vers ATTACK)-->  technique

   Rien n'est inventé ici, rien n'est deviné : chaque maillon est une relation
   écrite dans un fichier officiel. Ce script ne fait que la jointure.

   ------------------------------------------------- pourquoi deux catégories

   Le deuxième maillon est le seul qui demande un jugement, et c'est lui qui
   décide de la qualité du résultat.

   Le NVD attribue à une CVE le CWE le plus précis qu'il connaisse — disons
   CWE-78, « injection de commande OS ». Or ce CWE-là ne porte souvent aucun
   CAPEC rattaché à ATT&CK. Ses ancêtres, eux, en portent : CWE-74
   « injection », trois crans au-dessus, en porte trente-sept.

   Remonter l'arbre fait donc passer la couverture de 20 % à 70 % des CVE. Mais
   ce qu'on gagne ainsi ne décrit plus la vulnérabilité : ça décrit sa famille.
   Mesuré sur l'ensemble du NVD, deux tiers des CVE qui obtiennent une technique
   ne l'obtiennent que par un ancêtre.

   D'où le choix retenu : on remonte, mais on garde les deux catégories
   séparées. `direct` vient du CWE que le NVD a réellement attribué ; `herite`
   vient d'un ancêtre. L'interface les distingue et laisse couper les secondes.
   Confondre les deux ferait passer une parenté lointaine pour un lien établi.

   ------------------------------------------------------------ l'encodage

   282 000 CVE mènent quelque part, mais elles ne se répartissent qu'en 1 400
   couples (direct, hérité) distincts : deux CVE partageant leurs CWE partagent
   forcément leur résultat. On écrit donc la table des couples une fois, et
   chaque CVE ne pèse plus qu'un index.

   Trois économies s'ajoutent, et c'est ce qui ramène le fichier de 4,6 Mo à
   1,6 Mo : les identifiants de techniques sont eux-mêmes indexés dans un
   dictionnaire ; les CVE sont groupées par millésime, ce qui sort l'année des
   clés ; et à l'intérieur d'un millésime elles sont groupées par index de
   couple, ce qui remplace 45 000 clés par 1 400 listes de nombres.

   Le fichier n'est pas chargé au démarrage : `js/cve.js` ne l'importe qu'à la
   première CVE saisie. Qui n'utilise pas la recherche ne le télécharge jamais.

   ------------------------------------------------------------ la péremption

   ATT&CK sort deux fois par an, les CVE tombent tous les jours. Le fichier est
   figé à la publication : une CVE plus récente que le dernier passage de ce
   script est inconnue de la page. C'est le prix du site sans serveur, et
   l'interface le dit plutôt que de laisser croire à une base vivante. */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { resolve } from "node:path";

const CWE_URL = "https://cwe.mitre.org/data/xml/cwec_latest.xml";
const CAPEC_URL = "https://capec.mitre.org/data/xml/capec_latest.xml";
const NVD_FLUX = annee => `https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-${annee}.json.gz`;
// Le NVD publie un flux par millésime depuis 2002 ; celui de 2002 contient
// aussi tout ce qui précède.
const PREMIER_FLUX = 2002;
const OUT = fileURLToPath(new URL("../js/cve-data.js", import.meta.url));

/* ------------------------------------------------------------ téléchargement */

async function telecharger(url, essais = 3) {
    for (let i = 1; i <= essais; i++) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return Buffer.from(await resp.arrayBuffer());
        } catch (e) {
            if (i === essais) throw new Error(`${url} : ${e.message}`);
            console.log(`  échec (${e.message}), nouvelle tentative dans ${i * 4} s…`);
            await new Promise(r => setTimeout(r, i * 4000));
        }
    }
}

/* Le catalogue CWE est servi sous un nom en « .xml » qui est en réalité une
   archive zip d'une seule entrée. Node sait dégonfler un flux deflate mais ne
   lit pas le format zip : voici le strict nécessaire, lu depuis l'annuaire
   central plutôt que depuis l'en-tête local, qui peut annoncer une taille nulle
   quand l'archive a été écrite en flux. */
function dezipper(buf) {
    if (buf.subarray(0, 2).toString("latin1") !== "PK") return buf.toString("utf8");

    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("archive zip : annuaire central introuvable");

    const debutAnnuaire = buf.readUInt32LE(eocd + 16);
    const methode = buf.readUInt16LE(debutAnnuaire + 10);
    const taille = buf.readUInt32LE(debutAnnuaire + 20);
    const offset = buf.readUInt32LE(debutAnnuaire + 42);

    // L'en-tête local redonne les longueurs de nom et d'extra, qui seules
    // disent où commencent réellement les données.
    const nomLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const donnees = buf.subarray(offset + 30 + nomLen + extraLen, offset + 30 + nomLen + extraLen + taille);

    if (methode === 0) return donnees.toString("utf8");
    if (methode === 8) return inflateRawSync(donnees).toString("utf8");
    throw new Error(`archive zip : méthode de compression ${methode} non gérée`);
}

/* --------------------------------------------------- CAPEC -> techniques */

/* Un CAPEC porte ses correspondances vers d'autres référentiels dans des
   `Taxonomy_Mapping`. Seules celles nommées « ATTACK » nous intéressent, et
   leur `Entry_ID` est un numéro de technique sans le « T ». */
export function capecVersTechniques(xml) {
    const out = new Map();
    for (const m of xml.matchAll(/<Attack_Pattern\b[^>]*\bID="(\d+)"[^>]*>([\s\S]*?)<\/Attack_Pattern>/g)) {
        const techniques = new Set();
        for (const tm of m[2].matchAll(/<Taxonomy_Mapping\b[^>]*Taxonomy_Name="ATTACK"[^>]*>([\s\S]*?)<\/Taxonomy_Mapping>/g)) {
            for (const e of tm[1].matchAll(/<Entry_ID>([\d.]+)<\/Entry_ID>/g)) techniques.add(`T${e[1]}`);
        }
        if (techniques.size) out.set(m[1], techniques);
    }
    return out;
}

/* ------------------------------------------------------ CWE -> techniques */

/**
 * Pour chaque CWE, ce qu'il désigne en propre et ce qu'il hérite.
 *
 * Une technique vue à la fois en direct et par un ancêtre reste dans `direct` :
 * c'est la catégorie la plus forte, et la faire figurer deux fois obligerait
 * l'interface à trancher elle-même.
 */
export function cweVersTechniques(xml, capecTech) {
    const parents = new Map();
    const capecs = new Map();
    for (const m of xml.matchAll(/<Weakness\b[^>]*\bID="(\d+)"[^>]*>([\s\S]*?)<\/Weakness>/g)) {
        parents.set(m[1], [...m[2].matchAll(/<Related_Weakness\s+Nature="ChildOf"\s+CWE_ID="(\d+)"/g)].map(x => x[1]));
        capecs.set(m[1], [...m[2].matchAll(/<Related_Attack_Pattern\s+CAPEC_ID="(\d+)"/g)].map(x => x[1]));
    }

    const techniquesDe = cwe => {
        const out = new Set();
        for (const c of capecs.get(cwe) ?? []) for (const t of capecTech.get(c) ?? []) out.add(t);
        return out;
    };

    // Parcours en largeur : un CWE peut avoir plusieurs parents, et l'arbre est
    // en réalité un graphe. Le `vu` évite d'y tourner en rond.
    const ancetres = cwe => {
        const vu = new Set();
        const file = [...(parents.get(cwe) ?? [])];
        while (file.length) {
            const x = file.shift();
            if (vu.has(x)) continue;
            vu.add(x);
            file.push(...(parents.get(x) ?? []));
        }
        return vu;
    };

    const out = new Map();
    for (const cwe of parents.keys()) {
        const direct = techniquesDe(cwe);
        const herite = new Set();
        for (const a of ancetres(cwe)) for (const t of techniquesDe(a)) if (!direct.has(t)) herite.add(t);
        if (direct.size || herite.size) out.set(cwe, { direct, herite });
    }
    return { table: out, cwes: parents.size };
}

/* ------------------------------------------------------------ flux NVD */

/* Le NVD range les faiblesses en « Primary » et « Secondary ». La première est
   l'attribution du NIST, la seconde celle du déclarant ; on ne descend à la
   seconde qu'à défaut de la première, comme le fait le NVD lui-même dans son
   interface. */
export function cwesDuCve(cve) {
    const infos = cve.weaknesses ?? [];
    for (const type of ["Primary", "Secondary"]) {
        const ids = infos
            .filter(x => x.type === type)
            .flatMap(x => x.description ?? [])
            .map(d => /^CWE-(\d{1,4})$/.exec(String(d.value ?? "").trim())?.[1])
            .filter(Boolean);
        if (ids.length) return [...new Set(ids)];
    }
    return [];
}

/**
 * Les techniques d'une CVE, à partir de ses CWE.
 *
 * La technique parente d'une sous-technique est ajoutée : la matrice n'affiche
 * les sous-techniques que sur demande, et sans la parente la case visible
 * resterait éteinte alors que la CVE la concerne. C'est la même règle que pour
 * le surlignage d'une mitigation.
 */
export function techniquesDeCwes(cwes, table) {
    const direct = new Set();
    const herite = new Set();
    for (const id of cwes) {
        const e = table.get(id);
        if (!e) continue;
        for (const t of e.direct) direct.add(t);
        for (const t of e.herite) herite.add(t);
    }
    for (const t of [...direct]) direct.add(t.split(".")[0]);
    for (const t of [...herite]) herite.add(t.split(".")[0]);
    for (const t of direct) herite.delete(t);
    return { direct: [...direct].sort(), herite: [...herite].sort() };
}

/* ------------------------------------------------------------- programme */

const argFlux = process.argv.indexOf("--flux");
const dossierFlux = argFlux !== -1 ? process.argv[argFlux + 1] : null;
if (argFlux !== -1 && !dossierFlux) throw new Error("--flux attend un chemin de dossier");

console.log("Catalogue CWE…");
const cweXml = dezipper(await telecharger(CWE_URL));
const versionCwe = /<Weakness_Catalog[^>]*\bVersion="([^"]+)"/.exec(cweXml)?.[1] ?? "inconnue";
console.log(`  CWE v${versionCwe}, ${(cweXml.length / 1048576).toFixed(1)} Mo`);

console.log("Catalogue CAPEC…");
const capecXml = dezipper(await telecharger(CAPEC_URL));
const capecTech = capecVersTechniques(capecXml);
const capecTotal = [...capecXml.matchAll(/<Attack_Pattern\b[^>]*\bID="\d+"/g)].length;
console.log(`  ${capecTech.size} CAPEC sur ${capecTotal} portent une correspondance ATT&CK`);

const { table: parCwe, cwes: cweTotal } = cweVersTechniques(cweXml, capecTech);
console.log(`  ${parCwe.size} CWE sur ${cweTotal} mènent à au moins une technique`);

/* --- lecture des millésimes --- */

const anneeCourante = new Date().getUTCFullYear();
const millesimes = [];
for (let a = PREMIER_FLUX; a <= anneeCourante; a++) millesimes.push(a);

// Un cache local évite de retélécharger 200 Mo à chaque essai. Il n'est utilisé
// que si `--flux` le désigne : par défaut on prend ce que le NVD publie.
const cache = dossierFlux ? resolve(process.cwd(), dossierFlux) : null;
if (cache && !existsSync(cache)) mkdirSync(cache, { recursive: true });

const parAnnee = new Map();
let luesTotal = 0;
let sansCwe = 0;

for (const annee of millesimes) {
    let brut;
    const local = cache ? `${cache}/${annee}.json.gz` : null;
    if (local && existsSync(local)) {
        brut = readFileSync(local);
    } else {
        process.stdout.write(`Flux NVD ${annee}… `);
        brut = await telecharger(NVD_FLUX(annee));
        if (local) writeFileSync(local, brut);
        console.log(`${(brut.length / 1048576).toFixed(1)} Mo`);
    }

    const flux = JSON.parse(gunzipSync(brut).toString("utf8"));
    for (const { cve } of flux.vulnerabilities ?? []) {
        luesTotal++;
        const cwes = cwesDuCve(cve);
        if (!cwes.length) { sansCwe++; continue; }

        const { direct, herite } = techniquesDeCwes(cwes, parCwe);
        if (!direct.length && !herite.length) continue;

        const m = /^CVE-(\d{4})-(\d+)$/.exec(cve.id);
        if (!m) continue;                       // identifiant hors forme : on ne l'indexe pas
        if (!parAnnee.has(m[1])) parAnnee.set(m[1], []);
        parAnnee.get(m[1]).push([Number(m[2]), direct, herite]);
    }
}
console.log(`\n${luesTotal} CVE lues, ${sansCwe} sans CWE exploitable`);

/* --- encodage --- */

// Dictionnaire des techniques : un identifiant s'écrit une fois, et les couples
// n'en portent que le rang.
const rangTechnique = new Map();
const techniques = [];
const rang = t => {
    let i = rangTechnique.get(t);
    if (i === undefined) { i = techniques.length; rangTechnique.set(t, i); techniques.push(t); }
    return i;
};

const rangCouple = new Map();
const couples = [];
const years = {};
let indexees = 0;

for (const [annee, liste] of [...parAnnee].sort()) {
    const seaux = new Map();
    for (const [num, direct, herite] of liste) {
        const cle = `${direct.join(",")}|${herite.join(",")}`;
        let i = rangCouple.get(cle);
        if (i === undefined) {
            i = couples.length;
            rangCouple.set(cle, i);
            couples.push([direct.map(rang), herite.map(rang)]);
        }
        if (!seaux.has(i)) seaux.set(i, []);
        seaux.get(i).push(num);
        indexees++;
    }
    const obj = {};
    for (const [i, nums] of [...seaux].sort((a, b) => a[0] - b[0])) obj[i] = nums.sort((a, b) => a - b);
    years[annee] = obj;
}

const data = {
    generated: new Date().toISOString(),
    cwe: versionCwe,
    counts: { read: luesTotal, indexed: indexees, sets: couples.length, techniques: techniques.length },
    techniques,
    sets: couples,
    years,
};

console.log(`${indexees} CVE menant à au moins une technique`);
console.log(`${couples.length} couples (direct, hérité) distincts, ${techniques.length} techniques citées`);

/* Comme pour attack-data.js : le JSON est posé dans une chaîne plutôt qu'en
   littéral d'objet, `JSON.parse` étant nettement plus rapide que l'analyse du
   même contenu écrit en JavaScript. */
const charge = JSON.stringify(data).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

writeFileSync(OUT, `/* Généré par tools/build-cve.mjs — ne pas modifier à la main.

   Table « CVE -> techniques ATT&CK », dérivée le ${data.generated}
   de trois publications officielles : les flux JSON 2.0 du NVD, le catalogue
   CWE v${versionCwe} et le catalogue CAPEC.

   ${indexees} CVE indexées sur ${luesTotal} lues, réparties en ${couples.length} couples
   (techniques directes, techniques héritées) et ${techniques.length} techniques citées.

   Ce fichier n'est pas chargé au démarrage : js/cve.js l'importe à la première
   CVE saisie. Voir l'en-tête de tools/build-cve.mjs pour la chaîne de jointure
   et pour ce que « hérité » veut dire.

   Pour régénérer :  node tools/build-cve.mjs */
export default JSON.parse('${charge}');
`);

const octets = readFileSync(OUT).length;
console.log(`\n${OUT} — ${(octets / 1048576).toFixed(2)} Mo`);
