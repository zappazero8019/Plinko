/**
 * games/cards/visao-total.js — Controlador da habilidade Visão total (Fase 2)
 *
 * Módulo puro (sem DOM, sem IndexedDB): coordena o consumo de um uso, o período
 * da habilidade e o cancelamento seguro. A duração é decidida no momento da
 * ativação pela dificuldade da partida. Toda decisão de regra da partida
 * (comparação pendente, seleção isolada, pares) permanece em `board.js`; toda
 * revelação visual permanece no renderer. Aqui só existe o ciclo da habilidade.
 *
 * A chave de cada ativação é criada UMA vez e reutilizada em retries técnicos.
 * A proteção contra cliques rápidos é local; a proteção contra duplicação entre
 * abas está em `core/mq-habilidade.js`, no índice único do IndexedDB.
 */

import {
  DURACAO_VISAO_TOTAL_MS,
  obterTempoVisaoTotal,
  criarChaveOperacaoVisaoTotal
} from '../../core/mq-habilidade.js';

function inteiroSeguro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.max(0, Math.floor(numero)) : 0;
}

/**
 * @param {object} opcoes
 * @param {function(): number} [opcoes.agora]
 * @param {function(function(): void, number): number} [opcoes.setTimeout]
 * @param {function(number): void} [opcoes.clearTimeout]
 * @param {function(string): Promise<object>} [opcoes.consumir]
 * @param {number} [opcoes.duracaoMs] - duração fixa opcional (testes/legado)
 * @param {function(string): number} [opcoes.obterDuracaoMs] - resolução customizada
 * @param {function(object): void} [opcoes.onEstado]
 * @param {function(object): void} [opcoes.onAtivar]
 * @param {function(object): void} [opcoes.onRestaurar]
 * @param {function(object): void} [opcoes.onErro]
 */
