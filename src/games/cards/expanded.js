/**
 * games/cards/expanded.js — Regras do modo Expandido
 *
 * Modo independente do clássico. Amplia cartas, tabuleiros, dificuldades,
 * desafios, progressão e estatísticas SEM alterar as regras do modo clássico.
 *
 * Decisões de design (documentadas em docs/DECISOES_TECNICAS.md):
 *  - quando o número de pares excede o pool de 12 símbolos, novos pares são
 *    criados como variantes (mesmo glifo, identifier distinto e etiqueta
 *    numerada), mantendo combinações únicas até 50 pares;
 *  - desafios são avaliações pós-partida (não mudam a mecânica de virar pares);
 *  - a progressão automática é opcional e controlada pela UI.
 */

import {
  SIMBOLOS_EXPANDIDOS,
  embaralhar
} from './cards-data.js';
import {
  getDificuldadeCartas,
  proximaDificuldade as proximaDaProgressao
} from './difficulty.js';
import { tentativasPorDificuldade } from './tentativas.js';

/**
 * Desafios do modo expandido. Cada challenge é avaliado ao final da partida.
 * As funções retornam apenas dados serializáveis (id, descricao, concluido).
 */
export const DESAFIOS_EXPANDIDO = Object.freeze([
  {
    id: 'sem_erros',
    descricao: 'Nenhum par errado',
    avaliar: (stats) => (stats.erros || 0) === 0
  },
  {
    id: 'boa_memoria',
    descricao: 'No máximo 2 erros',
    avaliar: (stats) => (stats.erros || 0) <= 2
  },
  {
    id: 'tempo_alvo',
    descricao: 'Concluir dentro do tempo alvo',
    avaliar: (stats) =>
      Number.isFinite(stats.tempoAlvo) &&
      Number.isFinite(stats.tempoSegundos) &&
      stats.tempoSegundos <= stats.tempoAlvo
  },
  {
    id: 'precisao_total',
    descricao: 'Tantas tentativas quanto pares',
    avaliar: (stats) => (stats.tentativas || 0) === (stats.totalPares || 0)
  }
]);

/**
 * Gera as definições de pares. Cicla o pool base e cria variantes numeradas
 * quando necessário (ex.: 50 pares a partir de 12 símbolos).
 *
 * Quando selfies ativas são fornecidas, pares normais SÃO SUBSTITUÍDOS (nunca
 * adicionados): cada selfie ocupa exatamente um par, escolhido aleatoriamente.
 * O total de cartas e de pares permanece idêntico ao da dificuldade.
 *
 * @param {number} quantidade
 * @param {function(): number} rng
 * @param {Array<{id: number, nome: string, imagem: string}>} selfies
 * @returns {Array<object>}
 */
export function gerarParesExpandido(quantidade, rng = Math.random, selfies = []) {
  const total = Math.max(1, Math.floor(quantidade) || 1);
  const pares = [];

  for (let i = 0; i < total; i++) {
    const base = SIMBOLOS_EXPANDIDOS[i % SIMBOLOS_EXPANDIDOS.length];
    const variante = Math.floor(i / SIMBOLOS_EXPANDIDOS.length);
    pares.push({
      id: variante === 0 ? base.id : `${base.id}_v${variante + 1}`,
      nome: variante === 0 ? base.nome : `${base.nome} ${variante + 1}`,
      glyph: base.glyph,
      cor: base.cor,
      variante
    });
  }

  const disponiveis = (Array.isArray(selfies) ? selfies : [])
    .filter((selfie) => selfie && selfie.id != null && selfie.imagem)
    .slice(0, total);
  if (!disponiveis.length) return pares;

  // Escolhe quais pares normais serão substituídos, de forma aleatória.
  const indices = embaralhar(pares.map((_, indice) => indice), rng).slice(0, disponiveis.length);
  indices.forEach((indice, posicao) => {
    const selfie = disponiveis[posicao];
    pares[indice] = {
      id: `selfie-${selfie.id}`,
      nome: selfie.nome || `Selfie ${posicao + 1}`,
      glyph: '📷',
      cor: '#a78bfa',
      imagem: selfie.imagem,
      selfie: true,
      selfieId: selfie.id,
      variante: 0
    };
  });

  return pares;
}

/**
 * Cria a configuração de uma partida expandida.
 *
 * @param {string} chaveDificuldade
 * @param {function(): number} rng
 * @param {object} opcoes - selfies ativas, modalidade e configuração de CHEAT
 */
export function criarConfigExpandida(
  chaveDificuldade = 'normal',
  rng = Math.random,
  opcoes = {}
) {
  const chave = String(chaveDificuldade || 'normal');
  const diff = getDificuldadeCartas(chave);
  const selfies = Array.isArray(opcoes.selfies) ? opcoes.selfies : [];
  const modalidade = opcoes.modalidade === 'tentativas' ? 'tentativas' : 'pontuacao';
  const cheat = opcoes.cheat || { tipo: 'normal', infinitas: false, quantidade: null };
  // Chamadores diretos podem não ter passado pelo resolvedor de CHEAT; nesse
  // caso usa-se a tabela da dificuldade, mantendo a partida sempre jogável.
  const valorTentativas = cheat.infinitas === true
    ? null
    : (Number.isFinite(cheat.valor)
      ? cheat.valor
      : (modalidade === 'tentativas' ? tentativasPorDificuldade(chave) : null));
  const pares = gerarParesExpandido(diff.pares, rng, selfies);

  const cartas = embaralhar(
    pares.flatMap((par) => [
      { simbolo: par.id, selfie: par.selfie === true },
      { simbolo: par.id, selfie: par.selfie === true }
    ]),
    rng
  ).map((carta, indice) => ({
    id: indice,
    simbolo: carta.simbolo,
    selfie: carta.selfie
  }));

  return {
    modo: 'expandido',
    titulo: `Expandido · ${diff.label}`,
    dificuldade: chave,
    colunas: diff.colunas,
    linhas: diff.linhas,
    totalCartas: diff.cartas,
    totalPares: diff.pares,
    tempoAlvo: diff.tempoAlvo,
    descricao: diff.descricao,
    modalidade,
    cheat: cheat.tipo || 'normal',
    tentativasIniciais: valorTentativas,
    tentativasInfinitas: modalidade === 'tentativas' && cheat.infinitas === true,
    selfiesPares: Math.min(selfies.length, diff.pares),
    cartas,
    simbolos: pares,
    desafios: DESAFIOS_EXPANDIDO
  };
}

/**
 * Avança na progressão de dificuldade.
 * @param {string} chave
 */
export function proximaDificuldade(chave) {
  return proximaDaProgressao(chave);
}

/**
 * Avalia os desafios de uma partida concluída e devolve dados serializáveis.
 * @param {object} stats
 */
export function avaliarDesafios(stats) {
  return DESAFIOS_EXPANDIDO.map((desafio) => ({
    id: desafio.id,
    descricao: desafio.descricao,
    concluido: Boolean(desafio.avaliar(stats))
  }));
}
