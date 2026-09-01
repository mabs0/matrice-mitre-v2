/* ============================================================================
   Chiffrement des exports.

   Une évaluation de maturité décrit, mitigation par mitigation, ce qui n'est pas
   en place dans un système d'information. C'est un plan de ce qu'il faut
   attaquer. Le fichier voyage par courriel et par clé USB, et c'est le seul
   endroit où l'évaluation existe — rien n'est stocké côté navigateur. Il mérite
   donc un vrai chiffrement, pas une formalité.

   WebCrypto, et rien d'autre. C'est l'implémentation du navigateur, elle ne
   s'installe pas, ne se télécharge pas et ne peut donc pas être remplacée en
   vol : il n'y a plus de bibliothèque de chiffrement chargée depuis un CDN, donc
   plus de chaîne d'approvisionnement à protéger sur le chemin critique.

   Le format, dans l'ordre des octets :

       "MAPTRIX1:"  en-tête, en clair, qui identifie le format
       base64(  sel (16 o) ‖ IV (12 o) ‖ AES-256-GCM(texte) ‖ sceau (16 o)  )

   Les choix, et pourquoi.

   PBKDF2-HMAC-SHA256, 600 000 itérations. Une clé de déchiffrement est une
   phrase choisie par une personne, donc devinable ; tout l'enjeu est de rendre
   chaque essai coûteux pour qui dispose du fichier et essaie un dictionnaire.
   600 000 est la valeur recommandée par l'OWASP pour cette fonction. C'est
   mesuré à ~0,15 s ici, imperceptible pour la personne qui exporte, et cela
   multiplie par 600 000 le coût de chaque essai d'un attaquant.

   Sel de 16 octets, tiré au sort à chaque export. Deux exports de la même
   évaluation avec la même clé ne produisent pas le même fichier, et une table
   pré-calculée ne sert à rien.

   AES-256-GCM plutôt qu'un simple chiffrement. GCM authentifie : il scelle le
   texte, et le déchiffrement échoue si un seul octet du fichier a été modifié.
   Sans cela un fichier retouché en chemin se déchiffrait en silence — on
   n'aurait vu qu'une évaluation aux réponses changées. C'est aussi ce qui rend
   la détection d'une mauvaise clé fiable : ce n'est plus une heuristique sur du
   texte mal décodé, c'est le sceau qui ne correspond pas.

   IV de 12 octets, tiré au sort lui aussi : c'est la taille pour laquelle GCM
   est spécifié, et le tirage évite la réutilisation qui ruinerait le mode.
   ========================================================================= */

/* L'en-tête sert à reconnaître un fichier chiffré avant d'essayer de le lire, et
   à distinguer ce format d'un futur — changer les paramètres voudra dire
   « MAPTRIX2: », et les deux pourront cohabiter. */
export const PREFIXE = "MAPTRIX1:";

const ITERATIONS = 600_000;
const TAILLE_SEL = 16;
const TAILLE_IV = 12;

/**
 * L'implémentation du navigateur, ou une erreur qui dit quoi faire.
 *
 * `crypto.subtle` n'existe que dans un contexte sécurisé : https, ou localhost.
 * Servi en http sur une adresse de réseau local — ce qui arrive quand on montre
 * l'outil depuis son poste — il est simplement absent, et l'export échouerait
 * sur un « undefined » incompréhensible.
 */
function subtle() {
    const api = globalThis.crypto?.subtle;
    if (!api) {
        throw new Error(
            "le chiffrement demande une origine sécurisée. Ouvrez la page en https, "
            + "ou en http://localhost"
        );
    }
    return api;
}

/** Dérive la clé de chiffrement depuis la phrase saisie. */
async function deriver(phrase, sel) {
    const base = await subtle().importKey(
        "raw", new TextEncoder().encode(phrase), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey(
        { name: "PBKDF2", salt: sel, iterations: ITERATIONS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,                              // la clé dérivée n'est jamais extraite
        ["encrypt", "decrypt"],
    );
}

/* base64 sans passer par `String.fromCharCode(...octets)` : l'étalement d'un
   tableau de plusieurs dizaines de milliers d'éléments en arguments dépasse la
   pile d'appels de certains moteurs, et un layer complet y arrive. */
function versBase64(octets) {
    let binaire = "";
    for (let i = 0; i < octets.length; i += 0x8000) {
        binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    }
    return btoa(binaire);
}

function depuisBase64(texte) {
    const binaire = atob(texte);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
}

/**
 * Chiffre un texte avec une phrase de passe.
 * @returns {Promise<string>} l'en-tête suivi du corps en base64
 */
export async function chiffrer(clair, phrase) {
    const sel = crypto.getRandomValues(new Uint8Array(TAILLE_SEL));
    const iv = crypto.getRandomValues(new Uint8Array(TAILLE_IV));
    const cle = await deriver(phrase, sel);

    const scelle = new Uint8Array(await subtle().encrypt(
        { name: "AES-GCM", iv }, cle, new TextEncoder().encode(clair)));

    const corps = new Uint8Array(sel.length + iv.length + scelle.length);
    corps.set(sel, 0);
    corps.set(iv, sel.length);
    corps.set(scelle, sel.length + iv.length);

    return PREFIXE + versBase64(corps);
}

/**
 * Déchiffre un fichier produit par `chiffrer`.
 *
 * Tous les échecs se ramènent au même message. Du point de vue de qui utilise
 * l'outil, une mauvaise clé et un fichier abîmé demandent la même chose —
 * ressaisir la clé, ou retrouver le bon fichier — et distinguer les deux
 * renseignerait un attaquant sur ce qu'il vient d'essayer.
 *
 * @param {string} fichier contenu complet, en-tête compris
 * @returns {Promise<string>} le texte clair
 */
export async function dechiffrer(fichier, phrase) {
    const corps = depuisBase64(fichier.slice(PREFIXE.length).trim());
    if (corps.length <= TAILLE_SEL + TAILLE_IV) throw new Error("clé de déchiffrement incorrecte");

    const sel = corps.subarray(0, TAILLE_SEL);
    const iv = corps.subarray(TAILLE_SEL, TAILLE_SEL + TAILLE_IV);
    const scelle = corps.subarray(TAILLE_SEL + TAILLE_IV);

    try {
        const cle = await deriver(phrase, sel);
        // GCM vérifie le sceau ici : une clé fausse comme un octet modifié
        // lèvent la même exception, et rien n'est rendu.
        const clair = await subtle().decrypt({ name: "AES-GCM", iv }, cle, scelle);
        return new TextDecoder().decode(clair);
    } catch (err) {
        // Sauf l'absence de WebCrypto, qui n'est pas un problème de clé et
        // appelle une tout autre réponse.
        if (/origine sécurisée/.test(err.message)) throw err;
        throw new Error("clé de déchiffrement incorrecte");
    }
}
