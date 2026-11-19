/**
 * mq-shop.js — Loja de habilidades do Memory Quest (Fase 1)
 *
 * Usa EXCLUSIVAMENTE a carteira canônica `mqWallet` (id 1) e o histórico
 * `mqTransactions`. Nenhuma store do Plinko (`wallet`, `transactions`) é lida
 * ou escrita aqui, e nenhuma recompensa de partida é alterada.
 *
 * A única habilidade desta fase é "Visão total": cada compra debita 100 moedas
 * e acrescenta exatamente um uso ao inventário persistido no próprio registro
 * da carteira. Registros antigos sem `habilidades` são lidos como estoque zero.
 *
 * Idempotência: `mqTransactions.sessionIdTipo` já é único. A compra usa como
 * `sessionId` uma chave estável gerada pelo chamador UMA vez por intenção de
 * compra. Repetir a mesma chave devolve o resultado já registrado sem debitar;
 * compras distintas usam chaves distintas e são todas permitidas.
 */

import { get, transaction } from './database.js';
import {
  MQ_WALLET_ID,
  estadoSeguro,
  notificarCarteiraMQ
} from './mq-economy.js';

export const PRECO_VISAO_TOTAL = 100;
export const HABILIDADE_VISAO_TOTAL = 'visaoTotal';
export const MQ_TIPO_COMPRA_VISAO = 'compra_visao_total';

/** Nome/identificador estável do item vendido nesta fase. */
export const ITEM_VISAO_TOTAL = Object.freeze({
  id: HABILIDADE_VISAO_TOTAL,
  nome: 'Visão total',
  preco: PRECO_VISAO_TOTAL,
  descricao: 'Revela todas as cartas não combinadas por 3 segundos durante uma partida.',
  icone: 'assets/icons/visao.png'
});

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Requisição IndexedDB falhou'));
  });
}

/**
 * Gera a chave estável de uma intenção de compra. O chamador deve guardá-la e
 * reutilizá-la em retries técnicos da MESMA operação; um novo clique gera uma
 * chave nova, que é uma compra legítima distinta.
 */
export function criarChaveOperacaoCompra() {
  const cryptoApi = globalThis.crypto;
  const aleatorio = typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  return `${MQ_TIPO_COMPRA_VISAO}_${aleatorio}`;
}

/** Estoque atual de usos de Visão total. */
export async function obterInventarioMQ() {
  return estadoSeguro(await get('mqWallet', MQ_WALLET_ID)).habilidades.visaoTotal;
}

/**
 * Compra atômica de um uso de Visão total.
 *
 * @param {string} chaveOperacao chave estável da intenção de compra
 * @returns {Promise<{ok: boolean, erro?: string, duplicado?: boolean,
 *   saldo: number, estoque: number, transacaoId?: number}>}
 */
export function comprarVisaoTotal(chaveOperacao) {
  const chave = String(chaveOperacao || '').trim();
  if (!chave) {
    return Promise.resolve({ ok: false, erro: 'chave_invalida', saldo: 0, estoque: 0 });
  }

  return transaction(
    ['mqWallet', 'mqTransactions'],
    'readwrite',
    (tx) => new Promise((resolve, reject) => {
      const carteiraStore = tx.objectStore('mqWallet');
      const historicoStore = tx.objectStore('mqTransactions');

      const leituraDuplicata = requestPromise(
        historicoStore.index('sessionIdTipo').getAll([chave, MQ_TIPO_COMPRA_VISAO])
      );

      leituraDuplicata.then((encontradas) => {
        const registros = encontradas || [];
        if (registros.length) {
          // Retry da mesma operação: devolve o que já foi gravado, sem debitar.
          const anterior = registros[0];
          resolve({
            ok: true,
            duplicado: true,
            saldo: Number(anterior.saldoPosterior) || 0,
            estoque: Number(anterior.estoquePosterior) || 0,
            transacaoId: anterior.id
          });
          return;
        }

        const leituraCarteira = requestPromise(carteiraStore.get(MQ_WALLET_ID));
        leituraCarteira.then((registro) => {
          const anterior = estadoSeguro(registro);
          const estoque = anterior.habilidades.visaoTotal;

          if (anterior.saldo < PRECO_VISAO_TOTAL) {
            resolve({
              ok: false, erro: 'saldo_insuficiente',
              saldo: anterior.saldo, estoque
            });
            return;
          }

          const agora = Date.now();
          const proximo = {
            ...anterior,
            saldo: anterior.saldo - PRECO_VISAO_TOTAL,
            totalGasto: anterior.totalGasto + PRECO_VISAO_TOTAL,
            habilidades: {
              ...anterior.habilidades,
              [HABILIDADE_VISAO_TOTAL]: estoque + 1
            },
            atualizadoEm: agora
          };

          const escritas = [
            requestPromise(carteiraStore.put(proximo)),
            requestPromise(historicoStore.add({
              walletId: MQ_WALLET_ID,
              sessionId: chave,
              operacaoId: chave,
              tipo: MQ_TIPO_COMPRA_VISAO,
              quantidade: PRECO_VISAO_TOTAL,
              itemId: HABILIDADE_VISAO_TOTAL,
              estoqueAnterior: estoque,
              estoquePosterior: estoque + 1,
              saldoAnterior: anterior.saldo,
              saldoPosterior: proximo.saldo,
              descricao: 'Loja Memory Quest · Visão total (+1 uso)',
              createdAt: agora
            }))
          ];

          Promise.all(escritas).then(
            (resultados) => resolve({
              ok: true,
              duplicado: false,
              saldo: proximo.saldo,
              estoque: estoque + 1,
              transacaoId: resultados[1]
            }),
            (err) => {
              // Uma corrida entre abas pode violar o índice único: a transação
              // é abortada (inclusive o débito) e a operação é reconsultada na
              // próxima tentativa com a mesma chave.
              if (err?.name === 'ConstraintError') {
                resolve({ ok: true, duplicado: true, saldo: anterior.saldo, estoque });
                return;
              }
              reject(err);
            }
          );
        }, reject);
      }, reject);
    })
  ).then((resultado) => {
    if (resultado?.ok && !resultado.duplicado) notificarCarteiraMQ();
    return resultado;
  });
}
