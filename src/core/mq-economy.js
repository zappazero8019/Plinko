/**
 * core/mq-economy.js — Economia isolada do Memory Quest
 *
 * Esta camada é a ÚNICA responsável por calcular e creditar moedas, bônus e
 * pontuação do Memory Quest. Ela NÃO importa `wallet.js`, `transactions.js` nem
 * qualquer módulo do Plinko: saldo, histórico e chaves de idempotência vivem
 * nas stores `mqWallet`, `mqTransactions` e `mqSessions`.
 *
 * Regras puras (sem DOM e sem persistência): multiplicador por sequência,
 * moedas por pares, bônus de tentativas e pontuação P = B × Fd × Fe × Ft.
 */

import { get, getAll, transaction } from './database.js';

export const MQ_WALLET_ID = 1;

/** Moedas base por par efetivamente encontrado. */
export const MQ_MOEDAS_POR_PAR = Object.freeze({
  facil: 1,
  normal: 2,
  dificil: 3,
  muitodificil: 4,
  extremo: 5
});

/** Fator de dificuldade da pontuação. */
export const MQ_FATOR_DIFICULDADE = Object.freeze({
  facil: 1,
  normal: 1.25,
  dificil: 1.5,
  muitodificil: 1.75,
  extremo: 2
});

/**
 * Teto de bônus por dificuldade, validado por simulação:
 * `moedasBasePorPar × totalDePares × 2`.
 */
export const MQ_BONUS_MAX = Object.freeze({
  facil: 18,
  normal: 60,
  dificil: 144,
  muitodificil: 288,
  extremo: 500
});

export const MQ_MULTIPLICADOR_MAXIMO = 16;

export const MQ_TIPO_PAR = 'pares';
export const MQ_TIPO_BONUS = 'bonus_tentativas';
export const MQ_TIPO_BLOQUEIO = 'recompensa_bloqueada';

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

function inteiroSeguro(valor, fallback = 0, minimo = 0) {
  return Math.max(minimo, Math.floor(numeroSeguro(valor, fallback)));
}

/** Registros antigos sem inventário são lidos como estoque zero. */
function normalizarHabilidadesMQ(valor) {
  const objeto = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  return { visaoTotal: inteiroSeguro(objeto.visaoTotal) };
}

/** Observadores da carteira MQ: todas as exibições reagem ao mesmo evento. */
const observadoresCarteiraMQ = new Set();

export function registrarObservadorCarteiraMQ(callback) {
  if (typeof callback !== 'function') return () => {};
  observadoresCarteiraMQ.add(callback);
  return () => { observadoresCarteiraMQ.delete(callback); };
}

export function notificarCarteiraMQ() {
  for (const observador of [...observadoresCarteiraMQ]) {
    try {
      observador();
    } catch (err) {
      console.warn('[mq] Falha ao notificar observador da carteira:', err);
    }
  }
}

function limitar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

export function normalizarDificuldadeMQ(chave) {
  const normalizada = String(chave || 'normal');
  return MQ_MOEDAS_POR_PAR[normalizada] ? normalizada : 'normal';
}

/**
 * min(2^(sequencia - 1), 16). A sequência começa em 1 no primeiro par;
 * valores inválidos caem em x1 e o expoente é limitado antes do cálculo.
 */
export function multiplicadorSequencia(sequencia) {
  const posicao = inteiroSeguro(sequencia, 1, 1);
  if (posicao <= 1) return 1;
  return Math.min(2 ** Math.min(posicao - 1, 4), MQ_MULTIPLICADOR_MAXIMO);
}

/** Fe = 0,5 + 0,5 × (pares / tentativas), limitado a [0,5; 1]. */
export function calcularFatorEficiencia(paresEncontrados, tentativas) {
  const pares = inteiroSeguro(paresEncontrados);
  const total = Math.max(1, inteiroSeguro(tentativas, pares));
  return limitar(0.5 + 0.5 * (pares / total), 0.5, 1);
}

/** Ft = 1,25 − 0,25 × (tempo / alvo), limitado a [0,75; 1,25]. */
export function calcularFatorTempo(tempoSegundos, tempoAlvo) {
  const tempo = inteiroSeguro(tempoSegundos);
  const alvo = Math.max(1, inteiroSeguro(tempoAlvo, tempo || 1, 1));
  return limitar(1.25 - 0.25 * (tempo / alvo), 0.75, 1.25);
}

/** Moedas ganhas apenas com pares efetivamente encontrados. */
export function calcularMoedasPorPares({
  dificuldade,
  paresEncontrados,
  somaMultiplicadores,
  elegivel = true
} = {}) {
  if (!elegivel) return 0;
  const pares = inteiroSeguro(paresEncontrados);
  if (!pares) return 0;
  const somaInformada = numeroSeguro(somaMultiplicadores, pares);
  const soma = limitar(
    somaInformada > 0 ? somaInformada : pares,
    0,
    pares * MQ_MULTIPLICADOR_MAXIMO
  );
  return Math.round(MQ_MOEDAS_POR_PAR[normalizarDificuldadeMQ(dificuldade)] * soma);
}

