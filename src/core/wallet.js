/**
 * wallet.js — Carteira virtual compartilhada (Arcade Collection Alpha)
 *
 * Regras obrigatórias:
 *  1. Nunca permitir saldo negativo.
 *  2. Impedir transações duplicadas (idempotência via idempotencyKey).
 *  3. Registrar todas as movimentações.
 *  4. Atualizações financeiras de forma atômica (uma única transação IndexedDB).
 *  5. Jogos NÃO manipulam saldo diretamente; solicitam via este serviço.
 *
 * A carteira é única e compartilhada por todos os jogos.
 *
 * Nota sobre IndexedDB: dentro de uma transação, as operações de store
 * retornam IDBRequest (que NÃO possui .then). Elas são envolvidas em
 * promises via eventos onsuccess/onerror para manter compatibilidade com
 * o IndexedDB real e com o mock de testes.
 */

import {
  put, get, getAll, getByIndex, transaction, count
} from './database.js';

const WALLET_DEFAULT_ID = 1;

/**
 * Envolve um IDBRequest em uma Promise, resolvendo em onsuccess e
 * rejeitando em onerror.
 */
function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Requisição IndexedDB falhou'));
  });
}

/**
 * Retorna o registro da carteira (cria um com saldo zero se não existir).
 * @returns {Promise<{id, saldo, totalConquistado, totalGasto, atualizadoEm}>}
 */
async function getWallet() {
  let wallet = await get('wallet', WALLET_DEFAULT_ID);
  if (!wallet) {
    wallet = {
      saldo: 0,
      totalConquistado: 0,
      totalGasto: 0,
      atualizadoEm: Date.now()
    };
    const id = await put('wallet', wallet);
    wallet.id = id;
  }
  return wallet;
}

/**
 * Consulta o saldo atual.
 * @returns {Promise<number>}
 */
async function getSaldo() {
  const wallet = await getWallet();
  return wallet.saldo;
}

/**
 * Consulta o saldo e totais (conquistado / gasto).
 * @returns {Promise<{saldo, totalConquistado, totalGasto, id}>}
 */
async function getEstado() {
  const wallet = await getWallet();
  return {
    id: wallet.id,
    saldo: wallet.saldo,
    totalConquistado: wallet.totalConquistado,
    totalGasto: wallet.totalGasto
  };
}

/**
 * Adiciona moedas à carteira (crédito).
 * Operação atômica: atualiza saldo + totalConquistado e registra transação.
 *
 * @param {number} quantidade - moedas a adicionar (deve ser > 0)
 * @param {object} meta - { origem, descricao, jogo, idempotencyKey? }
 * @returns {Promise<{ok, saldo, transacao}>}
 */
async function addCoins(quantidade, meta = {}) {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { ok: false, erro: 'quantidade_invalida', saldo: await getSaldo() };
  }

  const idempotencyKey = meta.idempotencyKey || gerarIdempotencyKey('credit', meta);

  // Impedir transações duplicadas
  const existente = await getByIndex('transactions', 'idempotencyKey', idempotencyKey);
  if (existente && existente.length > 0) {
    const wallet = await getWallet();
    return { ok: false, erro: 'duplicado', saldo: wallet.saldo, transacao: existente[0] };
  }

  const agora = Date.now();
  const transacao = {
    walletId: WALLET_DEFAULT_ID,
    tipo: 'credito',
    quantidade,
    saldoAnterior: 0,
    saldoPosterior: 0,
    origem: meta.origem || 'sistema',
    descricao: meta.descricao || 'Crédito de moedas',
    jogo: meta.jogo || null,
    idempotencyKey,
    criadoEm: agora
  };

  return transaction(['wallet', 'transactions'], 'readwrite', (tx) => {
    const walletStore = tx.objectStore('wallet');
    const txStore = tx.objectStore('transactions');

    return new Promise((resolve, reject) => {
      const getReq = walletStore.get(WALLET_DEFAULT_ID);
      getReq.onsuccess = () => {
        const wallet = getReq.result;
        if (!wallet) {
          reject(new Error('Carteira não encontrada'));
          return;
        }

        const saldoAnterior = wallet.saldo;
        const saldoPosterior = saldoAnterior + quantidade;

        wallet.saldo = saldoPosterior;
        wallet.totalConquistado = (wallet.totalConquistado || 0) + quantidade;
        wallet.atualizadoEm = agora;

        transacao.saldoAnterior = saldoAnterior;
        transacao.saldoPosterior = saldoPosterior;

        // Atualiza carteira e insere transação na mesma transação
        const putReq = walletStore.put(wallet);
        putReq.onsuccess = () => {
          const addReq = txStore.add(transacao);
          addReq.onsuccess = () => {
            resolve({
              ok: true,
              saldo: saldoPosterior,
              transacao
            });
          };
          addReq.onerror = () => reject(addReq.error || new Error('Falha ao registrar transação'));
        };
        putReq.onerror = () => reject(putReq.error || new Error('Falha ao atualizar carteira'));
      };
      getReq.onerror = () => reject(getReq.error || new Error('Falha ao ler carteira'));
    });
  });
}

/**
 * Debita moedas da carteira (débito).
 * Recusa se houver saldo insuficiente (nunca permite saldo negativo).
 *
 * @param {number} quantidade - moedas a debitar (deve ser > 0)
 * @param {object} meta - { origem, descricao, jogo, idempotencyKey? }
 * @returns {Promise<{ok, saldo, transacao} | {ok:false, erro, saldo}>}
 */
