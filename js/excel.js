/* ============================================================================
   Le classeur Excel : construction, mise en forme, relecture.

   Cinq feuilles, deux usages. « Réponses » est le contrat de relecture — c'est
   elle, et elle seule, que l'import relit. « Matrice » donne la silhouette
   reconnaissable, à lire et à imprimer. « Techniques », « Mitigations » sont à
   plat : elles se trient, se filtrent et se croisent, ce qu'une grille ne sait
   pas faire. « Métadonnées » trace la version du référentiel et la méthode.

   La bibliothèque est passée en paramètre plutôt qu'importée : le banc lui
   donne le module npm, le navigateur l'objet chargé depuis le CDN, et rien ici
   ne dépend d'un global.
   ========================================================================= */

import { ANSWERS, LEVEL_LABELS } from "./catalog.js";
import { resolvedEntries } from "./shared-questions.js";
import { createLayer, sanitiseAnswers, MITIGATION_ID } from "./layer.js";
import { CELL_STATE, SCORING_MODES, AGGREGATION_MODES } from "./scoring.js";

const RESPONSE_SHEET = "Réponses";
const META_SHEET = "Métadonnées";

/* ------------------------------------------------------------------ couleurs

   La rampe est celle du **thème clair** de `tokens.css` : un classeur a un fond
   blanc, la rampe sombre y serait illisible. Elle est recopiée ici parce que le
   navigateur n'est pas seul à produire le fichier — le banc l'écrit sans CSS —
   et une assertion vérifie que les deux jeux ne divergent pas. */

export const RAMPE = ["FFCE3B31", "FFEF8A2F", "FFF1ED83", "FFA5D861", "FF0F9A3C"];
const ENCRE = ["FFFFFFFF", "FF0B0B0B", "FF0B0B0B", "FF0B0B0B", "FF0B0B0B"];

const ENTETE = "FF2A3140";          // bandeau d'en-tête, texte blanc
const NEUTRE = "FFEFEFEB";          // surface-3 du thème clair
const GRIS = "FFA8A6A0";            // ce qui n'est pas chiffrable
const TRAIT = "FFDCDCD5";           // border du thème clair
const SYNTHESE = "FFE4E4DD";        // fond des lignes qui closent un bloc
const FILET = "FFB5B5AC";           // leur encadrement
const BARRE = "FF2A78D6";           // accent du thème clair, pour les barres de données

/** Teintes pâles de la colonne des réponses : lisibles derrière du texte. */
const REPONSE_FONDS = { Oui: "FFDCEFD2", Non: "FFFBD9D3", "N/A": "FFECECE8" };

const remplir = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const dxf = argb => ({ fill: { type: "pattern", pattern: "solid", bgColor: { argb } } });

/* ------------------------------------------------------ éléments récurrents */

/**
 * Prépare une feuille tabulaire : bandeau d'en-tête, volets gelés sur la
 * première ligne, filtre automatique. Ce trio est ce qui rend une feuille
 * utilisable — sans gel, on perd les intitulés au premier défilement.
 */
