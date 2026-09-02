/* ============================================================================
   Le questionnaire.

   Parcours progressif : on passe à la question suivante si la réponse est
   « Oui », un « Non » clôt la mitigation. « N/A » ne bloque pas — la question
   sort du périmètre du répondant sans interrompre la progression.

   Deux notions à ne pas confondre, et c'est tout le fichier.

   Où l'on regarde : `cursor.index`, libre. On circule d'une question à l'autre
   par « Précédent » et « Suivant », en avant comme en arrière, y compris sur des
   questions hors d'atteinte. Lire la suite ne coûte rien et renseigne : on voit
   où mène la mitigation avant de s'y engager.

   Où l'on peut répondre : `frontiere()`, contrainte. Le parcours étant
   progressif, la question 4 n'a de sens que si la 1 a été tranchée — y répondre
   d'abord fabriquerait un niveau que rien ne soutient. Les questions au-delà de
   la frontière s'affichent donc, mais leurs boutons sont fermés.

   La frontière sert aussi à savoir où reprendre : ouvrir une mitigation déjà
   entamée y amène directement, plutôt que de refaire défiler des questions déjà
   répondues.
   ========================================================================= */

import { esc, $, toast, openModal, closeModal } from "../ui.js";
import { QUESTIONNAIRES, LEVEL_LABELS, getQuestionnaire } from "../catalog.js";
import { resolvedEntries, sharedText, sharedWith, answeredElsewhere } from "../shared-questions.js";
import { needsTool } from "../tool-questions.js";
import { mitigationLevel } from "../scoring.js";
import { setAnswer, progress, questionnaireState, nextTarget, reviewTarget, acquiredMitigations } from "../layer.js";

const GLYPH_ASK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="ico">
    <path d="M3.5 6.5h17v11h-17z" stroke="currentColor" stroke-width="1.5"/>
    <path d="m3.5 7 8.5 6 8.5-6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

/**
 * Position courante dans le questionnaire.
 *
 * `stoppedBy` retient la question commune dont le « Non », donné ailleurs, a
 * clos le parcours : sans elle le résultat s'afficherait sans qu'on comprenne
 * pourquoi il est tombé si tôt.
 */
const cursor = { mitigation: null, index: 0, showResult: false, stoppedBy: null };

/**
 * Mitigations mises en attente d'une réponse extérieure.
 *
 * Faire suivre une question, c'est reconnaître qu'on ne peut pas y répondre
 * maintenant : la mitigation est laissée telle quelle — aucune réponse n'est
 * inventée — et le parcours passe à la suivante plutôt que de buter dessus.
 *
 * Le suspens ne dure que la session : rien n'étant répondu, un layer exporté
 * puis rouvert reprendra naturellement à cette question, ce qui est le
 * comportement juste — la question est toujours sans réponse.
 */
const enAttente = new Set();

/** Repart de zéro : appelé quand on charge ou crée un autre layer. */
export function resetQuiz() {
    cursor.mitigation = null;
    cursor.index = 0;
    cursor.showResult = false;
    cursor.stoppedBy = null;
    enAttente.clear();
}

export function renderQuiz(app, { mitigation } = {}) {
    if (!QUESTIONNAIRES.size) {
        $("#view-quiz").innerHTML = `<div class="quiz-inner"><p class="matrix-empty">
            Aucun questionnaire n'est encore intégré.</p></div>`;
        return;
    }

    if (mitigation && QUESTIONNAIRES.has(mitigation)) {
        // Arrivée depuis « Modifier ma réponse ». On ouvre la mitigation là où
        // elle attend quelque chose — le « Non » qui l'a close, ou la première
        // question sans réponse — et non à sa première question. Rouvrir une
        // mitigation entamée obligeait sinon à recliquer « Suivant » sur chaque
        // réponse déjà donnée avant d'atteindre celle qu'on venait changer.
        goTo(mitigation, frontiere(app.layer, mitigation));
        paint(app);
        return;
    }

    // Première passe : la prochaine mitigation à traiter, jamais ouverte en
    // priorité. Une fois tout traité, on repart du début du catalogue pour une
    // passe de relecture, en ne s'arrêtant que sur les « Non ».
    const target = prochaineCible(app.layer) || reviewTarget(app.layer);

    if (target) {
        goTo(target.mitigation, indexOfQuestion(target.mitigation, target.question));
    } else {
        // Tout est traité et rien ne mérite relecture.
        paintNothingToReview(app);
        return;
    }

    paint(app);
}

