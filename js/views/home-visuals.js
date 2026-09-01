/* ============================================================================
   Les deux visuels dessinés à la main du projet.

   `heroMatrix` ouvre la page d'accueil : la matrice ATT&CK, vraie structure du
   référentiel, arrêtée à Credential Access. Elle est vide — c'est l'état d'une
   évaluation qui n'a pas commencé.

   `rosace` sert le tableau de bord de la matrice, sur les niveaux réellement
   atteints. Elle a aussi une forme d'exemple, utilisée quand aucune évaluation
   n'existe encore.

   Rien d'externe, rien de calculé au fil du temps : du SVG et du HTML statiques.
   Les animations de la rosace respectent `prefers-reduced-motion`, géré dans
   home.css.
   ========================================================================= */

import { esc } from "../ui.js";

/**
 * Profil de maturité illustratif, de l'ordre de ce qu'on observe : une majorité
 * de pratiques informelles à définies, quelques points forts, quelques trous.
 * Fixe, pour que l'accueil ne clignote pas d'un rendu à l'autre.
 *
 * Il y a plus de valeurs que de tactiques : le référentiel en a gagné une en
 * v19 et peut en gagner d'autres, la liste est parcourue de façon cyclique.
 */
const DEMO_LEVELS = [3, 4, 2, 3, 3, 1, 2, 2, 1, 4, 2, 2, 3, 2, 0, 2, 3, 1];

/* --------------------------------------------------------------- la rosace */

/* Le viewBox déborde de la boîte du dessin : `marge` est la couronne, à gauche
   et à droite, où s'écrivent les noms de tactiques. Les libellés sont posés à
   l'horizontale, seule façon de les lire d'un coup d'œil, et c'est ce qui coûte
   cette place — un nom couché tiendrait dans moins, mais se déchiffrerait la
   tête penchée. Le banc mesure cette marge plutôt que de la supposer. */
const ROSACE = { size: 320, r0: 30, rMax: 108, marge: 38, ecartLibelle: 14 };

