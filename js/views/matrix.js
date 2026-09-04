/* ============================================================================
   Le tableau de bord.

   Trois lectures d'une même évaluation, côte à côte : la rosace donne la forme
   d'ensemble, la liste des mitigations donne le détail chiffré, la matrice donne
   la carte. Chacune répond à une question différente — « où en est-on ? »,
   « laquelle reprendre ? », « quelle zone est découverte ? » — et les avoir
   ensemble évite d'avoir à s'en souvenir en changeant d'écran.

   Chaque panneau s'agrandit sur toute la surface, par un bouton qui devient une
   croix : la matrice de quinze tactiques mérite la pleine largeur, et la rosace
   se lit mieux en grand.

   La matrice elle-même est construite depuis les données ATT&CK relues à chaque
   chargement. L'ordre des colonnes vient de `tactic_refs`, donc la vue absorbe
   sans modification une évolution du référentiel — la scission de Defense
   Evasion en Stealth et Defense Impairment en v19 ajoute simplement une colonne.
   ========================================================================= */

import { esc, $, $$, toast, openModal, closeModal, download } from "../ui.js";
import { LEVEL_LABELS, LEVEL_DEFINITIONS, getQuestionnaire, QUESTIONNAIRES } from "../catalog.js";
import { resolvedEntries } from "../shared-questions.js";
import { buildMatrixScores, mitigationLevels, tacticLevels, CELL_STATE, SCORING_MODES, AGGREGATION_MODES } from "../scoring.js";
import { exportExcel, exportJSON, exportName } from "../io.js";
import { rosace, rosaceAutonome } from "./home-visuals.js";
import { techniquesDeCve, normaliserCve, perimetreCve } from "../cve.js";

/** État de vue, volontairement hors du layer : ce n'est pas de la donnée d'évaluation. */
const view = {
    query: "",
    platforms: new Set(),      // toutes cochées au départ ; vide = tout masqué
    platformsReady: false,
    showSubs: false,
    expanded: null,            // nom du panneau en plein écran, ou null
    /* Deux façons de désigner ce qu'on veut voir ressortir dans la matrice, et
       elles s'excluent : la carte ne peut répondre qu'à une question à la fois.
       Choisir l'une éteint l'autre. */
    highlight: "",             // mitigation sélectionnée dans la liste
    tactic: "",                // tactique sélectionnée sur la rosace
    /* Une CVE résolue met elle aussi la matrice en avant, et selon la même
       grammaire. Elle est à part des deux précédentes parce qu'elle ne se
       désigne pas d'un clic dans la page mais se colle dans un champ, et parce
       qu'elle porte deux listes au lieu d'une. */
    cve: null,                 // résultat de `techniquesDeCve`, ou null
    cveEnCours: false,         // le fichier de données se charge
    /* Réglage d'affichage, pas résultat de recherche : il survit d'une CVE à
       l'autre. Coupé par défaut — ce qu'il ajoute est réel mais large, et une
       matrice qui s'allume de partout au premier essai ne se lit pas. */
    cveHeritees: false,
    cvePerimetre: null,        // date de génération de la table, lue au premier chargement
};

/** Bouton d'agrandissement, en haut à droite de chaque panneau. */
const expandButton = nom => `
    <button class="panel-expand" data-expand="${nom}" title="Agrandir" aria-label="Agrandir ce panneau">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="ico-grow">
            <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="ico-close">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </button>`;

