/* ============================================================================
   Page d'accueil.

   Une seule page, cinq sections, et la barre haute qui y descend :

     accueil    la promesse, et la matrice à côté
     démarrer   les deux entrées — créer un layer, en rouvrir un
     comment    le parcours en trois temps
     bénéfices  ce que l'évaluation donne une fois faite
     faq        ce qu'on demande avant de commencer

   Les deux entrées restent ce pour quoi la page existe :
     - Nouveau layer            -> démarre le questionnaire
     - Ouvrir un layer existant -> importe un JSON ou un Excel, puis reprend
       à la première question non répondue (ou va droit à la matrice si tout
       est complété)
   ========================================================================= */

import { esc, $, $$, toast, openModal, closeModal } from "../ui.js";
import { createLayer, nextTarget, progress } from "../layer.js";
import { readLayerFile, isEncrypted } from "../io.js";
import { heroMatrix, rosace, animerMatrice } from "./home-visuals.js";

/* Les deux entrées portaient un losange plein et un losange vide. Côte à côte,
   ces deux états d'un même signe se lisent comme « sélectionné » et « non
   sélectionné » — alors que ce sont deux actions distinctes, dont aucune n'est
   un choix déjà fait. Deux dessins sans rapport l'un avec l'autre lèvent
   l'ambiguïté : on crée d'un côté, on ouvre de l'autre. */
const GLYPH_NEW = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" stroke-width="1.6"/>
        <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;

const GLYPH_OPEN = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 15.5V4m0 0L8.2 7.8M12 4l3.8 3.8" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4.5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V14" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;

/* ------------------------------------------------------------- les bénéfices

   Quatre cartes sombres sur le fond blanc cassé : c'est le seul endroit de la
   page où le contraste s'inverse, et c'est voulu — on y annonce le résultat, pas
   le mode d'emploi.

   Chaque carte porte une vignette. Elles ne montrent aucun chiffre : une jauge
   qui afficherait « 87 % » sur une page publique se lirait comme une mesure,
   alors que c'est un dessin. Ce sont des silhouettes — une couverture, une part,
   une courbe, une trame —, assez pour dire de quoi on parle, pas assez pour
   qu'on croie y lire un résultat. */
const VIGNETTES = {
    couverture: `
        <svg viewBox="0 0 120 56" aria-hidden="true">
            <g class="vg-bars">
                <rect x="4"  y="8"  width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="28" y="8"  width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="52" y="8"  width="20" height="12" rx="2" class="vg-mid"/>
                <rect x="76" y="8"  width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="100" y="8" width="16" height="12" rx="2" class="vg-ok"/>
                <rect x="4"  y="24" width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="28" y="24" width="20" height="12" rx="2" class="vg-low"/>
                <rect x="52" y="24" width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="76" y="24" width="20" height="12" rx="2" class="vg-mid"/>
                <rect x="100" y="24" width="16" height="12" rx="2" class="vg-ok"/>
                <rect x="4"  y="40" width="20" height="12" rx="2" class="vg-mid"/>
                <rect x="28" y="40" width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="52" y="40" width="20" height="12" rx="2" class="vg-low"/>
                <rect x="76" y="40" width="20" height="12" rx="2" class="vg-ok"/>
                <rect x="100" y="40" width="16" height="12" rx="2" class="vg-ok"/>
            </g>
        </svg>`,
    part: `
        <svg viewBox="0 0 120 56" aria-hidden="true">
            <circle cx="60" cy="28" r="20" fill="none" class="vg-track" stroke-width="7"/>
            <circle cx="60" cy="28" r="20" fill="none" class="vg-arc" stroke-width="7"
                    stroke-linecap="round" stroke-dasharray="88 126"
                    transform="rotate(-90 60 28)"/>
        </svg>`,
    courbe: `
        <svg viewBox="0 0 120 56" aria-hidden="true">
            <path class="vg-area" d="M4 48 C 26 12, 44 20, 60 32 S 96 48, 116 46 L116 52 L4 52 Z"/>
            <path class="vg-line" fill="none" stroke-width="2"
                  d="M4 48 C 26 12, 44 20, 60 32 S 96 48, 116 46"/>
        </svg>`,
    trame: `
        <svg viewBox="0 0 120 56" aria-hidden="true">
            <g class="vg-dots">
                <circle cx="14" cy="14" r="3.4"/><circle cx="32" cy="14" r="3.4"/>
                <circle cx="50" cy="14" r="3.4"/><circle cx="68" cy="14" r="3.4"/>
                <circle cx="86" cy="14" r="3.4"/><circle cx="104" cy="14" r="3.4"/>
                <circle cx="14" cy="28" r="3.4"/><circle cx="32" cy="28" r="3.4"/>
                <circle cx="50" cy="28" r="3.4"/><circle cx="86" cy="28" r="3.4"/>
                <circle cx="104" cy="28" r="3.4"/>
                <circle cx="14" cy="42" r="3.4"/><circle cx="32" cy="42" r="3.4"/>
                <circle cx="50" cy="42" r="3.4"/><circle cx="68" cy="42" r="3.4"/>
                <circle cx="86" cy="42" r="3.4"/><circle cx="104" cy="42" r="3.4"/>
            </g>
            <circle class="vg-spot" cx="68" cy="28" r="6"/>
        </svg>`,
};

