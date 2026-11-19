/**
 * games/cards/board.js — Tabuleiro, regras de seleção e sessão com temporizadores
 *
 * Módulo PURO (sem DOM, sem IndexedDB, sem carteira). Toda a lógica de virar,
 * comparar, bloquear a terceira carta, contabilizar e concluir fica aqui.
 *
 * `criarSessao()` adiciona gerenciamento de timers injetáveis, permitindo
 * testar a limpeza de eventos/temporizadores ao sair do jogo.
 *
 * O cronômetro oficial NÃO começa em `criarSessao()`: a prévia obrigatória
 * acontece antes da partida. O integrador chama `iniciarCronometro()` quando
 * as cartas são viradas para baixo e a interação é liberada.
 */

import { embaralhar } from './cards-data.js';
import { BONUS_SELFIE_TENTATIVAS, ehSelfie } from './tentativas.js';

export { embaralhar };

/**
 * Cria uma partida a partir de uma configuração de modo.
 * @param {object} config - configuração retornada por classic.js/expanded.js
 * @param {{rng?: function(): number}} opcoes
 */
export function criarPartida(config, opcoes = {}) {
  const rng = typeof opcoes.rng === 'function' ? opcoes.rng : Math.random;
  let cartas = [];
  let selecionadas = [];
  let pareadas = [];
  let tentativas = 0;
  let erros = 0;
  let concluida = false;
  let aguardandoComparacao = false;
  let modalidade = config.modalidade || 'pontuacao';
  let tentativasInfinitas = false;
  let tentativasRestantes = null;
  let selfiesPares = 0;
  let bonusSelfies = 0;
  let derrota = false;

  function montar() {
    modalidade = config.modalidade || 'pontuacao';
    tentativasInfinitas = modalidade === 'tentativas' && config.tentativasInfinitas === true;
    cartas = config.cartas.map((carta) => ({
      id: carta.id,
      simbolo: carta.simbolo,
      // Campo preservado apenas para identificar o bônus de selfie; nunca é
      // usado para revelar cartas ocultas.
      selfie: carta.selfie === true,
      revelada: false,
      pareada: false
    }));
    selecionadas = [];
    pareadas = [];
    tentativas = 0;
    erros = 0;
    concluida = false;
    aguardandoComparacao = false;
    tentativasRestantes = tentativasInfinitas
      ? null
      : (Number.isFinite(config.tentativasIniciais) ? config.tentativasIniciais : null);
    selfiesPares = 0;
    bonusSelfies = 0;
    derrota = false;
  }

  function snapshot() {
    return {
      cartas: cartas.map((carta) => ({ ...carta })),
      selecionadas: [...selecionadas],
      pareadas: [...pareadas],
      tentativas,
      erros,
      concluida,
      aguardandoComparacao,
      modalidade,
      tentativasInfinitas,
      tentativasRestantes,
      selfiesPares,
      bonusSelfies,
      derrota,
      progresso: {
        pares: pareadas.length / 2,
        totalPares: config.totalPares,
        tentativas,
        erros,
        concluida
      }
    };
  }

  /**
   * Seleciona uma carta.
   * Regras: ignorar carta já revelada/pareada, ignorar terceira carta enquanto
   * aguarda a resolução da comparação anterior.
   */
  function selecionar(id) {
    if (concluida) return { tipo: 'concluida', ...snapshot() };
    if (aguardandoComparacao) return { tipo: 'bloqueado', ...snapshot() };

    const carta = cartas.find((item) => item.id === id);
    if (!carta || carta.revelada || carta.pareada) {
      return { tipo: 'ignorado', id, ...snapshot() };
    }

    carta.revelada = true;
    selecionadas.push(carta.id);

    if (selecionadas.length < 2) {
      return { tipo: 'revelado', id, ...snapshot() };
    }

    // Trava a entrada até resolver() ser chamado (animação de comparação).
    aguardandoComparacao = true;
    return { tipo: 'comparacao', ids: [...selecionadas], ...snapshot() };
  }

  /**
   * Resolve a comparação pendente. Deve ser chamado pelo agendador da sessão
   * após o atraso de animação.
   */
  function resolver() {
    if (!aguardandoComparacao || selecionadas.length !== 2) {
      return { tipo: 'nada', ...snapshot() };
    }

    const [primeira, segunda] = selecionadas.map((id) =>
      cartas.find((item) => item.id === id)
    );

    aguardandoComparacao = false;
    tentativas += 1;

    if (primeira.simbolo === segunda.simbolo) {
      primeira.pareada = true;
      segunda.pareada = true;
      primeira.revelada = true;
      segunda.revelada = true;
      pareadas.push(primeira.id, segunda.id);
      selecionadas = [];

      // Bônus de selfie: uma vez por par, somente no Modo Tentativas e nunca
      // quando as tentativas são infinitas (evita valores inconsistentes).
      if (modalidade === 'tentativas' && ehSelfie(primeira)) {
        selfiesPares += 1;
        // `bonusSelfies` guarda o total de tentativas concedidas (2 por par),
        // enquanto `selfiesPares` conta os pares encontrados.
        bonusSelfies += BONUS_SELFIE_TENTATIVAS;
        if (!tentativasInfinitas && tentativasRestantes !== null) {
          tentativasRestantes += BONUS_SELFIE_TENTATIVAS;
        }
      }

      if (pareadas.length === cartas.length) {
        concluida = true;
        return {
          tipo: 'concluido',
          ids: [primeira.id, segunda.id],
          simbolo: primeira.simbolo,
          ...snapshot()
        };
      }

      return {
        tipo: 'par',
        ids: [primeira.id, segunda.id],
        simbolo: primeira.simbolo,
        ...snapshot()
      };
    }

    erros += 1;
    primeira.revelada = false;
    segunda.revelada = false;
    selecionadas = [];

    // Somente o Modo Tentativas consome orçamento, e apenas em erros.
    if (modalidade === 'tentativas' && !tentativasInfinitas && tentativasRestantes !== null) {
      tentativasRestantes = Math.max(0, tentativasRestantes - 1);
      if (tentativasRestantes === 0) {
        concluida = true;
        derrota = true;
        return {
          tipo: 'esgotado',
          ids: [primeira.id, segunda.id],
          ...snapshot()
        };
      }
    }

    return {
      tipo: 'erro',
      ids: [primeira.id, segunda.id],
      ...snapshot()
    };
  }

  /** Reinicia a partida com a mesma configuração (novo RNG se fornecido). */
  function reiniciar(novaConfig = config) {
    config = novaConfig;
    montar();
    return snapshot();
  }

  montar();

  return {
    selecionar,
    resolver,
    reiniciar,
    estado: snapshot,
    get configuracao() { return config; }
  };
}