export function renderMatrix(app) {
    const { data } = app;
    // On n'initialise qu'une fois : sinon décocher toutes les plateformes serait
    // annulé au prochain rendu de la vue.
    if (!view.platformsReady) {
        view.platforms = new Set(data.platforms);
        view.platformsReady = true;
    }

    $("#view-matrix").innerHTML = `
        <div id="dash" ${view.expanded ? `data-expanded="${view.expanded}"` : ""}>
            <div id="dash-side">
                <section class="dash-panel" data-panel="rosace">
                    <div class="panel-head">
                        <h2>Maturité par tactique</h2>
                        <!-- L'export n'a de sens qu'en grand : c'est là qu'on
                             regarde la rosace pour ce qu'elle vaut, et qu'on a
                             envie de l'emporter dans une présentation. -->
                        <button class="btn btn-sm rosace-export" id="rosace-export">Exporter</button>
                        ${expandButton("rosace")}
                    </div>
                    <div class="panel-body" id="dash-rosace"></div>
                </section>

                <section class="dash-panel" data-panel="mitigations">
                    <div class="panel-head"><h2>Mitigations</h2>${expandButton("mitigations")}</div>
                    <div class="panel-body" id="dash-mitigations"></div>
                </section>

                <section class="dash-panel" data-panel="cve">
                    <div class="panel-head"><h2>CVE</h2></div>
                    <div class="panel-body">
                        <input type="search" id="dash-cve" placeholder="CVE-2021-44228"
                               autocomplete="off" spellcheck="false" aria-describedby="dash-cve-note">
                        <button class="cve-toggle" id="cve-heritees" type="button"
                                aria-pressed="${view.cveHeritees}">
                            <span class="cve-toggle-dot" aria-hidden="true"></span>
                            Techniques héritées
                        </button>
                        <div id="dash-cve-note"></div>
                    </div>
                </section>
            </div>

            <section class="dash-panel" data-panel="matrix">
                <div id="matrix-toolbar">
                    <input type="text" id="matrix-search" placeholder="Rechercher une technique…"
                           value="${esc(view.query)}" autocomplete="off">

                    <div class="dropdown" id="dd-platform">
                        <button class="btn btn-sm" id="dd-platform-btn">
                            Plateformes <span class="chip-count" id="platform-count"></span>
                        </button>
                        <div class="dropdown-panel" id="platform-panel"></div>
                    </div>

                    <label class="tool-group" style="cursor:pointer;">
                        <input type="checkbox" id="matrix-subs" ${view.showSubs ? "checked" : ""}>
                        <span class="tool-label">Sous-techniques</span>
                    </label>

                    <div class="tool-sep"></div>

                    <div class="dropdown" id="dd-method">
                        <button class="btn btn-sm" id="dd-method-btn">Méthode de notation</button>
                        <div class="dropdown-panel" id="method-panel" style="min-width:300px;"></div>
                    </div>

                    <div class="spacer"></div>

                    <div id="matrix-legend"></div>

                    ${expandButton("matrix")}
                </div>

                <div id="matrix-wrapper"><div id="matrix-grid"></div></div>
            </section>
        </div>`;

    // Les actions sur le layer sont montées dans la barre haute, pas ici.
    const actions = $("#topbar-actions");
    actions.classList.remove("hidden");
    actions.innerHTML = `
        <button class="btn btn-sm" id="matrix-quiz">Questionnaire</button>
        <div class="dropdown" id="dd-export">
            <button class="btn btn-sm btn-primary" id="dd-export-btn">Exporter</button>
            <div class="dropdown-panel" id="export-panel" style="min-width:280px;"></div>
        </div>`;

    buildLegend();
    buildPlatformFilter(app);
    buildMethodPanel(app);
    buildExportPanel(app);

    $("#matrix-search").oninput = e => { view.query = e.target.value.trim(); paint(app); };
    brancherCve(app);
    // Le décompte du panneau CVE dépend lui aussi de la visibilité des
    // sous-techniques (voir paintCve) : sans ce second appel, cocher ou
    // décocher la case laissait la note « sous-techniques masquées » affichée
    // à tort, ou disparaître à tort, jusqu'au prochain événement qui la
    // recalculait par ailleurs.
    $("#matrix-subs").onchange = e => { view.showSubs = e.target.checked; paint(app); paintCve(app); };
    $("#matrix-quiz").onclick = () => app.show("quiz");

    for (const button of $$("[data-expand]")) {
        button.onclick = () => toggleExpand(app, button.dataset.expand);
    }
    $("#rosace-export").onclick = () => exporterRosace(app);

    for (const id of ["platform", "method", "export"]) {
        $(`#dd-${id}-btn`).onclick = e => {
            e.stopPropagation();
            const dd = $(`#dd-${id}`);
            const wasOpen = dd.classList.contains("open");
            $$(".dropdown.open").forEach(d => d.classList.remove("open"));
            if (!wasOpen) { dd.classList.add("open"); placePanel(dd); }
        };
    }

    paintSide(app);
    paint(app);
}

/**
 * Bascule un panneau entre sa place dans la grille et le plein écran.
 * Re-cliquer sur le même bouton, devenu une croix, ramène au tableau de bord.
 */
function toggleExpand(app, nom) {
    view.expanded = view.expanded === nom ? null : nom;
    const dash = $("#dash");
    if (view.expanded) dash.dataset.expanded = view.expanded;
    else delete dash.dataset.expanded;

    for (const button of $$("[data-expand]")) {
        const actif = button.dataset.expand === view.expanded;
        button.title = actif ? "Revenir au tableau de bord" : "Agrandir";
        button.setAttribute("aria-label", button.title);
    }

    // La matrice change de régime de colonnes selon qu'elle est en plein écran
    // ou dans son panneau : il faut la redessiner.
    paint(app);
}

/**
 * Cale un panneau sous son bouton, en coordonnées de fenêtre, et le ramène
 * dans l'écran s'il dépasse à droite.
 */
function placePanel(dropdown) {
    const button = dropdown.querySelector("button");
    const panel = dropdown.querySelector(".dropdown-panel");
    const rect = button.getBoundingClientRect();
    const margin = 8;
    const ecart = 5;

    // On mesure d'abord, on place ensuite : la largeur comme la hauteur
    // dépendent du contenu, et le panneau est déjà affiché à ce stade.
    panel.style.top = "0px";
    panel.style.left = "0px";
    const { offsetWidth: width, offsetHeight: height } = panel;

    const left = Math.min(rect.left, window.innerWidth - width - margin);
    panel.style.left = `${Math.max(margin, left)}px`;

    // Sous le bouton si la place existe, au-dessus sinon. Sans cette bascule, un
    // bouton posé en bas de l'écran — c'est le cas de « Exporter », qui descend
    // en pied d'écran sur un téléphone — ouvrait son panneau hors de la fenêtre,
    // et il n'y avait aucun moyen de le voir.
    const tientDessous = rect.bottom + ecart + height + margin <= window.innerHeight;
    panel.style.top = tientDessous
        ? `${rect.bottom + ecart}px`
        : `${Math.max(margin, rect.top - ecart - height)}px`;
}

/* ------------------------------------------------------------------ légende */

function buildLegend() {
    const steps = LEVEL_LABELS.map((label, i) =>
        `<span class="legend-item" title="${esc(LEVEL_DEFINITIONS[i])}">
             <i class="legend-swatch l${i}"></i>${i} ${esc(label)}</span>`
    ).join("");

    // Les deux états non chiffrables sont marqués `aside` : la légende est
    // repliée sur les cinq niveaux quand la place manque, et la hachure comme la
    // surface neutre restent de toute façon explicitées dans la modale.
    $("#matrix-legend").innerHTML = steps +
        `<span class="legend-item aside"><i class="legend-swatch unscored"></i>non évalué</span>` +
        `<span class="legend-item aside"><i class="legend-swatch nomit"></i>pas de mitigation</span>`;
}