function goTo(mitigationId, index, showResult = false) {
    cursor.mitigation = mitigationId;
    cursor.index = Math.max(0, index);
    cursor.showResult = showResult;
    cursor.stoppedBy = null;
}

/* ------------------------------------------- questions déjà tranchées ailleurs

   Une question commune n'est posée qu'une fois. Quand on la retrouve dans une
   autre mitigation, elle est franchie sans être affichée :

     - « Oui » ou « N/A » : on enchaîne sur la suivante, le parcours continue ;
     - « Non » : le parcours s'arrête, exactement comme si le répondant venait de
       le donner ici. La règle du questionnaire progressif ne change pas selon
       l'endroit où la réponse a été saisie — mais l'arrêt serait incompréhensible
       sans explication, alors le résultat dit d'où il vient.
*/

/**
 * Amène le curseur sur la première question qui reste à poser.
 * @returns {boolean} vrai s'il y a une question à afficher, faux si c'est fini
 */
function settleForward(app) {
    const questions = getQuestionnaire(cursor.mitigation).questions;

    while (cursor.index < questions.length) {
        const question = questions[cursor.index];
        const ailleurs = answeredElsewhere(app.layer, cursor.mitigation, question.num);
        if (!ailleurs) return true;

        if (ailleurs.value === "Non") {
            cursor.stoppedBy = { num: question.num, others: sharedWith(cursor.mitigation, question.num) };
            cursor.showResult = true;
            return false;
        }
        cursor.index++;
    }

    cursor.showResult = true;
    return false;
}

/**
 * Recule d'une question posable, ou reste sur place s'il n'y en a pas avant.
 * En marche arrière un « Non » emprunté est franchi comme les autres : on
 * revient sur ses pas, ce n'est pas le moment de clore le parcours.
 */
function stepBack(app) {
    const questions = getQuestionnaire(cursor.mitigation).questions;
    for (let i = cursor.index - 1; i >= 0; i--) {
        if (!answeredElsewhere(app.layer, cursor.mitigation, questions[i].num)) {
            cursor.index = i;
            return true;
        }
    }
    return false;
}

/**
 * La question la plus profonde à laquelle on ait le droit de répondre.
 *
 * C'est le même point sous deux angles : celui où le questionnaire attend une
 * action, donc celui où l'on reprend, et celui au-delà duquel on ne peut plus
 * répondre. Une seule fonction pour les deux, sans quoi « où reprendre » et
 * « jusqu'où répondre » finiraient par diverger d'un cas de bord.
 *
 * La règle suit le parcours progressif, et rien d'autre :
 *
 *   - la première question sans réponse est la frontière : c'est là que le
 *     questionnaire s'est arrêté, et on y répond ;
 *   - un « Non » est la frontière : il clôt la mitigation, donc rien de ce qui
 *     suit n'est atteignable. Il reste modifiable, sinon on ne pourrait jamais
 *     rouvrir un parcours qu'on a fermé ;
 *   - tout répondu sans « Non » : la dernière question fait office de frontière.
 *     Il n'y a plus rien à ouvrir, et la borne doit rester atteignable pour
 *     qu'on puisse revenir sur la dernière réponse.
 *
 * Les questions communes comptent comme répondues : `resolvedEntries` rend la
 * réponse du groupe, qu'elle ait été donnée ici ou ailleurs. Une frontière qui
 * les ignorerait rouvrirait un parcours que le groupe a déjà tranché.
 */
function frontiere(layer, mitigationId) {
    const questions = getQuestionnaire(mitigationId).questions;
    const entries = resolvedEntries(layer, mitigationId);

    for (const [i, q] of questions.entries()) {
        const value = entries[q.num]?.value;
        if (!value || value === "Non") return i;
    }
    return Math.max(0, questions.length - 1);
}

/** Nombre de questions franchies parce que déjà tranchées ailleurs. */
function skippedCount(app, questionnaire) {
    return questionnaire.questions
        .filter(q => answeredElsewhere(app.layer, questionnaire.id, q.num)).length;
}