function tableau(wb, nom, colonnes) {
    const ws = wb.addWorksheet(nom, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = colonnes;
    return ws;
}

/**
 * Coiffe la ligne d'en-tête, en dernier.
 *
 * En dernier parce qu'un style posé sur une colonne s'applique aussi à sa
 * cellule d'en-tête : styler les colonnes après l'en-tête laissait un bandeau
 * bariolé, chaque titre héritant de l'alignement de ses données. Ici tous les
 * titres reçoivent le même traitement, quelle que soit leur colonne.
 *
 * La largeur est relevée si le titre n'y tient pas : un mot plus large que sa
 * colonne n'est pas replié, il est coupé — c'est ce qui tronquait
 * « Niveau attribué ». La hauteur suit le nombre de lignes nécessaires.
 */
function coifferEntete(ws) {
    const tete = ws.getRow(1);
    let lignes = 1;

    tete.eachCell((cell, col) => {
        const titre = String(cell.value ?? "");
        const colonne = ws.getColumn(col);

        // Le plus long mot doit tenir en largeur, largement.
        //
        // La largeur d'une colonne se compte en caractères de la police par
        // défaut, alors que les titres sont en gras, et le tableur réserve en
        // plus une marge de chaque côté ; l'écart réel s'est révélé bien
        // supérieur à ce qu'un calcul de caractères laisse prévoir — « Numéro »
        // se coupait encore dans une colonne de 9. Un titre **d'un seul mot**
        // n'a par ailleurs nulle part où se replier : il est coupé, jamais
        // réparti, et mérite donc une marge franche. Les titres de plusieurs
        // mots s'en sortent avec moins, le repli faisant le travail. Le trait
        // d'union compte comme une coupure possible, le tableur sait y replier.
        const mots = titre.split(/[\s-]+/).filter(Boolean).map(m => m.length);
        const motLePlusLong = Math.max(...mots, 1);
        const marge = mots.length === 1 ? 5 : 3;
        const plancher = Math.max(motLePlusLong + marge, Math.min(titre.length, 11));
        if ((colonne.width ?? 0) < plancher) colonne.width = plancher;

        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        cell.fill = remplir(ENTETE);
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

        lignes = Math.max(lignes, Math.ceil(titre.length / Math.max(colonne.width - 1, 1)));
    });

    // Une ligne de texte à 10 points en occupe environ 14.
    tete.height = 14 * Math.min(lignes, 3) + 7;
    return ws;
}

/**
 * Ferme le filtre sur toute l'étendue remplie, dernière ligne comprise.
 *
 * Et non sur la seule ligne d'en-tête : Excel étend alors le filtre à la région
 * *contiguë*, et les lignes vides qui aèrent les blocs de la feuille Réponses la
 * coupent — le filtre n'aurait porté que sur le premier bloc.
 */
function filtrer(ws) {
    if (ws.rowCount < 2) return;
    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: ws.rowCount, column: ws.columnCount },
    };
}

/** Trait de séparation léger sous chaque ligne : un tableau long se suit mieux. */
function rayer(ws) {
    for (let r = 2; r <= ws.rowCount; r++) {
        ws.getRow(r).border = { bottom: { style: "hair", color: { argb: TRAIT } } };
    }
}

/**
 * Marque les lignes de synthèse qui closent chaque bloc de questions.
 *
 * Elles doivent trancher sans crier : fond gris soutenu, filet au-dessus, gras.
 * La note y est **peinte** et non conditionnelle — une règle appliquée à une
 * colonne presque vide colorerait toutes les cellules vides du même coup, et il
 * n'y a de toute façon rien à retoucher sur une note calculée.
 *
 * Appelé après `rayer`, qui poserait sinon sa bordure par-dessus.
 */
function habillerSyntheses(ws, syntheses) {
    for (const { ligne, note } of syntheses) {
        const row = ws.getRow(ligne);
        row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = remplir(SYNTHESE);
            cell.font = { bold: true, size: 10 };
            cell.border = {
                top: { style: "thin", color: { argb: FILET } },
                bottom: { style: "thin", color: { argb: FILET } },
            };
        });
        const cellule = row.getCell(ws.getColumn("note").number);
        if (note !== "") {
            cellule.fill = remplir(RAMPE[note]);
            cellule.font = { bold: true, size: 11, color: { argb: ENCRE[note] } };
        } else {
            cellule.value = "-";
            cellule.font = { bold: true, size: 10, color: { argb: GRIS } };
        }
        cellule.alignment = { horizontal: "center", vertical: "middle" };
        row.height = 19;
    }
}

