/**
 * database.js — Camada de acesso ao IndexedDB (Arcade Collection Alpha)
 *
 * Responsabilidades:
 *  - Abrir e versionar o banco de dados IndexedDB
 *  - Gerenciar stores independentes: profile, wallet, transactions, games,
 *    matches, inventory, achievements, settings, metadata
 *  - Oferecer API de transações atômicas (promissória)
 *  - Controle de versão e migrações
 *  - Verificação de integridade e solicitação de persistência
 *
 * Nenhum jogo manipula o banco diretamente. Todos acessam via serviços (wallet,
 * shop, achievements, etc.) que usam este módulo.
 */

const DB_NAME = 'ArcadeCollection';
const DB_VERSION = 1;

const STORES = [
  'profile',
  'wallet',
  'transactions',
  'games',
  'matches',
  'inventory',
  'achievements',
  'settings',
  'metadata'
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
      setupStores(database);
      seedInitialData(database, event.oldVersion);
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
  });
}

/**
 * Dados iniciais (seed) executados na primeira criação ou migração.
 */
function seedInitialData(database, oldVersion) {
  const tx = database.transaction(STORES, 'readwrite');

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

  // Configurações padrão
  const settingsStore = tx.objectStore('settings');
  settingsStore.add({
    som: true,
    vibracao: true,
    dificuldadePlinko: 'normal',
    dificuldadeCartas: 'normal',
    cronometroCartas: false
  });
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