const BENEFICES = [
    {
        vignette: VIGNETTES.couverture,
        titre: "Visualisez votre couverture",
        texte: `Projetez votre niveau de maturité sur la matrice MITRE ATT&CK® et identifiez
                immédiatement les techniques couvertes, partielles ou insuffisamment maîtrisées.`,
    },
    {
        vignette: VIGNETTES.part,
        titre: "Objectivez votre maturité",
        texte: `Une note globale et le niveau de chaque tactique ATT&CK®, dans une
                représentation synthétique de votre couverture.`,
    },
    {
        vignette: VIGNETTES.courbe,
        titre: "Pilotez votre posture",
        texte: `Identifiez vos points forts et vos angles morts, puis rejouez l'évaluation
                plus tard pour mesurer le chemin parcouru.`,
    },
    {
        vignette: VIGNETTES.trame,
        titre: "Conservez et partagez",
        texte: `Exportez en JSON chiffré ou en classeur Excel. C'est ce fichier qui garde
                l'évaluation, la fait circuler et permet de la reprendre.`,
    },
];

/* Adresse de contact, écrite une fois. Le pied de page et la pastille de la
   barre haute y mènent tous les deux : elle ne doit exister qu'ici. */
const CONTACT = "contact@maptrix.fr";

/* --------------------------------------------------------------------- FAQ

   Les questions réellement posées avant de commencer, et rien d'autre. Chaque
   réponse est vérifiable dans le code : ce qui est stocké (rien), sur quoi
   repose la note, ce que produit l'export. Une FAQ qui promet plus que l'outil
   ne fait est le plus court chemin vers la défiance. */
const faq = data => [
    {
        q: "Mes réponses partent-elles quelque part ?",
        r: `Non. Il n'y a ni serveur, ni base de données, ni compte : tout se passe dans
            l'onglet, et la page ne fait aucune requête réseau. Fermer l'onglet efface
            l'évaluation. Seul l'export en garde une trace, dans un fichier qui reste chez vous.`,
    },
    {
        q: "Sur quoi repose la note ?",
        r: `Sur les ${data.counts.mitigations} mesures d'atténuation d'ATT&CK Enterprise. Chacune est notée de 0 à 4
            sur une échelle inspirée du CMMI et de l'échelle SSI de l'ANSSI, puis la note
            remonte sur les techniques que la mesure couvre.`,
    },
    {
        q: "Combien de temps faut-il ?",
        r: `Le questionnaire s'adapte : un « Oui » ouvre la question suivante, un « Non » clôt
            la mitigation et fixe sa note. Une organisation qui a peu de mesures en place
            répond donc à beaucoup moins de questions qu'une organisation mûre.`,
    },
    {
        q: "Puis-je m'arrêter et reprendre plus tard ?",
        r: `Oui, par le fichier. L'export produit un JSON (chiffrable par mot de passe, en
            AES-256-GCM) ou un classeur Excel. Réimporté, il reprend à la première question
            sans réponse, ou va droit à la matrice si tout est renseigné.`,
    },
    {
        q: "Quelle version d'ATT&CK est utilisée ?",
        r: `La version embarquée dans le site, affichée en haut de cette page. Elle est
            figée à la publication : deux évaluations faites à des dates différentes
            reposent sur le même référentiel tant que le site n'a pas été republié.`,
    },
    {
        q: "Est-ce que cela remplace un audit ?",
        r: `Non. C'est un auto-diagnostic déclaratif : il vaut ce que valent les réponses
            qu'on lui donne. Il sert à cadrer une discussion, à repérer les angles morts et
            à prioriser, pas à attester d'un niveau de sécurité.`,
    },
];

