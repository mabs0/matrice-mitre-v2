/* ============================================================================
   Point d'entrée : chargement des données, coquille, routage entre les vues.
   ========================================================================= */

import { loadAttack } from "./attack.js";
import { initTheme, toggleTheme, current as currentTheme } from "./theme.js";
import { esc, $, toast, initModal, initDropdowns } from "./ui.js";
import { progress } from "./layer.js";
import { renderHome, promptNewLayer, arreterVisuels } from "./views/home.js";
import { renderMatrix, repaintMatrix, resetMatrixView } from "./views/matrix.js";
import { renderQuiz, resetQuiz } from "./views/quiz.js";

const app = {
    data: null,
    layer: null,

    /** Installe un layer neuf ou importé : l'état de parcours des vues repart de zéro. */
    setLayer(layer) {
        this.layer = layer;
        resetQuiz();
        resetMatrixView();
        this.onLayerChange();
    },

    onLayerChange() {
        renderTabs();
        repaintMatrix(this);
    },

    /** Affiche une vue. `matrix` et `quiz` exigent un layer. */
    show(name, options = {}) {
        if (name !== "home" && !this.layer) { this.show("home"); return; }

        for (const view of ["home", "matrix", "quiz"]) {
            $(`#view-${view}`).classList.toggle("hidden", view !== name);
        }

        // La barre haute change de métier avec la vue : pastille flottante et
        // ancres de section sur l'accueil, barre d'outil ailleurs. C'est le seul
        // endroit qui en décide — le CSS fait le reste depuis `data-mode`.
        const topbar = $("#topbar");
        if (topbar) {
            topbar.dataset.mode = name === "home" ? "home" : "app";
            if (name !== "home") {
                topbar.classList.remove("scrolled");
                // Le menu étroit resterait déplié par-dessus l'outil.
                $("#site-nav")?.classList.remove("open");
                $("#nav-toggle")?.setAttribute("aria-expanded", "false");
            }
        }

        // Questionnaire et Exporter sont montés par la vue matrice, qui seule
        // sait les câbler. Ailleurs, ils désigneraient l'écran qu'on regarde.
        if (name !== "matrix") $("#topbar-actions")?.classList.add("hidden");

        if (name === "home") { renderHome(this); spySections(); }
        else arreterVisuels();
        if (name === "matrix") renderMatrix(this);
        if (name === "quiz") renderQuiz(this, options);

        this.view = name;
        renderTabs();
    },
};

/* ------------------------------------------------------------- onglet layer */

function renderTabs() {
    const host = $("#layer-tabs");
    if (!host) return;

    if (!app.layer) { host.innerHTML = ""; return; }

    const state = progress(app.layer);
    host.innerHTML = `
        <button class="layer-tab current" id="tab-layer"
                title="Renommer le layer. ${state.completeMitigations} mitigation(s) traitée(s) sur ${state.mitigations}, ${state.answered} question(s) répondue(s)">
            <span class="name">${esc(app.layer.name)}</span>
            <span class="pct">${state.completeMitigations}/${state.mitigations}</span>
        </button>
        <button class="btn btn-ghost btn-icon" id="tab-close" title="Fermer le layer et revenir à l'accueil">×</button>`;

    $("#tab-layer").onclick = () => {
        const name = window.prompt("Nom du layer", app.layer.name);
        if (name?.trim()) { app.layer.name = name.trim(); renderTabs(); }
    };
    $("#tab-close").onclick = () => leaveLayer(app);
}

/**
 * Quitte le layer courant et revient à l'accueil.
 * Rien n'étant stocké, on confirme dès qu'il y a des réponses à perdre.
 * @returns {boolean} vrai si on a effectivement quitté
 */
function leaveLayer(app) {
    if (!app.layer) { app.show("home"); return true; }

    const state = progress(app.layer);
    if (state.answered > 0) {
        const message =
            `Quitter « ${app.layer.name} » et revenir à l'accueil ?\n\n` +
            `${state.answered} réponse${state.answered > 1 ? "s" : ""} ` +
            `(${state.completeMitigations}/${state.mitigations} mitigation${state.mitigations > 1 ? "s" : ""} traitée${state.completeMitigations > 1 ? "s" : ""}) ` +
            `seront perdues, ainsi que la matrice.\n\n` +
            `Rien n'est enregistré par le navigateur : seul un export permet de reprendre plus tard.`;
        if (!window.confirm(message)) return false;
    }

    app.layer = null;
    resetQuiz();
    resetMatrixView();
    app.show("home");
    return true;
}