function indexOfQuestion(mitigationId, num) {
    const questions = getQuestionnaire(mitigationId).questions;
    const i = questions.findIndex(q => q.num === num);
    return i < 0 ? 0 : i;
}

/**
 * Tout est traité et aucune mitigation n'est bloquée sur un « Non » : il n'y a
 * rien à relire ici. On oriente vers la matrice, seul endroit d'où l'on peut
 * revenir sur un « Oui », en passant par la technique concernée.
 */
function paintNothingToReview(app) {
    const acquired = acquiredMitigations(app.layer);

    $("#view-quiz").innerHTML = `
        <div class="quiz-inner">
            <div class="quiz-result">
                <div class="result-badge" style="background:var(--lvl4);color:var(--lvl4-ink);">✓</div>
                <h2 class="quiz-title">Rien à revoir</h2>
                <p class="result-text">
                    Les ${acquired.length} mitigation${acquired.length > 1 ? "s" : ""} du questionnaire
                    ${acquired.length > 1 ? "sont terminées" : "est terminée"} sans aucun « Non » :
                    il n'y a pas de point de blocage à reprendre.
                </p>
                <p class="result-text" style="font-size:0.78rem;color:var(--text-mute);">
                    Pour revenir sur une réponse « Oui », ouvrez la technique concernée dans la
                    matrice et utilisez « Modifier ma réponse ».
                </p>
                <div class="result-actions">
                    <button class="btn btn-primary" id="r-matrix">Voir la matrice</button>
                </div>
            </div>
        </div>`;

    $("#r-matrix").onclick = () => app.show("matrix");
}

/* -------------------------------------------------------------------- rendu */