export function renderHome(app) {
    const { data } = app;

    $("#view-home").innerHTML = `
        <div class="home-page">
            <span class="home-sentinel" aria-hidden="true"></span>
            ${heroSection(data)}
            ${startSection()}
            ${stepsSection(data)}
            ${benefitsSection()}
            ${faqSection(data)}
            ${footerSection()}
        </div>`;

    /* --- ce qui démarre une évaluation, où qu'on clique --- */
    for (const bouton of $$("[data-action='new-layer']")) {
        bouton.onclick = () => promptNewLayer(app);
    }
    $("#home-explore").onclick = () => {
        if (!app.layer) app.setLayer(createLayer({ name: "Exploration", attackVersion: data.version }));
        app.show("matrix");
    };

    /* --- import : bouton, glisser-déposer --- */
    const drop = $("#home-drop");
    const input = $("#home-file");

    drop.onclick = () => input.click();
    // On ne vide le champ qu'une fois l'import terminé : le remettre à zéro
    // pendant les `await` libère le File sélectionné, et sa lecture échoue.
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try { await importFile(app, file); } finally { input.value = ""; }
    };

    for (const type of ["dragenter", "dragover"]) {
        drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add("hover"); });
    }
    for (const type of ["dragleave", "drop"]) {
        drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove("hover"); });
    }
    drop.addEventListener("drop", e => {
        const file = e.dataTransfer?.files?.[0];
        if (file) importFile(app, file);
    });

    /* --- une seule question dépliée à la fois, même grammaire que les modules
       du tableau de bord : ouvrir l'une referme les autres. --- */
    for (const details of $$(".faq-item")) {
        details.addEventListener("toggle", () => {
            if (!details.open) return;
            for (const autre of $$(".faq-item")) {
                if (autre !== details) autre.open = false;
            }
        });
    }

    suivreLePointeur();

    // Le chemin d'attaque se rejoue tant que l'accueil est à l'écran. Un rendu
    // remplace le DOM : la boucle précédente pointerait sur des noeuds détachés
    // et tournerait pour rien jusqu'à la fin de la session.
    arreterVisuels();
    if (!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        arretMatrice = animerMatrice($("#view-home"));
    }
}

/* La boucle du tracé, arrêtée quand on quitte l'accueil : un minuteur qui
   continue de mesurer des cases invisibles est un minuteur qui coûte sans
   rendre. `main.js` l'appelle au changement de vue. */
let arretMatrice = null;

export function arreterVisuels() {
    if (arretMatrice) arretMatrice();
    arretMatrice = null;
}

/* ---------------------------------------------------------------- sections */

/**
 * Le haut de page.
 *
 * Le titre tient en une phrase et ne nomme plus ATT&CK : « Évaluez la maturité
 * cyber de votre organisation » se comprend sans rien connaître, et c'est
 * l'accroche juste en dessous qui dit sur quoi l'outil s'appuie. L'ancien titre
 * portait les deux, faisait trois lignes, et se lisait comme un sous-titre de
 * rapport plutôt que comme une promesse.
 */
function heroSection(data) {
    return `
        <section class="band band-hero" id="accueil">
            <div class="wrap hero">
                <div class="hero-copy">
                    <span class="hero-chip" id="version-badge">
                        <i class="dot" aria-hidden="true"></i>
                        <span id="version-text">ATT&amp;CK Enterprise <b>v${esc(data.version)}</b></span>
                    </span>

                    <h1>Évaluez la <em>maturité cyber</em> de votre organisation</h1>

                    <p class="hero-lead">
                        Un diagnostic structuré autour de MITRE ATT&amp;CK® pour évaluer vos pratiques
                        de sécurité, identifier vos angles morts et prioriser vos actions.
                    </p>

                    <!--
                        La rosace n'apparaît que sur les écrans étroits, où la
                        matrice est retirée : sept colonnes sur 400 px ne se
                        lisent pas, et une matrice qu'on ne lit pas ne prouve
                        rien. La rosace, elle, tient dans un carré et dit la
                        même chose — voici ce que l'outil vous rend.
                    -->
                    <div class="hero-rosace">${rosace(data)}</div>

                    <div class="hero-cta">
                        <button class="btn btn-primary btn-lg" data-action="new-layer">Démarrer l'évaluation</button>
                        <button class="btn btn-quiet btn-lg" id="home-explore">Explorer la matrice</button>
                    </div>

                </div>

                ${heroMatrix(data)}
            </div>
        </section>`;
}