/** Bônus exclusivo do Modo Tentativas, zerado em derrota/abandono/cheat. */
export function calcularBonusTentativas({
  dificuldade,
  elegivel = true,
  vitoria = false,
  modalidade = 'pontuacao',
  tentativasRestantes = 0,
  tentativasIniciais = 0
} = {}) {
  if (!elegivel || !vitoria || modalidade !== 'tentativas') return 0;
  const maximo = MQ_BONUS_MAX[normalizarDificuldadeMQ(dificuldade)];
  const inicial = Math.max(1, inteiroSeguro(tentativasIniciais, 1, 1));
  const restantes = limitar(inteiroSeguro(tentativasRestantes), 0, inicial);
  return Math.round(maximo * (restantes / inicial));
}

/**
 * P = B × Fd × Fe × Ft, onde B = 100 × soma dos multiplicadores dos pares.
 * Nunca devolve negativo, NaN, Infinity ou valor dominado apenas pela velocidade.
 */
export function calcularPontuacaoMQ({
  dificuldade,
  paresEncontrados,
  somaMultiplicadores,
  tentativas = 0,
  tempoSegundos = 0,
  tempoAlvo = 0,
  elegivel = true
} = {}) {
  if (!elegivel) return 0;
  const pares = inteiroSeguro(paresEncontrados);
  if (!pares) return 0;
  const somaInformada = numeroSeguro(somaMultiplicadores, pares);
  const soma = limitar(
    somaInformada > 0 ? somaInformada : pares,
    0,
    pares * MQ_MULTIPLICADOR_MAXIMO
  );
  const chave = normalizarDificuldadeMQ(dificuldade);
  const base = 100 * soma;
  const fd = MQ_FATOR_DIFICULDADE[chave];
  const fe = calcularFatorEficiencia(pares, tentativas);
  const ft = calcularFatorTempo(tempoSegundos, tempoAlvo);
  const pontos = base * fd * fe * ft;
  return Number.isFinite(pontos) ? Math.max(0, Math.round(pontos)) : 0;
}

/** Consolida todos os números de uma liquidação em valores seguros. */
export function calcularLiquidacaoMQ(dados = {}) {
  const dificuldade = normalizarDificuldadeMQ(dados.dificuldade);
  const modalidade = dados.modalidade === 'tentativas' ? 'tentativas' : 'pontuacao';
  const elegivel = dados.elegivel !== false;
  const vitoria = Boolean(dados.vitoria);
  const paresEncontrados = inteiroSeguro(dados.paresEncontrados);
  const somaMultiplicadores = limitar(
    numeroSeguro(dados.somaMultiplicadores, paresEncontrados),
    0,
    paresEncontrados * MQ_MULTIPLICADOR_MAXIMO
  );
  const tentativas = inteiroSeguro(dados.tentativas, paresEncontrados);
  const tempoSegundos = inteiroSeguro(dados.tempoSegundos);
  const tentativasIniciais = inteiroSeguro(dados.tentativasIniciais, 0);
  const tentativasRestantes = inteiroSeguro(dados.tentativasRestantes, 0);
  const moedasPares = calcularMoedasPorPares({
    dificuldade, paresEncontrados, somaMultiplicadores, elegivel
  });
  const bonus = calcularBonusTentativas({
    dificuldade,
    elegivel,
    vitoria,
    modalidade,
    tentativasRestantes,
    tentativasIniciais
  });
  const pontuacao = calcularPontuacaoMQ({
    dificuldade,
    paresEncontrados,
    somaMultiplicadores,
    tentativas,
    tempoSegundos,
    tempoAlvo: dados.tempoAlvo,
    elegivel
  });

  return {
    sessionId: String(dados.sessionId || ''),
    dificuldade,
    modalidade,
    vitoria,
    elegivel,
    motivoInelegibilidade: elegivel
      ? null
      : String(dados.motivoInelegibilidade || 'cheat').slice(0, 120),
    paresEncontrados,
    somaMultiplicadores,
    sequenciaFinal: inteiroSeguro(dados.sequenciaFinal),
    erros: inteiroSeguro(dados.erros),
    tentativas,
    tentativasIniciais,
    tentativasRestantes,
    tempoSegundos,
    fatores: {
      fd: MQ_FATOR_DIFICULDADE[dificuldade],
      fe: calcularFatorEficiencia(paresEncontrados, tentativas),
      ft: calcularFatorTempo(tempoSegundos, dados.tempoAlvo)
    },
    moedasPares,
    bonus,
    total: moedasPares + bonus,
    pontuacao,
    liquidadoEm: Date.now()
  };
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Requisição IndexedDB falhou'));
  });
}

export function estadoSeguro(registro) {
  return {
    id: MQ_WALLET_ID,
    saldo: inteiroSeguro(registro?.saldo),
    totalConquistado: inteiroSeguro(registro?.totalConquistado),
    totalLiquido: inteiroSeguro(registro?.totalLiquido),
    totalGasto: inteiroSeguro(registro?.totalGasto),
    habilidades: normalizarHabilidadesMQ(registro?.habilidades),
    atualizadoEm: inteiroSeguro(registro?.atualizadoEm)
  };
}