export function criarControladorVisaoTotal(opcoes = {}) {
  const agora = typeof opcoes.agora === 'function' ? opcoes.agora : () => Date.now();
  const agendar = typeof opcoes.setTimeout === 'function'
    ? opcoes.setTimeout
    : (fn, ms) => setTimeout(fn, ms);
  const cancelarTimer = typeof opcoes.clearTimeout === 'function'
    ? opcoes.clearTimeout
    : (id) => clearTimeout(id);
  const consumir = typeof opcoes.consumir === 'function'
    ? opcoes.consumir
    : () => Promise.resolve({ ok: false, erro: 'sem_servico', saldo: 0, estoque: 0 });
  const duracaoPadraoMs = Math.max(1, inteiroSeguro(opcoes.duracaoMs ?? DURACAO_VISAO_TOTAL_MS));

  let geracao = 0;
  let estado = 'inativo'; // inativo | consumindo | ativo
  let usos = inteiroSeguro(opcoes.usos);
  let chaveAtual = null;
  let timer = null;
  let ativadoAte = 0;
  let duracaoAtivaMs = duracaoPadraoMs;

  function notificarEstado() {
    if (typeof opcoes.onEstado === 'function') {
      opcoes.onEstado({
        estado, usos, ativa: estado === 'ativo',
        ocupado: estado !== 'inativo', chaveOperacao: chaveAtual,
        duracaoMs: duracaoAtivaMs
      });
    }
  }

  function falha(motivo, detalhes = {}) {
    if (typeof opcoes.onErro === 'function') {
      opcoes.onErro({ motivo, ...detalhes });
    }
  }

  function limparTimer() {
    if (timer !== null) {
      cancelarTimer(timer);
      timer = null;
    }
  }

  /**
   * Resolve a duração no instante da ativação. Nenhum timer antigo é alterado.
   */
  function resolverDuracao(contexto) {
    const explicita = contexto.duracaoMs ?? opcoes.duracaoMs;
    if (explicita !== undefined && explicita !== null) {
      return Math.max(1, inteiroSeguro(explicita));
    }
    if (typeof opcoes.obterDuracaoMs === 'function') {
      return Math.max(1, inteiroSeguro(
        opcoes.obterDuracaoMs(contexto.dificuldade, contexto)
      ));
    }
    if (contexto.dificuldade !== undefined && contexto.dificuldade !== null) {
      return Math.max(1, inteiroSeguro(obterTempoVisaoTotal(contexto.dificuldade)));
    }
    return duracaoPadraoMs;
  }

  /**
   * Tenta ativar a habilidade.
   * @param {{aguardandoComparacao?: boolean, partidaAtiva?: boolean,
   *   dificuldade?: string, duracaoMs?: number}} contexto
   */
  async function ativar(contexto = {}) {
    if (contexto.partidaAtiva === false) {
      return { ok: false, motivo: 'partida_inativa' };
    }
    if (contexto.aguardandoComparacao) {
      falha('comparacao_pendente');
      return { ok: false, motivo: 'comparacao_pendente' };
    }
    if (estado !== 'inativo') {
      return { ok: false, motivo: estado === 'ativo' ? 'ja_ativa' : 'consumindo' };
    }
    if (usos < 1) {
      falha('sem_estoque', { usos });
      return { ok: false, motivo: 'sem_estoque' };
    }

    const geracaoLocal = geracao;
    const chave = criarChaveOperacaoVisaoTotal();
    chaveAtual = chave;
    estado = 'consumindo';
    notificarEstado();

    let resultado;
    try {
      resultado = await consumir(chave);
    } catch (err) {
      if (geracaoLocal === geracao) {
        estado = 'inativo';
        chaveAtual = null;
        notificarEstado();
      }
      falha('falha_consumo', { erro: String(err?.message || err) });
      return { ok: false, motivo: 'falha_consumo' };
    }

    // Uma navegação/reinício ocorreu enquanto o IndexedDB respondia: o uso já
    // está consumido e não será devolvido, mas nenhuma revelação é iniciada.
    if (geracaoLocal !== geracao) {
      return { ok: false, motivo: 'cancelado', resultado };
    }

    if (!resultado?.ok) {
      estado = 'inativo';
      chaveAtual = null;
      if (Number.isFinite(resultado?.estoque)) usos = inteiroSeguro(resultado.estoque);
      notificarEstado();
      falha(resultado?.erro || 'consumo_recusado', { resultado });
      return { ok: false, motivo: resultado?.erro || 'consumo_recusado', resultado };
    }

    usos = inteiroSeguro(resultado.estoque);
    duracaoAtivaMs = resolverDuracao(contexto);
    estado = 'ativo';
    ativadoAte = agora() + duracaoAtivaMs;
    notificarEstado();

    if (typeof opcoes.onAtivar === 'function') {
      opcoes.onAtivar({
        geracao: geracaoLocal,
        chaveOperacao: chave,
        duracaoMs: duracaoAtivaMs,
        usos,
        duplicado: Boolean(resultado.duplicado)
      });
    }

    timer = agendar(() => {
      timer = null;
      if (geracaoLocal !== geracao) return;
      estado = 'inativo';
      chaveAtual = null;
      notificarEstado();
      if (typeof opcoes.onRestaurar === 'function') {
        opcoes.onRestaurar({ geracao: geracaoLocal, chaveOperacao: chave, motivo: 'concluido' });
      }
    }, duracaoAtivaMs);

    return {
      ok: true,
      duplicado: Boolean(resultado.duplicado),
      usos,
      chaveOperacao: chave
    };
  }

  /** Cancela revelação/consulta em andamento. O uso consumido NÃO é devolvido. */
  function cancelar(motivo = 'cancelado') {
    geracao += 1;
    const estavaAtiva = estado === 'ativo';
    limparTimer();
    estado = 'inativo';
    chaveAtual = null;
    ativadoAte = 0;
    notificarEstado();
    if (estavaAtiva && typeof opcoes.onRestaurar === 'function') {
      opcoes.onRestaurar({ geracao, chaveOperacao: null, motivo });
    }
    return { ok: true, motivo };
  }

  /** Atualiza o contador com o inventário real (compra, outro abas, restore). */
  function sincronizarUsos(valor) {
    usos = inteiroSeguro(valor);
    notificarEstado();
    return usos;
  }

  return {
    ativar,
    cancelar,
    sincronizarUsos,
    get estado() { return estado; },
    get usos() { return usos; },
    get ativa() { return estado === 'ativo'; },
    get ocupado() { return estado !== 'inativo'; },
    get geracao() { return geracao; },
    get chaveOperacao() { return chaveAtual; },
    get restanteMs() {
      return estado === 'ativo' ? Math.max(0, ativadoAte - agora()) : 0;
    },
    get duracaoMs() { return duracaoAtivaMs; }
  };
}
