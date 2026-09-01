/* ============================================================================
   Point d'entrée : chargement des données, coquille, routage entre les vues.
   ========================================================================= */

import { loadAttack } from "./attack.js";
import { initTheme, toggleTheme, current as currentTheme } from "./theme.js";
import { esc, $, toast, initModal, initDropdowns } from "./ui.js";
import { progress } from "./layer.js";
import { renderHome, promptNewLayer } from "./views/home.js";
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
            if (name !== "home") topbar.classList.remove("scrolled");
        }

        // Questionnaire et Exporter sont montés par la vue matrice, qui seule
        // sait les câbler. Ailleurs, ils désigneraient l'écran qu'on regarde.
        if (name !== "matrix") $("#topbar-actions")?.classList.add("hidden");

        if (name === "home") renderHome(this);
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
                title="Renommer le layer — ${state.completeMitigations} mitigation(s) traitée(s) sur ${state.mitigations}, ${state.answered} question(s) répondue(s)">
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
   part ailleurs, ils y font descendre. Trois choses à câbler, une seule fois
   pour toute la session — la barre, elle, ne se recompose jamais.

   Le défilement est détourné pour deux raisons. La page ne défile pas dans la
   fenêtre mais dans `#view-home`, et un `href` seul y laisse le navigateur
   choisir quel conteneur bouger — il choisit juste, mais pas partout. Et
   l'adresse ne gagne pas un `#faq` qui, au rechargement suivant, ferait sauter
   la page avant même que son contenu existe.

   Le même écouteur de défilement sert deux fins : densifier le verre de la barre
   dès qu'on a quitté le haut de page, et marquer l'ancre de la section qu'on
   regarde. Deux écouteurs pour deux marques auraient fait le même travail deux
   fois. */

/** Ligne de visée : une section est « celle qu'on regarde » dès qu'elle passe
    sous la barre haute, avec sa marge d'ancrage. */
const VISEE = 96;

function initSiteNav() {
    const nav = $("#site-nav");
    const home = $("#view-home");
    const topbar = $("#topbar");
    if (!nav || !home || !topbar) return;

    const liens = [...nav.querySelectorAll(".nav-link")];

    for (const lien of liens) {
        lien.addEventListener("click", e => {
            const cible = home.querySelector(lien.getAttribute("href"));
            if (!cible) return;             // section absente : le lien reprend son sens normal
            e.preventDefault();
            cible.scrollIntoView({ block: "start" });
        });
    }

    // La pastille d'action lance l'évaluation, là où l'ancre « Démarrer » ne fait
    // que descendre à la section. Les faire aboutir au même endroit aurait rendu
    // l'une des deux inutile.
    const cta = $("#nav-cta");
    if (cta) cta.onclick = () => promptNewLayer(app);

    const marquerSection = () => {
        let courante = null;
        for (const lien of liens) {
            const cible = home.querySelector(lien.getAttribute("href"));
            if (cible && cible.getBoundingClientRect().top <= VISEE) courante = lien;
        }
        for (const lien of liens) lien.classList.toggle("current", lien === courante);
    };

    home.addEventListener("scroll", () => {
        topbar.classList.toggle("scrolled", home.scrollTop > 12);
        marquerSection();
    }, { passive: true });
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