/** Les deux entrées. Traitées à égalité : ce sont deux chemins, pas un choix déjà fait. */
function startSection() {
    return `
        <section class="band band-start" id="demarrer">
            <div class="wrap">
                <header class="band-head" data-reveal>
                    <span class="eyebrow">Démarrer</span>
                    <h2>Deux façons d'entrer</h2>
                    <p>Une évaluation neuve, ou la reprise d'une évaluation déjà commencée.</p>
                </header>

                <div class="home-actions">
                    <div class="action-card spotlight" data-reveal>
                        <span class="glyph">${GLYPH_NEW}</span>
                        <h3>Nouveau layer</h3>
                        <p>
                            Démarrez une évaluation vierge et répondez au questionnaire mitigation par
                            mitigation. La matrice se remplit au fil des réponses.
                        </p>
                        <button class="btn btn-primary" id="home-new" data-action="new-layer">Créer un layer</button>
                    </div>

                    <div class="action-card spotlight" data-reveal>
                        <span class="glyph">${GLYPH_OPEN}</span>
                        <h3>Ouvrir un layer existant</h3>
                        <p>Reprenez une évaluation en important son fichier.</p>
                        <div class="drop-zone" id="home-drop">
                            <b>Choisir un fichier</b> ou le déposer ici<br>
                            un fichier exporté par cet outil, JSON ou Excel
                        </div>
                        <input type="file" id="home-file" class="sr-only" accept=".json,.xlsx,.xls">
                    </div>
                </div>
            </div>
        </section>`;
}

/** Le parcours, en trois temps numérotés. */
function stepsSection(data) {
    const etapes = [
        {
            titre: "Évaluez vos pratiques",
            texte: `Le nombre de questions s'adapte à votre organisation : un « Oui » fait avancer,
                    un « Non » clôt la mitigation et fixe sa note.`,
        },
        {
            titre: "Visualisez votre couverture",
            texte: `Vos résultats sont projetés sur la matrice MITRE ATT&CK®. Chacune des
                    ${data.counts.techniques} techniques est colorée selon votre niveau de maturité, de 0 à 4.`,
        },
        {
            titre: "Exploitez vos résultats",
            texte: `Identifiez vos points forts, vos angles morts, et priorisez vos actions. Exportez
                    l'évaluation pour la conserver ou la reprendre plus tard.`,
        },
    ];

    const items = etapes.map((etape, i) => `
        <li class="step" data-reveal style="--i:${i}">
            <span class="step-num">${String(i + 1).padStart(2, "0")}</span>
            <h3>${etape.titre}</h3>
            <p>${etape.texte}</p>
        </li>`).join("");

    return `
        <section class="band band-steps" id="comment">
            <div class="wrap steps-grid">
                <div class="steps-intro" data-reveal>
                    <span class="eyebrow">Comment ça marche</span>
                    <h2>De l'évaluation à la cartographie</h2>
                    <p>Un parcours en trois étapes pour mesurer votre maturité et visualiser
                       votre couverture défensive.</p>
                </div>
                <ol class="home-steps">${items}</ol>
            </div>
        </section>`;
}

function benefitsSection() {
    const cartes = BENEFICES.map((b, i) => `
        <article class="benefit-card spotlight" data-reveal style="--i:${i}">
            <span class="benefit-visual">${b.vignette}</span>
            <h3>${b.titre}</h3>
            <p>${b.texte}</p>
        </article>`).join("");

    return `
        <section class="band band-benefits" id="benefices">
            <div class="wrap">
                <header class="band-head" data-reveal>
                    <span class="eyebrow">Bénéfices</span>
                    <h2>Ce que <em>MAPTRIX</em> vous apporte</h2>
                    <p>Transformez votre évaluation de maturité en une vision claire de votre
                       couverture défensive et de vos priorités cyber.</p>
                </header>
                <div class="benefits">${cartes}</div>
            </div>
        </section>`;
}