async function debitCoins(quantidade, meta = {}) {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { ok: false, erro: 'quantidade_invalida', saldo: await getSaldo() };
  }

  const idempotencyKey = meta.idempotencyKey || gerarIdempotencyKey('debit', meta);

  // Impedir transações duplicadas
  const existente = await getByIndex('transactions', 'idempotencyKey', idempotencyKey);
  if (existente && existente.length > 0) {
    const wallet = await getWallet();
    return { ok: false, erro: 'duplicado', saldo: wallet.saldo, transacao: existente[0] };
  }

  const agora = Date.now();
  const transacao = {
    walletId: WALLET_DEFAULT_ID,
    tipo: 'debito',
    quantidade,
    saldoAnterior: 0,
    saldoPosterior: 0,
    origem: meta.origem || 'sistema',
    descricao: meta.descricao || 'Débito de moedas',
    jogo: meta.jogo || null,
    idempotencyKey,
    criadoEm: agora
  };

  return transaction(['wallet', 'transactions'], 'readwrite', (tx) => {
    const walletStore = tx.objectStore('wallet');
    const txStore = tx.objectStore('transactions');

    return new Promise((resolve, reject) => {
      const getReq = walletStore.get(WALLET_DEFAULT_ID);
      getReq.onsuccess = () => {
        const wallet = getReq.result;
        if (!wallet) {
          reject(new Error('Carteira não encontrada'));
          return;
        }

        const saldoAnterior = wallet.saldo;

        // Regra obrigatória: nunca permitir saldo negativo
        if (saldoAnterior < quantidade) {
          resolve({ ok: false, erro: 'saldo_insuficiente', saldo: saldoAnterior });
          return;
        }

        const saldoPosterior = saldoAnterior - quantidade;

        wallet.saldo = saldoPosterior;
        wallet.totalGasto = (wallet.totalGasto || 0) + quantidade;
        wallet.atualizadoEm = agora;

        transacao.saldoAnterior = saldoAnterior;
        transacao.saldoPosterior = saldoPosterior;

        const putReq = walletStore.put(wallet);
        putReq.onsuccess = () => {
          const addReq = txStore.add(transacao);
          addReq.onsuccess = () => {
            resolve({
              ok: true,
              saldo: saldoPosterior,
              transacao
            });
          };
          addReq.onerror = () => reject(addReq.error || new Error('Falha ao registrar transação'));
        };
        putReq.onerror = () => reject(putReq.error || new Error('Falha ao atualizar carteira'));
      };
      getReq.onerror = () => reject(getReq.error || new Error('Falha ao ler carteira'));
    });
  });
}

/**
 * Registra uma transação genérica (para histórico de apostas/prêmios).
 * Usada pelos jogos para informar o resultado financeiro sem duplicar.
 *
 * @param {object} transacao
 * @returns {Promise<{ok, saldo, transacao}>}
 */
async function registrarTransacao(transacao) {
  const agora = Date.now();
  const registro = {
    walletId: WALLET_DEFAULT_ID,
    tipo: transacao.tipo || 'outro',
    quantidade: transacao.quantidade || 0,
    saldoAnterior: transacao.saldoAnterior || 0,
    saldoPosterior: transacao.saldoPosterior || 0,
    origem: transacao.origem || 'jogo',
    descricao: transacao.descricao || '',
    jogo: transacao.jogo || null,
    idempotencyKey: transacao.idempotencyKey || gerarIdempotencyKey('tx', transacao),
    criadoEm: transacao.criadoEm || agora
  };

  // Checa duplicado
  const existente = await getByIndex('transactions', 'idempotencyKey', registro.idempotencyKey);
  if (existente && existente.length > 0) {
    return { ok: false, erro: 'duplicado', transacao: existente[0] };
  }

  return transaction(['wallet', 'transactions'], 'readwrite', (tx) => {
    const txStore = tx.objectStore('transactions');

    return new Promise((resolve, reject) => {
      const addReq = txStore.add(registro);
      addReq.onsuccess = () => {
        resolve({
          ok: true,
          saldo: transacao.saldoPosterior || 0,
          transacao: registro
        });
      };
      addReq.onerror = () => reject(addReq.error || new Error('Falha ao registrar transação'));
    });
  });
}

/**
 * Histórico de movimentações (mais recentes primeiro).
 * @param {number} limite
 * @returns {Promise<Array>}
 */
async function getHistorico(limite = 50) {
  const todas = await getAll('transactions');
  todas.sort((a, b) => b.criadoEm - a.criadoEm);
  return todas.slice(0, limite);
}

/**
 * Conta total de transações.
 */
async function contarTransacoes() {
  return count('transactions');
}

/**
 * Gera uma chave de idempotência determinística a partir dos dados.
 */
function gerarIdempotencyKey(tipo, meta) {
  const base = `${tipo}:${meta.origem || ''}:${meta.descricao || ''}:${meta.jogo || ''}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `idp_${Math.abs(hash)}_${Date.now()}`;
}

/**
 * Valida uma recompensa antes de creditá-la (usada pelos jogos).
 * Retorna { valido, motivo }.
 */
function validarRecompensa(quantidade, origem) {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { valido: false, motivo: 'quantidade_invalida' };
  }
  if (!origem || typeof origem !== 'string') {
    return { valido: false, motivo: 'origem_obrigatoria' };
  }
  return { valido: true };
}

export {
  getWallet,
  getSaldo,
  getEstado,
  addCoins,
  debitCoins,
  registrarTransacao,
  getHistorico,
  contarTransacoes,
  validarRecompensa,
  WALLET_DEFAULT_ID
};
