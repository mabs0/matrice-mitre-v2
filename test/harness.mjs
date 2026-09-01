/* Banc d'essai headless : jsdom + un mini-bundle ATT&CK synthétique.
   Vérifie que l'application démarre, que les trois vues se rendent, que le
   questionnaire alimente la matrice et que l'export/import fait un aller-retour. */

import { JSDOM } from "jsdom";
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodeCrypto from "node:crypto";
import ExcelJS from "exceljs";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Le banc tourne depuis test/ ; la racine du projet est le dossier parent.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let checks = 0;
const ok = (label, cond, extra = "") => {
    checks++;
    if (cond) console.log(`  ✓ ${label}${extra ? " — " + extra : ""}`);
    else { failures++; console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`); }
};

/* ---------------------------------------------- mini-bundle ATT&CK synthétique */

const tac = (id, name, shortname) => ({
    type: "x-mitre-tactic", id: `tactic--${id}`, name, x_mitre_shortname: shortname,
    external_references: [{ source_name: "mitre-attack", external_id: `TA00${id}`, url: "u" }],
});
const pat = (id, name, phases, platforms, sub = false) => ({
    type: "attack-pattern", id: `attack-pattern--${id}`, name,
    x_mitre_is_subtechnique: sub, x_mitre_platforms: platforms,
    description: `Description de ${name}.`,
    kill_chain_phases: phases.map(p => ({ kill_chain_name: "mitre-attack", phase_name: p })),
    external_references: [{ source_name: "mitre-attack", external_id: id, url: `https://attack.mitre.org/techniques/${id}` }],
});
const coa = (id, name) => ({
    type: "course-of-action", id: `course-of-action--${id}`, name, description: `Mitigation ${name}.`,
    external_references: [{ source_name: "mitre-attack", external_id: id, url: "u" }],
});
const rel = (src, dst) => ({
    type: "relationship", id: `relationship--${src}-${dst}`, relationship_type: "mitigates",
    source_ref: `course-of-action--${src}`, target_ref: `attack-pattern--${dst}`,
});

const bundle = {
    objects: [
        {
            type: "x-mitre-matrix", id: "x-mitre-matrix--1", name: "Enterprise ATT&CK",
            tactic_refs: ["tactic--02", "tactic--01"],     // ordre volontairement non alphabétique
            external_references: [{ source_name: "mitre-attack", external_id: "enterprise-attack", url: "u" }],
        },
        tac("01", "Credential Access", "credential-access"),
        tac("02", "Initial Access", "initial-access"),
        pat("T1078", "Valid Accounts", ["initial-access"], ["Windows", "Linux", "SaaS"]),
        pat("T1078.001", "Default Accounts", ["initial-access"], ["Windows"], true),
        pat("T1110", "Brute Force", ["credential-access"], ["Windows", "Linux"]),
        pat("T1555", "Credentials from Password Stores", ["credential-access"], ["macOS"]),
        pat("T9999", "Technique sans mitigation", ["initial-access"], ["Linux"]),
        // Quelques mitigations du catalogue, dont la première, plus celle qui
        // n'a pas de questionnaire.
        coa("M1013", "Application Developer Guidance"),   // première du catalogue
        coa("M1016", "Vulnerability Scanning"),
        coa("M1018", "User Account Management"),
        coa("M1027", "Password Policies"),
        coa("M1032", "Multi-factor Authentication"),
        coa("M1049", "Antivirus/Antimalware"),
        coa("M1055", "Do Not Mitigate"),             // seule mitigation sans questionnaire
        rel("M1032", "T1078"),
        rel("M1018", "T1078"),                       // T1078 couverte par deux mitigations notées
        rel("M1016", "T1078"),
        rel("M1013", "T1078"),                       // et par la première du catalogue
        rel("M1032", "T1110"),
        rel("M1027", "T1110"),
        rel("M1055", "T1110"),
        rel("M1032", "T1555.001"),   // cible inexistante : doit être ignorée proprement
    ],
};

const index = {
    collections: [{
        name: "Enterprise ATT&CK", id: "c1",
        versions: [
            { version: "19.1", url: "https://fake/enterprise-19.1.json", modified: "2026-05-12T14:00:00Z" },
            { version: "19.0", url: "https://fake/enterprise-19.0.json", modified: "2026-04-28T14:00:00Z" },
            { version: "9.0", url: "https://fake/enterprise-9.0.json", modified: "2021-04-29T14:00:00Z" },
        ],
    }],
};

/* ------------------------------------- l'application, sur un jeu d'essai réduit

   Les données ne sont plus téléchargées : `js/attack-data.js` est un module
   généré, importé statiquement par `attack.js`. Pour éprouver l'application sur
   le mini-bundle ci-dessus plutôt que sur les 222 techniques réelles, on fait
   tourner les modules depuis une copie temporaire de `js/` dont seul ce fichier
   est remplacé. Rien n'est injecté dans le code de production, et le fichier
   généré du dépôt n'est jamais touché.

   La réduction est faite par `reduire()`, importée du générateur lui-même : ce
   que les tests exercent est donc exactement la transformation qui produit le
   fichier publié, et non une seconde implémentation qui pourrait diverger. */

const { reduire } = await import(`${ROOT}/tools/build-attack.mjs`);

const APP = mkdtempSync(resolve(tmpdir(), "maptrix-banc-"));
process.on("exit", () => { try { rmSync(APP, { recursive: true, force: true }); } catch {} });
cpSync(`${ROOT}/js`, `${APP}/js`, { recursive: true });

const RELEASE = index.collections[0].versions[0];      // 19.1, la plus récente du faux index
const DONNEES = reduire(bundle, RELEASE);
writeFileSync(`${APP}/js/attack-data.js`,
              `export default ${JSON.stringify(DONNEES)};\n`);

/* ------------------------------------------------------------------- jsdom */

const html = readFileSync(`${ROOT}/index.html`, "utf8")
    .replace(/<script[^>]*><\/script>/g, "");         // les scripts sont injectés en globals

const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
const { window } = dom;

for (const key of ["window", "document", "HTMLElement", "Node", "Event", "CustomEvent",
                   "getComputedStyle", "requestAnimationFrame", "localStorage", "Blob", "File", "FileReader",
                   "XMLSerializer"]) {
    try { globalThis[key] = window[key]; } catch { /* propriété en lecture seule dans node */ }
}
/* jsdom 26.1 n'implémente ni `Blob.text()` ni `Blob.arrayBuffer()` — ni sur un
   File, ni sur une tranche obtenue par `slice()`. Ce sont des API standard, que
   tous les navigateurs visés fournissent depuis des années et sur lesquelles
   l'application s'appuie légitimement : on complète l'environnement de test au
   lieu de contorsionner le code. `FileReader`, lui, est bien là. */
{
    const lire = (blob, forme) => new Promise((resolve, reject) => {
        const fr = new window.FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        if (forme === "texte") fr.readAsText(blob);
        else fr.readAsArrayBuffer(blob);
    });
    for (const proto of [window.Blob.prototype, window.File.prototype]) {
        if (!proto.text) proto.text = function () { return lire(this, "texte"); };
        if (!proto.arrayBuffer) proto.arrayBuffer = function () { return lire(this, "octets"); };
    }
}

/* jsdom ne fournit ni `crypto.subtle` ni `btoa`/`atob` sur son window. Ce sont
   des API standard, présentes dans tous les navigateurs visés, et `js/crypto.js`
   s'appuie dessus : on complète l'environnement de test plutôt que de tordre le
   code. WebCrypto vient de node, qui est la même implémentation d'algorithme —
   ce que le banc vérifie est le format et la logique, pas la primitive. */
for (const [nom, valeur] of [
    ["crypto", nodeCrypto.webcrypto],
    ["btoa", b => Buffer.from(b, "binary").toString("base64")],
    ["atob", b => Buffer.from(b, "base64").toString("binary")],
]) {
    // `window.crypto` n'a qu'un accesseur en lecture dans jsdom : on le
    // redéfinit, plutôt que d'affecter dessus.
    // `crypto` n'a qu'un accesseur en lecture, sur le window de jsdom comme sur
    // le global de node : on le redéfinit, plutôt que d'affecter dessus.
    for (const cible of [window, globalThis]) {
        Object.defineProperty(cible, nom, { value: valeur, configurable: true, writable: true });
    }
}

globalThis.URL.createObjectURL = () => "blob:fake";
globalThis.URL.revokeObjectURL = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {} });
window.alert = () => {};
window.confirm = () => true;
window.prompt = () => "";
/* `loadExcel()` rend la bibliothèque déjà posée sur `globalThis` sans rien
   demander au réseau : on est alors exactement dans l'état du navigateur après
   son chargement, et le chemin d'import complet devient éprouvable ici. */
globalThis.ExcelJS = ExcelJS;

/* Le démarrage ne fait plus aucune requête : le référentiel est embarqué, et la
   bibliothèque Excel est posée en global ci-dessus. Toute sortie réseau serait
   donc une régression — on la piège plutôt que de la servir. */
const fetched = [];
globalThis.fetch = async (url, opts) => {
    fetched.push({ url: String(url), cache: opts?.cache });
    throw new Error(`requête réseau inattendue : ${url}`);
};

/* --------------------------------------------------------------- démarrage */

console.log("\n[1] Démarrage et chargement des données");
await import(`${APP}/js/main.js`);
await new Promise(r => setTimeout(r, 60));

/* Le référentiel est embarqué : le démarrage ne doit toucher au réseau ni pour
   l'index des versions, ni pour le bundle. C'est la propriété qui fait tenir les
   0,4 s de démarrage derrière un proxy qui décompresse tout, et rien d'autre
   dans le banc ne la surveillerait. */
ok("aucune requête réseau au démarrage", fetched.length === 0,
   fetched.map(f => f.url).join(", "));
ok("la version affichée vient du fichier généré", DONNEES.version === "19.1", DONNEES.version);
ok("écran de chargement retiré", !window.document.getElementById("boot"));
ok("badge de version renseigné",
   window.document.getElementById("version-text").textContent.includes("19.1"));

/* ------------------------------------------------------------- page d'accueil */

console.log("\n[2] Page d'accueil");
const home = window.document.getElementById("view-home");
ok("accueil visible", !home.classList.contains("hidden"));
ok("bouton « Créer un layer » présent", !!window.document.getElementById("home-new"));
ok("zone d'import présente", !!window.document.getElementById("home-drop"));
// Les trois chiffres ont quitté le haut de page : ils meublaient sans rien
// apprendre à qui arrive. Ce qu'ils vérifiaient, en revanche, reste vrai et se
// vérifie à la source — sur le référentiel normalisé, pas sur le markup qui
// l'affichait.
//
// T9999 n'a aucune relation ; T1555 en a une, mais vers T1555.001 qui n'existe
// pas dans ce mini-bundle : elle doit être ignorée, donc deux techniques se
// retrouvent sans mitigation.
// `DONNEES` est le bundle réduit tel qu'il est écrit dans `attack-data.js` ;
// les décomptes, eux, naissent de la normalisation. C'est elle qu'on interroge.
const normalise = await (await import(`${APP}/js/attack.js`)).loadAttack();
const compte = [normalise.counts.mitigations, normalise.counts.techniques,
                normalise.counts.subTechniques].join("/");
ok("chiffres calculés", compte === "7/4/1", `mitigations/techniques/sous-techniques = ${compte}`);
// La relation de T1555 pointe vers T1555.001, absente du mini-bundle : elle doit
// être ignorée plutôt que de créer une sous-technique fantôme.
ok("relation vers une cible inexistante ignorée", normalise.counts.subTechniques === 1,
   String(normalise.counts.subTechniques));
ok("et le haut de page ne les affiche plus",
   !home.querySelector(".home-figures") && !home.querySelector(".figure"));

/* -------------------------------------------------------------- matrice vierge */

console.log("\n[3] Matrice avant toute réponse");
window.document.getElementById("home-explore").click();
const grid = window.document.getElementById("matrix-grid");
ok("matrice construite", !!grid);
ok("une colonne par tactique", grid.querySelectorAll(".tactic-col").length === 2);
const heads = [...grid.querySelectorAll(".tactic-head .t-name")].map(n => n.textContent.trim());
ok("ordre des tactiques issu de tactic_refs", heads.join(" | ") === "Initial Access | Credential Access", heads.join(" | "));
ok("technique sans mitigation hachurée",
   grid.querySelector('[data-tech="T9999"]')?.classList.contains("no-mitigation"));
ok("technique couverte mais non évaluée en neutre",
   grid.querySelector('[data-tech="T1078"]')?.classList.contains("unscored"));
ok("légende complète", window.document.querySelectorAll("#matrix-legend .legend-item").length === 7);

/* ----------------------------------------------------------- filtre plateforme */

console.log("\n[4] Filtre plateforme");
const macBox = [...window.document.querySelectorAll("#platform-panel input[data-platform]")]
    .find(cb => cb.dataset.platform === "macOS");
ok("plateformes listées depuis les données",
   [...window.document.querySelectorAll("#platform-panel input[data-platform]")]
       .map(cb => cb.dataset.platform).join(",") === "Linux,macOS,SaaS,Windows");
for (const cb of window.document.querySelectorAll("#platform-panel input[data-platform]")) {
    if (cb !== macBox) { cb.checked = false; cb.dispatchEvent(new window.Event("change")); }
}
const visible = [...window.document.querySelectorAll("#matrix-grid .cell")].map(c => c.dataset.tech);
ok("seule la technique macOS reste", visible.join(",") === "T1555", visible.join(",") || "aucune");
macBox.checked = true;
for (const cb of window.document.querySelectorAll("#platform-panel input[data-platform]")) {
    cb.checked = true; cb.dispatchEvent(new window.Event("change"));
}

/* -------------------------------------------------------------- questionnaire */

console.log("\n[5] Questionnaire sur tout le catalogue");
const { CATALOG: CAT, QUESTIONNAIRES: QST, totalQuestions } =
    await import(`${APP}/js/catalog.js`);
ok("le catalogue couvre les 44 mitigations du référentiel", CAT.size === 44, CAT.size);
ok("une seule est sans questionnaire", CAT.size - QST.size === 1,
   [...CAT.keys()].filter(id => !QST.has(id)).join(","));
window.document.getElementById("brand").click();
window.document.getElementById("home-new").click();
window.document.getElementById("nl-name").value = "Test";
window.document.getElementById("nl-ok").click();

const openMitigation = () => window.document.querySelector(".quiz-tag")?.textContent.trim();
ok("on démarre sur la première mitigation du catalogue",
   openMitigation() === [...QST.keys()][0], openMitigation());

/** Répond « Oui » partout et enchaîne les mitigations, pauses comprises. */
function answerAllYes(limit = totalQuestions() + QST.size + 30) {
    const visited = [];
    const pauses = [];
    for (let i = 0; i < limit; i++) {
        const tag = openMitigation();
        const yes = window.document.querySelector('[data-answer="Oui"]');
        if (yes) { if (!visited.includes(tag)) visited.push(tag); yes.click(); continue; }
        const next = window.document.getElementById("r-next");
        if (next) { next.click(); continue; }
        // Toutes les cinq mitigations, un écran de pause s'intercale entre le
        // résultat et la mitigation suivante.
        const carryOn = window.document.getElementById("p-continue");
        if (carryOn) { pauses.push(visited.length); carryOn.click(); continue; }
        break;
    }
    return { visited, pauses };
}
const { visited, pauses } = answerAllYes();

/* La pause, dans l'esprit du « vous regardez toujours ? » : sur quarante-trois
   mitigations, le parcours devient une chaîne qu'on déroule sans plus regarder
   ce qu'elle produit. Deux propositions, pas une de plus — l'écran est là pour
   souffler, pas pour poser une décision de plus. */
ok("une pause s'intercale toutes les cinq mitigations",
   pauses.length === Math.floor(QST.size / 5) && pauses.every(n => n % 5 === 0),
   `pauses après ${pauses.join(", ")} mitigations`);
ok(`les ${QST.size} mitigations évaluables ont été parcourues`, visited.length === QST.size,
   `${visited.length} visitées`);
ok("dans l'ordre du catalogue, sans passer par celle sans questionnaire",
   visited.join(",") === [...QST.keys()].join(","));

const badge = window.document.querySelector(".result-badge");
ok("écran de résultat affiché", !!badge);
ok("niveau 4 atteint sur la dernière", badge?.textContent.trim() === "4", badge?.textContent.trim());
ok("l'onglet indique tout traité",
   window.document.querySelector(".layer-tab .pct")?.textContent === `${QST.size}/${QST.size}`,
   window.document.querySelector(".layer-tab .pct")?.textContent);
ok("plus de bouton « Mitigation suivante »", !window.document.getElementById("r-next"));

/* --------------------------------------------------- report dans la matrice */

console.log("\n[6] Report du score dans la matrice");
window.document.getElementById("r-matrix").click();
const g2 = window.document.getElementById("matrix-grid");
ok("T1078 (M1032 et M1018, toutes deux à 4) en niveau 4",
   g2.querySelector('[data-tech="T1078"]')?.classList.contains("lvl-4"));
ok("T1110 (deux notées à 4 + une sans questionnaire) en niveau 4",
   g2.querySelector('[data-tech="T1110"]')?.classList.contains("lvl-4"));
ok("T9999 toujours sans mitigation",
   g2.querySelector('[data-tech="T9999"]')?.classList.contains("no-mitigation"));

console.log("\n[7] Méthodes de notation et d'agrégation");
const setRadio = (name, value) => {
    const r = [...window.document.querySelectorAll(`#method-panel input[name="${name}"]`)]
        .find(x => x.value === value);
    r.checked = true; r.dispatchEvent(new window.Event("change"));
};
const levelClassOf = tech => [...window.document.querySelector(`[data-tech="${tech}"]`).classList]
    .find(c => c.startsWith("lvl-")) ?? "aucun";

setRadio("scoring", "cumulative");
ok("cumulatif strict : T1078 reste en 4 (tous les paliers sont « Oui »)",
   levelClassOf("T1078") === "lvl-4", levelClassOf("T1078"));

setRadio("scoring", "average");
ok("moyenne des questions : le niveau baisse", levelClassOf("T1078") !== "lvl-4",
   levelClassOf("T1078"));
setRadio("scoring", "last-yes");

// On abaisse une seule des deux mitigations de T1078, via « Modifier ma
// réponse » — ce qui exerce aussi ce bouton — pour rendre l'agrégation visible.
window.document.querySelector('[data-tech="T1078"]').click();
const editM1018 = [...window.document.querySelectorAll("#modal-panel [data-edit]")]
    .find(b => b.dataset.edit === "M1018");
ok("« Modifier ma réponse » disponible pour M1018", !!editM1018);
editM1018.click();
ok("le questionnaire s'ouvre bien sur M1018", openMitigation() === "M1018", openMitigation());
window.document.querySelector('[data-answer="Non"]').click();     // M1018 retombe à 0
window.document.getElementById("r-matrix").click();

// T1078 est couverte par quatre mitigations notées ; une seule retombe à 0,
// donc la moyenne vaut (4 + 4 + 4 + 0) / 4 = 3.
ok("moyenne de 4, 4, 4 et 0 : T1078 passe en niveau 3", levelClassOf("T1078") === "lvl-3",
   levelClassOf("T1078"));
setRadio("aggregation", "min");
ok("minimum : T1078 tombe au niveau 0", levelClassOf("T1078") === "lvl-0", levelClassOf("T1078"));
setRadio("aggregation", "max");
ok("maximum : T1078 remonte au niveau 4", levelClassOf("T1078") === "lvl-4", levelClassOf("T1078"));
setRadio("aggregation", "average");
ok("T1110 inchangée (M1018 ne la couvre pas)", levelClassOf("T1110") === "lvl-4",
   levelClassOf("T1110"));

/* ------------------------------------------------------- modale d'une technique */

console.log("\n[8] Modale d'une technique");
window.document.querySelector('[data-tech="T1110"]').click();
const panel = window.document.getElementById("modal-panel");
ok("modale ouverte", window.document.getElementById("modal").classList.contains("open"));
ok("les trois mitigations de T1110 sont listées", panel.querySelectorAll(".mit-row").length === 3,
   `${panel.querySelectorAll(".mit-row").length} lignes`);
ok("une note par mitigation notée", panel.querySelectorAll(".mit-note").length === 2,
   `${panel.querySelectorAll(".mit-note").length} notes`);

// Un nom long ne doit pas pousser l'action hors de sa colonne : c'est le nom qui
// se tronque, et il reste lisible en infobulle.
{
    const names = [...panel.querySelectorAll(".mit-row .m-name")];
    ok("chaque nom de mitigation porte son intitulé complet en infobulle",
       names.length > 0 && names.every(n => n.getAttribute("title") === n.textContent),
       names.map(n => n.getAttribute("title")).join(" | "));

    const matrixCss = readFileSync(`${ROOT}/css/matrix.css`, "utf8");
    const nameRule = /\.mit-row\s+\.m-name\s*\{([^}]*)\}/.exec(matrixCss)?.[1] ?? "";
    ok("le nom se tronque plutôt que de s'étaler",
       /min-width:\s*0/.test(nameRule) && /text-overflow:\s*ellipsis/.test(nameRule) &&
       /white-space:\s*nowrap/.test(nameRule), nameRule.replace(/\s+/g, " ").trim());
    ok("l'action ne se rétrécit jamais, elle garde l'alignement de la colonne",
       /\.mit-row\s*>\s*\.btn,\s*\.mit-row\s*>\s*\.tag\s*\{[^}]*flex:\s*0 0 auto/.test(matrixCss));
}
ok("bouton « Modifier ma réponse » présent",
   [...panel.querySelectorAll("[data-edit]")].some(b => b.textContent.includes("Modifier")));
ok("la mitigation sans questionnaire est signalée, pas notée",
   panel.textContent.includes("rien à évaluer"));

/* -------------------------------------------------------- aller-retour fichier */

console.log("\n[9] Aller-retour export / import");
const { toJSON, fromJSON, progress } = await import(`${APP}/js/layer.js`);
const { buildMatrixScores, mitigationLevels } = await import(`${APP}/js/scoring.js`);

// À partir d'ici, CATALOG désigne le catalogue de travail : les mitigations
// évaluables, celles que le layer parcourt réellement.
const { QUESTIONNAIRES: CATALOG } = await import(`${APP}/js/catalog.js`);
const rebuilt = fromJSON(toJSON({
    schema: "ctrm-layer/1", name: "Test", created: "", modified: "", attackVersion: "19.1",
    respondent: { name: "M", org: "O", email: "e" }, scoring: "last-yes", aggregation: "average",
    answers: { M1032: Object.fromEntries([1,2,3,4,5,6,7].map(n => [n, { value: "Oui", tool: "Entra ID" }])) },
    cursor: { mitigation: "M1032", question: 7 }, catalog: CATALOG,
}));
ok("JSON relu sans perte", progress(rebuilt).answered === 7);
ok("l'outil saisi survit à l'aller-retour", rebuilt.answers.M1032[1].tool === "Entra ID");
ok("le catalogue n'est pas sérialisé", !toJSON(rebuilt).includes('"questions"'));

// Excel : export, écriture réelle du fichier, puis réimport depuis les octets.
// Passer par le buffer et non par l'objet en mémoire est le seul moyen de
// vérifier que ce qui est *écrit* se relit.
const { buildWorkbook, readWorkbook } = await import(`${APP}/js/excel.js`);
const fauxData = {
    version: "19.1",
    mitigations: [{ id: "M1032", name: "MFA", techniques: ["T1078"] }],
    tactics: [{ name: "Initial Access", shortname: "initial-access" }],
    byTactic: new Map([["initial-access", [{ id: "T1078", name: "Valid Accounts" }]]]),
    subTechniques: [{ id: "T1078.001", name: "Default Accounts" }],
};
const wb = buildWorkbook(ExcelJS, rebuilt, fauxData,
    new Map([["T1078", { state: "scored", score: 4, level: 4, mitigations: [{ id: "M1032", level: 4 }] }]]),
    mitigationLevels(rebuilt));
ok("classeur à cinq feuilles",
   wb.worksheets.map(w => w.name).join(",") === "Réponses,Mitigations,Techniques,Matrice,Métadonnées",
   wb.worksheets.map(w => w.name).join(","));

const octets = await wb.xlsx.writeBuffer();
const relu = new ExcelJS.Workbook();
await relu.xlsx.load(octets);
const back = readWorkbook(relu, { name: "Relu" });
ok("Excel relu sans perte", progress(back).answered === 7);
ok("l'outil survit au passage par Excel", back.answers.M1032[1].tool === "Entra ID");

// Les colonnes sont retrouvées par leur intitulé : en insérer une en tête ne
// doit pas casser la relecture.
{
    const decale = new ExcelJS.Workbook();
    await decale.xlsx.load(octets);
    decale.getWorksheet("Réponses").spliceColumns(1, 0, ["Commentaire"]);
    ok("une colonne insérée ne casse pas la relecture",
       progress(readWorkbook(decale, { name: "Décalé" })).answered === 7);
}

// Un classeur exporté avant que « Numéro » devienne « N° » doit continuer à se
// relire : les fichiers déjà entre les mains des gens ne se renomment pas.
{
    const ancien = new ExcelJS.Workbook();
    const ws = ancien.addWorksheet("Réponses");
    ws.addRow(["Mitigation", "Numéro", "Réponse", "Outil (si applicable)"]);
    ws.addRow(["M1032", 1, "Oui", "Entra ID"]);
    const repris = readWorkbook(ancien, { name: "Ancien" });
    ok("un classeur à l'ancien intitulé « Numéro » se relit encore",
       repris.answers.M1032?.[1]?.value === "Oui" &&
       repris.answers.M1032?.[1]?.tool === "Entra ID",
       JSON.stringify(repris.answers));
}