/* -------------------------------------------------------- filtre plateforme */

function buildPlatformFilter(app) {
    const { data } = app;
    $("#platform-panel").innerHTML =
        `<label class="row"><input type="checkbox" id="pf-all"><span>Tout sélectionner</span></label>
         <div class="sep"></div>` +
        data.platforms.map(p => `
            <label class="row">
                <input type="checkbox" data-platform="${esc(p)}" ${view.platforms.has(p) ? "checked" : ""}>
                <span>${esc(p)}</span>
            </label>`).join("") +
        `<div class="hint">Filtre sur <code>x_mitre_platforms</code>. Une technique est masquée
         si aucune de ses plateformes n'est sélectionnée.</div>`;

    $("#pf-all").checked = view.platforms.size === data.platforms.length;
    $("#pf-all").onchange = e => {
        view.platforms = e.target.checked ? new Set(data.platforms) : new Set();
        $$('#platform-panel input[data-platform]').forEach(cb => { cb.checked = e.target.checked; });
        paint(app);
    };

    $$('#platform-panel input[data-platform]').forEach(cb => {
        cb.onchange = () => {
            const name = cb.dataset.platform;
            if (cb.checked) view.platforms.add(name); else view.platforms.delete(name);
            $("#pf-all").checked = view.platforms.size === data.platforms.length;
            paint(app);
        };
    });
}

/* ------------------------------------------------------- méthode de notation */

function buildMethodPanel(app) {
    const { layer } = app;
    const block = (title, modes, current, key) => `
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mute);padding:4px 7px 6px;">${title}</div>
        ${Object.entries(modes).map(([value, mode]) => `
            <label class="row" style="align-items:flex-start;">
                <input type="radio" name="${key}" value="${value}" ${current === value ? "checked" : ""} style="margin-top:2px;">
                <span>
                    <b style="font-weight:600;">${esc(mode.label)}</b>
                    <span style="display:block;font-size:0.68rem;color:var(--text-mute);line-height:1.4;margin-top:2px;">${esc(mode.hint)}</span>
                </span>
            </label>`).join("")}`;

    $("#method-panel").innerHTML =
        block("Niveau d'une mitigation", SCORING_MODES, layer.scoring, "scoring") +
        `<div class="sep"></div>` +
        block("Technique couverte par plusieurs mitigations", AGGREGATION_MODES, layer.aggregation, "aggregation") +
        `<div class="hint">Le mode choisi s'applique immédiatement à toute la matrice,
         voyage avec le layer et figure dans l'export.</div>`;

    // Changer de méthode change les notes, donc aussi la rosace et la liste des
    // mitigations : elles sont redessinées avec la grille.
    $$('#method-panel input[name="scoring"]').forEach(radio => {
        radio.onchange = () => { app.layer.scoring = radio.value; paintSide(app); paint(app); };
    });
    $$('#method-panel input[name="aggregation"]').forEach(radio => {
        radio.onchange = () => { app.layer.aggregation = radio.value; paintSide(app); paint(app); };
    });
}

/* ------------------------------------------------------------------ exports */