/* `<details>` plutôt qu'un accordéon écrit à la main : l'ouverture, le clavier
   et la restitution vocale sont ceux du navigateur, et la recherche dans la page
   trouve une réponse repliée. */
function faqSection(data) {
    const items = faq(data).map(({ q, r }) => `
        <details class="faq-item">
            <summary>${q}<i class="faq-sign" aria-hidden="true"></i></summary>
            <div class="faq-answer"><p>${r}</p></div>
        </details>`).join("");

    return `
        <section class="band band-faq" id="faq">
            <div class="wrap faq-grid">
                <div class="faq-intro" data-reveal>
                    <span class="eyebrow">FAQ</span>
                    <h2>Questions fréquentes</h2>
                    <p>Ce qu'on demande le plus souvent avant de commencer.</p>
                </div>
                <div class="faq-list">${items}</div>
            </div>
        </section>`;
}

/* Le pied de page reprend les sections de la barre haute : sur une page unique,
   descendre jusqu'en bas ne doit pas être un cul-de-sac. Les liens sortants sont
   les deux seuls qui existent — le référentiel et le dépôt. */
function footerSection() {
    return `
        <footer class="site-footer" id="contact">
            <div class="wrap">
                <div class="footer-cta" data-reveal>
                    <h2>Prêt à cartographier votre couverture ?</h2>
                    <p>Aucun compte, aucune installation : le questionnaire démarre au clic.</p>
                    <div class="footer-cta-actions">
                        <button class="btn btn-primary btn-lg" data-action="new-layer">Démarrer l'évaluation</button>
                    </div>
                </div>

                <div class="footer-cols">
                    <div class="footer-brand">
                        <span class="footer-mark">
                            <svg class="brand-mascot" viewBox="0 0 64 64" aria-hidden="true"><use href="#mascot"/></svg>
                            MAPTRIX
                        </span>
                        <p>Diagnostic de maturité cyber, projeté sur la matrice MITRE ATT&amp;CK®.</p>
                    </div>

                    <nav class="footer-col" aria-label="Produit">
                        <h4>Produit</h4>
                        <a href="#comment">Méthodologie</a>
                        <a href="#demarrer">Démarrer</a>
                        <a href="#faq">FAQ</a>
                    </nav>

                    <nav class="footer-col" aria-label="Ressources">
                        <h4>Ressources</h4>
                        <a href="https://attack.mitre.org/" target="_blank" rel="noopener noreferrer">MITRE ATT&amp;CK®</a>
                        <a href="https://attack.mitre.org/mitigations/enterprise/" target="_blank" rel="noopener noreferrer">Mesures d'atténuation</a>
                        <a href="#benefices">Bénéfices</a>
                    </nav>

                    <nav class="footer-col" aria-label="Société">
                        <h4>Société</h4>
                        <a href="mailto:${esc(CONTACT)}">Contactez-nous</a>
                    </nav>
                </div>

                <p class="home-foot">Données tirées de MITRE ATT&amp;CK</p>
            </div>
        </footer>`;
}

/* ------------------------------------------------------- survol des cartes

   Une carte survolée s'éclaire là où se trouve le pointeur, et non uniformément.
   Le voile est un dégradé radial centré sur deux variables que ce gestionnaire
   met à jour ; tout le reste — l'apparition, l'extinction — est du CSS.

   Le calcul est deux soustractions par mouvement, sur les seules cartes
   survolées : c'est ce que coûte le suivi, et c'est négligeable.

   Rien de tout cela n'est branché sur un écran tactile. Ce n'est pas une
   précaution de performance mais une correction : `pointermove` se déclenche
   aussi sous un doigt qui fait défiler la page, et le halo suivait le pouce sur
   des cartes que le CSS n'allume plus au toucher — un relevé de position à
   chaque image, pour un voile invisible. La condition est la même que celle des
   feuilles de style, `hover: hover`, pour qu'un seul critère décide. */
function suivreLePointeur() {
    if (!window.matchMedia?.("(hover: hover)").matches) return;

    for (const carte of $$(".spotlight")) {
        carte.addEventListener("pointermove", e => {
            const boite = carte.getBoundingClientRect();
            carte.style.setProperty("--mx", `${e.clientX - boite.left}px`);
            carte.style.setProperty("--my", `${e.clientY - boite.top}px`);
        });
    }
}