// Un classeur qui n'est pas le nôtre doit être refusé clairement, et non lu au
// prix de suppositions sur sa disposition de cellules.
const foreign = new ExcelJS.Workbook();
foreign.addWorksheet("M1032").addRow(["Numéro", "Question"]);
let refusal = null;
try { readWorkbook(foreign, { name: "Étranger" }); } catch (err) { refusal = err.message; }
ok("un classeur étranger est refusé", refusal !== null, refusal);
// Le message affiché reste court. « Feuille "Réponses" absente. Attendu : un
// classeur exporté par cet outil. » décrivait la structure interne du fichier
// produit — sans intérêt pour qui vient de déposer le mauvais document, et
// intimidant. Le détail part en console, où il sert à diagnostiquer.
ok("et le message reste lisible par qui n'a pas ouvert le classeur",
   refusal === "format non pris en charge", refusal);

// Une feuille « Réponses » présente mais vide de réponses exploitables.
const emptySheet = new ExcelJS.Workbook();
const vide = emptySheet.addWorksheet("Réponses");
vide.addRow(["Mitigation", "Numéro", "Réponse"]);
vide.addRow(["M1032", 1, "Peut-être"]);
let emptyError = null;
try { readWorkbook(emptySheet, { name: "Vide" }); } catch (err) { emptyError = err.message; }
// Distinct du cas précédent : le fichier est bien du bon format, il n'y a
// simplement rien à reprendre. Dire « format non pris en charge » enverrait
// chercher un autre fichier alors que c'est le bon.
ok("une feuille « Réponses » sans réponse valable se distingue d'un format refusé",
   emptyError === "aucune réponse à reprendre dans ce fichier", emptyError);

/* ------------------------------------------------------ JSON chiffré */

console.log("\n[10] Aller-retour JSON chiffré");
const { exportJSON, exportName, readLayerFile, isEncrypted } = await import(`${APP}/js/io.js`);

// On intercepte le téléchargement pour récupérer le contenu produit.
let produced = null;
const RealBlob = window.Blob;
globalThis.Blob = window.Blob = class extends RealBlob {
    constructor(parts, opts) { super(parts, opts); produced = String(parts[0]); }
};

await exportJSON(rebuilt, "cle-de-test");
ok("le JSON chiffré porte l'en-tête reconnaissable", produced?.startsWith("MAPTRIX1:"),
   produced?.slice(0, 12));
ok("le contenu n'est plus lisible en clair", !produced.includes("Entra ID"));

const encFile = new window.File([produced], "layer-chiffre.json", { type: "application/json" });
ok("fichier détecté comme chiffré", await isEncrypted(encFile));
const decrypted = await readLayerFile(encFile, "cle-de-test");
ok("déchiffré et relu sans perte", progress(decrypted).answered === 7);
ok("l'outil survit au chiffrement", decrypted.answers.M1032[1].tool === "Entra ID");

let rejected = "";
try { await readLayerFile(encFile, "mauvaise-cle"); } catch (e) { rejected = e.message; }
ok("mauvaise clé rejetée explicitement", /clé de déchiffrement incorrecte/.test(rejected), rejected);

let noKey = "";
try { await readLayerFile(encFile, ""); } catch (e) { noKey = e.message; }
ok("clé manquante signalée", /chiffré/.test(noKey), noKey);

/* --- ce que le chiffrement doit garantir, et pas seulement « ça revient » --- */
{
    const { PREFIXE, chiffrer, dechiffrer } = await import(`${APP}/js/crypto.js`);

    // Le sel et l'IV sont tirés au sort à chaque export : deux exports du même
    // layer avec la même clé ne se ressemblent pas. Sans cela, une table
    // pré-calculée servirait pour tous les fichiers, et comparer deux exports
    // révélerait qu'ils portent la même évaluation.
    const a = await chiffrer("le même texte", "la même clé");
    const b = await chiffrer("le même texte", "la même clé");
    ok("deux chiffrements du même texte diffèrent", a !== b);
    ok("et se déchiffrent tous les deux",
       (await dechiffrer(a, "la même clé")) === "le même texte" &&
       (await dechiffrer(b, "la même clé")) === "le même texte");

    /* AES-GCM scelle le fichier. Un octet changé en chemin doit faire échouer le
       déchiffrement, et non rendre une évaluation aux réponses modifiées sans
       que personne ne s'en aperçoive — c'est ce que faisait le mode précédent,
       qui brouillait sans authentifier. */
    const corps = a.slice(PREFIXE.length);
    const i = Math.floor(corps.length / 2);
    const altere = PREFIXE + corps.slice(0, i) + (corps[i] === "A" ? "B" : "A") + corps.slice(i + 1);
    let scelle = "";
    try { await dechiffrer(altere, "la même clé"); } catch (e) { scelle = e.message; }
    ok("un fichier modifié en chemin est refusé", scelle !== "", scelle);

    // Un corps tronqué ne doit pas lever une exception technique brute.
    let tronque = "";
    try { await dechiffrer(PREFIXE + "AAAA", "la même clé"); } catch (e) { tronque = e.message; }
    ok("un fichier tronqué donne le même message qu'une mauvaise clé",
       tronque === "clé de déchiffrement incorrecte", tronque);

    /* Les paramètres sont ce qui fait la solidité : une clé de déchiffrement est
       une phrase choisie par une personne, donc devinable, et tout l'enjeu est
       de rendre chaque essai coûteux. 600 000 itérations est la valeur
       recommandée par l'OWASP pour PBKDF2-HMAC-SHA256. Les baisser ne casserait
       aucun test de bout en bout — d'où cette vérification directe. */
    const src = readFileSync(`${ROOT}/js/crypto.js`, "utf8");
    const iterations = Number(/ITERATIONS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ""));
    ok("PBKDF2 tourne au moins 600 000 fois", iterations >= 600_000, String(iterations));
    ok("la dérivation est en SHA-256, pas en SHA-1", /hash: "SHA-256"/.test(src));
    ok("le chiffrement est authentifié (AES-GCM)",
       /name: "AES-GCM"/.test(src) && !/AES-CBC|AES-CTR/.test(src));
    ok("la clé fait 256 bits", /length: 256/.test(src));
    ok("le sel fait au moins 16 octets", Number(/TAILLE_SEL = (\d+)/.exec(src)?.[1]) >= 16);

    /* Plus aucune bibliothèque de chiffrement : WebCrypto est fourni par le
       navigateur, donc rien à télécharger et rien à remplacer en vol. */
    const sources = ["index.html", ...readdirSync(`${ROOT}/js`).filter(f => f.endsWith(".js")).map(f => `js/${f}`)];
    const restes = sources.filter(f => /CryptoJS|crypto-js/.test(readFileSync(`${ROOT}/${f}`, "utf8")));
    ok("aucune bibliothèque de chiffrement n'est chargée depuis un CDN",
       restes.length === 0, restes.join(", "));
}

// Export en clair : toujours possible, mais il faut le demander.
await exportJSON(rebuilt, "");
ok("l'export en clair reste ré-importable", produced.includes("Entra ID"));
globalThis.Blob = window.Blob = RealBlob;

/* ---------------------------------------------- avancement et ordre de parcours */

console.log("\n[11] Avancement et ordre de parcours");
const { questionnaireState, nextTarget, createLayer, setAnswer } = await import(`${APP}/js/layer.js`);
const q1032 = CATALOG.get("M1032");

// Un « Non » à la première question clôt la mitigation : elle est traitée.
const stopped = questionnaireState(q1032, { 1: { value: "Non" } });
ok("« Non » en Q1 clôt le questionnaire", stopped.complete && stopped.answered === 1);

const halfway = questionnaireState(q1032, { 1: { value: "Oui" }, 2: { value: "Oui" } });
ok("parcours interrompu = non traité", !halfway.complete && halfway.nextNum === 3,
   `nextNum=${halfway.nextNum}`);

const naDoesNotStop = questionnaireState(q1032, { 1: { value: "N/A" } });
ok("« N/A » ne clôt pas", !naDoesNotStop.complete && naDoesNotStop.nextNum === 2);

const layerNon = createLayer({ name: "Non en Q1" });
setAnswer(layerNon, "M1032", 1, { value: "Non" });
ok("une mitigation close par un « Non » compte comme traitée",
   progress(layerNon).completeMitigations === 1 && progress(layerNon).pct === Math.round(100 / CATALOG.size),
   `${progress(layerNon).completeMitigations}/${progress(layerNon).mitigations} = ${progress(layerNon).pct}%`);
const firstOther = [...CATALOG.keys()].find(id => id !== "M1032");
ok("il reste les mitigations jamais ouvertes", nextTarget(layerNon)?.mitigation === firstOther,
   `${nextTarget(layerNon)?.mitigation} (attendu ${firstOther})`);

// Un « Non » sur une question antérieure efface les réponses devenues
// inatteignables : le parcours progressif ne les aurait jamais posées.
const layerRevise = createLayer({ name: "Révision" });
for (const q of q1032.questions) setAnswer(layerRevise, "M1032", q.num, { value: "Oui" });
const droppedCount = setAnswer(layerRevise, "M1032", 1, { value: "Non" });
ok("les réponses postérieures à un « Non » sont effacées", droppedCount === q1032.questions.length - 1,
   `${droppedCount} effacées`);
ok("le niveau retombe à 0", progress(layerRevise).answered === 1);

// Reprise au bon numéro quand plus rien n'est vierge.
const layerResume = createLayer({ name: "Reprise" });
for (const id of CATALOG.keys()) {
    if (id !== "M1032") setAnswer(layerResume, id, CATALOG.get(id).questions[0].num, { value: "Non" });
}
setAnswer(layerResume, "M1032", 1, { value: "Oui" });     // seule mitigation en cours
const resumeAt = nextTarget(layerResume);
ok("on reprend la mitigation en cours à sa question suivante",
   resumeAt?.mitigation === "M1032" && resumeAt?.question === 2, JSON.stringify(resumeAt));

// Ordre de parcours : les mitigations jamais ouvertes passent devant celles en cours.
const fakeCatalog = new Map([
    ["MA", { id: "MA", name: "A", bareme: [], questions: [{ num: 1, level: 1 }, { num: 2, level: 2 }] }],
    ["MB", { id: "MB", name: "B", bareme: [], questions: [{ num: 1, level: 1 }] }],
]);
const twoLayer = { ...createLayer({ name: "Deux" }), catalog: fakeCatalog };
setAnswer(twoLayer, "MA", 1, { value: "Oui" });          // MA entamée, MB jamais ouverte
ok("on va d'abord sur la mitigation jamais ouverte", nextTarget(twoLayer).mitigation === "MB",
   nextTarget(twoLayer).mitigation);
setAnswer(twoLayer, "MB", 1, { value: "Oui" });          // MB terminée
ok("puis on revient sur celle laissée en cours",
   nextTarget(twoLayer).mitigation === "MA" && nextTarget(twoLayer).question === 2,
   JSON.stringify(nextTarget(twoLayer)));

/* ------------------------------------------- reprise après import et navigation */

console.log("\n[12] Reprise après import, sans exception");
// M1018 et M1027 traitées, M1032 entamée : la reprise doit viser M1032 Q2.
const partialLayer = createLayer({ name: "Partiel" });
for (const id of CATALOG.keys()) {
    if (id !== "M1032") setAnswer(partialLayer, id, CATALOG.get(id).questions[0].num, { value: "Non" });
}
setAnswer(partialLayer, "M1032", 1, { value: "Oui" });
const partialFile = new window.File([toJSON(partialLayer)], "partiel.json", { type: "application/json" });

const errors = [];
window.addEventListener("error", e => errors.push(e.message));
const drop = window.document.getElementById("home-drop");
window.document.getElementById("brand").click();
const dt = { files: [partialFile] };
const dropEvent = new window.Event("drop");
dropEvent.dataTransfer = dt;
drop.dispatchEvent(dropEvent);
await new Promise(r => setTimeout(r, 80));

const toasts = [...window.document.querySelectorAll(".toast")].map(t => t.textContent);
ok("import sans message d'erreur", !toasts.some(t => t.includes("impossible")), toasts.join(" | "));
ok("le questionnaire reprend sur M1032 à la question 2",
   window.document.querySelector(".quiz-tag")?.textContent.trim() === "M1032" &&
   window.document.querySelector(".quiz-card")?.dataset.question === "2",
   window.document.querySelector(".quiz-card")?.dataset.question);

const matrixButton = window.document.getElementById("q-matrix");
ok("« Voir la matrice » est bien câblé avant toute réponse", typeof matrixButton?.onclick === "function");
matrixButton.click();
ok("« Voir la matrice » affiche la matrice", !!window.document.getElementById("matrix-grid"));

/* ------------------------------------------- repère de niveau et navigation arrière */

console.log("\n[13] Frise des niveaux et bouton Précédent");
window.document.getElementById("matrix-quiz").click();
const currentLevelOf = () => {
    const dot = window.document.querySelector(".level-dot.current");
    return dot ? Number(dot.textContent.trim()) : null;
};
const questionLabel = () => window.document.querySelector(".quiz-card").dataset.question;
ok("on est sur la question 2 (niveau visé 2)", questionLabel() === "2" && currentLevelOf() === 2,
   `Q${questionLabel()} niveau ${currentLevelOf()}`);
window.document.getElementById("q-back").click();
ok("Précédent ramène à la question 1", questionLabel() === "1");
ok("le repère de la frise suit la question", currentLevelOf() === 1, `niveau ${currentLevelOf()}`);

/* ---------------------------------------- panneaux déroulants dans l'écran */

console.log("\n[14] Panneaux déroulants");
window.document.getElementById("q-matrix").click();
window.innerWidth = 1280;
for (const id of ["platform", "method", "export"]) {
    window.document.getElementById(`dd-${id}-btn`).click();
    const panel = window.document.getElementById(`${id}-panel`);
    const left = parseFloat(panel.style.left);
    ok(`panneau « ${id} » calé en coordonnées de fenêtre`,
       panel.style.position !== "absolute" && Number.isFinite(left) && left >= 0,
       `left=${panel.style.left} top=${panel.style.top}`);
}
ok("le chiffrement est coché par défaut", window.document.getElementById("ex-crypt")?.checked === true);

/* -------------------------------------------------------------------- thème */

console.log("\n[15] Bascule de thème");
const toggle = window.document.getElementById("theme-toggle");
// Clair par défaut, et posé explicitement plutôt que laissé au réglage du
// système : l'outil produit des captures et des exports qui finissent dans des
// rapports, lesquels sont sur fond blanc.
ok("clair par défaut, quel que soit le réglage du système",
   window.document.documentElement.dataset.theme === "light",
   window.document.documentElement.dataset.theme || "aucun");
toggle.click();
ok("passage en sombre estampillé sur <html>", window.document.documentElement.dataset.theme === "dark");
toggle.click();
ok("retour en clair", window.document.documentElement.dataset.theme === "light");

/* ------------------------------------- import chiffré par l'interface */

console.log("\n[16] Import d'un JSON chiffré depuis l'accueil");
/* Les attentes sont ici bien plus longues qu'ailleurs : déchiffrer demande
   600 000 itérations de PBKDF2, soit environ 0,15 s. C'est voulu — c'est ce
   qui rend un fichier volé coûteux à attaquer — et le banc doit laisser le
   travail se faire au lieu de conclure trop tôt. */
window.document.getElementById("brand").click();       // confirm renvoie true

const encExport = await (async () => {
    let out = null;
    const RB = window.Blob;
    globalThis.Blob = window.Blob = class extends RB {
        constructor(parts, opts) { super(parts, opts); out = String(parts[0]); }
    };
    await exportJSON(partialLayer, "ma-cle");
    globalThis.Blob = window.Blob = RB;
    return out;
})();

const encDrop = window.document.getElementById("home-drop");
const encEvent = new window.Event("drop");
encEvent.dataTransfer = { files: [new window.File([encExport], "chiffre.json", { type: "application/json" })] };
encDrop.dispatchEvent(encEvent);
await new Promise(r => setTimeout(r, 900));

ok("une modale demande la clé", !!window.document.getElementById("dec-pass"));

// Mauvaise clé : message dans la modale, qui reste ouverte pour réessayer.
window.document.getElementById("dec-pass").value = "pas-la-bonne";
window.document.getElementById("dec-ok").click();
await new Promise(r => setTimeout(r, 900));
ok("mauvaise clé signalée sans fermer la modale",
   /incorrecte/.test(window.document.getElementById("dec-error")?.textContent ?? "") &&
   !!window.document.getElementById("dec-pass"),
   window.document.getElementById("dec-error")?.textContent);

// Bonne clé : le layer s'ouvre.
window.document.getElementById("dec-pass").value = "ma-cle";
window.document.getElementById("dec-ok").click();
await new Promise(r => setTimeout(r, 900));
ok("bonne clé : le layer est chargé",
   window.document.querySelector(".layer-tab .name")?.textContent === "Partiel",
   window.document.querySelector(".layer-tab .name")?.textContent);
ok("la modale est refermée", !window.document.getElementById("dec-pass"));

/* ------------------------------------- retour à l'accueil par le logo */

console.log("\n[17] Retour à l'accueil par le logo");
window.document.getElementById("q-matrix")?.click();

let asked = null;
window.confirm = message => { asked = message; return false; };
window.document.getElementById("brand").click();
ok("une confirmation est demandée", /Quitter/.test(asked ?? ""), (asked ?? "").split("\n")[0]);
ok("la confirmation rappelle ce qui sera perdu", /perdues/.test(asked ?? ""));
ok("refuser garde le layer", !!window.document.querySelector(".layer-tab"));

window.confirm = () => true;
window.document.getElementById("brand").click();
ok("accepter revient à l'accueil",
   !window.document.getElementById("view-home").classList.contains("hidden"));
ok("le layer est remis à zéro", !window.document.querySelector(".layer-tab"));

window.document.getElementById("home-explore").click();
ok("la matrice repart vierge",
   !window.document.querySelector(".cell.lvl-4") && !!window.document.getElementById("matrix-grid"));

/* ------------------------------------------ niveau 0 et progression chiffrée */

console.log("\n[18] Le niveau 0 est atteignable");
// Aucune des 327 questions du classeur ne vise le niveau 0 : c'est le plancher
// obtenu quand la première question est « Non », donc sans aucun « Oui ».
const { mitigationLevel } = await import(`${APP}/js/scoring.js`);
const noQuestionAtZero = [...CATALOG.values()]
    .every(m => m.questions.every(q => q.level !== 0));
ok("aucune question ne vise le niveau 0", noQuestionAtZero);

// On lit par résolution : si la première question est commune, la réponse est
// enregistrée chez son porteur et non sous cette mitigation.
const { resolvedEntries } = await import(`${APP}/js/shared-questions.js`);
for (const id of [...CATALOG.keys()]) {
    const questionnaire = CATALOG.get(id);
    const zero = createLayer({ name: `zéro ${id}` });
    setAnswer(zero, id, questionnaire.questions[0].num, { value: "Non" });
    const level = mitigationLevel(questionnaire, resolvedEntries(zero, id), "last-yes");
    ok(`${id} : « Non » à la première question donne le niveau 0`, level === 0, `niveau ${level}`);
}

// Et le niveau 0 s'affiche bien dans l'interface.
window.document.getElementById("brand").click();
window.document.getElementById("home-new").click();
window.document.getElementById("nl-ok").click();
window.document.querySelector('[data-answer="Non"]').click();
const zeroBadge = window.document.querySelector(".result-badge");
ok("le résultat affiche 0", zeroBadge?.textContent.trim() === "0", zeroBadge?.textContent.trim());
ok("le barème du niveau 0 est affiché",
   window.document.querySelector(".result-text")?.textContent
       .includes(CATALOG.get([...CATALOG.keys()][0]).bareme[0].slice(0, 25)));
window.document.getElementById("r-matrix").click();
ok("la case couverte par cette mitigation passe en niveau 0",
   levelClassOf("T1078") === "lvl-0", levelClassOf("T1078"));

console.log("\n[19] Le chargement rend la main sans transfert");
/* Il n'y a plus d'octets à compter : le contrat qui reste est que `main.js`
   reçoive un rapport d'avancement terminé, pour que son écran de démarrage se
   retire au lieu de laisser tourner une barre indéfiniment. */
const { loadAttack, construire } = await import(`${APP}/js/attack.js`);
const seen = [];
const chargees = await loadAttack((msg, ratio) => seen.push({ msg, ratio }));
ok("un avancement est rapporté", seen.length > 0);
ok("les ratios restent dans [0,1]", seen.every(s => s.ratio === undefined || (s.ratio >= 0 && s.ratio <= 1)),
   seen.filter(s => s.ratio !== undefined).map(s => s.ratio.toFixed(2)).join(", "));
ok("le dernier ratio vaut 1", seen.filter(s => s.ratio !== undefined).at(-1).ratio === 1);
ok("la version est annoncée", seen.some(s => /19\.1/.test(s.msg)), seen.map(s => s.msg).join(" | "));
ok("les données sont celles du fichier généré", chargees.version === "19.1");

/* `construire` est le seul endroit où la structure de travail est rebâtie : les
   index dérivés doivent rester d'accord avec les listes plates dont ils sortent,
   sinon la matrice affiche une couverture fausse sans que rien ne le signale. */
{
    const d = construire(DONNEES);
    ok("chaque technique parente est indexée",
       d.techniques.every(t => d.techniqueById.get(t.id) === t));
    ok("les sous-techniques sont indexées avec les parentes",
       d.subTechniques.every(t => d.allTechniqueById.get(t.id) === t)
       && d.allTechniqueById.size === d.techniques.length + d.subTechniques.length);
    ok("la couverture se déduit des rattachements des mitigations",
       [...d.coverage].every(([techId, mits]) =>
           [...mits].every(mId => d.mitigationById.get(mId).techniques
               .some(cible => String(cible).split(".")[0] === techId))));
    ok("une couverture visant une sous-technique remonte à la parente",
       d.coverage.get("T1078")?.has("M1032"));
    ok("les techniques non couvertes sont comptées",
       d.counts.uncovered === d.techniques.filter(t => !d.coverage.has(t.id)).length);
    ok("chaque tactique a sa colonne", d.byTactic.size === d.tactics.length);
}

/* --------------------------------------- robustesse à un HTML plus ancien */