function buildExportPanel(app) {
    // Le chiffrement est actif par défaut : une évaluation de maturité décrit
    // les faiblesses d'un système d'information. L'export en clair reste
    // accessible, mais il faut le demander.
    $("#export-panel").innerHTML = `
        <div class="field" style="padding:8px 7px 10px;">
            <label for="ex-org">Organisation <span style="color:var(--text-mute);font-weight:400;">(facultatif)</span></label>
            <input type="text" id="ex-org" autocomplete="organization"
                   value="${esc(app.layer.respondent?.org || "")}" placeholder="ex : Acme">
            <span class="help">Fichier : <code id="ex-name"></code></span>
        </div>
        <div class="sep"></div>
        <label class="row" style="align-items:flex-start;">
            <input type="checkbox" id="ex-crypt" checked style="margin-top:2px;">
            <span>
                <b style="font-weight:600;">Chiffrer le fichier JSON</b>
                <span style="display:block;font-size:0.68rem;color:var(--text-mute);line-height:1.4;margin-top:2px;">
                    Recommandé. La clé sera redemandée à l'import.</span>
            </span>
        </label>
        <div class="field" id="ex-pass-field" style="padding:6px 7px 10px;">
            <label for="ex-pass">Clé de chiffrement</label>
            <input type="password" id="ex-pass" autocomplete="new-password">
            <span class="help" id="ex-pass-help">Sans elle, impossible de relire le fichier.
                l'outil ne la conserve nulle part.</span>
        </div>
        <div class="sep"></div>
        <div class="row" id="ex-json" role="button" tabindex="0"><span>↓</span><span>Exporter en JSON</span></div>
        <div class="row" id="ex-xlsx" role="button" tabindex="0"><span>↓</span><span>Exporter en Excel (.xlsx)</span></div>`;

    // L'organisation est une donnée du layer — elle figure déjà dans les
    // métadonnées de l'export. On la saisit ici parce que c'est ici qu'elle sert
    // vraiment : elle nomme le fichier, et l'aperçu montre le nom obtenu avant
    // de cliquer plutôt qu'après.
    const org = $("#ex-org");
    const apercu = () => { $("#ex-name").textContent = `${exportName(app.layer)}.xlsx / .json`; };
    org.oninput = () => {
        app.layer.respondent = { ...app.layer.respondent, org: org.value.trim() };
        apercu();
    };
    apercu();

    const crypt = $("#ex-crypt");
    const passField = $("#ex-pass-field");
    const help = $("#ex-pass-help");

    crypt.onchange = () => {
        passField.style.opacity = crypt.checked ? "1" : "0.4";
        $("#ex-pass").disabled = !crypt.checked;
        help.textContent = crypt.checked
            ? "Sans elle, impossible de relire le fichier. L'outil ne la conserve nulle part."
            : "Le fichier sortira en clair : lisible par quiconque y a accès.";
    };

    $("#ex-json").onclick = async () => {
        const passphrase = crypt.checked ? $("#ex-pass").value : "";
        if (crypt.checked && !passphrase) {
            toast("Saisissez une clé, ou décochez le chiffrement.", "error");
            return;
        }
        $("#dd-export").classList.remove("open");
        // Dériver la clé coûte 600 000 itérations — quelques dixièmes de
        // seconde. C'est ce qui rend le fichier coûteux à attaquer, mais il faut
        // le dire : un clic sans réaction se lit comme un clic sans effet.
        if (passphrase) toast("Chiffrement du fichier…");
        try {
            await exportJSON(app.layer, passphrase);
            toast(`${exportName(app.layer)}${passphrase ? "-chiffre" : ""}.json exporté`
                + `${passphrase ? "" : ", en clair"}.`);
        } catch (err) {
            toast(`Export impossible : ${err.message}`, "error");
        }
    };
    // L'export Excel attend le chargement de sa bibliothèque : on le dit, plutôt
    // que de laisser croire à un clic sans effet.
    $("#ex-xlsx").onclick = async () => {
        $("#dd-export").classList.remove("open");
        toast("Préparation du classeur…");
        try {
            await exportExcel(app.layer, app.data);
            toast(`${exportName(app.layer)}.xlsx exporté.`);
        } catch (err) {
            toast(`Export Excel impossible : ${err.message}`, "error");
        }
    };
}

/* --------------------------------------------------------------- rendu grille */

function paint(app) {
    const { data, layer } = app;
    const scores = buildMatrixScores(data, layer);
    const grid = $("#matrix-grid");
    const query = view.query.toLowerCase();


    $("#platform-count").textContent = view.platforms.size === data.platforms.length
        ? "tout" : String(view.platforms.size);

    // Deux régimes de colonnes.
    //
    // En plein écran, la matrice doit tenir tout entière : les colonnes se
    // partagent la largeur à parts égales, sans plancher, et les libellés
    // passent à la ligne autant qu'il le faut. C'est le seul moyen de voir les
    // zones faibles d'un coup d'œil — but de cet écran.
    //
    // Dans le tableau de bord, le panneau ne fait que la largeur restante :
    // écraser quinze colonnes là-dedans les rendrait illisibles. On garde donc
    // un plancher et le défilement horizontal.
    // Une mitigation peut ne viser qu'une sous-technique : on surligne alors
    // aussi la technique parente, sinon la case visible resterait éteinte.
    let highlighted = null;
    if (view.cve?.connue) {
        // Les techniques parentes des sous-techniques sont déjà dans les listes,
        // posées à la génération du fichier : ici il n'y a qu'à réunir. Vérifiées
        // et directes sont deux catégories de lien établi vers la vulnérabilité
        // elle-même : les deux s'allument sans condition, seules les héritées
        // — un lien de famille — dépendent de l'interrupteur.
        highlighted = new Set([...view.cve.verifiees, ...view.cve.direct]);
        if (view.cveHeritees) for (const id of view.cve.heritees) highlighted.add(id);
    } else if (view.highlight) {
        highlighted = new Set(data.mitigationById.get(view.highlight)?.techniques ?? []);
        for (const id of [...highlighted]) highlighted.add(String(id).split(".")[0]);
    }

    const plein = view.expanded === "matrix";
    grid.classList.toggle("fit", plein);
    grid.style.gridTemplateColumns = plein
        ? `repeat(${data.tactics.length}, minmax(0, 1fr))`
        : `repeat(${data.tactics.length}, minmax(96px, 1fr))`;
    grid.innerHTML = "";

    let visibleTotal = 0;

    for (const tactic of data.tactics) {
        const all = data.byTactic.get(tactic.shortname) || [];
        const shown = all.filter(t => matchesPlatform(t));
        visibleTotal += shown.length;

        const column = document.createElement("div");
        // Une tactique sélectionnée sur la rosace met sa colonne en avant et
        // éteint les autres — même grammaire que le surlignage d'une mitigation.
        const retenue = !view.tactic || view.tactic === tactic.shortname;
        column.className = `tactic-col${view.tactic ? (retenue ? " picked" : " faded") : ""}`;
        column.dataset.tactic = tactic.shortname;

        const scored = shown.filter(t => scores.get(t.id)?.state === CELL_STATE.SCORED).length;
        const pct = shown.length ? Math.round((scored / shown.length) * 100) : 0;

        // Plus de « 11 techniques · 6 évaluées » : la colonne montre déjà ses
        // cases et leurs couleurs, le compte n'ajoutait qu'une ligne de chiffres
        // au-dessus de chacune des quinze colonnes. Le décompte reste dans
        // l'infobulle, pour qui le cherche.
        const head = document.createElement("div");
        head.className = "tactic-head";
        head.innerHTML = `
            <div class="t-name">${esc(tactic.name)}</div>
            <div class="t-bar"><span style="width:${pct}%"></span></div>`;
        head.title = `${tactic.id} ${tactic.name} · ${shown.length}`
            + `${shown.length !== all.length ? `/${all.length}` : ""} techniques, ${scored} évaluées`;
        column.appendChild(head);

        for (const tech of shown) {
            column.appendChild(cellFor(app, tech, scores, query, highlighted));

            if (view.showSubs && tech.subs.length) {
                const box = document.createElement("div");
                box.className = "subs";
                for (const sub of tech.subs) {
                    if (!matchesPlatform(sub)) continue;
                    box.appendChild(cellFor(app, sub, scores, query, highlighted, true));
                }
                if (box.children.length) column.appendChild(box);
            }
        }

        grid.appendChild(column);
    }

    if (visibleTotal === 0) {
        grid.innerHTML = `<div class="matrix-empty" style="grid-column:1/-1;">
            Aucune technique ne correspond au filtre de plateformes.
        </div>`;
    }
}