function paint(app) {
    const { layer } = app;
    const questionnaire = getQuestionnaire(cursor.mitigation);
    const entries = resolvedEntries(layer, cursor.mitigation);
    const level = mitigationLevel(questionnaire, entries, layer.scoring, layer);

    // Le curseur est recalé à chaque rendu, quel que soit le chemin qui y mène :
    // c'est ce qui garantit qu'une question tranchée ailleurs n'apparaît jamais,
    // y compris en revenant sur ses réponses ou en arrivant depuis la matrice.
    if (!cursor.showResult) settleForward(app);
    if (cursor.showResult) { paintResult(app, questionnaire, level ?? 0); return; }

    const total = questionnaire.questions.length;
    const question = questionnaire.questions[cursor.index];
    const entry = entries[question.num];
    const answered = entry?.value ?? null;
    const pct = Math.round((cursor.index / total) * 100);

    /* --- ce qu'on peut faire ici ---

       Circuler et répondre sont deux droits distincts. On circule partout dans
       la mitigation ; on ne répond que jusqu'à la frontière. Au-delà, la
       question s'affiche en entier — le texte, le palier visé, la place dans la
       barre — mais les trois boutons sont fermés. */
    const limite = frontiere(layer, cursor.mitigation);
    const verrouillee = cursor.index > limite;
    const attendue = questionnaire.questions[limite];

    // Une borne n'a de sens que s'il reste une question posable au-delà : toutes
    // celles qui l'entourent peuvent avoir été franchies parce que communes.
    const peutReculer = questionnaire.questions
        .slice(0, cursor.index)
        .some(q => !answeredElsewhere(layer, cursor.mitigation, q.num));
    const posableApres = questionnaire.questions
        .slice(cursor.index + 1)
        .some(q => !answeredElsewhere(layer, cursor.mitigation, q.num));
    /* « Suivant » ne dépend plus d'avoir répondu : c'est ce qui permet de lire la
       suite. Sur la dernière question il ne subsiste que si le parcours est clos,
       auquel cas il mène au résultat — sinon il conduirait à un écran de note sur
       une mitigation à peine commencée. */
    const peutAvancer = posableApres || questionnaireState(questionnaire, entries).complete;

    const texte = sharedText(questionnaire.id, question.num) ?? question.text;
    const avecOutil = needsTool(questionnaire.id, question);

    $("#view-quiz").innerHTML = `
        <div class="quiz-inner">
            <div class="quiz-topbar">
                <div class="quiz-tag">${esc(questionnaire.id)}</div>
                <h2 class="quiz-title">${esc(questionnaire.name)}</h2>
                <p class="quiz-desc">${esc(questionnaire.description)}</p>
            </div>

            <div class="level-track">${levelTrack(level ?? 0, question.level)}</div>

            <div class="quiz-progress">
                <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${pct}%"></div></div>
            </div>

            <!-- Le rang de la question n'est plus écrit à l'écran : deux
                 échelles chiffrées au-dessus de la barre disaient ce qu'elle
                 montre déjà. Il reste porté ici, pour le banc d'essai et pour
                 qui inspecte la page. -->
            <div class="quiz-card ${verrouillee ? "locked" : ""}"
                 data-question="${cursor.index + 1}" data-total="${total}">
                <p class="quiz-question">${esc(texte)}</p>

                <div class="quiz-answers">
                    <button class="quiz-answer yes ${answered === "Oui" ? "selected" : ""}" data-answer="Oui" ${verrouillee ? "disabled" : ""}>Oui</button>
                    <button class="quiz-answer no ${answered === "Non" ? "selected" : ""}" data-answer="Non" ${verrouillee ? "disabled" : ""}>Non</button>
                    <button class="quiz-answer na ${answered === "N/A" ? "selected" : ""}" data-answer="N/A" ${verrouillee ? "disabled" : ""}>N/A</button>
                </div>

                ${verrouillee ? `
                    <p class="quiz-locked">
                        <span class="quiz-locked-icon" aria-hidden="true">↑</span>
                        <span>
                            Le questionnaire est progressif : cette question ne s'ouvrira qu'une fois
                            la question ${attendue.num} tranchée. Vous pouvez la lire dès maintenant,
                            pas encore y répondre.
                            <button class="btn btn-sm" id="q-resume">Reprendre à la question ${attendue.num}</button>
                        </span>
                    </p>` : ""}

                ${avecOutil && !verrouillee ? `
                    <div class="quiz-tool">
                        <label for="q-tool">Outil en place, si applicable</label>
                        <input type="text" id="q-tool" value="${esc(entry?.tool || "")}"
                               placeholder="ex : Entra ID, Duo, PingID…" autocomplete="off">
                    </div>` : ""}

                ${verrouillee ? "" : `
                    <button class="btn btn-ghost btn-sm quiz-ask" id="q-ask">
                        ${GLYPH_ASK} Faire suivre cette question
                    </button>`}
            </div>

            <div class="quiz-nav">
                ${peutReculer ? `<button class="btn btn-ghost" id="q-back">← Précédent</button>` : ""}
                <span class="grow"></span>
                ${peutAvancer ? `<button class="btn btn-sm" id="q-next">Suivant →</button>` : ""}
                <button class="btn btn-sm" id="q-matrix">Voir la matrice</button>
            </div>
        </div>`;

    for (const button of document.querySelectorAll("[data-answer]")) {
        button.onclick = () => answer(app, button.dataset.answer);
    }
    // On enregistre l'outil dès la frappe : sinon quitter la question par un
    // clic sur « Oui » perdrait la saisie en cours.
    const tool = $("#q-tool");
    if (tool) tool.oninput = e => {
        setAnswer(app.layer, cursor.mitigation, question.num, { tool: e.target.value.trim() });
    };
    const back = $("#q-back");                 // absent sur la première question posable
    if (back) back.onclick = () => { if (stepBack(app)) paint(app); };
    const next = $("#q-next");                 // absent au bout d'un parcours encore ouvert
    if (next) next.onclick = () => advance(app);
    // Le raccourci du verrou : plutôt que de laisser recliquer « Précédent »
    // autant de fois qu'on a avancé pour lire.
    const resume = $("#q-resume");
    if (resume) resume.onclick = () => { cursor.index = limite; paint(app); };
    // Faire suivre une question, c'est mettre la mitigation en attente sur son
    // point de blocage : cela n'a de sens que sur la question qui bloque.
    const ask = $("#q-ask");
    if (ask) ask.onclick = () => askSomeone(app, questionnaire, question, texte);
    $("#q-matrix").onclick = () => app.show("matrix");
}

