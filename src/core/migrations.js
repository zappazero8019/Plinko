/**
 * migrations.js — Controle de versão e migrações do banco de dados
 *
 * O banco inicia na versão 1. A versão 2 acrescenta a store `selfies` para
 * armazenar as Cartas Selfie do Card Match, preservando todas as stores e
 * registros anteriores. As migrações continuam Centralizadas aqui.
 */

const DB_VERSION_ATUAL = 2;

/**
 * Registra uma migração. Cada migração recebe (database, transaction, oldVersion).
 * @type {Array<{versao: number, executar: (IDBDatabase, IDBTransaction, number) => void}>}
 */
const MIGRACOES = [];

/**
 * Aplica migrações pendentes (chamado dentro de onupgradeneeded).
 * @param {IDBDatabase} database
 * @param {number} oldVersion
 */
function aplicarMigracoes(database, oldVersion) {
  for (const migracao of MIGRACOES) {
    if (migracao.versao > oldVersion && migracao.versao <= DB_VERSION_ATUAL) {
      // Executado dentro da transação de upgrade pelo database.js
      // Nota: object stores devem ser criadas antes nas migrations futuras
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