const matchesPlatform = tech =>
    tech.platforms.length === 0 || tech.platforms.some(p => view.platforms.has(p));

/* ------------------------------------------------------ panneaux de gauche

   Redessinés à part de la grille, et seulement quand les notes changent.

   Les rattacher à `paint` les reconstruisait à chaque frappe dans la recherche
   et à chaque case de plateforme cochée : la rosace rejouait son animation de
   tracé sous les doigts du répondant. Or filtrer la matrice ne change aucune
   note — seuls une réponse au questionnaire et un changement de méthode de
   notation le font. */

/**
 * Écrit la rosace dans un fichier SVG.
 *
 * SVG plutôt qu'une image de pixels : le dessin reste net à toutes les tailles,
 * ce qui compte pour une figure destinée à une présentation ou à un rapport, et
 * le format s'ouvre dans un navigateur comme il s'insère dans un document. Le
 * fichier est autonome — les couleurs du thème en cours y sont figées.
 */
function exporterRosace(app) {
    const svg = $("#dash-rosace .rosace");
    if (!svg) return;

    const nom = `${exportName(app.layer)}-rosace.svg`;
    download(nom, new Blob([rosaceAutonome(svg)], { type: "image/svg+xml" }));
    toast(`${nom} exporté.`);
}

/** Les deux panneaux qui dépendent des notes. */
function paintSide(app) {
    const scores = buildMatrixScores(app.data, app.layer);
    const host = $("#dash-rosace");
    // La rosace, sur les niveaux réellement atteints — pas l'exemple de l'accueil.
    if (host) {
        host.innerHTML = rosace(app.data, tacticLevels(app.data, scores));
        // Cliquer un sommet met en avant la colonne correspondante de la
        // matrice : le creux qu'on voit sur la rosace se regarde ensuite en
        // détail, sur la carte, sans avoir à retrouver la tactique des yeux.
        for (const cible of $$("#dash-rosace .ros-hit")) {
            cible.onclick = () => choisirTactique(app, cible.dataset.tactic);
        }
    }
    paintMitigations(app);
}

/* ------------------------------------------------------- la recherche par CVE

   Coller une CVE et voir s'allumer, sur la matrice, ce qu'elle permet à un
   attaquant. C'est la même grammaire que le surlignage d'une mitigation, avec
   la question retournée : là on demandait « celle-là, elle protège quoi ? », ici
   on demande « celle-là, elle ouvre quoi ? ».

   Deux qualités de lien, et c'est tout l'intérêt de les séparer. Le NVD attribue
   à une CVE le CWE le plus précis qu'il connaisse, mais ce CWE-là ne mène
   souvent nulle part dans ATT&CK ; ses ancêtres, si. Ce qu'on obtient en
   remontant est vrai — la vulnérabilité appartient bien à cette famille — mais
   ne caractérise plus la vulnérabilité elle-même. Les deux listes restent donc
   distinctes, et les héritées sont coupées par défaut.

   Le fichier de données pèse 1,7 Mo et n'est chargé qu'ici, à la première
   recherche. D'où l'état d'attente : sur une liaison lente, la première CVE
   demande une seconde ou deux, et un champ qui ne répond pas se lit comme une
   panne. */

/** Éteint le surlignage par CVE sans vider le champ, qui appartient au visiteur. */
function effacerCve(app) {
    if (!view.cve && !view.cveEnCours) return;
    view.cve = null;
    view.cveEnCours = false;
    paintCve(app);
}

/* Le jeton d'appel. Chaque frappe relance une résolution asynchrone ; sans lui,
   une réponse lente écraserait une réponse rapide arrivée après elle, et la
   matrice afficherait le résultat d'une saisie déjà remplacée. */
let appelCve = 0;

function brancherCve(app) {
    const champ = $("#dash-cve");
    if (!champ) return;

    let minuteur = null;
    champ.oninput = () => {
        clearTimeout(minuteur);
        // On ne part pas à chaque caractère : « CVE-2021-44228 » en compte
        // quatorze, et les treize premiers ne désignent rien.
        minuteur = setTimeout(() => chercherCve(app, champ.value), 220);
    };

    $("#cve-heritees").onclick = () => {
        view.cveHeritees = !view.cveHeritees;
        paintCve(app);
        paint(app);          // la matrice se rallume ou s'éteint d'autant
    };

    paintCve(app);
}