/* --------------------------------------------------------- ancres de section

   L'accueil est une page unique : les liens de la barre haute n'y mènent nulle
   part ailleurs, ils y font descendre.

   Le défilement des ancres est détourné pour deux raisons. La page ne défile pas
   dans la fenêtre mais dans `#view-home`, et un `href` seul y laisse le
   navigateur choisir quel conteneur bouger. Et l'adresse ne gagne pas un `#faq`
   qui, au rechargement suivant, ferait sauter la page avant même que son contenu
   existe.

   Deux marques suivent le défilement : le verre de la barre se densifie dès
   qu'on a quitté le haut de page, et l'ancre de la section regardée s'allume.
   Aucune des deux ne passe par un écouteur `scroll`. Un tel écouteur se
   déclenche à chaque image, et celui-ci devait mesurer quatre sections à chaque
   fois : quatre `getBoundingClientRect` par tick, donc quatre recalculs de mise
   en page forcés pendant le geste le plus sensible de la page. Un
   `IntersectionObserver` fait le même travail hors du fil principal et ne
   rappelle que lorsqu'un seuil est franchi.

   Les sections sont recomposées à chaque rendu de l'accueil : l'observateur est
   donc rebranché après le rendu, pas une fois pour toutes. */

/** Marge haute de la ligne de visée : la barre flottante et son ancrage. */
const VISEE = 96;

/** Observateurs en cours, à couper avant d'en poser de nouveaux. */
let espions = [];

function initSiteNav() {
    const nav = $("#site-nav");
    const home = $("#view-home");
    if (!nav || !home) return;

    for (const lien of nav.querySelectorAll('a[href^="#"]')) {
        lien.addEventListener("click", e => {
            const cible = home.querySelector(lien.getAttribute("href"));
            if (!cible) return;             // section absente : le lien reprend son sens normal
            e.preventDefault();
            cible.scrollIntoView({ block: "start" });
        });
    }

    // La barre portait deux fois « Démarrer » : l'ancre et la pastille noire, à
    // deux gestes de distance l'une de l'autre. Deux boutons pour une seule
    // destination, c'est un bouton de trop. La pastille sert donc à ce qu'elle
    // seule peut faire, et descend au pied de page, où l'on nous joint.
    const cta = $("#nav-cta");
    if (cta) cta.onclick = () => home.querySelector("#contact")?.scrollIntoView({ block: "start" });

    initMenuEtroit(nav);
}

/**
 * Le menu des écrans étroits.
 *
 * Le panneau n'existe que dans le CSS, sous 900 px : ici on ne fait que poser
 * l'état. `aria-expanded` sur le bouton et la classe sur la liste disent la même
 * chose à deux publics, et rien d'autre n'a besoin de le savoir.
 *
 * Un menu qui ne se referme que par son propre bouton est un menu dans lequel on
 * se retrouve coincé : il se referme aussi au choix d'une ancre, à Échap, et au
 * clic à côté. Le clic extérieur est écouté sur le document en phase de
 * remontée, donc après que le bouton a traité le sien.
 */
function initMenuEtroit(nav) {
    const bouton = $("#nav-toggle");
    if (!bouton) return;

    const fermer = () => {
        nav.classList.remove("open");
        bouton.setAttribute("aria-expanded", "false");
    };

    bouton.onclick = () => {
        const ouvert = nav.classList.toggle("open");
        bouton.setAttribute("aria-expanded", String(ouvert));
    };

    for (const lien of nav.querySelectorAll('a[href^="#"]')) lien.addEventListener("click", fermer);

    document.addEventListener("keydown", e => {
        if (e.key !== "Escape" || !nav.classList.contains("open")) return;
        fermer();
        bouton.focus();          // le clavier ne doit pas se retrouver nulle part
    });

    document.addEventListener("click", e => {
        if (!nav.classList.contains("open")) return;
        if (nav.contains(e.target) || bouton.contains(e.target)) return;
        fermer();
    });
}

/**
 * Rebranche les deux observateurs sur les sections fraîchement rendues.
 *
 * Appelé après chaque rendu de l'accueil. Sans `IntersectionObserver` — jsdom,
 * et les navigateurs d'avant 2019 — la barre reste dans son état de repos et les
 * ancres continuent de fonctionner : c'est une finition, pas une fonction.
 */
