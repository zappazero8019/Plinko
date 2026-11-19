/**
 * stats-insights.js — leituras derivadas das estatísticas reais do Memory Quest.
 *
 * Este módulo NÃO cria dados: apenas transforma os registros já persistidos em
 * `matches` e as transações já creditadas em `mqTransactions`. Quando não há
 * histórico suficiente, os indicadores que dependem dele retornam `null` para
 * que a interface mostre "sem dados" em vez de um zero enganoso.
 *
 * Nenhuma regra econômica é recalculada aqui. As moedas exibidas são a soma das
 * transações efetivamente gravadas pela liquidação atômica da ETAPA 3.
 */

import { getAll } from './database.js';
import { listarPartidas } from './game-stats.js';
import {
  MQ_WALLET_ID,
  MQ_TIPO_PAR,
  MQ_TIPO_BONUS
} from './mq-economy.js';
import { PROGRESSAO_CARTAS } from '../games/cards/difficulty.js';

/** Quantidade máxima de partidas no gráfico de evolução (legibilidade em telas pequenas). */
export const LIMITE_EVOLUCAO = 12;

const ROTULOS_DIFICULDADE = Object.freeze({
  facil: 'Fácil',
  normal: 'Normal',
  dificil: 'Difícil',
  muitodificil: 'Muito difícil',
  extremo: 'Extremo'
});

function numeroSeguro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function media(soma, quantidade) {
  return quantidade > 0 ? soma / quantidade : null;
}

function rotuloDificuldade(chave) {
  return ROTULOS_DIFICULDADE[chave] || String(chave || 'Sem dificuldade');
}

/**
 * Deriva indicadores de um conjunto de partidas já obtido de `matches`.
 * Função pura: não lê banco, não grava e não altera os registros recebidos.
 */
export function calcularInsights(partidas = []) {
  const todas = Array.isArray(partidas) ? partidas.filter(Boolean) : [];
  const concluidas = todas.filter((partida) => partida.concluida === true);
  const vitorias = concluidas.filter((partida) => partida.vitoria === true);
  const derrotas = concluidas.filter((partida) => partida.vitoria !== true);
  const tempoTotal = concluidas.reduce(
    (soma, partida) => soma + numeroSeguro(partida.tempoSegundos), 0
  );
  const tempoComRegistro = concluidas.filter(
    (partida) => numeroSeguro(partida.tempoSegundos) > 0
  ).length;
  const pares = todas.reduce(
    (soma, partida) => soma + numeroSeguro(partida.paresEncontrados), 0
  );
  const tentativas = todas.reduce(
    (soma, partida) => soma + numeroSeguro(partida.tentativas), 0
  );
  const erros = todas.reduce(
    (soma, partida) => soma + numeroSeguro(partida.erros), 0
  );

  const chavesDificuldade = [...new Set([
    ...PROGRESSAO_CARTAS,
    ...todas.map((partida) => partida.dificuldade).filter(Boolean)
  ])];
  const porDificuldade = chavesDificuldade.map((chave) => {
    const grupo = todas.filter((partida) => partida.dificuldade === chave);
    const finalizadas = grupo.filter((partida) => partida.concluida === true);
    const ganhas = finalizadas.filter((partida) => partida.vitoria === true);
    const tempoGrupo = finalizadas.reduce(
      (soma, partida) => soma + numeroSeguro(partida.tempoSegundos), 0
    );
    const comTempo = finalizadas.filter(
      (partida) => numeroSeguro(partida.tempoSegundos) > 0
    ).length;
    return {
      chave,
      rotulo: rotuloDificuldade(chave),
      partidas: grupo.length,
      concluidas: finalizadas.length,
      vitorias: ganhas.length,
      derrotas: finalizadas.length - ganhas.length,
      taxaVitorias: media(ganhas.length, finalizadas.length),
      pares: grupo.reduce(
        (soma, partida) => soma + numeroSeguro(partida.paresEncontrados), 0
      ),
      tempoMedioSegundos: media(tempoGrupo, comTempo)
    };
  }).filter((item) => item.partidas > 0);

  // Ordem cronológica: o gráfico mostra a sequência real de desfechos, sem
  // médias móveis ou tendências que os registros não sustentam.
  const cronologicas = concluidas
    .slice()
    .sort((a, b) => (numeroSeguro(a.playedAt) - numeroSeguro(b.playedAt)));
  const inicio = Math.max(0, cronologicas.length - LIMITE_EVOLUCAO);
  const evolucao = cronologicas.slice(inicio).map((partida, indice) => ({
    numero: inicio + indice + 1,
    vitoria: partida.vitoria === true,
    dificuldade: partida.dificuldade || null,
    rotuloDificuldade: rotuloDificuldade(partida.dificuldade),
    paresEncontrados: numeroSeguro(partida.paresEncontrados),
    tempoSegundos: numeroSeguro(partida.tempoSegundos),
    playedAt: numeroSeguro(partida.playedAt)
  }));

  return {
    partidas: todas.length,
    concluidas: concluidas.length,
    vitorias: vitorias.length,
    derrotas: derrotas.length,
    taxaVitorias: media(vitorias.length, concluidas.length),
    tempoTotalSegundos: tempoTotal,
    tempoMedioSegundos: media(tempoTotal, tempoComRegistro),
    pares,
    tentativas,
    erros,
    paresPorPartida: media(pares, todas.length),
    porDificuldade,
    evolucao,
    limiteEvolucao: LIMITE_EVOLUCAO
  };
}

/** Lê `matches` e devolve as partidas junto com os indicadores derivados. */
export async function obterInsightsPartidas(jogo = 'cards') {
  const partidas = await listarPartidas(jogo);
  return { partidas, insights: calcularInsights(partidas) };
}

/**
 * Soma as moedas já creditadas no Memory Quest.
 * Usa as transações como fonte única: saldo é dinheiro disponível, enquanto
 * `totalConquistado` inclui o histórico; nenhum dos dois é recalculado aqui.
 */
export async function obterMoedasConquistadasMQ() {
  try {
    const transacoes = await getAll('mqTransactions');
    const creditos = transacoes.filter((registro) => (
      Number(registro?.walletId) === MQ_WALLET_ID &&
      (registro?.tipo === MQ_TIPO_PAR || registro?.tipo === MQ_TIPO_BONUS)
    ));
    const porTipo = {
      pares: creditos.filter((item) => item.tipo === MQ_TIPO_PAR)
        .reduce((soma, item) => soma + numeroSeguro(item.quantidade), 0),
      bonus: creditos.filter((item) => item.tipo === MQ_TIPO_BONUS)
        .reduce((soma, item) => soma + numeroSeguro(item.quantidade), 0)
    };
    return {
      total: porTipo.pares + porTipo.bonus,
      transacoes: creditos.length,
      porTipo
    };
  } catch (err) {
    console.warn('[stats] Falha ao ler transações do Memory Quest:', err);
    return { total: null, transacoes: null, porTipo: { pares: null, bonus: null } };
  }
}

export { rotuloDificuldade };