async function chercherCve(app, saisie) {
    const jeton = ++appelCve;

    if (!String(saisie).trim()) { effacerCve(app); paint(app); return; }
    if (!normaliserCve(saisie)) {
        // Saisie en cours de frappe, ou qui n'est pas une CVE : on n'efface pas
        // le résultat précédent sur un caractère de trop, on attend.
        view.cve = null;
        view.cveEnCours = false;
        paintCve(app);
        paint(app);
        return;
    }

    view.cveEnCours = true;
    paintCve(app);

    let resultat = null;
    try {
        resultat = await techniquesDeCve(saisie);
    } catch (e) {
        if (jeton !== appelCve) return;
        view.cveEnCours = false;
        view.cve = null;
        paintCve(app, "Le fichier des CVE n'a pas pu être chargé.");
        return;
    }
    if (jeton !== appelCve) return;          // une frappe plus récente a pris la main

    view.cveEnCours = false;
    view.cve = resultat;
    // Le fichier est chargé à ce stade : demander son périmètre ne coûte plus
    // rien, et sa date de génération est ce qui dit au visiteur jusqu'où la
    // table va. Une CVE publiée depuis n'y est pas, et il faut qu'il le sache.
    view.cvePerimetre ??= await perimetreCve().catch(() => null);
    // Une CVE reconnue prend la main sur les deux autres mises en avant.
    if (resultat?.connue) { view.highlight = ""; view.tactic = ""; paintMitigations(app); }
    paintCve(app);
    paint(app);
}

