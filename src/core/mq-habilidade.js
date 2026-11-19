/**
 * mq-habilidade.js — Consumo seguro de habilidades do Memory Quest (Fase 2)
 *
 * Este módulo NÃO altera a compra da Fase 1 (`mq-shop.js`). Ele apenas consome
 * usos já comprados, na mesma carteira canônica `mqWallet` (id 1).
 *
 * Cada ativação usa uma chave estável e distinta da chave de compra. O índice
 * único existente `mqTransactions.sessionIdTipo` garante que repetições
 * técnicas da mesma operação não debitem dois usos, inclusive entre abas.
 *
 * Nenhuma recompensa, tentativa, erro, par, pontuação ou cronômetro é tocado
 * aqui: somente `habilidades.visaoTotal` e o histórico da própria habilidade.
 */

import { get, getByIndex, transaction } from './database.js';
import {
  MQ_WALLET_ID,
  estadoSeguro,
  notificarCarteiraMQ
} from './mq-economy.js';

export const MQ_TIPO_USO_VISAO = 'uso_visao_total';
export const DURACAO_VISAO_TOTAL_MS = 3000;

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Requisição IndexedDB falhou'));
  });
}

/** Chave estável de UMA intenção de ativação; nunca reutiliza a chave de compra. */
export function criarChaveOperacaoVisaoTotal() {
  const cryptoApi = globalThis.crypto;
  const aleatorio = typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  return `${MQ_TIPO_USO_VISAO}_${aleatorio}`;
}

/** Usos disponíveis, lidos diretamente do inventário persistido. */
export async function obterUsosVisaoTotal() {
  return estadoSeguro(await get('mqWallet', MQ_WALLET_ID)).habilidades.visaoTotal;
}

/**
 * Consome exatamente um uso de Visão total.
 *
 * @param {string} chaveOperacao chave estável gerada uma vez por ativação
 * @returns {Promise<{ok: boolean, erro?: string, duplicado?: boolean,
 *   saldo: number, estoque: number, transacaoId?: number}>}
 */
// Serializa operações com a MESMA chave dentro da aba. O índice único cobre
// corridas entre abas; esta fila cobre cliques duplos/processamento assíncrono
// sem deixar duas transações concorrentes lendo o mesmo estoque.
const operacoesEmAndamento = new Map();

export function consumirUsoVisaoTotal(chaveOperacao) {
  const chave = String(chaveOperacao || '').trim();
  if (!chave) {
    return Promise.resolve({ ok: false, erro: 'chave_invalida', saldo: 0, estoque: 0 });
  }

  const pendente = operacoesEmAndamento.get(chave);
  if (pendente) {
    // A primeira operação já possui a chave; ao terminar, a leitura encontra
    // o registro e devolve o resultado original sem debitar novamente.
    return pendente.then(() => executarConsumo(chave));
  }

  const operacao = executarConsumo(chave);
  const rastreada = operacao.finally(() => {
    if (operacoesEmAndamento.get(chave) === rastreada) {
      operacoesEmAndamento.delete(chave);
    }
  });
  operacoesEmAndamento.set(chave, rastreada);
  return rastreada;
}

function executarConsumo(chave) {
  return transaction(
    ['mqWallet', 'mqTransactions'],
    'readwrite',
    (tx) => new Promise((resolve, reject) => {
      const carteiraStore = tx.objectStore('mqWallet');
      const historicoStore = tx.objectStore('mqTransactions');

      const leituraDuplicata = requestPromise(
        historicoStore.index('sessionIdTipo').getAll([chave, MQ_TIPO_USO_VISAO])
      );

      leituraDuplicata.then((encontradas) => {
        const registros = encontradas || [];
        if (registros.length) {
          // Retry técnico da mesma operação: a ativação já foi paga. Devolve o
          // estoque registrado na primeira execução, sem consumir novamente.
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

          if (estoque < 1) {
            resolve({
              ok: false, erro: 'estoque_insuficiente',
              saldo: anterior.saldo, estoque
            });
            return;
          }

          const agora = Date.now();
          const proximo = {
            ...anterior,
            habilidades: {
              ...anterior.habilidades,
              visaoTotal: estoque - 1
            },
            atualizadoEm: agora
          };

          const escritas = [
            requestPromise(carteiraStore.put(proximo)),
            requestPromise(historicoStore.add({
              walletId: MQ_WALLET_ID,
              sessionId: chave,
              operacaoId: chave,
              tipo: MQ_TIPO_USO_VISAO,
              quantidade: 1,
              itemId: 'visaoTotal',
              estoqueAnterior: estoque,
              estoquePosterior: estoque - 1,
              saldoAnterior: anterior.saldo,
              saldoPosterior: proximo.saldo,
              descricao: 'Memory Quest · Visão total (-1 uso)',
              createdAt: agora
            }))
          ];

          Promise.all(escritas).then(
            (resultados) => resolve({
              ok: true,
              duplicado: false,
              saldo: proximo.saldo,
              estoque: estoque - 1,
              transacaoId: resultados[1]
            }),
            (err) => {
              // Concorrência entre abas com a mesma chave: o índice único aborta
              // a transação inteira, inclusive a escrita da carteira.
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
  )
    .catch(async (erro) => {
      // A camada de transação envolve o erro em `Error` e preserva apenas a
      // mensagem, por isso o nome também é verificado no texto.
      const éConcorrencia = erro?.name === 'ConstraintError'
        || String(erro?.message || '').includes('ConstraintError');
      if (!éConcorrencia) throw erro;

      // Outra aba/operador gravou a mesma chave no intervalo entre a leitura
      // de duplicidade e o `add`. A transação foi abortada por completo; a
      // consulta abaixo confirma o registro vencedor sem debitar novamente.
      const registradas = await getByIndex(
        'mqTransactions',
        'sessionIdTipo',
        [chave, MQ_TIPO_USO_VISAO]
      );
      const anterior = registradas?.[0];
      if (!anterior) throw erro;
      return {
        ok: true,
        duplicado: true,
        saldo: Number(anterior.saldoPosterior) || 0,
        estoque: Number(anterior.estoquePosterior) || 0,
        transacaoId: anterior.id
      };
    })
    .then((resultado) => {
      if (resultado?.ok && !resultado.duplicado) notificarCarteiraMQ();
      return resultado;
    });
}