console.log("\n[20] Un HTML en cache ne doit pas casser le chargement");
// Reproduit le cas d'un index.html servi depuis le cache, sans les éléments
// d'affichage récents, alors que les scripts sont à jour.
{
    const stale = readFileSync(`${ROOT}/index.html`, "utf8")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(/<p class="pct" id="boot-pct"><\/p>/, "")
        .replace(/ id="boot-bar"/, "")
        .replace(/<span class="version-badge[\s\S]*?<\/span>/, "");

    const staleDom = new JSDOM(stale, { url: "http://localhost/", pretendToBeVisual: true });
    const previous = { window: globalThis.window, document: globalThis.document };
    globalThis.window = staleDom.window;
    globalThis.document = staleDom.window.document;
    staleDom.window.matchMedia = () => ({ matches: false, addEventListener() {} });

    let thrown = null;
    try {
        const { loadAttack: load } = await import(`${APP}/js/attack.js?stale`);
        const { $: sel } = await import(`${APP}/js/ui.js?stale`);
        // Même rapport d'avancement que dans main.js, sur un DOM incomplet.
        const data = await load((msg, ratio) => {
            const status = sel("#boot-status");
            if (status) status.textContent = msg;
            if (ratio === undefined) return;
            const bar = sel("#boot-bar");
            if (bar) bar.classList.add("determinate");
            const pct = sel("#boot-pct");
            if (pct) pct.textContent = `${Math.round(ratio * 100)} %`;
        });
        ok("les données se chargent malgré les éléments manquants", data.counts.tactics === 2);
    } catch (err) {
        thrown = err;
    }
    ok("aucune exception sur un DOM incomplet", thrown === null, thrown?.message);

    globalThis.window = previous.window;
    globalThis.document = previous.document;
}

/* -------------------------------------------- contribution entre mitigations */

console.log("\n[21] Bonus/malus apporté par une autre mitigation");
const m1016 = CATALOG.get("M1016");
ok("M1016 déclare une contribution de M1049",
   m1016?.contributions?.[0]?.from === "M1049" && m1016.contributions[0].weight === 0.25);

const withContribution = (own, otherAnswer) => {
    const layer = { catalog: CATALOG, scoring: "last-yes",
        answers: { M1016: own, ...(otherAnswer ? { M1049: { 5: { value: otherAnswer } } } : {}) } };
    return mitigationLevel(m1016, own, "last-yes", layer);
};
const upToLevel3 = { 1: { value: "Oui" }, 2: { value: "Oui" }, 3: { value: "Oui" },
                     4: { value: "Oui" }, 5: { value: "Oui" }, 6: { value: "Non" } };

ok("« Oui » ailleurs ajoute 0,25", withContribution(upToLevel3, "Oui") === 3.25,
   String(withContribution(upToLevel3, "Oui")));
ok("« Non » ailleurs retire 0,25", withContribution(upToLevel3, "Non") === 2.75,
   String(withContribution(upToLevel3, "Non")));
ok("« N/A » ailleurs ne change rien", withContribution(upToLevel3, "N/A") === 3);
ok("pas de réponse ailleurs ne change rien", withContribution(upToLevel3, null) === 3);

const allYes1016 = Object.fromEntries(m1016.questions.map(q => [q.num, { value: "Oui" }]));
ok("le bonus reste borné à 4", withContribution(allYes1016, "Oui") === 4,
   String(withContribution(allYes1016, "Oui")));

const firstNo = { 1: { value: "Non" } };
ok("aucun ajustement sur un niveau 0", withContribution(firstNo, "Oui") === 0,
   String(withContribution(firstNo, "Oui")));

// Conformité exhaustive à la formule du classeur, sur le domaine que le parcours
// progressif peut réellement produire : un « Non » clôt le questionnaire, donc
// aucun état atteignable ne porte de réponse après le premier « Non ». Chaque
// combinaison est tronquée là, puis comparée à la formule sur ce même état.
{
    const V = ["Oui", "Non", "N/A"];
    const excel = (own, other) => {
        const rows = m1016.questions.map((q, i) => ({ i, v: own[q.num] }));
        const yes = rows.filter(r => r.v === "Oui");
        if (!yes.length) return 0;
        const last = Math.max(...yes.map(r => r.i));
        const adj = other === "Oui" ? 0.25 : other === "Non" ? -0.25 : 0;
        return Math.max(0, Math.min(4, m1016.questions[last].level + adj));
    };
    function* combos(n) {
        if (!n) { yield []; return; }
        for (const rest of combos(n - 1)) for (const v of V) yield [...rest, v];
    }
    /** Coupe la combinaison au premier « Non » inclus. */
    const reachable = combo => {
        const stop = combo.indexOf("Non");
        return stop < 0 ? combo : combo.slice(0, stop + 1);
    };
    let checked = 0, diverged = 0;
    for (const combo of combos(m1016.questions.length)) {
        const kept = reachable(combo);
        for (const other of [...V, null]) {
            const own = Object.fromEntries(kept.map((v, i) => [m1016.questions[i].num, { value: v }]));
            const flat = Object.fromEntries(kept.map((v, i) => [m1016.questions[i].num, v]));
            checked++;
            if (Math.abs(withContribution(own, other) - excel(flat, other)) > 1e-9) diverged++;
        }
    }
    ok(`conforme à la formule du classeur sur ${checked} combinaisons atteignables`,
       diverged === 0, `${diverged} écart(s)`);
}

// Écart assumé avec le classeur, rendu nécessaire par les questions communes :
// une réponse subsistant après un « Non » ne compte pas. Elle est conservée en
// stockage parce qu'une autre mitigation en a besoin, mais la note de celle-ci
// s'arrête à son propre point de blocage.
{
    const afterNo = { 1: { value: "Non" }, 5: { value: "Oui" } };
    ok("une réponse au-delà d'un « Non » ne relève pas la note",
       mitigationLevel(m1016, afterNo, "last-yes") === 0,
       String(mitigationLevel(m1016, afterNo, "last-yes")));
}

// Le questionnaire annonce la dépendance. On ouvre M1016 depuis la matrice,
// puisqu'elle n'est plus la première mitigation du catalogue.
window.document.getElementById("brand").click();
window.document.getElementById("home-new").click();
window.document.getElementById("nl-ok").click();
window.document.getElementById("q-matrix").click();
window.document.querySelector('[data-tech="T1078"]').click();
[...window.document.querySelectorAll("#modal-panel [data-edit]")]
    .find(b => b.dataset.edit === "M1016").click();
ok("le questionnaire s'est ouvert sur M1016", openMitigation() === "M1016", openMitigation());
// La dépendance n'est plus annoncée sur la question. « Cette note dépend aussi
// de M1049 question 5 (±0.25) — pas encore répondue » décrivait la mécanique de
// notation à quelqu'un qui a seulement une question à trancher, et le poids
// affiché n'aidait à rien puisqu'il ne se pilote pas. Elle continue d'agir sur
// la note : c'est ce que vérifie la suite de ce groupe.
ok("la dépendance n'encombre plus la question",
   !window.document.querySelector(".quiz-link"),
   window.document.querySelector(".quiz-link")?.textContent.trim());

/* ------------------------------------------------ passe de relecture */

console.log("\n[22] Passe de relecture après un questionnaire complet");
const { reviewTarget, acquiredMitigations } = await import(`${APP}/js/layer.js`);
const ids = [...CATALOG.keys()];

// Tout traité : les deux premières acquises, la troisième bloquée sur un « Non ».
const reviewLayer = createLayer({ name: "Relecture" });
const fillAllYes = (layer, id) => {
    for (const q of CATALOG.get(id).questions) setAnswer(layer, id, q.num, { value: "Oui" });
};
for (const id of ids) fillAllYes(reviewLayer, id);
setAnswer(reviewLayer, ids[2], CATALOG.get(ids[2]).questions[1].num, { value: "Non" });

ok("plus rien à traiter en première passe", nextTarget(reviewLayer) === null);
const review = reviewTarget(reviewLayer);
ok("la relecture repart du début et saute les mitigations acquises",
   review?.mitigation === ids[2], `${review?.mitigation} (attendu ${ids[2]})`);
ok("elle atterrit sur la question du « Non »",
   review?.question === CATALOG.get(ids[2]).questions[1].num, String(review?.question));
ok("les mitigations sans « Non » sont acquises",
   acquiredMitigations(reviewLayer).join(",") === ids.filter(i => i !== ids[2]).join(","),
   acquiredMitigations(reviewLayer).join(","));

// Un second point de blocage plus loin, et le chaînage after.
setAnswer(reviewLayer, ids[4], CATALOG.get(ids[4]).questions[0].num, { value: "Non" });
ok("le premier point de blocage reste le plus haut dans le catalogue",
   reviewTarget(reviewLayer)?.mitigation === ids[2]);
ok("le chaînage donne le point de blocage suivant",
   reviewTarget(reviewLayer, ids[2])?.mitigation === ids[4],
   reviewTarget(reviewLayer, ids[2])?.mitigation);

// Tout acquis : rien à relire.
const allAcquired = createLayer({ name: "Tout acquis" });
for (const id of ids) fillAllYes(allAcquired, id);
ok("aucun point de blocage quand tout est « Oui »", reviewTarget(allAcquired) === null);

// Et par l'interface : le questionnaire ne repart pas sur la dernière mitigation.
window.document.getElementById("brand").click();
window.document.getElementById("home-new").click();
window.document.getElementById("nl-ok").click();
const uiLayerTag = () => window.document.querySelector(".quiz-tag")?.textContent.trim();
answerAllYes();
window.document.getElementById("r-matrix").click();
window.document.getElementById("matrix-quiz").click();
ok("tout acquis : l'écran « Rien à revoir » s'affiche",
   /Rien à revoir/.test(window.document.getElementById("view-quiz").textContent),
   window.document.querySelector(".quiz-title")?.textContent);

/* --------------------------------- ce que la barre d'outils garde */

console.log("\n[23] Barre d'outils de la matrice, et resserrement");
window.document.getElementById("r-matrix").click();
window.document.getElementById("matrix-subs").checked = true;
window.document.getElementById("matrix-subs").dispatchEvent(new window.Event("change"));
ok("les sous-techniques sont dépliées", !!window.document.querySelector('[data-tech="T1078.001"]'));

// « Surligner une mitigation » éteignait toute la matrice pour n'en garder que
// quelques cases : il fallait renoncer à la vue d'ensemble — la seule chose que
// cet écran sache faire — pour suivre une mitigation qu'on lit mieux dans sa
// propre fiche. Ce qui reste sert à cadrer la lecture, pas à la remplacer.
ok("le surlignage d'une mitigation est retiré",
   !window.document.getElementById("matrix-mitigation"));
ok("la recherche, les plateformes, les sous-techniques et la notation restent",
   ["matrix-search", "dd-platform", "matrix-subs", "dd-method"]
       .every(id => !!window.document.getElementById(id)),
   ["matrix-search", "dd-platform", "matrix-subs", "dd-method"]
       .filter(id => !window.document.getElementById(id)).join(", ") || "toutes présentes");
ok("plus aucune case n'est atténuée",
   !window.document.querySelector(".cell.dimmed, .cell.highlighted"));

// Les zones de faiblesse doivent se voir d'un coup d'œil : quinze tactiques à
// 146 px faisaient plus de deux largeurs d'écran, et la matrice se lisait par
// fragments.
const css = readFileSync(`${ROOT}/css/matrix.css`, "utf8");
const colonne = Number(/minmax\((\d+)px/.exec(
    readFileSync(`${ROOT}/js/views/matrix.js`, "utf8"))[1]);
ok("les colonnes sont resserrées", colonne <= 120, `${colonne}px`);

// `min-width: max-content` rendait ce plancher inopérant : la grille prenait la
// largeur du plus long libellé non replié, quelle que soit la valeur demandée.
ok("et le plancher n'est pas court-circuité par le contenu",
   !/#matrix-grid\s*\{[^}]*min-width:\s*max-content/.test(css),
   (/#matrix-grid\s*\{[^}]*min-width:\s*([^;]+)/.exec(css) ?? [])[1]);

// « Resource Development » sortait en « Re- / source Dev… » : `overflow-wrap:
// anywhere` avec `hyphens: auto` coupe à l'intérieur des mots. On interroge les
// déclarations seules — les commentaires citent les valeurs qu'on écarte.
{
    const regles = css.replace(/\/\*[\s\S]*?\*\//g, "");
    ok("les mots ne sont jamais coupés en leur milieu",
       !/hyphens:\s*auto/.test(regles) && !/overflow-wrap:\s*anywhere/.test(regles),
       (/hyphens:\s*auto|overflow-wrap:\s*anywhere/.exec(regles) ?? [])[0]);
}
const tailleCase = Number(/\.cell\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(css)[1]);
ok("et les cases avec elles", tailleCase <= 0.61, `${tailleCase}rem`);
// Le surlignage revient, mais commandé depuis la liste des mitigations et non
// par un sélecteur dans la barre : c'est là qu'on se demande « celle-là, elle
// protège quoi ? ». Voir [35c].
ok("les règles du surlignage restent, pour la liste des mitigations",
   /\.cell\.dimmed/.test(css) && /\.cell\.highlighted/.test(css));
ok("« .cell.dimmed » est déclarée après « .cell.sub »",
   css.indexOf(".cell.dimmed") > css.indexOf(".cell.sub"),
   `sub à ${css.indexOf(".cell.sub")}, dimmed à ${css.indexOf(".cell.dimmed")}`);
ok("« .cell.sub » ne fixe pas d'opacité",
   !/\.cell\.sub\s*\{[^}]*opacity/.test(css));

/* --------------------------------------- questions communes à des mitigations */

console.log("\n[24] Questions communes à plusieurs mitigations");
const shared = await import(`${APP}/js/shared-questions.js`);
const { SHARED_GROUPS, groupOf, primaryOf, sharedText, sharedWith, savedQuestions } = shared;

// Chaque groupe doit désigner des questions qui existent, et son porteur doit
// être son premier membre dans l'ordre du catalogue : c'est ce qui rend la
// remise en ordre à l'import déterministe.
const catalogOrder = [...CATALOG.keys()];
{
    const problems = [];
    for (const group of SHARED_GROUPS) {
        if (group.members.length < 2) problems.push(`${group.key} : un seul membre`);
        for (const m of group.members) {
            const questionnaire = CATALOG.get(m.mitigation);
            if (!questionnaire) { problems.push(`${group.key} : ${m.mitigation} hors catalogue`); continue; }
            if (!questionnaire.questions.some(q => q.num === m.question))
                problems.push(`${group.key} : ${m.mitigation} Q${m.question} n'existe pas`);
        }
        const positions = group.members.map(m => catalogOrder.indexOf(m.mitigation));
        if (positions.some((p, i) => i > 0 && p <= positions[i - 1]))
            problems.push(`${group.key} : membres pas dans l'ordre du catalogue`);
    }
    ok("les six groupes désignent des questions existantes, porteur en tête",
       problems.length === 0, problems.join(" | "));
}
ok("sept questions économisées", savedQuestions() === 7, String(savedQuestions()));
ok("320 questions réellement posées", totalQuestions() - savedQuestions() === 320,
   String(totalQuestions() - savedQuestions()));

// Le trio MFA : trois mitigations, trois niveaux visés, une seule question.
const mfa = SHARED_GROUPS.find(g => g.key === "mfa-comptes-privilegies");
ok("le trio MFA compte bien trois membres", mfa.members.length === 3);
ok("ses membres visent des niveaux différents",
   mfa.members.map(m => CATALOG.get(m.mitigation).questions.find(q => q.num === m.question).level)
       .join(",") === "3,2,3");

// On répond depuis le dernier membre : l'écriture doit filer chez le porteur.
{
    const l = createLayer({ name: "commun" });
    setAnswer(l, "M1027", 5, { value: "Oui", tool: "Duo" });
    ok("la réponse est écrite chez le porteur", l.answers.M1018?.[5]?.value === "Oui",
       JSON.stringify(l.answers));
    ok("rien n'est écrit sous la mitigation où l'on a répondu", l.answers.M1027 === undefined);

    for (const id of ["M1018", "M1026", "M1027"]) {
        ok(`${id} voit la réponse par résolution`,
           resolvedEntries(l, id)[groupOf(id, id === "M1018" ? 5 : id === "M1026" ? 7 : 5).members
               .find(m => m.mitigation === id).question]?.value === "Oui");
    }
    ok("l'outil saisi suit la réponse partagée", resolvedEntries(l, "M1026")[7]?.tool === "Duo");

    // Chacune applique la réponse à son propre niveau.
    ok("M1018 monte au niveau 3", mitigationLevel(CATALOG.get("M1018"), resolvedEntries(l, "M1018"), "last-yes") === 3);
    ok("M1026 monte au niveau 2", mitigationLevel(CATALOG.get("M1026"), resolvedEntries(l, "M1026"), "last-yes") === 2);

    // Et une mitigation notée sans aucune réponse en propre doit apparaître.
    const levels = mitigationLevels({ ...l, scoring: "last-yes" });
    ok("M1027 est notée sans réponse en propre", levels.get("M1027") === 3, String(levels.get("M1027")));
}

// Un « Non » qui clôt une mitigation ne doit pas détruire la réponse commune,
// qui reste atteignable ailleurs.
{
    const l = createLayer({ name: "blocage" });
    setAnswer(l, "M1018", 5, { value: "Oui" });      // commune, portée par M1018
    setAnswer(l, "M1018", 7, { value: "Oui" });      // propre à M1018
    const dropped = setAnswer(l, "M1018", 1, { value: "Non" });
    ok("la réponse propre postérieure est effacée", dropped === 1 && !l.answers.M1018[7]);
    ok("la réponse commune est conservée", l.answers.M1018[5]?.value === "Oui");
    ok("M1018 retombe tout de même à 0",
       mitigationLevel(CATALOG.get("M1018"), resolvedEntries(l, "M1018"), "last-yes") === 0);
    ok("M1027 en profite toujours",
       mitigationLevel(CATALOG.get("M1027"), resolvedEntries(l, "M1027"), "last-yes") === 3);
}

// À l'import, une réponse restée chez un membre non porteur doit être ramenée,
// sinon elle masquerait celle du groupe.
{
    const imported = fromJSON(JSON.stringify({
        schema: "ctrm-layer/1", name: "import", answers: {
            M1026: { 7: { value: "Oui" } },                    // membre non porteur
            M1050: { 1: { value: "Non" } },                    // membre non porteur
        },
    }));
    ok("la réponse d'un membre non porteur est déplacée",
       imported.answers.M1018?.[5]?.value === "Oui" && imported.answers.M1026 === undefined,
       JSON.stringify(imported.answers));
    ok("elle vaut alors pour tout le groupe", resolvedEntries(imported, "M1027")[5]?.value === "Oui");
    ok("idem pour la protection mémoire", imported.answers.M1025?.[1]?.value === "Non");

    // Membres en désaccord : le premier déclaré fait foi.
    const conflict = fromJSON(JSON.stringify({
        schema: "ctrm-layer/1", name: "conflit", answers: {
            M1018: { 5: { value: "Oui" } }, M1026: { 7: { value: "Non" } },
        },
    }));
    ok("en cas de désaccord, le porteur fait foi",
       conflict.answers.M1018[5].value === "Oui" && conflict.answers.M1026 === undefined,
       JSON.stringify(conflict.answers));
}

// Une réponse à une question qui n'existe pas ne doit pas entrer dans le layer.
ok("une réponse hors questionnaire est écartée",
   fromJSON(JSON.stringify({ schema: "ctrm-layer/1", name: "x",
       answers: { M1032: { 99: { value: "Oui" } } } })).answers.M1032 === undefined);

// L'export montre la réponse sur chacune des mitigations concernées.
{
    const l = createLayer({ name: "export" });
    setAnswer(l, "M1018", 5, { value: "Oui" });
    const feuille = buildWorkbook(ExcelJS, l,
        { mitigations: [], tactics: [], techniques: [], subTechniques: [] },
        new Map(), new Map()).getWorksheet("Réponses");
    const colonnes = new Map();
    feuille.getRow(1).eachCell((c, i) => colonnes.set(String(c.value), i));
    const rows = [];
    feuille.eachRow((row, i) => {
        if (i === 1) return;
        rows.push({
            Mitigation: row.getCell(colonnes.get("Mitigation")).value,
            "Numéro": row.getCell(colonnes.get("N°")).value,
            "Réponse": row.getCell(colonnes.get("Réponse")).value,
        });
    });
    const seen = ["M1018", "M1026", "M1027"].map(id => {
        const q = groupOf(id, id === "M1026" ? 7 : 5).members.find(m => m.mitigation === id).question;
        return rows.find(r => r.Mitigation === id && r["Numéro"] === q)?.["Réponse"];
    });
    ok("chaque mitigation du groupe porte la réponse dans l'export",
       seen.join(",") === "Oui,Oui,Oui", seen.join(","));
}

// Le parcours : la question n'est posée qu'une fois, et une mitigation
// pré-remplie n'est pas reléguée en fin de première passe.
{
    const l = createLayer({ name: "parcours" });
    setAnswer(l, "M1033", 1, { value: "Oui" });     // pré-remplit M1038 Q1
    const target = nextTarget(l);
    ok("la première passe reste dans l'ordre du catalogue", target.mitigation === "M1013",
       target.mitigation);

    // On avance jusqu'à M1038 : sa première question ne doit pas être reposée.
    for (const [id, questionnaire] of l.catalog) {
        if (id === "M1038") break;
        for (const q of questionnaire.questions) setAnswer(l, id, q.num, { value: "Oui" });
    }
    const at1038 = nextTarget(l);
    ok("M1038 est bien la suivante", at1038.mitigation === "M1038", at1038.mitigation);
    ok("et on y reprend à la question 2, la première étant déjà connue",
       at1038.question === 2, String(at1038.question));
}

// Formulation commune et mention à l'écran.
ok("une formulation commune est retenue quand les membres diffèrent",
   sharedText("M1026", 7) === sharedText("M1018", 5) && sharedText("M1026", 7).includes("ou sensibles"));
ok("aucune formulation imposée quand les membres sont identiques",
   sharedText("M1033", 1) === null);
ok("les autres mitigations du groupe sont connues",
   sharedWith("M1018", 5).join(",") === "M1026,M1027", sharedWith("M1018", 5).join(","));
ok("M1027 Q2 reste séparée de M1018 Q2", groupOf("M1027", 2) === null);

{
    window.document.getElementById("brand").click();
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-ok").click();
    window.document.getElementById("q-matrix").click();
    window.document.querySelector('[data-tech="T1078"]').click();
    [...window.document.querySelectorAll("#modal-panel [data-edit]")]
        .find(b => b.dataset.edit === "M1018").click();
    for (let i = 0; i < 4; i++) window.document.querySelector('[data-answer="Oui"]').click();
    // Que la question soit commune ne se voit pas — voir [27]. Ce qui se voit,
    // c'est la formulation retenue pour le groupe : c'est elle qui doit être
    // posée, et non celle de la seule mitigation ouverte.
    ok("la formulation commune est celle qui est posée",
       window.document.querySelector(".quiz-question")?.textContent.includes("ou sensibles"),
       window.document.querySelector(".quiz-question")?.textContent.trim().slice(0, 80));
}

console.log("\n[24b] Une question commune n'est jamais reposée");
{
    const { answeredElsewhere } = await import(`${APP}/js/shared-questions.js`);
    const { sanitiseAnswers } = await import(`${APP}/js/layer.js`);

    const l = createLayer({ name: "doublons" });
    setAnswer(l, "M1033", 1, { value: "Oui" });     // groupe M1033 Q1 / M1038 Q1
    ok("là où on y a répondu, la question reste la sienne",
       answeredElsewhere(l, "M1033", 1) === null);
    ok("ailleurs dans le groupe, elle n'est plus à poser",
       answeredElsewhere(l, "M1038", 1)?.value === "Oui");
    ok("une question qui n'est commune à rien n'est jamais sautée",
       answeredElsewhere(l, "M1033", 2) === null && answeredElsewhere(l, "M1013", 1) === null);

    // Le porteur du groupe n'est pas forcément celui où la question a été posée :
    // c'est bien l'endroit de la saisie qui compte, sans quoi répondre depuis le
    // membre non porteur ferait reposer la question chez le porteur.
    const inverse = createLayer({ name: "inverse" });
    setAnswer(inverse, "M1038", 1, { value: "Oui" });
    ok("répondre depuis le membre non porteur vaut pour tout le groupe",
       answeredElsewhere(inverse, "M1038", 1) === null &&
       answeredElsewhere(inverse, "M1033", 1)?.value === "Oui",
       JSON.stringify(inverse.answers.M1033?.[1]));

    // Un fichier antérieur, ou relu depuis un classeur, ne porte pas la trace de
    // l'endroit où la question a été posée. Le porteur fait alors foi : la
    // question est réputée posée là où elle est rangée.
    const ancien = createLayer({ name: "ancien" });
    ancien.answers = sanitiseAnswers({ M1033: { 1: { value: "Oui" } } });
    ok("sans trace d'origine, la question est réputée posée chez son porteur",
       answeredElsewhere(ancien, "M1033", 1) === null &&
       answeredElsewhere(ancien, "M1038", 1)?.value === "Oui");
}

{
    // Le parcours, à l'écran. Tout est traité sauf M1026, et la question commune
    // au groupe MFA a été répondue « Non » depuis M1018 : M1026 doit s'arrêter
    // sur sa question 7 sans jamais l'afficher, et dire pourquoi.
    const l = createLayer({ name: "Doublon bloquant" });
    for (const id of CATALOG.keys()) {
        if (id !== "M1026") setAnswer(l, id, CATALOG.get(id).questions[0].num, { value: "Non" });
    }
    setAnswer(l, "M1018", 5, { value: "Non" });

    window.document.getElementById("brand").click();
    const zone = window.document.getElementById("home-drop");
    const evt = new window.Event("drop");
    evt.dataTransfer = { files: [new window.File([toJSON(l)], "doublon.json", { type: "application/json" })] };
    zone.dispatchEvent(evt);
    await new Promise(r => setTimeout(r, 80));

    ok("le questionnaire reprend sur M1026",
       window.document.querySelector(".quiz-tag")?.textContent.trim() === "M1026",
       window.document.querySelector(".quiz-tag")?.textContent.trim());

    const vues = [];
    for (let i = 0; i < 6; i++) {
        const carte = window.document.querySelector(".quiz-card");
        vues.push(`${carte?.dataset.question}/${carte?.dataset.total}`);
        window.document.querySelector('[data-answer="Oui"]')?.click();
    }
    ok("les six premières questions sont posées normalement",
       vues.join(" | ") === [1, 2, 3, 4, 5, 6].map(n => `${n}/14`).join(" | "),
       vues.join(" | "));

    const resultat = window.document.querySelector(".quiz-result");
    ok("la septième, déjà tranchée ailleurs, n'est pas reposée : le parcours s'arrête",
       !!resultat && !window.document.querySelector(".quiz-question"),
       resultat ? "résultat affiché" : "question encore à l'écran");

    const mot = window.document.querySelector(".quiz-result .quiz-shared")?.textContent ?? "";
    ok("et l'arrêt est expliqué : question commune, réponse « Non »",
       /commune/.test(mot) && /M1018/.test(mot) && /Non/.test(mot),
       mot.replace(/\s+/g, " ").trim().slice(0, 130));
    ok("le décompte annonce les questions non reposées",
       /déjà répondue.? depuis une autre mitigation/.test(
           window.document.querySelector(".quiz-result")?.textContent ?? ""),
       window.document.querySelector(".quiz-result")?.textContent.replace(/\s+/g, " ").match(/\d+ questions? répondue[^·]*·[^·]*/)?.[0]);
}

/* --------------------------------------- accueil : sections, matrice, rosace */

console.log("\n[25] Accueil : la page publique");
window.document.getElementById("brand").click();
{
    const home = window.document.getElementById("view-home");
    // Les mêmes données normalisées que celles servies à l'application.
    const data = await (await import(`${APP}/js/attack.js`)).loadAttack();
    const homeCss = readFileSync(`${ROOT}/css/home.css`, "utf8");
    const html = readFileSync(`${ROOT}/index.html`, "utf8");

    /* --- la matrice du haut de page ---

       Elle a remplacé le fond défilant. Ce fond avait un défaut de fond : pour ne
       pas gêner la lecture il fallait le diluer à 17 % et le creuser d'un masque,
       c'est-à-dire le rendre méconnaissable pour le rendre supportable. --- */

    ok("plus de matrice défilante en arrière-plan",
       !home.querySelector(".home-backdrop") && !/\.home-backdrop/.test(homeCss));

    const matrice = home.querySelector(".hero-matrix");
    ok("la matrice ouvre la page, à côté du titre", !!matrice);
    ok("elle est hors de l'arbre d'accessibilité",
       matrice?.getAttribute("aria-hidden") === "true");

    const colonnes = [...home.querySelectorAll(".hm-col .hm-head")].map(h => h.textContent.trim());
    // Le cadrage s'arrête à Credential Access : au-delà, les colonnes deviennent
    // trop étroites pour qu'un nom de technique s'y lise.
    const attendues = data.tactics
        .slice(data.tactics.findIndex(t => t.shortname === "initial-access"),
               data.tactics.findIndex(t => t.shortname === "credential-access") + 1)
        .map(t => t.name);
    ok("elle va d'Initial Access à Credential Access, et s'arrête là",
       colonnes.join(" | ") === attendues.join(" | "), colonnes.join(" | "));

    // Les techniques sont les vraies : c'est ce qui la rend reconnaissable.
    const noms = new Set(data.techniques.map(t => t.name));
    const cases = [...home.querySelectorAll(".hm-cell")];
    ok("les cases portent de vraies techniques du référentiel",
       cases.length > 0 && cases.every(c => noms.has(c.textContent.trim())),
       cases.slice(0, 3).map(c => c.textContent.trim()).join(" · "));

    // Les cases portent un niveau de la rampe : l'accueil montre ce que l'outil
    // produit, à quelqu'un qui n'a encore rien évalué. Tirage déterministe, pour
    // que la matrice ne change pas de visage d'une visite à l'autre.
    ok("chaque case porte un niveau de la rampe, ou aucun",
       cases.every(c => /\b(l[0-4]|vide)\b/.test(c.className)),
       [...new Set(cases.map(c => c.className.replace("hm-cell ", "")))].join(" | "));
    // Le mini-référentiel du banc n'a que deux tactiques et cinq techniques : de
    // quoi vérifier la mécanique, pas la distribution. On rejoue donc le tirage
    // sur une matrice de la taille réelle, sept colonnes de quinze cases.
    {
        const { heroMatrix } = await import(`${APP}/js/views/home-visuals.js`);
        const noms = ["initial-access", "execution", "persistence", "privilege-escalation",
                      "stealth", "defense-impairment", "credential-access"];
        const large = {
            tactics: noms.map(shortname => ({ shortname, name: shortname })),
            byTactic: new Map(noms.map(shortname => [shortname,
                Array.from({ length: 15 }, (_, i) => ({ id: `T${i}`, name: `Technique ${i}` }))])),
        };
        const bac = window.document.createElement("div");
        bac.innerHTML = heroMatrix(large);
        const toutes = [...bac.querySelectorAll(".hm-cell")];

        ok("les cinq paliers sont représentés",
           [0, 1, 2, 3, 4].every(n => toutes.some(c => c.classList.contains(`l${n}`))),
           [0, 1, 2, 3, 4].map(n => `l${n}:${toutes.filter(c => c.classList.contains(`l${n}`)).length}`).join(" "));
        // Une matrice entièrement colorée n'a jamais existé : il reste toujours
        // des techniques qu'aucune mesure ne couvre, et c'est ce qu'on vient voir.
        const vides = toutes.filter(c => c.classList.contains("vide")).length;
        ok("et il reste des techniques sans niveau",
           vides > 0 && vides < toutes.length / 2, `${vides} sur ${toutes.length}`);
        // Deux rendus doivent donner exactement la même matrice : tirée au hasard
        // à chaque affichage, elle changerait de visage à chaque visite.
        ok("le tirage est déterministe", heroMatrix(large) === heroMatrix(large));
    }

    // Le chemin d'attaque se dessine dans son propre calque : la matrice se
    // compose comme s'il n'existait pas, et sans JavaScript elle reste entière.
    const calque = home.querySelector(".hm-grid .hm-trace .hm-path");
    ok("le tracé a son propre calque, vide au départ",
       !!calque && !calque.getAttribute("d"));
    ok("la grille sert de repère au calque",
       /\.hm-grid\s*\{[^}]*position:\s*relative/.test(homeCss) &&
       /\.hm-trace\s*\{[^}]*position:\s*absolute/.test(homeCss));
    // Une case traversée change de bordure, jamais de taille : elle décalerait
    // sa colonne entière.
    const surChemin = /\.hm-cell\.on-path\s*\{([^}]*)\}/.exec(homeCss)?.[1] ?? "";
    ok("la case traversée s'allume sans bouger",
       /border-color/.test(surChemin) && !/(^|[;\s])(width|height|padding|transform|font-size)\s*:/.test(surChemin),
       surChemin.replace(/\s+/g, " ").trim());

    /* --- une page, des sections, et les ancres qui y mènent --- */

    const ancres = [...window.document.querySelectorAll("#site-nav .nav-link")]
        .map(a => a.getAttribute("href"));
    ok("la barre haute porte les ancres des sections",
       ancres.join(",") === "#demarrer,#comment,#benefices,#faq", ancres.join(","));
    ok("chaque ancre trouve sa section dans la page",
       ancres.every(href => !!home.querySelector(href)),
       ancres.filter(href => !home.querySelector(href)).join(",") || "toutes présentes");
    ok("aucune ne quitte la page",
       ancres.every(href => href.startsWith("#")));
    ok("les sections se décalent sous la barre flottante",
       /\.band\[id\]\s*\{[^}]*scroll-margin-top/.test(homeCss));

    // La barre haute est la même des deux côtés, seul son mode change.
    ok("elle est en mode « accueil » sur l'accueil",
       window.document.getElementById("topbar").dataset.mode === "home");
    ok("le mode pilote ce qui s'affiche, sans dédoubler la barre",
       /#topbar\[data-mode="app"\] #site-nav/.test(readFileSync(`${ROOT}/css/base.css`, "utf8")));

    /* --- l'icône d'onglet --- */

    ok("le document déclare une icône",
       /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/.test(html));
    const icone = readFileSync(`${ROOT}/favicon.svg`, "utf8");
    ok("c'est bien la mascotte, pas une image quelconque",
       /<svg/.test(icone) && /circle/.test(icone) && icone.split("<path").length - 1 >= 6,
       `${icone.split("<path").length - 1} tracés`);

    /* --- le haut de page : un titre court, une accroche courte --- */

    const h1 = home.querySelector(".hero h1");
    ok("le titre tient en une phrase, sans nommer le référentiel",
       h1?.textContent.replace(/\s+/g, " ").trim()
           === "Évaluez la maturité cyber de votre organisation",
       h1?.textContent.replace(/\s+/g, " ").trim());
    ok("« maturité cyber » est mis en avant dans le titre",
       h1?.querySelector("em")?.textContent === "maturité cyber");
    const lead = home.querySelector(".hero-lead")?.textContent.replace(/\s+/g, " ").trim() ?? "";
    ok("l'accroche dit le référentiel, en une phrase",
       /MITRE ATT&CK/.test(lead) && lead.length < 220, `${lead.length} caractères`);
    ok("la version du référentiel est annoncée en haut de page",
       window.document.getElementById("version-text")?.textContent.includes(data.version),
       window.document.getElementById("version-text")?.textContent);

    /* --- la barre haute ne propose qu'une fois de démarrer --- */

    // Elle portait deux fois le même geste : l'ancre « Démarrer » et une pastille
    // noire « Démarrer », à deux centimètres l'une de l'autre.
    const cta = window.document.getElementById("nav-cta");
    ok("la pastille de la barre ne redit pas l'ancre",
       cta?.textContent.trim() === "Contactez-nous", cta?.textContent.trim());
    ok("et elle mène au pied de page, qui porte le contact",
       !!home.querySelector("#contact") &&
       /#nav-cta[\s\S]{0,200}#contact/.test(readFileSync(`${ROOT}/js/main.js`, "utf8")));

    /* --- rien ne suit le défilement --- */

    // Une intro collée en haut accompagne la lecture, en théorie ; à l'usage, un
    // bloc de texte qui glisse pendant qu'on descend attire l'oeil sur lui.
    ok("aucun bloc de l'accueil ne suit le défilement",
       !/position:\s*sticky/.test(homeCss));

    /* --- la pastille de version --- */

    const chip = home.querySelector(".hero-chip");
    ok("elle porte un point d'état et le numéro, rien de plus",
       !!chip?.querySelector(".dot") && /v/.test(chip.textContent) &&
       !/appel réseau|embarqué/.test(chip.textContent),
       chip?.textContent.replace(/\s+/g, " ").trim());

    /* --- le verre de la barre --- */

    const tokensCss = readFileSync(`${ROOT}/css/tokens.css`, "utf8");
    const couches = [...tokensCss.matchAll(/--glass:\s*rgba\([^)]*?([\d.]+)\)/g)].map(m => Number(m[1]));
    ok("le verre au repos laisse voir la page à travers",
       couches.length >= 2 && couches.every(a => a <= 0.45), couches.join(", "));
    const denses = [...tokensCss.matchAll(/--glass-strong:\s*rgba\([^)]*?([\d.]+)\)/g)].map(m => Number(m[1]));
    // En défilant, la barre passe devant les cartes sombres : sur ce fond une
    // couche légère ramène le libellé d'un lien à un gris sur gris.
    ok("et se densifie dès qu'il y a du contenu dessous",
       denses.length >= 2 && denses.every(a => a >= 0.8), denses.join(", "));
    ok("le flou porte ce que l'opacité ne porte plus",
       /backdrop-filter:\s*blur\((2[0-9]|3[0-9])px\)/.test(readFileSync(`${ROOT}/css/base.css`, "utf8")));

    /* --- le parcours en trois temps --- */

    const steps = home.querySelectorAll(".home-steps .step");
    ok("trois étapes expliquent le parcours", steps.length === 3, String(steps.length));
    ok("évaluer, visualiser, exploiter",
       [...steps].map(s => s.querySelector("h3").textContent).join(" → ")
           === "Évaluez vos pratiques → Visualisez votre couverture → Exploitez vos résultats",
       [...steps].map(s => s.querySelector("h3").textContent).join(" → "));
    ok("elles sont numérotées sur deux chiffres",
       [...steps].map(s => s.querySelector(".step-num").textContent).join(",") === "01,02,03",
       [...steps].map(s => s.querySelector(".step-num").textContent).join(","));
    ok("un filet relie chaque étape à la suivante, sauf la dernière",
       /\.step:not\(:last-child\)::after/.test(homeCss));

    /* --- les bénéfices --- */

    const benefices = home.querySelectorAll(".benefit-card");
    ok("quatre bénéfices annoncés", benefices.length === 4, String(benefices.length));
    ok("chacun porte une vignette et un texte",
       [...benefices].every(c => c.querySelector(".benefit-visual svg") && c.querySelector("p")));
    // Une jauge qui afficherait « 87 % » sur une page publique se lirait comme
    // une mesure, alors que c'est un dessin.
    ok("aucune vignette n'affiche de chiffre",
       ![...benefices].some(c => /\d/.test(c.querySelector(".benefit-visual").textContent)));
    ok("les vignettes sont hors de l'arbre d'accessibilité",
       [...benefices].every(c => c.querySelector(".benefit-visual svg").getAttribute("aria-hidden") === "true"));

    /* --- la FAQ --- */

    const faq = home.querySelectorAll(".faq-item");
    ok("la FAQ répond à plusieurs questions", faq.length >= 5, String(faq.length));
    ok("elle est repliable par le navigateur, pas à la main",
       [...faq].every(d => d.tagName.toLowerCase() === "details" && !!d.querySelector("summary")));
    ok("aucune réponse n'est ouverte au chargement",
       [...faq].every(d => !d.hasAttribute("open")));
    // Une FAQ qui promet plus que l'outil ne fait est le plus court chemin vers
    // la défiance : la première réponse est celle qu'on vérifie.
    ok("la première question est celle du stockage, et la réponse est « rien »",
       /partent-elles/.test(faq[0]?.querySelector("summary")?.textContent ?? "") &&
       /ni serveur/.test(faq[0]?.querySelector(".faq-answer")?.textContent ?? ""),
       faq[0]?.querySelector("summary")?.textContent);

    /* --- le pied de page --- */

    const pied = home.querySelector(".site-footer");
    ok("la page se ferme sur un pied de page", !!pied);
    ok("il rappelle l'action, une seule fois",
       pied?.querySelectorAll(".footer-cta .btn").length === 1);
    ok("ses colonnes remontent vers les sections de la page",
       [...pied.querySelectorAll('.footer-col a[href^="#"]')]
           .every(a => !!home.querySelector(a.getAttribute("href"))),
       [...pied.querySelectorAll('.footer-col a[href^="#"]')].map(a => a.getAttribute("href")).join(","));
    // Plus de lien vers le dépôt : le projet part en production, et le code
    // source n'est pas une ressource qu'on propose à un visiteur.
    ok("le pied de page ne renvoie pas vers le dépôt",
       ![...pied.querySelectorAll("a")].some(a => /github\.com/.test(a.getAttribute("href") ?? "")),
       [...pied.querySelectorAll("a")].map(a => a.getAttribute("href")).join(" "));
    ok("il porte un point de contact",
       !!pied.querySelector('a[href^="mailto:"]'),
       pied.querySelector('a[href^="mailto:"]')?.getAttribute("href"));

    // Un lien sortant s'ouvre ailleurs, et ne laisse pas la page ouvrante
    // accessible à la page ouverte.
    ok("les liens sortants sont protégés",
       [...pied.querySelectorAll('a[target="_blank"]')]
           .every(a => /noopener/.test(a.getAttribute("rel") ?? "")),
       String(pied.querySelectorAll('a[target="_blank"]').length));
    ok("la source des données est citée, sans mention de marque ni lien",
       pied.querySelector(".home-foot")?.textContent.trim() === "Données tirées de MITRE ATT&CK" &&
       !pied.querySelector(".home-foot a"),
       pied.querySelector(".home-foot")?.textContent.trim());

    /* --- le rythme des fonds ---

       Un blanc cassé unique sur toute la hauteur donne une page plate, où rien
       n'annonce qu'on change de sujet. Chaque bande porte son fond, et aucun
       composant ne pose le sien. --- */

    const fonds = [...homeCss.matchAll(/\.band-(\w+)\s*\{[^}]*background:\s*([^;]+);/g)]
        .map(m => [m[1], m[2].replace(/\s+/g, " ").trim()]);
    ok("chaque section porte son propre fond",
       fonds.length >= 4 && new Set(fonds.map(f => f[1])).size >= 3,
       fonds.map(f => f.join(" = ")).join(" | "));

    /* --- la rosace ---

       Elle n'est plus sur l'accueil : c'est le visuel du tableau de bord de la
       matrice, sur les niveaux réellement atteints. Sa mécanique se vérifie donc
       sur un rendu détaché, et non plus dans la page. --- */
    {
        const { rosace } = await import(`${APP}/js/views/home-visuals.js`);
        const ros = window.document.createElement("div");
        ros.innerHTML = rosace(data);

        // La rosace porte les tactiques, pas les mitigations : c'est l'axe de
        // lecture d'ATT&CK, et quinze rayons se lisent là où quarante-trois
        // faisaient une dentelle. Les noms viennent du référentiel relu, donc une
        // tactique ajoutée par MITRE apparaît sans qu'on touche à rien.
        const tactiques = data.tactics.map(t => t.name);
        ok("un rayon par tactique du référentiel",
           ros.querySelectorAll(".ros-spoke").length === tactiques.length,
           `${ros.querySelectorAll(".ros-spoke").length} rayons pour ${tactiques.length} tactiques`);
        ok("quatre polygones de repère, un par palier",
           ros.querySelectorAll(".ros-web").length === 4);

        const dots = ros.querySelectorAll(".ros-dot");
        ok("un sommet par tactique", dots.length === tactiques.length, String(dots.length));
        ok("chaque sommet porte un niveau de 0 à 4",
           [...dots].every(d => /(^| )l[0-4]( |$)/.test(d.getAttribute("class"))));
        // Le libellé est porté par le groupe qui réunit la pastille et sa zone de
        // saisie : posé sur la seule pastille, il ne s'affichait pas au survol de la
        // zone, qui la recouvre.
        ok("chaque sommet nomme sa tactique au survol",
           [...dots].map(d => (d.closest(".ros-vertex")?.querySelector("title")?.textContent ?? "")
               .replace(/ : (niveau [0-4],\d|non évaluée)$/, ""))
               .join("|") === tactiques.join("|"),
           dots[0]?.closest(".ros-vertex")?.querySelector("title")?.textContent);
        ok("les sommets apparaissent l'un après l'autre",
           [...dots].map(d => d.style.getPropertyValue("--i")).join(",")
               === [...dots].map((_, i) => String(i)).join(","));

        // Le tracé doit relier exactement les sommets, dans le même ordre.
        const shapePoints = ros.querySelector(".ros-shape")?.getAttribute("points").trim().split(/\s+/);
        ok("le tracé relie tous les sommets", shapePoints?.length === tactiques.length,
           String(shapePoints?.length));
        ok("et passe exactement par eux",
           shapePoints?.every((p, i) => p === `${dots[i].getAttribute("cx")},${dots[i].getAttribute("cy")}`));

        // Le contour se déroule sur son périmètre : une valeur approchée montrerait
        // le tracé déjà commencé, ou couperait la fin de l'animation.
        const shapeEl = ros.querySelector(".ros-shape");
        const closed = shapePoints.map(p => p.split(",").map(Number));
        const perimeter = closed.reduce((total, [x, y], i) => {
            const [px, py] = closed[(i + closed.length - 1) % closed.length];
            return total + Math.hypot(x - px, y - py);
        }, 0);
        ok("le déroulé du contour vaut son périmètre exact",
           Math.abs(Number(shapeEl.style.getPropertyValue("--tour")) - perimeter) < 1,
           `${shapeEl.style.getPropertyValue("--tour")} pour ${perimeter.toFixed(1)}`);

        // La valeur centrale doit être la moyenne réelle des niveaux affichés.
        const levels = [...dots].map(d => Number(/l([0-4])/.exec(d.getAttribute("class"))[1]));
        const mean = (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1).replace(".", ",");
        ok("la valeur centrale est la moyenne des sommets",
           ros.querySelector(".ros-value")?.textContent === mean,
           `${ros.querySelector(".ros-value")?.textContent} attendu ${mean}`);
        // La légende « Exemple — un rayon par tactique… » a été retirée : elle
        // expliquait le dessin à un lecteur qui n'a encore rien saisi, et pesait
        // sous une rosace désormais centrée. Le statut d'exemple reste porté par le
        // `aria-label`, pour qui ne voit pas le dessin.
        ok("plus de légende sous la rosace",
           !ros.querySelector(".rosace-figure figcaption"));
        ok("mais le statut d'exemple reste annoncé à qui ne la voit pas",
           /exemple/i.test(ros.querySelector(".rosace")?.getAttribute("aria-label") ?? ""),
           ros.querySelector(".rosace")?.getAttribute("aria-label"));

        /* --- les axes sont nommés --- */

        // Sans libellé, la rosace ne se lit qu'au survol : un geste qui n'existe pas
        // au doigt, donc pas de lecture du tout sur un téléphone.
        const axes = ros.querySelectorAll(".ros-axis");
        const lignesDe = a => [...a.querySelectorAll("tspan")].map(t => t.textContent);
        ok("chaque rayon porte le nom de sa tactique",
           [...axes].map(a => lignesDe(a).join(" ")).join("|") === tactiques.join("|"),
           `${axes.length} libellés pour ${tactiques.length} rayons`);
        ok("les noms sont posés à l'horizontale, jamais couchés",
           [...axes].every(a => !a.getAttribute("transform")),
           axes[0]?.getAttribute("transform") ?? "aucune rotation");
        // Un nom coupé au milieu d'un mot ne se lit plus : la coupure se fait aux
        // espaces, et seulement là.
        ok("les noms longs sont repliés aux espaces",
           [...axes].every(a => lignesDe(a).every(l => !/^\S*-$/.test(l))) &&
           [...axes].some(a => lignesDe(a).length > 1),
           [...axes].map(a => lignesDe(a).join("/")).filter(t => t.includes("/")).slice(0, 3).join(" · "));
        // Chaque libellé doit s'éloigner du dessin, pas le recouvrir : à droite il
        // part du rayon, à gauche il s'y termine, en haut et en bas il se centre.
        const ancres = [...axes].map(a => ["start", "end", "mid"].find(c => a.classList.contains(c)));
        ok("chaque nom est ancré du côté où il s'éloigne du centre",
           ancres.every(Boolean) && [...axes].every((a, i) => {
               const dx = Number(a.getAttribute("x")) - 160;
               const dy = Number(a.getAttribute("y")) - 160;
               if (ancres[i] === "start") return dx > 0;
               if (ancres[i] === "end") return dx < 0;
               return Math.abs(dx) <= Math.hypot(dx, dy) * 0.3;   // proche de la verticale
           }),
           [...new Set(ancres)].join(","));
        ok("et le CSS traduit les trois ancrages",
           /\.ros-axis\.start\s*\{\s*text-anchor:\s*start/.test(homeCss) &&
           /\.ros-axis\.end\s*\{\s*text-anchor:\s*end/.test(homeCss) &&
           /\.ros-axis\.mid\s*\{\s*text-anchor:\s*middle/.test(homeCss));

        // Un libellé qui sort du viewBox est rogné, ou mord sur le texte voisin.
        // C'est ce que la couronne du viewBox doit absorber : on le mesure plutôt
        // que de le supposer, la largeur d'un « Resource Development » n'étant pas
        // négociable — et le référentiel peut allonger ses noms sans prévenir.
        const font = Number(/\.ros-axis\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(homeCss)[1]);

        /** Les libellés qui sortent du cadre, mesurés à 0,6 em par caractère. */
        const debordent = (liste, svg) => {
            const [minX, minY, boxW, boxH] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
            return liste.filter(a => {
                const ancre = ["start", "end", "mid"].find(c => a.classList.contains(c));
                const x = Number(a.getAttribute("x"));
                const y = Number(a.getAttribute("y"));
                const lignes = lignesDe(a);
                const largeur = Math.max(...lignes.map(l => l.length)) * font * 0.6;
                const gauche = ancre === "start" ? x : ancre === "end" ? x - largeur : x - largeur / 2;
                const hauteur = lignes.length * font * 0.8;
                return gauche < minX || gauche + largeur > minX + boxW
                    || y - hauteur < minY || y + hauteur > minY + boxH;
            });
        };

        const spill = debordent([...axes], ros.querySelector(".rosace"));
        ok("les libellés tiennent dans le cadre de la rosace", spill.length === 0,
           `${spill.length} débordent — ${spill.map(a => lignesDe(a).join(" ")).join(", ")}`);

        // Le référentiel du banc n'a que deux tactiques : de quoi vérifier la
        // mécanique, pas de quoi savoir si « Resource Development » tient dans la
        // couronne. On rejoue donc le rendu sur les quinze noms réels — le cas que
        // l'utilisateur a sous les yeux, et le seul où la place manque vraiment.
        {
            const { rosace } = await import(`${APP}/js/views/home-visuals.js`);
            const reelles = ["Reconnaissance", "Resource Development", "Initial Access",
                "Execution", "Persistence", "Privilege Escalation", "Stealth",
                "Defense Impairment", "Credential Access", "Discovery", "Lateral Movement",
                "Collection", "Command and Control", "Exfiltration", "Impact"];
            const bac = window.document.createElement("div");
            bac.innerHTML = rosace({ tactics: reelles.map(name => ({ name })) });

            const vrais = [...bac.querySelectorAll(".ros-axis")];
            ok("les quinze tactiques d'Enterprise tiennent dans le cadre",
               vrais.length === reelles.length &&
               debordent(vrais, bac.querySelector(".rosace")).length === 0,
               debordent(vrais, bac.querySelector(".rosace")).map(a => lignesDe(a).join(" ")).join(", ")
                   || `${vrais.length} libellés placés`);
            // Deux libellés voisins qui se chevauchent sont illisibles à deux. Sur la
            // moitié droite comme sur la gauche, l'écart vertical entre rayons
            // voisins doit dépasser la hauteur d'un libellé de deux lignes.
            const ys = vrais.map(a => Number(a.getAttribute("y")));
            const cotes = [1, -1].map(signe => vrais
                .map((a, i) => ({ dx: Number(a.getAttribute("x")) - 160, y: ys[i] }))
                .filter(p => Math.sign(p.dx) === signe)
                .map(p => p.y).sort((a, b) => a - b));
            const serres = cotes.flatMap(col => col.slice(1)
                .map((y, i) => y - col[i]).filter(ecart => ecart < font * 2.2));
            ok("deux noms voisins ne se chevauchent pas", serres.length === 0,
               serres.length ? `écarts trop courts : ${serres.map(e => e.toFixed(1)).join(", ")}px`
                   : `écart minimal ${Math.min(...cotes.flatMap(col => col.slice(1)
                       .map((y, i) => y - col[i]))).toFixed(1)}px pour ${(font * 2.2).toFixed(1)}px requis`);
        }
    }
}

console.log("\n[25b] Nouveau layer réduit au nom");
{
    window.document.getElementById("home-new").click();
    const panel = window.document.getElementById("modal-panel");
    ok("le nom est demandé", !!panel.querySelector("#nl-name"));
    ok("le répondant ne l'est plus", !panel.querySelector("#nl-resp"));
    ok("l'organisation non plus", !panel.querySelector("#nl-org"));
    ok("le courriel non plus", !panel.querySelector("#nl-mail"));

    panel.querySelector("#nl-name").value = "Sans répondant";
    panel.querySelector("#nl-ok").click();
    // Le modèle garde la place du répondant : l'export continue de la reprendre.
    const exported = JSON.parse(toJSON(fromJSON(toJSON({
        ...createLayer({ name: "Sans répondant" }), catalog: QST,
    }))));
    ok("le layer garde un emplacement pour le répondant",
       exported.respondent && "name" in exported.respondent && "org" in exported.respondent,
       JSON.stringify(exported.respondent));
}

console.log("\n[26] Actions de fin de mitigation");
{
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-ok").click();

    // On termine la première mitigation, sans aller plus loin.
    const first = [...QST.keys()][0];
    for (let i = 0; i < QST.get(first).questions.length; i++) {
        window.document.querySelector('[data-answer="Oui"]').click();
    }
    ok("l'écran de résultat est atteint", !!window.document.querySelector(".result-badge"));

    const primary = window.document.querySelector(".result-actions .btn-primary");
    ok("une seule action est mise en avant",
       window.document.querySelectorAll(".result-actions .btn-primary").length === 1);
    ok("c'est l'enchaînement, pas la matrice", primary?.id === "r-next", primary?.id);
    ok("elle annonce la mitigation suivante",
       primary?.querySelector(".rn-target")?.textContent.startsWith([...QST.keys()][1]),
       primary?.querySelector(".rn-target")?.textContent);
    ok("revoir et la matrice restent accessibles, en retrait",
       !!window.document.querySelector("#r-review.btn-ghost") &&
       !!window.document.querySelector("#r-matrix.btn-ghost"));

    // Une fois tout traité, plus rien à enchaîner : c'est la matrice qui devient
    // l'action principale, et elle annonce que le parcours est bouclé.
    answerAllYes();
    const last = window.document.querySelector(".result-actions .btn-primary");
    ok("tout traité : la matrice devient l'action principale", last?.id === "r-matrix", last?.id);
    ok("et elle le dit", last?.querySelector(".rn-target")?.textContent.includes("Tout est traité"),
       last?.querySelector(".rn-target")?.textContent);
    ok("plus de bouton d'enchaînement", !window.document.getElementById("r-next"));
}

console.log("\n[27] Une question commune ne s'annonce pas");
{
    window.document.getElementById("brand").click();
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-ok").click();
    window.document.getElementById("q-matrix").click();
    window.document.querySelector('[data-tech="T1078"]').click();
    [...window.document.querySelectorAll("#modal-panel [data-edit]")]
        .find(b => b.dataset.edit === "M1018").click();
    for (let i = 0; i < 4; i++) window.document.querySelector('[data-answer="Oui"]').click();

    // Qu'une question compte pour deux mitigations relève de notre tenue du
    // catalogue, pas de ce qu'on demande au répondant : il répond à une
    // question, un point c'est tout. Le lien reste lisible dans le détail de la
    // mitigation, pour qui va le chercher.
    ok("aucune mention sur la question elle-même",
       !window.document.querySelector(".quiz-card .quiz-shared"),
       window.document.querySelector(".quiz-card .quiz-shared")?.textContent.replace(/\s+/g, " ").trim());
    ok("mais la question reste posée normalement",
       !!window.document.querySelector(".quiz-question"));
}

console.log("\n[28] Rampe de maturité");
{
    const tokens = readFileSync(`${ROOT}/css/tokens.css`, "utf8");

    // Le thème clair est déclaré deux fois : réglage système et bascule manuelle.
    // Les deux doivent porter la même rampe, sans quoi la bascule change les
    // couleurs de la matrice.
    const blocks = [
        /@media\s*\(prefers-color-scheme:\s*light\)\s*\{([\s\S]*?)\n\s*\}\n\}/.exec(tokens)?.[1],
        /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1],
    ];
    ok("les deux déclarations du thème clair sont trouvées", blocks.every(Boolean));

    const rampOf = css => [0, 1, 2, 3, 4]
        .map(i => new RegExp(`--lvl${i}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1]);
    const [bySystem, byToggle] = blocks.map(rampOf);
    ok("réglage système et bascule manuelle portent la même rampe claire",
       bySystem.join(",") === byToggle.join(","), `${bySystem.join(",")}\n     vs ${byToggle.join(",")}`);

    // Clarté monotone et écarts perceptibles, sur les deux thèmes.
    const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lightness = hex => {
        const [R, G, B] = channels(hex).map(srgbToLin);
        const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
        const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
        const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    };
    const relLum = hex => {
        const [R, G, B] = channels(hex).map(srgbToLin);
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const contrast = (a, b) => {
        const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };

    // Distance perceptuelle entre deux couleurs, dans OKLab : elle tient compte
    // de la teinte autant que de la clarté. C'est la mesure qui convient à deux
    // rampes construites sur des principes opposés.
    const oklab = hex => {
        const [R, G, B] = channels(hex).map(srgbToLin);
        const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
        const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
        const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        return [
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ];
    };
    const distance = (a, b) => {
        const [A, B] = [oklab(a), oklab(b)];
        return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    };

    const dark = rampOf(/^:root\s*\{([\s\S]*?)\n\}/m.exec(tokens)[1]);

    // Sur fond sombre, la rampe s'ordonne par la clarté : plus mature, plus
    // lumineux. C'est ce qui la rend lisible là où tout baigne dans le noir.
    const ls = dark.map(lightness);
    const gaps = ls.slice(1).map((l, i) => l - ls[i]);
    ok("rampe sombre : clarté monotone", new Set(gaps.map(Math.sign)).size === 1,
       gaps.map(g => g.toFixed(3)).join(" "));
    ok("rampe sombre : écarts de clarté au moins de 0,06",
       gaps.every(g => Math.abs(g) >= 0.06),
       `écart minimal ${Math.min(...gaps.map(Math.abs)).toFixed(3)}`);

    // Sur fond clair, c'est un feu tricolore : la teinte porte le sens, et le
    // rouge doit peser. La clarté n'y est donc pas monotone — le jaune est le
    // palier le plus clair, le vert redescend — et l'exiger reviendrait à
    // reprendre la rampe qu'on vient d'écarter, où le niveau 0 était un rose
    // pâle qui ne se lisait pas comme un danger.
    // La toile de la rosace doit se voir. Prise au ton des bordures, elle
    // disparaissait sur les deux thèmes — 2,86:1 sur fond clair — et le tracé
    // flottait sans repère de niveau.
    for (const [nom, bloc, surface] of [
        ["sombre", /^:root\s*\{([\s\S]*?)\n\}/m.exec(tokens)[1], "#12141a"],
        ["clair", blocks[0], "#f9f9f7"],
    ]) {
        const toile = /--toile:\s*(#[0-9a-f]{6})/.exec(bloc)?.[1];
        ok(`toile ${nom} : nettement détachée de sa surface`,
           toile && contrast(toile, surface) >= 7,
           `${toile} → ${toile ? contrast(toile, surface).toFixed(2) : "?"}:1`);
    }

    ok("rampe claire : le niveau 0 est un vrai rouge, pas un rose",
       lightness(bySystem[0]) < 0.65, `clarté ${lightness(bySystem[0]).toFixed(3)}`);
    ok("rampe claire : mais le rouge est adouci, pas criard",
       bySystem[0].toLowerCase() !== "#ff0000" && lightness(bySystem[0]) > 0.5,
       bySystem[0]);

    // Ce qui vaut pour les deux, et remplace la monotonie côté clair : deux
    // paliers ne doivent jamais se confondre — y compris non voisins, un « 1 »
    // et un « 3 » se retrouvant côte à côte dans la grille.
    for (const [name, ramp, inks] of [
        ["sombre", dark, ["#ffffff", "#ffffff", "#0b0b0b", "#0b0b0b", "#0b0b0b"]],
        ["clair", bySystem, ["#ffffff", "#0b0b0b", "#0b0b0b", "#0b0b0b", "#0b0b0b"]],
    ]) {
        // Seuil à 0,09 : c'est ce que tient la rampe sombre, en place et jugée
        // bonne, entre ses deux verts les plus proches. La rampe claire est plus
        // large — 0,12 au pire.
        const paires = ramp.flatMap((a, i) => ramp.slice(i + 1).map(b => distance(a, b)));
        ok(`rampe ${name} : deux paliers ne se confondent jamais`,
           paires.every(d => d >= 0.09),
           `paire la plus proche ${Math.min(...paires).toFixed(3)}`);
        const inkRatios = ramp.map((c, i) => contrast(c, inks[i]));
        ok(`rampe ${name} : encre lisible sur chaque palier`,
           inkRatios.every(r => r >= 4.5),
           `au pire ${Math.min(...inkRatios).toFixed(2)}:1`);
    }
}

console.log("\n[29] Mascotte");
{
    const html = readFileSync(`${ROOT}/index.html`, "utf8");
    ok("le tracé est défini une seule fois, dans un <symbol>",
       (html.match(/<symbol id="mascot"/g) ?? []).length === 1);
    ok("il est réutilisé par référence, jamais recopié",
       (html.match(/<use href="#mascot"\/>/g) ?? []).length >= 2 &&
       (html.match(/<symbol id="mascot"/g) ?? []).length === 1);

    // Le conteneur du symbole ne doit pas être masqué par display:none : des
    // navigateurs cessent alors de résoudre les <use>.
    const holder = /<svg width="0" height="0" style="([^"]*)"/.exec(html)?.[1] ?? "";
    ok("le conteneur du symbole n'est pas en display:none", !/display:\s*none/.test(holder), holder);

    ok("la mascotte accompagne le chargement", /class="boot-mascot"/.test(html));
    ok("et sert de logo", /class="brand-mascot"/.test(html));
    ok("elle est hors de l'arbre d'accessibilité",
       [...html.matchAll(/<svg class="(boot|brand)-mascot"[^>]*>/g)]
           .every(m => /aria-hidden="true"/.test(m[0])));

    // Elle est visible dès l'écran de chargement, donc avant tout module : son
    // tracé doit être dans le HTML, pas généré en JavaScript.
    const bootBlock = /<div id="boot">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    ok("elle est présente avant l'exécution du JavaScript", /#mascot/.test(bootBlock));

    const baseCss = readFileSync(`${ROOT}/css/base.css`, "utf8");
    ok("ses couleurs suivent le thème",
       /\.m-body\s*\{\s*fill:\s*var\(--/.test(baseCss) && /\.m-arms\s*\{\s*stroke:\s*var\(--/.test(baseCss));
    const reducedBase = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(baseCss)?.[1] ?? "";
    ok("son animation se coupe en mouvement réduit",
       /boot-mascot[^}]*animation:\s*none/.test(reducedBase), reducedBase.replace(/\s+/g, " ").trim());

    // Le symbole est bien résolu dans le document rendu.
    ok("le rendu résout la référence",
       !!window.document.querySelector('.brand-mascot use[href="#mascot"]') &&
       !!window.document.querySelector("#mascot .m-body"));
}

console.log("\n[30] Tenue sur écran étroit");
{
    const html = readFileSync(`${ROOT}/index.html`, "utf8");
    ok("la fenêtre d'affichage est déclarée",
       /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html));

    const sheets = ["base", "home", "matrix", "quiz", "tokens"]
        .map(n => [n, readFileSync(`${ROOT}/css/${n}.css`, "utf8")]);

    /** Retire les blocs @media, pour ne garder que les règles inconditionnelles. */
    const withoutMedia = css => {
        let out = "";
        let i = 0;
        while (i < css.length) {
            const at = css.indexOf("@media", i);
            if (at < 0) { out += css.slice(i); break; }
            out += css.slice(i, at);
            let depth = 0;
            let j = css.indexOf("{", at);
            if (j < 0) break;
            for (; j < css.length; j++) {
                if (css[j] === "{") depth++;
                else if (css[j] === "}" && --depth === 0) { j++; break; }
            }
            i = j;
        }
        return out;
    };

    // Une largeur imposée au-delà de la plus petite fenêtre courante fait
    // déborder la page. Les caps (`max-width`) sont sans danger, les planchers
    // (`width`, `min-width`) non.
    const NARROWEST = 320;
    const offenders = [];
    for (const [name, css] of sheets) {
        const base = withoutMedia(css);
        for (const m of base.matchAll(/(^|[;{\s])(min-width|width)\s*:\s*(\d+)px/g)) {
            if (Number(m[3]) > NARROWEST) offenders.push(`${name}.css ${m[2]}: ${m[3]}px`);
        }
    }
    ok(`aucune largeur imposée au-delà de ${NARROWEST}px hors media query`,
       offenders.length === 0, offenders.join(" | "));

    // Les quatre feuilles qui portent de la mise en page doivent avoir un
    // traitement des écrans étroits.
    for (const [name, css] of sheets.filter(([n]) => n !== "tokens")) {
        ok(`${name}.css prévoit les écrans étroits`,
           /@media\s*\(max-width:\s*\d+px\)/.test(css));
    }

    const base = sheets.find(([n]) => n === "base")[1];
    const narrow = /@media\s*\(max-width:\s*560px\)\s*\{([\s\S]*)\n\}/.exec(base)?.[1] ?? "";
    // Le numéro de version a quitté la barre pour le haut de page, où il est
    // adossé à la promesse au lieu de flotter sans contexte. Sous 900 px, les
    // quatre ancres ne tiennent plus dans la pastille : elles passent dans un
    // panneau replié, et non aux oubliettes. Une page unique dont on ne peut
    // atteindre les sections qu'au défilement perd la moitié de sa navigation.
    const sousNeufCents = /@media\s*\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/.exec(base)?.[1] ?? "";
    ok("sous 900 px, un bouton remplace les ancres dans la barre",
       /\.nav-toggle\s*\{\s*display:\s*inline-grid/.test(sousNeufCents),
       sousNeufCents.replace(/\s+/g, " ").slice(0, 120));
    ok("et les ancres passent dans un panneau, jamais supprimées",
       /#topbar\[data-mode="home"\] #site-nav\s*\{[^}]*position:\s*absolute/.test(sousNeufCents) &&
       /#site-nav\.open\s*\{\s*display:\s*flex/.test(sousNeufCents));
    // Un lien de 20 px de haut ne s'attrape pas au doigt.
    ok("les liens du panneau ont la hauteur du doigt",
       /#topbar\[data-mode="home"\] \.nav-link\s*\{[^}]*min-height:\s*44px/.test(sousNeufCents));
    // Le bouton et la liste disent le même état, à deux publics.
    ok("l'état du menu est annoncé, pas seulement dessiné",
       /aria-expanded="false"/.test(readFileSync(`${ROOT}/index.html`, "utf8")) &&
       /setAttribute\("aria-expanded"/.test(readFileSync(`${ROOT}/js/main.js`, "utf8")));
    // Trois hauteurs, de la plus grande à la plus petite : au repos sur un
    // bureau, une fois la page défilée, puis sur un téléphone. Comparées plutôt
    // que fixées, pour que le réglage reste libre sans que l'ordre se perde.
    const hauteurs = [
        /#topbar\[data-mode="home"\]\s*\{[^}]*height:\s*(\d+)px/.exec(base)?.[1],
        /#topbar\[data-mode="home"\]\.scrolled\s*\{[^}]*height:\s*(\d+)px/.exec(base)?.[1],
        /#topbar\[data-mode="home"\]\s*\{[^}]*height:\s*(\d+)px/.exec(narrow)?.[1],
    ].map(Number);
    ok("la pastille se resserre en défilant, et sur un téléphone",
       hauteurs.every(h => h > 0) && hauteurs[1] < hauteurs[0] && hauteurs[2] < hauteurs[0],
       hauteurs.join(" / "));
    // La marque ne porte plus de sous-titre : « MAPTRIX maturité cyber »
    // répétait dans la barre ce que la page dit déjà en grand juste dessous.
    ok("la marque se réduit à son nom",
       /MAPTRIX\s*<\/button>/.test(readFileSync(`${ROOT}/index.html`, "utf8")));
    ok("la marque ne passe jamais à la ligne dans une barre de 48 px",
       /\.brand\s*\{[^}]*white-space:\s*nowrap/.test(base));

    // Un message long ne doit pas dépasser de l'écran.
    ok("les messages sont bridés à la largeur de la fenêtre",
       /#toasts\s*\{[^}]*max-width:\s*calc\(100vw/.test(base));

    const matrixCss = sheets.find(([n]) => n === "matrix")[1];
    ok("un menu déroulant ne peut pas être plus large que la fenêtre",
       /\.dropdown-panel\s*\{[^}]*max-width:\s*calc\(100vw/.test(matrixCss));

    // La légende repliable suppose que le markup porte bien la classe.
    ok("les états non chiffrables de la légende sont marqués pour être repliés",
       window.document.querySelectorAll("#matrix-legend .legend-item.aside").length === 2,
       String(window.document.querySelectorAll("#matrix-legend .legend-item.aside").length));

    // La page elle-même ne défile jamais latéralement : chaque vue gère son
    // propre débordement.
    ok("le corps de page ne défile pas", /body\s*\{[^}]*overflow:\s*hidden/.test(base));
    ok("la matrice défile dans son enveloppe, pas dans la page",
       /#matrix-wrapper\s*\{[^}]*overflow:\s*auto/.test(matrixCss));
    const quizCss = sheets.find(([n]) => n === "quiz")[1];
    ok("le questionnaire défile verticalement", /#view-quiz\s*\{[^}]*overflow-y:\s*auto/.test(quizCss));
    ok("l'accueil défile verticalement", /id="view-home" class="view scrollable"/.test(html));

    /* --- ce qu'on ne montre pas, ou autrement, sur un petit écran --- */

    const homeCss = sheets.find(([n]) => n === "home")[1];
    // Sur un téléphone, la matrice s'en va et la rosace prend sa place. Sept
    // colonnes sur 400 px font des colonnes de 50 px : les noms de techniques
    // n'y tiennent plus, et une matrice qu'on ne lit pas occupe un écran entier
    // avant qu'on arrive au bouton. La rosace dit la même chose dans un carré.
    const petitEcran = /@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/.exec(homeCss)?.[1] ?? "";
    ok("sur un téléphone, la matrice cède la place",
       /\.hero-matrix\s*\{\s*display:\s*none/.test(petitEcran));
    ok("et la rosace la remplace, sur toute la largeur",
       /\.hero-rosace\s*\{\s*display:\s*block[^}]*\}/.test(petitEcran) &&
       /\.hero-rosace \.rosace\s*\{[^}]*width:\s*100%/.test(petitEcran));
    ok("elle n'existe que là : ailleurs, c'est la matrice qui parle",
       /^\.hero-rosace\s*\{\s*display:\s*none/m.test(homeCss));
    ok("le haut de page se recentre",
       /\.hero-copy\s*\{[^}]*text-align:\s*center/.test(petitEcran));
    // Elle est bien rendue, pas seulement prévue par le CSS.
    ok("la rosace est présente dans le markup de l'accueil",
       !!home.querySelector(".hero-rosace .rosace"));
    ok("le haut de page passe sur une colonne quand la place manque",
       /@media\s*\(max-width:\s*1000px\)\s*\{[\s\S]*?\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(homeCss));
    // Les deux colonnes du parcours ne tiennent pas non plus : son intro cesse
    // d'être collée en haut, sinon elle occupe l'écran à elle seule.
    ok("le parcours repasse sur une colonne",
       /@media\s*\(max-width:\s*1000px\)\s*\{[\s\S]*?\.steps-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(homeCss) &&
       /\.steps-intro\s*\{[^}]*position:\s*static/.test(homeCss));
    // La FAQ, elle, n'a plus de deux colonnes à défaire : elle est centrée sur
    // une colonne à toutes les largeurs, pour ne pas redire la silhouette du
    // parcours deux sections plus haut.
    ok("la FAQ ne reprend pas la silhouette du parcours",
       /\.faq-grid\s*\{\s*display:\s*block/.test(homeCss) &&
       !/\.faq-grid\s*\{[^}]*grid-template-columns/.test(homeCss));
    // Le bloc de chiffres a été retiré du haut de page : plus une seule règle ne
    // doit le viser, sans quoi il reviendrait au premier copier-coller.
    ok("plus aucune mise en forme pour les chiffres retirés",
       !/\.home-figures|\.home-stats|\.figure\b/.test(homeCss));

    // Les étapes sont empilées à toutes les largeurs, numéro à gauche du texte,
    // reliées par un filet vertical. Ce qui cède quand la place manque, c'est le
    // décalage de la deuxième : en escalier sur un écran étroit, elle sortirait.
    ok("les étapes portent leur numéro à gauche du texte",
       /\.step\s*\{[^}]*padding-left:\s*\d+px/.test(homeCss));
    ok("le filet du parcours est vertical",
       /\.step:not\(:last-child\)::after\s*\{[^}]*width:\s*1px/.test(homeCss));
    ok("et l'escalier s'aplatit quand la place manque",
       /@media\s*\(max-width:\s*1000px\)\s*\{[\s\S]*?\.step:nth-child\(2\)\s*\{[^}]*margin-left:\s*0/.test(homeCss));

    // Le numéro de version vit dans le haut de page, pas dans la barre : il
    // disparaît donc avec l'accueil, sans que personne ait à le masquer. La
    // barre, elle, change de métier — pastille d'ancres ici, barre d'outil là.
    window.document.getElementById("brand").click();
    const topbar = window.document.getElementById("topbar");
    ok("la version est annoncée sur l'accueil",
       !!window.document.getElementById("version-badge"));
    ok("et la barre haute y est en mode « accueil »", topbar.dataset.mode === "home");
    ok("elle est portée par le haut de page, pas par la barre",
       !topbar.querySelector("#version-badge") &&
       !!window.document.querySelector("#view-home #version-badge"));
    window.document.getElementById("home-explore").click();
    // Les vues sont masquées, pas vidées : ce qui disparaît, c'est l'accueil
    // tout entier, et la version avec lui.
    ok("elle s'en va avec l'accueil",
       window.document.getElementById("view-home").classList.contains("hidden"));
    ok("et la barre haute redevient une barre d'outil", topbar.dataset.mode === "app");
}

/* --------------------------------------------- cohérence entre HTML et CSS */

console.log("\n[31] Le CSS servi est apparié au document qui le demande");
{
    // Le défaut observé : GitHub Pages sert le HTML et les scripts d'une
    // publication et le CSS de la précédente. Aucune erreur ne le signale, et la
    // page s'affiche en pièces détachées — sélecteurs récents absents, blocs
    // sans mise en forme. C'est ainsi que l'accueil est arrivé « en bordel » sur
    // mobile alors qu'il était correct dans le dépôt.
    const html = readFileSync(`${ROOT}/index.html`, "utf8");
    const stamper = /<script>([\s\S]*?document\.lastModified[\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    ok("les feuilles de style portent un jeton de publication", !!stamper);
    ok("le jeton vient de la date du document, pas d'un numéro à maintenir",
       /document\.lastModified/.test(stamper) && !/\bDate\.now\(\)/.test(stamper));
    ok("il s'applique à toutes les feuilles",
       /querySelectorAll\('link\[rel="stylesheet"\]'\)/.test(stamper));
    // Sans cela, deux jetons s'empileraient à chaque passage.
    ok("un jeton déjà présent est remplacé, pas accumulé",
       /split\("\?"\)\[0\]/.test(stamper));

    // Le jeton est posé avant le corps de page : après le premier rendu, le
    // navigateur a déjà peint avec la feuille périmée.
    ok("il est posé dans l'en-tête, avant tout affichage",
       html.indexOf("document.lastModified") < html.indexOf("<body"));

    /* --- le graphe de modules, versionné d'un seul tenant --- */

    // Coller le jeton sur `main.js` seul rechargerait le point d'entrée en
    // laissant ses imports en cache : le défaut d'origine à l'envers. Une carte
    // d'imports agit sur tout le graphe.
    ok("le graphe de modules passe par une carte d'imports",
       /type = "importmap"/.test(stamper) && /new URL\([^)]*document\.baseURI\)\.href/.test(stamper));
    // Le piège, mesuré dans le navigateur : une valeur de carte qui ne commence
    // ni par un protocole ni par « ./ » est normalisée à null, et le module
    // n'est pas seulement laissé sans jeton — il devient introuvable.
    ok("clés et valeurs de la carte sont des URL absolues",
       /imports\[url\] = url \+ "\?v=" \+ stamp/.test(stamper));
    ok("un seul point d'entrée, injecté avec son jeton",
       /entry\.src = carteSupportee \? "js\/main\.js\?v=" \+ stamp : "js\/main\.js"/.test(stamper) &&
       !/<script type="module"/.test(html));

    // Sur un navigateur trop ancien pour les cartes d'imports, la carte serait
    // ignorée et les modules deviendraient introuvables : page morte. On y
    // charge sans jeton — risquer une version en cache plutôt que rien du tout.
    // Et surtout pas le point d'entrée seul, qui rendrait le mélange certain.
    ok("un navigateur sans carte d'imports charge quand même l'application",
       /HTMLScriptElement\.supports\("importmap"\)/.test(stamper) &&
       /if \(carteSupportee\) \{/.test(stamper));

    // La liste des modules est écrite à la main : si un module s'ajoute sans y
    // figurer, il n'est plus versionné et le mélange redevient possible. C'est
    // cette assertion qui tient la discipline, pas la mémoire de qui code.
    const listed = [...(/var modules = \[([\s\S]*?)\];/.exec(stamper)?.[1] ?? "")
        .matchAll(/"([^"]+)"/g)].map(m => `${m[1]}.js`).sort();
    const onDisk = ["", "views/"].flatMap(dir =>
        readdirSync(`${ROOT}/js/${dir}`, { withFileTypes: true })
            .filter(e => e.isFile() && e.name.endsWith(".js"))
            .map(e => `${dir}${e.name}`)).sort();
    ok("la carte couvre exactement les modules du dossier js/",
       listed.join(",") === onDisk.join(","),
       `manquants : ${onDisk.filter(m => !listed.includes(m)).join(", ") || "aucun"} · ` +
       `en trop : ${listed.filter(m => !onDisk.includes(m)).join(", ") || "aucun"}`);

    // En file:// les modules ne chargent pas : le diagnostic doit pouvoir
    // s'expliquer sur une page encore mise en forme.
    ok("rien n'est réécrit en file://, pour garder le message de démarrage lisible",
       /if \(location\.protocol === "file:"\) return;/.test(stamper));
}

/* ------------------------------------------------ mise en forme du classeur */

console.log("\n[32] Mise en forme du classeur");
{
    const { RAMPE } = await import(`${APP}/js/excel.js`);
    const { ANSWERS: REPONSES, LEVEL_LABELS: PALIERS } = await import(`${APP}/js/catalog.js`);
    const FEUILLE_REPONSES = "Réponses";

    // La rampe du classeur doit être celle du thème clair : un classeur a un fond
    // blanc, la rampe sombre y serait illisible. Elle est recopiée dans le module
    // — le banc écrit le fichier sans aucun CSS — donc on vérifie qu'elle n'a pas
    // divergé. Le thème clair est déclaré deux fois dans tokens.css, les deux
    // sont comparées.
    const tokens = readFileSync(`${ROOT}/css/tokens.css`, "utf8");
    const blocsClairs = [
        /@media \(prefers-color-scheme: light\)[\s\S]*?\n\}/.exec(tokens)?.[0],
        /:root\[data-theme="light"\][\s\S]*?\n\}/.exec(tokens)?.[0],
    ];
    for (const [i, bloc] of blocsClairs.entries()) {
        const lus = [0, 1, 2, 3, 4].map(n =>
            new RegExp(`--lvl${n}:\\s*#([0-9a-fA-F]{6})`).exec(bloc ?? "")?.[1]?.toUpperCase());
        ok(`la rampe du classeur suit le thème clair (bloc ${i + 1})`,
           lus.join(",") === RAMPE.map(c => c.slice(2)).join(","),
           `CSS ${lus.join(",")} / classeur ${RAMPE.map(c => c.slice(2)).join(",")}`);
    }

    /* --- un classeur réaliste, écrit puis relu depuis ses octets --- */
    const niveaux = new Map([["M1013", 0], ["M1015", 1], ["M1016", 2], ["M1017", 3], ["M1018", 4]]);
    const donnees = {
        version: "19.1",
        mitigations: [...niveaux.keys()].map(id => ({ id, name: `Mitigation ${id}`, techniques: ["T1078"] })),
        tactics: [
            { name: "Initial Access", shortname: "initial-access" },
            { name: "Execution", shortname: "execution" },
        ],
        byTactic: new Map([
            ["initial-access", [{ id: "T1078", name: "Valid Accounts" }, { id: "T1190", name: "Exploit Public-Facing Application" }]],
            ["execution", [{ id: "T1059", name: "Command and Scripting Interpreter" }]],
        ]),
        subTechniques: [{ id: "T1078.001", name: "Default Accounts" }, { id: "T1078.002", name: "Domain Accounts" }],
    };
    const etats = new Map([
        ["T1078", { state: "scored", score: 3.5, level: 4, mitigations: [{ id: "M1018", level: 4 }] }],
        ["T1190", { state: "unscored", score: null, level: null, mitigations: [{ id: "M1013", level: null }] }],
        ["T1059", { state: "no-mitigation", score: null, level: null, mitigations: [] }],
    ]);

    const brut = buildWorkbook(ExcelJS, createLayer({ name: "Mise en forme" }), donnees, etats, niveaux);
    const relu2 = new ExcelJS.Workbook();
    await relu2.xlsx.load(await brut.xlsx.writeBuffer());

    /* --- le trio qui rend une feuille utilisable --- */
    const aPlat = ["Réponses", "Mitigations", "Techniques"];
    for (const nom of aPlat) {
        const ws = relu2.getWorksheet(nom);
        const vue = ws.views?.[0] ?? {};
        ok(`« ${nom} » garde ses intitulés au défilement`,
           vue.state === "frozen" && vue.ySplit === 1, JSON.stringify(vue));
        ok(`« ${nom} » se filtre`, !!ws.autoFilter, JSON.stringify(ws.autoFilter));
        const sansLargeur = ws.columns.filter(c => !c.width).length;
        ok(`« ${nom} » a toutes ses colonnes dimensionnées`, sansLargeur === 0, `${sansLargeur} sans largeur`);
    }
    // La grille gèle deux lignes : le nom de la tactique et son effectif.
    ok("la grille garde ses en-têtes de tactique",
       relu2.getWorksheet("Matrice").views?.[0]?.ySplit === 2);
    // Une colonne de grille laissée à la largeur par défaut tronquerait le nom de
    // la technique. ExcelJS regroupe les colonnes de même largeur en une seule
    // déclaration : on interroge donc chaque colonne, pas la liste.
    {
        const grilleWs = relu2.getWorksheet("Matrice");
        const etroites = donnees.tactics
            .map((_, i) => grilleWs.getColumn(i + 1).width)
            .filter(w => !w || w < 20);
        ok("chaque colonne de la grille est assez large pour son contenu",
           etroites.length === 0, `${etroites.length} colonnes trop étroites`);
    }

    /* --- des en-têtes traités à l'identique, et lisibles --- */

    // Un style posé sur une colonne s'applique aussi à son en-tête : en stylant
    // les colonnes après l'en-tête, chaque titre héritait de l'alignement de ses
    // données et le bandeau devenait bariolé.
    const alignements = new Set();
    const tronques = [];
    for (const ws of relu2.worksheets) {
        if (ws.name === "Métadonnées") continue;      // pas de ligne de titres
        ws.getRow(1).eachCell((cell, col) => {
            const a = cell.alignment ?? {};
            alignements.add(`${a.horizontal}/${a.vertical}/${a.wrapText}`);
            // Un mot plus large que sa colonne n'est pas replié, il est coupé —
            // et il faut de la marge : les titres sont en gras, alors que la
            // largeur se compte en caractères de la police par défaut. Excel sait
            // replier sur un trait d'union, pas ailleurs.
            const mots = String(cell.value ?? "").split(/[\s-]+/).map(m => m.length);
            const requis = Math.max(...mots, 1) + 2;
            const largeur = ws.getColumn(col).width ?? 0;
            if (largeur < requis) tronques.push(`${ws.name}!${cell.address} ${largeur}<${requis}`);
        });
    }
    ok("tous les titres de colonne sont traités à l'identique",
       alignements.size === 1 && [...alignements][0] === "center/middle/true",
       [...alignements].join(" | "));
    ok("chaque titre tient dans sa colonne",
       tronques.length === 0, tronques.slice(0, 4).join(" · "));
    ok("la ligne de titres est assez haute pour les titres repliés",
       relu2.worksheets.filter(w => w.name !== "Métadonnées")
           .every(w => (w.getRow(1).height ?? 0) >= 21),
       relu2.worksheets.map(w => `${w.name}:${w.getRow(1).height}`).join(" "));

    /* --- la note de la mitigation, là où on la cherche --- */
    const reponses = relu2.getWorksheet(FEUILLE_REPONSES);
    const titres = [];
    reponses.getRow(1).eachCell(c => titres.push(String(c.value)));
    ok("la feuille Réponses porte la note", titres.includes("Note"), titres.join(" | "));
    // « Niveau attribué » désignait le palier de la question : le nom laissait
    // croire à une note obtenue.
    ok("et distingue le palier de la question de cette note",
       titres.includes("Palier de la question") && !titres.includes("Niveau attribué"),
       titres.join(" | "));
    // Le nom de la mitigation n'est plus répété sur chaque ligne : il tient la
    // ligne de synthèse. L'identifiant reste, la relecture en dépend.
    ok("les lignes ne répètent plus le nom de la mitigation",
       !titres.includes("Nom") && titres.includes("Mitigation"), titres.join(" | "));
    // Plus rien ne réclame de justificatif : l'outil est la seule pièce demandée,
    // et il reste facultatif.
    ok("aucune colonne ne réclame de preuve documentaire",
       !titres.includes("Vérification documentaire") &&
       titres.includes("Outil (si applicable)"), titres.join(" | "));

    /* --- la ligne qui clôt chaque bloc --- */
    {
        const colNote = titres.indexOf("Note") + 1;
        const colQuestion = titres.indexOf("Question") + 1;
        const colNum = titres.indexOf("N°") + 1;

        // Une ligne de synthèse se reconnaît à son fond et à l'absence de numéro
        // de question — c'est cette absence qui fait que la relecture l'ignore.
        const bloc = [];
        reponses.eachRow((row, i) => {
            if (i === 1) return;
            const fond = row.getCell(colNote).fill?.fgColor?.argb
                ?? row.getCell(1).fill?.fgColor?.argb;
            if (!fond || fond === "FFFFFFFF") return;
            if (row.getCell(colNum).value) return;
            bloc.push({
                ligne: i,
                libelle: String(row.getCell(colQuestion).value ?? ""),
                note: row.getCell(colNote).value,
                fondNote: row.getCell(colNote).fill?.fgColor?.argb?.toUpperCase(),
            });
        });

        ok("un bloc de questions est clos par une ligne de synthèse",
           bloc.length === QST.size, `${bloc.length} synthèses pour ${QST.size} mitigations`);
        ok("elle nomme la mitigation et compte ses questions",
           bloc.every(b => / : \d+ questions?$/.test(b.libelle)),
           bloc.find(b => !/ : \d+ questions?$/.test(b.libelle))?.libelle ?? bloc[0]?.libelle);
        ok("elle porte la note, peinte au palier atteint",
           bloc.filter(b => Number.isInteger(b.note)).every(b => b.fondNote === RAMPE[b.note]),
           bloc.filter(b => Number.isInteger(b.note)).slice(0, 3)
               .map(b => `${b.note}->${b.fondNote}`).join(" "));
        // Une mitigation non évaluée ne doit pas passer pour un niveau 0.
        ok("une mitigation non évaluée affiche un tiret, pas un zéro",
           bloc.filter(b => !Number.isInteger(b.note)).every(b => b.note === "-"),
           [...new Set(bloc.filter(b => !Number.isInteger(b.note)).map(b => String(b.note)))].join(","));

        // Le défaut trouvé en chemin : dans une comparaison numérique, Excel
        // traite une cellule vide comme un zéro. Une règle « = 0 » teintait donc
        // en rouge tout ce qui n'était pas encore évalué.
        const regles = (relu2.getWorksheet("Mitigations").conditionalFormattings ?? [])
            .flatMap(p => p.rules);
        const expressions = regles.filter(r => r.type === "expression");
        ok("les règles de couleur écartent explicitement les cellules vides",
           expressions.length >= 5 && expressions.every(r => /<>""/.test(r.formulae?.[0] ?? "")),
           expressions[0]?.formulae?.[0]);

        // La bibliothèque n'écrit aucun graphique — le format les décrit dans des
        // pièces séparées qu'elle ne produit pas. Une barre de données, elle, est
        // une mise en forme conditionnelle : elle vit dans la cellule, suit le
        // tri et le filtre, et le nombre reste lisible à côté d'elle.
        const barre = regles.find(r => r.type === "dataBar");
        ok("le levier de chaque mitigation se lit en barres de données",
           !!barre && barre.color?.argb === "FF2A78D6",
           JSON.stringify({ type: barre?.type, color: barre?.color?.argb }));
        ok("la barre s'ajoute au nombre, elle ne le remplace pas",
           barre?.showValue !== false, String(barre?.showValue));
        const colBarre = (relu2.getWorksheet("Mitigations").conditionalFormattings ?? [])
            .find(p => p.rules.some(r => r.type === "dataBar"))?.ref;
        ok("et elle porte sur le nombre de techniques couvertes",
           colBarre === `${relu2.getWorksheet("Mitigations").getColumn(6).letter}2:`
               + `${relu2.getWorksheet("Mitigations").getColumn(6).letter}${relu2.getWorksheet("Mitigations").rowCount}`,
           colBarre);
    }

    /* --- la colonne des réponses : liste fermée et couleur --- */
    const colReponse = reponses.getColumn(titres.indexOf("Réponse") + 1).letter;
    const validation = reponses.getCell(`${colReponse}2`).dataValidation;
    ok("la colonne Réponse n'accepte que les valeurs relues",
       validation?.type === "list" &&
       validation.formulae?.[0] === `"${REPONSES.join(",")}"`,
       JSON.stringify(validation));
    const mfcReponses = reponses.conditionalFormattings ?? [];
    ok("et se lit en couleur",
       mfcReponses.some(f => f.rules.length === REPONSES.length),
       `${mfcReponses.length} plages`);

    /* --- la maturité en mise en forme conditionnelle --- */
    for (const [nom, colonne] of [["Mitigations", "C"], ["Techniques", "D"]]) {
        const ws = relu2.getWorksheet(nom);
        const plages = ws.conditionalFormattings ?? [];
        const regles = plages.flatMap(p => p.rules);
        const couleurs = regles
            .map(r => r.style?.fill?.bgColor?.argb?.toUpperCase())
            .filter(Boolean);
        ok(`« ${nom} » colore la maturité par règle, non à la main`,
           plages.some(p => p.ref.startsWith(colonne)) && regles.length >= 5,
           `${regles.length} règles sur ${plages.map(p => p.ref).join(" ")}`);
        ok(`« ${nom} » emploie exactement la rampe`,
           RAMPE.every(c => couleurs.includes(c)),
           couleurs.join(" "));
    }

    /* --- la grille : peinte, mais jamais muette --- */
    const grille = relu2.getWorksheet("Matrice");
    const cellule = grille.getCell(3, 1);        // T1078, score 3,5 -> palier 4
    ok("la grille peint la case à son palier",
       cellule.fill?.fgColor?.argb?.toUpperCase() === RAMPE[4],
       JSON.stringify(cellule.fill));
    ok("et imprime le score : la couleur ne porte jamais l'information seule",
       /T1078/.test(String(cellule.value)) && /3,50/.test(String(cellule.value)),
       String(cellule.value));
    const sansMitigation = [...Array(6)].map((_, r) => String(grille.getCell(r + 3, 2).value ?? ""));
    ok("une technique sans mitigation le dit",
       sansMitigation.some(v => /pas de mitigation/.test(v)), sansMitigation.join(" | "));
    ok("une technique non évaluée le dit aussi",
       [...Array(6)].map((_, r) => String(grille.getCell(r + 3, 1).value ?? ""))
           .some(v => /non évalué/.test(v)));

    // Sans légende, les couleurs sont muettes pour qui reçoit le fichier.
    const texteGrille = [];
    grille.eachRow(row => row.eachCell(c => texteGrille.push(String(c.value ?? ""))));
    ok("la grille porte la légende de l'échelle",
       texteGrille.some(t => /Échelle de maturité/.test(t)) &&
       PALIERS.every(l => texteGrille.some(t => t.includes(l))),
       PALIERS.filter(l => !texteGrille.some(t => t.includes(l))).join(", ") || "tous présents");

    /* --- l'en-tête --- */
    const tete = reponses.getRow(1);
    ok("le bandeau d'en-tête est lisible : fond plein, texte blanc",
       tete.getCell(1).fill?.fgColor?.argb === "FF2A3140" &&
       tete.getCell(1).font?.color?.argb === "FFFFFFFF" &&
       tete.getCell(1).font?.bold === true,
       JSON.stringify({ fill: tete.getCell(1).fill, font: tete.getCell(1).font }));

    /* --- aller-retour à pleine échelle --- */

    // L'aller-retour de la section [9] porte sur une seule mitigation. Ici on
    // écrit tout le catalogue, on relit les octets produits et on compare réponse
    // par réponse : c'est ce qui garantit qu'un renommage ou un déplacement de
    // colonne ne casse pas l'import **en silence** — l'import cherche « Réponse »
    // et « Outil (si applicable) » par leur intitulé, rien ne l'avertirait de leur
    // disparition sinon.
    const complet = createLayer({ name: "Pleine échelle", respondent: { org: "Direction des SI" } });
    complet.scoring = "cumulative";
    let n = 0;
    for (const [id, questionnaire] of QST) {
        n++;
        if (n % 3 === 0) continue;                       // une mitigation sur trois reste vierge
        const arret = (n * 7) % (questionnaire.questions.length + 1);
        for (const [k, question] of questionnaire.questions.entries()) {
            if (k > arret) break;
            setAnswer(complet, id, question.num, {
                value: k === arret ? "Non" : "Oui",
                tool: k === 0 ? "Entra ID" : "",
            });
        }
    }

    const wbComplet = buildWorkbook(ExcelJS, complet, donnees, etats, mitigationLevels(complet));
    const reluComplet = new ExcelJS.Workbook();
    await reluComplet.xlsx.load(await wbComplet.xlsx.writeBuffer());
    const reprise = readWorkbook(reluComplet, { name: "Reprise" });

    const aplat = l => Object.entries(l.answers).flatMap(([id, qs]) =>
        Object.entries(qs).map(([q, e]) => `${id}/${q}=${e.value}${e.tool ? `|${e.tool}` : ""}`))
        .sort().join(",");
    ok("aller-retour à pleine échelle, réponse par réponse",
       aplat(complet) === aplat(reprise),
       `${progress(complet).answered} écrites, ${progress(reprise).answered} relues`);

    // Ce qui compte au bout du compte : la matrice doit se recolorer à l'identique.
    const notesEcrites = mitigationLevels(complet);
    const notesRelues = mitigationLevels(reprise);
    const divergentes = [...notesEcrites.keys()]
        .filter(id => notesEcrites.get(id) !== notesRelues.get(id));
    ok("et les notes recalculées sont identiques",
       divergentes.length === 0 && notesEcrites.size > 20,
       `${notesEcrites.size} notes, ${divergentes.length} divergentes ${divergentes.slice(0, 4).join(" ")}`);

    /* --- le chemin complet de l'interface --- */

    // Jusqu'ici l'aller-retour partait d'un objet en mémoire. Ce qu'un utilisateur
    // fait vraiment, c'est déposer un fichier : extension reconnue, bibliothèque
    // demandée, octets relus. Ce chemin-là n'était couvert par rien.
    const depose = new window.File(
        [await wbComplet.xlsx.writeBuffer()], "reprise-du-classeur.xlsx",
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const importe = await readLayerFile(depose);
    ok("un classeur déposé dans l'interface est repris",
       progress(importe).answered === progress(complet).answered,
       `${progress(importe).answered} réponses reprises sur ${progress(complet).answered}`);
    // Le fichier ne porte plus le nom du layer — il s'appelle « maptrix »,
    // suffixé de l'organisation. C'est donc la feuille Métadonnées qui rend son
    // identité à l'évaluation ; sans cette lecture, un aller-retour par le
    // classeur la rebaptiserait du nom du fichier et perdrait l'organisation,
    // celle-là même qui nomme le fichier au réexport.
    ok("et le layer retrouve son nom dans les métadonnées, pas dans celui du fichier",
       importe.name === "Pleine échelle", importe.name);
    ok("l'organisation revient avec, et renomme le fichier à l'identique",
       importe.respondent.org === "Direction des SI" &&
       exportName(importe) === "maptrix-direction-des-si",
       `${importe.respondent.org} → ${exportName(importe)}`);
    ok("la méthode de notation survit au passage par le classeur",
       importe.scoring === "cumulative", importe.scoring);
    ok("les outils saisis reviennent avec",
       Object.values(importe.answers).some(qs => Object.values(qs).some(e => e.tool === "Entra ID")));

    /* --- la bibliothèque n'est pas chargée au démarrage --- */
    const html = readFileSync(`${ROOT}/index.html`, "utf8");
    ok("la bibliothèque Excel ne pèse pas sur le démarrage",
       !/<script[^>]*(xlsx|exceljs)[^>]*>/i.test(html));
    const excelSrc = readFileSync(`${ROOT}/js/excel.js`, "utf8");
    ok("elle est chargée au premier besoin, et une seule fois",
       /chargement \?\?=/.test(excelSrc) && /cdnjs[^"]*exceljs/.test(excelSrc));
}

console.log("\n[33] Le fichier de données généré");
{
    /* Le référentiel n'est plus téléchargé : il est commité. Ce fichier devient
       donc du code publié comme un autre, et rien ne le relit au démarrage pour
       s'apercevoir qu'il est vide, tronqué ou d'une autre forme. Ces assertions
       sont le seul filet. */
    const genere = readFileSync(`${ROOT}/js/attack-data.js`, "utf8");
    ok("le fichier généré est présent", genere.length > 0);
    ok("il porte l'avertissement de non-modification", /ne pas modifier à la main/.test(genere));

    /* Les données sont posées en JSON dans une chaîne plutôt qu'en littéral
       d'objet : `JSON.parse` est nettement plus rapide que l'analyse syntaxique
       du même contenu écrit en JavaScript, et sur plus d'un mégaoctet ça se voit
       au démarrage. Si quelqu'un régénère autrement, ce gain part en silence. */
    ok("les données passent par JSON.parse", /export default JSON\.parse\('/.test(genere));

    const reel = (await import(`${ROOT}/js/attack-data.js`)).default;
    ok("la version est renseignée", /^\d+\.\d+$/.test(String(reel.version)), String(reel.version));
    ok("les tactiques sont là", reel.tactics.length >= 10, String(reel.tactics.length));
    ok("les techniques parentes sont là", reel.techniques.length >= 150, String(reel.techniques.length));
    ok("les mitigations sont là", reel.mitigations.length >= 30, String(reel.mitigations.length));
    ok("des rattachements mitigation -> technique existent",
       reel.mitigations.reduce((n, m) => n + m.techniques.length, 0) >= 500);

    /* La réduction ne doit rien laisser passer d'inutile : c'est tout l'intérêt
       de l'opération, et une régression du générateur se verrait d'abord ici. */
    const champsTechnique = new Set(reel.techniques.flatMap(t => Object.keys(t)));
    ok("aucun champ inattendu sur les techniques",
       [...champsTechnique].every(c => ["stixId", "id", "name", "description", "url",
                                        "platforms", "tactics", "isSub", "subs"].includes(c)),
       [...champsTechnique].join(", "));

    /* Le poids est la raison d'être de tout ceci. Derrière un proxy qui
       décompresse, c'est la taille brute qui est transférée : 53,8 Mo avant,
       ~1,3 Mo maintenant. Le seuil laisse de la marge pour la croissance normale
       du référentiel, mais pas pour un retour au bundle complet. */
    ok("le fichier reste petit", genere.length < 4 * 1024 * 1024,
       `${(genere.length / 1048576).toFixed(2)} Mo`);

    /* Et il doit être à jour de son générateur : régénérer doit rendre le même
       fichier, sinon le dépôt porte une sortie qui ne correspond plus au code
       qui la produit. On rejoue la réduction sur le mini-bundle, où le résultat
       est connu, plutôt que de retélécharger 54 Mo à chaque exécution. */
    const rejoue = reduire(bundle, RELEASE);
    ok("le générateur est déterministe",
       JSON.stringify(rejoue) === JSON.stringify(DONNEES));
}


console.log("\n[34] Le fichier exporté porte l'organisation");
{
    window.document.getElementById("brand").click();
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-name").value = "Évaluation nommée n'importe comment";
    window.document.getElementById("nl-ok").click();
    window.document.getElementById("q-matrix").click();
    window.document.getElementById("dd-export-btn").click();

    const champ = window.document.getElementById("ex-org");
    ok("l'organisation se saisit au moment d'exporter", !!champ);
    ok("elle est facultative : sans elle, le fichier porte le nom de l'outil",
       window.document.getElementById("ex-name").textContent.startsWith("maptrix."),
       window.document.getElementById("ex-name").textContent);

    champ.value = "Groupe Étoile & Cie";
    champ.oninput();
    ok("le nom du fichier s'annonce avant de cliquer",
       window.document.getElementById("ex-name").textContent === "maptrix-groupe-etoile-cie.xlsx / .json",
       window.document.getElementById("ex-name").textContent);

    // Le nom du layer, lui, est libre : il n'a jamais fait un bon nom de fichier.
    ok("le nom du layer ne nomme plus le fichier",
       !/n-importe-comment/.test(window.document.getElementById("ex-name").textContent));

    // L'organisation n'est pas une donnée de l'export : elle appartient au layer,
    // et se retrouve donc dans les métadonnées du classeur comme du JSON.
    const parJSON = JSON.parse(toJSON(fromJSON(toJSON({
        ...createLayer({ name: "x", respondent: { org: "Groupe Étoile & Cie" } }), catalog: CATALOG,
    }))));
    ok("elle voyage avec le layer, pas seulement avec le nom du fichier",
       parJSON.respondent.org === "Groupe Étoile & Cie", parJSON.respondent.org);
}

console.log("\n[35] Ce qui a été retiré du questionnaire");
{
    const quizCss = readFileSync(`${ROOT}/css/quiz.css`, "utf8");
    // Au doigt, le dernier bouton touché reste en `:hover` jusqu'au toucher
    // suivant. La question suivante réutilisant le bouton du même endroit, elle
    // s'affichait avec une réponse en apparence déjà choisie.
    const survol = /@media \(hover: hover\)\s*\{([\s\S]*?)\n\}/.exec(quizCss)?.[1] ?? "";
    ok("le survol d'une réponse est réservé au pointeur",
       ["yes", "no", "na"].every(c => new RegExp(`\\.quiz-answer\\.${c}:hover`).test(survol)),
       survol.replace(/\s+/g, " ").trim().slice(0, 90));
    ok("aucune règle de survol ne subsiste hors de ce garde-fou",
       !quizCss.replace(/@media \(hover: hover\)\s*\{[\s\S]*?\n\}/, "").includes(".quiz-answer:hover"));
    ok("seule la classe posée par le code colore une réponse choisie",
       ["yes", "no", "na"].every(c => new RegExp(`\\.quiz-answer\\.${c}\\.selected\\s*\\{`).test(quizCss)));

    // La preuve documentaire n'est plus demandée : seul l'outil reste, facultatif.
    const catalogSrc = readFileSync(`${ROOT}/js/catalog.js`, "utf8");
    ok("le catalogue ne porte plus d'exigence de preuve documentaire",
       !/docRequired/.test(catalogSrc) &&
       ![...CATALOG.values()].some(q => q.questions.some(x => "docRequired" in x)));
    ok("le générateur du catalogue ne la reprend plus",
       !/docRequired/.test(readFileSync(`${ROOT}/tools/build-catalog.mjs`, "utf8")));
    ok("le questionnaire n'affiche plus de mention de preuve attendue",
       !/doc-flag|preuve documentaire attendue/.test(readFileSync(`${ROOT}/js/views/quiz.js`, "utf8")) &&
       !/doc-flag/.test(quizCss));
    ok("la case outil reste, et reste facultative",
       /Outil en place, si applicable/.test(readFileSync(`${ROOT}/js/views/quiz.js`, "utf8")));
}

console.log("\n[35b] Ce que la question n'affiche plus, et ce qu'elle propose");
{
    const { needsTool } = await import(`${APP}/js/tool-questions.js`);
    const { QUESTIONNAIRES: QS } = await import(`${APP}/js/catalog.js`);

    window.document.getElementById("brand").click();
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-ok").click();

    // L'en-tête de question portait trois indications sur le même sujet : la
    // frise, sa légende, et « Niveau visé : 1 — Informel » juste en dessous. La
    // frise reste seule — elle situe le niveau parmi les cinq, ce que les deux
    // autres ne faisaient que redire en mots.
    ok("la frise des niveaux reste", !!window.document.querySelector(".level-track"));
    ok("sa légende est retirée", !window.document.querySelector(".track-caption"));
    ok("le niveau visé n'est plus écrit sous la question",
       !window.document.querySelector(".quiz-card-level"));
    ok("la barre d'avancement reste, sans son double chiffré",
       !!window.document.querySelector(".quiz-progress-bar") &&
       !window.document.querySelector(".quiz-progress-label"));

    // Reculer depuis la première question n'a pas de sens : le bouton n'est pas
    // affiché plutôt que désactivé — un bouton grisé se propose encore.
    ok("« Précédent » est absent sur la première question",
       !window.document.getElementById("q-back"));
    window.document.querySelector('[data-answer="Oui"]').click();
    ok("et il apparaît dès la deuxième", !!window.document.getElementById("q-back"));

    /* --- le champ « Outil en place » --- */

    // La colonne F du classeur est vide partout : elle attend la saisie du
    // répondant, elle ne déclare pas qui la mérite. Le champ est donc déduit du
    // texte de la question — un moyen technique déployé, oui ; une pratique ou
    // une politique, non.
    const q = id => QS.get(id).questions;
    ok("un moyen technique demande l'outil",
       needsTool("M1049", q("M1049").find(x => /antivirus/i.test(x.text))),
       "M1049 · antivirus");
    ok("une formation n'en demande pas",
       !needsTool("M1013", q("M1013").find(x => /formation/i.test(x.text))),
       "M1013 · formation");
    ok("une politique formelle non plus",
       !needsTool("M1031", q("M1031").find(x => /politique formelle/i.test(x.text))),
       "M1031 · politique");
    // Une phrase qui cite des produits en exemple demande un produit, quoi
    // qu'elle dise par ailleurs.
    ok("citer des produits en exemple tranche la question",
       needsTool("M1045", q("M1045").find(x => /AppLocker/.test(x.text))),
       "M1045 · (ex : AppLocker, WDAC…)");

    // Le champ ne concerne qu'une minorité de questions : s'il apparaissait
    // partout, il cesserait d'être une demande pour devenir un décor.
    let avec = 0, total = 0;
    for (const [id, quest] of QS) {
        total += quest.questions.length;
        avec += quest.questions.filter(x => needsTool(id, x)).length;
    }
    ok("il ne s'affiche que sur une minorité de questions",
       avec > 0 && avec < total * 0.5, `${avec} sur ${total}`);

    ok("les deux phrases sous le champ sont retirées",
       !window.document.querySelector(".quiz-tool .help") &&
       !window.document.querySelector(".quiz-refs"));

    /* --- faire suivre la question --- */

    // Personne ne connaît les quarante-trois sujets. Plutôt que de laisser
    // répondre à peu près, on prépare le message pour qui saura.
    const ouverte = window.document.querySelector(".quiz-tag")?.textContent.trim();
    window.document.getElementById("q-ask").click();
    const corps = window.document.getElementById("ask-body")?.value ?? "";
    const question = window.document.querySelector(".quiz-question")?.textContent.trim() ?? "";
    ok("le message reprend la question mot pour mot", corps.includes(question),
       corps.slice(0, 60));
    ok("il situe la mitigation et explique les trois réponses",
       /M1013/.test(corps) && /Oui/.test(corps) && /Non/.test(corps) && /N\/A/.test(corps));

    // Le destinataire ne connaît pas forcément ATT&CK, ni la démarche : sans un
    // mot d'explication, le message arrive comme un questionnaire de plus, venu
    // d'on ne sait où et pour on ne sait quoi.
    ok("il explique ce qu'est le référentiel", /MITRE ATT&CK/.test(corps) &&
       /techniques réellement/.test(corps), corps.split("\n").slice(2, 4).join(" "));
    ok("et désamorce l'idée d'une bonne réponse attendue",
       /pas de bonne réponse attendue/.test(corps));

    // Un objet doit se comprendre seul dans une boîte de réception :
    // « Maturité cyber — M1013 question 1 » ne disait ni de quoi il s'agit, ni
    // ce qu'on attend.
    const objet = window.document.getElementById("ask-subject")?.value ?? "";
    ok("l'objet nomme le sujet plutôt qu'un identifiant",
       objet.includes("Application Developer Guidance") && !/question \d/.test(objet), objet);
    ok("et il reste modifiable, le lien suivant la saisie",
       window.document.getElementById("ask-mail")?.getAttribute("href")
           .includes(encodeURIComponent(objet).slice(0, 40)));

    // Rien ne part d'ici : le site ne parle à aucun service.
    ok("rien n'est envoyé, on copie ou on ouvre sa messagerie",
       !!window.document.getElementById("ask-copy") &&
       window.document.getElementById("ask-mail")?.getAttribute("href").startsWith("mailto:"));

    // Faire suivre, c'est reconnaître qu'on ne peut pas répondre maintenant : la
    // mitigation est laissée telle quelle — aucune réponse inventée — et le
    // parcours passe à la suivante au lieu d'y buter.
    window.document.getElementById("ask-mail").click();
    ok("la modale se ferme", !window.document.getElementById("ask-body"));
    const apres = window.document.querySelector(".quiz-tag")?.textContent.trim();
    ok("et le questionnaire passe à la mitigation suivante", apres && apres !== ouverte,
       `${ouverte} → ${apres}`);
    ok("sans inventer de réponse à celle qu'on a laissée",
       !window.document.querySelector(".quiz-answer.selected"));

    // La mitigation écartée ne doit pas revenir au premier détour : `nextTarget`
    // rendrait indéfiniment la première mitigation incomplète, donc celle qu'on
    // vient justement de mettre de côté.
    window.document.getElementById("q-matrix").click();
    window.document.getElementById("matrix-quiz").click();
    ok("revenir au questionnaire ne ramène pas sur celle mise en attente",
       window.document.querySelector(".quiz-tag")?.textContent.trim() !== ouverte,
       window.document.querySelector(".quiz-tag")?.textContent.trim());

    // Et elle n'est pas perdue pour autant : rien n'y étant répondu, elle
    // redevient la prochaine à traiter dès qu'on repart d'un layer neuf.
    window.document.getElementById("brand").click();
    window.document.getElementById("home-new").click();
    window.document.getElementById("nl-ok").click();
    ok("un layer neuf repart du début, sans mémoire des mises en attente",
       window.document.querySelector(".quiz-tag")?.textContent.trim() === ouverte,
       window.document.querySelector(".quiz-tag")?.textContent.trim());
}

console.log("\n[35c] Le tableau de bord");
{
    const { CATALOG: CATA } = await import(`${APP}/js/catalog.js`);
    const { createLayer, setAnswer, toJSON: enJSON, fromJSON: depuisJSON } = await import(`${APP}/js/layer.js`);
    const { buildMatrixScores, tacticLevels } = await import(`${APP}/js/scoring.js`);
    const donnees = await (await import(`${APP}/js/attack.js`)).loadAttack();

    // Un layer où une seule mitigation est notée : de quoi distinguer une
    // tactique mesurée d'une tactique qui ne l'est pas.
    const l = createLayer({ name: "Tableau de bord" });
    for (const q of CATA.get("M1032").questions) setAnswer(l, "M1032", q.num, { value: "Oui" });

    window.document.getElementById("brand").click();
    const zone = window.document.getElementById("home-drop");
    const depot = new window.Event("drop");
    depot.dataTransfer = { files: [new window.File([enJSON(l)], "dash.json", { type: "application/json" })] };
    zone.dispatchEvent(depot);
    await new Promise(r => setTimeout(r, 80));
    window.document.getElementById("q-matrix").click();

    // Le layer relu par l'application, avec son catalogue rattaché : c'est lui
    // que la vue affiche, et donc lui qu'on doit interroger pour comparer.
    const vu = depuisJSON(enJSON(l));

    // « Voir la matrice » ouvre désormais le tableau de bord : trois lectures de
    // la même évaluation, au lieu d'une seule.
    ok("les quatre panneaux sont là",
       ["rosace", "mitigations", "cve", "matrix"]
           .every(n => !!window.document.querySelector(`[data-panel="${n}"]`)),
       ["rosace", "mitigations", "cve", "matrix"]
           .filter(n => !window.document.querySelector(`[data-panel="${n}"]`)).join(", ") || "tous");
    ok("la matrice y vit toujours", !!window.document.getElementById("matrix-grid"));

    /* --- la rosace porte les vraies notes, pas l'exemple de l'accueil --- */

    const niveaux = tacticLevels(donnees, buildMatrixScores(donnees, vu));
    const mesurees = [...niveaux.values()].filter(v => v !== null);
    ok("une tactique couverte par la mitigation notée est mesurée", mesurees.length > 0,
       `${mesurees.length} tactique(s) mesurée(s)`);
    ok("la moyenne centrale ne compte que ce qui est évalué",
       window.document.querySelector("#dash-rosace .ros-value")?.textContent
           === (mesurees.reduce((a, b) => a + b, 0) / mesurees.length).toFixed(1).replace(".", ","),
       window.document.querySelector("#dash-rosace .ros-value")?.textContent);
    ok("la rosace du tableau de bord ne s'annonce plus comme un exemple",
       !/exemple/i.test(window.document.querySelector("#dash-rosace .rosace")?.getAttribute("aria-label") ?? ""),
       window.document.querySelector("#dash-rosace .rosace")?.getAttribute("aria-label"));

    // Une tactique dont aucune technique n'est notée vaut `null` et non zéro :
    // rien n'a été mesuré, ce qui ne dit rien de ce qui est en place. La
    // confondre avec un zéro afficherait « aucune pratique » sur une simple
    // absence de mesure. Vérifié sur un layer vierge, où c'est le cas de toutes.
    {
        const vierge = createLayer({ name: "Rien de répondu" });
        const aucun = tacticLevels(donnees, buildMatrixScores(donnees, vierge));
        ok("sans aucune réponse, aucune tactique n'est notée zéro",
           [...aucun.values()].every(v => v === null),
           [...aucun.values()].join(", "));

        const { rosace } = await import(`${APP}/js/views/home-visuals.js`);
        const bac = window.document.createElement("div");
        bac.innerHTML = rosace(donnees, aucun);
        ok("leurs sommets se distinguent d'un zéro sur la rosace",
           bac.querySelectorAll(".ros-dot.vide").length === donnees.tactics.length,
           `${bac.querySelectorAll(".ros-dot.vide").length} creux sur ${donnees.tactics.length}`);
        ok("et la moyenne ne s'invente pas de valeur",
           bac.querySelector(".ros-value")?.textContent === "-",
           bac.querySelector(".ros-value")?.textContent);
    }

    /* --- la liste des mitigations --- */

    const lignes = window.document.querySelectorAll("#dash-mitigations .mit-row");
    ok("toutes les mitigations sont listées, notées ou non",
       lignes.length === donnees.mitigations.length, `${lignes.length} lignes`);
    ok("celle qui est notée porte sa note",
       window.document.querySelector('[data-mitigation="M1032"] .mit-score')?.textContent === "4",
       window.document.querySelector('[data-mitigation="M1032"] .mit-score')?.textContent);
    ok("les autres restent visibles, sans note",
       !!window.document.querySelector("#dash-mitigations .mit-score.vide"));
    /* --- cliquer une mitigation la surligne dans la matrice --- */

    // C'est la question qu'on se pose devant cette liste : « celle-là, elle
    // protège quoi ? ». Elle se répond sur la carte, pas dans une énumération
    // d'identifiants.
    window.document.querySelector('[data-mitigation="M1032"]').click();
    const couverte = window.document.querySelector('[data-tech="T1078"]');
    const hors = window.document.querySelector('[data-tech="T9999"]');
    ok("les techniques couvertes ressortent", couverte.classList.contains("highlighted"),
       [...couverte.classList].join(" "));
    ok("et le reste s'efface", hors.classList.contains("dimmed"),
       [...hors.classList].join(" "));
    ok("la ligne se marque comme sélectionnée",
       window.document.querySelector('[data-mitigation="M1032"]').classList.contains("selected"));

    // Le geste qui sélectionne est celui qui désélectionne.
    window.document.querySelector('[data-mitigation="M1032"]').click();
    ok("re-cliquer éteint le surlignage",
       !window.document.querySelector(".cell.highlighted, .cell.dimmed"));

    // La ligne sélectionnée offre d'ouvrir son questionnaire — proposé sur les
    // quarante-quatre lignes, ce bouton ferait de la liste un mur d'actions.
    ok("aucune action de questionnaire tant que rien n'est sélectionné",
       !window.document.querySelector("[data-quiz]"));
    window.document.querySelector('[data-mitigation="M1018"]').click();
    ok("elle apparaît sur la ligne sélectionnée",
       !!window.document.querySelector('[data-quiz="M1018"]'));
    // M1055 décrit les cas où l'on choisit de ne pas atténuer : pas de maturité
    // à mesurer, donc rien à ouvrir — mais la ligne se surligne quand même.
    window.document.querySelector('[data-mitigation="M1055"]').click();
    ok("celle qui n'a pas de questionnaire se surligne sans proposer d'y répondre",
       !!window.document.querySelector('[data-mitigation="M1055"].selected') &&
       !window.document.querySelector("[data-quiz]"));

    window.document.querySelector('[data-mitigation="M1018"]').click();
    window.document.querySelector('[data-quiz="M1018"]').click();
    ok("et l'action ouvre bien le questionnaire de la mitigation",
       window.document.querySelector(".quiz-tag")?.textContent.trim() === "M1018",
       window.document.querySelector(".quiz-tag")?.textContent.trim());

    /* --- agrandissement --- */

    window.document.getElementById("q-matrix").click();
    const dash = window.document.getElementById("dash");
    ok("aucun panneau n'est agrandi au départ", !dash.dataset.expanded);

    window.document.querySelector('[data-expand="matrix"]').click();
    ok("le bouton agrandit son panneau", dash.dataset.expanded === "matrix", dash.dataset.expanded);
    // Le même bouton, devenu une croix, ramène au tableau de bord : le geste
    // pour partir et celui pour revenir sont au même endroit.
    window.document.querySelector('[data-expand="matrix"]').click();
    ok("et le même bouton ramène au tableau de bord", !dash.dataset.expanded, dash.dataset.expanded);

    const matrixCss = readFileSync(`${ROOT}/css/matrix.css`, "utf8");
    ok("la croix ne s'affiche que sur le panneau agrandi",
       /\.panel-expand \.ico-close\s*\{\s*display:\s*none/.test(matrixCss) &&
       /#dash\[data-expanded="matrix"\] \[data-expand="matrix"\] \.ico-close/.test(matrixCss));
    // Une règle plus spécifique qui rallumerait l'icône d'agrandissement ferait
    // apparaître les deux à la fois sur le panneau ouvert — le cas s'est produit.
    ok("et rien ne rallume l'icône d'agrandissement par-dessus",
       !/\.ico-grow\s*\{\s*display:\s*block/.test(matrixCss));
    ok("un panneau agrandi masque les autres",
       /#dash\[data-expanded="matrix"\] #dash-side[\s\S]{0,220}display:\s*none/.test(matrixCss));

    /* --- filtrer ne redessine pas ce qui ne change pas --- */

    // La rosace rejoue son animation de tracé à chaque reconstruction. Rattachée
    // au rendu de la grille, elle se redessinait sous les doigts à chaque frappe
    // dans la recherche — or filtrer la matrice ne change aucune note.
    const avant = window.document.querySelector("#dash-rosace .rosace");
    const recherche = window.document.getElementById("matrix-search");
    recherche.value = "T10";
    recherche.dispatchEvent(new window.Event("input"));
    ok("filtrer la matrice ne reconstruit pas la rosace",
       window.document.querySelector("#dash-rosace .rosace") === avant);
    ok("ni la liste des mitigations",
       window.document.querySelectorAll("#dash-mitigations .mit-row").length === lignes.length);

    // Changer de méthode de notation, en revanche, change bien les notes.
    const modes = window.document.querySelectorAll('#method-panel input[name="scoring"]');
    const autre = [...modes].find(r => !r.checked);
    autre.checked = true;
    autre.dispatchEvent(new window.Event("change"));
    ok("changer de méthode de notation les redessine",
       window.document.querySelector("#dash-rosace .rosace") !== avant);

    /* --- cliquer un sommet de la rosace met sa colonne en avant --- */

    // Le creux qu'on repère sur la rosace se regarde ensuite en détail sur la
    // carte : sans ce lien, il faut retrouver la tactique des yeux parmi quinze
    // colonnes.
    const sommet = window.document.querySelector("#dash-rosace .ros-hit");
    const tactique = sommet?.dataset.tactic;
    ok("chaque sommet porte l'identifiant de sa tactique", !!tactique, tactique);
    // Une pastille de 2,6 px de rayon ne s'attrape ni à la souris ni au doigt :
    // la zone de saisie est un disque transparent bien plus large.
    ok("et une zone de saisie assez large pour être attrapée",
       Number(sommet.getAttribute("r")) >= 8, `r=${sommet.getAttribute("r")}`);

    // Un élément SVG n'a pas de `.click()` — c'est une méthode de HTMLElement.
    const cliquer = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    cliquer(sommet);
    const choisie = window.document.querySelector(`.tactic-col[data-tactic="${tactique}"]`);
    const autres = [...window.document.querySelectorAll(".tactic-col")]
        .filter(c => c.dataset.tactic !== tactique);
    ok("la colonne de la tactique ressort", choisie?.classList.contains("picked"),
       [...(choisie?.classList ?? [])].join(" "));
    ok("et les autres s'effacent", autres.length > 0 && autres.every(c => c.classList.contains("faded")));

    // Les deux mises en avant s'excluent : la carte ne répond qu'à une question
    // à la fois.
    window.document.querySelector('[data-mitigation="M1032"]').click();
    ok("choisir une mitigation éteint la mise en avant de la tactique",
       !window.document.querySelector(".tactic-col.picked, .tactic-col.faded"));
    cliquer(window.document.querySelector("#dash-rosace .ros-hit"));
    ok("et réciproquement",
       !window.document.querySelector(".cell.highlighted, .cell.dimmed") &&
       !!window.document.querySelector(".tactic-col.picked"));
    cliquer(window.document.querySelector("#dash-rosace .ros-hit"));
    ok("re-cliquer le même sommet éteint la mise en avant",
       !window.document.querySelector(".tactic-col.picked, .tactic-col.faded"));

    /* --- exporter la rosace --- */

    const { rosaceAutonome } = await import(`${APP}/js/views/home-visuals.js`);
    window.document.querySelector('[data-expand="rosace"]').click();
    ok("l'export n'est proposé que sur la rosace agrandie",
       /#dash\[data-expanded="rosace"\] \.rosace-export\s*\{\s*display:\s*inline-flex/.test(matrixCss) &&
       /\.rosace-export\s*\{[^}]*display:\s*none/.test(matrixCss));

    const fichier = rosaceAutonome(window.document.querySelector("#dash-rosace .rosace"));
    ok("le fichier est un document SVG complet",
       fichier.startsWith("<?xml") && /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(fichier));
    // Un `xmlns` posé à la main sur un élément déjà dans l'espace de noms SVG
    // s'ajoute à celui du sérialiseur : deux attributs de même nom, donc un XML
    // que rien n'ouvre.
    ok("son espace de noms n'est pas déclaré deux fois",
       (fichier.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) ?? []).length === 1);
    ok("il se relit comme du XML valide", (() => {
        const relu = new window.DOMParser().parseFromString(fichier, "image/svg+xml");
        return !relu.querySelector("parsererror");
    })());
    // Une propriété que le navigateur ne résout pas rend une chaîne vide :
    // l'écrire donnerait « fill:; », que rien ne relit.
    ok("aucune déclaration vide ne traîne dans les styles", !/[a-z-]+:;/.test(fichier),
       (/[a-z-]+:;/.exec(fichier) ?? [])[0]);
    // Le tracé se dessine par `stroke-dashoffset` : une copie prise pendant
    // l'animation sortirait à moitié faite.
    ok("le tracé n'y est pas figé au milieu de son animation",
       !/stroke-dashoffset/.test(fichier) && !/stroke-dasharray/.test(fichier));
    // Un fond transparent laisserait le dessin disparaître sur une page de sa
    // teinte — c'est ce que rendent `transparent` et `rgba(…, 0)`.
    ok("le fond est peint, et jamais transparent",
       /<rect[^>]*fill="(?!transparent)[^"]+"/.test(fichier) &&
       !/<rect[^>]*fill="[^"]*,\s*0\)"/.test(fichier),
       (/<rect[^>]*fill="([^"]*)"/.exec(fichier) ?? [])[1]);
    window.document.querySelector('[data-expand="rosace"]').click();

    /* --- la recherche CVE, prévue mais pas branchée --- */

    const cve = window.document.getElementById("dash-cve");
    ok("le champ CVE est présent mais désactivé", !!cve && cve.disabled);
    ok("et il annonce la source sur laquelle il s'appuiera",
       /CVE2CAPEC/.test(window.document.getElementById("dash-cve-note")?.textContent ?? ""));
}

console.log("\n[35d] Pas de liseré d'accent à gauche des blocs");
{
    // Le liseré coloré posé sur le bord gauche d'un bloc — encadré d'aide,
    // note, carte de question — était devenu la signature visuelle de la page.
    // Un bloc se distingue par sa surface et son cadre ; la couleur qu'on lui
    // collait au flanc ne portait aucune information que le bloc ne dise déjà.
    const liserets = [];
    for (const f of ["base", "home", "matrix", "quiz", "tokens"]) {
        const css = readFileSync(`${ROOT}/css/${f}.css`, "utf8");
        for (const m of css.matchAll(/border-left:\s*([^;]+);/g)) {
            // Un filet d'un pixel dans le ton des bordures est structurel : il
            // marque un retrait, il ne décore pas.
            if (!/^1px solid var\(--border(-strong)?\)$/.test(m[1].trim())) {
                liserets.push(`${f}.css → ${m[1].trim()}`);
            }
        }
    }
    ok("aucun bloc ne porte de liseré coloré à gauche", liserets.length === 0,
       liserets.join(" · ") || "aucun");
}

/* [36] « Un téléchargement qui échoue est retenté » a été retiré : il n'y a plus
   de téléchargement. La stratégie de reprise qu'il éprouvait — premier essai sur
   le cache, suivants en `reload`, trois essais puis abandon — existait pour
   survivre aux 400 de GitHub sur le plus gros fichier du dépôt et aux entrées de
   cache fautives. Les deux disparaissent avec le fetch lui-même ; ce que le banc
   surveille désormais à la place, c'est qu'aucune requête ne parte au démarrage
   (voir [1]) et que le fichier embarqué soit valide (voir [33]). */


console.log("\n[37] Ce qui vient d'un fichier ne devient jamais une clé sans être reconnu");
{
    const { sanitiseAnswers } = await import(`${APP}/js/layer.js`);

    /* Un layer se transporte par fichier, et un fichier se fabrique à la main.

       `out[id] ??= {}` sur une clé `__proto__` ne crée rien — la lecture rend
       déjà `Object.prototype`, qui n'est ni null ni undefined — et l'écriture
       suivante allait poser la réponse sur le prototype de tous les objets de la
       page. Ce n'était pas qu'une curiosité : l'application lit les réponses en
       interrogeant des objets ordinaires, donc chaque mitigation sans réponse
       propre se serait mise à en rendre une. Des « Oui » inventés dans la
       matrice, et réexportés comme s'ils avaient été donnés. */
    const piege = JSON.parse('{"__proto__":{"1":{"value":"Oui"}}}');
    const sorti = sanitiseAnswers(piege);
    ok("une clé « __proto__ » dans les réponses n'atteint pas le prototype",
       ({}).__proto__ === Object.prototype && ({})["1"] === undefined,
       JSON.stringify(({})["1"]));
    ok("et elle ne ressort pas non plus dans le layer",
       Object.keys(sorti).length === 0, JSON.stringify(sorti));

    // Les identifiants réels continuent de passer : la garde reconnaît, elle ne
    // rejette pas tout.
    const bon = sanitiseAnswers({ M1032: { 1: { value: "Oui", tool: "Entra ID" } } });
    ok("un identifiant de mitigation normal passe toujours",
       bon.M1032?.[1]?.value === "Oui" && bon.M1032[1].tool === "Entra ID",
       JSON.stringify(bon));
    // Un numéro de question doit être un entier : la même écriture sur une clé
    // `__proto__` pose le prototype de l'objet des réponses d'une mitigation.
    const numeroTordu = sanitiseAnswers({ M1032: { "__proto__": { value: "Oui" } } });
    ok("un numéro de question qui n'en est pas un est écarté",
       Object.keys(numeroTordu).length === 0, JSON.stringify(numeroTordu));

    /* Même porte d'entrée par le classeur : la colonne « Mitigation » est une
       cellule, donc du texte libre. Elle est écrite avant que `sanitiseAnswers`
       ne passe, il faut donc la garder là aussi. */
    const truque = new ExcelJS.Workbook();
    const feuille = truque.addWorksheet("Réponses");
    feuille.addRow(["Mitigation", "N°", "Réponse", "Outil (si applicable)"]);
    feuille.addRow(["__proto__", 1, "Oui", ""]);
    feuille.addRow(["M1032", 1, "Oui", "Entra ID"]);
    const reluTruque = readWorkbook(truque, { name: "Truqué" });
    ok("une cellule « Mitigation » truquée n'atteint pas le prototype non plus",
       ({})["1"] === undefined && reluTruque.answers.M1032?.[1]?.value === "Oui",
       JSON.stringify(({})["1"]));

    /* Le mode de notation était cherché avec `in`, qui suit la chaîne de
       prototypes : une cellule « toString » passait pour un mode valide et
       laissait la matrice sur une notation qui n'existe pas. */
    const meta = new ExcelJS.Workbook();
    const rep = meta.addWorksheet("Réponses");
    rep.addRow(["Mitigation", "N°", "Réponse"]);
    rep.addRow(["M1032", 1, "Oui"]);
    const md = meta.addWorksheet("Métadonnées");
    md.addRow(["Mode de notation", "toString"]);
    md.addRow(["Mode d'agrégation", "constructor"]);
    const reluMeta = readWorkbook(meta, { name: "Méta" });
    ok("un mode de notation hérité du prototype est refusé",
       reluMeta.scoring === "last-yes" && reluMeta.aggregation === "average",
       `${reluMeta.scoring} / ${reluMeta.aggregation}`);
}

console.log("\n[38] Ce qui vient d'un CDN est vérifié à la réception");
{
    const html = readFileSync(`${ROOT}/index.html`, "utf8");

    /* Le document ne charge plus aucun script distant : le chiffrement est passé
       à WebCrypto, fourni par le navigateur. C'est une chaîne d'approvisionnement
       de moins sur le chemin critique — il n'y a plus rien à compromettre pour
       obtenir du code dans une page qui manipule la clé des exports. */
    const distants = [...html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)];
    ok("le document ne charge aucun script distant au démarrage",
       distants.length === 0, distants.map(d => d[1]).join(", "));

    /* Reste la bibliothèque Excel, injectée à la demande. Elle porte son
       empreinte, et `crossorigin` en est la condition : sans lui la réponse est
       opaque et le contrôle serait silencieusement ignoré. */
    const excelSrc = readFileSync(`${ROOT}/js/excel.js`, "utf8");
    ok("la bibliothèque Excel chargée à la demande porte son empreinte",
       /s\.integrity\s*=/.test(excelSrc) && /s\.crossOrigin\s*=\s*"anonymous"/.test(excelSrc));
    ok("son empreinte est bien celle de la version demandée",
       /exceljs\/4\.4\.0\//.test(excelSrc) &&
       excelSrc.includes("sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw=="));
}

console.log("\n[38b] Politique de sécurité du contenu");
{
    const html = readFileSync(`${ROOT}/index.html`, "utf8");
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    ok("le document porte une politique de sécurité", csp !== "");

    const directive = nom =>
        (new RegExp(`(?:^|;)\\s*${nom}\\s+([^;]*)`).exec(csp)?.[1] ?? "").replace(/\s+/g, " ").trim();

    /* Le cœur de la politique : aucun script en ligne n'est exécuté sans que son
       contenu exact ait été prévu. C'est cette ligne-là qui arrêterait une
       injection venue du bundle ATT&CK, d'un fichier de layer ou d'un classeur —
       les trois entrées par lesquelles du texte étranger circule dans la page. */
    const scriptSrc = directive("script-src");
    ok("aucun script en ligne n'est autorisé en bloc", !/'unsafe-inline'/.test(scriptSrc), scriptSrc);
    ok("aucune évaluation de chaîne n'est autorisée", !/'unsafe-eval'/.test(scriptSrc));
    ok("le repli par défaut est fermé", directive("default-src") === "'none'", directive("default-src"));
    ok("les objets et la base d'URL sont fermés",
       directive("object-src") === "'none'" && directive("base-uri") === "'none'");
    ok("aucun formulaire ne peut être soumis nulle part", directive("form-action") === "'none'");
    /* Depuis que le référentiel est généré et embarqué, la page ne fait plus
       aucune requête de son propre chef : `connect-src` peut donc être fermé,
       et c'est la position la plus sûre — une injection qui parviendrait à
       s'exécuter n'aurait aucune destination vers laquelle exfiltrer. La
       directive et le code doivent rester d'accord : si un `fetch` réapparaît
       sans que la politique bouge, la page échoue au chargement avec une erreur
       qui ressemble à une panne réseau. */
    ok("aucune destination réseau n'est autorisée",
       directive("connect-src") === "'none'", directive("connect-src"));
    const sourcesJs = readdirSync(`${ROOT}/js`, { recursive: true })
        .filter(f => String(f).endsWith(".js") && String(f) !== "attack-data.js");
    const quiFetch = sourcesJs.filter(f =>
        /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(readFileSync(`${ROOT}/js/${f}`, "utf8")));
    ok("et aucun module ne tente de sortir sur le réseau", quiFetch.length === 0, quiFetch.join(", "));

    /* Les empreintes sont recalculées ici sur le contenu réel des scripts en
       ligne. C'est le point qui se périme tout seul : modifier un de ces scripts
       sans reprendre son empreinte le ferait bloquer par le navigateur, et rien
       dans le rendu du banc ne le montrerait — la page ne démarre simplement
       plus. Le calcul est donc refait à chaque exécution. */
    const enLigne = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    ok("les deux scripts en ligne du document sont connus", enLigne.length === 2, String(enLigne.length));
    for (const [i, corps] of enLigne.entries()) {
        const empreinte = "'sha256-" + nodeCrypto.createHash("sha256").update(corps, "utf8").digest("base64") + "'";
        ok(`l'empreinte du script en ligne ${i + 1} est à jour`,
           scriptSrc.includes(empreinte),
           scriptSrc.includes(empreinte) ? "" : `attendue ${empreinte}`);
    }

    /* `strict-dynamic` est ce qui laisse ces deux scripts poser la carte
       d'imports, `main.js` et la bibliothèque Excel. Sans lui, il faudrait soit
       rouvrir `unsafe-inline`, soit renoncer au versionnement des modules. */
    ok("la confiance est étendue à ce que ces scripts chargent eux-mêmes",
       /'strict-dynamic'/.test(scriptSrc));

    /* Un gestionnaire écrit en attribut est du script en ligne : la politique le
       refuse, et une page qui en contient un se casse en silence. */
    const sources = ["index.html", ...readdirSync(`${ROOT}/js`).filter(f => f.endsWith(".js")).map(f => `js/${f}`),
                     ...readdirSync(`${ROOT}/js/views`).map(f => `js/views/${f}`)];
    const fautifs = sources.filter(f =>
        /\son(click|load|error|change|input|submit|mouseover)\s*=\s*["']/.test(readFileSync(`${ROOT}/${f}`, "utf8")));
    ok("aucun gestionnaire d'événement n'est écrit dans le markup",
       fautifs.length === 0, fautifs.join(", "));

    /* Assumé, et dit ici pour que ce soit un choix relu et non un oubli : les
       mises en forme calculées — largeur d'une barre, périmètre du tracé de la
       rosace — ne peuvent pas être empreintes puisqu'elles changent à chaque
       rendu. Le risque est l'exfiltration par sélecteur, sans commune mesure
       avec l'exécution de script. */
    ok("les styles en ligne restent autorisés, et c'est documenté",
       /'unsafe-inline'/.test(directive("style-src")) &&
       /choix assumé|assumé, pas un oubli/.test(html));
}

console.log("\n[39] Une adresse venue du bundle n'entre dans un lien qu'après contrôle");
{
    /* Les URL des fiches viennent du bundle ATT&CK, donc d'un fichier
       téléchargé, et elles finissent dans un `href`. L'échappement HTML ne dit
       rien du schéma : `javascript:…` en sortirait intact. */
    const src = readFileSync(`${ROOT}/js/views/matrix.js`, "utf8");
    ok("l'URL de la fiche MITRE est filtrée sur son schéma avant d'être posée",
       /href="\$\{esc\(lienWeb\(tech\.url\)\)\}"/.test(src) &&
       /\^https\?:/.test(src),
       /href="\$\{esc\(tech\.url\)\}"/.test(src) ? "posée sans contrôle" : "");
}

console.log("\n[41] Le mouvement, et ce qui le coupe");
{
    const homeCss = readFileSync(`${ROOT}/css/home.css`, "utf8");
    const home = window.document.getElementById("view-home");

    /* Aucun écouteur de défilement dans le projet. Il se déclenche à chaque
       image, et celui qu'on avait mesurait quatre sections à chaque fois : autant
       de recalculs de mise en page forcés pendant le geste le plus sensible de la
       page. Deux mécaniques le remplacent, `IntersectionObserver` pour les
       marques d'état, une chronologie de défilement CSS pour l'animation. */
    const modules = [...readdirSync(`${ROOT}/js`).filter(f => f.endsWith(".js")).map(f => `js/${f}`),
                     ...readdirSync(`${ROOT}/js/views`).map(f => `js/views/${f}`)];
    const ecouteurs = modules.filter(f =>
        /addEventListener\(\s*["']scroll["']/.test(readFileSync(`${ROOT}/${f}`, "utf8")));
    ok("aucun écouteur de défilement", ecouteurs.length === 0, ecouteurs.join(", "));

    /* L'animation de révélation ne pose son état invisible que là où le
       navigateur sait, de lui-même, le faire disparaître. Sans le `@supports`,
       un navigateur qui ignore `animation-timeline` afficherait une page dont
       tous les blocs sont à zéro d'opacité, et rien ne l'en sortirait. */
    ok("la révélation est pilotée par le défilement, en CSS",
       /animation-timeline:\s*view\(\)/.test(homeCss));
    const garde = /@supports \(animation-timeline: view\(\)\) \{([\s\S]*?)\n\}/.exec(homeCss)?.[1] ?? "";
    // Hors du bloc gardé, il ne doit rien rester : une seule déclaration ailleurs
    // suffirait à cacher la page sur un navigateur qui ignore la propriété.
    const horsGarde = homeCss
        .replace(/\/\*[\s\S]*?\*\//g, "")          // les commentaires en parlent, ils ne règlent rien
        .replace(/@supports \(animation-timeline: view\(\)\) \{[\s\S]*?\n\}/, "");
    ok("et son état de départ est enfermé dans un @supports",
       /animation-timeline:\s*view\(\)/.test(garde) && !/animation-timeline/.test(horsGarde),
       garde.replace(/\s+/g, " ").slice(0, 90));
    ok("les blocs à révéler sont marqués dans le markup",
       home.querySelectorAll("[data-reveal]").length >= 6,
       String(home.querySelectorAll("[data-reveal]").length));

    /* La matrice se pose colonne par colonne, dans l'ordre où elle se lit. Le
       rang vient du markup, le retard se calcule en CSS : la géométrie n'est
       écrite qu'à un seul endroit. */
    const rangs = [...home.querySelectorAll(".hm-col")].map(c => c.style.getPropertyValue("--col"));
    ok("chaque colonne porte son rang, dans l'ordre de lecture",
       rangs.length > 0 && rangs.every((r, i) => r === String(i)), rangs.join(","));
    ok("le retard se calcule à partir du rang, sans le redire",
       /animation-delay:\s*calc\([^)]*var\(--col/.test(homeCss));

    /* Une animation qu'on ne peut pas couper est une animation de trop. */
    const sobre = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(homeCss)?.[1] ?? "";
    for (const [quoi, motif] of [
        ["la pose de la matrice", /\.hm-col[^}]*animation:\s*none/],
        ["l'estompage au survol", /\.hm-grid:hover \.hm-col[^}]*opacity:\s*1/],
        ["la révélation des blocs", /\[data-reveal\][^}]*animation:\s*none/],
        ["le tracé de la rosace", /\.ros-shape[^}]*animation:\s*none/],
    ]) {
        ok(`en mouvement réduit, ${quoi} se coupe`, motif.test(sobre));
    }
}

console.log("\n[42] Hauteurs d'en-tête, retour à l'accueil, tableau de bord au doigt");
{
    const matrixCss = readFileSync(`${ROOT}/css/matrix.css`, "utf8");
    const homeCss = readFileSync(`${ROOT}/css/home.css`, "utf8");
    const mainJs = readFileSync(`${ROOT}/js/main.js`, "utf8");

    /* --- les en-têtes de tactique ---

       Hauteur fixée dans les deux modes, jamais minimale. Avec une hauteur
       minimale, « Resource Development » passait à la ligne là où « Execution »
       tenait sur une, l'en-tête le plus haut décalait sa colonne entière, et les
       rangées ne s'alignaient plus d'une colonne à l'autre. */
    for (const [mode, motif] of [
        ["fenêtré", /#matrix-grid:not\(\.fit\) \.tactic-head\s*\{[^}]*height:\s*\d+px/],
        ["plein écran", /#matrix-grid\.fit \.tactic-head\s*\{[^}]*height:\s*\d+px/],
    ]) {
        ok(`en ${mode}, tous les en-têtes ont la même hauteur`, motif.test(matrixCss));
    }
    ok("aucun ne garde de hauteur minimale, qui les laisserait diverger",
       !/\.tactic-head\s*\{[^}]*min-height:\s*[1-9]/.test(matrixCss));
    ok("le nom est bridé à deux lignes",
       /\.tactic-head \.t-name\s*\{[^}]*-webkit-line-clamp:\s*2/.test(matrixCss));
    // La barre d'avancement n'existe qu'en plein écran : en fenêtré, quinze
    // traits sous quinze titres font une frange qui tire l'oeil hors des cases.
    ok("la barre d'avancement n'apparaît qu'en plein écran",
       /\.tactic-head \.t-bar\s*\{\s*display:\s*none/.test(matrixCss) &&
       /#matrix-grid\.fit \.tactic-head \.t-bar\s*\{\s*display:\s*block/.test(matrixCss));

    /* --- on revient toujours en haut de l'accueil --- */

    // La vue n'est pas détruite en la quittant, elle est masquée : elle gardait
    // donc sa position, et revenir d'un questionnaire rouvrait la page au milieu
    // de la FAQ sans que rien ne l'ait demandé.
    ok("le retour à l'accueil remet la page en haut",
       /#view-home[\s\S]{0,120}scrollTo[\s\S]{0,80}top:\s*0/.test(mainJs));
    ok("et il le fait sans animer la remontée",
       /scrollTo\?\.\(\{ top: 0, behavior: "instant" \}\)/.test(mainJs));

    /* --- l'accueil au doigt --- */

    const petit = /@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/.exec(homeCss)?.[1] ?? "";
    const basDeHero = Number(/\.hero\s*\{[^}]*padding-bottom:\s*(\d+)px/.exec(petit)?.[1] ?? 0);
    // La bande change de couleur juste sous les chiffres : il faut sentir la fin
    // d'un bloc avant de voir le début du suivant.
    ok("les chiffres ne touchent pas la limite de la bande", basDeHero >= 64, `${basDeHero}px`);

    /* --- le tableau de bord au doigt ---

       En colonne, quatre blocs empilés dans l'ordre où l'on s'en sert. Une
       grille ne pouvait pas le faire : un panneau porte `overflow: hidden`, donc
       sa taille minimale automatique vaut zéro, et les rangées `auto` d'une
       grille de hauteur définie se comprimaient jusqu'à rien — la rosace, les
       mitigations et le bloc CVE se réduisaient à leur titre. */
    const doigt = /@media\s*\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/.exec(matrixCss)?.[1] ?? "";
    ok("les panneaux s'empilent au lieu de se partager une grille",
       /#dash\s*\{[^}]*display:\s*flex/.test(doigt) &&
       /#dash \.dash-panel\s*\{[^}]*flex:\s*0 0 auto/.test(doigt),
       doigt.replace(/\s+/g, " ").slice(0, 110));
    ok("l'emballage de la colonne de gauche se dissout, pour qu'on puisse les ordonner",
       /#dash-side\s*\{\s*display:\s*contents/.test(doigt));
    ok("la matrice passe en tête",
       /\[data-panel="matrix"\]\s*\{[^}]*order:\s*-1/.test(doigt));
    ok("la rosace prend la largeur de son bloc",
       /\[data-panel="rosace"\] \.rosace\s*\{[^}]*width:\s*100%/.test(doigt));
    // Une liste de quarante-quatre mitigations déroulée en entier ferait de la
    // page un couloir : on en montre cinq, et la sixième amorcée dit qu'il y en a.
    const hauteurListe = Number(/\[data-panel="mitigations"\] \.panel-body\s*\{[^}]*max-height:\s*(\d+)px/.exec(doigt)?.[1] ?? 0);
    ok("la liste des mitigations est bornée et défile",
       hauteurListe > 0 && hauteurListe < 320 &&
       /\[data-panel="mitigations"\] \.panel-body\s*\{[^}]*overflow-y:\s*auto/.test(doigt),
       `${hauteurListe}px`);
    // Le mode agrandi doit continuer de masquer ce qu'il masque : sa règle est
    // plus spécifique que `#dash-side { display: contents }`.
    ok("le mode agrandi reste prioritaire sur la dissolution",
       /#dash\[data-expanded="matrix"\] #dash-side,[\s\S]{0,200}display:\s*none/.test(matrixCss));

    /* --- la barre d'outil ne se chevauche plus ---

       Six éléments se disputaient 430 px. Rétrécir la marque ne faisait que
       repousser le problème : le chevauchement revenait dès que le nom du layer
       faisait plus de deux mots. Il fallait en sortir deux, pas les serrer. */
    const baseCss = readFileSync(`${ROOT}/css/base.css`, "utf8");
    const serre = /@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\n\}/.exec(baseCss)?.[1] ?? "";
    ok("les deux actions du layer descendent en pied d'écran",
       /#topbar\[data-mode="app"\] #topbar-actions\s*\{[^}]*position:\s*fixed/.test(serre) &&
       /#topbar\[data-mode="app"\] #topbar-actions\s*\{[^}]*bottom:\s*0/.test(serre),
       serre.replace(/\s+/g, " ").slice(0, 110));
    ok("elles y prennent la largeur d'un vrai bouton",
       /#topbar-actions > \*\s*\{[^}]*flex:\s*1 1 0/.test(serre));
    // Un pied de barre fixe recouvre la fin de ce qu'on fait défiler si la vue
    // ne lui rend pas sa hauteur.
    ok("et la vue leur rend la place qu'elles prennent",
       /#view-matrix\s*\{\s*padding-bottom:\s*\d+px/.test(serre));
    // La barre haute retrouve alors ce qu'elle doit dire : d'où l'on vient, et
    // où l'on en est.
    ok("la marque garde son nom, et reste le retour à l'accueil",
       // « font-size: 0 » exactement, et non « 0.95rem » : sans le point-virgule,
       // le motif attrapait toutes les tailles commençant par un zéro.
       !/\.brand\s*\{[^}]*font-size:\s*0\s*;/.test(baseCss) &&
       /<button class="brand" id="brand" title="Retour à l'accueil">/
           .test(readFileSync(`${ROOT}/index.html`, "utf8")));
    // Le déplacement est en CSS : c'est le même élément, aux mêmes gestionnaires.
    // Il doit donc continuer d'obéir à `.hidden` hors de la matrice.
    ok("le pied de barre disparaît hors de la matrice",
       /\.hidden\s*\{\s*display:\s*none\s*!important/.test(baseCss));

    // Un panneau déroulant ouvert depuis un bouton du bas sortirait de la
    // fenêtre : il bascule au-dessus quand la place manque dessous.
    ok("un menu déroulant s'ouvre vers le haut quand il ne tient pas dessous",
       /tientDessous[\s\S]{0,200}rect\.top - ecart - height/
           .test(readFileSync(`${ROOT}/js/views/matrix.js`, "utf8")));

    /* --- deux réglages quittent la barre d'outils sur un téléphone ---

       Le filtre de plateformes : on regarde la matrice, on ne l'affine pas, et
       son défaut est celui qu'on veut. Le bouton d'agrandissement : la matrice
       occupe déjà toute la largeur. Ce sont deux réglages masqués, pas deux
       fonctions retirées — les contrôles restent montés, la valeur par défaut
       s'applique, et rien de la matrice ne devient inaccessible. */
    ok("le filtre de plateformes et l'agrandissement quittent la barre au doigt",
       /#dd-platform,\s*\n\s*\[data-panel="matrix"\] \.panel-expand\s*\{\s*display:\s*none/.test(doigt),
       doigt.replace(/\s+/g, " ").slice(-110));
    ok("mais le filtre reste monté, avec toutes ses plateformes",
       window.document.querySelectorAll("#platform-panel input[data-platform]").length > 0,
       String(window.document.querySelectorAll("#platform-panel input[data-platform]").length));
}

console.log("\n[43] Le haut de page, allégé");
{
    const homeCss = readFileSync(`${ROOT}/css/home.css`, "utf8");
    const baseCss = readFileSync(`${ROOT}/css/base.css`, "utf8");
    const home = window.document.getElementById("view-home");

    // « maturité cyber » est le seul endroit du titre où le sens tient à deux
    // mots collés : réparti sur deux lignes, il cesse de se lire d'un bloc.
    ok("« maturité cyber » ne se coupe jamais",
       /\.hero h1 em\s*\{[^}]*white-space:\s*nowrap/.test(homeCss));

    // La pastille flottait dans 1160 px avec un large vide entre la marque et
    // les ancres.
    const largeur = Number(/#topbar\[data-mode="home"\]\s*\{[\s\S]*?width:\s*min\((\d+)px/.exec(baseCss)?.[1] ?? 0);
    ok("la barre haute est resserrée", largeur > 0 && largeur <= 1040, `${largeur}px`);

    // « Ouvrir un layer » décrivait la mécanique de reprise, qui se constate
    // en important un fichier et ne s'apprend pas avant.
    const ouvrir = [...home.querySelectorAll(".action-card")]
        .find(c => /Ouvrir un layer/.test(c.querySelector("h3")?.textContent ?? ""));
    ok("l'entrée « Ouvrir un layer » tient en une phrase",
       !/première question|tout est renseigné/.test(ouvrir?.textContent ?? ""),
       ouvrir?.querySelector("p")?.textContent.trim());
}


console.log("\n[40] Aucun tiret cadratin dans ce que l'utilisateur lit");
{
    /* Décision de cadrage, pas de goût : le tiret cadratin est banni des chaînes
       affichées. C'est la ponctuation que les modèles de langue posent partout,
       et une interface qui en est constellée se lit comme une interface écrite
       par une machine. Les commentaires du code la gardent : personne ne les
       lit dans un navigateur, et c'est la voix dans laquelle ce dépôt est écrit.

       La règle ne vaut donc que si on peut la vérifier sans exception à discuter.
       D'où ce test, qui retire les commentaires puis ne tolère plus un seul
       caractère. Sans lui, la règle serait revenue au premier texte ajouté. */

    /** Retire commentaires de bloc et de ligne sans toucher au contenu des chaînes. */
    const sansCommentaires = src => {
        let out = "", i = 0, etat = null;
        while (i < src.length) {
            const c = src[i], suivant = src[i + 1] ?? "";
            if (etat === null) {
                if (c === "/" && suivant === "*") { etat = "bloc"; i += 2; continue; }
                if (c === "/" && suivant === "/") { etat = "ligne"; i += 2; continue; }
                if (c === '"' || c === "'" || c === "`") etat = c;
                out += c; i += 1; continue;
            }
            if (etat === "bloc") {
                if (c === "*" && suivant === "/") { etat = null; i += 2; continue; }
                out += c === "\n" ? "\n" : " "; i += 1; continue;
            }
            if (etat === "ligne") {
                if (c === "\n") { etat = null; out += "\n"; }
                i += 1; continue;
            }
            if (c === "\\") { out += c + suivant; i += 2; continue; }
            if (c === etat) etat = null;
            out += c; i += 1;
        }
        return out;
    };

    // `attack-data.js` est hors de portée, et c'est la seule exception : ce sont
    // les descriptions de MITRE, recopiées telles quelles. Les réécrire pour
    // notre confort typographique reviendrait à falsifier la source citée.
    const fichiers = ["index.html",
        ...readdirSync(`${ROOT}/js`).filter(f => f.endsWith(".js") && f !== "attack-data.js")
            .map(f => `js/${f}`),
        ...readdirSync(`${ROOT}/js/views`).map(f => `js/views/${f}`)];

    const coupables = [];
    for (const fichier of fichiers) {
        let src = readFileSync(`${ROOT}/${fichier}`, "utf8");
        // Les commentaires de markup partent en premier : ils vivent à
        // l'intérieur de gabarits, donc le découpage JavaScript ne les voit pas.
        src = src.replace(/<!--[\s\S]*?-->/g, " ");
        for (const [i, ligne] of sansCommentaires(src).split("\n").entries()) {
            if (/[—–]/.test(ligne)) coupables.push(`${fichier}:${i + 1}`);
        }
    }
    ok("aucun tiret cadratin ni demi-cadratin dans une chaîne affichée",
       coupables.length === 0, coupables.slice(0, 8).join(", "));

    // Les commentaires, eux, en gardent : la règle vise ce qui s'affiche, et
    // l'inverse voudrait dire réécrire la documentation du dépôt pour une raison
    // qui ne la concerne pas.
    ok("les commentaires du code gardent leur ponctuation",
       /—/.test(readFileSync(`${ROOT}/js/views/home.js`, "utf8")));
}

// Le nombre d'assertions est affiché plutôt que recopié dans le README, où il
// avait dérivé de plusieurs centaines sans que personne s'en aperçoive.
console.log(`\n${failures === 0 ? `TOUT PASSE — ${checks} assertions` : `${failures} ÉCHEC(S) sur ${checks} assertions`}\n`);
process.exit(failures ? 1 : 0);