/** Estado da carteira isolada (nunca lê a carteira do Plinko). */
export async function obterEstadoMQ() {
  return estadoSeguro(await get('mqWallet', MQ_WALLET_ID));
}

/** Saldo disponível da carteira isolada. */
export async function obterSaldoMQ() {
  return (await obterEstadoMQ()).saldo;
}

/** Histórico recente, ordenado do mais novo para o mais antigo. */
export async function listarHistoricoMQ(limite = 50) {
  const registros = await getAll('mqTransactions');
  return registros
    .slice()
    .sort((a, b) => inteiroSeguro(b.createdAt) - inteiroSeguro(a.createdAt))
    .slice(0, Math.max(0, inteiroSeguro(limite, 50, 1)));
}

/**
 * Liquidação única e idempotente por sessão.
 *
 * A verificação da sessão e a atualização da carteira acontecem na MESMA
 * transação IndexedDB: callbacks atrasados, cliques repetidos, reinícios ou
 * navegação não podem creditar duas vezes. Somente `finalizarPartida()` chama
 * esta função; abandono e reinício sequer chegam aqui.
 */
export function liquidarSessaoMQ(dados = {}) {
  const liquidacao = calcularLiquidacaoMQ(dados);
  if (!liquidacao.sessionId) {
    return Promise.resolve({ ok: false, erro: 'session_id_invalido', saldo: 0 });
  }

  return transaction(
    ['mqWallet', 'mqTransactions', 'mqSessions'],
    'readwrite',
    (tx) => new Promise((resolve, reject) => {
      const carteiraStore = tx.objectStore('mqWallet');
      const sessoesStore = tx.objectStore('mqSessions');
      const historicoStore = tx.objectStore('mqTransactions');

      const leituraCarteira = requestPromise(carteiraStore.get(MQ_WALLET_ID));
      leituraCarteira.then((registro) => {
        const anterior = estadoSeguro(registro);
        const duplicata = requestPromise(
          sessoesStore.index('sessionId').getAll(liquidacao.sessionId)
        );
        duplicata.then((encontradas) => {
          if ((encontradas || []).length) {
            resolve({ ok: false, erro: 'duplicado', saldo: anterior.saldo, liquidacao });
            return;
          }

          const agora = Date.now();
          const proximo = {
            ...anterior,
            saldo: anterior.saldo + liquidacao.total,
            totalConquistado: anterior.totalConquistado + liquidacao.total,
            totalLiquido: anterior.totalLiquido + liquidacao.total,
            atualizadoEm: agora
          };
          const escritas = [requestPromise(carteiraStore.put(proximo))];

          if (liquidacao.moedasPares > 0) {
            escritas.push(requestPromise(historicoStore.add({
              walletId: MQ_WALLET_ID,
              sessionId: liquidacao.sessionId,
              tipo: MQ_TIPO_PAR,
              quantidade: liquidacao.moedasPares,
              saldoAnterior: anterior.saldo,
              saldoPosterior: proximo.saldo,
              descricao: `Memory Quest · ${liquidacao.paresEncontrados} par(es) · ${liquidacao.dificuldade}`,
              dificuldade: liquidacao.dificuldade,
              modalidade: liquidacao.modalidade,
              createdAt: agora
            })));
          }

          if (liquidacao.bonus > 0) {
            escritas.push(requestPromise(historicoStore.add({
              walletId: MQ_WALLET_ID,
              sessionId: liquidacao.sessionId,
              tipo: MQ_TIPO_BONUS,
              quantidade: liquidacao.bonus,
              saldoAnterior: anterior.saldo,
              saldoPosterior: proximo.saldo,
              descricao: `Bônus de tentativas · ${liquidacao.dificuldade}`,
              dificuldade: liquidacao.dificuldade,
              modalidade: liquidacao.modalidade,
              createdAt: agora
            })));
          }

          if (!liquidacao.elegivel || liquidacao.total === 0) {
            escritas.push(requestPromise(historicoStore.add({
              walletId: MQ_WALLET_ID,
              sessionId: liquidacao.sessionId,
              tipo: MQ_TIPO_BLOQUEIO,
              quantidade: 0,
              saldoAnterior: anterior.saldo,
              saldoPosterior: anterior.saldo,
              descricao: liquidacao.elegivel
                ? 'Sem recompensa: nenhum par elegível'
                : `Recompensas bloqueadas: CHEAT (${liquidacao.motivoInelegibilidade})`,
              dificuldade: liquidacao.dificuldade,
              modalidade: liquidacao.modalidade,
              createdAt: agora
            })));
          }

          escritas.push(requestPromise(sessoesStore.add({
            ...liquidacao,
            liquidadoEm: agora
          })));

          Promise.all(escritas).then(
            () => resolve({ ok: true, saldo: proximo.saldo, liquidacao }),
            reject
          );
        }, reject);
      }, reject);
    })
  ).then((resultado) => {
    if (resultado?.ok) notificarCarteiraMQ();
    return resultado;
  });
}
