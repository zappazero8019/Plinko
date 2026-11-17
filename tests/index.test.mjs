/**
 * tests/index.test.mjs — Suíte de testes automatizados da Alpha (Arcade Collection)
 *
 * Execução: node tests/index.test.mjs
 * Não requer dependências externas. Inclui um mock de IndexedDB em memória
 * para exercitar database.js, wallet.js, transactions.js e backup.js sem
 * depender do navegador.
 *
 * Suíte cobre: banco, carteira, transações, recompensas, dificuldades e backup.
 */

import assert from 'node:assert/strict';

// ============================================================================
// MOCK DE INDEXEDDB EM MEMÓRIA
// ============================================================================

class IDBRequest {
  constructor() {
    this.readyState = 'pending';
    this.result = undefined;
    this.error = undefined;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
  _resolve(result) {
    this.readyState = 'done';
    this.result = result;
    if (this.onsuccess) this.onsuccess({ target: this });
  }
  _reject(err) {
    this.readyState = 'done';
    this.error = err;
    if (this.onerror) this.onerror({ target: this, error: err });
    else throw err;
  }
}

class IDBIndex {
  constructor(store, indexName, keyPath, unique) {
    this.store = store;
    this.indexName = indexName;
    this.keyPath = keyPath;
    this.unique = unique;
  }
  getAll(value) {
    const req = new IDBRequest();
    setTimeout(() => {
      if (value === undefined) {
        req._resolve(this.store._indexValues(this.indexName));
      } else {
        req._resolve(this.store._indexValues(this.indexName).filter((v) => v[this.keyPath] === value));
      }
    }, 0);
    return req;
  }
}

class IDBObjectStore {
  constructor(name, { keyPath = 'id', autoIncrement = false } = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this._data = new Map(); // id -> objeto
    this._nextId = 1;
    this._indexes = new Map(); // indexName -> IDBIndex
  }
  _indexValues(indexName) {
    const idx = this._indexes.get(indexName);
    if (!idx) return [];
    const out = [];
    for (const obj of this._data.values()) {
      const key = obj[idx.keyPath];
      if (key !== undefined) out.push({ ...obj, [idx.keyPath]: key });
    }
    return out;
  }
  _resolveKey(value) {
    if (this.keyPath && value[this.keyPath] !== undefined) return value[this.keyPath];
    if (this.autoIncrement) return this._nextId++;
    return undefined;
  }
  add(value) {
    const req = new IDBRequest();
    setTimeout(() => {
      const key = this._resolveKey(value);
      if (key !== undefined && this._data.has(key)) {
        req._reject(new Error('Duplicate key'));
        return;
      }
      if (key !== undefined) value[this.keyPath] = key;
      this._data.set(key, value);
      req._resolve(key);
    }, 0);
    return req;
  }
  put(value) {
    const req = new IDBRequest();
    setTimeout(() => {
      const key = this._resolveKey(value);
      if (key !== undefined) value[this.keyPath] = key;
      this._data.set(key, value);
      req._resolve(key);
    }, 0);
    return req;
  }
  get(key) {
    const req = new IDBRequest();
    setTimeout(() => {
      req._resolve(this._data.get(key));
    }, 0);
    return req;
  }
  getAll() {
    const req = new IDBRequest();
    setTimeout(() => {
      req._resolve(Array.from(this._data.values()));
    }, 0);
    return req;
  }
  clear() {
    const req = new IDBRequest();
    setTimeout(() => {
      this._data.clear();
      this._nextId = 1;
      req._resolve(undefined);
    }, 0);
    return req;
  }
  delete(key) {
    const req = new IDBRequest();
    setTimeout(() => {
      this._data.delete(key);
      req._resolve(undefined);
    }, 0);
    return req;
  }
  count() {
    const req = new IDBRequest();
    setTimeout(() => {
      req._resolve(this._data.size);
    }, 0);
    return req;
  }
  createIndex(name, keyPath, options = {}) {
    this._indexes.set(name, new IDBIndex(this, name, keyPath, options.unique));
    return this._indexes.get(name);
  }
  index(name) {
    return this._indexes.get(name);
  }
}

class IDBTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
    this._stores = new Map();
    for (const name of storeNames) {
      this._stores.set(name, db._stores.get(name));
    }
    this._completed = false;
    this._aborted = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = undefined;
    // Completa a transação após um pequeno atraso para permitir que as
    // operações assíncronas das stores (setTimeout 0) sejam processadas primeiro.
    setTimeout(() => this._complete(), 50);
  }
  objectStore(name) {
    if (this._aborted) throw new Error('Transaction aborted');
    return this._stores.get(name);
  }
  abort() {
    this._aborted = true;
    if (this.onabort) this.onabort();
  }
  _complete() {
    if (this._completed || this._aborted) return;
    this._completed = true;
    if (this.oncomplete) this.oncomplete();
  }
}

class IDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = {
      _list: new Set(),
      contains(n) { return this._list.has(n); }
    };
    this._stores = new Map();
    this.onversionchange = null;
  }
  createObjectStore(name, options = {}) {
    if (this._stores.has(name)) {
      throw new Error('Already exists');
    }
    const store = new IDBObjectStore(name, options);
    this._stores.set(name, store);
    this.objectStoreNames._list.add(name);
    return store;
  }
  transaction(storeNames, mode) {
    const tx = new IDBTransaction(this, storeNames, mode);
    // Completa assincronamente para permitir cadeia de operações
    setTimeout(() => tx._complete(), 0);
    return tx;
  }
  close() {
    // no-op no mock
  }
}

const MOCK_DBS = new Map();

function mockIndexedDBOpen(name, version) {
  const req = new IDBRequest();
  setTimeout(() => {
    let db = MOCK_DBS.get(name);
    const isNew = !db;
    if (isNew) {
      db = new IDBDatabase(name, version);
      MOCK_DBS.set(name, db);
    }
    // Define result antes de disparar onupgradeneeded (o handler acessa request.result)
    req.result = db;
    // Se versão aumentou (ou novo) e houver onupgradeneeded
    if (isNew || version > db.version) {
      db.version = version;
      req.onupgradeneeded && req.onupgradeneeded({
        target: req,
        result: db
      });
    }
    req._resolve(db);
  }, 0);
  return req;
}

