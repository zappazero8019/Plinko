/**
 * games/cards/classic.js — Regras do modo SMB3 (N-Mark Spade Panel)
 *
 * Reprodução funcional do minigame do SMB3, com layouts canônicos confirmados
 * na referência. Nenhum sprite, som ou código do repositório de referência
 * foi copiado (ele não possui licença declarada).
 *
 * Regras preservadas:
 *  - tabuleiro fixo de 3 linhas x 6 colunas (18 cartas);
 *  - 6 tipos com contagens 4, 4, 4, 2, 2, 2 (9 pares);
 *  - 8 disposições originais, sorteadas uniformemente a cada partida;
 *  - sem cronômetro de partida, sem derrota, sem pontuação e sem aposta.
 *
 * Adaptação solicitada: as 3 dificuldades alteram APENAS o tempo da
 * apresentação inicial (memorização). Cartas, símbolos e layouts são fixos.
 */

import {
  CLASSIC_LEVELS,
  SIMBOLOS_CLASSICOS,
  criarRng
} from './cards-data.js';
import {
  DIFICULDADES_CARTAS_SMB3,
  PROGRESSAO_SMB3,
  getDificuldadeSmb3
} from './difficulty.js';

/**
 * Tempos da mecânica original, em ms (main.js da referência):
 *  - revelar 1ª/2ª carta: 5 frames de 80 ms + 50 ms de liberação ≈ 450 ms;
 *  - erro: 800 ms antes de virar de volta + 4 frames de 80 ms por carta;
 *  - acerto: som de confirmação após 400 ms;
 *  - conclusão: 2000 ms antes de avançar.
 */
export const ATRASOS_SMB3 = Object.freeze({
  revelacao: 450,
  comparacao: 800,
  par: 400,
  concluido: 2000
});

export const CLASSICO = Object.freeze({
  id: 'classico',
  titulo: 'SMB3',
  colunas: 6,
  linhas: 3,
  totalCartas: 18,
  totalPares: 9,
  quantidadeLayouts: CLASSIC_LEVELS.length,
  simbolos: SIMBOLOS_CLASSICOS,
  tempoAlvo: null,
  atrasos: ATRASOS_SMB3,
  descricao: 'N-Mark Spade Panel: 18 cartas, 9 pares, 8 disposições originais.'
});

/**
 * Sorteia uma das 8 disposições canônicas.
 * @param {function(): number} rng
 * @returns {{indice: number, ids: string[]}}
 */
export function sortearLayoutClassico(rng = Math.random) {
  const valor = Math.max(0, Math.min(0.999999999, Number(rng()) || 0));
  const indice = Math.floor(valor * CLASSIC_LEVELS.length);
  return { indice, ids: CLASSIC_LEVELS[indice].slice() };
}

/**
 * Cria a configuração de uma partida SMB3.
 *
 * Aceita `criarConfigClassica('facil', rng)` e, por compatibilidade com a
 * suíte anterior, `criarConfigClassica(rng)` (usa dificuldade 'normal').
 *
 * @param {string|function(): number} dificuldadeOuRng
 * @param {function(): number} rng
 */
export function criarConfigClassica(dificuldadeOuRng = 'normal', rng = Math.random) {
  let dificuldade = 'normal';
  let gerador = rng;

  if (typeof dificuldadeOuRng === 'function') {
    gerador = dificuldadeOuRng;
  } else if (dificuldadeOuRng !== undefined && dificuldadeOuRng !== null) {
    dificuldade = String(dificuldadeOuRng);
  }

  if (!DIFICULDADES_CARTAS_SMB3[dificuldade]) dificuldade = 'normal';
  const diff = getDificuldadeSmb3(dificuldade);

  const sorteado = sortearLayoutClassico(gerador);
  const cartas = sorteado.ids.map((simbolo, indice) => ({
    id: indice,
    simbolo
  }));

  return {
    ...CLASSICO,
    modo: 'classico',
    layoutIndice: sorteado.indice,
    cartas,
    simbolos: SIMBOLOS_CLASSICOS,
    dificuldade,
    titulo: `SMB3 · ${diff.label}`,
    tempoMemorizacaoMs: diff.tempoMemorizacaoMs,
    descricao: diff.descricao,
    atrasos: ATRASOS_SMB3,
    desafios: []
  };
}

/** Alias explícito para o modo SMB3. */
export const criarConfigSmb3 = criarConfigClassica;

/**
 * Valida uma disposição canônica (usada nos testes).
 * @param {string[]} ids
 */
export function validarLayoutClassico(ids) {
  if (!Array.isArray(ids) || ids.length !== CLASSICO.totalCartas) return false;

  const contagem = new Map();
  for (const id of ids) contagem.set(id, (contagem.get(id) || 0) + 1);

  const esperado = new Map(SIMBOLOS_CLASSICOS.map((s, i) => [s.id, i < 3 ? 4 : 2]));
  if (contagem.size !== esperado.size) return false;

  for (const [id, qtd] of esperado) {
    if (contagem.get(id) !== qtd) return false;
  }
  return true;
}

/** RNG determinístico útil para testes e reprodução de partidas. */
export { criarRng, PROGRESSAO_SMB3, DIFICULDADES_CARTAS_SMB3 };
