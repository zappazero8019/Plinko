/**
 * database.js — Camada de acesso ao IndexedDB (Arcade Collection Alpha)
 *
 * Responsabilidades:
 *  - Abrir e versionar o banco de dados IndexedDB
 *  - Gerenciar stores independentes: profile, wallet, transactions, games,
 *    matches, inventory, achievements, settings, metadata, selfies
 *  - Oferecer API de transações atômicas (promissória)
 *  - Controle de versão e migrações
 *  - Verificação de integridade e solicitação de persistência
 *
 * Nenhum jogo manipula o banco diretamente. Todos acessam via serviços (wallet,
 * shop, achievements, etc.) que usam este módulo.
 */

import { DB_VERSION_ATUAL, aplicarMigracoes } from './migrations.js';

const DB_NAME = 'ArcadeCollection';

/**
 * v2 adiciona APENAS a store `selfies` (imagens locais do Card Match).
 * A migração é aditiva: nenhuma store existente é recriada, limpa ou apagada,
 * e o seed inicial só roda em bancos realmente novos (oldVersion < 1).
 * A versão única vive em migrations.js para evitar números divergentes.
 */
const DB_VERSION = DB_VERSION_ATUAL;

const STORES = [
  'profile',
  'wallet',
  'transactions',
  'games',
  'matches',
  'inventory',
  'achievements',
  'settings',
  'metadata',
  'selfies'
];

// Única instância da conexão (singleton)
let dbInstance = null;
let initPromise = null;

/**
 * Abre (ou cria) o banco IndexedDB. Garante inicialização única.
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve, reject) => {
    if (!indexedDB) {
      reject(new Error('IndexedDB não disponível neste navegador'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      initPromise = null;
      reject(new Error(`Erro ao abrir IndexedDB: ${request.error.message}`));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        // Forçar fechamento se outra aba atualizou a versão
        dbInstance.close();
        dbInstance = null;
        initPromise = null;
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const tx = event.target.transaction; // transação de versão já ativa
      setupStores(database);
      seedInitialData(database, tx, event.oldVersion);
      // Hook central das migrações (hoje vazio; a store v2 é criada acima).
      aplicarMigracoes(database, event.oldVersion ?? 0);
    };
  });

  return initPromise;
}

/**
 * Cria as stores (object stores) com índices apropriados.
 */
function setupStores(database) {
  STORES.forEach((storeName) => {
    if (database.objectStoreNames.contains(storeName)) {
      return;
    }
    const store = database.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });

    // Índices úteis por store
    if (storeName === 'transactions') {
      store.createIndex('walletId', 'walletId', { unique: false });
      store.createIndex('createdAt', 'createdAt', { unique: false });
      store.createIndex('type', 'type', { unique: false });
      store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
    }
    if (storeName === 'wallet') {
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
    if (storeName === 'matches') {
      store.createIndex('gameId', 'gameId', { unique: false });
      store.createIndex('playedAt', 'playedAt', { unique: false });
    }
    if (storeName === 'achievements') {
      store.createIndex('unlockedAt', 'unlockedAt', { unique: false });
      store.createIndex('code', 'code', { unique: true });
    }
    if (storeName === 'inventory') {
      store.createIndex('itemId', 'itemId', { unique: false });
      store.createIndex('acquiredAt', 'acquiredAt', { unique: false });
    }
    if (storeName === 'selfies') {
      store.createIndex('createdAt', 'createdAt', { unique: false });
      store.createIndex('ativa', 'ativa', { unique: false });
    }
  });
}

/**
 * Dados iniciais (seed) executados SOMENTE na primeira criação do banco.
 *
 * Antes da v2 esta função era incondicional, o que duplicaria perfil, carteira,
 * metadata e settings a cada aumento de versão. A proteção por `oldVersion`
 * é o que garante a regra "não apagar dados existentes" na migração para a
 * store de selfies.
 */
function seedInitialData(database, tx, oldVersion) {
  // tx é a transação de mudança de versão já ativa durante onupgradeneeded.
  // Não criar database.transaction() aqui: o IndexedDB proíbe iniciar
  // uma transação comum enquanto a version change transaction está em execução.
  void database;

  // Ambientes de teste/mocks podem omitir `oldVersion`. Nesse caso, a
  // abertura equivale à criação de um banco novo (versão anterior 0).
  const versaoAnterior = Number.isFinite(oldVersion) ? oldVersion : 0;

  if (versaoAnterior < 1) {
    // Perfil padrão
    const profileStore = tx.objectStore('profile');
    profileStore.add({
      nome: 'Jogador',
      idExterno: null,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      avatar: null,
      tema: 'retro'
    });

    // Carteira inicial com saldo zero
    const walletStore = tx.objectStore('wallet');
    walletStore.add({
      saldo: 0,
      totalConquistado: 0,
      totalGasto: 0,
      atualizadoEm: Date.now()
    });

    // Metadata do banco
    const metadataStore = tx.objectStore('metadata');
    metadataStore.add({
      versaoBanco: DB_VERSION,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      integridade: 'ok'
    });

    // Configurações padrão (campos novos entram pelo serviço de preferências,
    // sem exigir esquema fixo nem reescrita de registros antigos).
    const settingsStore = tx.objectStore('settings');
    settingsStore.add({
      som: true,
      vibracao: true,
      dificuldadePlinko: 'normal',
      dificuldadeCartas: 'normal',
      cronometroCartas: false
    });
  }

  if (versaoAnterior < 2) {
    // Atualiza apenas o número da versão no metadata já existente.
    const metadataStore = tx.objectStore('metadata');
    const consulta = metadataStore.getAll();
    consulta.onsuccess = () => {
      for (const atual of consulta.result || []) {
        metadataStore.put({
          ...atual,
          versaoBanco: DB_VERSION,
          atualizadoEm: Date.now()
        });
      }
    };
  }
}