const polar = (cx, cy, r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

/**
 * Découpe un nom de tactique en lignes courtes.
 *
 * Les noms d'ATT&CK vont jusqu'à trois mots, et les écrire d'un seul tenant
 * demanderait une couronne deux fois plus large que le dessin lui-même. Coupés
 * aux espaces, ils tiennent dans la moitié — et jamais à l'intérieur d'un mot,
 * qui deviendrait illisible.
 */
function lignesDuNom(nom, maxi = 15) {
    const lignes = [];
    for (const mot of String(nom).split(/\s+/).filter(Boolean)) {
        const derniere = lignes.at(-1);
        if (derniere && `${derniere} ${mot}`.length <= maxi) lignes[lignes.length - 1] = `${derniere} ${mot}`;
        else lignes.push(mot);
    }
    return lignes.length ? lignes : [""];
}

/**
 * Rosace de maturité, en toile d'araignée : un rayon par tactique, un sommet
 * par niveau atteint, et le polygone qui les relie.
 *
 * Par tactique et non par mitigation : c'est l'axe de lecture d'ATT&CK, celui de
 * la matrice et celui d'une question de direction — « où sommes-nous faibles ? »
 * se répond en phases d'attaque, pas en mesures d'atténuation. Quinze rayons se
 * lisent aussi d'un coup d'œil, là où quarante-trois faisaient une dentelle.
 *
 * C'est la forme d'ensemble qui parle : là où le polygone se creuse, la maturité
 * manque. Chaque rayon est nommé en bout pour qu'on sache *laquelle* se creuse
 * sans avoir à survoler — un geste qui n'existe pas au doigt.
 *
 * @param {object} data référentiel ATT&CK normalisé
 */
export function rosace(data, reels = null) {
    const { size, r0, rMax, marge, ecartLibelle } = ROSACE;
    const c = size / 2;
    const tactiques = data?.tactics ?? [];
    const noms = tactiques.map(t => t.name);
    if (!noms.length) return "";
    const step = 360 / noms.length;

    /** Rayon d'un niveau. Le 0 reste visible, sur le cercle intérieur. */
    const radiusOf = level => r0 + ((rMax - r0) * level) / 4;
    const angleOf = i => -90 + i * step;

    // La toile : un rayon par tactique, et un polygone de repère par palier.
    const spokes = noms.map((_, i) => {
        const [x, y] = polar(c, c, rMax, angleOf(i));
        return `<line class="ros-spoke" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }).join("");

    const webPoints = r => noms
        .map((_, i) => polar(c, c, r, angleOf(i)).map(v => v.toFixed(1)).join(","))
        .join(" ");

    const webs = [1, 2, 3, 4].map(level =>
        `<polygon class="ros-web" points="${webPoints(radiusOf(level))}"/>`).join("");

    // Les graduations sont posées au-dessus du polygone de leur palier, pas
    // dessus : centrées sur le trait, le chiffre et la toile se recouvraient.
    const ticks = [1, 2, 3, 4].map(level =>
        `<text class="ros-tick" x="${c + 4}" y="${(c - radiusOf(level) - 4).toFixed(1)}">${level}</text>`).join("");

    // Le nom de la tactique au bout de son rayon, à l'horizontale.
    //
    // L'ancrage suit le côté : à droite le texte part du rayon vers l'extérieur,
    // à gauche il s'y termine, en haut et en bas il se centre. C'est ce qui le
    // fait toujours s'éloigner du dessin au lieu de le recouvrir. Le bloc de
    // lignes est centré sur le point d'ancrage, sans quoi un nom sur deux lignes
    // pendrait sous son rayon.
    const axes = noms.map((nom, i) => {
        const angle = angleOf(i);
        const [x, y] = polar(c, c, rMax + ecartLibelle, angle);
        const cos = Math.cos((angle * Math.PI) / 180);
        const ancre = cos > 0.25 ? "start" : cos < -0.25 ? "end" : "mid";
        const lignes = lignesDuNom(nom);
        const depart = -((lignes.length - 1) * 4.6);

        const tspans = lignes.map((ligne, n) =>
            `<tspan x="${x.toFixed(1)}" dy="${n === 0 ? depart.toFixed(1) : 9.2}">${esc(ligne)}</tspan>`
        ).join("");

        return `<text class="ros-axis ${ancre}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${tspans}</text>`;
    }).join("");

    // Le tracé de la maturité.
    //
    // Sans niveaux réels — c'est le cas de l'accueil, où aucune évaluation
    // n'existe encore — on montre un profil d'exemple, faute de quoi la page
    // s'ouvrirait sur une rosace plate qui n'apprend rien.
    //
    // Avec des niveaux réels, une tactique non évaluée vaut `null` : son sommet
    // se pose au centre et elle ne compte pas dans la moyenne. La confondre avec
    // un zéro ferait lire « aucune pratique » là où il n'y a qu'une absence de
    // mesure.
    const levels = tactiques.map((t, i) => reels
        ? reels.get(t.shortname) ?? null
        : DEMO_LEVELS[i % DEMO_LEVELS.length]);

    const notes = levels.filter(l => l !== null);
    const sum = notes.reduce((a, b) => a + b, 0);

    const points = levels.map((level, i) => polar(c, c, radiusOf(level ?? 0), angleOf(i)));
    const shape = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

    // Le contour se déroule par `stroke-dasharray` : il faut son périmètre exact,
    // segment de fermeture compris. Une valeur approchée le montrerait déjà
    // partiellement tracé au départ, ou couperait la fin de l'animation.
    const perimeter = points.reduce((total, [x, y], i) => {
        const [px, py] = points[(i + points.length - 1) % points.length];
        return total + Math.hypot(x - px, y - py);
    }, 0);

    // La pastille prend la couleur du palier le plus proche : la rampe n'a que
    // cinq teintes, une note de 2,3 se lit sur celle du 2.
    //
    // Chaque sommet porte le `shortname` de sa tactique : c'est par lui que le
    // tableau de bord retrouve la colonne à surligner dans la matrice. La zone
    // cliquable est un disque transparent bien plus large que la pastille — 2,6
    // px de rayon ne s'attrapent ni à la souris ni au doigt.
    const vertices = levels.map((level, i) => {
        const [x, y] = polar(c, c, radiusOf(level ?? 0), angleOf(i));
        const classes = level === null ? "ros-dot vide" : `ros-dot l${Math.round(level)}`;
        const mot = level === null ? "non évaluée" : `niveau ${level.toFixed(1).replace(".", ",")}`;
        const cle = tactiques[i]?.shortname ?? "";
        const cible = cle
            ? `<circle class="ros-hit" data-tactic="${esc(cle)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/>`
            : "";
        return `<g class="ros-vertex">
                    <circle class="${classes}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"
                            style="--i:${i}"/>
                    ${cible}
                    <title>${esc(noms[i])} : ${mot}</title>
                </g>`;
    }).join("");

    // La moyenne ne porte que sur ce qui a été évalué : la diluer avec les
    // tactiques non mesurées ferait baisser la note à mesure qu'on découvre
    // l'étendue du référentiel, ce qui n'a aucun sens.
    const average = notes.length
        ? (sum / notes.length).toFixed(1).replace(".", ",")
        : "-";

    const label = reels
        ? `Rosace de maturité : niveau atteint sur les ${noms.length} tactiques d'ATT&CK Enterprise`
        : `Rosace d'exemple : niveau de maturité sur les ${noms.length} tactiques d'ATT&CK Enterprise`;

    // Le viewBox est plus large que le dessin, de `marge` de chaque côté : c'est
    // la couronne où s'écrivent les noms. Il déborde aussi un peu en hauteur, un
    // libellé sur deux lignes dépassant en haut et en bas du cercle.
    const vb = `${-marge} -8 ${size + marge * 2} ${size + 16}`;

    return `
        <figure class="rosace-figure">
            <svg class="rosace" viewBox="${vb}" role="img" aria-label="${esc(label)}">
                <g class="ros-web-group">${spokes}${webs}</g>
                <polygon class="ros-shape" points="${shape}" style="--tour:${perimeter.toFixed(0)}"/>
                <g class="ros-dots">${vertices}</g>
                <g class="ros-axes">${axes}</g>
                ${ticks}
                <!-- Le moyeu suit la note qu'il porte : à 30 px, « 1,9 » débordait
                     du disque de rayon r0 − 6. -->
                <circle class="ros-hub" cx="${c}" cy="${c}" r="${r0 - 1}"/>
                <text class="ros-value" x="${c}" y="${c + 3}">${average}</text>
                <text class="ros-unit" x="${c}" y="${c + 17}">/ 4</text>
            </svg>
        </figure>`;
}

/* --------------------------------------------------- exporter la rosace

   La rosace tire toutes ses couleurs de la feuille de style : détachée du
   document, elle sortirait en noir sur noir. On recopie donc, sur chaque
   élément du dessin, la valeur effectivement calculée par le navigateur — ce
   qui fige au passage le thème en cours, clair ou sombre, tel qu'il est à
   l'écran.

   Les animations sont neutralisées de la même façon : le tracé se dessine par
   `stroke-dashoffset` et les sommets apparaissent en fondu, si bien qu'une copie
   prise avant la fin montrerait un dessin à moitié fait. */

/** Propriétés qui portent l'apparence du dessin, et elles seules. */
const STYLES_EXPORTES = [
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-linejoin",
    "stroke-linecap", "opacity", "font-family", "font-size", "font-weight",
    "letter-spacing", "text-anchor", "dominant-baseline",
];

/**
 * Copie autonome de la rosace, prête à être écrite dans un fichier.
 * @param {SVGElement} svg la rosace telle qu'affichée
 * @returns {string} un document SVG complet
 */
export function rosaceAutonome(svg) {
    const clone = svg.cloneNode(true);

    const source = [svg, ...svg.querySelectorAll("*")];
    const copie = [clone, ...clone.querySelectorAll("*")];

    source.forEach((element, i) => {
        const calcule = getComputedStyle(element);
        // Une propriété que le navigateur ne sait pas résoudre rend une chaîne
        // vide : l'écrire donnerait « fill:; », que rien ne relit.
        const regles = STYLES_EXPORTES
            .map(prop => [prop, calcule.getPropertyValue(prop)])
            .filter(([, valeur]) => valeur)
            .map(([prop, valeur]) => `${prop}:${valeur}`)
            .join(";");
        if (regles) copie[i].setAttribute("style", regles);
        // Le contour est un tiret qui se déroule : sans ça, une copie prise
        // pendant l'animation sort tronquée.
        copie[i].removeAttribute("stroke-dasharray");
        copie[i].removeAttribute("stroke-dashoffset");
    });

    // Le fond de la page ne fait pas partie du SVG : sans lui, le fichier est
    // transparent et le dessin disparaît sur un fond de la même teinte. Un fond
    // transparent est justement ce que rendent `transparent` et `rgba(…, 0)` —
    // on retombe alors sur du blanc, sur lequel les deux thèmes se lisent.
    const peinture = getComputedStyle(document.body).backgroundColor;
    const fond = !peinture || /transparent|,\s*0\s*\)$/.test(peinture) ? "#ffffff" : peinture;

    const [x, y, w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("fill", fond);
    clone.insertBefore(rect, clone.firstChild);

    // Pas de `setAttribute("xmlns", …)` : l'élément est déjà dans l'espace de
    // noms SVG, le sérialiseur l'écrit de lui-même, et le poser à la main
    // produisait un attribut en double — donc un XML que rien n'ouvre.
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);

    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/* ----------------------------------------------- la matrice du haut de page

   La moitié droite de l'accueil montre la matrice elle-même, arrêtée net à la
   colonne Credential Access.

   Elle remplace le fond défilant qui occupait toute la page. Ce fond avait un
   défaut de fond : pour ne pas gêner la lecture il fallait le diluer à 17 %
   d'opacité et le creuser d'un masque, c'est-à-dire le rendre méconnaissable
   pour qu'il devienne supportable. Une matrice montrée franchement, à côté du
   titre plutôt que derrière, dit la même chose sans rien coûter à la lecture.

   Sept colonnes seulement : au-delà, les cases deviennent trop étroites pour que
   le nom d'une technique s'y lise, et une matrice illisible ne prouve rien. La
   coupe est franche et assumée, le dégradé qui la termine dit qu'il y a une
   suite sans faire croire qu'on la voit. */
const HERO = {
    premiere: "initial-access",
    derniere: "credential-access",
    /* Assez de cases pour qu'on voie une colonne, pas assez pour qu'on la lise
       en entier : le bas est estompé de toute façon. */
    lignes: 15,
    /* Part de cases laissées sans niveau. Une matrice entièrement colorée n'a
       jamais existé : il reste toujours des techniques qu'aucune mesure ne
       couvre, et c'est justement ce que l'outil sert à voir. */
    partVides: 0.22,
};

/**
 * Générateur déterministe.
 *
 * Les couleurs doivent être les mêmes d'un rendu à l'autre : tirées au hasard à
 * chaque affichage, la matrice changerait de visage à chaque retour sur
 * l'accueil, et une page qui ne se ressemble pas d'une visite à l'autre ne se
 * mémorise pas. La graine est fixe, la suite est reproductible.
 */
function suite(graine) {
    let n = graine;
    return () => {
        n = (n * 1103515245 + 12345) & 0x7fffffff;
        return n / 0x7fffffff;
    };
}

/**
 * La tranche de matrice affichée en haut de l'accueil.
 *
 * Structure réelle du référentiel : les tactiques dans leur ordre, et sous
 * chacune ses vraies techniques. Rien n'est inventé, et c'est ce qui la rend
 * reconnaissable au premier coup d'oeil par qui connaît ATT&CK. Seules les
 * couleurs sont un exemple : elles montrent ce que l'outil produit à quelqu'un
 * qui n'a encore rien évalué.
 *
 * Hors de l'arbre d'accessibilité : une lecture vocale y débiterait cent noms de
 * techniques sans qu'aucun n'apprenne quoi que ce soit. Ce que la matrice dit,
 * le titre et l'accroche le disent déjà en trois lignes.
 *
 * @param {object} data référentiel ATT&CK normalisé
 */
export function heroMatrix(data) {
    const tactics = data?.tactics ?? [];
    if (!tactics.length) return "";

    const debut = tactics.findIndex(t => t.shortname === HERO.premiere);
    const fin = tactics.findIndex(t => t.shortname === HERO.derniere);
    // Un référentiel qui renommerait ces deux tactiques ne doit pas faire
    // disparaître le visuel : on retombe alors sur les premières colonnes.
    const tranche = debut !== -1 && fin !== -1 && fin >= debut
        ? tactics.slice(debut, fin + 1)
        : tactics.slice(0, 7);

    const dé = suite(20260901);

    // Le rang de la colonne pilote son retard à l'arrivée : les colonnes se
    // posent de gauche à droite, dans l'ordre où se lit une matrice ATT&CK. Le
    // CSS fait le calcul, le markup ne porte que le rang.
    const colonnes = tranche.map((tactic, rang) => {
        const techniques = (data.byTactic?.get(tactic.shortname) ?? []).slice(0, HERO.lignes);
        const cases = techniques.map(tech => {
            const niveau = dé() < HERO.partVides ? "vide" : `l${Math.floor(dé() * 5)}`;
            return `<span class="hm-cell ${niveau}">${esc(tech.name)}</span>`;
        }).join("");
        return `<div class="hm-col" style="--col:${rang}">
                    <span class="hm-head">${esc(tactic.name)}</span>
                    ${cases}
                </div>`;
    }).join("");

    // Le tracé vit dans son propre calque, au-dessus des cases et sans les
    // toucher : le markup de la matrice ne sait rien de l'animation, et une
    // matrice sans JavaScript reste une matrice.
    return `
        <div class="hero-matrix" aria-hidden="true">
            <div class="hm-grid">
                ${colonnes}
                <svg class="hm-trace" preserveAspectRatio="none" focusable="false">
                    <path class="hm-path" fill="none"/>
                </svg>
            </div>
        </div>`;
}

/* ------------------------------------------------- le tracé d'un enchaînement

   Toutes les 2,7 s, un chemin d'attaque se dessine sur la matrice : une case par
   tactique, de gauche à droite, bordure allumée et trait tiré de l'une à
   l'autre.

   Ce que ça raconte, et pourquoi ça vaut une animation. Une matrice ATT&CK n'est
   pas une grille de scores, c'est une chronologie : un attaquant entre par une
   colonne de gauche et progresse vers la droite, une technique à la fois. Une
   image fixe ne dit pas ce sens de lecture ; le trait, lui, le dit sans une
   ligne de texte. C'est aussi la maquette de ce que fera la recherche par CVE,
   où le chemin ne sera plus tiré au sort mais lu dans la vulnérabilité.

   Un chemin par tactique traversée, jamais deux cases dans la même colonne :
   c'est ainsi que se lit la matrice, et un trait qui reviendrait en arrière
   raconterait quelque chose de faux.
*/

const TRACE = {
    intervalle: 2700,    // temps entre deux chemins
    dessin: 950,         // durée du trait qui se tire
    effacement: 420,
    minEtapes: 4,
};

/**
 * Met la matrice de l'accueil en mouvement.
 *
 * @param {HTMLElement} racine l'élément qui contient `.hero-matrix`
 * @returns {() => void} la fonction qui arrête tout et rend le DOM à son état de repos
 */
export function animerMatrice(racine) {
    const grille = racine?.querySelector(".hm-grid");
    const trace = grille?.querySelector(".hm-path");
    if (!grille || !trace) return () => {};

    const colonnes = [...grille.querySelectorAll(".hm-col")]
        .map(col => [...col.querySelectorAll(".hm-cell")])
        .filter(cases => cases.length > 0);
    if (colonnes.length < TRACE.minEtapes) return () => {};

    let allumees = [];
    let minuteur = null;
    let animation = null;

    const eteindre = () => {
        for (const c of allumees) c.classList.remove("on-path");
        allumees = [];
    };

    /**
     * Une case au hasard dans chaque colonne d'une suite continue partant de la
     * première.
     *
     * Continue, et non piochée dans toute la largeur : une intrusion ne saute
     * pas une phase, elle les enchaîne. Et partant de la première parce qu'elle
     * commence toujours par un accès initial.
     *
     * Quatre à six colonnes, jamais les sept. Les dernières sortent de l'écran —
     * la matrice déborde volontairement à droite — et un trait qui file vers un
     * point qu'on ne voit pas se lit comme un défaut d'affichage, pas comme une
     * suite. C'était le cas au premier essai.
     */
    const chemin = () => {
        const maxi = Math.min(6, colonnes.length);
        const combien = TRACE.minEtapes
            + Math.floor(Math.random() * (maxi - TRACE.minEtapes + 1));
        return colonnes.slice(0, combien)
            .map(cases => cases[Math.floor(Math.random() * cases.length)]);
    };

    const jouer = () => {
        eteindre();
        if (animation) animation.cancel();

        const cadre = grille.getBoundingClientRect();
        if (!cadre.width || !cadre.height) return;   // page masquée : rien à dessiner

        allumees = chemin();
        const points = allumees.map(cellule => {
            const boite = cellule.getBoundingClientRect();
            return [
                (boite.left + boite.width / 2 - cadre.left).toFixed(1),
                (boite.top + boite.height / 2 - cadre.top).toFixed(1),
            ];
        });

        // Le viewBox suit la taille réelle de la grille : les coordonnées sont
        // en pixels, et le calque ne se déforme pas quand la fenêtre change.
        trace.parentNode.setAttribute("viewBox", `0 0 ${cadre.width.toFixed(0)} ${cadre.height.toFixed(0)}`);
        trace.setAttribute("d", points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "));

        for (const c of allumees) c.classList.add("on-path");

        const longueur = trace.getTotalLength();
        trace.style.strokeDasharray = String(longueur);
        animation = trace.animate(
            [{ strokeDashoffset: longueur, opacity: 1 },
             { strokeDashoffset: 0, opacity: 1, offset: 0.55 },
             { strokeDashoffset: 0, opacity: 1, offset: 0.82 },
             { strokeDashoffset: 0, opacity: 0 }],
            { duration: TRACE.dessin + TRACE.effacement + 600, easing: "ease-out", fill: "forwards" },
        );

        // Les bordures s'éteignent avec le trait, pas au chemin suivant. Sans
        // cela, les cases restaient allumées pendant la seconde de silence entre
        // deux chemins, et désignaient un parcours dont le trait avait disparu.
        // La garde évite qu'une animation annulée éteigne celle qui l'a
        // remplacée.
        const celle = animation;
        animation.finished
            .then(() => { if (animation === celle) eteindre(); })
            .catch(() => { /* annulée : le chemin suivant s'en charge */ });
    };

    // Un premier chemin tout de suite, sinon la matrice reste inerte le temps
    // d'un intervalle et l'animation passe pour un défaut d'affichage.
    jouer();
    minuteur = setInterval(jouer, TRACE.intervalle);

    return () => {
        clearInterval(minuteur);
        if (animation) animation.cancel();
        eteindre();
        trace.removeAttribute("d");
    };
}
