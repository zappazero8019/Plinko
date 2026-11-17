/**
 * tentativas.js — Regras puras do Modo Tentativas do Card Match Expandido
 *
 * Módulo sem DOM, sem IndexedDB e sem dependência do renderer. Concentra a
 * tabela de tentativas iniciais, a prioridade do CHEAT e os bônus de selfie.
 * O Modo Pontuação (comportamento atual) não consulta nada deste arquivo.
 */

import { DIFICULDADES_CARTAS_EXPANDIDO } from './difficulty.js';

/**
 * Tentativas iniciais por dificuldade. A margem sobre o número de pares cresce
 * em termos absolutos e diminui em termos relativos (difíceis exigem mais
 * precisão), sem alterar cartas, pares, embaralhamento ou tempo alvo.
 *
 * | Dificuldade    | Pares | Tentativas | Margem |
 * |----------------|------:|-----------:|-------:|
 * | Fácil          |     9 |         14 | +5     |
 * | Normal         |    15 |         22 | +7     |
 * | Difícil        |    24 |         32 | +8     |
 * | Muito Difícil  |    36 |         45 | +9     |
 * | Extremo        |    50 |         60 | +10    |
 */
export const TENTATIVAS_INICIAIS = Object.freeze({
  facil: 14,
  normal: 22,
  dificil: 32,
  muitodificil: 45,
  extremo: 60
});

export const TIPOS_CHEAT = Object.freeze({
  NORMAL: 'normal',
  INFINITAS: 'infinitas',
  PERSONALIZADA: 'personalizada'
});

export const CHEAT_PADRAO = TIPOS_CHEAT.NORMAL;
export const QUANTIDADE_PADRAO = 20;
export const QUANTIDADE_MIN = 1;
export const QUANTIDADE_MAX = 999;

/** Bônus concedido uma única vez por par de selfie encontrado. */
export const BONUS_SELFIE_TENTATIVAS = 2;

/**
 * Mantido apenas como dado documental: o Expandido não possui contador de
 * pontos numérico (decisão registrada), portanto nenhum placar é criado.
 */
export const BONUS_SELFIE_PONTOS = 50;

export function tentativasPorDificuldade(chave) {
  const diff = DIFICULDADES_CARTAS_EXPANDIDO[chave]
    ? chave
    : 'normal';
  return TENTATIVAS_INICIAIS[diff];
}

export function normalizarQuantidade(valor) {
  // null/undefined/'' devem usar o padrão (Number(null) é 0, que viraria 1).
  if (typeof valor !== 'number' && typeof valor !== 'string') return QUANTIDADE_PADRAO;
  if (typeof valor === 'string' && valor.trim() === '') return QUANTIDADE_PADRAO;
  const numero = Number(valor);
  if (!Number.isInteger(numero)) return QUANTIDADE_PADRAO;
  return Math.min(QUANTIDADE_MAX, Math.max(QUANTIDADE_MIN, numero));
}

/**
 * Aplica a prioridade obrigatória:
 *   1. infinitas ativadas;
 *   2. quantidade personalizada ativada;
 *   3. padrão da dificuldade.
 *
 * As duas opções nunca produzem valores conflitantes: quando infinitas está
 * ligada, `quantidade` é null e o contador exibe ∞.
 */
export function resolverCheat({ infinitas = false, personalizada = false, quantidade } = {}) {
  if (infinitas === true) {
    return { tipo: TIPOS_CHEAT.INFINITAS, infinitas: true, quantidade: null };
  }
  if (personalizada === true) {
    return {
      tipo: TIPOS_CHEAT.PERSONALIZADA,
      infinitas: false,
      quantidade: normalizarQuantidade(quantidade)
    };
  }
  return { tipo: TIPOS_CHEAT.NORMAL, infinitas: false, quantidade: null };
}

/**
 * Devolve a configuração efetiva de tentativas para uma nova partida.
 * @returns {{tipo: string, infinitas: boolean, valor: number|null}}
 */
export function calcularTentativasIniciais(dificuldade, opcoesCheat = {}) {
  const resolvido = resolverCheat(opcoesCheat);
  const valor = resolvido.infinitas
    ? null
    : (resolvido.quantidade ?? tentativasPorDificuldade(dificuldade));
  return { ...resolvido, valor };
}

/** Identifica um par de selfie pelo campo explícito ou pelo prefixo do símbolo. */
export function ehSelfie(carta) {
  if (!carta) return false;
  return carta.selfie === true || String(carta.simbolo || '').startsWith('selfie-');
}
