/**
 * game-stats.js — Serviço central de estatísticas de partidas
 *
 * Camada de serviço sobre a store `matches` do IndexedDB (já existente no
 * banco, versão 1). Nenhum jogo acessa IndexedDB diretamente: todos chamam
 * este módulo, que é incluído automaticamente no backup/exportação.
 *
 * Este serviço NÃO altera saldo, transações financeiras nem a versão do banco.
 */

import { getAll, put, count } from './database.js';

const JOGO_PADRAO = 'cards';

/**
 * Registra uma partida concluída (ou abandonada).
 * @param {object} dados
 * @returns {Promise<{ok: true, id, registro: object}>}
 */
async function registrarPartida(dados = {}) {
  const registro = {
    jogo: dados.jogo || JOGO_PADRAO,
    modo: dados.modo || 'classico',
    // Modalidade só existe no Expandido. Registros antigos ficam sem o campo
    // e nunca são interpretados como partidas do Modo Tentativas.
    modalidade: dados.modalidade || null,
    cheat: dados.cheat || 'normal',
    dificuldade: dados.dificuldade || null,
    layoutIndice: Number.isInteger(dados.layoutIndice) ? dados.layoutIndice : null,
    concluida: Boolean(dados.concluida),
    vitoria: Boolean(dados.vitoria ?? dados.concluida),
    totalCartas: Number(dados.totalCartas) || 0,
    totalPares: Number(dados.totalPares) || 0,
    paresEncontrados: Number(dados.paresEncontrados) || 0,
    tentativas: Number(dados.tentativas) || 0,
    tentativasRestantes: Number.isFinite(dados.tentativasRestantes)
      ? Number(dados.tentativasRestantes)
      : null,
    erros: Number(dados.erros) || 0,
    selfiesPares: Number(dados.selfiesPares) || 0,
    bonusSelfies: Number(dados.bonusSelfies) || 0,
    tempoSegundos: Number(dados.tempoSegundos) || 0,
    tempoAlvo: Number.isFinite(dados.tempoAlvo) ? dados.tempoAlvo : null,
    desafios: Array.isArray(dados.desafios) ? dados.desafios.slice() : [],
    playedAt: Number(dados.playedAt) || Date.now()
  };

  const id = await put('matches', registro);
  const completo = { ...registro, id };
  return { ok: true, id, registro: completo };
}

/**
 * Lista partidas, mais recentes primeiro.
 * @param {string} jogo
 * @param {string|null} modo - filtro opcional ('classico' | 'expandido')
 */
async function listarPartidas(jogo = JOGO_PADRAO, modo = null) {
  const todas = await getAll('matches');
  return todas
    .filter((partida) => !jogo || partida.jogo === jogo)
    .filter((partida) => !modo || partida.modo === modo)
    .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
}

/**
 * Conta partidas registradas (usado pelo status da tela inicial).
 */
async function contarPartidas(jogo = JOGO_PADRAO) {
  const todas = await getAll('matches');
  return todas.filter((partida) => !jogo || partida.jogo === jogo).length;
}

/**
 * Estatísticas agregadas, com recorte opcional por modo.
 * @param {string} jogo
 * @param {string|null} modo
 */
async function obterEstatisticas(jogo = JOGO_PADRAO, modo = null) {
  const partidas = await listarPartidas(jogo, modo);

  let concluidas = 0;
  let vitorias = 0;
  let tentativas = 0;
  let erros = 0;
  let pares = 0;
  let derrotas = 0;
  let selfiesPares = 0;
  let bonusSelfies = 0;
  let menorTempo = null;
  const porModalidade = { pontuacao: 0, tentativas: 0, semModalidade: 0 };
  const porCheat = { normal: 0, infinitas: 0, personalizada: 0 };

  for (const partida of partidas) {
    if (partida.concluida) {
      concluidas += 1;
      if (!partida.vitoria) derrotas += 1;
    }
    if (partida.vitoria) vitorias += 1;
    tentativas += Number(partida.tentativas) || 0;
    erros += Number(partida.erros) || 0;
    pares += Number(partida.paresEncontrados) || 0;
    selfiesPares += Number(partida.selfiesPares) || 0;
    bonusSelfies += Number(partida.bonusSelfies) || 0;

    if (partida.modalidade === 'pontuacao' || partida.modalidade === 'tentativas') {
      porModalidade[partida.modalidade] += 1;
    } else {
      porModalidade.semModalidade += 1;
    }
    if (Object.prototype.hasOwnProperty.call(porCheat, partida.cheat)) {
      porCheat[partida.cheat] += 1;
    } else {
      porCheat.normal += 1;
    }

    if (partida.concluida && Number(partida.tempoSegundos) > 0) {
      const tempo = Number(partida.tempoSegundos);
      if (menorTempo === null || tempo < menorTempo) menorTempo = tempo;
    }
  }

  return {
    partidas: partidas.length,
    partidasIniciadas: partidas.length,
    concluidas,
    vitorias,
    derrotas,
    tentativas,
    erros,
    pares,
    selfiesPares,
    bonusSelfies,
    melhorTempoSegundos: menorTempo,
    ultimaPartida: partidas[0] || null,
    porModo: {
      classico: partidas.filter((p) => p.modo === 'classico').length,
      expandido: partidas.filter((p) => p.modo === 'expandido').length
    },
    porModalidade,
    porCheat
  };
}

export {
  registrarPartida,
  listarPartidas,
  contarPartidas,
  obterEstatisticas,
  JOGO_PADRAO
};