/**
 * Mise en forme conditionnelle de la maturité.
 *
 * Conditionnelle et non peinte à la main : la couleur suit alors le tri, le
 * filtre et une valeur retouchée.
 *
 * Chaque règle est une **expression** et non une comparaison simple, uniquement
 * pour écarter les cellules vides : dans une comparaison numérique, Excel traite
 * une cellule vide comme un zéro, et « niveau = 0 » teintait donc en rouge les
 * mitigations non encore évaluées — les faisant passer pour inexistantes.
 * La colonne est figée par `$`, la ligne reste relative : c'est ce qui fait
 * suivre la règle sur toute la plage.
 */
function couleursMaturite(ws, colonne, premiere, derniere, { decimal = false } = {}) {
    const cellule = `$${colonne}${premiere}`;
    const rules = [0, 1, 2, 3, 4].map(n => ({
        type: "expression",
        priority: n + 1,
        formulae: [decimal
            // Chaque score se rattache au palier dont il est le plus proche.
            ? `AND(${cellule}<>"",${cellule}>=${n === 0 ? -1 : n - 0.5},${cellule}<${n === 4 ? 5 : n + 0.5})`
            : `AND(${cellule}<>"",${cellule}=${n})`],
        style: dxf(RAMPE[n]),
    }));
    ws.addConditionalFormatting({ ref: `${colonne}${premiere}:${colonne}${derniere}`, rules });
}

/**
 * Barre de données dans une colonne de nombres.
 *
 * C'est la seule forme de diagramme que ce classeur puisse porter. La
 * bibliothèque n'écrit aucun graphique — ni histogramme, ni courbe, ni radar :
 * le format les décrit dans des pièces séparées du fichier, qu'elle ne produit
 * pas. Coller une image du graphe resterait possible, mais ce serait un dessin
 * mort : il ne suivrait ni le tri, ni le filtre, ni une valeur retouchée.
 *
 * Une barre de données, elle, est une mise en forme conditionnelle comme les
 * couleurs de maturité. Elle vit dans la cellule, garde le nombre lisible à côté
 * d'elle, et se recalcule toute seule. `showValue` n'est pas négociable : la
 * barre s'ajoute au chiffre, elle ne le remplace pas.
 *
 * Les priorités partent de 10 : elles ne doivent pas entrer en concurrence avec
 * celles des règles de couleur, qui occupent 1 à 5.
 */
function barres(ws, colonne, premiere, derniere) {
    ws.addConditionalFormatting({
        ref: `${colonne}${premiere}:${colonne}${derniere}`,
        rules: [{
            type: "dataBar",
            priority: 10,
            gradient: false,
            showValue: true,
            minLength: 0,
            maxLength: 88,          // laisse le nombre lisible même au maximum
            cfvo: [{ type: "num", value: 0 }, { type: "max" }],
            color: { argb: BARRE },
        }],
    });
}

/* --------------------------------------------------------------- le classeur */

/**
 * Construit le classeur.
 * @param {object} ExcelJS la bibliothèque
 * @param {object} layer
 * @param {object} data référentiel ATT&CK normalisé
 * @param {Map} scores par technique, tel que produit par `buildMatrixScores`
 * @param {Map} levels niveau par mitigation
 */
export function buildWorkbook(ExcelJS, layer, data, scores, levels) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "MAPTRIX";
    wb.created = new Date();

    feuilleReponses(wb, layer, levels);
    feuilleMitigations(wb, layer, data, levels);
    feuilleTechniques(wb, data, scores);
    feuilleMatrice(wb, data, scores);
    feuilleMetadonnees(wb, layer, data);

    return wb;
}

/* --- Réponses : le contrat de relecture ------------------------------------ */