/* ------------------------------------------------- faire suivre une question

   Personne ne connaît les quarante-trois sujets. Plutôt que de laisser deviner
   ou répondre à peu près, on prépare le message à envoyer à qui saura : le
   contexte de la mitigation, la question mot pour mot, et ce que valent les
   trois réponses.

   Rien n'est envoyé d'ici — le site ne parle à aucun service. On copie, ou on
   ouvre son propre client de messagerie. */

/* Le destinataire ne connaît pas forcément ATT&CK, ni même la démarche. Deux
   lignes suffisent à le situer : sans elles, le message arrive comme un
   questionnaire de plus, venu d'on ne sait où et pour on ne sait quoi. */
function askTemplate(questionnaire, question, texte) {
    return [
        `Bonjour,`,
        ``,
        `Nous dressons l'état des lieux de la sécurité de l'organisation. Nous nous appuyons`,
        `sur MITRE ATT&CK, un référentiel public qui recense les techniques réellement`,
        `employées lors d'attaques, et les mesures qui permettent de s'en protéger. Pour`,
        `chacune de ces mesures, quelques questions situent où nous en sommes.`,
        ``,
        `Une de ces questions relève de ton périmètre. Elle porte sur la mesure`,
        `« ${questionnaire.name} » (${questionnaire.id}), qui vise à : ${premierePhrase(questionnaire.description)}`,
        ``,
        `La question :`,
        `  ${texte}`,
        ``,
        `Réponses possibles :`,
        `  • Oui : la pratique est en place ;`,
        `  • Non : elle ne l'est pas, ou pas encore ;`,
        `  • N/A : elle ne s'applique pas à notre contexte.`,
        ``,
        `Un mot de contexte ou le nom de l'outil concerné nous serait utile.`,
        `Il n'y a pas de bonne réponse attendue : l'objectif est de savoir où nous en sommes.`,
        ``,
        `Merci d'avance,`,
    ].join("\n");
}

/** La description d'une mitigation fait un paragraphe : sa première phrase suffit. */
function premierePhrase(texte) {
    const phrase = String(texte ?? "").split(/(?<=\.)\s+/)[0] ?? "";
    return phrase.charAt(0).toLowerCase() + phrase.slice(1);
}

function askSomeone(app, questionnaire, question, texte) {
    const corps = askTemplate(questionnaire, question, texte);
    // L'objet doit se comprendre seul, dans une boîte de réception : « Maturité
    // cyber — M1013 question 1 » ne dit ni de quoi il s'agit, ni ce qu'on
    // attend, ni combien de temps ça prend.
    const sujet = `Une question sur « ${questionnaire.name} », état des lieux sécurité`;

    const panel = openModal(`
        <div class="modal-head">
            <h3 style="margin:0;font-size:1.02rem;">Faire suivre cette question</h3>
            <p style="margin:6px 0 0;font-size:0.76rem;color:var(--text-dim);line-height:1.5;">
                Rien ne part d'ici : le message est à copier, ou à ouvrir dans votre messagerie.
                La mitigation restera en attente et le questionnaire passera à la suivante.
            </p>
        </div>
        <div class="modal-body">
            <div class="field">
                <label for="ask-subject">Objet</label>
                <input type="text" id="ask-subject" value="${esc(sujet)}" autocomplete="off">
            </div>
            <div class="field">
                <label for="ask-body">Message</label>
                <textarea id="ask-body" rows="16" spellcheck="false">${esc(corps)}</textarea>
            </div>
            <div class="form-actions">
                <button class="btn" id="ask-copy">Copier</button>
                <a class="btn btn-primary" id="ask-mail"
                   href="mailto:?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}">
                   Ouvrir dans ma messagerie</a>
            </div>
        </div>`);

    // L'objet reste modifiable : le lien `mailto:` se refait à la volée plutôt
    // que de partir avec la valeur d'origine.
    const lien = panel.querySelector("#ask-mail");
    const majLien = () => {
        lien.href = `mailto:?subject=${encodeURIComponent(panel.querySelector("#ask-subject").value)}`
            + `&body=${encodeURIComponent(panel.querySelector("#ask-body").value)}`;
    };
    panel.querySelector("#ask-subject").oninput = majLien;
    panel.querySelector("#ask-body").oninput = majLien;

    panel.querySelector("#ask-copy").onclick = async () => {
        const message = `${panel.querySelector("#ask-subject").value}\n\n`
            + panel.querySelector("#ask-body").value;
        try {
            await navigator.clipboard.writeText(message);
            metEnAttente(app, questionnaire);
        } catch {
            // Le presse-papiers est refusé hors contexte sécurisé, et sur
            // certains postes d'entreprise. La sélection laisse alors la main —
            // et on ne passe pas à la suite, puisque rien n'est parti.
            panel.querySelector("#ask-body").select();
            toast("Copie refusée par le navigateur : le texte est sélectionné.", "error");
        }
    };
    lien.onclick = () => metEnAttente(app, questionnaire);
    panel.querySelector(".modal-close").onclick = () => closeModal();
}

