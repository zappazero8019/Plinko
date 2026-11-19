/**
 * games/cards/recompensas.js — Rastreador puro de recompensas por partida
 *
 * Uma instância nova é criada a cada `iniciarPartida()`, garantindo
 * independência entre sessões. Nenhum par é contado durante a prévia: apenas
 * `onPar` incrementa o rastreador, depois que as cartas foram viradas.
 *
 * `registrarCheat()` é o centralizador das recompensas: qualquer cheat atual
 * ou futuro deve passar por ele. Uma vez bloqueado, `rewardsEligible` nunca
 * volta a ser `true` nesta sessão, mesmo que o cheat seja desativado.
 */

import {
  calcularLiquidacaoMQ,
  multiplicadorSequencia
} from '../../core/mq-economy.js';

export function criarRastreadorRecompensas({
  sessionId = '',
  dificuldade = 'normal',
  modalidade = 'pontuacao',
  tentativasIniciais = 0,
  tempoAlvo = 0
} = {}) {
  let paresEncontrados = 0;
  let somaMultiplicadores = 0;
  let sequencia = 0;
  let erros = 0;
  let rewardsEligible = true;
  let finalizado = false;
  const motivosCheat = [];

  function registrarPar() {
    if (finalizado) return 0;
    paresEncontrados += 1;
    sequencia += 1;
    const multiplicador = multiplicadorSequencia(sequencia);
    somaMultiplicadores += multiplicador;
    return multiplicador;
  }

  function registrarErro() {
    if (finalizado) return;
    erros += 1;
    sequencia = 0;
  }

  function registrarCheat(motivo, detalhes = {}) {
    if (finalizado) return false;
    const nome = String(motivo || 'cheat').slice(0, 120);
    rewardsEligible = false;
    if (!motivosCheat.includes(nome)) motivosCheat.push(nome);
    void detalhes;
    return true;
  }

  function resumo(dados = {}) {
    return calcularLiquidacaoMQ({
      sessionId,
      dificuldade,
      modalidade,
      tentativasIniciais,
      tempoAlvo,
      vitoria: Boolean(dados.vitoria),
      elegivel: rewardsEligible,
      motivoInelegibilidade: motivosCheat.join(', '),
      paresEncontrados,
      somaMultiplicadores,
      sequenciaFinal: sequencia,
      erros,
      tentativas: dados.tentativas ?? (paresEncontrados + erros),
      tentativasRestantes: dados.tentativasRestantes ?? null,
      tempoSegundos: dados.tempoSegundos ?? 0
    });
  }

  /** Fecha o rastreador e devolve a liquidação final, uma única vez. */
  function finalizar(dados = {}) {
    if (finalizado) return null;
    finalizado = true;
    return resumo(dados);
  }

  return {
    registrarPar,
    registrarErro,
    registrarCheat,
    resumo,
    finalizar,
    get paresEncontrados() { return paresEncontrados; },
    get sequencia() { return sequencia; },
    get erros() { return erros; },
    get multiplicadorAtual() { return multiplicadorSequencia(sequencia); },
    get rewardsEligible() { return rewardsEligible; },
    get motivosCheat() { return [...motivosCheat]; },
    get finalizado() { return finalizado; }
  };
}
