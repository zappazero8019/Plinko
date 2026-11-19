/**
 * migrations.js — Controle de versão e migrações do banco de dados
 *
 * O banco inicia na versão 1. A versão 2 acrescenta a store `selfies` para
 * armazenar as Cartas Selfie do Card Match. A versão 3 acrescenta as stores
 * isoladas da economia do Memory Quest (`mqWallet`, `mqTransactions` e
 * `mqSessions`), sem tocar na carteira/histórico legados do Plinko.
 *
 * A versão 4 corrige exclusivamente o índice de `mqTransactions`: `sessionId`
 * deixa de ser único, pois uma vitória legítima no Modo Tentativas grava duas
 * linhas (pares + bônus) com o mesmo `sessionId`. A idempotência continua
 * garantida pelo índice único de `mqSessions.sessionId`.
 *
 * Todas as migrações são aditivas: nenhuma store existente é recriada, limpa
 * ou apagada, e o seed inicial só roda em bancos realmente novos (oldVersion < 1).
 * As versões vivem aqui para evitar números divergentes.
 */

const DB_VERSION_ATUAL = 4;

/**
 * Migrações executadas dentro da transação de mudança de versão.
 * A assinatura recebe o database, a transação ativa e a versão anterior.
 * @type {Array<{versao: number, executar: (IDBDatabase, IDBTransaction, number) => void}>}
 */
const MIGRACOES = [
  {
    versao: 4,
    executar(database, tx, oldVersion) {
      if (oldVersion >= 4) return;
      if (!database.objectStoreNames.contains('mqTransactions')) return;

      const store = tx.objectStore('mqTransactions');

      // IndexedDB não permite alterar `unique` de um índice existente: é
      // necessário removê-lo e recriá-lo dentro da mesma transação de upgrade.
      if (store.indexNames.contains('sessionId')) {
        store.deleteIndex('sessionId');
      }
      store.createIndex('sessionId', 'sessionId', { unique: false });

      // Um único registro por origem dentro da mesma partida: permite
      // `pares` + `bonus_tentativas` juntos, mas bloqueia duplicação da mesma
      // origem. Não substitui a trava de idempotência em `mqSessions`.
      if (!store.indexNames.contains('sessionIdTipo')) {
        store.createIndex('sessionIdTipo', ['sessionId', 'tipo'], { unique: true });
      }
    }
  }
];

/**
 * Aplica migrações pendentes (chamado dentro de onupgradeneeded).
 * @param {IDBDatabase} database
 * @param {IDBTransaction} tx - transação de mudança de versão já ativa
 * @param {number} oldVersion
 */
function aplicarMigracoes(database, tx, oldVersion) {
  for (const migracao of MIGRACOES) {
    if (migracao.versao > oldVersion && migracao.versao <= DB_VERSION_ATUAL) {
      migracao.executar(database, tx, oldVersion);
    }
  }
}

/**
 * Versão atual do esquema.
 */
function versaoAtual() {
  return DB_VERSION_ATUAL;
}

export { DB_VERSION_ATUAL, MIGRACOES, aplicarMigracoes, versaoAtual };