/**
 * Met la mitigation en attente et passe à la suivante.
 *
 * Aucune réponse n'est inventée : la mitigation reste exactement où elle en
 * était. Elle est seulement écartée du parcours le temps de la session, pour ne
 * pas y buter à chaque fois qu'on revient à la question suivante à traiter.
 */
function metEnAttente(app, questionnaire) {
    closeModal();
    enAttente.add(questionnaire.id);

    const target = prochaineCible(app.layer);
    if (!target) {
        toast(`${questionnaire.id} en attente, plus rien d'autre à traiter pour le moment.`);
        app.show("matrix");
        return;
    }
    goTo(target.mitigation, indexOfQuestion(target.mitigation, target.question));
    paint(app);
    toast(`${questionnaire.id} laissée en attente · au suivant : ${target.mitigation}`);
}

/** La prochaine mitigation à traiter, en sautant celles mises en attente. */
function prochaineCible(layer) {
    const cible = nextTarget(layer);
    if (!cible || !enAttente.has(cible.mitigation)) return cible;

    // `nextTarget` rendrait indéfiniment la première mitigation incomplète, y
    // compris celle qu'on vient d'écarter : on parcourt le catalogue nous-mêmes.
    for (const [id, questionnaire] of QUESTIONNAIRES) {
        if (enAttente.has(id)) continue;
        const state = questionnaireState(questionnaire, resolvedEntries(layer, id));
        if (!state.complete) return { mitigation: id, question: state.nextNum };
    }
    return null;
}

/**
 * Frise des cinq niveaux : les paliers acquis sont pleins, et le palier visé
 * par la question affichée est cerclé — c'est ce repère qui suit la navigation.
 */
function levelTrack(attained, currentLevel = null) {
    const reached = Math.round(attained);
    return LEVEL_LABELS.map((label, i) => {
        const classes = ["level-dot", `lvl${i}`];
        if (i <= reached) classes.push("on");
        if (i === currentLevel) classes.push("current");
        else if (currentLevel === null && i === reached) classes.push("current");
        return `<div class="${classes.join(" ")}" title="${esc(label)}">${i}</div>`;
    }).join("");
}

/* ------------------------------------------------------------------ réponses */

function answer(app, value) {
    const questionnaire = getQuestionnaire(cursor.mitigation);
    const question = questionnaire.questions[cursor.index];

    // Les boutons sont déjà fermés au-delà de la frontière ; la règle est
    // redite ici parce que c'est le seul endroit qui écrit dans le layer, et
    // qu'une note fabriquée par une réponse hors d'atteinte ne se verrait pas.
    if (cursor.index > frontiere(app.layer, cursor.mitigation)) return;

    const wasAnswered = resolvedEntries(app.layer, cursor.mitigation)[question.num]?.value ?? null;
    const dropped = setAnswer(app.layer, cursor.mitigation, question.num, {
        value,
        tool: $("#q-tool")?.value.trim() ?? "",
    });
    app.onLayerChange();

    // Modifier une réponse commune se répercute ailleurs : on le dit, sinon la
    // note d'une autre mitigation bougerait sans explication.
    const others = sharedWith(cursor.mitigation, question.num);
    if (others.length && wasAnswered && wasAnswered !== value) {
        toast(`Réponse commune modifiée : ${others.join(", ")} ${others.length > 1 ? "sont" : "est"} aussi concernée${others.length > 1 ? "s" : ""}.`);
    }

    // Un « Non » clôt la mitigation : c'est la règle du parcours progressif.
    if (value === "Non") {
        cursor.stoppedBy = null;               // l'arrêt vient d'ici, pas d'ailleurs
        if (dropped) {
            toast(`${dropped} réponse${dropped > 1 ? "s" : ""} suivante${dropped > 1 ? "s" : ""} effacée${dropped > 1 ? "s" : ""} : le parcours s'arrête ici.`);
        }
        cursor.showResult = true;
        paint(app);
        return;
    }

    advance(app);
}