const mockIndexedDB = {
  open: mockIndexedDBOpen,
  deleteDatabase(name) {
    MOCK_DBS.delete(name);
    const req = new IDBRequest();
    setTimeout(() => {
      req.result = undefined;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
};

// Instala o mock antes de importar os módulos que usam indexedDB
globalThis.indexedDB = mockIndexedDB;
globalThis.IDBDatabase = IDBDatabase;

// ============================================================================
// IMPORTS DOS MÓDULOS (depois do mock)
// ============================================================================

import { openDatabase, transaction, put, get, getAll, getByIndex, del, clear, count, verifyIntegrity, closeDatabase, STORES, DB_VERSION } from '../src/core/database.js';
import {
  getSaldo, getEstado, addCoins, debitCoins, registrarTransacao, getHistorico, contarTransacoes, validarRecompensa, WALLET_DEFAULT_ID
} from '../src/core/wallet.js';
import { resumoFinanceiro, detectarDuplicatas, validarConsistencia } from '../src/core/transactions.js';
import { exportarProgresso, validarEstrutura, importarProgresso, FORMATO_VERSION } from '../src/core/backup.js';
import { DIFICULDADES_PLINKO, getDificuldadePlinko } from '../src/games/plinko/difficulty.js';
import { DIFICULDADES_CARTAS_EXPANDIDO, getDificuldadeCartas } from '../src/games/cards/difficulty.js';
import { calcularPremio } from '../src/games/plinko/rewards.js';
import { World, createPin, createWall, createBall, Vec } from '../src/games/plinko/physics.js';

// ============================================================================
// CONTADORES DE TESTES
// ============================================================================

let passed = 0;
let failed = 0;

function test(nome, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    process.stdout.write(`  ✓ ${nome}\n`);
  }).catch((err) => {
    failed++;
    process.stdout.write(`  ✗ ${nome}: ${err.message}\n`);
  });
}

async function grupo(nome, fn) {
  process.stdout.write(`\n📦 ${nome}\n`);
  await fn();
}

// ============================================================================
// TESTES
// ============================================================================

async function resetDB() {
  closeDatabase();
  mockIndexedDB.deleteDatabase('ArcadeCollection');
}

async function grupoBanco() {
  await grupo('Banco de dados (IndexedDB)', async () => {
    await test('abre o banco e cria as stores', async () => {
      await resetDB();
      const db = await openDatabase();
      assert.ok(db);
      assert.strictEqual(db.version, DB_VERSION);
      for (const store of STORES) {
        assert.ok(db.objectStoreNames.contains(store), `store ${store} ausente`);
      }
    });

    await test('put e get de registro', async () => {
      const id = await put('settings', { chave: 'som', valor: true });
      assert.ok(Number.isInteger(id));
      const reg = await get('settings', id);
      assert.ok(reg);
      assert.strictEqual(reg.chave, 'som');
    });

    await test('getAll retorna todos os registros', async () => {
      await put('settings', { chave: 'a', valor: 1 });
      await put('settings', { chave: 'b', valor: 2 });
      const todos = await getAll('settings');
      assert.ok(todos.length >= 2);
    });

    await test('getByIndex filtra por índice', async () => {
      // transactions tem índice por 'type' (veja setupStores)
      await put('transactions', { type: 'credito', quantidade: 10, criadoEm: Date.now() });
      await put('transactions', { type: 'debito', quantidade: 5, criadoEm: Date.now() });
      const creditos = await getByIndex('transactions', 'type', 'credito');
      assert.ok(creditos.length >= 1);
      assert.ok(creditos.every((t) => t.type === 'credito'));
    });

    await test('count conta registros', async () => {
      const n = await count('settings');
      assert.ok(Number.isInteger(n) && n >= 2);
    });

    await test('del remove registro', async () => {
      const id = await put('settings', { chave: 'temp', valor: true });
      await del('settings', id);
      const reg = await get('settings', id);
      assert.strictEqual(reg, undefined);
    });

    await test('clear limpa store', async () => {
      await clear('settings');
      const todos = await getAll('settings');
      assert.strictEqual(todos.length, 0);
    });

    await test('verifyIntegrity retorna ok', async () => {
      const integridade = await verifyIntegrity();
      assert.ok(integridade.ok);
      assert.ok(integridade.counts);
    });

    await test('transação atômica falha e aborta', async () => {
      let erro = null;
      try {
        await transaction(['settings'], 'readwrite', (tx) => {
          const store = tx.objectStore('settings');
          return store.put({ chave: 'atomico', valor: 1 }).then(() => {
            throw new Error('forçar aborto');
          });
        });
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, 'esperava erro por aborto');
    });

    await test('closeDatabase fecha conexão', async () => {
      closeDatabase();
      // Reabrir deve funcionar
      const db = await openDatabase();
      assert.ok(db);
    });
  });
}

async function grupoCarteira() {
  await grupo('Carteira virtual (wallet)', async () => {
    await resetDB();
    // Limpa carteira e transactions para teste isolado
    await clear('wallet');
    await clear('transactions');

    await test('saldo inicial é zero', async () => {
      const saldo = await getSaldo();
      assert.strictEqual(saldo, 0);
    });

    await test('getEstado retorna saldo e totais', async () => {
      const estado = await getEstado();
      assert.ok('saldo' in estado);
      assert.ok('totalConquistado' in estado);
      assert.ok('totalGasto' in estado);
    });

    await test('addCoins aumenta saldo', async () => {
      const antes = await getSaldo();
      const res = await addCoins(50, { origem: 'teste', descricao: 'crédito teste', jogo: null });
      assert.ok(res.ok);
      assert.strictEqual(res.saldo, antes + 50);
      const depois = await getSaldo();
      assert.strictEqual(depois, antes + 50);
    });

    await test('addCoins recusa quantidade inválida', async () => {
      const antes = await getSaldo();
      const res = await addCoins(0, { origem: 'teste' });
      assert.ok(!res.ok);
      assert.strictEqual(res.erro, 'quantidade_invalida');
      assert.strictEqual(await getSaldo(), antes);
    });

    await test('debitCoins reduz saldo quando suficiente', async () => {
      const antes = await getSaldo();
      const res = await debitCoins(20, { origem: 'teste', descricao: 'débito teste', jogo: null });
      assert.ok(res.ok);
      assert.strictEqual(res.saldo, antes - 20);
      assert.strictEqual(await getSaldo(), antes - 20);
    });

    await test('debitCoins recusa saldo insuficiente (nunca negativo)', async () => {
      const saldoAtual = await getSaldo();
      const res = await debitCoins(saldoAtual + 1000, { origem: 'teste' });
      assert.ok(!res.ok);
      assert.strictEqual(res.erro, 'saldo_insuficiente');
      assert.strictEqual(await getSaldo(), saldoAtual);
    });

    await test('idempotência impede transação duplicada', async () => {
      const chave = 'idp_teste_unico_123';
      const antes = await getSaldo();
      const r1 = await addCoins(7, { origem: 'teste', idempotencyKey: chave, descricao: 'idempotente' });
      assert.ok(r1.ok);
      const r2 = await addCoins(7, { origem: 'teste', idempotencyKey: chave, descricao: 'idempotente duplicada' });
      assert.ok(!r2.ok);
      assert.strictEqual(r2.erro, 'duplicado');
      // Saldo deve refletir apenas uma transação
      assert.strictEqual(await getSaldo(), antes + 7);
    });

    await test('registrarTransacao grava histórico', async () => {
      const nAntes = await contarTransacoes();
      await registrarTransacao({
        tipo: 'debito',
        quantidade: 3,
        saldoAnterior: await getSaldo(),
        saldoPosterior: await getSaldo() - 3,
        origem: 'jogo',
        descricao: 'registro teste',
        jogo: 'plinko'
      });
      const nDepois = await contarTransacoes();
      assert.ok(nDepois >= nAntes + 1);
    });

    await test('getHistorico retorna mais recentes primeiro', async () => {
      const hist = await getHistorico(10);
      assert.ok(Array.isArray(hist));
      for (let i = 1; i < hist.length; i++) {
        assert.ok(hist[i - 1].criadoEm >= hist[i].criadoEm);
      }
    });
  });
}

async function grupoTransacoes() {
  await grupo('Transações (consultas e integridade)', async () => {
    await test('resumoFinanceiro retorna totais', async () => {
      const resumo = await resumoFinanceiro();
      assert.ok('saldo' in resumo);
      assert.ok('totalConquistado' in resumo);
      assert.ok('totalGasto' in resumo);
      assert.ok('totalTransacoes' in resumo);
    });

    await test('detectarDuplicatas retorna array', async () => {
      const dups = await detectarDuplicatas();
      assert.ok(Array.isArray(dups));
    });

    await test('validarConsistencia reporta consistente', async () => {
      const consist = await validarConsistencia();
      assert.ok('consistente' in consist);
      assert.ok('saldoCarteira' in consist);
      assert.ok('saldoCalculado' in consist);
    });
  });
}

async function grupoRecompensas() {
  await grupo('Recompensas', async () => {
    await test('validarRecompensa aceita quantidade válida', async () => {
      const v = validarRecompensa(10, 'plinko');
      assert.ok(v.valido);
    });

    await test('validarRecompensa recusa quantidade inválida', async () => {
      const v = validarRecompensa(-5, 'plinko');
      assert.ok(!v.valido);
      const v2 = validarRecompensa(0, 'plinko');
      assert.ok(!v2.valido);
      const v3 = validarRecompensa(10, '');
      assert.ok(!v3.valido);
    });

    await test('calcularPremio calcula prêmio', async () => {
      const r = calcularPremio(10, 2);
      assert.ok(r.valido);
      assert.strictEqual(r.premio, 20);
    });

    await test('calcularPremio recusa aposta inválida', async () => {
      const r = calcularPremio(0, 2);
      assert.ok(!r.valido);
    });
  });
}

async function grupoDificuldades() {
  await grupo('Dificuldades', async () => {
    await test('Plinko fácil tem 8 fileiras', async () => {
      const f = getDificuldadePlinko('facil');
      assert.strictEqual(f.fileiras, 8);
    });

    await test('Plinko extremo tem 16 fileiras', async () => {
      const f = getDificuldadePlinko('extremo');
      assert.strictEqual(f.fileiras, 16);
    });

    await test('getDificuldadePlinko fallback normal', async () => {
      const f = getDificuldadePlinko('inexistente');
      assert.strictEqual(f.fileiras, 12); // normal
    });

    await test('Cartas extremo tem 100 cartas', async () => {
      const f = getDificuldadeCartas('extremo');
      assert.strictEqual(f.cartas, 100);
    });

    await test('Cartas fácil tem 18 cartas', async () => {
      const f = getDificuldadeCartas('facil');
      assert.strictEqual(f.cartas, 18);
    });
  });
}

async function grupoBackup() {
  await grupo('Backup e restauração', async () => {
    await resetDB();
    await clear('wallet');
    await clear('transactions');
    await clear('profile');
    await put('profile', { nome: 'Teste', idExterno: null, criadoEm: Date.now(), atualizadoEm: Date.now(), avatar: null, tema: 'retro' });
    await put('wallet', { saldo: 123, totalConquistado: 200, totalGasto: 77, atualizadoEm: Date.now() });
    await put('transactions', { tipo: 'credito', quantidade: 100, origem: 'teste', descricao: 't', jogo: null, idempotencyKey: 'k1', criadoEm: Date.now() });

    await test('exportarProgresso gera estrutura com stores', async () => {
      const backup = await exportarProgresso();
      assert.ok(backup.formato === FORMATO_VERSION);
      assert.ok(backup.versaoBanco === DB_VERSION);
      assert.ok(backup.stores);
      assert.ok('wallet' in backup.stores);
      assert.ok('profile' in backup.stores);
      assert.ok('transactions' in backup.stores);
    });

    await test('validarEstrutura aceita backup válido', async () => {
      const backup = await exportarProgresso();
      const valido = validarEstrutura(backup);
      assert.ok(valido.valido, valido.erros.join(', '));
    });

    await test('validarEstrutura rejeita backup sem stores', async () => {
      const invalido = { formato: FORMATO_VERSION, versaoBanco: DB_VERSION };
      const valido = validarEstrutura(invalido);
      assert.ok(!valido.valido);
      assert.ok(valido.erros.length > 0);
    });

    await test('validarEstrutura rejeita stores ausentes', async () => {
      const invalido = { formato: FORMATO_VERSION, versaoBanco: DB_VERSION, stores: { profile: [] } };
      const valido = validarEstrutura(invalido);
      assert.ok(!valido.valido);
      assert.ok(valido.erros.some((e) => e.includes('wallet')));
    });

    await test('importarProgresso substitui carteira', async () => {
      // Modifica saldo atual
      await put('wallet', { saldo: 999, totalConquistado: 999, totalGasto: 0, atualizadoEm: Date.now() });
      const backup = await exportarProgresso(); // tem saldo 123 (exportado antes da alteração? não, exportar agora pega 999)
      // Para testar substituição, exportamos antes e restauramos depois de alterar
      const backupAntigo = {
        formato: FORMATO_VERSION,
        versaoBanco: DB_VERSION,
        geradoEm: Date.now(),
        stores: {
          profile: [{ nome: 'Antigo', criadoEm: Date.now(), atualizadoEm: Date.now(), avatar: null, tema: 'retro' }],
          wallet: [{ saldo: 123, totalConquistado: 200, totalGasto: 77, atualizadoEm: Date.now() }],
          transactions: [],
          games: [], matches: [], inventory: [], achievements: [], settings: [], metadata: []
        }
      };
      const valido = validarEstrutura(backupAntigo);
      assert.ok(valido.valido, valido.erros.join(', '));
      const resultado = await importarProgresso(backupAntigo);
      assert.ok(resultado.ok, resultado.erros ? resultado.erros.join(', ') : '');
      const saldo = await getSaldo();
      assert.strictEqual(saldo, 123);
    });
  });
}

async function grupoPlinko() {
  await grupo('Plinko — física e economia', async () => {
    await test('mundo aplica gravidade e a bola cai', async () => {
      const w = new World({ gravityX: 0, gravityY: 980, substeps: 4 });
      const b = createBall(w, 100, 100, 6, 0.5);
      w.step(1); // 1 segundo
      assert.ok(b.position.y > 100, 'bola deveria cair com a gravidade');
      assert.ok(b.velocity.y > 0, 'velocidade vertical deveria ser positiva (para baixo)');
    });

    await test('bola colide com pino estático (colisão real)', async () => {
      const w = new World({ gravityX: 0, gravityY: 0, substeps: 8 });
      const pino = createPin(w, 100, 100, 8);
      const bola = createBall(w, 100, 80, 6, 0.5);
      bola.setVelocity(0, 100); // desce direto no pino

      let colidiu = false;
      w.onCollision = () => { colidiu = true; };

      w.step(0.5);
      assert.ok(colidiu, 'deveria detectar colisão bola-pino');
      // Após colisão, a bola não deveria continuar descendo na mesma direção
      assert.ok(bola.velocity.y < 100, 'bola deveria ter sua velocidade alterada pela colisão');
    });

    await test('bola colide com parede (segmento)', async () => {
      const w = new World({ gravityX: 0, gravityY: 0, substeps: 8 });
      // Parede vertical à direita da bola
      const parede = createWall(w, 200, 100, -Math.PI / 2, 200);
      const bola = createBall(w, 190, 100, 6, 0.5);
      bola.setVelocity(100, 0); // se move para a direita na parede

      let colidiu = false;
      w.onCollision = () => { colidiu = true; };

      w.step(0.5);
      assert.ok(colidiu, 'deveria detectar colisão bola-parede');
      assert.ok(bola.velocity.x < 100, 'bola deveria inverter/diminuir velocidade horizontal após parede');
    });

    await test('duas bolas colidem entre si', async () => {
      const w = new World({ gravityX: 0, gravityY: 0, substeps: 8 });
      const b1 = createBall(w, 90, 100, 6, 0.5);
      const b2 = createBall(w, 110, 100, 6, 0.5);
      b1.setVelocity(100, 0);
      b2.setVelocity(-100, 0);

      w.step(0.3);
      // Após colisão, elas deveriam se afastar (velocidades invertidas/atenuadas)
      assert.ok(b1.velocity.x < 0 || b2.velocity.x > 0, 'bolas deveriam se afastar após colisão');
    });

    await test('dificuldade fácil tem 8 fileiras', async () => {
      const f = getDificuldadePlinko('facil');
      assert.strictEqual(f.fileiras, 8);
    });

    await test('dificuldade extremo tem 16 fileiras', async () => {
      const f = getDificuldadePlinko('extremo');
      assert.strictEqual(f.fileiras, 16);
    });

    await test('calcularPremio aplica multiplicador', async () => {
      const r = calcularPremio(10, 5);
      assert.ok(r.valido);
      assert.strictEqual(r.premio, 50);
    });

    await test('calcularPremio recusa aposta inválida', async () => {
      assert.ok(!calcularPremio(0, 2).valido);
      assert.ok(!calcularPremio(-5, 2).valido);
    });

    await test('validarRecompensa aceita prêmio válido', async () => {
      assert.ok(validarRecompensa(100, 'plinko').valido);
      assert.ok(!validarRecompensa(0, 'plinko').valido);
      assert.ok(!validarRecompensa(100, '').valido);
    });
  });
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

async function main() {
  process.stdout.write('🧪 Arcade Collection Alpha — Suíte de testes automatizados\n');
  process.stdout.write('======================================================\n');

  await grupoBanco();
  await grupoCarteira();
  await grupoTransacoes();
  await grupoRecompensas();
  await grupoDificuldades();
  await grupoPlinko();
  await grupoBackup();

  closeDatabase();

  process.stdout.write('\n======================================================\n');
  process.stdout.write(`✓ Aprovados: ${passed}\n`);
  process.stdout.write(`✗ Falharam:  ${failed}\n`);
  process.stdout.write('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro não tratado na suíte de testes:', err);
  process.exit(2);
});