/**
 * Executa uma operação dentro de uma transação IndexedDB.
 * @param {string[]|string} stores - nomes das stores envolvidas
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction) => void|Promise<void>} work
 * @returns {Promise<any>} resultado da promise retornada por work (se houver)
 */
function transaction(stores, mode, work) {
  return openDatabase().then((database) => {
    const storeList = Array.isArray(stores) ? stores : [stores];
    const tx = database.transaction(storeList, mode);

    return new Promise((resolve, reject) => {
      let workResult;

      tx.oncomplete = () => resolve(workResult);
      tx.onerror = () => reject(new Error(`Transação falhou: ${tx.error.message}`));
      tx.onabort = () => reject(new Error('Transação abortada'));

      try {
        workResult = work(tx);
      } catch (err) {
        tx.abort();
        reject(err);
      }

      // Se work retornou uma promise, esperá-la antes de completar
      if (workResult && typeof workResult.then === 'function') {
        Promise.resolve(workResult).then(() => {}, () => {});
      }
    });
  });
}

/**
 * Inserir ou atualizar um registro (upsert simples por id quando fornecido).
 */
function put(storeName, value) {
  return transaction(storeName, 'readwrite', (tx) => {
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`put falhou em ${storeName}`));
    });
  });
}

/**
 * Buscar registro por id. Resolve com o valor (ou undefined).
 */
function get(storeName, id) {
  return transaction(storeName, 'readonly', (tx) => {
    const request = tx.objectStore(storeName).get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`get falhou em ${storeName}`));
    });
  });
}

/**
 * Buscar todos os registros de uma store. Resolve com um array.
 */
function getAll(storeName) {
  return transaction(storeName, 'readonly', (tx) => {
    const request = tx.objectStore(storeName).getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`getAll falhou em ${storeName}`));
    });
  });
}

/**
 * Buscar registros por índice (IDBIndex). Resolve com um array.
 */
function getByIndex(storeName, indexName, value) {
  return transaction(storeName, 'readonly', (tx) => {
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(value);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`getByIndex falhou em ${storeName}`));
    });
  });
}

/**
 * Remover registro por id.
 */
function del(storeName, id) {
  return transaction(storeName, 'readwrite', (tx) => {
    const request = tx.objectStore(storeName).delete(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`del falhou em ${storeName}`));
    });
  });
}

/**
 * Limpar uma store inteira.
 */
function clear(storeName) {
  return transaction(storeName, 'readwrite', (tx) => {
    const request = tx.objectStore(storeName).clear();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`clear falhou em ${storeName}`));
    });
  });
}

/**
 * Contar registros de uma store. Resolve com um número.
 */
function count(storeName) {
  return transaction(storeName, 'readonly', (tx) => {
    const request = tx.objectStore(storeName).count();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`count falhou em ${storeName}`));
    });
  });
}

/**
 * Solicita armazenamento persistente ao navegador, quando disponível.
 */
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const persisted = await navigator.storage.persist();
      return !!persisted;
    } catch (err) {
      console.warn('[database] Persistência não pôde ser solicitada:', err.message);
      return false;
    }
  }
  return false;
}

/**
 * Verificação simples de integridade: confere se as stores existem e contam registros.
 */
async function verifyIntegrity() {
  const database = await openDatabase();
  const missing = STORES.filter((s) => !database.objectStoreNames.contains(s));
  const counts = {};
  for (const storeName of STORES) {
    counts[storeName] = await count(storeName);
  }
  return {
    ok: missing.length === 0,
    missing,
    counts,
    versao: DB_VERSION
  };
}

/**
 * Fecha a conexão do banco (útil em testes e desligamento).
 */
function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    initPromise = null;
  }
}

export {
  DB_NAME,
  DB_VERSION,
  STORES,
  openDatabase,
  transaction,
  put,
  get,
  getAll,
  getByIndex,
  del,
  clear,
  count,
  requestPersistentStorage,
  verifyIntegrity,
  closeDatabase
};