function spySections() {
    for (const espion of espions) espion.disconnect();
    espions = [];

    const home = $("#view-home");
    const topbar = $("#topbar");
    const nav = $("#site-nav");
    if (!home || !topbar || !nav || typeof IntersectionObserver !== "function") return;

    // Le verre. Une sentinelle d'un pixel en haut de la page : tant qu'elle est
    // visible, on est au repos ; dès qu'elle sort, la barre passe devant du
    // contenu et doit gagner en opacité.
    const sentinelle = home.querySelector(".home-sentinel");
    if (sentinelle) {
        const veille = new IntersectionObserver(
            ([entree]) => topbar.classList.toggle("scrolled", !entree.isIntersecting),
            { root: home },
        );
        veille.observe(sentinelle);
        espions.push(veille);
    }

    // L'ancre courante. La marge basse de -55 % rétrécit la fenêtre d'observation
    // à la bande haute de l'écran : sans elle, trois sections sont « visibles »
    // en même temps et la marque saute d'un lien à l'autre au moindre geste.
    const liens = [...nav.querySelectorAll(".nav-link")];
    const cibles = liens
        .map(lien => ({ lien, section: home.querySelector(lien.getAttribute("href")) }))
        .filter(paire => paire.section);
    if (!cibles.length) return;

    const vues = new Set();
    const guetteur = new IntersectionObserver(entrees => {
        for (const entree of entrees) {
            if (entree.isIntersecting) vues.add(entree.target);
            else vues.delete(entree.target);
        }
        // La plus haute des sections visibles, dans l'ordre du document.
        const courante = cibles.find(paire => vues.has(paire.section));
        for (const { lien } of cibles) lien.classList.toggle("current", lien === courante?.lien);
    }, { root: home, rootMargin: `-${VISEE}px 0px -55% 0px` });

    for (const { section } of cibles) guetteur.observe(section);
    espions.push(guetteur);

}

/* ----------------------------------------------------------------- démarrage */

async function boot() {
    initTheme();
    initModal();
    initDropdowns();

    const themeToggle = $("#theme-toggle");
    if (themeToggle) {
        themeToggle.onclick = () => { themeToggle.textContent = toggleTheme() === "dark" ? "☀" : "☾"; };
        themeToggle.textContent = currentTheme() === "dark" ? "☀" : "☾";
    }
    const brand = $("#brand");
    if (brand) brand.onclick = () => leaveLayer(app);

    initSiteNav();

    // Vu par le diagnostic de démarrage d'index.html : les modules se chargent.
    window.__ctrmBooted = true;

    /**
     * Rend compte de l'avancement. Chaque élément est optionnel : un défaut
     * d'affichage ne doit jamais faire échouer le chargement des données, ni se
     * faire passer pour une panne réseau.
     */
    const report = (msg, ratio) => {
        const status = $("#boot-status");
        if (status) status.textContent = msg;

        const bar = $("#boot-bar");
        const pct = $("#boot-pct");

        // Sans ratio, on ne sait pas où l'on en est : la barre reprend son
        // va-et-vient. Elle gardait sinon l'état « déterminée » pris au premier
        // rapport et restait figée à 0 % pendant tout le transfert — un
        // téléchargement qui avance derrière une jauge morte se lit comme un
        // blocage. C'est ce qui se voit derrière un proxy d'entreprise, qui
        // relaie le flux sans annoncer sa taille.
        if (ratio === undefined) {
            bar?.classList.remove("determinate");
            if (bar?.firstElementChild) bar.firstElementChild.style.width = "";
            if (pct) pct.textContent = "";
            return;
        }

        const percent = Math.round(ratio * 100);
        if (bar) {
            bar.classList.add("determinate");
            if (bar.firstElementChild) bar.firstElementChild.style.width = `${percent}%`;
        }
        if (pct) pct.textContent = `${percent} %`;
    };

    try {
        app.data = await loadAttack(report);
    } catch (err) {
        // La distinction « erreur réseau / erreur applicative » n'a plus lieu
        // d'être : le référentiel est embarqué, le démarrage ne fait plus aucune
        // requête. Ce qui reste, c'est un module qui ne se charge pas — et le
        // cas de loin le plus fréquent est le mélange de versions en cache.
        $("#boot").innerHTML = `
            <h1>Chargement impossible</h1>
            <p class="err">${esc(err.message)}</p>
            <p class="fix">Le plus souvent, c'est un <code>index.html</code> encore en cache
               avec des scripts déjà rechargés : forcez le rechargement avec
               <b>Ctrl+Maj+R</b>. Si le message persiste, envoyez-le tel quel.</p>
            <button class="btn btn-primary" id="boot-retry">Réessayer</button>`;
        // Câblé ici plutôt qu'en attribut `onclick` : un gestionnaire écrit dans
        // le markup est du script en ligne, que la politique de sécurité du
        // document refuse — et à juste titre, c'est la forme qu'emprunte une
        // injection.
        $("#boot-retry")?.addEventListener("click", () => location.reload());
        console.error(err);
        return;
    }

    // Prévient une fermeture accidentelle : rien n'est stocké côté navigateur.
    window.addEventListener("beforeunload", e => {
        if (app.layer && progress(app.layer).answered > 0) e.preventDefault();
    });

    $("#boot")?.remove();
    app.show("home");
}

boot().catch(err => {
    console.error(err);
    toast(`Erreur inattendue : ${err.message}`, "error");
});