/** Le compte rendu sous le champ : ce qui est allumé, et à quel titre. */
function paintCve(app, erreur = "") {
    const hote = $("#dash-cve-note");
    if (!hote) return;

    const bouton = $("#cve-heritees");
    if (bouton) bouton.setAttribute("aria-pressed", String(view.cveHeritees));

    if (erreur) { hote.innerHTML = `<p class="panel-note cve-vide">${esc(erreur)}</p>`; return; }
    if (view.cveEnCours) { hote.innerHTML = `<p class="panel-note">Recherche…</p>`; return; }

    const cve = view.cve;
    if (!cve) {
        hote.innerHTML = `<p class="panel-note">
            Collez une CVE pour voir sur la matrice les techniques qu'elle rend possibles.</p>`;
        return;
    }

    if (!cve.connue) {
        hote.innerHTML = `<p class="panel-note cve-vide">
            ${cve.horsPerimetre
                ? `Le millésime ${esc(cve.id.split("-")[1])} n'est pas couvert par la table embarquée.`
                : `Aucune technique connue pour ${esc(cve.id)} : soit le NVD ne lui attribue pas de
                   faiblesse, soit celle-ci ne mène à aucune technique ATT&amp;CK.`}
        </p>`;
        return;
    }

    const total = cve.verifiees.length + cve.direct.length + (view.cveHeritees ? cve.heritees.length : 0);

    // Le compte porte sur les identifiants, sous-techniques comprises : c'est
    // ce qui est réellement établi. Mais la matrice, par défaut, ne montre pas
    // les sous-techniques : leur case n'existe pas, seule celle de leur
    // technique parente s'allume. « 5 directes » et deux cases allumées se
    // lirait comme une erreur de compte ; on distingue donc les deux dans le
    // décompte lui-même plutôt que de laisser deviner, dès qu'il y a une
    // sous-technique dans le lot. Une fois « Sous-techniques » coché, chacune a
    // sa propre case et le compte simple redevient exact : plus besoin de le
    // détailler.
    const decompte = (liste, adjectif) => {
        const n = liste.length;
        const suffixe = n > 1 ? "s" : "";
        if (view.showSubs) return `${n} ${adjectif}${suffixe}`;
        const subs = liste.filter(t => t.includes(".")).length;
        if (!subs) return `${n} ${adjectif}${suffixe}`;
        const parentes = n - subs;
        return `${parentes} technique${parentes > 1 ? "s" : ""}`
            + ` et ${subs} sous-technique${subs > 1 ? "s" : ""} ${adjectif}${suffixe}`;
    };

    hote.innerHTML = `
        <p class="cve-bilan">
            <b>${esc(cve.id)}</b>
            <span>${total} technique${total > 1 ? "s" : ""} en surbrillance</span>
        </p>
        <ul class="cve-detail">
            ${cve.verifiees.length ? `<li><span class="cve-pastille verifiee"></span>
                ${decompte(cve.verifiees, "vérifiée")}, établie${cve.verifiees.length > 1 ? "s" : ""}
                à la main par le MITRE pour cette CVE précisément</li>` : ""}
            <li><span class="cve-pastille directe"></span>
                ${decompte(cve.direct, "directe")}</li>
            <li class="${view.cveHeritees ? "" : "coupee"}">
                <span class="cve-pastille heritee"></span>
                ${decompte(cve.heritees, "héritée")}${view.cveHeritees ? "" : ", non comptées ici"}</li>
        </ul>
        ${view.cvePerimetre ? `<p class="panel-note cve-fraicheur">
            Table figée au ${esc(dateCourte(view.cvePerimetre.genere))} :
            une CVE publiée depuis n'y figure pas.</p>` : ""}`;
}

/* La table est figée à la publication du site : autant l'écrire en toutes
   lettres. Une date au format ISO dans une interface se lit comme une donnée
   technique échappée du code. */
function dateCourte(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? "?"
        : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** Sélectionne — ou désélectionne — la tactique à mettre en avant. */
function choisirTactique(app, shortname) {
    view.tactic = view.tactic === shortname ? "" : shortname;
    view.highlight = "";           // les trois mises en avant s'excluent
    effacerCve(app);
    paintMitigations(app);
    paint(app);
}

/**
 * Les mitigations et leur note.
 *
 * Les non évaluées restent listées, en gris : ce qui reste à faire fait partie
 * de l'état des lieux, et les masquer donnerait une liste qui rétrécit à mesure
 * qu'on avance.
 *
 * Un clic surligne dans la matrice les techniques que la mitigation couvre —
 * c'est la question qu'on se pose devant cette liste : « celle-là, elle protège
 * quoi ? ». La ligne sélectionnée offre alors d'ouvrir son questionnaire.
 */
function paintMitigations(app) {
    const host = $("#dash-mitigations");
    if (!host) return;

    const levels = mitigationLevels(app.layer);

    // Pas de décompte au-dessus de la liste : les notes en regard de chaque
    // ligne le disent déjà, et d'un coup d'œil.
    host.innerHTML = `
        <ul class="mit-list">
            ${app.data.mitigations.map(m => {
                const level = levels.get(m.id);
                const note = level === undefined ? "-" : formatScore(level);
                const classe = level === undefined ? "mit-score vide" : `mit-score l${Math.round(level)}`;
                // M1055 décrit les cas où l'on choisit délibérément de ne pas
                // atténuer : il n'y a pas de maturité à mesurer, donc pas de
                // questionnaire à ouvrir.
                const questionnable = QUESTIONNAIRES.has(m.id);
                const choisie = view.highlight === m.id;
                return `<li>
                    <button class="mit-row${choisie ? " selected" : ""}" data-mitigation="${esc(m.id)}"
                            aria-pressed="${choisie}"
                            title="${esc(m.id)} : ${esc(m.name)}">
                        <span class="${classe}">${note}</span>
                        <span class="mit-id">${esc(m.id)}</span>
                        <span class="mit-name">${esc(m.name)}</span>
                    </button>
                    ${choisie && questionnable
                        ? `<button class="mit-quiz" data-quiz="${esc(m.id)}">Répondre au questionnaire →</button>`
                        : ""}
                    ${choisie && !questionnable
                        ? `<p class="mit-hint">Pas de questionnaire : cette catégorie décrit les cas
                           où l'on choisit de ne pas atténuer.</p>`
                        : ""}
                </li>`;
            }).join("")}
        </ul>`;

    for (const row of $$("[data-mitigation]")) {
        // Re-cliquer la ligne surlignée éteint le surlignage : le geste qui
        // sélectionne est celui qui désélectionne.
        row.onclick = () => {
            view.highlight = view.highlight === row.dataset.mitigation ? "" : row.dataset.mitigation;
            view.tactic = "";       // les trois mises en avant s'excluent
            effacerCve(app);
            paintMitigations(app);
            paint(app);
        };
    }
    for (const button of $$("[data-quiz]")) {
        button.onclick = () => app.show("quiz", { mitigation: button.dataset.quiz });
    }
}

function cellFor(app, tech, scores, query, highlighted, isSub = false) {
    // Une sous-technique hérite de l'état de sa parente : la notation se fait
    // au niveau des mitigations, qui sont rattachées à la technique parente.
    const parentId = isSub ? String(tech.id).split(".")[0] : tech.id;
    const cell = scores.get(parentId);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell" + (isSub ? " sub" : "");
    button.dataset.tech = tech.id;

    if (cell?.state === CELL_STATE.NO_MITIGATION) {
        button.classList.add("no-mitigation");
    } else if (cell?.state === CELL_STATE.SCORED) {
        button.classList.add(`lvl-${cell.level}`);
    } else {
        button.classList.add("unscored");
    }

    if (highlighted) {
        if (highlighted.has(tech.id)) button.classList.add("highlighted");
        else button.classList.add("dimmed");
    }

    if (query && (tech.id.toLowerCase().includes(query) || tech.name.toLowerCase().includes(query))) {
        button.classList.add("match");
    }

    const score = cell?.state === CELL_STATE.SCORED
        ? `<span class="c-score">${formatScore(cell.score)}</span>` : "";
    const subs = !isSub && tech.subs.length && !view.showSubs
        ? `<span class="c-subs">${tech.subs.length}▾</span>` : "";

    button.innerHTML = `<span class="c-id">${esc(tech.id)}</span> ${score}${subs}
        <span class="c-name">${esc(tech.name)}</span>`;
    button.title = `${tech.id} : ${tech.name}`;
    button.onclick = () => openTechnique(app, tech, scores);
    return button;
}

const formatScore = n => Number.isInteger(n) ? String(n) : n.toFixed(1);

/* L'URL de la fiche vient du bundle ATT&CK, donc d'un fichier téléchargé, et
   elle finit dans un `href`. L'échappement HTML ne dit rien du schéma : il
   laisserait passer un `javascript:…` tel quel. On n'accepte donc que le web,
   et à défaut le lien n'est pas proposé plutôt que d'être proposé faux. */
const lienWeb = url => (/^https?:\/\//i.test(String(url ?? "")) ? String(url) : "");

/* ------------------------------------------------- modale d'une technique */

function openTechnique(app, tech, scores) {
    const { data, layer } = app;
    const parentId = String(tech.id).split(".")[0];
    const cell = scores.get(parentId);
    const levels = mitigationLevels(layer);

    const stateTag = cell?.state === CELL_STATE.NO_MITIGATION
        ? `<span class="tag">Aucune mitigation ATT&amp;CK</span>`
        : cell?.state === CELL_STATE.SCORED
            ? `<span class="tag score">Score ${formatScore(cell.score)} / 4 · ${esc(LEVEL_LABELS[cell.level])}</span>`
            : `<span class="tag">Non évaluée</span>`;

    const mitigationRows = (cell?.mitigations ?? []).map(({ id, level }) => {
        const m = data.mitigationById.get(id);
        if (!m) return "";
        // Une mitigation sans question n'est pas évaluable : la catégorie décrit
        // les cas où l'on choisit de ne pas atténuer, il n'y a pas de maturité.
        const assessable = (getQuestionnaire(id)?.questions.length ?? 0) > 0;
        return `
            <li class="mit-row">
                <span class="m-lvl ${level !== null ? `l${Math.round(level)}` : ""}">${level !== null ? formatScore(level) : "-"}</span>
                <span class="m-id">${esc(id)}</span>
                <span class="m-name" title="${esc(m.name)}">${esc(m.name)}</span>
                ${assessable
                    ? `<button class="btn btn-sm" data-edit="${esc(id)}">${level !== null ? "Modifier ma réponse" : "Répondre"}</button>`
                    : `<span class="tag" title="Cette catégorie décrit les cas où l'on choisit délibérément de ne pas atténuer : il n'y a pas de maturité à mesurer.">rien à évaluer</span>`}
            </li>`;
    }).join("");

    const notes = (cell?.mitigations ?? [])
        .map(({ id, level }) => {
            const questionnaire = getQuestionnaire(id);
            if (!questionnaire || level === null) return "";
            const rounded = Math.round(level);

            // Les outils saisis pendant le questionnaire remontent ici : c'est
            // là qu'on veut savoir avec quoi la mitigation est mise en œuvre.
            const entries = resolvedEntries(layer, id);
            const tools = [...new Set(
                questionnaire.questions.map(q => entries[q.num]?.tool).filter(Boolean)
            )];

            return `
                <div class="mit-note">
                    <div class="n-head">
                        <span class="m-lvl l${rounded}" style="width:20px;height:20px;border-radius:4px;display:inline-grid;place-items:center;font-size:0.65rem;font-weight:700;">${formatScore(level)}</span>
                        <b>${esc(id)}</b> ${esc(questionnaire.name)}
                    </div>
                    <div class="n-bareme">${esc(questionnaire.bareme[rounded])}</div>
                    ${tools.length
                        ? `<div class="n-tools"><span class="n-tools-label">Outils</span>
                             ${tools.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
                        : ""}
                    <div class="n-desc">${esc(questionnaire.description)}</div>
                </div>`;
        })
        .filter(Boolean)
        .join("");

    const panel = openModal(`
        <div class="modal-head">
            <h3 style="margin:0;font-size:1.05rem;">${esc(tech.id)} : ${esc(tech.name)}</h3>
            <div class="tech-meta">
                ${stateTag}
                ${tech.platforms.map(p => `<span class="tag">${esc(p)}</span>`).join("")}
            </div>
        </div>
        <div class="modal-body">
            <div class="tech-desc">${esc(tech.description).replace(/\n+/g, "<br><br>")}</div>

            <div class="panel-cols">
                <div>
                    <h4>Mitigations associées (${cell?.mitigations?.length ?? 0})</h4>
                    ${mitigationRows
                        ? `<ul class="mit-list">${mitigationRows}</ul>`
                        : `<p style="font-size:0.76rem;color:var(--text-mute);margin:0;line-height:1.5;">
                             Aucune mitigation ATT&amp;CK ne couvre cette technique. Elle relève d'autres
                             leviers : détection, durcissement d'architecture, ou acceptation du risque.
                           </p>`}
                </div>
                <div>
                    <h4>Sous-techniques (${tech.subs?.length ?? 0})</h4>
                    ${tech.subs?.length
                        ? `<ul class="sub-list">${tech.subs.map(s =>
                              `<li><span class="s-id">${esc(s.id)}</span> ${esc(s.name)}</li>`).join("")}</ul>`
                        : `<p style="font-size:0.76rem;color:var(--text-mute);margin:0;">Aucune.</p>`}
                </div>
            </div>

            ${notes ? `<div class="mit-notes"><h4 style="margin:22px 0 9px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mute);">Notes de mitigation</h4>${notes}</div>` : ""}

            <div class="panel-foot">
                <span class="grow">ATT&amp;CK Enterprise v${esc(data.version)}</span>
                ${lienWeb(tech.url)
                    ? `<a class="btn btn-sm" href="${esc(lienWeb(tech.url))}" target="_blank"
                         rel="noopener noreferrer">Fiche MITRE ↗</a>`
                    : ""}
            </div>
        </div>`, { wide: true });

    panel.querySelectorAll("[data-edit]").forEach(button => {
        button.onclick = () => {
            const id = button.dataset.edit;
            closeModal();
            app.show("quiz", { mitigation: id });
        };
    });
}

/** Rafraîchit la matrice si elle est déjà construite (retour du questionnaire). */
export function repaintMatrix(app) {
    if (!$("#matrix-grid")) return;
    paintSide(app);
    paint(app);
}

/** Remet les filtres à zéro : appelé quand on change de layer. */
export function resetMatrixView() {
    view.query = "";
    view.showSubs = false;
    view.platformsReady = false;
    view.highlight = "";
    view.tactic = "";
    view.cve = null;
    view.cveEnCours = false;
    view.expanded = null;
}