function advance(app) {
    cursor.index++;                 // `paint` recale le curseur et clôt si c'est fini
    paint(app);
}

/* ------------------------------------------------------------------ résultat */

/**
 * Actions de fin de mitigation.
 *
 * Sur un parcours de 43 mitigations, l'action dominante est d'enchaîner : elle
 * est seule à être mise en avant, et annonce ce qui vient pour que le répondant
 * sache où il va. Revoir ses réponses et aller à la matrice restent des
 * échappatoires, discrètes. Quand il n'y a plus rien à enchaîner, c'est la
 * matrice qui devient l'action principale.
 */
function resultActions(app, global, target, revisitable) {
    // Rien à revoir quand toutes les questions ont été tranchées ailleurs : le
    // bouton ne ramènerait qu'ici, sur ce même écran.
    const secondary = revisitable
        ? `<button class="btn btn-ghost btn-sm" id="r-review">Revoir mes réponses</button>`
        : "";

    if (!target) {
        return `<div class="result-actions">
            <div class="result-secondary">${secondary}</div>
            <button class="btn btn-primary btn-lg" id="r-matrix">
                <span class="rn-label">Voir la matrice</span>
                <span class="rn-target">Tout est traité</span>
            </button>
        </div>`;
    }

    const next = getQuestionnaire(target.mitigation);
    const label = global.complete ? "Point de blocage suivant" : "Mitigation suivante";

    return `<div class="result-actions">
        <div class="result-secondary">
            ${secondary}
            <button class="btn btn-ghost btn-sm" id="r-matrix">Voir la matrice</button>
        </div>
        <button class="btn btn-primary btn-lg" id="r-next">
            <span class="rn-label">${label} →</span>
            <span class="rn-target">${esc(target.mitigation)} · ${esc(next.name)}</span>
        </button>
    </div>`;
}

/**
 * Explique un parcours clos par une question qu'on n'a pas vue passer.
 *
 * Sans ce mot, le questionnaire s'arrêterait sans raison apparente — parfois
 * dès la première question — sur une réponse donnée dans une autre mitigation.
 */
function stopNotice(questionnaire) {
    if (!cursor.stoppedBy) return "";

    const { num, others } = cursor.stoppedBy;
    const question = questionnaire.questions.find(q => q.num === num);
    const texte = sharedText(questionnaire.id, num) ?? question?.text ?? "";
    const liste = others.map(id => `<b>${esc(id)}</b>`).join(" et ");

    return `<p class="quiz-shared" style="text-align:left;">
        <span class="quiz-shared-icon" aria-hidden="true">⇄</span>
        Le parcours s'arrête à la question ${num}, commune avec ${liste} : elle y a déjà
        été répondue « Non », et un « Non » clôt la mitigation. Elle n'a pas été reposée
        ici, la réponse valant pour toutes.
        <span style="display:block;margin-top:6px;color:var(--text-mute);">« ${esc(texte)} »</span>
    </p>`;
}

