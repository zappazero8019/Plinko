/**
 * games/cards/previa.js — Controlador puro da prévia obrigatória das cartas.
 *
 * Este módulo não toca o DOM, o banco ou a sessão de jogo. Ele apenas gere
 * UM intervalo de atualização da contagem regressiva e avisa quando a prévia
 * terminou. O integrador (index.js) é responsável por descartar callbacks
 * atrasados usando o identificador da sessão.
 */

import { obterTempoPrevia } from './difficulty.js';

/** Arredonda para cima para mostrar 3, 2, 1 (nunca 0 antes do fim). */
export function segundosRestantes(restanteMs) {
  return Math.ceil(Math.max(0, restanteMs) / 1000);
}

/**
 * Cria um controlador reutilizável e cancelável da prévia.
 *
 * @param {object} opcoes
 * @param {number} opcoes.duracaoMs - duração total em milissegundos
 * @param {number} opcoes.intervaloMs - passo de atualização visual
 * @param {function(): number} opcoes.agora - relógio injetável
 * @param {function(function(): void, number): any} opcoes.setInterval
 * @param {function(any): void} opcoes.clearInterval
 * @param {function(number, number): void} opcoes.onTick - (restanteMs, duracaoMs)
 * @param {function(): void} opcoes.onConcluir
 */
export function criarControladorPrevia({
  duracaoMs = 0,
  intervaloMs = 100,
  agora = () => Date.now(),
  setInterval: agendar = (fn, ms) => setInterval(fn, ms),
  clearInterval: cancelar = (id) => clearInterval(id),
  onTick = () => {},
  onConcluir = () => {}
} = {}) {
  const duracao = Math.max(0, Number(duracaoMs) || 0);
  const passo = Math.max(16, Number(intervaloMs) || 100);
  let id = null;
  let inicio = 0;
  let concluido = false;

  function publicar() {
    const decorrido = Math.max(0, agora() - inicio);
    const restante = Math.max(0, duracao - decorrido);
    onTick(restante, duracao);
    return restante;
  }

  function parar() {
    if (id !== null) {
      cancelar(id);
      id = null;
    }
  }

  function iniciar() {
    if (id !== null || concluido) return false;
    inicio = agora();
    // Duração zero/zero ms ainda publica o estado final uma única vez.
    if (publicar() <= 0) {
      concluido = true;
      onConcluir();
      return true;
    }
    id = agendar(() => {
      // `clearInterval` já foi chamado na conclusão, mas a guarda protege
      // agendadores que ainda chegam a disparar um callback atrasado.
      if (concluido) return;
      if (publicar() <= 0) {
        parar();
        concluido = true;
        onConcluir();
      }
    }, passo);
    return true;
  }

  return {
    iniciar,
    parar,
    get ativo() { return id !== null; },
    get concluido() { return concluido; },
    get duracaoMs() { return duracao; }
  };
}

/** Atalho usado pelo integrador: configuração → controller da prévia. */
export function criarPreviaParaDificuldade(dificuldade, opcoes = {}) {
  return criarControladorPrevia({
    ...opcoes,
    duracaoMs: obterTempoPrevia(dificuldade)
  });
}
