/* ============================================================================
   Point d'entrée : chargement des données, coquille, routage entre les vues.
   ========================================================================= */

import { loadAttack } from "./attack.js";
import { initTheme, toggleTheme, current as currentTheme } from "./theme.js";
import { esc, $, toast, initModal, initDropdowns } from "./ui.js";
import { progress } from "./layer.js";
import { renderHome } from "./views/home.js";
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

        // Le badge de version n'appartient qu'à l'accueil. Ailleurs il n'apporte
        // rien et dispute la barre haute à l'onglet du layer, qui porte, lui,
        // l'avancement — l'information qu'on regarde vraiment.
        $("#version-badge")?.classList.toggle("hidden", name !== "home" || !this.data);

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

    const versionText = $("#version-text");
    const versionBadge = $("#version-badge");
    // Sur un écran étroit, seul le numéro reste : « ATT&CK Enterprise » ne
    // porte rien de plus que le contexte, qui est déjà connu.
    if (versionText) {
        versionText.innerHTML =
            `<span class="vb-long">ATT&amp;CK Enterprise </span><b>v${esc(app.data.version)}</b>`;
    }
    if (versionBadge) {
        versionBadge.title =
            `Publiée le ${new Date(app.data.modified).toLocaleDateString("fr-FR")} · relue à chaque chargement`;
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
