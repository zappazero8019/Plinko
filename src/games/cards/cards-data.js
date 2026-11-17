/**
 * cards-data.js — Dados visuais e composições do Card Match
 *
 * ⚠️  IMPLEMENTAÇÃO INDEPENDENTE.
 * O repositório de referência (NavarroEmilioLuis/SMB3-Cards-Minigame) NÃO
 * possui licença declarada. Portanto este módulo NÃO copia sprites, áudios,
 * código-fonte nem artefatos visuais daquele projeto.
 *
 * Foram reproduzidos apenas DADOS FUNCIONAIS de jogo: as 8 disposições
 * originais (sequência de 6 tipos de carta) e o multiset 4/4/4/2/2/2.
 * Isso é necessário para fidelidade de disposição, conforme solicitado, e
 * não inclui nenhum material protegido (imagens, sons, textos ou código).
 * Os símbolos exibidos são próprios (emoji/CSS do sistema).
 */

/** Símbolos do modo SMB3 (equivalentes funcionais dos 6 tipos originais). */
export const SIMBOLOS_CLASSICOS = [
  { id: 'shroom', nome: 'Cogumelo', glyph: '🍄', cor: '#d82800' },
  { id: 'flower', nome: 'Flor', glyph: '🌸', cor: '#3cbcfc' },
  { id: 'star', nome: 'Estrela', glyph: '⭐', cor: '#fc9838' },
  { id: 'coins10', nome: '10 moedas', glyph: '🪙', cor: '#fcbcb0' },
  { id: 'coins20', nome: '20 moedas', glyph: '💰', cor: '#c84c0c' },
  { id: 'oneup', nome: '1-Up', glyph: '🍀', cor: '#4cdc48' }
];

/** Símbolos adicionais exclusivos do modo expandido (assets originais). */
export const SIMBOLOS_EXTRA_EXPANDIDO = [
  { id: 'fire', nome: 'Fogo', glyph: '🔥', cor: '#ff7849' },
  { id: 'bell', nome: 'Sino', glyph: '🔔', cor: '#ffd970' },
  { id: 'leaf', nome: 'Folha', glyph: '🍃', cor: '#a3e635' },
  { id: 'crown', nome: 'Coroa', glyph: '👑', cor: '#fbbf24' },
  { id: 'gem', nome: 'Gema', glyph: '💎', cor: '#67e8f9' },
  { id: 'rocket', nome: 'Foguete', glyph: '🚀', cor: '#a78bfa' }
];

/** Pool completo do modo expandido (12 tipos base). */
export const SIMBOLOS_EXPANDIDOS = [
  ...SIMBOLOS_CLASSICOS,
  ...SIMBOLOS_EXTRA_EXPANDIDO
];

/**
 * Multiset funcional do tabuleiro original:
 * 4 + 4 + 4 + 2 + 2 + 2 = 18 cartas = 9 pares.
 */
export const MULTISET_CLASSICO = Object.freeze(
  SIMBOLOS_CLASSICOS.flatMap((simbolo, indice) =>
    Array(indice < 3 ? 4 : 2).fill(simbolo.id)
  )
);

/**
 * Gerador de números pseudoaleatórios determinístico (mulberry32).
 * Usado para tornar testes determinísticos quando desejado.
 * @param {number} semente
 * @returns {function(): number}
 */
export function criarRng(semente = Date.now()) {
  let estado = semente >>> 0;
  return function rng() {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Embaralhamento Fisher-Yates. Não muta a entrada.
 * @param {Array} lista
 * @param {function(): number} rng
 * @returns {Array} nova permutação
 */
export function embaralhar(lista, rng = Math.random) {
  const copia = Array.from(lista);
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * As 8 disposições canônicas do N-Mark Spade Panel, confirmadas diretamente
 * em `scripts/levels.js` da referência e convertidas para os IDs locais
 * (`10coins` → `coins10`, `20coins` → `coins20`, `1up` → `oneup`).
 *
 * Cada array tem 18 posições e a mesma distribuição 4/4/4/2/2/2 (9 pares).
 * A ordem dos arrays é a ordem original dos níveis 1 a 8.
 */
export const CLASSIC_LEVELS = Object.freeze([
  Object.freeze([
    'shroom', 'flower', 'coins20', 'shroom', 'coins10', 'star',
    'flower', 'oneup', 'shroom', 'coins10', 'oneup', 'coins20',
    'star', 'flower', 'star', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'shroom', 'flower', 'coins20', 'flower', 'coins10', 'star',
    'coins20', 'oneup', 'shroom', 'coins10', 'oneup', 'flower',
    'star', 'shroom', 'star', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'shroom', 'flower', 'oneup', 'flower', 'star', 'star',
    'coins20', 'star', 'shroom', 'coins10', 'oneup', 'flower',
    'coins20', 'shroom', 'coins10', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'flower', 'coins10', 'oneup', 'flower', 'oneup', 'shroom',
    'star', 'shroom', 'coins20', 'star', 'shroom', 'coins10',
    'star', 'flower', 'coins20', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'flower', 'coins20', 'shroom', 'star', 'oneup', 'flower',
    'oneup', 'flower', 'coins10', 'shroom', 'coins20', 'star',
    'shroom', 'coins10', 'star', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'flower', 'star', 'oneup', 'flower', 'coins20', 'shroom',
    'coins10', 'shroom', 'coins20', 'oneup', 'shroom', 'coins10',
    'star', 'flower', 'star', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'flower', 'star', 'oneup', 'flower', 'oneup', 'shroom',
    'coins10', 'shroom', 'flower', 'star', 'shroom', 'coins10',
    'star', 'coins20', 'coins20', 'shroom', 'flower', 'star'
  ]),
  Object.freeze([
    'oneup', 'shroom', 'coins10', 'shroom', 'flower', 'star',
    'shroom', 'coins10', 'star', 'coins20', 'coins20', 'flower',
    'star', 'oneup', 'flower', 'shroom', 'flower', 'star'
  ])
]);

/** Alias semântico para o modo SMB3. */
export const LAYOUTS_SMB3 = CLASSIC_LEVELS;

/** Mapa id -> definição visual, para lookup rápido no renderer e nos testes. */
export function criarMapaSimbolos(lista) {
  const mapa = new Map();
  for (const simbolo of lista) mapa.set(simbolo.id, simbolo);
  return mapa;
}

export function contarPorSimbolo(ids) {
  const contagem = new Map();
  for (const id of ids) contagem.set(id, (contagem.get(id) || 0) + 1);
  return contagem;
}