const ATRASOS_PADRAO = Object.freeze({
  revelacao: 450,    // 5 frames de 80 ms + 50 ms para liberar a entrada
  comparacao: 800,   // erro: espera antes de virar as cartas de volta
  par: 400,          // acerto: confirmação sonora
  concluido: 2000    // fim: avanço/resultado
});

/**
 * Cria uma sessão com timers gerenciáveis.
 *
 * @param {object} config
 * @param {object} opcoes
 * @param {Function} opcoes.setTimeout
 * @param {Function} opcoes.clearTimeout
 * @param {Function} opcoes.agora
 * @param {object} opcoes.callbacks - onRevelado, onBloqueado, onPar, onErro, onConcluido
 * @param {object} opcoes.atrasos
 */
export function criarSessao(config, opcoes = {}) {
  const agendar = typeof opcoes.setTimeout === 'function'
    ? opcoes.setTimeout
    : (fn, ms) => setTimeout(fn, ms);
  const cancelar = typeof opcoes.clearTimeout === 'function'
    ? opcoes.clearTimeout
    : (id) => clearTimeout(id);
  const agora = typeof opcoes.agora === 'function' ? opcoes.agora : () => Date.now();
  const callbacks = opcoes.callbacks || {};
  const atrasos = {
    ...ATRASOS_PADRAO,
    ...(config.atrasos || {}),
    ...(opcoes.atrasos || {})
  };

  const partida = criarPartida(config, { rng: opcoes.rng });
  const temporizadores = new Set();
  let destruida = false;
  // null = prévia em andamento; o tempo oficial só começa quando o integrador
  // chamar iniciarCronometro() após a prévia.
  let inicio = null;

  function emitir(nome, payload) {
    if (typeof callbacks[nome] === 'function' && !destruida) {
      callbacks[nome](payload);
    }
  }

  function agendarTarefa(fn, ms) {
    const id = agendar(() => {
      temporizadores.delete(id);
      if (!destruida) fn();
    }, ms);
    temporizadores.add(id);
    return id;
  }

  function selecionar(id) {
    if (destruida) return { tipo: 'destruida' };

    const resultado = partida.selecionar(id);

    if (resultado.tipo === 'revelado') {
      emitir('onRevelado', resultado);
    } else if (resultado.tipo === 'bloqueado') {
      emitir('onBloqueado', resultado);
    } else if (resultado.tipo === 'comparacao') {
      emitir('onComparacao', resultado);
      agendarTarefa(() => {
        const resolucao = partida.resolver();
        if (resolucao.tipo === 'par') {
          // O som/label de acerto aparece após a animação de confirmação.
          agendarTarefa(() => emitir('onPar', resolucao), atrasos.par);
        } else if (resolucao.tipo === 'erro') {
          // No original o som de erro dispara quando a virada de volta começa.
          emitir('onErro', resolucao);
        } else if (resolucao.tipo === 'esgotado') {
          // A partida terminou por esgotamento: ainda informa o erro e depois
          // encerra com derrota, sem tocar nas regras do Modo Pontuação.
          emitir('onErro', resolucao);
          emitir('onEsgotado', resolucao);
        } else if (resolucao.tipo === 'concluido') {
          agendarTarefa(() => emitir('onPar', resolucao), atrasos.par);
          agendarTarefa(() => emitir('onConcluido', resolucao), atrasos.concluido);
        }
      }, atrasos.comparacao);
    }

    return resultado;
  }

  function reiniciar(novaConfig = config) {
    limparTemporizadores();
    destruida = false;
    inicio = null;
    const estado = partida.reiniciar(novaConfig);
    emitir('onReiniciado', estado);
    return estado;
  }

  function limparTemporizadores() {
    for (const id of temporizadores) cancelar(id);
    temporizadores.clear();
  }

  function destruir() {
    destruida = true;
    limparTemporizadores();
  }

  /** Inicia o cronômetro oficial uma única vez por partida. */
  function iniciarCronometro() {
    if (inicio === null) inicio = agora();
    return inicio;
  }

  function tempoDecorrido() {
    if (inicio === null) return 0;
    return Math.max(0, Math.floor((agora() - inicio) / 1000));
  }

  function estatisticas() {
    const estado = partida.estado();
    return {
      modo: config.modo,
      dificuldade: config.dificuldade || null,
      layoutIndice: config.layoutIndice ?? null,
      totalCartas: config.totalCartas,
      totalPares: config.totalPares,
      paresEncontrados: estado.progresso.pares,
      tentativas: estado.tentativas,
      tentativasRestantes: estado.tentativasRestantes,
      erros: estado.erros,
      selfiesPares: estado.selfiesPares,
      bonusSelfies: estado.bonusSelfies,
      modalidade: estado.modalidade,
      cheat: config.cheat || 'normal',
      derrota: estado.derrota,
      tempoSegundos: tempoDecorrido(),
      tempoAlvo: config.tempoAlvo ?? null,
      concluida: estado.concluida
    };
  }

  return {
    selecionar,
    reiniciar,
    destruir,
    iniciarCronometro,
    estado: () => partida.estado(),
    estatisticas,
    tempoDecorrido,
    get cronometroAtivo() { return inicio !== null; },
    get destruida() { return destruida; },
    get temporizadoresPendentes() { return temporizadores.size; }
  };
}