function feuilleReponses(wb, layer, levels) {
    // Les lignes ne portent que ce qui varie d'une question à l'autre. Le nom de
    // la mitigation et sa note ne sont pas répétés : ils tiennent la ligne de
    // synthèse qui clôt chaque bloc. L'identifiant, lui, reste sur chaque ligne —
    // c'est par lui que la relecture rattache une réponse, il ne peut pas
    // disparaître — mais discret, il n'est là que pour la machine.
    //
    // Deux notions de niveau se croisent ici, et les confondre était le défaut de
    // la version précédente : « Palier de la question » est le degré d'exigence
    // que *cette* question mesure, « Note » est le résultat obtenu par la
    // mitigation entière.
    const ws = tableau(wb, RESPONSE_SHEET, [
        { header: "Mitigation", key: "id", width: 11 },
        // « N° » plutôt que « Numéro » : un intitulé court ne peut pas se couper,
        // et il ne dit rien de moins dans une colonne de numéros. La relecture
        // accepte les deux, les classeurs déjà exportés restent lisibles.
        { header: "N°", key: "num", width: 7 },
        { header: "Palier de la question", key: "palier", width: 12 },
        { header: "Question", key: "question", width: 68 },
        { header: "Réponse", key: "reponse", width: 11 },
        { header: "Outil (si applicable)", key: "outil", width: 20 },
        { header: "Références", key: "refs", width: 28 },
        { header: "Répondu le", key: "date", width: 12 },
        { header: "Note", key: "note", width: 8 },
    ]);

    const syntheses = [];

    for (const [id, questionnaire] of layer.catalog) {
        // Réponses résolues : une question commune apparaît renseignée sur
        // chacune des mitigations concernées, ce qui est ce qu'on attend en
        // lisant l'export.
        const entries = resolvedEntries(layer, id);
        const dates = [];

        for (const q of questionnaire.questions) {
            const entry = entries[q.num];
            if (entry?.at) dates.push(entry.at.slice(0, 10));
            ws.addRow({
                id,
                num: q.num,
                palier: q.level,
                question: q.text,
                reponse: entry?.value || "",
                outil: entry?.tool || "",
                refs: q.references,
                date: entry?.at ? entry.at.slice(0, 10) : "",
            });
        }

        // La ligne qui clôt le bloc. Elle ne porte aucun numéro de question :
        // la relecture l'ignore donc d'elle-même, sans avoir à la reconnaître.
        const note = levels?.has(id) ? levels.get(id) : "";
        const ligne = ws.addRow({
            id,
            question: `${questionnaire.name} : ${questionnaire.questions.length} question`
                + `${questionnaire.questions.length > 1 ? "s" : ""}`,
            date: dates.sort().at(-1) ?? "",
            note,
        });
        syntheses.push({ ligne: ligne.number, note });
        ws.addRow({});                                  // respiration entre deux blocs
    }

    ws.getColumn("question").alignment = { wrapText: true, vertical: "top" };
    ws.getColumn("refs").alignment = { wrapText: true, vertical: "top" };
    for (const key of ["num", "palier", "reponse", "date", "note"]) {
        ws.getColumn(key).alignment = { horizontal: "center", vertical: "top" };
    }
    // L'identifiant n'intéresse que la machine : présent, mais en retrait.
    ws.getColumn("id").font = { size: 9, color: { argb: GRIS } };

    filtrer(ws);
    rayer(ws);
    habillerSyntheses(ws, syntheses);
    coifferEntete(ws);

    const derniere = ws.rowCount;
    if (derniere < 2) return ws;

    // Les plages sont dérivées de la clé de colonne, jamais écrites en dur : une
    // colonne insérée décalait sinon la validation sur la voisine.
    const plage = key => {
        const l = ws.getColumn(key).letter;
        return `${l}2:${l}${derniere}`;
    };

    // La colonne des réponses est la seule qu'on retouche à la main dans le
    // classeur : liste fermée pour ne pas y écrire une valeur que l'import
    // ignorerait en silence, et couleur pour la relire d'un coup d'œil.
    ws.dataValidations.add(plage("reponse"), {
        type: "list",
        allowBlank: true,
        formulae: [`"${ANSWERS.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Réponse attendue",
        error: `Valeurs acceptées à la relecture : ${ANSWERS.join(", ")}.`,
    });
    ws.addConditionalFormatting({
        ref: plage("reponse"),
        rules: ANSWERS.map((valeur, i) => ({
            type: "cellIs", operator: "equal", priority: i + 1,
            formulae: [`"${valeur}"`],
            style: dxf(REPONSE_FONDS[valeur] ?? NEUTRE),
        })),
    });
    return ws;
}

/* --- Mitigations ---------------------------------------------------------- */

function feuilleMitigations(wb, layer, data, levels) {
    const ws = tableau(wb, "Mitigations", [
        { header: "ID", key: "id", width: 10 },
        { header: "Mitigation", key: "nom", width: 42 },
        { header: "Note de la mitigation", key: "niveau", width: 12 },
        { header: "Palier", key: "palier", width: 14 },
        { header: "Questionnaire disponible", key: "dispo", width: 14 },
        { header: "Techniques couvertes", key: "couvertes", width: 13 },
    ]);

    for (const m of data.mitigations) {
        const niveau = levels.has(m.id) ? levels.get(m.id) : "";
        ws.addRow({
            id: m.id,
            nom: m.name,
            niveau,
            palier: niveau === "" ? "non évalué" : LEVEL_LABELS[niveau] ?? "",
            dispo: layer.catalog.has(m.id) ? "Oui" : "Non",
            couvertes: m.techniques.length,
        });
    }

    for (const key of ["niveau", "dispo", "couvertes"]) {
        ws.getColumn(key).alignment = { horizontal: "center" };
    }
    ws.getColumn("niveau").font = { bold: true };
    filtrer(ws);
    rayer(ws);
    coifferEntete(ws);
    if (ws.rowCount > 1) {
        couleursMaturite(ws, ws.getColumn("niveau").letter, 2, ws.rowCount);
        // Le levier de chaque mitigation, en barres : trié sur cette colonne, le
        // classeur donne à voir où l'effort porte le plus. Une note basse sur une
        // barre longue, c'est un chantier à ouvrir en premier.
        barres(ws, ws.getColumn("couvertes").letter, 2, ws.rowCount);
    }
    return ws;
}

/* --- Techniques, à plat --------------------------------------------------- */

function feuilleTechniques(wb, data, scores) {
    const ws = tableau(wb, "Techniques", [
        { header: "Tactique", key: "tactique", width: 22 },
        { header: "ID", key: "id", width: 10 },
        { header: "Technique", key: "nom", width: 40 },
        { header: "Score", key: "score", width: 8 },
        { header: "État", key: "etat", width: 17 },
        { header: "Mitigations couvrantes", key: "nb", width: 12 },
        { header: "Mitigations", key: "liste", width: 34 },
        { header: "Sous-techniques", key: "sous", width: 12 },
    ]);

    // Une ligne par couple tactique / technique : une technique rattachée à
    // deux tactiques apparaît deux fois, exactement comme dans la grille. C'est
    // ce qui permet de croiser par tactique sans se tromper de total.
    for (const tactique of data.tactics) {
        for (const tech of data.byTactic.get(tactique.shortname) ?? []) {
            const cell = scores.get(tech.id);
            const chiffrable = cell?.state === CELL_STATE.SCORED;
            ws.addRow({
                tactique: tactique.name,
                id: tech.id,
                nom: tech.name,
                score: chiffrable ? round2(cell.score) : "",
                etat: cell?.state === CELL_STATE.NO_MITIGATION ? "pas de mitigation"
                    : chiffrable ? "évalué" : "non évalué",
                nb: cell?.mitigations?.length ?? 0,
                liste: (cell?.mitigations ?? []).map(m => m.id).join(" "),
                sous: data.subTechniques.filter(s => s.id.startsWith(`${tech.id}.`)).length,
            });
        }
    }

    ws.getColumn("score").numFmt = "0.00";
    for (const key of ["score", "nb", "sous"]) {
        ws.getColumn(key).alignment = { horizontal: "center" };
    }
    ws.getColumn("liste").alignment = { wrapText: true, vertical: "top" };
    filtrer(ws);
    rayer(ws);
    coifferEntete(ws);
    if (ws.rowCount > 1) {
        couleursMaturite(ws, ws.getColumn("score").letter, 2, ws.rowCount, { decimal: true });
        // Combien de mitigations couvrent la technique : une case à barre courte
        // est une technique qui ne tient qu'à un fil.
        barres(ws, ws.getColumn("nb").letter, 2, ws.rowCount);
    }
    return ws;
}

/* --- Matrice : la grille -------------------------------------------------- */

function feuilleMatrice(wb, data, scores) {
    // Les deux premières lignes sont figées : les noms de tactiques et leur
    // effectif. Les colonnes, elles, ne le sont pas — on lit de gauche à droite.
    const ws = wb.addWorksheet("Matrice", { views: [{ state: "frozen", ySplit: 2 }] });

    const colonnes = data.tactics.map(t => data.byTactic.get(t.shortname) ?? []);
    const hauteur = Math.max(...colonnes.map(c => c.length), 0);

    const tete = ws.getRow(1);
    const compte = ws.getRow(2);
    data.tactics.forEach((t, i) => {
        const c = tete.getCell(i + 1);
        c.value = t.name;
        c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        c.fill = remplir(ENTETE);
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

        const n = compte.getCell(i + 1);
        n.value = `${colonnes[i].length} techniques`;
        n.font = { size: 8, color: { argb: GRIS } };
        n.alignment = { horizontal: "center" };

        ws.getColumn(i + 1).width = 26;
    });
    tete.height = 30;

    for (let r = 0; r < hauteur; r++) {
        const ligne = ws.getRow(r + 3);
        ligne.height = 26;
        colonnes.forEach((techniques, col) => {
            const tech = techniques[r];
            if (!tech) return;
            const cell = ligne.getCell(col + 1);
            const état = scores.get(tech.id);
            const chiffrable = état?.state === CELL_STATE.SCORED;

            // La couleur ne porte jamais l'information seule : la cellule
            // imprime son score sous le nom de la technique.
            cell.value = `${tech.id} · ${tech.name}\n${
                chiffrable ? round2(état.score).toFixed(2).replace(".", ",")
                    : état?.state === CELL_STATE.NO_MITIGATION ? "pas de mitigation" : "non évalué"}`;
            cell.alignment = { wrapText: true, vertical: "middle", indent: 1 };
            cell.border = { bottom: { style: "hair", color: { argb: TRAIT } } };
            cell.font = { size: 9, color: { argb: chiffrable ? ENCRE[état.level] : GRIS } };
            // Peinte et non conditionnelle : la valeur de la cellule est du
            // texte, aucune règle ne saurait en déduire un palier.
            cell.fill = remplir(chiffrable ? RAMPE[état.level] : NEUTRE);
        });
    }

    legende(ws, hauteur + 4);
    return ws;
}

/** Rappel de la rampe sous la grille : sans elle, les couleurs sont muettes. */
function legende(ws, ligne) {
    const titre = ws.getRow(ligne).getCell(1);
    titre.value = "Échelle de maturité";
    titre.font = { bold: true, size: 9 };

    const paliers = ws.getRow(ligne + 1);
    for (let n = 0; n <= 4; n++) {
        const c = paliers.getCell(n + 1);
        c.value = `${n} - ${LEVEL_LABELS[n]}`;
        c.fill = remplir(RAMPE[n]);
        c.font = { size: 9, color: { argb: ENCRE[n] } };
        c.alignment = { horizontal: "center" };
    }
    const suite = ws.getRow(ligne + 2);
    suite.getCell(1).value = "Fond gris : technique sans mitigation, ou mitigations non encore évaluées.";
    suite.getCell(1).font = { size: 9, color: { argb: GRIS } };
}

/* --- Métadonnées ---------------------------------------------------------- */

function feuilleMetadonnees(wb, layer, data) {
    const ws = wb.addWorksheet(META_SHEET);
    ws.columns = [{ width: 30 }, { width: 46 }];

    const lignes = [
        ["Layer", layer.name],
        ["Version ATT&CK Enterprise", data.version],
        ["Exporté le", new Date().toISOString().slice(0, 19).replace("T", " ")],
        ["Répondant", layer.respondent?.name || ""],
        ["Organisation", layer.respondent?.org || ""],
        ["Courriel", layer.respondent?.email || ""],
        ["Mode de notation", layer.scoring],
        ["Mode d'agrégation", layer.aggregation],
    ];
    for (const [libelle, valeur] of lignes) {
        const row = ws.addRow([libelle, valeur]);
        row.getCell(1).font = { bold: true, size: 10 };
        row.getCell(1).alignment = { vertical: "top" };
        row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
    return ws;
}

const round2 = n => Math.round(n * 100) / 100;

/* ------------------------------------------------------------- la relecture */

/**
 * Relit un classeur produit par l'outil, sa feuille « Réponses ».
 *
 * Un seul format est accepté, celui qu'on écrit. Le classeur de travail
 * d'origine n'est pas lu : il n'est pas le point d'entrée de l'outil, et le
 * reconnaître demandait de deviner une disposition de cellules qui n'a rien de
 * contractuel.
 */
export function readWorkbook(wb, { name } = {}) {
    const layer = createLayer({ name });
    const ws = wb.getWorksheet(RESPONSE_SHEET);

    // Le message reste court : à l'écran, « Feuille "Réponses" absente » ne dit
    // rien à qui n'a jamais ouvert le classeur produit. Le détail part en
    // console, où il sert à diagnostiquer.
    if (!ws) {
        console.warn(`Import : feuille « ${RESPONSE_SHEET} » absente du classeur.`);
        throw new Error("format non pris en charge");
    }

    // Les colonnes sont retrouvées par leur intitulé, pas par leur rang : on
    // peut ainsi en insérer une sans casser la relecture.
    const entete = new Map();
    ws.getRow(1).eachCell((cell, col) => entete.set(texte(cell.value), col));
    const colonne = nom => entete.get(nom);

    let found = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
        const ligne = ws.getRow(r);
        const lire = nom => {
            const col = colonne(nom);
            return col ? texte(ligne.getCell(col).value) : "";
        };
        // Plusieurs intitulés sont acceptés pour une même colonne : un classeur
        // exporté avant que « Numéro » devienne « N° » doit continuer à se relire.
        const lireParmi = (...noms) => {
            for (const nom of noms) {
                const col = colonne(nom);
                if (col) return texte(ligne.getCell(col).value);
            }
            return "";
        };
        const id = lire("Mitigation");
        const num = Number(lireParmi("N°", "Numéro"));
        const value = lire("Réponse");
        // L'identifiant vient d'une cellule, donc de quelqu'un : il est reconnu
        // avant de servir de clé. Une cellule contenant `__proto__` aurait écrit
        // la réponse sur le prototype de tous les objets de la page, et non dans
        // le layer. Voir `MITIGATION_ID` dans layer.js.
        if (!MITIGATION_ID.test(id) || !num || !ANSWERS.includes(value)) continue;
        (layer.answers[id] ??= {})[num] = {
            value,
            tool: lire("Outil (si applicable)"),
            note: "",
            at: null,
        };
        found++;
    }

    if (!found) {
        console.warn(
            `Import : la feuille « ${RESPONSE_SHEET} » ne contient aucune réponse exploitable ` +
            "(colonnes attendues : Mitigation, N°, Réponse)."
        );
        throw new Error("aucune réponse à reprendre dans ce fichier");
    }
    layer.answers = sanitiseAnswers(layer.answers);
    lireMetadonnees(wb, layer);
    return layer;
}

/**
 * Reprend du classeur ce qui n'est pas une réponse : le nom de l'évaluation,
 * le répondant, la méthode de notation.
 *
 * Cette lecture est devenue nécessaire le jour où le fichier a cessé de porter
 * le nom du layer. Sans elle, un aller-retour par le classeur rebaptisait
 * l'évaluation du nom du fichier et perdait l'organisation — celle-là même qui
 * nomme le fichier, qui aurait donc changé au réexport.
 *
 * La feuille est facultative : un classeur retouché, ou amputé de cet onglet,
 * reste relisible sur ses seules réponses.
 */
function lireMetadonnees(wb, layer) {
    const ws = wb.getWorksheet(META_SHEET);
    if (!ws) return;

    const valeurs = new Map();
    ws.eachRow(row => valeurs.set(texte(row.getCell(1).value), texte(row.getCell(2).value)));

    const nom = valeurs.get("Layer");
    if (nom) layer.name = nom;
    layer.respondent = {
        name: valeurs.get("Répondant") || "",
        org: valeurs.get("Organisation") || "",
        email: valeurs.get("Courriel") || "",
    };
    // Un mode inconnu — cellule retouchée, classeur d'une version ultérieure —
    // laisserait la matrice sans notation : on garde alors celui par défaut.
    // `Object.hasOwn` et non `in` : `in` suit la chaîne de prototypes, si bien
    // qu'une cellule contenant « toString » ou « constructor » passait pour un
    // mode de notation valide.
    const scoring = valeurs.get("Mode de notation");
    if (scoring && Object.hasOwn(SCORING_MODES, scoring)) layer.scoring = scoring;
    const aggregation = valeurs.get("Mode d'agrégation");
    if (aggregation && Object.hasOwn(AGGREGATION_MODES, aggregation)) layer.aggregation = aggregation;
}

/**
 * Valeur d'une cellule en texte. ExcelJS rend selon le cas une chaîne, un
 * nombre, une formule, un texte enrichi ou un lien : tout est ramené au texte
 * affiché, seul contenu qui ait un sens ici.
 */
function texte(valeur) {
    if (valeur === null || valeur === undefined) return "";
    if (typeof valeur === "object") {
        if (Array.isArray(valeur.richText)) return valeur.richText.map(t => t.text).join("").trim();
        if ("text" in valeur) return String(valeur.text).trim();
        if ("result" in valeur) return String(valeur.result).trim();
        return "";
    }
    return String(valeur).trim();
}

/* ------------------------------------------------- chargement à la demande */

const CDN = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
/* Empreinte publiée par cdnjs pour cette version exacte. Le navigateur refuse
   d'exécuter un fichier qui ne lui correspond pas : un CDN compromis, ou un
   intermédiaire qui réécrit le trafic, n'obtient pas l'exécution de son script
   dans une page qui manipule des évaluations de sécurité. À reprendre à chaque
   changement de version — une empreinte périmée bloque le chargement. */
const CDN_EMPREINTE = "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==";
let chargement = null;

/**
 * Charge la bibliothèque au premier besoin, et une seule fois.
 *
 * Elle ne sert qu'à l'export et à l'import : la faire attendre épargne 250 Ko
 * au démarrage, alors que la page a déjà le référentiel ATT&CK à télécharger.
 * Le banc, lui, la pose sur `globalThis` et rien n'est demandé au réseau.
 */
export function loadExcel() {
    if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
    chargement ??= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = CDN;
        s.integrity = CDN_EMPREINTE;
        // Sans requête inter-origine explicite, la réponse est opaque et
        // l'empreinte ne peut pas être calculée : le contrôle serait ignoré.
        s.crossOrigin = "anonymous";
        s.referrerPolicy = "no-referrer";
        s.onload = () => globalThis.ExcelJS
            ? resolve(globalThis.ExcelJS)
            : reject(new Error("bibliothèque Excel chargée mais introuvable"));
        s.onerror = () => {
            chargement = null;
            reject(new Error("bibliothèque Excel inaccessible, vérifiez la connexion"));
        };
        document.head.appendChild(s);
    });
    return chargement;
}