function paintResult(app, questionnaire, level) {
    const rounded = Math.round(level);
    const global = progress(app.layer);
    const entries = resolvedEntries(app.layer, questionnaire.id);
    const state = questionnaireState(questionnaire, entries);
    // En première passe, la prochaine mitigation à traiter. Une fois tout
    // traité, le prochain point de blocage à relire, en repartant après
    // celle-ci pour ne pas la reproposer.
    const target = prochaineCible(app.layer) || reviewTarget(app.layer, questionnaire.id);

    // Les outils cités pendant le questionnaire, rendus visibles ici : c'est le
    // premier endroit où le répondant les retrouve après les avoir saisis.
    const tools = questionnaire.questions
        .map(q => ({ num: q.num, tool: entries[q.num]?.tool }))
        .filter(x => x.tool);

    // Le décompte des questions non reposées : sans lui, « 8 questions
    // répondues » après en avoir vu cinq à l'écran ressemble à une erreur.
    const skipped = skippedCount(app, questionnaire);

    $("#view-quiz").innerHTML = `
        <div class="quiz-inner">
            <div class="quiz-result level-${rounded}">
                <div class="quiz-tag">${esc(questionnaire.id)}</div>
                <div class="result-badge">${level % 1 === 0 ? level : level.toFixed(1)}</div>
                <div class="result-level-name">Niveau ${rounded} · ${esc(LEVEL_LABELS[rounded])}</div>
                <h2 class="quiz-title" style="margin-top:10px;">${esc(questionnaire.name)}</h2>
                <p class="result-text">${esc(questionnaire.bareme[rounded])}</p>

                <div class="level-track">${levelTrack(level)}</div>

                ${stopNotice(questionnaire)}

                <p class="result-text" style="font-size:0.78rem;color:var(--text-mute);">
                    ${state.answered} question${state.answered > 1 ? "s" : ""} répondue${state.answered > 1 ? "s" : ""}
                    sur ${questionnaire.questions.length}${state.complete && state.answered < questionnaire.questions.length && !cursor.stoppedBy
                        ? ", le parcours s'est arrêté sur un « Non »" : ""}
                    ${skipped ? `· ${skipped} déjà répondue${skipped > 1 ? "s" : ""} depuis une autre mitigation` : ""}
                    · ${global.completeMitigations}/${global.mitigations} mitigation${global.mitigations > 1 ? "s" : ""} traitée${global.completeMitigations > 1 ? "s" : ""}
                </p>

                ${tools.length ? `
                    <div class="tool-recap">
                        <h4>Outils cités</h4>
                        <ul>${tools.map(t =>
                            `<li><span class="t-q">Q${t.num}</span> ${esc(t.tool)}</li>`).join("")}</ul>
                    </div>` : ""}

                ${resultActions(app, global, target, skipped < questionnaire.questions.length)}
            </div>
        </div>`;

    const review = $("#r-review");
    if (review) review.onclick = () => {
        cursor.showResult = false;
        cursor.index = 0;
        cursor.stoppedBy = null;
        paint(app);
    };
    $("#r-matrix").onclick = () => app.show("matrix");

    const nextButton = $("#r-next");
    if (nextButton) nextButton.onclick = () => {
        // Toutes les cinq mitigations, on marque un temps d'arrêt avant
        // d'enchaîner. Sur quarante-trois, le parcours devient une chaîne qu'on
        // déroule sans plus regarder ce qu'elle produit ; la pause redonne la
        // main et rappelle qu'une matrice se remplit derrière.
        if (global.completeMitigations > 0 && global.completeMitigations % 5 === 0) {
            paintPause(app, global, target);
            return;
        }
        goToTarget(app, target);
    };
}

/** Ouvre la mitigation suivante à traiter. */
function goToTarget(app, target) {
    goTo(target.mitigation, indexOfQuestion(target.mitigation, target.question));
    paint(app);
    toast(`Mitigation ${target.mitigation}`);
}

/**
 * La pause, dans l'esprit du « vous regardez toujours ? ».
 *
 * Deux propositions, pas une de plus : reprendre, ou aller voir la matrice.
 * Toute option supplémentaire ferait de cet écran une décision à prendre, alors
 * qu'il est là pour souffler.
 */
function paintPause(app, global, target) {
    $("#view-quiz").innerHTML = `
        <div class="quiz-inner">
            <div class="quiz-pause">
                <svg class="pause-mascot" viewBox="0 0 64 64" aria-hidden="true"><use href="#mascot"/></svg>
                <h2 class="quiz-title">Toujours là ?</h2>
                <p class="result-text">
                    ${global.completeMitigations} mitigations sur ${global.mitigations} sont traitées.
                    La matrice s'est colorée d'autant. C'est le moment d'aller voir, ou de continuer
                    sur votre lancée.
                </p>
                <div class="pause-actions">
                    <button class="btn btn-lg" id="p-matrix">Voir la matrice</button>
                    <button class="btn btn-primary btn-lg" id="p-continue">Continuer →</button>
                </div>
            </div>
        </div>`;

    $("#p-matrix").onclick = () => app.show("matrix");
    $("#p-continue").onclick = () => goToTarget(app, target);
}