/* ------------------------------------------------------- création d'un layer */

export function promptNewLayer(app) {
    // Le modèle du layer porte toujours un répondant et une organisation, et
    // l'export les reprend : ils ne sont simplement plus demandés au départ.
    openModal(`
        <div class="modal-head">
            <h3 style="margin:0;font-size:1.02rem;">Nouveau layer</h3>
            <p style="margin:6px 0 0;font-size:0.76rem;color:var(--text-dim);line-height:1.5;">
                Un nom pour retrouver cette évaluation dans ses fichiers.
            </p>
        </div>
        <div class="modal-body">
            <div class="field">
                <label for="nl-name">Nom du layer</label>
                <input type="text" id="nl-name" value="Évaluation ${new Date().getFullYear()}" autocomplete="off">
            </div>
            <div class="form-actions">
                <button class="btn" id="nl-cancel">Annuler</button>
                <button class="btn btn-primary" id="nl-ok">Démarrer le questionnaire</button>
            </div>
        </div>`);

    $("#nl-name").select();
    $("#nl-cancel").onclick = closeModal;
    $("#nl-ok").onclick = () => {
        const layer = createLayer({
            name: $("#nl-name").value,
            attackVersion: app.data.version,
        });
        closeModal();
        app.setLayer(layer);
        app.show("quiz");
    };
}

/* ------------------------------------------------------------------ import */

async function importFile(app, file) {
    try {
        // Un JSON chiffré porte un en-tête reconnaissable : on demande la clé
        // avant de tenter la lecture, plutôt que d'échouer sur un message obscur.
        const layer = (await isEncrypted(file))
            ? await readEncrypted(file)
            : await readLayerFile(file);
        if (!layer) return;                 // demande de clé annulée
        layer.attackVersion ||= app.data.version;
        app.setLayer(layer);

        const state = progress(layer);
        const next = nextTarget(layer);

        if (!next) {
            toast(`« ${layer.name} » importé, questionnaire complet.`);
            app.show("matrix");
            return;
        }

        layer.cursor = next;
        toast(`« ${layer.name} » importé : ${state.completeMitigations}/${state.mitigations} mitigations traitées, reprise en cours.`);
        app.show("quiz");
    } catch (err) {
        // Les messages sont déjà écrits pour être lus tels quels : le détail
        // technique part en console, côté io.js et excel.js.
        toast(`Import impossible : ${err.message}.`, "error");
    }
}

/**
 * Demande la clé de déchiffrement dans une modale, et laisse réessayer sur une
 * clé erronée sans avoir à re-sélectionner le fichier.
 * @returns {Promise<object|null>} null si l'utilisateur renonce
 */
function readEncrypted(file) {
    return new Promise(resolve => {
        const panel = openModal(`
            <div class="modal-head">
                <h3 style="margin:0;font-size:1.02rem;">Fichier chiffré</h3>
                <p style="margin:6px 0 0;font-size:0.76rem;color:var(--text-dim);line-height:1.5;">
                    « ${esc(file.name)} » a été exporté avec une clé. Saisissez-la pour l'ouvrir.
                </p>
            </div>
            <div class="modal-body">
                <div class="field">
                    <label for="dec-pass">Clé de déchiffrement</label>
                    <input type="password" id="dec-pass" autocomplete="off">
                    <span class="help" id="dec-error" style="color:var(--danger);"></span>
                </div>
                <div class="form-actions">
                    <button class="btn" id="dec-cancel">Annuler</button>
                    <button class="btn btn-primary" id="dec-ok">Ouvrir</button>
                </div>
            </div>`);

        const input = panel.querySelector("#dec-pass");
        const error = panel.querySelector("#dec-error");
        input.focus();

        const attempt = async () => {
            error.textContent = "";
            try {
                const layer = await readLayerFile(file, input.value);
                closeModal();
                resolve(layer);
            } catch (err) {
                error.textContent = err.message;
                input.select();
            }
        };

        panel.querySelector("#dec-ok").onclick = attempt;
        input.onkeydown = e => { if (e.key === "Enter") attempt(); };
        panel.querySelector("#dec-cancel").onclick = () => { closeModal(); resolve(null); };
        panel.querySelector(".modal-close").onclick = () => { closeModal(); resolve(null); };
    });
}
