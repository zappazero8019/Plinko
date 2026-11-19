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
import { readFileSync } from 'node:fs';

// ============================================================================
// MOCK DE INDEXEDDB EM MEMÓRIA
// ============================================================================

class IDBRequest {
  constructor(db = null) {
    this.readyState = 'pending';
    this.result = undefined;
    this.error = undefined;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this._db = db;
    this._transaction = undefined;
  }
  get transaction() {
    if (this._transaction) return this._transaction;
    if (this._db && this._db._inVersionChangeTransaction) {
      return this._db._versionChangeTransaction;
    }
    return undefined;
  }
  set transaction(tx) {
    this._transaction = tx;
  }
  _registrarPendencia() {
    const tx = this._transaction;
    if (!tx || typeof tx._pending !== 'number') return;
    tx._pending += 1;
    let concluido = false;
    const finalizar = () => {
      if (concluido) return;
      concluido = true;
      tx._pending -= 1;
      if (tx._pending === 0 && !tx._aborted) {
        clearTimeout(tx._timerConclusao);
        tx._timerConclusao = setTimeout(() => tx._complete(), 0);
      }
    };
    const resolver = this._resolve.bind(this);
    const rejeitar = this._reject.bind(this);
    this._resolve = (resultado) => {
      try { resolver(resultado); } finally { finalizar(); }
    };
    this._reject = (err) => {
      try { rejeitar(err); } finally { finalizar(); }
    };
  }
  _resolve(result) {
    this.readyState = 'done';
    this.result = result;
    if (this.onsuccess) this.onsuccess({ target: this });
  }
  _reject(err) {
    this.readyState = 'done';
    this.error = err;
    let impedido = false;
    const evento = {
      type: 'error',
      target: this,
      error: err,
      preventDefault() { impedido = true; }
    };
    if (this.onerror) this.onerror(evento);
    // IndexedDB aborta a transação quando o erro do request não é tratado.
    if (!impedido && this._transaction) {
      this._transaction._abortWithError(err);
    } else if (!this.onerror) {
      throw err;
    }
  }
}

class IDBIndex {
  constructor(store, indexName, keyPath, unique) {
    this.store = store;
    this.indexName = indexName;
    this.keyPath = keyPath;
    this.unique = unique;
  }
  chaveDo(registro) {
    if (Array.isArray(this.keyPath)) return this.keyPath.map((campo) => registro[campo]);
    return registro[this.keyPath];
  }
  chavesIguais(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((valor, indice) => valor === b[indice]);
    }
    return a === b;
  }
  getAll(value) {
    const req = new IDBRequest();
    req._transaction = this.store._transaction;
    req._registrarPendencia();
    setTimeout(() => {
      const todos = Array.from(this.store._data.values());
      let resultado;
      if (value === undefined) {
        resultado = todos;
      } else if (Array.isArray(value)) {
        resultado = todos.filter((registro) => this.chavesIguais(this.chaveDo(registro), value));
      } else if (Array.isArray(this.keyPath)) {
        // Índice composto: uma chave simples consulta o primeiro componente.
        resultado = todos.filter((registro) => this.chaveDo(registro)[0] === value);
      } else {
        resultado = todos.filter((registro) => this.chaveDo(registro) === value);
      }
      req._resolve(resultado);
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
    this._transaction = undefined;
    this.indexNames = { contains: (nome) => this._indexes.has(nome) };
  }
  _novoRequest() {
    const req = new IDBRequest();
    req._transaction = this._transaction;
    req._registrarPendencia();
    return req;
  }
  _validarUnicidade(valor, chave, chaveAnterior) {
    for (const indice of this._indexes.values()) {
      if (!indice.unique) continue;
      const novaChave = indice.chaveDo(valor);
      if (novaChave === undefined ||
          (Array.isArray(novaChave) && novaChave.some((parte) => parte === undefined))) continue;
      for (const [outraChave, outro] of this._data) {
        if (outraChave === chaveAnterior) continue;
        if (indice.chavesIguais(novaChave, indice.chaveDo(outro))) {
          const erro = new Error(`ConstraintError: índice ${indice.indexName} único violado`);
          erro.name = 'ConstraintError';
          return erro;
        }
      }
    }
    return null;
  }
  _resolveKey(value) {
    if (this.keyPath && value[this.keyPath] !== undefined) return value[this.keyPath];
    if (this.autoIncrement) return this._nextId++;
    return undefined;
  }
  add(value) {
    const req = this._novoRequest();
    const tx = this._transaction;
    setTimeout(() => {
      if (tx && tx._aborted) {
        req._reject(new Error('Transaction aborted'));
        return;
      }
      const key = this._resolveKey(value);
      if (typeof key === 'number' && key >= this._nextId) this._nextId = key + 1;
      if (key !== undefined && this._data.has(key)) {
        const erro = new Error('ConstraintError: chave primária duplicada');
        erro.name = 'ConstraintError';
        req._reject(erro);
        return;
      }
      const erro = this._validarUnicidade(value, key, undefined);
      if (erro) {
        req._reject(erro);
        return;
      }
      if (key !== undefined) value[this.keyPath] = key;
      this._data.set(key, value);
      if (tx && tx._undo) {
        tx._undo.push(() => this._data.delete(key));
      }
      req._resolve(key);
    }, 0);
    return req;
  }
  put(value) {
    const req = this._novoRequest();
    const tx = this._transaction;
    setTimeout(() => {
      if (tx && tx._aborted) {
        req._reject(new Error('Transaction aborted'));
        return;
      }
      const key = this._resolveKey(value);
      if (typeof key === 'number' && key >= this._nextId) this._nextId = key + 1;
      const anterior = this._data.get(key);
      const existia = this._data.has(key);
      const erro = this._validarUnicidade(value, key, key);
      if (erro) {
        req._reject(erro);
        return;
      }
      if (key !== undefined) value[this.keyPath] = key;
      this._data.set(key, value);
      if (tx && tx._undo) {
        tx._undo.push(() => {
          if (existia) this._data.set(key, anterior);
          else this._data.delete(key);
        });
      }
      req._resolve(key);
    }, 0);
    return req;
  }
  get(key) {
    const req = this._novoRequest();
    setTimeout(() => {
      req._resolve(this._data.get(key));
    }, 0);
    return req;
  }
  getAll() {
    const req = this._novoRequest();
    setTimeout(() => {
      req._resolve(Array.from(this._data.values()));
    }, 0);
    return req;
  }
  clear() {
    const req = this._novoRequest();
    const tx = this._transaction;
    setTimeout(() => {
      if (tx && tx._aborted) {
        req._reject(new Error('Transaction aborted'));
        return;
      }
      const anterior = new Map(this._data);
      this._data.clear();
      // IndexedDB não reinicia o gerador de chaves em clear(). Mantê-lo é
      // essencial para simular o bug de autoIncrement do mqWallet corretamente.
      if (tx && tx._undo) {
        tx._undo.push(() => {
          this._data.clear();
          for (const [chave, registro] of anterior) this._data.set(chave, registro);
        });
      }
      req._resolve(undefined);
    }, 0);
    return req;
  }
  delete(key) {
    const req = this._novoRequest();
    const tx = this._transaction;
    setTimeout(() => {
      if (tx && tx._aborted) {
        req._reject(new Error('Transaction aborted'));
        return;
      }
      const anterior = this._data.get(key);
      const existia = this._data.has(key);
      this._data.delete(key);
      if (tx && tx._undo) {
        tx._undo.push(() => {
          if (existia) this._data.set(key, anterior);
        });
      }
      req._resolve(undefined);
    }, 0);
    return req;
  }
  count() {
    const req = this._novoRequest();
    setTimeout(() => {
      req._resolve(this._data.size);
    }, 0);
    return req;
  }
  createIndex(name, keyPath, options = {}) {
    if (this._indexes.has(name)) {
      const erro = new Error('ConstraintError: índice já existe');
      erro.name = 'ConstraintError';
      throw erro;
    }
    const indice = new IDBIndex(this, name, keyPath, options.unique);
    this._indexes.set(name, indice);
    return indice;
  }
  deleteIndex(name) {
    this._indexes.delete(name);
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
    this._undo = [];
    this._pending = 0;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = undefined;
    // Fallback de segurança; a conclusão normal acontece quando todas as
    // requisições pendentes terminam (ver _registrarPendencia()).
    this._timerConclusao = setTimeout(() => this._complete(), 50);
  }
  objectStore(name) {
    if (this._aborted) throw new Error('Transaction aborted');
    // Busca dinamicamente do banco: as stores podem ser criadas
    // durante onupgradeneeded após a obtenção da transação.
    const store = this.db._stores.get(name);
    store._transaction = this;
    return store;
  }
  abort() {
    this._abortWithError(this.error || new Error('Transação abortada'));
  }
  _abortWithError(err) {
    if (this._completed || this._aborted) return;
    this._aborted = true;
    this.error = err;
    for (let i = this._undo.length - 1; i >= 0; i -= 1) {
      try {
        this._undo[i]();
      } catch (_) {
        // Rollback best-effort no mock.
      }
    }
    this._undo.length = 0;
    if (this.onerror) this.onerror({ target: this, error: err });
    if (this.onabort) this.onabort({ target: this, error: err });
  }
  _complete() {
    if (this._completed || this._aborted) return;
    if (this._pending > 0) {
      this._timerConclusao = setTimeout(() => this._complete(), 0);
      return;
    }
    clearTimeout(this._timerConclusao);
    this._completed = true;
    this._undo.length = 0;
    if (this.oncomplete) this.oncomplete();
  }
}

class IDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._inVersionChangeTransaction = false;
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
    if (this._inVersionChangeTransaction) {
      throw new DOMException(
        'A version change transaction is running.',
        'InvalidStateError'
      );
    }
    const tx = new IDBTransaction(this, storeNames, mode);
    // Tentativa inicial de conclusão; _complete() espera as requisições.
    setTimeout(() => tx._complete(), 0);
    return tx;
  }
  close() {
    // no-op no mock
  }
}

const MOCK_DBS = new Map();

function mockIndexedDBOpen(name, version) {
  const req = new IDBRequest(null);
  setTimeout(() => {
    let db = MOCK_DBS.get(name);
    const isNew = !db;
    if (isNew) {
      db = new IDBDatabase(name, version);
      MOCK_DBS.set(name, db);
    }
    // Substitui o request por um que tenha referência ao banco
    req._db = db;
    // Define result antes de disparar onupgradeneeded (o handler acessa request.result)
    req.result = db;
    // Se versão aumentou (ou novo) e houver onupgradeneeded
    if (isNew || version > db.version) {
      const oldVersion = isNew ? 0 : db.version;
      db.version = version;
      // Uma única transação de versão, exposta por event.target.transaction.
      // Ela permanece ativa até todas as requisições do upgrade terminarem,
      // exatamente como no IndexedDB real.
      const versaoTx = new IDBTransaction(db, [], 'versionchange');
      db._versionChangeTransaction = versaoTx;
      req._transaction = versaoTx;
      db._inVersionChangeTransaction = true;
      req.onupgradeneeded && req.onupgradeneeded({
        target: req,
        result: db,
        oldVersion,
        newVersion: version
      });

      let resolvido = false;
      const concluirAbertura = () => {
        if (resolvido) return;
        resolvido = true;
        db._inVersionChangeTransaction = false;
        req._resolve(db);
      };
      const onComplete = versaoTx.oncomplete;
      const onAbort = versaoTx.onabort;
      versaoTx.oncomplete = () => {
        if (onComplete) onComplete();
        concluirAbertura();
      };
      versaoTx.onabort = () => {
        if (onAbort) onAbort();
        concluirAbertura();
      };
      setTimeout(() => versaoTx._complete(), 0);
      return;
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
import { DB_VERSION_ATUAL } from '../src/core/migrations.js';
import {
  MQ_WALLET_ID,
  MQ_MOEDAS_POR_PAR,
  MQ_BONUS_MAX,
  MQ_MULTIPLICADOR_MAXIMO,
  multiplicadorSequencia,
  calcularFatorEficiencia,
  calcularFatorTempo,
  calcularMoedasPorPares,
  calcularBonusTentativas,
  calcularPontuacaoMQ,
  calcularLiquidacaoMQ,
  obterSaldoMQ,
  obterEstadoMQ,
  listarHistoricoMQ,
  liquidarSessaoMQ,
  MQ_TIPO_PAR,
  MQ_TIPO_BONUS
} from '../src/core/mq-economy.js';
import { criarRastreadorRecompensas } from '../src/games/cards/recompensas.js';
import {
  getSaldo, getEstado, addCoins, debitCoins, registrarTransacao, getHistorico, contarTransacoes, validarRecompensa, WALLET_DEFAULT_ID
} from '../src/core/wallet.js';
import { resumoFinanceiro, detectarDuplicatas, validarConsistencia } from '../src/core/transactions.js';
import { exportarProgresso, validarEstrutura, importarProgresso, FORMATO_VERSION } from '../src/core/backup.js';
import { DIFICULDADES_PLINKO, getDificuldadePlinko } from '../src/games/plinko/difficulty.js';
import {
  DIFICULDADES_CARTAS_EXPANDIDO,
  DIFICULDADES_CARTAS_SMB3,
  PROGRESSAO_SMB3,
  TEMPOS_PREVIA_CARTAS,
  obterTempoPrevia,
  dificuldadeAposVitoria,
  getDificuldadeCartas,
  getDificuldadeSmb3
} from '../src/games/cards/difficulty.js';
// DIFICULDADES_CARTAS_SMB3 / PROGRESSAO_SMB3 / getDificuldadeSmb3 continuam
// importados apenas para provar que os identificadores internos legados seguem
// intactos. Nenhum deles participa do fluxo do Jogo da Memória.
import { calcularPremio } from '../src/games/plinko/rewards.js';
import { World, createPin, createWall, createBall, Vec } from '../src/games/plinko/physics.js';
import {
  MULTISET_CLASSICO, CLASSIC_LEVELS, criarRng, embaralhar,
  SIMBOLOS_CLASSICOS, SIMBOLOS_EXPANDIDOS, contarPorSimbolo
} from '../src/games/cards/cards-data.js';
import {
  CLASSICO, ATRASOS_SMB3, criarConfigClassica, criarConfigSmb3,
  sortearLayoutClassico, validarLayoutClassico
} from '../src/games/cards/classic.js';
import {
  criarConfigExpandida, gerarParesExpandido, avaliarDesafios, proximaDificuldade
} from '../src/games/cards/expanded.js';
import { criarPartida, criarSessao } from '../src/games/cards/board.js';
import { criarRenderer } from '../src/games/cards/renderer.js';
import {
  criarControladorPrevia,
  criarPreviaParaDificuldade,
  segundosRestantes
} from '../src/games/cards/previa.js';
import { PROGRESSAO_CARTAS } from '../src/games/cards/difficulty.js';
import {
  VISUALIZACAO_CARTAS,
  VISUALIZACAO_PADRAO,
  MODALIDADES_CARTAS,
  MODALIDADE_PADRAO,
  QUANTIDADE_CHEAT_PADRAO,
  normalizarVisualizacaoCartas,
  normalizarTamanhoAmpliacao,
  TAMANHO_AMPLIACAO_PADRAO,
  TAMANHO_AMPLIACAO_MIN,
  TAMANHO_AMPLIACAO_MAX,
  TAMANHO_AMPLIACAO_PASSO,
  registrarObservadorPreferencias,
  obterTamanhoAmpliacaoCartas,
  salvarTamanhoAmpliacaoCartas,
  normalizarModalidadeCartas,
  normalizarDificuldadeCartas,
  normalizarProgressaoAutomaticaCartas,
  PROGRESSAO_AUTOMATICA_PADRAO,
  normalizarBooleano,
  normalizarQuantidadeCheat,
  normalizarVolumeCartas,
  normalizarSelfiesAtivas,
  VOLUME_FX_PADRAO,
  VOLUME_BGM_PADRAO,
  obterVolumesCartas,
  salvarVolumesCartas,
  obterVisualizacaoCartas,
  salvarVisualizacaoCartas,
  obterPreferenciasCartas,
  salvarPreferenciasCartas,
  obterModalidadeCartas,
  salvarModalidadeCartas,
  obterAudioCartas,
  salvarAudioCartas,
  obterSelfiesAtivas,
  salvarSelfiesAtivas
} from '../src/core/settings.js';
import { renderizarConfiguracoes, renderizarEstatisticas } from '../src/ui/panels.js';
import {
  obterPerfil,
  salvarPerfil,
  excluirPerfil,
  normalizarNomePerfil,
  normalizarAvatarPerfil
} from '../src/core/profile.js';
import { renderizarPerfil } from '../src/ui/profile.js';
import {
  registrarPartida,
  listarPartidas,
  obterEstatisticas,
  contarPartidas,
  listarConquistasDesbloqueadas,
  contarConquistasDesbloqueadas,
  JOGO_PADRAO
} from '../src/core/game-stats.js';
import {
  calcularInsights,
  obterInsightsPartidas,
  obterMoedasConquistadasMQ,
  LIMITE_EVOLUCAO
} from '../src/core/stats-insights.js';
import {
  estadoVazio,
  graficoBarras,
  graficoEvolucao
} from '../src/ui/charts.js';
import {
  TAMANHO_CARTA,
  MIME_SAIDA,
  QUALIDADE_SAIDA,
  TAMANHO_MAXIMO_ARQUIVO,
  ENQUADRAMENTO_PADRAO,
  normalizarEnquadramento,
  lerArquivoComoDataUrl,
  processarImagem,
  criarSelfie,
  listarSelfies,
  obterSelfie,
  definirSelfieAtiva,
  substituirSelfie,
  excluirSelfie
} from '../src/core/selfies.js';
import {
  TENTATIVAS_INICIAIS,
  TIPOS_CHEAT,
  BONUS_SELFIE_TENTATIVAS,
  tentativasPorDificuldade,
  normalizarQuantidade,
  resolverCheat,
  calcularTentativasIniciais,
  ehSelfie
} from '../src/games/cards/tentativas.js';

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

    await test('primeira criação insere dados iniciais via transação de versão', async () => {
      await resetDB();
      const db = await openDatabase();
      // Verifica que dados iniciais existem nas stores
      const profile = await getAll('profile');
      assert.ok(profile.length >= 1);
      assert.strictEqual(profile[0].nome, 'Jogador');

      const wallet = await getAll('wallet');
      assert.ok(wallet.length >= 1);
      assert.strictEqual(wallet[0].saldo, 0);

      const metadata = await getAll('metadata');
      assert.ok(metadata.length >= 1);
      assert.strictEqual(metadata[0].versaoBanco, DB_VERSION);

      const settings = await getAll('settings');
      assert.ok(settings.length >= 1);
      assert.strictEqual(settings[0].dificuldadePlinko, 'normal');
    });

    await test('não lança InvalidStateError durante onupgradeneeded', async () => {
      // Se o código tentasse chamar database.transaction() dentro de
      // onupgradeneeded, o mock lançaria InvalidStateError (simulando o Chrome).
      await resetDB();
      let erro = null;
      try {
        await openDatabase();
      } catch (e) {
        erro = e;
      }
      assert.strictEqual(erro, null, 'não deve lançar erro ao abrir o banco');
    });

    await test('abertura posterior preserva dados existentes (sem duplicação)', async () => {
      await resetDB();
      const db1 = await openDatabase();
      const antes = await getAll('wallet');
      assert.ok(antes.length === 1);

      // Reabre o banco sem alterar versão (onupgradeneeded não dispara)
      closeDatabase();
      const db2 = await openDatabase();
      const depois = await getAll('wallet');
      assert.strictEqual(depois.length, 1, 'não deve duplicar dados iniciais');
      assert.strictEqual(depois[0].saldo, 0);
    });

    await test('caminho onupgradeneeded usa transação de versão existente', async () => {
      // Se openDatabase chamasse database.transaction() dentro de onupgradeneeded,
      // o mock lançaria InvalidStateError e este teste falharia.
      await resetDB();
      const db = await openDatabase();
      assert.ok(db);
      for (const store of STORES) {
        assert.ok(db.objectStoreNames.contains(store), `store ${store} ausente`);
      }
    });
  });
}

async function grupoCarteira() {
  await grupo('Carteira virtual (wallet)', async () => {
    await resetDB();
    // Limpa carteira e transactions para teste isolado. O ID fixo da carteira
    // legada é recriado explicitamente: clear() não reinicia o autoIncrement.
    await clear('wallet');
    await clear('transactions');
    await put('wallet', {
      id: WALLET_DEFAULT_ID,
      saldo: 0,
      totalConquistado: 0,
      totalGasto: 0,
      atualizadoEm: Date.now()
    });

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
    await put('profile', { id: 1, nome: 'Teste', idExterno: null, criadoEm: Date.now(), atualizadoEm: Date.now(), avatar: null, tema: 'retro' });
    await put('wallet', { id: WALLET_DEFAULT_ID, saldo: 123, totalConquistado: 200, totalGasto: 77, atualizadoEm: Date.now() });
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
      await put('wallet', { id: WALLET_DEFAULT_ID, saldo: 999, totalConquistado: 999, totalGasto: 0, atualizadoEm: Date.now() });
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
          games: [], matches: [], inventory: [], achievements: [], settings: [], metadata: [],
          // Backup com a versão atual do banco precisa conter todas as stores.
          selfies: [], mqWallet: [], mqTransactions: [], mqSessions: []
        }
      };
      const valido = validarEstrutura(backupAntigo);
      assert.ok(valido.valido, valido.erros.join(', '));
      const resultado = await importarProgresso(backupAntigo);
      assert.ok(resultado.ok, resultado.erros ? resultado.erros.join(', ') : '');
      // A importação genérica da carteira legada continua reatribuindo o ID
      // (comportamento preexistente, fora do escopo desta correção). O dado
      // restaurado é verificado diretamente na store.
      const carteiras = await getAll('wallet');
      assert.strictEqual(carteiras.length, 1);
      assert.strictEqual(carteiras[0].saldo, 123);
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
// CARD MATCH — REGRAS, SESSÃO, MODOS E ESTATÍSTICAS
// ============================================================================

/** Agrupa ids de cartas por símbolo (para montar pares determinísticos). */
function agruparPorSimbolo(cartas) {
  const mapa = new Map();
  for (const carta of cartas) {
    if (!mapa.has(carta.simbolo)) mapa.set(carta.simbolo, []);
    mapa.get(carta.simbolo).push(carta.id);
  }
  return mapa;
}

/** Lista todos os pares reais (grupos de 4 cartas geram 2 pares). */
function listarPares(cartas) {
  const pares = [];
  for (const ids of agruparPorSimbolo(cartas).values()) {
    for (let i = 0; i < ids.length; i += 2) {
      pares.push([ids[i], ids[i + 1]]);
    }
  }
  return pares;
}

/** DOM mínimo para verificar a remoção de listeners pelo renderer. */
class MockClassList {
  constructor(valor = '') {
    this.itens = new Set(String(valor).split(/\s+/).filter(Boolean));
  }
  add(...classes) { classes.forEach((c) => this.itens.add(c)); }
  remove(...classes) { classes.forEach((c) => this.itens.delete(c)); }
  contains(classe) { return this.itens.has(classe); }
  toggle(classe, forcado) {
    const ativar = forcado === undefined ? !this.itens.has(classe) : Boolean(forcado);
    if (ativar) this.itens.add(classe); else this.itens.delete(classe);
    return ativar;
  }
}

class MockNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._classes = '';
    this.classList = new MockClassList();
    this.dataset = {};
    this.attributes = {};
    this._styleProps = {};
    this.style = {
      setProperty: (chave, valor) => { this._styleProps[chave] = String(valor); },
      removeProperty: (chave) => { delete this._styleProps[chave]; },
      getPropertyValue: (chave) => this._styleProps[chave] || ''
    };
    this._listeners = new Map();
    this.textContent = '';
    this.type = '';
    this.disabled = false;
  }
  set className(valor) {
    this._classes = String(valor);
    this.classList = new MockClassList(this._classes);
  }
  get className() { return this._classes; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  replaceChildren(...nos) {
    this.children.forEach((filho) => { filho.parentNode = null; });
    this.children = [];
    nos.forEach((no) => this.appendChild(no));
  }
  setAttribute(chave, valor) { this.attributes[chave] = String(valor); }
  getAttribute(chave) { return this.attributes[chave]; }
  addEventListener(tipo, fn, opcoes = {}) {
    if (!this._listeners.has(tipo)) this._listeners.set(tipo, new Set());
    this._listeners.get(tipo).add(fn);
    if (opcoes.signal) {
      if (opcoes.signal.aborted) {
        this._listeners.get(tipo).delete(fn);
      } else {
        opcoes.signal.addEventListener('abort', () => {
          this._listeners.get(tipo)?.delete(fn);
        });
      }
    }
  }
  dispatch(tipo, evento = {}) {
    const evt = { preventDefault() {}, currentTarget: this, ...evento };
    for (const fn of [...(this._listeners.get(tipo) || [])]) fn(evt);
  }
  focus() {}
  click() { this.dispatch('click'); }
}

function encontrarNo(node, predicado) {
  if (predicado(node)) return node;
  for (const filho of node.children || []) {
    const encontrado = encontrarNo(filho, predicado);
    if (encontrado) return encontrado;
  }
  return null;
}

function percorrerNo(node) {
  const todos = [node];
  for (const filho of node.children || []) todos.push(...percorrerNo(filho));
  return todos;
}

/** Agendador determinístico (sem relógio real) para testar timers da sessão. */
function criarAgendadorFake() {
  const agendados = [];
  let proximoId = 1;
  return {
    agendados,
    setTimeoutFake(fn, ms) {
      const id = proximoId++;
      agendados.push({ id, fn, ms, cancelado: false, executado: false });
      return id;
    },
    clearTimeoutFake(id) {
      const tarefa = agendados.find((item) => item.id === id);
      if (tarefa) tarefa.cancelado = true;
    },
    executarTodos() {
      let i = 0;
      while (i < agendados.length) {
        const tarefa = agendados[i++];
        if (!tarefa.cancelado && !tarefa.executado) {
          tarefa.executado = true;
          tarefa.fn();
        }
      }
    }
  };
}

async function grupoCardMatch() {
  await grupo('Card Match — regras, modos, sessão e estatísticas', async () => {
    const configClassica = criarConfigClassica(() => 0.1);
    const gruposClassicos = agruparPorSimbolo(configClassica.cartas);
    const primeiroParClassico = listarPares(configClassica.cartas)[0];
    const simbolosDistintos = [...gruposClassicos.keys()];
    const parErrado = [
      gruposClassicos.get(simbolosDistintos[0])[0],
      gruposClassicos.get(simbolosDistintos[1])[0]
    ];

    await test('embaralhamento Fisher-Yates não muta a entrada e é determinístico', async () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8];
      const copia = embaralhar(original, criarRng(1234));
      assert.deepEqual([...copia].sort((a, b) => a - b), original);
      assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.deepEqual(embaralhar(original, criarRng(1234)), copia);
      assert.notDeepEqual(copia, original);
    });

    await test('distribuição clássica: 18 cartas, 9 pares e contagens 4/4/4/2/2/2', async () => {
      assert.strictEqual(CLASSIC_LEVELS.length, 8);
      for (const layout of CLASSIC_LEVELS) {
        assert.strictEqual(validarLayoutClassico(layout), true);
        assert.strictEqual(layout.length, 18);
      }
      const contagem = contarPorSimbolo(MULTISET_CLASSICO);
      assert.deepEqual([...contagem.values()].sort((a, b) => a - b), [2, 2, 2, 4, 4, 4]);
      assert.strictEqual(SIMBOLOS_CLASSICOS.length, 6);
      assert.strictEqual(configClassica.cartas.length, 18);
      assert.strictEqual(configClassica.totalPares, 9);
      assert.strictEqual(configClassica.colunas, 6);
      assert.strictEqual(configClassica.linhas, 3);
      assert.strictEqual(validarLayoutClassico(configClassica.cartas.map((c) => c.simbolo)), true);
      assert.strictEqual(sortearLayoutClassico(() => 0.999).indice, 7);
    });

    await test('distribuição expandida: cada dificuldade tem pares exatos e sem sobras', async () => {
      for (const [chave, diff] of Object.entries(DIFICULDADES_CARTAS_EXPANDIDO)) {
        const cfg = criarConfigExpandida(chave, criarRng(99));
        assert.strictEqual(cfg.cartas.length, diff.cartas, `cartas em ${chave}`);
        assert.strictEqual(cfg.totalPares, diff.pares, `pares em ${chave}`);
        const contagem = contarPorSimbolo(cfg.cartas.map((c) => c.simbolo));
        assert.strictEqual(contagem.size, diff.pares, `tipos em ${chave}`);
        for (const quantidade of contagem.values()) {
          assert.strictEqual(quantidade, 2, `cada símbolo aparece 2x em ${chave}`);
        }
      }
      const variantes = gerarParesExpandido(30);
      assert.strictEqual(variantes.length, 30);
      assert.strictEqual(new Set(variantes.map((p) => p.id)).size, 30);
      assert.strictEqual(SIMBOLOS_EXPANDIDOS.length, 12);
    });

    await test('seleção revela a primeira carta e trava na segunda', async () => {
      const partida = criarPartida(configClassica);
      const primeiro = partida.selecionar(primeiroParClassico[0]);
      assert.strictEqual(primeiro.tipo, 'revelado');
      assert.strictEqual(primeiro.cartas[0].revelada, true);
      const segundo = partida.selecionar(primeiroParClassico[1]);
      assert.strictEqual(segundo.tipo, 'comparacao');
      assert.strictEqual(segundo.aguardandoComparacao, true);
      assert.deepEqual(segundo.ids, primeiroParClassico);
    });

    await test('terceira carta é bloqueada durante a comparação', async () => {
      const partida = criarPartida(configClassica);
      partida.selecionar(primeiroParClassico[0]);
      partida.selecionar(primeiroParClassico[1]);
      const terceira = partida.selecionar(primeiroParClassico[0] === 0 ? 1 : 0);
      assert.strictEqual(terceira.tipo, 'bloqueado');
      assert.strictEqual(terceira.cartas.find((c) => c.id === (primeiroParClassico[0] === 0 ? 1 : 0)).revelada, false);
      assert.strictEqual(terceira.aguardandoComparacao, true);
    });

    await test('combinação correta marca par e avança o progresso', async () => {
      const partida = criarPartida(configClassica);
      partida.selecionar(primeiroParClassico[0]);
      partida.selecionar(primeiroParClassico[1]);
      const resultado = partida.resolver();
      assert.strictEqual(resultado.tipo, 'par');
      assert.strictEqual(resultado.progresso.pares, 1);
      assert.strictEqual(resultado.tentativas, 1);
      assert.strictEqual(resultado.erros, 0);
      assert.strictEqual(resultado.cartas.find((c) => c.id === primeiroParClassico[0]).pareada, true);
      assert.strictEqual(resultado.aguardandoComparacao, false);
      assert.strictEqual(partida.selecionar(primeiroParClassico[0]).tipo, 'ignorado');
    });

    await test('combinação incorreta contabiliza erro e vira as cartas de volta', async () => {
      const partida = criarPartida(configClassica);
      partida.selecionar(parErrado[0]);
      partida.selecionar(parErrado[1]);
      const resultado = partida.resolver();
      assert.strictEqual(resultado.tipo, 'erro');
      assert.strictEqual(resultado.erros, 1);
      assert.strictEqual(resultado.progresso.pares, 0);
      assert.strictEqual(resultado.cartas.find((c) => c.id === parErrado[0]).revelada, false);
      assert.strictEqual(resultado.cartas.find((c) => c.id === parErrado[1]).revelada, false);
      assert.strictEqual(resultado.tentativas, 1);
    });

    await test('conclusão ocorre ao completar os 9 pares e trava novas seleções', async () => {
      const partida = criarPartida(configClassica);
      let ultimo;
      for (const ids of listarPares(configClassica.cartas)) {
        partida.selecionar(ids[0]);
        partida.selecionar(ids[1]);
        ultimo = partida.resolver();
      }
      assert.strictEqual(ultimo.tipo, 'concluido');
      assert.strictEqual(ultimo.concluida, true);
      assert.strictEqual(ultimo.progresso.pares, 9);
      assert.strictEqual(ultimo.tentativas, 9);
      assert.strictEqual(partida.selecionar(0).tipo, 'concluida');
    });

    await test('reinício zera tentativas, erros, pares e revelações', async () => {
      const partida = criarPartida(configClassica);
      partida.selecionar(parErrado[0]);
      partida.selecionar(parErrado[1]);
      partida.resolver();
      const estado = partida.reiniciar();
      assert.strictEqual(estado.tentativas, 0);
      assert.strictEqual(estado.erros, 0);
      assert.strictEqual(estado.progresso.pares, 0);
      assert.strictEqual(estado.concluida, false);
      assert.strictEqual(estado.cartas.every((c) => !c.revelada && !c.pareada), true);
    });

    await test('configuração legada e Jogo da Memória permanecem independentes', async () => {
      const classico = criarConfigClassica(() => 0.5);
      const expandido = criarConfigExpandida('facil', criarRng(7));
      assert.strictEqual(classico.modo, 'classico');
      assert.strictEqual(classico.dificuldade, 'normal');
      assert.strictEqual(classico.tempoAlvo, null);
      assert.ok(classico.tempoMemorizacaoMs > 0);
      assert.deepEqual(classico.desafios, []);
      assert.strictEqual(expandido.modo, 'expandido');
      assert.strictEqual(expandido.dificuldade, 'facil');
      assert.ok(expandido.tempoAlvo > 0);
      assert.strictEqual(expandido.desafios.length, 4);
      assert.strictEqual(expandido.cartas.length, classico.cartas.length);
      assert.ok(expandido.simbolos.length > classico.simbolos.length,
        'o expandido deve ter mais tipos de carta que o clássico');
      const idsClassicos = new Set(classico.simbolos.map((s) => s.id));
      assert.ok(expandido.simbolos.some((s) => !idsClassicos.has(s.id)),
        'o expandido deve incluir símbolos exclusivos');
      assert.strictEqual(criarConfigExpandida('extremo', criarRng(1)).cartas.length, 100);
    });

    await test('progressão e desafios do expandido funcionam de forma previsível', async () => {
      assert.deepEqual([...PROGRESSAO_CARTAS], ['facil', 'normal', 'dificil', 'muitodificil', 'extremo']);
      assert.strictEqual(proximaDificuldade('facil'), 'normal');
      assert.strictEqual(proximaDificuldade('muitodificil'), 'extremo');
      assert.strictEqual(proximaDificuldade('extremo'), 'extremo', 'progressão não é cíclica');
      assert.strictEqual(dificuldadeAposVitoria('normal', true), 'dificil');
      assert.strictEqual(dificuldadeAposVitoria('normal', false), 'normal');
      assert.strictEqual(dificuldadeAposVitoria('extremo', true), 'extremo');
      const desafios = avaliarDesafios({
        erros: 0, tentativas: 9, totalPares: 9,
        tempoSegundos: 30, tempoAlvo: 60
      });
      assert.strictEqual(desafios.length, 4);
      assert.strictEqual(desafios.every((d) => d.concluido), true);
      const ruins = avaliarDesafios({
        erros: 5, tentativas: 20, totalPares: 9,
        tempoSegundos: 90, tempoAlvo: 60
      });
      assert.strictEqual(ruins.every((d) => !d.concluido), true);
    });

    await test('estatísticas persistem na store matches sem tocar na carteira', async () => {
      await resetDB();
      const saldoAntes = await getSaldo();
      const transacoesAntes = await contarTransacoes();

      const primeiro = await registrarPartida({
        modo: 'classico', concluida: true, vitoria: true,
        totalCartas: 18, totalPares: 9, paresEncontrados: 9,
        tentativas: 9, erros: 0, tempoSegundos: 42, playedAt: 1000
      });
      assert.strictEqual(primeiro.ok, true);
      await registrarPartida({
        jogo: JOGO_PADRAO, modo: 'expandido', dificuldade: 'normal',
        concluida: true, vitoria: true, totalCartas: 30, totalPares: 15,
        paresEncontrados: 15, tentativas: 18, erros: 3,
        tempoSegundos: 95, tempoAlvo: 110, playedAt: 2000,
        desafios: avaliarDesafios({ erros: 3, tentativas: 18, totalPares: 15, tempoSegundos: 95, tempoAlvo: 110 })
      });

      assert.strictEqual(await contarPartidas(), 2);
      const todas = await listarPartidas();
      assert.strictEqual(todas.length, 2);
      assert.strictEqual(todas[0].playedAt, 2000, 'mais recente primeiro');
      assert.strictEqual((await listarPartidas('cards', 'classico')).length, 1);
      assert.strictEqual((await listarPartidas('cards', 'expandido')).length, 1);

      const stats = await obterEstatisticas();
      assert.strictEqual(stats.partidas, 2);
      assert.strictEqual(stats.concluidas, 2);
      assert.strictEqual(stats.vitorias, 2);
      assert.strictEqual(stats.pares, 24);
      assert.strictEqual(stats.erros, 3);
      assert.strictEqual(stats.melhorTempoSegundos, 42);
      assert.strictEqual(stats.porModo.classico, 1);
      assert.strictEqual(stats.porModo.expandido, 1);
      assert.strictEqual((await obterEstatisticas('cards', 'expandido')).partidas, 1);

      assert.strictEqual(await getSaldo(), saldoAntes);
      assert.strictEqual(await contarTransacoes(), transacoesAntes);
    });

    await test('sessão dispara callbacks de par/erro/conclusão via timers controlados', async () => {
      const ag = criarAgendadorFake();
      const eventos = [];
      const sessao = criarSessao(configClassica, {
        setTimeout: ag.setTimeoutFake.bind(ag),
        clearTimeout: ag.clearTimeoutFake.bind(ag),
        agora: () => 1000,
        callbacks: {
          onPar: () => eventos.push('par'),
          onErro: () => eventos.push('erro'),
          onConcluido: () => eventos.push('concluido')
        }
      });

      sessao.selecionar(parErrado[0]);
      sessao.selecionar(parErrado[1]);
      ag.executarTodos();
      assert.ok(eventos.includes('erro'));

      for (const ids of listarPares(configClassica.cartas)) {
        sessao.selecionar(ids[0]);
        sessao.selecionar(ids[1]);
        ag.executarTodos();
      }
      assert.strictEqual(eventos.filter((e) => e === 'par').length, 9);
      assert.ok(eventos.includes('concluido'));
      assert.strictEqual(sessao.estatisticas().concluida, true);
      assert.strictEqual(sessao.estatisticas().tentativas, 10);
      sessao.destruir();
    });

    await test('destruir() cancela timers e silencia callbacks pendentes', async () => {
      const ag = criarAgendadorFake();
      const eventos = [];
      const sessao = criarSessao(configClassica, {
        setTimeout: ag.setTimeoutFake.bind(ag),
        clearTimeout: ag.clearTimeoutFake.bind(ag),
        agora: () => 5000,
        callbacks: {
          onPar: () => eventos.push('par'),
          onErro: () => eventos.push('erro'),
          onConcluido: () => eventos.push('concluido')
        }
      });

      sessao.selecionar(primeiroParClassico[0]);
      sessao.selecionar(primeiroParClassico[1]);
      assert.strictEqual(sessao.temporizadoresPendentes, 1);
      sessao.destruir();
      assert.strictEqual(sessao.destruida, true);
      assert.strictEqual(sessao.temporizadoresPendentes, 0);
      assert.strictEqual(ag.agendados[0].cancelado, true);
      ag.executarTodos();
      assert.deepEqual(eventos, []);
      assert.strictEqual(sessao.selecionar(0).tipo, 'destruida');
    });

    await test('reiniciar() da sessão limpa temporizadores e reinicia o cronômetro', async () => {
      const ag = criarAgendadorFake();
      let agora = 10000;
      const sessao = criarSessao(configClassica, {
        setTimeout: ag.setTimeoutFake.bind(ag),
        clearTimeout: ag.clearTimeoutFake.bind(ag),
        agora: () => agora
      });
      sessao.selecionar(parErrado[0]);
      sessao.selecionar(parErrado[1]);
      assert.strictEqual(sessao.temporizadoresPendentes, 1);
      assert.strictEqual(sessao.cronometroAtivo, false,
        'cronômetro oficial não corre durante a prévia');
      agora = 10000 + 45_000;
      assert.strictEqual(sessao.tempoDecorrido(), 0);
      sessao.iniciarCronometro();
      sessao.iniciarCronometro(); // idempotente
      assert.strictEqual(sessao.cronometroAtivo, true);
      agora = 10000 + 45_000 + 12_000;
      assert.strictEqual(sessao.tempoDecorrido(), 12);
      const estado = sessao.reiniciar();
      assert.strictEqual(sessao.temporizadoresPendentes, 0);
      assert.strictEqual(sessao.tempoDecorrido(), 0);
      assert.strictEqual(sessao.cronometroAtivo, false);
      assert.strictEqual(estado.tentativas, 0);
      assert.strictEqual(estado.cartas.every((c) => !c.revelada), true);
      sessao.destruir();
    });

    await test('renderer remove listeners de clique e teclado ao destruir', async () => {
      const raiz = new MockNode('div');
      const documentAnterior = globalThis.document;
      const windowAnterior = globalThis.window;
      const janela = new MockNode('window');
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      globalThis.window = janela;
      try {
        let iniciadas = 0;
        const renderer = criarRenderer(raiz, { onIniciar: () => { iniciadas += 1; } });
        renderer.mostrarMenu({ modo: 'expandido' });
        const botao = encontrarNo(raiz, (node) =>
          node.tagName === 'BUTTON' &&
          /Confirmar dificuldade e jogar|Iniciar partida/.test(node.textContent));
        assert.ok(botao, 'botão de iniciar não encontrado');
        botao.dispatch('click');
        assert.strictEqual(iniciadas, 1);

        renderer.destruir();
        assert.strictEqual(raiz.children.length, 0);
        botao.dispatch('click');
        assert.strictEqual(iniciadas, 1, 'callback não deve disparar após destruir');
        assert.strictEqual(botao._listeners.get('click').size, 0);
        assert.strictEqual((janela._listeners.get('keydown') || new Set()).size, 0);
      } finally {
        globalThis.document = documentAnterior;
        globalThis.window = windowAnterior;
      }
    });

    await test('layouts base preservados: oito disposições canônicas', async () => {
      const esperados = [
        ['shroom', 'flower', 'coins20', 'shroom', 'coins10', 'star',
          'flower', 'oneup', 'shroom', 'coins10', 'oneup', 'coins20',
          'star', 'flower', 'star', 'shroom', 'flower', 'star'],
        ['shroom', 'flower', 'coins20', 'flower', 'coins10', 'star',
          'coins20', 'oneup', 'shroom', 'coins10', 'oneup', 'flower',
          'star', 'shroom', 'star', 'shroom', 'flower', 'star'],
        ['shroom', 'flower', 'oneup', 'flower', 'star', 'star',
          'coins20', 'star', 'shroom', 'coins10', 'oneup', 'flower',
          'coins20', 'shroom', 'coins10', 'shroom', 'flower', 'star'],
        ['flower', 'coins10', 'oneup', 'flower', 'oneup', 'shroom',
          'star', 'shroom', 'coins20', 'star', 'shroom', 'coins10',
          'star', 'flower', 'coins20', 'shroom', 'flower', 'star'],
        ['flower', 'coins20', 'shroom', 'star', 'oneup', 'flower',
          'oneup', 'flower', 'coins10', 'shroom', 'coins20', 'star',
          'shroom', 'coins10', 'star', 'shroom', 'flower', 'star'],
        ['flower', 'star', 'oneup', 'flower', 'coins20', 'shroom',
          'coins10', 'shroom', 'coins20', 'oneup', 'shroom', 'coins10',
          'star', 'flower', 'star', 'shroom', 'flower', 'star'],
        ['flower', 'star', 'oneup', 'flower', 'oneup', 'shroom',
          'coins10', 'shroom', 'flower', 'star', 'shroom', 'coins10',
          'star', 'coins20', 'coins20', 'shroom', 'flower', 'star'],
        ['oneup', 'shroom', 'coins10', 'shroom', 'flower', 'star',
          'shroom', 'coins10', 'star', 'coins20', 'coins20', 'flower',
          'star', 'oneup', 'flower', 'shroom', 'flower', 'star']
      ];

      assert.strictEqual(CLASSIC_LEVELS.length, 8);
      assert.strictEqual(CLASSICO.quantidadeLayouts, 8);
      assert.deepEqual(CLASSIC_LEVELS.map((layout) => Array.from(layout)), esperados);
      for (const layout of CLASSIC_LEVELS) {
        assert.strictEqual(validarLayoutClassico(layout), true);
        const contagem = contarPorSimbolo(layout);
        assert.deepEqual([...contagem.values()].sort((a, b) => a - b), [2, 2, 2, 4, 4, 4]);
      }
      assert.strictEqual(new Set(CLASSIC_LEVELS.map((l) => l.join(','))).size, 8);
      assert.strictEqual(sortearLayoutClassico(() => 0).indice, 0);
      assert.strictEqual(sortearLayoutClassico(() => 0.999).indice, 7);
    });

    await test('dificuldades legadas alteram apenas o tempo de memorização', async () => {
      assert.deepEqual([...PROGRESSAO_SMB3], ['facil', 'normal', 'dificil']);
      assert.strictEqual(DIFICULDADES_CARTAS_SMB3.facil.tempoMemorizacaoMs, 6000);
      assert.strictEqual(DIFICULDADES_CARTAS_SMB3.normal.tempoMemorizacaoMs, 3500);
      assert.strictEqual(DIFICULDADES_CARTAS_SMB3.dificil.tempoMemorizacaoMs, 1500);
      assert.ok(DIFICULDADES_CARTAS_SMB3.facil.tempoMemorizacaoMs >
        DIFICULDADES_CARTAS_SMB3.normal.tempoMemorizacaoMs);
      assert.ok(DIFICULDADES_CARTAS_SMB3.normal.tempoMemorizacaoMs >
        DIFICULDADES_CARTAS_SMB3.dificil.tempoMemorizacaoMs);
      assert.strictEqual(getDificuldadeSmb3('invalida'), DIFICULDADES_CARTAS_SMB3.normal);

      const rng = criarRng(123);
      const facil = criarConfigSmb3('facil', rng);
      const dificil = criarConfigSmb3('dificil', criarRng(123));
      assert.strictEqual(facil.tempoMemorizacaoMs, 6000);
      assert.strictEqual(dificil.tempoMemorizacaoMs, 1500);
      assert.strictEqual(facil.modo, 'classico');
      assert.strictEqual(facil.tempoAlvo, null);
      assert.deepEqual(facil.atrasos, ATRASOS_SMB3);
      assert.deepEqual(facil.cartas, dificil.cartas);
      assert.strictEqual(facil.layoutIndice, dificil.layoutIndice);
      assert.strictEqual(facil.totalCartas, 18);
      assert.strictEqual(facil.totalPares, 9);
      assert.strictEqual(facil.colunas, 6);
      assert.strictEqual(facil.linhas, 3);

      const expandidoAntes = criarConfigExpandida('facil', criarRng(9));
      criarConfigSmb3('dificil', criarRng(1));
      const expandidoDepois = criarConfigExpandida('facil', criarRng(9));
      assert.deepEqual(expandidoDepois.cartas, expandidoAntes.cartas);
      assert.strictEqual(expandidoDepois.tempoAlvo, 60);
    });

    await test('sessão legada aplica os atrasos de erro, acerto e conclusão', async () => {
      const ag = criarAgendadorFake();
      const cfg = criarConfigSmb3('normal', criarRng(5));
      const sessao = criarSessao(cfg, {
        setTimeout: ag.setTimeoutFake.bind(ag),
        clearTimeout: ag.clearTimeoutFake.bind(ag),
        agora: () => 0
      });
      const par = listarPares(cfg.cartas)[0];
      sessao.selecionar(par[0]);
      sessao.selecionar(par[1]);
      assert.strictEqual(ag.agendados[0].ms, 800);
      ag.executarTodos();
      assert.ok(ag.agendados.some((tarefa) => tarefa.ms === 400));
      sessao.destruir();
    });

    await test('menu abre diretamente no Jogo da Memória, sem seleção de modos', async () => {
      const raiz = new MockNode('div');
      const documentAnterior = globalThis.document;
      const windowAnterior = globalThis.window;
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      globalThis.window = new MockNode('window');
      try {
        const eventos = [];
        const renderer = criarRenderer(raiz, {
          onTrocarDificuldade: (chave) => eventos.push(`dificuldade:${chave}`)
        });

        renderer.mostrarMenu({
          modo: 'expandido',
          dificuldade: 'normal',
          dificuldades: PROGRESSAO_CARTAS,
          nomesDificuldade: Object.fromEntries(
            PROGRESSAO_CARTAS.map((chave) => [chave, DIFICULDADES_CARTAS_EXPANDIDO[chave].label])
          )
        });

        const nos = percorrerNo(raiz);
        const modos = nos.filter((no) => no.tagName === 'BUTTON' && no.dataset?.modo)
          .map((no) => no.dataset.modo);
        const dificuldadesLegadas = nos.filter((no) => no.dataset?.diffSmb3);
        assert.deepEqual(modos, []);
        assert.deepEqual(dificuldadesLegadas, []);

        const textos = nos.map((no) => no.textContent).filter(Boolean);
        assert.ok(textos.includes('JOGO DA MEMÓRIA'));
        assert.ok(!textos.some((texto) => /SMB3|Expandido|ESCOLHA O MODO|TROCAR MODO/i.test(texto)),
          'nenhum rótulo de modo inexistente pode aparecer');

        const botaoDificil = encontrarNo(raiz, (no) => no.dataset?.diff === 'dificil');
        botaoDificil.dispatch('click');
        assert.deepEqual(eventos, ['dificuldade:dificil']);

        renderer.destruir();
      } finally {
        globalThis.document = documentAnterior;
        globalThis.window = windowAnterior;
      }
    });

    await test('apresentação legada revela as 18 cartas e não aceita seleção', async () => {
      const raiz = new MockNode('div');
      const documentAnterior = globalThis.document;
      const windowAnterior = globalThis.window;
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      globalThis.window = new MockNode('window');
      try {
        let selecoes = 0;
        const renderer = criarRenderer(raiz, { onSelecionar: () => { selecoes += 1; } });
        const cfg = criarConfigSmb3('facil', criarRng(2));
        const partida = criarPartida(cfg);
        renderer.mostrarApresentacao(cfg, partida.estado());

        const cartas = [];
        for (const no of percorrerNo(raiz)) {
          if (no.classList.contains('cards__card')) cartas.push(no);
        }
        assert.strictEqual(cartas.length, 18);
        assert.strictEqual(cartas.every((c) => c.classList.contains('cards__card--revelada')), true);
        assert.ok(encontrarNo(raiz, (no) => no.classList.contains('cards__memoria-barra')));
        assert.strictEqual(renderer.emApresentacao, true);
        cartas[0].dispatch('click');
        assert.strictEqual(selecoes, 0);
        renderer.destruir();
      } finally {
        globalThis.document = documentAnterior;
        globalThis.window = windowAnterior;
      }
    });

    await test('resultado identifica o Jogo da Memória e mantém as saídas', async () => {
      const raiz = new MockNode('div');
      const documentAnterior = globalThis.document;
      const windowAnterior = globalThis.window;
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      globalThis.window = new MockNode('window');
      try {
        const acoes = [];
        const renderer = criarRenderer(raiz, {});
        const cfg = criarConfigExpandida('facil', criarRng(3));
        renderer.mostrarPartida(cfg, criarPartida(cfg).estado());
        renderer.mostrarResultado({
          titulo: 'DESAFIO CONCLUÍDO!',
          linhas: ['Pares: 9/9'],
          modo: 'expandido',
          dificuldade: 'Fácil',
          botoes: [
            { id: 'rejogar', texto: 'Nova partida', acao: () => acoes.push('rejogar') },
            { id: 'selecao-modos', texto: 'Alterar configurações', acao: () => acoes.push('config') },
            { id: 'home', texto: 'Voltar à coleção', acao: () => acoes.push('home') }
          ]
        });

        for (const id of ['rejogar', 'selecao-modos', 'home']) {
          const botao = encontrarNo(raiz, (no) => no.dataset?.acao === id);
          assert.ok(botao, `botão ${id} não encontrado`);
          botao.dispatch('click');
        }
        assert.deepEqual(acoes, ['rejogar', 'config', 'home']);
        const resultado = encontrarNo(raiz, (no) => no.classList.contains('cards__result'));
        assert.ok(encontrarNo(resultado, (no) => no.textContent === 'JOGO DA MEMÓRIA'));
        assert.ok(encontrarNo(resultado, (no) => no.textContent === 'Dificuldade: Fácil'));
        assert.ok(!percorrerNo(resultado).some((no) => /SMB3|MODO EXPANDIDO/i.test(no.textContent || '')),
          'resultado não pode mostrar modos inexistentes');
        renderer.destruir();
      } finally {
        globalThis.document = documentAnterior;
        globalThis.window = windowAnterior;
      }
    });

    await test('rejogar mantém a dificuldade e trocar dificuldade não afeta o Jogo da Memória', async () => {
      const rng = criarRng(77);
      const original = criarConfigSmb3('dificil', rng);
      const reinicio = criarConfigSmb3(original.dificuldade, criarRng(77));
      assert.strictEqual(reinicio.dificuldade, 'dificil');
      assert.strictEqual(reinicio.tempoMemorizacaoMs, 1500);
      assert.deepEqual(reinicio.cartas, original.cartas);

      const trocada = criarConfigSmb3('facil', criarRng(77));
      assert.strictEqual(trocada.dificuldade, 'facil');
      assert.strictEqual(trocada.tempoMemorizacaoMs, 6000);
      assert.deepEqual(trocada.cartas, original.cartas);

      const expandido = criarConfigExpandida('normal', criarRng(77));
      assert.strictEqual(expandido.dificuldade, 'normal');
      assert.strictEqual(expandido.cartas.length, 30);
      assert.strictEqual(expandido.desafios.length, 4);
    });

    await test('nenhuma referência funcional ao SMB3, iframe ou porta 8771', () => {
      const arquivos = [
        'index.html',
        'src/games/cards/index.js',
        'src/games/cards/renderer.js',
        'src/games/cards/styles.css',
        'styles/main.css',
        'service-worker.js'
      ];
      for (const relativo of arquivos) {
        const fonte = readFileSync(new URL(`../${relativo}`, import.meta.url), 'utf8');
        assert.ok(!fonte.includes('8771'), `${relativo} ainda referencia a porta 8771`);
        assert.ok(!fonte.includes('smb3-original.js'),
          `${relativo} ainda importa o adaptador do jogo original`);
        assert.ok(!/criarAdaptadorSmb3Original|iniciarSmb3Original|onTrocarDificuldadeSmb3|onTrocarModo/.test(fonte),
          `${relativo} ainda tem callback/ fluxo do modo removido`);
        assert.ok(!/createElement\(['"]iframe['"]\)|<iframe/i.test(fonte),
          `${relativo} ainda cria um iframe`);
      }
      const estilosCartas = readFileSync(
        new URL('../src/games/cards/styles.css', import.meta.url), 'utf8');
      assert.ok(!/cards__smb3-/.test(estilosCartas), 'estilos do adaptador devem ser removidos');
    });

    await test('inicialização abre o Jogo da Memória sem tela de seleção de modos', () => {
      const fluxo = readFileSync(
        new URL('../src/games/cards/index.js', import.meta.url), 'utf8');
      assert.ok(/await abrirMenu\(\);/.test(fluxo), 'init deve abrir diretamente o menu do jogo');
      assert.ok(!fluxo.includes("abrirMenu('modos')"), 'fluxo de seleção de modos removido');
      assert.ok(!fluxo.includes('modoAtual'), 'estado do modo removido');
      assert.ok(fluxo.includes("modo: 'expandido'"),
        'identificador interno do jogo permanece estável');
    });
  });
}

// ============================================================================
// CARD MATCH — VISUALIZAÇÃO AMPLIADA DAS CARTAS (EXPANDIDO)
// ============================================================================

/** Renderer com DOM mock e relógio determinístico para a ampliação. */
function criarCenarioAmpliacao() {
  const raiz = new MockNode('div');
  const documentAnterior = globalThis.document;
  const windowAnterior = globalThis.window;
  globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
  globalThis.window = new MockNode('window');
  const ag = criarAgendadorFake();
  const eventos = [];
  // Espelha a ligação feita por cards/index.js: o callback persiste e aplica a
  // escala no renderer já existente, sem recriar a partida.
  const contexto = {};
  const renderer = criarRenderer(raiz, {
    onSelecionar: (id) => eventos.push(`selecao:${id}`),
    onTrocarVisualizacaoCartas: (modo) => eventos.push(`visual:${modo}`),
    onAlterarTamanhoAmpliacao: (valor) => {
      eventos.push(`zoom:${valor}`);
      contexto.renderer?.definirTamanhoAmpliacao(valor);
    }
  }, {
    setTimeout: ag.setTimeoutFake.bind(ag),
    clearTimeout: ag.clearTimeoutFake.bind(ag),
    duracaoAmpliacaoMs: 1750
  });
  contexto.renderer = renderer;
  return {
    raiz,
    ag,
    eventos,
    renderer,
    restaurar() {
      renderer.destruir();
      globalThis.document = documentAnterior;
      globalThis.window = windowAnterior;
    }
  };
}

/** Ids das cartas efetivamente desenhadas na ampliação. */
function idsAmpliados(no) {
  const ids = [];
  for (const atual of percorrerNo(no)) {
    if (atual.dataset?.ampliacaoId) ids.push(atual.dataset.ampliacaoId);
  }
  return ids;
}

function configComVisualizacao(dificuldade, visualizacaoCartas, rng = criarRng(5)) {
  return { ...criarConfigExpandida(dificuldade, rng), visualizacaoCartas };
}

async function grupoVisualizacaoCartas() {
  await grupo('Card Match — visualização ampliada das cartas', async () => {
    await test('três modos válidos e fallback seguro para valores inválidos', async () => {
      assert.strictEqual(VISUALIZACAO_PADRAO, 'original');
      assert.deepEqual(Object.values(VISUALIZACAO_CARTAS), ['original', 'fixa', 'temporaria']);
      for (const modo of Object.values(VISUALIZACAO_CARTAS)) {
        assert.strictEqual(normalizarVisualizacaoCartas(modo), modo);
      }
      for (const invalido of [undefined, null, '', 'INVALIDO', 0, 1, {}, [], 'fixa ']) {
        assert.strictEqual(normalizarVisualizacaoCartas(invalido), 'original');
      }
    });

    await test('instalação existente sem o campo usa original sem alterar o registro', async () => {
      await resetDB();
      await openDatabase();
      const registros = await getAll('settings');
      assert.strictEqual(registros.length, 1);
      assert.strictEqual('visualizacaoCartas' in registros[0], false);
      assert.strictEqual(await obterVisualizacaoCartas(), 'original');
      const depois = await getAll('settings');
      assert.strictEqual('visualizacaoCartas' in depois[0], false, 'ler não deve gravar');
    });

    await test('persistência na store settings, campos preservados e sobrevivência a reload', async () => {
      await resetDB();
      await openDatabase();
      assert.strictEqual(await salvarVisualizacaoCartas('fixa'), 'fixa');
      assert.strictEqual(await obterVisualizacaoCartas(), 'fixa');
      let registros = await getAll('settings');
      assert.strictEqual(registros.length, 1, 'não pode criar store paralela');
      assert.strictEqual(registros[0].dificuldadeCartas, 'normal');
      assert.strictEqual(registros[0].som, true);
      assert.strictEqual(await salvarVisualizacaoCartas('modo-inexistente'), 'original');
      assert.strictEqual(await obterVisualizacaoCartas(), 'original');
      assert.strictEqual(await salvarVisualizacaoCartas('temporaria'), 'temporaria');
      closeDatabase(); // simula recarregar a página / reiniciar o navegador
      assert.strictEqual(await obterVisualizacaoCartas(), 'temporaria');
      registros = await getAll('settings');
      assert.strictEqual(registros.length, 1);
      assert.strictEqual(registros[0].visualizacaoCartas, 'temporaria');
    });

    await test('menu do Expandido oferece três opções e troca sem recarregar', async () => {
      const c = criarCenarioAmpliacao();
      try {
        c.renderer.mostrarMenu({
          modo: 'expandido', dificuldade: 'normal', visualizacaoCartas: 'fixa'
        });
        const opcoes = [];
        for (const no of percorrerNo(c.raiz)) {
          if (no.dataset?.visualizacao) {
            opcoes.push([no.dataset.visualizacao, no.getAttribute('aria-pressed')]);
          }
        }
        assert.deepEqual(opcoes, [
          ['original', 'false'], ['fixa', 'true'], ['temporaria', 'false']
        ]);
        const botao = encontrarNo(c.raiz, (no) => no.dataset?.visualizacao === 'temporaria');
        botao.dispatch('click');
        assert.deepEqual(c.eventos, ['visual:temporaria']);
        await salvarVisualizacaoCartas('temporaria');
        c.renderer.mostrarMenu({
          modo: 'expandido', dificuldade: 'normal', visualizacaoCartas: await obterVisualizacaoCartas()
        });
        const ativa = encontrarNo(c.raiz, (no) => no.classList.contains('cards__visual-opt--ativo'));
        assert.strictEqual(ativa?.dataset.visualizacao, 'temporaria');
      } finally {
        c.restaurar();
      }
    });

    await test('modo original preserva o layout sem área adicional', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = configComVisualizacao('facil', 'original');
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao), null);
        const board = encontrarNo(c.raiz, (no) => no.classList.contains('cards__board'));
        assert.strictEqual(
          board.children.filter((no) => no.classList.contains('cards__card')).length, 18
        );
        partida.selecionar(listarPares(cfg.cartas)[0][0]);
        c.renderer.atualizar(partida.estado(), cfg, 1);
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao), null);
      } finally {
        c.restaurar();
      }
    });

    await test('área fixa fica acima do tabuleiro, atualiza e mostra só cartas reveladas', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = configComVisualizacao('facil', 'fixa');
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        const area = encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'fixa');
        assert.ok(area, 'área fixa não encontrada');
        const indiceArea = area.parentNode.children.indexOf(area);
        const indiceBoard = area.parentNode.children.findIndex(
          (no) => no.classList.contains('cards__board')
        );
        assert.ok(indiceArea >= 0 && indiceBoard >= 0 && indiceArea < indiceBoard,
          'área fixa deve ficar acima do tabuleiro');
        assert.ok(encontrarNo(area, (no) => no.classList.contains('cards__ampliacao-vazio')));
        assert.strictEqual(area.getAttribute('aria-label'), 'Visualização ampliada da carta');

        const pares = listarPares(cfg.cartas);
        partida.selecionar(pares[0][0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.deepEqual(idsAmpliados(area), [String(pares[0][0])]);

        partida.selecionar(pares[1][0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.deepEqual(idsAmpliados(area), [String(pares[1][0])]);

        const oculta = cfg.cartas.find((carta) =>
          !partida.estado().cartas.find((estado) => estado.id === carta.id).revelada);
        assert.ok(oculta);
        assert.ok(!idsAmpliados(area).includes(String(oculta.id)),
          'carta oculta nunca pode ser ampliada');

        partida.resolver(); // pares diferentes: erro, as cartas viram de volta
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.deepEqual(idsAmpliados(area), []);
        assert.ok(encontrarNo(area, (no) => no.classList.contains('cards__ampliacao-vazio')));

        const par = pares[0];
        partida.selecionar(par[0]);
        partida.selecionar(par[1]);
        partida.resolver();
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.deepEqual(idsAmpliados(area), [String(par[1])]);
      } finally {
        c.restaurar();
      }
    });

    await test('ampliação temporária expira, reinicia ao trocar de carta e ignora frames repetidos', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = configComVisualizacao('facil', 'temporaria');
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        const overlay = encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'temporaria');
        assert.ok(overlay);
        assert.strictEqual(overlay.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'fixa'), null);

        const pares = listarPares(cfg.cartas);
        partida.selecionar(pares[0][0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.ok(overlay.classList.contains('cards__ampliacao--visivel'));
        assert.strictEqual(overlay.getAttribute('aria-hidden'), 'false');
        assert.deepEqual(idsAmpliados(overlay), [String(pares[0][0])]);
        assert.strictEqual(c.ag.agendados.length, 1);
        assert.strictEqual(c.ag.agendados[0].ms, 1750);

        partida.selecionar(pares[1][0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.strictEqual(c.ag.agendados[0].cancelado, true, 'timer anterior deve ser cancelado');
        assert.strictEqual(c.ag.agendados.length, 2);
        assert.deepEqual(idsAmpliados(overlay), [String(pares[1][0])]);

        c.renderer.atualizar(partida.estado(), cfg, 0);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        assert.strictEqual(c.ag.agendados.length, 2, 'frames repetidos não reiniciam o timer');

        c.ag.executarTodos();
        assert.ok(!overlay.classList.contains('cards__ampliacao--visivel'));
        assert.strictEqual(overlay.getAttribute('aria-hidden'), 'true');
      } finally {
        c.restaurar();
      }
    });

    await test('tocar em carta revelada amplia sem gerar seleção duplicada', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = configComVisualizacao('facil', 'temporaria');
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        const par = listarPares(cfg.cartas)[0];
        partida.selecionar(par[0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        c.ag.executarTodos(); // ampliação já expirada

        const cartas = [];
        for (const no of percorrerNo(c.raiz)) {
          if (no.classList.contains('cards__card')) cartas.push(no);
        }
        const botao = cartas.find((no) => no.dataset.id === String(par[0]));
        assert.ok(botao);
        const eventosAntes = c.eventos.length;
        const timersAntes = c.ag.agendados.length;
        botao.dispatch('click');
        assert.strictEqual(c.eventos.length, eventosAntes,
          'clique em carta revelada não deve chamar onSelecionar');
        assert.strictEqual(c.ag.agendados.length, timersAntes + 1, 'intervalo deve reiniciar');
        assert.strictEqual(c.ag.agendados[timersAntes].cancelado, false);
        const overlay = encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'temporaria');
        assert.ok(overlay.classList.contains('cards__ampliacao--visivel'));
        assert.deepEqual(idsAmpliados(overlay), [String(par[0])]);

        const oculta = cartas.find((no) =>
          !partida.estado().cartas.find((estado) => estado.id === Number(no.dataset.id)).revelada);
        oculta.dispatch('click');
        assert.ok(c.eventos.includes(`selecao:${oculta.dataset.id}`),
          'carta oculta continua usando o fluxo normal de seleção');
      } finally {
        c.restaurar();
      }
    });

    await test('reinício e conclusão cancelam a ampliação e limpam a área fixa', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = configComVisualizacao('facil', 'temporaria');
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        const par = listarPares(cfg.cartas)[0];
        partida.selecionar(par[0]);
        c.renderer.atualizar(partida.estado(), cfg, 0);
        c.renderer.cancelarAmpliacao(); // simula reinício da partida
        const overlay = encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'temporaria');
        assert.ok(!overlay.classList.contains('cards__ampliacao--visivel'));
        assert.deepEqual(idsAmpliados(overlay), []);
        assert.strictEqual(c.ag.agendados.filter((t) => !t.cancelado && !t.executado).length, 0);

        partida.selecionar(par[1]);
        partida.resolver();
        c.renderer.atualizar(partida.estado(), cfg, 0);
        c.renderer.mostrarResultado({ titulo: 'FIM', modo: 'expandido', botoes: [] });
        assert.ok(!overlay.classList.contains('cards__ampliacao--visivel'));
        assert.deepEqual(idsAmpliados(overlay), []);

        const cfgFixa = configComVisualizacao('facil', 'fixa');
        c.renderer.mostrarPartida(cfgFixa, criarPartida(cfgFixa).estado());
        const area = encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'fixa');
        assert.ok(encontrarNo(area, (no) => no.classList.contains('cards__ampliacao-vazio')));
        c.renderer.mostrarMenu({ modo: 'expandido', visualizacaoCartas: 'fixa' });
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao), null);
      } finally {
        c.restaurar();
      }
    });

    await test('troca de preferência aplica imediatamente no renderer sem recriá-lo', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = { ...criarConfigExpandida('facil', criarRng(17)), visualizacaoCartas: 'original' };
        c.renderer.mostrarPartida(cfg, criarPartida(cfg).estado());
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao), null);
        const salvo = await salvarVisualizacaoCartas('fixa');
        assert.strictEqual(salvo, 'fixa');
        c.renderer.definirVisualizacaoCartas(salvo);
        c.renderer.atualizar(criarPartida(cfg).estado(), { ...cfg, visualizacaoCartas: salvo }, 0);
        assert.ok(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'fixa'));
      } finally {
        c.restaurar();
      }
    });

    await test('cinco dificuldades mantêm regras, cronômetro e comparação intactos', async () => {
      const errosConsole = [];
      const consoleErrorOriginal = console.error;
      console.error = (...args) => errosConsole.push(args.map(String).join(' '));
      try {
        for (const chave of PROGRESSAO_CARTAS) {
          const base = criarConfigExpandida(chave, criarRng(13));
          const cfg = { ...base, visualizacaoCartas: 'fixa' };
          assert.strictEqual(cfg.cartas.length, base.cartas.length);
          assert.strictEqual(cfg.totalPares, base.totalPares);
          assert.strictEqual(cfg.tempoAlvo, base.tempoAlvo);

          const ag = criarAgendadorFake();
          const sessao = criarSessao(cfg, {
            setTimeout: ag.setTimeoutFake.bind(ag),
            clearTimeout: ag.clearTimeoutFake.bind(ag),
            agora: () => 1000
          });
          const par = listarPares(cfg.cartas)[0];
          assert.strictEqual(sessao.selecionar(par[0]).tipo, 'revelado');
          assert.strictEqual(sessao.selecionar(par[1]).tipo, 'comparacao');
          ag.executarTodos();
          const stats = sessao.estatisticas();
          assert.strictEqual(stats.paresEncontrados, 1, `pares em ${chave}`);
          assert.strictEqual(stats.tentativas, 1, `tentativas em ${chave}`);
          assert.strictEqual(stats.erros, 0, `erros em ${chave}`);

          const c = criarCenarioAmpliacao();
          try {
            c.renderer.mostrarPartida(cfg, sessao.estado());
            c.renderer.atualizar(sessao.estado(), cfg, 12);
            const hudTempo = encontrarNo(c.raiz, (no) => no.dataset?.hud === 'tempo');
            assert.strictEqual(hudTempo.textContent, 'Tempo 00:12');
            const board = encontrarNo(c.raiz, (no) => no.classList.contains('cards__board'));
            assert.strictEqual(
              board.children.filter((no) => no.classList.contains('cards__card')).length,
              cfg.totalCartas
            );
            assert.ok(encontrarNo(c.raiz, (no) => no.dataset?.ampliacao === 'fixa'));
          } finally {
            c.restaurar();
          }
          sessao.destruir();
        }
      } finally {
        console.error = consoleErrorOriginal;
      }
      assert.deepEqual(errosConsole, [], 'nenhum erro no console nos cinco cenários');
    });

    await test('CSS cobre telas estreitas, orientação horizontal e reduced motion', async () => {
      const css = readFileSync(new URL('../src/games/cards/styles.css', import.meta.url), 'utf8');
      assert.match(css, /@media\s*\(max-width:\s*560px\)/);
      assert.match(css, /@media\s*\(max-height:\s*480px\)/);
      assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      assert.match(css, /\.cards__ampliacao--temporaria\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*80[^}]*pointer-events:\s*none/s);
      assert.match(css, /aspect-ratio:\s*3\s*\/\s*4/);
      assert.match(css, /\.cards__ampliacao--fixa\s*\{[^}]*max-width:\s*100%/s);
    });
  });
}

// ============================================================================
// CARD MATCH — MODO TENTATIVAS, CHEAT E SELFIES
// ============================================================================

/** Configuração de teste já resolvedora de CHEAT (como faz o integrador). */
function configTentativas(dificuldade, opcoes = {}) {
  const calculo = calcularTentativasIniciais(dificuldade, opcoes.cheat || {});
  return {
    ...criarConfigExpandida(dificuldade, criarRng(opcoes.semente ?? 7), {
      selfies: opcoes.selfies || [],
      modalidade: opcoes.modalidade || 'tentativas',
      cheat: calculo
    }),
    visualizacaoCartas: 'original'
  };
}

/** Dois ids com símbolos diferentes (para forçar um erro). */
function idsDiferentes(config) {
  const simbolos = [...new Set(config.cartas.map((carta) => carta.simbolo))];
  const primeira = config.cartas.find((carta) => carta.simbolo === simbolos[0]);
  const segunda = config.cartas.find((carta) => carta.simbolo === simbolos[1]);
  return [primeira.id, segunda.id];
}

/** Dois ids do mesmo par (para forçar um acerto). */
function idsIguais(config, simbolo = null) {
  const alvo = simbolo || config.cartas[0].simbolo;
  return config.cartas.filter((carta) => carta.simbolo === alvo).slice(0, 2).map((carta) => carta.id);
}

/** Ids das duas cartas de um par de selfie. */
function idsParSelfie(config) {
  const carta = config.cartas.find((item) => item.selfie);
  if (!carta) return [];
  return config.cartas.filter((item) => item.simbolo === carta.simbolo).map((item) => item.id);
}

function resolverPar(partida, ids) {
  partida.selecionar(ids[0]);
  partida.selecionar(ids[1]);
  return partida.resolver();
}

async function grupoModoTentativas() {
  await grupo('Card Match — Modo Tentativas e CHEAT', async () => {
    await test('tabela de tentativas cobre as cinco dificuldades', async () => {
      assert.deepEqual(TENTATIVAS_INICIAIS, {
        facil: 14, normal: 22, dificil: 32, muitodificil: 45, extremo: 60
      });
      for (const chave of PROGRESSAO_CARTAS) {
        const diff = DIFICULDADES_CARTAS_EXPANDIDO[chave];
        assert.strictEqual(tentativasPorDificuldade(chave), TENTATIVAS_INICIAIS[chave]);
        assert.ok(TENTATIVAS_INICIAIS[chave] > diff.pares, `${chave}: precisa haver margem sobre os pares`);
        assert.strictEqual(tentativasPorDificuldade('inexistente'), TENTATIVAS_INICIAIS.normal);
      }
      assert.strictEqual(BONUS_SELFIE_TENTATIVAS, 2);
    });

    await test('CHEAT respeita a prioridade infinitas > personalizada > padrão', async () => {
      assert.deepEqual(resolverCheat({}), {
        tipo: TIPOS_CHEAT.NORMAL, infinitas: false, quantidade: null
      });
      assert.deepEqual(resolverCheat({ personalizada: true, quantidade: 7 }), {
        tipo: TIPOS_CHEAT.PERSONALIZADA, infinitas: false, quantidade: 7
      });
      assert.deepEqual(resolverCheat({ infinitas: true, personalizada: true, quantidade: 7 }), {
        tipo: TIPOS_CHEAT.INFINITAS, infinitas: true, quantidade: null
      });
      assert.strictEqual(normalizarQuantidade(0), 1);
      assert.strictEqual(normalizarQuantidade(1000), 999);
      assert.strictEqual(normalizarQuantidade('abc'), 20);
      assert.strictEqual(normalizarQuantidade('12'), 12);
    });

    await test('cálculo das tentativas iniciais usa CHEAT por dificuldade', async () => {
      for (const chave of PROGRESSAO_CARTAS) {
        const padrao = calcularTentativasIniciais(chave);
        assert.strictEqual(padrao.valor, TENTATIVAS_INICIAIS[chave]);
        assert.strictEqual(padrao.tipo, TIPOS_CHEAT.NORMAL);

        const personalizada = calcularTentativasIniciais(chave, {
          personalizada: true, quantidade: 9
        });
        assert.strictEqual(personalizada.valor, 9);
        assert.strictEqual(personalizada.tipo, TIPOS_CHEAT.PERSONALIZADA);

        const infinitas = calcularTentativasIniciais(chave, {
          infinitas: true, personalizada: true, quantidade: 9
        });
        assert.strictEqual(infinitas.valor, null);
        assert.strictEqual(infinitas.infinitas, true);
        assert.strictEqual(infinitas.tipo, TIPOS_CHEAT.INFINITAS);
      }
    });

    await test('erros consomem tentativas e acertos não consomem', async () => {
      const config = configTentativas('facil');
      const partida = criarPartida(config);
      assert.strictEqual(partida.estado().tentativasRestantes, 14);
      assert.strictEqual(partida.estado().modalidade, 'tentativas');

      const erro = resolverPar(partida, idsDiferentes(config));
      assert.strictEqual(erro.tipo, 'erro');
      assert.strictEqual(erro.erros, 1);
      assert.strictEqual(erro.tentativasRestantes, 13);
      assert.strictEqual(erro.derrota, false);

      const acerto = resolverPar(partida, idsIguais(config));
      assert.strictEqual(acerto.tipo, 'par');
      assert.strictEqual(acerto.erros, 1, 'acerto não conta como erro');
      assert.strictEqual(acerto.tentativasRestantes, 13, 'acerto não consome tentativa');
    });

    await test('par de selfie concede exatamente +2 tentativas uma única vez', async () => {
      const selfies = [{ id: 31, nome: 'Minha cara', imagem: 'data:image/jpeg;base64,QUJD' }];
      const config = configTentativas('normal', { selfies });
      const partida = criarPartida(config);
      const ids = idsParSelfie(config);
      assert.strictEqual(ids.length, 2);

      const antes = partida.estado().tentativasRestantes;
      const resultado = resolverPar(partida, ids);
      assert.strictEqual(resultado.tipo, 'par');
      assert.strictEqual(resultado.tentativasRestantes, antes + BONUS_SELFIE_TENTATIVAS);
      assert.strictEqual(resultado.selfiesPares, 1);
      assert.strictEqual(resultado.bonusSelfies, BONUS_SELFIE_TENTATIVAS);

      // O mesmo par não pode ser encontrado duas vezes: a carta já está pareada.
      const repetido = partida.selecionar(ids[0]);
      assert.strictEqual(repetido.tipo, 'ignorado');
      assert.strictEqual(repetido.bonusSelfies, BONUS_SELFIE_TENTATIVAS);
    });

    await test('esgotamento encerra com derrota e dispara onEsgotado', async () => {
      const config = configTentativas('facil', { cheat: { personalizada: true, quantidade: 1 } });
      const ag = criarAgendadorFake();
      const eventos = [];
      const sessao = criarSessao(config, {
        setTimeout: ag.setTimeoutFake.bind(ag),
        clearTimeout: ag.clearTimeoutFake.bind(ag),
        callbacks: {
          onErro: () => eventos.push('erro'),
          onEsgotado: () => eventos.push('esgotado'),
          onConcluido: () => eventos.push('concluido')
        }
      });
      const ids = idsDiferentes(config);
      sessao.selecionar(ids[0]);
      sessao.selecionar(ids[1]);
      ag.executarTodos();

      assert.deepEqual(eventos, ['erro', 'esgotado']);
      const stats = sessao.estatisticas();
      assert.strictEqual(stats.concluida, true);
      assert.strictEqual(stats.derrota, true);
      assert.strictEqual(stats.tentativasRestantes, 0);
      assert.strictEqual(stats.modalidade, 'tentativas');
      assert.strictEqual(stats.cheat, TIPOS_CHEAT.PERSONALIZADA);
      assert.strictEqual(sessao.estado().selecionadas.length, 0);
      sessao.destruir();
    });

    await test('CHEAT de infinitas nunca esgota nem concede bônus numérico', async () => {
      const selfies = [{ id: 44, nome: 'Eu', imagem: 'data:image/jpeg;base64,QUJD' }];
      const config = configTentativas('facil', { selfies, cheat: { infinitas: true } });
      const partida = criarPartida(config);
      assert.strictEqual(partida.estado().tentativasInfinitas, true);
      assert.strictEqual(partida.estado().tentativasRestantes, null);

      for (let i = 0; i < 5; i += 1) {
        const erro = resolverPar(partida, idsDiferentes(config));
        assert.strictEqual(erro.tipo, 'erro');
        assert.strictEqual(erro.tentativasRestantes, null);
      }
      const par = resolverPar(partida, idsParSelfie(config));
      assert.strictEqual(par.tipo, 'par');
      assert.strictEqual(par.selfiesPares, 1);
      assert.strictEqual(par.tentativasRestantes, null, '∞ permanece sem número');
      assert.strictEqual(partida.estado().derrota, false);
    });

    await test('Modo Pontuação permanece sem orçamento, derrota ou bônus', async () => {
      const config = criarConfigExpandida('facil', criarRng(3));
      const partida = criarPartida(config);
      assert.strictEqual(partida.estado().modalidade, 'pontuacao');
      assert.strictEqual(partida.estado().tentativasRestantes, null);
      assert.strictEqual(partida.estado().derrota, false);

      const erro = resolverPar(partida, idsDiferentes(config));
      assert.strictEqual(erro.tipo, 'erro');
      assert.strictEqual(erro.tentativasRestantes, null);
      assert.strictEqual(erro.derrota, false);
      assert.strictEqual(erro.bonusSelfies, 0);
      assert.strictEqual(partida.estatisticas, undefined);
    });

    await test('vitória termina normalmente antes de esgotar as tentativas', async () => {
      const config = configTentativas('facil');
      const partida = criarPartida(config);
      const simbolos = [...new Set(config.cartas.map((carta) => carta.simbolo))];
      let resultado = null;
      for (const simbolo of simbolos) {
        resultado = resolverPar(partida, idsIguais(config, simbolo));
      }
      assert.strictEqual(resultado.tipo, 'concluido');
      assert.strictEqual(resultado.derrota, false);
      assert.strictEqual(resultado.progresso.pares, config.totalPares);
      assert.strictEqual(resultado.tentativasRestantes, 14, 'sem erros, nenhuma tentativa gasta');
    });

    await test('ehSelfie reconhece o campo explícito e o prefixo do símbolo', async () => {
      assert.strictEqual(ehSelfie({ selfie: true, simbolo: 'cogumelo' }), true);
      assert.strictEqual(ehSelfie({ simbolo: 'selfie-12' }), true);
      assert.strictEqual(ehSelfie({ selfie: false, simbolo: 'flor' }), false);
      assert.strictEqual(ehSelfie(null), false);
    });
  });
}

async function grupoSelfies() {
  await grupo('Card Match — Cartas Selfie no baralho', async () => {
    await test('selfies substituem pares sem alterar total de cartas ou pares', async () => {
      const selfies = [
        { id: 1, nome: 'A', imagem: 'data:image/jpeg;base64,QUJD' },
        { id: 2, nome: 'B', imagem: 'data:image/jpeg;base64,REVG' },
        { id: 3, nome: 'C', imagem: 'data:image/jpeg;base64,R0hJ' }
      ];
      const paresBase = gerarParesExpandido(15);
      const pares = gerarParesExpandido(15, criarRng(1), selfies);

      assert.strictEqual(pares.length, paresBase.length);
      assert.strictEqual(new Set(pares.map((par) => par.id)).size, 15);
      assert.deepEqual(pares.filter((par) => par.selfie).map((par) => par.id).sort(),
        ['selfie-1', 'selfie-2', 'selfie-3']);
      assert.ok(pares.every((par) => par.imagem || par.glyph));
      assert.strictEqual(gerarParesExpandido(15, criarRng(1), []).some((par) => par.selfie), false);
    });

    await test('distribuição é aleatória e cada selfie aparece exatamente duas vezes', async () => {
      const selfies = [{ id: 9, nome: 'Eu', imagem: 'data:image/jpeg;base64,QUJD' }];
      const posicoes = [];
      for (const semente of [1, 2, 3]) {
        const config = configTentativas('facil', { selfies, semente });
        const cartasSelfie = config.cartas.filter((carta) => carta.selfie);
        assert.strictEqual(cartasSelfie.length, 2);
        assert.strictEqual(cartasSelfie[0].simbolo, cartasSelfie[1].simbolo);
        posicoes.push(cartasSelfie.map((carta) => carta.id).join(','));
      }
      assert.ok(new Set(posicoes).size > 1, 'novas partidas devem redistribuir as selfies');
    });

    await test('configuração preserva as cinco dificuldades com selfies ativas', async () => {
      const selfies = [
        { id: 1, nome: 'A', imagem: 'data:image/jpeg;base64,QUJD' },
        { id: 2, nome: 'B', imagem: 'data:image/jpeg;base64,REVG' }
      ];
      for (const chave of PROGRESSAO_CARTAS) {
        const diff = DIFICULDADES_CARTAS_EXPANDIDO[chave];
        const config = criarConfigExpandida(chave, criarRng(4), {
          selfies,
          modalidade: 'tentativas',
          cheat: calcularTentativasIniciais(chave)
        });
        assert.strictEqual(config.cartas.length, diff.cartas);
        assert.strictEqual(config.totalCartas, diff.cartas);
        assert.strictEqual(config.totalPares, diff.pares);
        assert.strictEqual(config.cartas.filter((carta) => carta.selfie).length, 4);
        assert.strictEqual(config.modalidade, 'tentativas');
        assert.strictEqual(config.tentativasIniciais, TENTATIVAS_INICIAIS[chave]);
        assert.strictEqual(config.selfiesPares, 2);
      }
    });

    await test('excesso de selfies nunca aumenta o tabuleiro', async () => {
      const selfies = Array.from({ length: 80 }, (_, indice) => ({
        id: indice + 1, nome: `S${indice + 1}`, imagem: 'data:image/jpeg;base64,QUJD'
      }));
      const config = criarConfigExpandida('facil', criarRng(6), { selfies });
      assert.strictEqual(config.cartas.length, DIFICULDADES_CARTAS_EXPANDIDO.facil.cartas);
      assert.strictEqual(config.cartas.filter((carta) => carta.selfie).length,
        DIFICULDADES_CARTAS_EXPANDIDO.facil.pares * 2);
      assert.strictEqual(new Set(config.cartas.map((carta) => carta.simbolo)).size,
        config.totalPares);
    });

    await test('enquadramento é normalizado e limitado', async () => {
      assert.deepEqual(normalizarEnquadramento(), ENQUADRAMENTO_PADRAO);
      assert.deepEqual(normalizarEnquadramento({ zoom: 9, y: -9 }), { zoom: 2.5, y: -0.5 });
      assert.deepEqual(normalizarEnquadramento({ zoom: 0, y: 9 }), { zoom: 1, y: 0.5 });
      assert.deepEqual(normalizarEnquadramento({ zoom: 'abc', y: null }), ENQUADRAMENTO_PADRAO);
    });

    await test('processamento gera JPEG 320×426 com recorte 3:4', async () => {
      const cenario = criarCenarioImagem();
      try {
        const processada = await processarImagem('data:image/jpeg;base64,QUJD');
        assert.strictEqual(processada.largura, TAMANHO_CARTA.largura);
        assert.strictEqual(processada.altura, TAMANHO_CARTA.altura);
        assert.strictEqual(processada.imagem, 'data:image/jpeg;base64,QUJD');
        assert.strictEqual(processada.tamanhoBytes, 3);
        assert.strictEqual(MIME_SAIDA, 'image/jpeg');
        assert.strictEqual(QUALIDADE_SAIDA, 0.82);
        assert.strictEqual(cenario.desenhos.length, 1);
        const [, , , corteLargura, corteAltura, , , destLargura, destAltura] = cenario.desenhos[0];
        assert.ok(Math.abs((corteLargura / corteAltura) - (320 / 426)) < 0.001);
        assert.strictEqual(destLargura, 320);
        assert.strictEqual(destAltura, 426);
      } finally {
        cenario.restaurar();
      }
    });

    await test('CRUD de selfies cria, ativa, desativa, substitui e exclui', async () => {
      await resetDB();
      await openDatabase();
      const cenario = criarCenarioImagem();
      const arquivo = arquivoImagemFake();
      try {
        const salva = await criarSelfie({ arquivo, nome: 'Minha selfie' });
        assert.ok(Number.isInteger(salva.id));
        assert.strictEqual(salva.nome, 'Minha selfie');
        assert.strictEqual(salva.ativa, true);
        assert.strictEqual(salva.largura, 320);
        assert.strictEqual(salva.altura, 426);

        assert.strictEqual((await listarSelfies()).length, 1);
        const desativada = await definirSelfieAtiva(salva.id, false);
        assert.strictEqual(desativada.ativa, false);
        assert.strictEqual((await listarSelfies()).length, 1, 'desativar não apaga');
        await definirSelfieAtiva(salva.id, true);

        const substituida = await substituirSelfie(salva.id, {
          arquivo, nome: 'Nova foto', enquadramento: { zoom: 1.4, y: 0.2 }
        });
        assert.strictEqual(substituida.id, salva.id);
        assert.strictEqual(substituida.criadoEm, salva.criadoEm);
        assert.strictEqual(substituida.nome, 'Nova foto');
        assert.strictEqual(substituida.ativa, true);

        await excluirSelfie(salva.id);
        assert.strictEqual(await obterSelfie(salva.id), undefined);
        assert.strictEqual((await listarSelfies()).length, 0);
      } finally {
        cenario.restaurar();
      }
    });

    await test('leitura de arquivo rejeita tipo inválido e imagem grande demais', async () => {
      const cenario = criarCenarioImagem();
      try {
        await assert.rejects(
          () => lerArquivoComoDataUrl({ type: 'text/plain', size: 1 }),
          /arquivo de imagem válido/
        );
        await assert.rejects(
          () => lerArquivoComoDataUrl({ type: 'image/jpeg', size: TAMANHO_MAXIMO_ARQUIVO + 1 }),
          /20 MB/
        );
        const lido = await lerArquivoComoDataUrl(arquivoImagemFake());
        assert.strictEqual(lido, 'data:image/jpeg;base64,QUJD');
      } finally {
        cenario.restaurar();
      }
    });
  });
}

async function grupoPreferenciasEStats() {
  await grupo('Card Match — preferências e estatísticas por modalidade', async () => {
    await test('preferências novas têm padrões seguros em instalação antiga', async () => {
      await resetDB();
      await openDatabase();
      const p = await obterPreferenciasCartas();
      assert.strictEqual(p.modalidadeCartas, MODALIDADE_PADRAO);
      assert.strictEqual(MODALIDADE_PADRAO, MODALIDADES_CARTAS.PONTUACAO);
      assert.strictEqual(p.cheatInfinitasCartas, false);
      assert.strictEqual(p.cheatPersonalizadaCartas, false);
      assert.strictEqual(p.cheatQuantidadeCartas, QUANTIDADE_CHEAT_PADRAO);
      assert.strictEqual(p.fxCartasAtivo, true);
      assert.strictEqual(p.bgmCartasAtiva, true);
      assert.deepEqual(p.selfiesAtivas, []);
    });

    await test('normalizadores aceitam apenas valores válidos', async () => {
      assert.strictEqual(normalizarModalidadeCartas('tentativas'), 'tentativas');
      assert.strictEqual(normalizarModalidadeCartas('pontuacao'), 'pontuacao');
      assert.strictEqual(normalizarModalidadeCartas('qualquer'), MODALIDADE_PADRAO);
      assert.strictEqual(normalizarBooleano('sim', true), true);
      assert.strictEqual(normalizarBooleano(false, true), false);
      assert.strictEqual(normalizarQuantidadeCheat(0), 1);
      assert.strictEqual(normalizarQuantidadeCheat(10000), 999);
      assert.strictEqual(normalizarQuantidadeCheat(null), QUANTIDADE_CHEAT_PADRAO);
      assert.deepEqual(normalizarSelfiesAtivas([1, '2', 2, -1, null, 3.5]), [1, 2]);
    });

    await test('salvar preferências preserva campos antigos e não cria store paralela', async () => {
      await resetDB();
      await openDatabase();
      const atualizado = await salvarPreferenciasCartas({
        modalidadeCartas: 'tentativas',
        cheatPersonalizadaCartas: true,
        cheatQuantidadeCartas: 7,
        bgmCartasAtiva: false,
        selfiesAtivas: [4, 4, 5],
        visualizacaoCartas: 'fixa'
      });
      assert.strictEqual(atualizado.modalidadeCartas, 'tentativas');
      assert.strictEqual(atualizado.cheatQuantidadeCartas, 7);
      assert.strictEqual(atualizado.bgmCartasAtiva, false);
      assert.deepEqual(atualizado.selfiesAtivas, [4, 5]);
      assert.strictEqual(atualizado.dificuldadeCartas, 'normal', 'campo antigo preservado');
      assert.strictEqual(atualizado.som, true);

      const registros = await getAll('settings');
      assert.strictEqual(registros.length, 1);
      assert.strictEqual(await obterModalidadeCartas(), 'tentativas');
      assert.deepEqual(await obterAudioCartas(), { fx: true, bgm: false });
      assert.deepEqual(await obterSelfiesAtivas(), [4, 5]);

      await salvarModalidadeCartas('pontuacao');
      await salvarAudioCartas({ fx: false, bgm: true });
      await salvarSelfiesAtivas([9]);
      assert.strictEqual(await obterModalidadeCartas(), 'pontuacao');
      assert.deepEqual(await obterAudioCartas(), { fx: false, bgm: true });
      assert.deepEqual(await obterSelfiesAtivas(), [9]);
    });

    await test('estatísticas antigas não são interpretadas como Modo Tentativas', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        modo: 'expandido', concluida: true, vitoria: true,
        totalCartas: 18, totalPares: 9, paresEncontrados: 9,
        tentativas: 9, erros: 0, playedAt: 1000
      });
      const registro = (await listarPartidas())[0];
      assert.strictEqual(registro.modalidade, null);
      assert.strictEqual(registro.cheat, 'normal');

      const stats = await obterEstatisticas();
      assert.strictEqual(stats.porModalidade.semModalidade, 1);
      assert.strictEqual(stats.porModalidade.tentativas, 0);
      assert.strictEqual(stats.porCheat.normal, 1);
    });

    await test('estatísticas separam modalidade, CHEAT, derrotas e bônus de selfie', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        modo: 'expandido', modalidade: 'pontuacao', concluida: true, vitoria: true,
        totalCartas: 18, totalPares: 9, paresEncontrados: 9, playedAt: 1000
      });
      await registrarPartida({
        modo: 'expandido', modalidade: 'tentativas', cheat: 'infinitas',
        concluida: true, vitoria: true, totalCartas: 18, totalPares: 9,
        paresEncontrados: 9, selfiesPares: 2, bonusSelfies: 4,
        tentativasRestantes: null, playedAt: 2000
      });
      await registrarPartida({
        modo: 'expandido', modalidade: 'tentativas', cheat: 'personalizada',
        concluida: true, vitoria: false, totalCartas: 18, totalPares: 9,
        paresEncontrados: 4, tentativasRestantes: 0, playedAt: 3000
      });

      const stats = await obterEstatisticas();
      assert.strictEqual(stats.partidas, 3);
      assert.strictEqual(stats.porModalidade.pontuacao, 1);
      assert.strictEqual(stats.porModalidade.tentativas, 2);
      assert.strictEqual(stats.porModalidade.semModalidade, 0);
      assert.strictEqual(stats.porCheat.normal, 1);
      assert.strictEqual(stats.porCheat.infinitas, 1);
      assert.strictEqual(stats.porCheat.personalizada, 1);
      assert.strictEqual(stats.derrotas, 1);
      assert.strictEqual(stats.selfiesPares, 2);
      assert.strictEqual(stats.bonusSelfies, 4);
      const derrota = (await listarPartidas()).find((p) => p.cheat === 'personalizada');
      assert.strictEqual(derrota.tentativasRestantes, 0);
    });
  });
}

async function grupoBancoV2() {
  await grupo('Banco v2/v3/v4 e compatibilidade de backup', async () => {
    await test('versão 4 preserva selfies e adiciona as stores isoladas do MQ', async () => {
      await resetDB();
      const db = await openDatabase();
      assert.strictEqual(DB_VERSION, 4);
      assert.strictEqual(DB_VERSION_ATUAL, 4);
      for (const nome of ['selfies', 'mqWallet', 'mqTransactions', 'mqSessions']) {
        assert.ok(STORES.includes(nome), `store ${nome} ausente em STORES`);
        assert.strictEqual(db.objectStoreNames.contains(nome), true, `store ${nome} ausente no DB`);
      }
      assert.strictEqual(db.version, 4);

      const loja = db._stores.get('selfies');
      assert.strictEqual(loja._indexes.has('createdAt'), true);
      assert.strictEqual(loja._indexes.has('ativa'), true);
      const transacoes = db._stores.get('mqTransactions');
      assert.strictEqual(transacoes._indexes.has('sessionId'), true);
      assert.strictEqual(transacoes._indexes.get('sessionId').unique, false,
        'sessionId de mqTransactions deve aceitar várias linhas por partida');
      assert.strictEqual(transacoes._indexes.has('sessionIdTipo'), true);
      assert.strictEqual(transacoes._indexes.get('sessionIdTipo').unique, true);
      const sessoes = db._stores.get('mqSessions');
      assert.strictEqual(sessoes._indexes.has('sessionId'), true);
      assert.strictEqual(sessoes._indexes.get('sessionId').unique, true,
        'idempotência depende do índice único de mqSessions');

      // Seed aditivo: exatamente um registro nas stores antigas e na nova.
      assert.strictEqual((await getAll('profile')).length, 1);
      assert.strictEqual((await getAll('wallet')).length, 1);
      assert.strictEqual((await getAll('settings')).length, 1);
      assert.strictEqual((await getAll('mqWallet')).length, 1);
      assert.strictEqual((await obterSaldoMQ()), 0);
      const metadata = await getAll('metadata');
      assert.strictEqual(metadata[0].versaoBanco, 4);
    });

    await test('exportação inclui selfies e restauração antiga preserva a store', async () => {
      await resetDB();
      await openDatabase();
      const id = await put('selfies', {
        nome: 'Guardada', imagem: 'data:image/jpeg;base64,QUJD',
        largura: 320, altura: 426, criadoEm: 1000, ativa: true
      });
      const backup = await exportarProgresso();
      assert.ok(Array.isArray(backup.stores.selfies));
      assert.strictEqual(backup.stores.selfies.length, 1);
      for (const nome of ['mqWallet', 'mqTransactions', 'mqSessions']) {
        assert.ok(Array.isArray(backup.stores[nome]), `backup não exportou ${nome}`);
      }

      await liquidarSessaoMQ({
        sessionId: 'preservar_backup_v1',
        dificuldade: 'facil',
        modalidade: 'pontuacao',
        vitoria: true,
        elegivel: true,
        paresEncontrados: 1,
        somaMultiplicadores: 1
      });
      assert.ok((await obterSaldoMQ()) > 0);

      const backupAntigo = {
        formato: FORMATO_VERSION,
        versaoBanco: 1,
        geradoEm: Date.now(),
        stores: {
          profile: [], wallet: [{ saldo: 42 }], transactions: [], games: [],
          matches: [], inventory: [], achievements: [], settings: [], metadata: []
        }
      };
      const validacao = validarEstrutura(backupAntigo);
      assert.strictEqual(validacao.valido, true, validacao.erros.join(', '));
      const resultado = await importarProgresso(backupAntigo);
      assert.strictEqual(resultado.ok, true);
      const selfie = await get('selfies', id);
      assert.ok(selfie, 'backup v1 não pode apagar selfies existentes');
      assert.strictEqual(selfie.nome, 'Guardada');
      const preservada = resultado.resumo.find((item) => item.store === 'selfies');
      assert.strictEqual(preservada.preservada, true);
      assert.ok((await obterSaldoMQ()) > 0, 'backup v1 não pode apagar a economia isolada');
      for (const nome of ['mqWallet', 'mqTransactions', 'mqSessions']) {
        const item = resultado.resumo.find((entry) => entry.store === nome);
        assert.strictEqual(item.preservada, true, `${nome} deveria ser preservada`);
      }
    });
  });
}

/** Image/FileReader/canvas mínimos para exercitar o processamento no Node. */
function criarCenarioImagem() {
  const anterior = {
    document: globalThis.document,
    Image: globalThis.Image,
    FileReader: globalThis.FileReader
  };
  const desenhos = [];

  globalThis.Image = class ImageFake {
    constructor() {
      this.naturalWidth = 640;
      this.naturalHeight = 480;
    }
    set src(valor) {
      this._src = valor;
      setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
  };

  globalThis.FileReader = class FileReaderFake {
    readAsDataURL(arquivo) {
      this.result = arquivo.conteudo;
      setTimeout(() => this.onload?.({ target: this }), 0);
    }
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        imageSmoothingEnabled: false,
        drawImage(...args) { desenhos.push(args); }
      };
    },
    toDataURL() { return 'data:image/jpeg;base64,QUJD'; }
  };
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? canvas : new MockNode(tag))
  };

  return {
    desenhos,
    restaurar() {
      globalThis.document = anterior.document;
      globalThis.Image = anterior.Image;
      globalThis.FileReader = anterior.FileReader;
    }
  };
}

function arquivoImagemFake() {
  return {
    type: 'image/jpeg',
    size: 2048,
    conteudo: 'data:image/jpeg;base64,QUJD'
  };
}

/** AudioContext falso: registra cada oscilador para provar independência FX/BGM. */
function criarAudioFake(registros) {
  return class AudioContextFake {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
      this._volume = 0;
    }
    createOscillator() {
      const contexto = this;
      return {
        type: 'square',
        frequency: { value: 0 },
        connect() {},
        start() {
          registros.push({
            tipo: this.type,
            frequencia: this.frequency.value,
            volume: contexto._volume
          });
        },
        stop() {}
      };
    }
    createGain() {
      const contexto = this;
      return {
        gain: {
          setValueAtTime(valor) { contexto._volume = valor; },
          exponentialRampToValueAtTime() {}
        },
        connect() {}
      };
    }
    resume() {}
  };
}

/** Renderer com AudioContext, setInterval e DOM controlados pelos testes. */
function criarCenarioRendererNovo(callbacks = {}, opcoes = {}) {
  const raiz = new MockNode('div');
  const anterior = {
    document: globalThis.document,
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    FileReader: globalThis.FileReader
  };
  const intervalos = [];
  const ag = criarAgendadorFake();
  globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
  const janela = new MockNode('window');
  janela.confirm = () => true;
  janela.AudioContext = opcoes.AudioContext || null;
  globalThis.window = janela;
  globalThis.setInterval = (fn, ms) => {
    const item = { fn, ms, cancelado: false };
    intervalos.push(item);
    return item;
  };
  globalThis.clearInterval = (id) => {
    if (id && typeof id === 'object') id.cancelado = true;
  };

  const renderer = criarRenderer(raiz, callbacks, {
    setTimeout: ag.setTimeoutFake.bind(ag),
    clearTimeout: ag.clearTimeoutFake.bind(ag)
  });
  return {
    raiz,
    renderer,
    intervalos,
    ag,
    restaurar() {
      renderer.destruir();
      globalThis.document = anterior.document;
      globalThis.window = anterior.window;
      globalThis.setInterval = anterior.setInterval;
      globalThis.clearInterval = anterior.clearInterval;
      globalThis.FileReader = anterior.FileReader;
    }
  };
}

async function grupoAudioEInterface() {
  await grupo('Card Match — áudio independente e nova interface', async () => {
    await test('FX e BGM são independentes e BGM não reinicia ao mudar só FX', async () => {
      const registros = [];
      const cenario = criarCenarioRendererNovo({}, { AudioContext: criarAudioFake(registros) });
      try {
        const renderer = cenario.renderer;
        assert.deepEqual(renderer.definirAudio({ fx: false, bgm: true }), { fx: false, bgm: true });
        assert.strictEqual(cenario.intervalos.length, 1);

        renderer.som('mover');
        assert.strictEqual(registros.length, 0, 'FX desligado não toca efeitos');
        cenario.intervalos[0].fn();
        assert.strictEqual(registros.length, 1, 'BGM toca mesmo com FX desligado');
        assert.strictEqual(registros[0].tipo, 'triangle');
        // Base 0.05 × volume padrão da BGM (65%) = 0.0325.
        assert.ok(Math.abs(registros[0].volume - 0.0325) < 1e-9,
          `volume inesperado da BGM: ${registros[0].volume}`);

        renderer.definirAudio({ fx: false, bgm: true });
        renderer.definirAudio({ fx: true, bgm: true });
        assert.strictEqual(cenario.intervalos.length, 1, 'mesmo valor de BGM não recria o intervalo');

        renderer.som('mover');
        assert.strictEqual(registros.length, 2);
        assert.strictEqual(registros[1].frequencia, 280);
        assert.strictEqual(registros[1].tipo, 'square');

        renderer.definirAudio({ fx: true, bgm: false });
        assert.strictEqual(cenario.intervalos[0].cancelado, true);
      } finally {
        cenario.restaurar();
      }
    });

    await test('menu do Expandido expõe modalidade, CHEAT, áudio e galeria', async () => {
      const eventos = [];
      const cenario = criarCenarioRendererNovo({
        onTrocarModalidade: (valor) => eventos.push(`modalidade:${valor}`),
        onAlternarCheatInfinitas: () => eventos.push('infinitas'),
        onAlternarCheatPersonalizada: () => eventos.push('personalizada'),
        onAlterarQuantidadeCheat: (valor) => eventos.push(`quantidade:${valor}`),
        onAlternarAudio: (chave, ativo) => eventos.push(`audio:${chave}:${ativo}`),
        onAbrirSelfies: () => eventos.push('galeria')
      });
      try {
        cenario.renderer.mostrarMenu({
          modo: 'expandido',
          modalidade: 'tentativas',
          cheat: { infinitas: false, personalizada: true, quantidade: 7 },
          audioPreferencias: { fx: true, bgm: true },
          selfies: [{ id: 1, nome: 'Eu', imagem: 'data:image/jpeg;base64,QUJD' }],
          selfiesAtivas: [1],
          estatisticas: {
            partidas: 3, concluidas: 2,
            porModo: { classico: 1, expandido: 2 }
          },
          estatisticasModalidade: { pontuacao: 1, tentativas: 2 },
          dificuldades: PROGRESSAO_CARTAS,
          nomesDificuldade: Object.fromEntries(
            PROGRESSAO_CARTAS.map((chave) => [chave, DIFICULDADES_CARTAS_EXPANDIDO[chave].label])
          )
        });

        const no = (predicado) => encontrarNo(cenario.raiz, predicado);
        assert.ok(no((item) => item.dataset?.modalidade === 'tentativas'));
        assert.ok(no((item) => item.dataset?.cheat === 'infinitas'));
        assert.ok(no((item) => item.dataset?.cheat === 'personalizada'));
        assert.strictEqual(
          no((item) => item.dataset?.cheatQuantidade === 'true')?.value, '7');
        assert.ok(no((item) => item.dataset?.audio === 'fx'));
        assert.ok(no((item) => item.dataset?.audio === 'bgm'));
        assert.ok(no((item) => item.dataset?.acao === 'minhas-cartas'));
        const textoStats = percorrerNo(no((item) => item.className === 'cards__stats'))
          .map((item) => item.textContent).join(' ');
        assert.match(textoStats, /Tentativas: 2/);

        no((item) => item.dataset?.modalidade === 'tentativas').click();
        no((item) => item.dataset?.cheat === 'infinitas').click();
        no((item) => item.dataset?.cheat === 'personalizada').click();
        no((item) => item.dataset?.acao === 'minhas-cartas').click();
        const campo = no((item) => item.dataset?.cheatQuantidade === 'true');
        campo.value = '11';
        campo.dispatch('change');
        const bgm = no((item) => item.dataset?.audio === 'bgm');
        bgm.click();

        assert.deepEqual(eventos, [
          'modalidade:tentativas', 'infinitas', 'personalizada', 'galeria',
          'quantidade:11', 'audio:bgm:false'
        ]);
      } finally {
        cenario.restaurar();
      }
    });

    await test('resultado não duplica o som já tocado nos callbacks', async () => {
      const registros = [];
      const cenario = criarCenarioRendererNovo({}, { AudioContext: criarAudioFake(registros) });
      try {
        const cfg = configTentativas('facil');
        cenario.renderer.mostrarPartida(cfg, criarPartida(cfg).estado());
        const antes = registros.length;

        cenario.renderer.mostrarResultado({
          titulo: 'FIM DAS TENTATIVAS', modo: 'expandido', botoes: [],
          somVitoria: false, tocarSom: false
        });
        assert.strictEqual(registros.length, antes, 'tocarSom:false não toca nada');

        cenario.renderer.mostrarResultado({
          titulo: 'DESAFIO CONCLUÍDO!', modo: 'expandido', botoes: [],
          somVitoria: true, tocarSom: false
        });
        assert.strictEqual(registros.length, antes, 'som de vitória fica só no callback');
      } finally {
        cenario.restaurar();
      }
    });

    await test('HUD mostra contador de tentativas ou infinito', async () => {
      const cenario = criarCenarioRendererNovo();
      try {
        const config = configTentativas('facil');
        cenario.renderer.mostrarPartida(config, criarPartida(config).estado());
        const hud = encontrarNo(cenario.raiz, (item) => item.dataset?.hud === 'tentativas');
        assert.strictEqual(hud.textContent, 'TENTATIVAS: 14');
        assert.strictEqual(hud.className.includes('cards__hud-item--tentativas'), true);

        const infinitas = configTentativas('facil', { cheat: { infinitas: true } });
        cenario.renderer.mostrarPartida(infinitas, criarPartida(infinitas).estado());
        const hudInfinito = encontrarNo(cenario.raiz, (item) => item.dataset?.hud === 'tentativas');
        assert.strictEqual(hudInfinito.textContent, 'TENTATIVAS: ∞');
      } finally {
        cenario.restaurar();
      }
    });

    await test('galeria oferece câmera/galeria e dispara ações com confirmação', async () => {
      const eventos = [];
      const cenario = criarCenarioRendererNovo({
        onAlternarSelfie: (id, ativa) => eventos.push(`alternar:${id}:${ativa}`),
        onExcluirSelfie: (id) => eventos.push(`excluir:${id}`),
        onSubstituirSelfie: (selfie) => eventos.push(`substituir:${selfie.id}`),
        onVoltarSelfies: () => eventos.push('voltar')
      });
      try {
        cenario.renderer.mostrarSelfies({
          selfies: [{ id: 3, nome: 'Eu', imagem: 'data:image/jpeg;base64,QUJD' }],
          ativas: []
        });
        const arquivos = percorrerNo(cenario.raiz).filter((item) => item.tagName === 'INPUT');
        assert.strictEqual(arquivos.length, 2);
        assert.ok(arquivos.every((item) => item.type === 'file' && item.accept === 'image/*'));
        assert.ok(arquivos.some((item) => item.getAttribute('capture')));

        const acao = (nome) => encontrarNo(cenario.raiz, (item) => item.dataset?.selfieAcao === nome);
        acao('alternar').click();
        acao('excluir').click();
        acao('substituir').click();
        encontrarNo(cenario.raiz, (item) => item.textContent === '← Voltar às configurações').click();
        assert.deepEqual(eventos, ['alternar:3:true', 'excluir:3', 'substituir:3', 'voltar']);
        assert.ok(encontrarNo(cenario.raiz, (item) => item.className?.includes?.('cards__selfie-img')));
      } finally {
        cenario.restaurar();
      }
    });

    await test('câmera prefere frontal, galeria mantém importação e cancelar não altera selfies', async () => {
      const eventos = [];
      const cenario = criarCenarioRendererNovo({
        onNovaSelfie: ({ origem }) => eventos.push(`nova:${origem}`)
      });
      try {
        cenario.renderer.mostrarSelfies({
          selfies: [{ id: 7, nome: 'Guardada', imagem: 'data:image/jpeg;base64,QUJD' }],
          ativas: [7]
        });
        const inputs = percorrerNo(cenario.raiz)
          .filter((item) => item.tagName === 'INPUT' && item.type === 'file');
        const camera = inputs.find((item) => item.getAttribute('aria-label') === '📷 Tirar foto');
        const galeria = inputs.find((item) => item.getAttribute('aria-label') === '🖼️ Escolher da galeria');
        assert.strictEqual(camera.getAttribute('capture'), 'user', 'frontal é a preferência');
        assert.strictEqual(galeria.getAttribute('capture'), undefined, 'galeria segue sem capture');
        assert.ok(inputs.every((item) => item.accept === 'image/*' && item.parentNode));

        const miniatura = encontrarNo(cenario.raiz,
          (item) => item.className?.includes?.('cards__selfie-img'));
        assert.ok(miniatura, 'selfie já salva continua visível');

        camera.dispatch('cancel');
        camera.dispatch('change');
        assert.deepEqual(eventos, [], 'cancelar ou change vazio não abrem editor nem apagam dados');
        assert.strictEqual(encontrarNo(cenario.raiz,
          (item) => item.className?.includes?.('cards__selfie-img')), miniatura);

        galeria.files = [arquivoImagemFake()];
        galeria.dispatch('change');
        assert.deepEqual(eventos, ['nova:galeria'], 'importação pela galeria continua funcionando');

        camera.files = [arquivoImagemFake()];
        camera.dispatch('change');
        assert.deepEqual(eventos, ['nova:galeria', 'nova:camera'], 'captura continua entregando o arquivo');
      } finally {
        cenario.restaurar();
      }
    });

    await test('editor de selfie gera preview e envia nome/enquadramento ao salvar', async () => {
      const eventos = [];
      const cenario = criarCenarioRendererNovo({
        onSalvarSelfie: (dados) => eventos.push(dados),
        onVoltarSelfies: () => eventos.push('cancelar')
      });
      globalThis.FileReader = class {
        readAsDataURL() {
          this.result = 'data:image/jpeg;base64,QUJD';
          setTimeout(() => this.onload?.({ target: this }), 0);
        }
      };
      try {
        const arquivo = arquivoImagemFake();
        cenario.renderer.mostrarEditorSelfie({ arquivo });
        const no = (predicado) => encontrarNo(cenario.raiz, predicado);
        const zoom = no((item) => item.dataset?.enquadramento === 'zoom');
        const y = no((item) => item.dataset?.enquadramento === 'y');
        const nome = no((item) => item.dataset?.nomeSelfie === 'true');
        zoom.value = '1.5';
        y.value = '0.25';
        nome.value = 'Foto nova';
        zoom.dispatch('input');
        y.dispatch('input');
        const preview = no((item) => item.className === 'cards__editor-preview');
        assert.strictEqual(preview.style.getPropertyValue('--selfie-zoom'), '1.5');
        assert.strictEqual(preview.style.getPropertyValue('--selfie-y'), '0.25');

        no((item) => item.textContent === 'Salvar carta').click();
        assert.strictEqual(eventos.length, 1);
        assert.strictEqual(eventos[0].nome, 'Foto nova');
        assert.deepEqual(eventos[0].enquadramento, { zoom: 1.5, y: 0.25 });
        assert.strictEqual(eventos[0].arquivo, arquivo);
      } finally {
        cenario.restaurar();
      }
    });

    await test('CSS cobre modalidade, CHEAT, galeria, editor e reduced motion', async () => {
      const css = readFileSync(new URL('../src/games/cards/styles.css', import.meta.url), 'utf8');
      for (const seletor of [
        '.cards__bloco', '.cards__modalidade', '.cards__cheat', '.cards__audio-config',
        '.cards__hud-item--tentativas', '.cards__selfies-grade', '.cards__selfie-item--ativa',
        '.cards__selfie-miniatura', '.cards__selfie-img', '.cards__selfie-acoes',
        '.cards__toggle--perigo', '.cards__editor-caixa', '.cards__editor-preview',
        '.cards__editor-controles', '.cards__carta-selfie'
      ]) {
        assert.ok(css.includes(seletor), `seletor ausente: ${seletor}`);
      }
      assert.match(css, /\.cards__editor-caixa\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
      assert.match(css, /\.cards__selfie-img\s*\{[^}]*object-fit:\s*cover/s);
      assert.match(css, /\.cards__editor-preview\s*\{[^}]*--selfie-zoom/s);
      assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*\.cards__selfies-grade/);
      assert.match(css, /@media\s*\(max-height:\s*480px\)[\s\S]*\.cards__editor-caixa/);
      assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.cards__editor-preview/);
    });
  });
}

// ============================================================================
// AUDITORIA — DOM REALISTA, MIGRAÇÃO v1→v2, INPUT E SERVICE WORKER
// ============================================================================

/** Transforma `children` em algo sem `.filter`, como o HTMLCollection do DOM. */
function comoHtmlCollection(node) {
  const filhos = node.children;
  Object.defineProperty(node, 'children', {
    configurable: true,
    get() {
      const colecao = { length: filhos.length };
      filhos.forEach((filho, indice) => { colecao[indice] = filho; });
      colecao[Symbol.iterator] = function* iterar() { yield* filhos; };
      return colecao;
    },
    set(valor) {
      filhos.length = 0;
      valor.forEach((filho) => filhos.push(filho));
    }
  });
  node.appendChild = (filho) => { filho.parentNode = node; filhos.push(filho); return filho; };
  node.replaceChildren = (...nos) => {
    filhos.forEach((filho) => { filho.parentNode = null; });
    filhos.length = 0;
    nos.forEach((filho) => { filho.parentNode = node; filhos.push(filho); });
  };
  return node;
}

async function grupoAuditoria() {
  await grupo('Auditoria — DOM fiel, migração e offline', async () => {
    await test('fechar ampliação funciona com HTMLCollection (sem .filter)', async () => {
      const cenario = criarCenarioRendererNovo();
      comoHtmlCollection(cenario.raiz);
      try {
        cenario.renderer.mostrarSelfies({
          selfies: [{ id: 1, nome: 'Eu', imagem: 'data:image/jpeg;base64,QUJD' }],
          ativas: []
        });
        const ampliar = encontrarNo(cenario.raiz, (no) => no.dataset?.selfieAcao === 'ampliar');
        assert.ok(ampliar);
        ampliar.click();
        assert.ok(encontrarNo(cenario.raiz, (no) => no.dataset?.ampliacaoSelfie === 'true'));

        const overlay = encontrarNo(cenario.raiz, (no) => no.dataset?.ampliacaoSelfie === 'true');
        cenario.ag.executarTodos();
        assert.strictEqual(
          encontrarNo(cenario.raiz, (no) => no.dataset?.ampliacaoSelfie === 'true'),
          null,
          'overlay precisa ser removido sem TypeError'
        );
        assert.strictEqual(overlay?.parentNode, null);
      } finally {
        cenario.restaurar();
      }
    });

    await test('listeners de teclado não acumulam entre partidas', async () => {
      const cenario = criarCenarioRendererNovo();
      const janela = globalThis.window;
      const total = () => janela._listeners.get('keydown')?.size || 0;
      try {
        const cfg1 = configTentativas('facil');
        cenario.renderer.mostrarPartida(cfg1, criarPartida(cfg1).estado());
        assert.strictEqual(total(), 1);

        const cfg2 = configTentativas('facil', { semente: 99 });
        cenario.renderer.mostrarPartida(cfg2, criarPartida(cfg2).estado());
        assert.strictEqual(total(), 1, 'nova partida substitui o listener anterior');

        cenario.renderer.mostrarMenu({ modo: 'expandido' });
        assert.strictEqual(total(), 0, 'voltar ao menu remove o listener da partida');
      } finally {
        cenario.restaurar();
      }
    });

    await test('erro de selfie aparece na galeria e no editor', async () => {
      const cenario = criarCenarioRendererNovo();
      globalThis.FileReader = class {
        readAsDataURL() {
          this.result = 'data:image/jpeg;base64,QUJD';
          setTimeout(() => this.onload?.({ target: this }), 0);
        }
      };
      try {
        cenario.renderer.mostrarSelfies({ selfies: [], ativas: [] });
        cenario.renderer.mostrarErroSelfie('Quota excedida');
        let aviso = encontrarNo(cenario.raiz, (no) => no.dataset?.selfieErro === 'true');
        assert.ok(aviso, 'aviso deve aparecer na galeria');
        assert.strictEqual(aviso.textContent, 'Quota excedida');

        cenario.renderer.mostrarEditorSelfie({ arquivo: arquivoImagemFake() });
        cenario.renderer.mostrarErroSelfie('Imagem inválida');
        aviso = encontrarNo(cenario.raiz, (no) => no.dataset?.selfieErro === 'true');
        assert.ok(aviso, 'aviso deve aparecer no editor');
        assert.strictEqual(aviso.textContent, 'Imagem inválida');
      } finally {
        cenario.restaurar();
      }
    });

    await test('migração v1 → v4 cria stores novas sem reaplicar seed nem apagar dados', async () => {
      closeDatabase();
      mockIndexedDB.deleteDatabase('ArcadeCollection');
      const storeAntigas = STORES.filter((item) =>
        !['selfies', 'mqWallet', 'mqTransactions', 'mqSessions'].includes(item));
      const dbV1 = new IDBDatabase('ArcadeCollection', 1);
      for (const nome of storeAntigas) {
        dbV1.createObjectStore(nome, { keyPath: 'id', autoIncrement: true });
      }
      MOCK_DBS.set('ArcadeCollection', dbV1);
      dbV1._stores.get('profile').add({ id: 1, nome: 'Jogador V1' });
      dbV1._stores.get('wallet').add({ id: 1, saldo: 55 });
      dbV1._stores.get('settings').add({ id: 1, som: false, dificuldadePlinko: 'dificil' });
      dbV1._stores.get('metadata').add({ id: 1, versaoBanco: 1, integridade: 'ok' });

      const db = await openDatabase();
      assert.strictEqual(db.version, 4);
      for (const nome of ['selfies', 'mqWallet', 'mqTransactions', 'mqSessions']) {
        assert.strictEqual(db.objectStoreNames.contains(nome), true, `falta criar ${nome}`);
      }
      assert.strictEqual((await getAll('profile')).length, 1);
      assert.strictEqual((await getAll('profile'))[0].nome, 'Jogador V1');
      assert.strictEqual((await getAll('wallet'))[0].saldo, 55, 'carteira legada intacta');
      assert.strictEqual((await getAll('mqWallet')).length, 1);
      assert.strictEqual((await obterSaldoMQ()), 0);
      const ajustes = await getAll('settings');
      assert.strictEqual(ajustes.length, 1);
      assert.strictEqual(ajustes[0].som, false, 'seed não pode reaplicar sobre dados antigos');
      const metadata = await getAll('metadata');
      assert.strictEqual(metadata.length, 1);
      assert.strictEqual(metadata[0].versaoBanco, 4);
    });

    await test('service worker usa cache v19 com ícones, economia e estatísticas', async () => {
      const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
      assert.match(sw, /const CACHE_NAME = 'memory-quest-v19'/);
      assert.ok(!sw.includes('smb3-original.js'), 'adaptador removido do precache');
      const lista = sw.match(/const ESSENTIAL_ASSETS = \[([\s\S]*?)\];/)[1];
      const assets = lista.match(/'\.\/[^']*'/g);
      assert.strictEqual(assets.length, 47, 'precache contém os 47 assets ativos');
      assert.ok(!sw.includes("'./src/games/cards/classic.js'"),
        'módulo legado removido do precache');
      for (const modulo of [
        './src/core/selfies.js',
        './src/core/mq-economy.js',
        './src/core/migrations.js',
        './src/core/settings.js',
        './src/core/profile.js',
        './src/ui/profile.js',
        './src/core/game-stats.js',
        './src/core/stats-insights.js',
        './src/ui/charts.js',
        './src/games/cards/tentativas.js',
        './src/games/cards/recompensas.js',
        './src/games/cards/previa.js',
        './src/games/cards/renderer.js',
        './src/games/cards/styles.css'
      ]) {
        assert.ok(sw.includes(`'${modulo}'`), `ausente no precache: ${modulo}`);
      }
    });
  });
}

async function grupoIdentidade() {
  await grupo('Memory Quest — identidade e navegação', async () => {
    await test('nome visível, título e manifesto usam Memory Quest', async () => {
      const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
      const manifesto = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
      assert.ok(html.includes('<title>Memory Quest</title>'));
      assert.ok(html.includes('MEMORY<span class="logo__accent"> QUEST</span>'));
      assert.ok(html.includes('Instalar Memory Quest'));
      assert.ok(html.includes('Memory Quest Alpha — local &amp; offline'));
      assert.strictEqual(manifesto.name, 'Memory Quest');
      assert.strictEqual(manifesto.short_name, 'Memory Quest');
      assert.match(manifesto.description, /memória/);
    });

    await test('navegação principal não oferece Plinko e inclui os cinco destinos', async () => {
      const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
      const nav = html.slice(html.indexOf('<nav class="nav-bottom"'), html.indexOf('</nav>'));
      assert.ok(!nav.includes('Plinko'), 'Plinko fora da navegação principal');
      for (const rotulo of ['Jogar', 'Perfil', 'Minhas Cartas', 'Configurações', 'Estatísticas']) {
        assert.ok(nav.includes(rotulo), `destino ausente: ${rotulo}`);
      }
      assert.ok(nav.includes('data-foco="selfies"'));
      assert.ok(html.includes('id="area-settings"'));
      assert.ok(html.includes('id="area-stats"'));
      assert.ok(html.includes('id="area-plinko"'), 'Plinko preservado no DOM');
      assert.ok(html.includes('id="area-shop"'), 'Loja preservada no DOM');
    });

    await test('router preserva áreas legadas e aceita novas áreas', async () => {
      const fonte = readFileSync(new URL('../src/app/router.js', import.meta.url), 'utf8');
      for (const area of ['plinko', 'shop', 'cards', 'profile', 'settings', 'stats']) {
        assert.ok(fonte.includes(`'${area}'`), `área ausente no router: ${area}`);
      }
      assert.ok(fonte.includes('getFocoAtual'));
    });

    await test('painéis adicionais e loja estão integrados ao bootstrap', async () => {
      const main = readFileSync(new URL('../src/app/main.js', import.meta.url), 'utf8');
      assert.ok(main.includes('renderizarConfiguracoes'));
      assert.ok(main.includes('renderizarEstatisticas'));
      assert.ok(main.includes('cardsAbrirGaleria'));
      assert.ok(main.includes('btn-abrir-loja'));
      const cards = readFileSync(new URL('../src/games/cards/index.js', import.meta.url), 'utf8');
      assert.ok(cards.includes('export { init, destroy, abrirGaleria }'));
    });
  });
}

async function grupoBotoes() {
  await grupo('Memory Quest — sistema visual de botões', async () => {
    const css = () => readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');

    await test('botões principais têm borda 3D, sombra, pressed, selected e foco', () => {
      const fonte = css();
      const bloco = fonte.slice(fonte.indexOf('Memory Quest — sistema visual de botões'));
      for (const trecho of [
        '--mq-btn-edge',
        'box-shadow: 0 4px 0 var(--mq-btn-edge)',
        'transform: translateY(3px)',
        ':focus-visible',
        ':disabled',
        '[aria-pressed="true"]',
        '#cards-board .diff-btn.active'
      ]) {
        assert.ok(bloco.includes(trecho), `regra ausente: ${trecho}`);
      }
      for (const seletor of [
        '.btn--arcade',
        '.home__quick .btn',
        '.mq-panel__opcao',
        '#cards-board .cards__mode-btn',
        '#cards-board .diff-btn',
        '#cards-board .cards__visual-opt',
        '#cards-board .cards__audio-btn',
        '#cards-board .cards__toggle'
      ]) {
        assert.ok(bloco.includes(seletor), `seletor ausente: ${seletor}`);
      }
    });

    await test('estilos de botões cobrem o Jogo da Memória sem resquícios do adaptador', () => {
      const fonte = css();
      const bloco = fonte.slice(fonte.indexOf('Memory Quest — sistema visual de botões'));
      assert.ok(!bloco.includes('.cards__smb3-'),
        'estilos do adaptador removido não podem reestilizar botões');
      assert.ok(bloco.includes('Jogo da Memória'),
        'escopo dos botões deve estar documentado no bloco');
    });

    await test('alvos de toque e reduced motion são preservados', () => {
      const fonte = css();
      const bloco = fonte.slice(fonte.indexOf('Memory Quest — sistema visual de botões'));
      assert.ok(bloco.includes('min-height: 44px'));
      assert.ok(bloco.includes('.nav__item'));
      assert.ok(bloco.includes('min-height: 52px'));
      assert.ok(fonte.indexOf('@media (prefers-reduced-motion: reduce)') >
        fonte.indexOf('Memory Quest — sistema visual de botões'));
    });
  });
}

async function grupoVolumes() {
  await grupo('Memory Quest — volumes independentes de FX e BGM', async () => {
    await test('normalização aceita zero, limita a faixa e aplica o padrão quando ausente', () => {
      assert.strictEqual(normalizarVolumeCartas(undefined, VOLUME_FX_PADRAO), 80);
      assert.strictEqual(normalizarVolumeCartas(null, VOLUME_BGM_PADRAO), 65);
      assert.strictEqual(normalizarVolumeCartas('', VOLUME_FX_PADRAO), 80);
      assert.strictEqual(normalizarVolumeCartas('texto', VOLUME_BGM_PADRAO), 65);
      assert.strictEqual(normalizarVolumeCartas(-10, VOLUME_FX_PADRAO), 0);
      assert.strictEqual(normalizarVolumeCartas(150, VOLUME_BGM_PADRAO), 100);
      assert.strictEqual(normalizarVolumeCartas(0, VOLUME_FX_PADRAO), 0, 'zero é válido');
      assert.strictEqual(normalizarVolumeCartas('42', VOLUME_BGM_PADRAO), 42);
      assert.strictEqual(normalizarVolumeCartas(37.6, VOLUME_FX_PADRAO), 38);
    });

    await test('instalação antiga recebe 80/65 na leitura sem gravar no banco', async () => {
      await resetDB();
      await openDatabase();
      await put('settings', { id: 1, som: false, dificuldadePlinko: 'dificil' });
      const preferencias = await obterPreferenciasCartas();
      assert.strictEqual(preferencias.volumeFxCartas, 80);
      assert.strictEqual(preferencias.volumeBgmCartas, 65);
      assert.strictEqual(preferencias.som, false);
      assert.strictEqual(preferencias.dificuldadePlinko, 'dificil');
      const bruto = (await getAll('settings'))[0];
      assert.strictEqual('volumeFxCartas' in bruto, false, 'leitura não pode migrar silenciosamente');
      assert.strictEqual('volumeBgmCartas' in bruto, false);
    });

    await test('salvar um canal preserva o outro e os campos antigos', async () => {
      const antes = (await getAll('settings'))[0];
      assert.strictEqual(antes.som, false);
      assert.deepEqual(await salvarVolumesCartas({ fx: 0 }), { fx: 0, bgm: 65 });
      const meio = (await getAll('settings'))[0];
      assert.strictEqual(meio.som, false);
      assert.strictEqual(meio.dificuldadePlinko, 'dificil');
      assert.strictEqual(meio.volumeFxCartas, 0);
      assert.deepEqual(await salvarVolumesCartas({ bgm: 35 }), { fx: 0, bgm: 35 });
      const depois = (await getAll('settings'))[0];
      assert.strictEqual(depois.volumeFxCartas, 0);
      assert.strictEqual(depois.volumeBgmCartas, 35);
      assert.strictEqual(depois.som, false);
      assert.deepEqual(await obterVolumesCartas(), { fx: 0, bgm: 35 });
    });

    await test('volumes entram no backup pela store settings sem mudar o formato', async () => {
      const backup = await exportarProgresso();
      assert.strictEqual(backup.formato, '1.0.0');
      assert.strictEqual(backup.versaoBanco, DB_VERSION);
      const registro = backup.stores.settings.find((item) => item.id === 1);
      assert.strictEqual(registro.volumeFxCartas, 0);
      assert.strictEqual(registro.volumeBgmCartas, 35);
      assert.strictEqual(registro.som, false);
    });

    await test('gravações concorrentes dos dois canais não se sobrescrevem', async () => {
      await resetDB();
      await openDatabase();
      await salvarPreferenciasCartas({ volumeFxCartas: 80, volumeBgmCartas: 65 });
      await Promise.all([
        salvarVolumesCartas({ fx: 0 }),
        salvarVolumesCartas({ bgm: 100 })
      ]);
      assert.deepEqual(await obterVolumesCartas(), { fx: 0, bgm: 100 });
      const registro = (await getAll('settings'))[0];
      assert.strictEqual(registro.volumeFxCartas, 0);
      assert.strictEqual(registro.volumeBgmCartas, 100);
    });

    await test('ganho por canal no renderer não reinicia a BGM e zero silencia só o FX', () => {
      const registros = [];
      const cenario = criarCenarioRendererNovo({}, { AudioContext: criarAudioFake(registros) });
      try {
        const renderer = cenario.renderer;
        renderer.definirAudio({ fx: true, bgm: true, volumeFx: 80, volumeBgm: 65 });
        assert.strictEqual(cenario.intervalos.length, 1, 'BGM ligada uma única vez');
        renderer.som('mover');
        cenario.intervalos[0].fn();
        assert.strictEqual(registros.length, 2);
        assert.ok(Math.abs(registros[0].volume - 0.02) < 1e-9,
          `FX em 80%: ${registros[0].volume}`);
        assert.ok(Math.abs(registros[1].volume - 0.0325) < 1e-9,
          `BGM em 65%: ${registros[1].volume}`);

        const timer = cenario.intervalos[0];
        renderer.definirAudio({ volumeFx: 0, volumeBgm: 100 });
        assert.strictEqual(cenario.intervalos[0], timer, 'mudar volume não recria o timer');
        assert.strictEqual(cenario.intervalos.length, 1);
        assert.strictEqual(renderer.volumeFx, 0);
        assert.strictEqual(renderer.volumeBgm, 100);

        registros.length = 0;
        renderer.som('mover');
        timer.fn();
        assert.strictEqual(registros.length, 1, 'FX em zero não toca');
        assert.ok(Math.abs(registros[0].volume - 0.05) < 1e-9,
          `BGM em 100%: ${registros[0].volume}`);
      } finally {
        cenario.restaurar();
      }
    });

    await test('BGM é audível em vários níveis, sem clipping e sem mexer no FX', () => {
      const esperados = [
        [0, 0],
        [25, 0.0125],
        [50, 0.025],
        [65, 0.0325],
        [100, 0.05]
      ];
      for (const [volumeBgm, ganhoEsperado] of esperados) {
        const registros = [];
        const cenario = criarCenarioRendererNovo({}, { AudioContext: criarAudioFake(registros) });
        try {
          const renderer = cenario.renderer;
          renderer.definirAudio({
            fx: true, bgm: true, volumeFx: 80, volumeBgm
          });
          const timer = cenario.intervalos[0];
          assert.ok(timer, 'timer da BGM deve existir em todos os níveis');

          registros.length = 0;
          renderer.som('mover');
          timer.fn();
          const fx = registros.find((item) => item.tipo === 'square');
          const bgm = registros.find((item) => item.tipo === 'triangle');
          assert.ok(Math.abs(fx.volume - 0.02) < 1e-9,
            `FX não pode mudar ao ajustar BGM (${volumeBgm}%): ${fx.volume}`);
          if (ganhoEsperado === 0) {
            assert.strictEqual(bgm, undefined, 'BGM em zero deve silenciar só a música');
          } else {
            assert.ok(Math.abs(bgm.volume - ganhoEsperado) < 1e-9,
              `BGM em ${volumeBgm}%: ${bgm.volume}`);
          }
          for (const item of registros) {
            assert.ok(item.volume > 0 && item.volume <= 0.08,
              `ganho fora da faixa segura: ${item.volume}`);
          }
          assert.strictEqual(renderer.volumeFx, 80);
          assert.strictEqual(renderer.volumeBgm, volumeBgm);
        } finally {
          cenario.restaurar();
        }
      }
    });

    await test('volumes persistem após fechar e reabrir o banco', async () => {
      await resetDB();
      await openDatabase();
      assert.deepEqual(await salvarVolumesCartas({ fx: 35 }), { fx: 35, bgm: 65 });
      assert.deepEqual(await salvarVolumesCartas({ bgm: 25 }), { fx: 35, bgm: 25 });
      closeDatabase(); // simula recarregar a página
      await openDatabase();
      assert.deepEqual(await obterVolumesCartas(), { fx: 35, bgm: 25 });
      const registro = (await getAll('settings'))[0];
      assert.strictEqual(registro.volumeFxCartas, 35);
      assert.strictEqual(registro.volumeBgmCartas, 25);
    });

    await test('sliders do menu do Jogo da Memória refletem e repassam ambos os canais', () => {
      const eventos = [];
      const cenario = criarCenarioRendererNovo({
        onAlterarVolume: (chave, valor) => eventos.push(`${chave}:${valor}`)
      });
      try {
        cenario.renderer.mostrarMenu({
          modo: 'expandido',
          modalidade: 'pontuacao',
          cheat: { infinitas: false, personalizada: false, quantidade: 20 },
          audioPreferencias: { fx: true, bgm: true, volumeFx: 80, volumeBgm: 65 },
          selfies: [],
          selfiesAtivas: []
        });
        const sliders = percorrerNo(cenario.raiz).filter((no) => no.dataset?.volume);
        assert.deepEqual(sliders.map((no) => [no.dataset.volume, no.value]), [
          ['fx', '80'],
          ['bgm', '65']
        ]);
        sliders[0].value = '0';
        sliders[0].dispatch('input');
        sliders[1].value = '100';
        sliders[1].dispatch('input');
        assert.deepEqual(eventos, ['fx:0', 'bgm:100']);
        const rotulos = percorrerNo(cenario.raiz)
          .filter((no) => no.className === 'cards__volume-rotulo')
          .map((no) => no.textContent);
        assert.ok(rotulos.includes('FX: 0%'));
        assert.ok(rotulos.includes('BGM: 100%'));
      } finally {
        cenario.restaurar();
      }
    });

    await test('sliders do painel de Configurações usam os padrões e persistem', async () => {
      await resetDB();
      await openDatabase();
      const anteriorDocumento = globalThis.document;
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      try {
        const root = new MockNode('div');
        await renderizarConfiguracoes(root);
        const sliders = percorrerNo(root).filter((no) => no.dataset?.volume);
        assert.deepEqual(sliders.map((no) => [no.dataset.volume, no.value]), [
          ['fx', '80'],
          ['bgm', '65']
        ]);
        sliders[0].value = '45';
        sliders[0].dispatch('input');
        // O mock de IndexedDB completa a transação após ~50 ms.
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.deepEqual(await obterVolumesCartas(), { fx: 45, bgm: 65 });
        const preferencias = await obterPreferenciasCartas();
        assert.strictEqual(preferencias.fxCartasAtivo, true, 'canal ligado intacto');
      } finally {
        globalThis.document = anteriorDocumento;
      }
    });

    await test('renderer e painéis não criam store nova nem mudam o DB', () => {
      const fonte = readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8');
      assert.ok(fonte.includes("getAll('settings')"));
      assert.ok(fonte.includes("put('settings'"));
      assert.ok(!fonte.includes('createObjectStore'), 'nenhuma store nova');
      for (const arquivo of [
        '../src/core/settings.js',
        '../src/games/cards/renderer.js',
        '../src/games/cards/index.js',
        '../src/ui/panels.js'
      ]) {
        const texto = readFileSync(new URL(arquivo, import.meta.url), 'utf8');
        assert.ok(!/DB_VERSION_ATUAL\s*=/.test(texto), `versão alterada em ${arquivo}`);
      }
    });
  });
}

async function grupoPerfil() {
  await grupo('Memory Quest — perfil local e estatísticas reais', async () => {
    await test('normalizadores protegem nome e avatar', () => {
      assert.strictEqual(normalizarNomePerfil('  Ana  '), 'Ana');
      assert.strictEqual(normalizarNomePerfil('   '), 'Jogador');
      assert.strictEqual(normalizarNomePerfil(null), 'Jogador');
      assert.strictEqual(normalizarNomePerfil('x'.repeat(100)).length, 60);
      const avatar = 'data:image/jpeg;base64,QUJD';
      assert.strictEqual(normalizarAvatarPerfil(avatar), avatar);
      assert.strictEqual(normalizarAvatarPerfil('javascript:alert(1)'), null);
      assert.strictEqual(normalizarAvatarPerfil(null), null);
      assert.strictEqual(normalizarAvatarPerfil('data:image/jpeg;base64,' + 'A'.repeat(3 * 1024 * 1024)), null);
    });

    await test('leitura do perfil não cria registro nem apaga os padrões', async () => {
      await resetDB();
      await openDatabase();
      const antes = await getAll('profile');
      assert.strictEqual(antes.length, 1);
      const perfil = await obterPerfil();
      assert.strictEqual(perfil.nome, 'Jogador');
      assert.strictEqual(perfil.avatar, null);
      assert.strictEqual(perfil.tema, 'retro');
      assert.strictEqual(perfil.idExterno, null);
      assert.strictEqual((await getAll('profile')).length, 1);
    });

    await test('salvar nome e foto preserva campos antigos e não cria store', async () => {
      await resetDB();
      await openDatabase();
      const original = (await getAll('profile'))[0];
      await put('profile', {
        ...original,
        idExterno: 'externo-123',
        avatar: 'data:image/jpeg;base64,QUJD',
        tema: 'retro'
      });
      await salvarPerfil({ nome: '  Mestre  ' });
      const meio = (await getAll('profile'))[0];
      assert.strictEqual(meio.nome, 'Mestre');
      assert.strictEqual(meio.idExterno, 'externo-123');
      assert.strictEqual(meio.avatar, 'data:image/jpeg;base64,QUJD');
      assert.strictEqual(meio.criadoEm, original.criadoEm);
      assert.strictEqual(meio.id, original.id);

      await salvarPerfil({ avatar: 'data:image/png;base64,iVBORw0K' });
      const depois = (await getAll('profile'))[0];
      assert.strictEqual(depois.nome, 'Mestre');
      assert.strictEqual(depois.avatar, 'data:image/png;base64,iVBORw0K');
      assert.strictEqual(depois.tema, 'retro');
      assert.strictEqual((await getAll('profile')).length, 1);
    });

    await test('mudanças rápidas de nome e foto não se sobrescrevem', async () => {
      await Promise.all([
        salvarPerfil({ nome: 'Rápido' }),
        salvarPerfil({ avatar: 'data:image/jpeg;base64,QUJD' })
      ]);
      const registro = (await getAll('profile'))[0];
      assert.strictEqual(registro.nome, 'Rápido');
      assert.strictEqual(registro.avatar, 'data:image/jpeg;base64,QUJD');
    });

    await test('perfil atualizado entra no backup sem mudar o formato', async () => {
      const backup = await exportarProgresso();
      assert.strictEqual(backup.formato, '1.0.0');
      assert.strictEqual(backup.versaoBanco, DB_VERSION);
      const perfil = backup.stores.profile.find((item) => item.nome === 'Rápido');
      assert.ok(perfil, 'perfil salvo precisa aparecer na store profile');
      assert.strictEqual(perfil.avatar, 'data:image/jpeg;base64,QUJD');
    });

    await test('painel mostra estatísticas reais e sincroniza o cabeçalho legado', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({ concluida: true, vitoria: true, tentativas: 4, erros: 1 });
      await registrarPartida({ concluida: true, vitoria: false, tentativas: 6, erros: 3 });
      await salvarPerfil({ nome: 'Lenda' });

      const anterior = globalThis.document;
      const nomeEl = new MockNode('div');
      nomeEl.className = 'profile__nome';
      const idEl = new MockNode('div');
      idEl.className = 'profile__id';
      const avatarEl = new MockNode('div');
      avatarEl.className = 'profile__avatar-placeholder';
      globalThis.document = {
        createElement: (tag) => new MockNode(tag),
        activeElement: null,
        getElementById: (id) => (id === 'profile-nome' ? nomeEl : id === 'profile-id' ? idEl : null),
        querySelector: (seletor) => (seletor === '.profile__avatar-placeholder' ? avatarEl : null)
      };
      try {
        const root = new MockNode('div');
        const perfil = await renderizarPerfil(root);
        assert.strictEqual(perfil.nome, 'Lenda');
        assert.strictEqual(nomeEl.textContent, 'Lenda');
        assert.match(idEl.textContent, /^ID: /);
        assert.strictEqual(avatarEl.textContent, '👤');
        const texto = percorrerNo(root).map((no) => no.textContent).join(' ');
        for (const rotulo of ['Partidas', 'Concluídas', 'Vitórias', 'Moedas']) {
          assert.ok(texto.includes(rotulo), `resumo ausente: ${rotulo}`);
        }
        assert.ok(texto.includes('2'), 'duas partidas registradas precisam aparecer');
      } finally {
        globalThis.document = anterior;
      }
    });

    await test('foto do perfil prefere câmera frontal e mantém a galeria', () => {
      const fonte = readFileSync(new URL('../src/ui/profile.js', import.meta.url), 'utf8');
      assert.ok(fonte.includes("input.setAttribute('capture', 'user')"));
      assert.ok(fonte.includes('Tirar foto'));
      assert.ok(fonte.includes('Escolher da galeria'));
      assert.ok(fonte.includes("input.accept = 'image/*'"));
      assert.ok(fonte.includes('Preferência pela câmera frontal'),
        'capture=user precisa estar documentado como preferência');
      const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
      assert.ok(html.includes('id="profile-board"'));
      assert.ok(html.includes('id="btn-export"'));
      assert.ok(html.includes('id="btn-import"'));
    });

    await test('bootstrap e SW integram o perfil sem tocar em backup ou Plinko', () => {
      const main = readFileSync(new URL('../src/app/main.js', import.meta.url), 'utf8');
      assert.ok(main.includes("from '../ui/profile.js'"));
      assert.ok(main.includes('renderizarPerfil(document.getElementById(\'profile-board\'))'));
      const backup = readFileSync(new URL('../src/core/backup.js', import.meta.url), 'utf8');
      assert.ok(backup.includes('const FORMATO_VERSION = \'1.0.0\''));
      assert.ok(!backup.includes('profile.js'), 'backup não depende do painel');
      const banco = readFileSync(new URL('../src/core/database.js', import.meta.url), 'utf8');
      assert.ok(!banco.includes('createObjectStore(\'avatar\''), 'nenhuma store de avatar');
    });
  });
}

// ============================================================================
// CONTADOR DE CONQUISTAS DA HOME
// ============================================================================

async function grupoConquistasHome() {
  await grupo('Contador de Conquistas da home', async () => {
    const desafio = (id, concluido = true) => ({ id, descricao: id, concluido });

    await test('nenhuma conquista desbloqueada', async () => {
      await resetDB();
      await openDatabase();
      assert.strictEqual(await contarConquistasDesbloqueadas(), 0);
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: false,
        desafios: [desafio('sem_erros')]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 0, 'derrota não desbloqueia');
      assert.deepEqual(await listarConquistasDesbloqueadas(), []);
    });

    await test('uma conquista desbloqueada', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios: [desafio('sem_erros'), desafio('boa_memoria', false)]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 1);
      assert.deepEqual(await listarConquistasDesbloqueadas(), [
        { id: 'sem_erros', descricao: 'Nenhum par errado' }
      ]);
    });

    await test('várias conquistas na ordem canônica', async () => {
      await resetDB();
      await openDatabase();
      const desafios = avaliarDesafios({
        erros: 0,
        tentativas: 9,
        totalPares: 9,
        tempoSegundos: 50,
        tempoAlvo: 60
      });
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 4);
      assert.deepEqual((await listarConquistasDesbloqueadas()).map((item) => item.id), [
        'sem_erros',
        'boa_memoria',
        'tempo_alvo',
        'precisao_total'
      ]);
    });

    await test('conquista repetida é contada uma única vez', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios: [desafio('sem_erros'), desafio('boa_memoria')]
      });
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios: [desafio('sem_erros'), desafio('tempo_alvo')]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 3);
    });

    await test('registros incompletos e IDs desconhecidos são ignorados', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios: [
          null,
          'sem_erros',
          { concluido: true },
          { id: 123, concluido: true },
          { id: 'conquista_ficticia', concluido: true },
          { id: 'sem_erros', concluido: 'true' },
          { id: 'boa_memoria' }
        ]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 0);
    });

    await test('partida antiga sem concluida/cheat é aceita; CHEAT é ignorado', async () => {
      await resetDB();
      await openDatabase();
      await put('matches', {
        jogo: 'cards',
        modo: 'expandido',
        vitoria: true,
        playedAt: 1,
        desafios: [desafio('tempo_alvo')]
      });
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        cheat: 'infinitas',
        desafios: [desafio('sem_erros')]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 1);
      assert.deepEqual((await listarConquistasDesbloqueadas()).map((item) => item.id), [
        'tempo_alvo'
      ]);
    });

    await test('contador da home usa o serviço e não lê mais achievements', () => {
      const main = readFileSync(new URL('../src/app/main.js', import.meta.url), 'utf8');
      assert.ok(main.includes("import { contarConquistasDesbloqueadas } from '../core/game-stats.js'"));
      assert.ok(main.includes('const conquistas = await contarConquistasDesbloqueadas();'));
      assert.ok(!main.includes("getAll('achievements')"));
      assert.ok(!main.includes('contarConquistas()'));
    });

    await test('contador atualiza após desbloqueio e sobrevive ao recarregamento', async () => {
      await resetDB();
      await openDatabase();
      assert.strictEqual(await contarConquistasDesbloqueadas(), 0);
      await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios: [desafio('precisao_total')]
      });
      assert.strictEqual(await contarConquistasDesbloqueadas(), 1);
      const antes = await listarConquistasDesbloqueadas();
      closeDatabase();
      await openDatabase();
      assert.deepEqual(await listarConquistasDesbloqueadas(), antes);
      assert.strictEqual(await contarConquistasDesbloqueadas(), 1);
    });

    await test('desafios existentes permanecem intactos no registro da partida', async () => {
      await resetDB();
      await openDatabase();
      const desafios = avaliarDesafios({
        erros: 1,
        tentativas: 10,
        totalPares: 9,
        tempoSegundos: 70,
        tempoAlvo: 60
      });
      const { registro } = await registrarPartida({
        modo: 'expandido',
        concluida: true,
        vitoria: true,
        desafios
      });
      const gravados = await getAll('matches');
      const partida = gravados.find((item) => item.id === registro.id);
      assert.deepEqual(partida.desafios, desafios);
      assert.strictEqual(await contarConquistasDesbloqueadas(), 1);
    });
  });
}

// ============================================================================
// ÍCONES PWA
// ============================================================================

async function grupoIconesPWA() {
  await grupo('Ícones PWA', async () => {
    const tamanhos = [72, 96, 128, 144, 152, 192, 384, 512];
    const esperados = [
      ...tamanhos.map((n) => `icon-${n}.png`),
      ...tamanhos.map((n) => `icon-${n}-maskable.png`)
    ];

    const lerPNG = (caminho) => {
      const bytes = readFileSync(caminho);
      const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      assert.deepEqual(bytes.subarray(0, 8), assinatura, 'assinatura PNG inválida');
      assert.strictEqual(bytes.toString('ascii', 12, 16), 'IHDR', 'IHDR ausente');
      return {
        largura: bytes.readUInt32BE(16),
        altura: bytes.readUInt32BE(20),
        profundidade: bytes[24],
        tipoCor: bytes[25],
        bytes: bytes.length
      };
    };

    await test('manifesto declara 8 ícones any e 8 maskable', () => {
      const manifesto = JSON.parse(
        readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
      );
      const nomes = manifesto.icons.map((icon) => icon.src.split('/').pop());
      assert.deepEqual(nomes, esperados);
      assert.ok(manifesto.icons.every((icon) => icon.type === 'image/png'));
      assert.strictEqual(manifesto.icons.filter((icon) => icon.purpose === 'any').length, 8);
      assert.strictEqual(manifesto.icons.filter((icon) => icon.purpose === 'maskable').length, 8);
      for (const icon of manifesto.icons) {
        const tamanho = icon.sizes.split('x')[0];
        assert.ok(tamanhos.includes(Number(tamanho)), `tamanho inesperado: ${icon.sizes}`);
      }
    });

    await test('todos os PNGs existem, são opacos e têm as dimensões declaradas', () => {
      const manifesto = JSON.parse(
        readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
      );
      for (const icon of manifesto.icons) {
        const png = lerPNG(new URL(`../${icon.src}`, import.meta.url));
        const [largura, altura] = icon.sizes.split('x').map(Number);
        assert.strictEqual(png.largura, largura, icon.src);
        assert.strictEqual(png.altura, altura, icon.src);
        assert.strictEqual(png.profundidade, 8, icon.src);
        assert.strictEqual(png.tipoCor, 2, `${icon.src} deve ser RGB opaco`);
        assert.ok(png.bytes > 100, `${icon.src} muito pequeno`);
      }
    });

    await test('arte-base original é preservada como arquivo-fonte', () => {
      const master = lerPNG(new URL('../assets/icons/memory-quest-master.png', import.meta.url));
      assert.ok(master.largura > 512 && master.altura > 512);
      assert.strictEqual(master.largura, master.altura);
      assert.strictEqual(master.tipoCor, 2);
      assert.ok(master.bytes > 1_000_000);
    });

    await test('SW e HTML referenciam os ícones gerados', () => {
      const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
      const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
      for (const nome of esperados) {
        assert.ok(sw.includes(`'./assets/icons/${nome}'`), `${nome} ausente no precache`);
      }
      assert.match(sw, /const CACHE_NAME = 'memory-quest-v19'/);
      assert.ok(
        html.includes('<link rel="apple-touch-icon" href="assets/icons/icon-192.png" />')
      );
    });
  });
}

// ============================================================================
// ETAPA 2 — PRÉVIA OBRIGATÓRIA E PROGRESSÃO POR VITÓRIA
// ============================================================================

async function grupoEtapa2() {
  await grupo('ETAPA 2 — prévia obrigatória e progressão por vitória', async () => {
    await test('tempos de prévia são exatos para as cinco dificuldades', async () => {
      assert.deepEqual(TEMPOS_PREVIA_CARTAS, {
        facil: 3000,
        normal: 4000,
        dificil: 5000,
        muitodificil: 6000,
        extremo: 8000
      });
      for (const chave of PROGRESSAO_CARTAS) {
        assert.strictEqual(obterTempoPrevia(chave), TEMPOS_PREVIA_CARTAS[chave]);
      }
      assert.strictEqual(obterTempoPrevia('desconhecida'), 4000, 'fallback é Normal');
      assert.strictEqual(segundosRestantes(3000), 3);
      assert.strictEqual(segundosRestantes(1001), 2);
      assert.strictEqual(segundosRestantes(0), 0);
      assert.strictEqual(segundosRestantes(-50), 0);
    });

    await test('controlador da prévia publica contagem e conclui uma única vez', async () => {
      let agora = 1000;
      const intervalos = [];
      const ticks = [];
      let conclusoes = 0;
      const controle = criarControladorPrevia({
        duracaoMs: 3000,
        intervaloMs: 100,
        agora: () => agora,
        setInterval: (fn, ms) => {
          const item = { fn, ms, cancelado: false };
          intervalos.push(item);
          return item;
        },
        clearInterval: (id) => { id.cancelado = true; },
        onTick: (restante, duracao) => ticks.push([restante, duracao]),
        onConcluir: () => { conclusoes += 1; }
      });

      assert.strictEqual(controle.iniciar(), true);
      assert.strictEqual(controle.iniciar(), false, 'start duplicado não cria outro timer');
      assert.strictEqual(intervalos.length, 1);
      assert.strictEqual(intervalos[0].ms, 100);
      assert.deepEqual(ticks[0], [3000, 3000]);
      assert.strictEqual(controle.ativo, true);

      agora = 2000;
      intervalos[0].fn();
      assert.deepEqual(ticks.at(-1), [2000, 3000]);

      agora = 3999;
      intervalos[0].fn();
      assert.deepEqual(ticks.at(-1), [1, 3000]);

      agora = 4000;
      intervalos[0].fn();
      assert.strictEqual(conclusoes, 1);
      assert.strictEqual(intervalos[0].cancelado, true);
      assert.strictEqual(controle.ativo, false);
      assert.strictEqual(controle.concluido, true);

      // Mesmo um callback atrasado não pode gerar segunda conclusão.
      intervalos[0].fn();
      assert.strictEqual(conclusoes, 1);
    });

    await test('parar a prévia cancela o timer e impede conclusão atrasada', async () => {
      const intervalos = [];
      let conclusoes = 0;
      const controle = criarControladorPrevia({
        duracaoMs: 3000,
        agora: () => 0,
        setInterval: (fn, ms) => {
          const item = { fn, ms, cancelado: false };
          intervalos.push(item);
          return item;
        },
        clearInterval: (id) => { id.cancelado = true; },
        onConcluir: () => { conclusoes += 1; }
      });
      controle.iniciar();
      controle.parar();
      assert.strictEqual(intervalos[0].cancelado, true);
      intervalos[0].fn();
      assert.strictEqual(conclusoes, 0);
      assert.strictEqual(controle.ativo, false);
    });

    await test('prévia por dificuldade herda a duração correta', async () => {
      const controle = criarPreviaParaDificuldade('extremo', {
        agora: () => 0,
        setInterval: () => ({ cancelado: false }),
        clearInterval: () => {}
      });
      assert.strictEqual(controle.duracaoMs, 8000);
      controle.parar();
    });

    await test('renderer mantém cartas abertas e bloqueia qualquer seleção na prévia', async () => {
      const fonteRenderer = readFileSync(new URL('../src/games/cards/renderer.js', import.meta.url), 'utf8');
      assert.ok(!/node\.parentNode\s*=\s*null/.test(fonteRenderer),
        'removerNo não pode atribuir parentNode: é somente leitura no DOM real');
      const selecoes = [];
      const cenario = criarCenarioRendererNovo({
        onSelecionar: (id) => selecoes.push(id)
      });
      try {
        const config = criarConfigExpandida('facil', criarRng(3));
        const snapshot = criarPartida(config).estado();
        cenario.renderer.mostrarPrevia(config, snapshot, {
          duracaoMs: 3000,
          mensagem: 'MEMORIZE AS CARTAS!'
        });

        const aviso = encontrarNo(cenario.raiz, (no) => no.dataset?.previa === 'true');
        assert.ok(aviso, 'prévia precisa de sobreposição central');
        assert.ok(percorrerNo(aviso).some((no) => no.textContent === 'MEMORIZE AS CARTAS!'));
        const contagem = encontrarNo(aviso,
          (no) => no.getAttribute('aria-label') === 'Segundos restantes');
        assert.strictEqual(contagem.textContent, '3');
        const preenchimento = encontrarNo(aviso,
          (no) => no.classList.contains('cards__memoria-barra--previa'));
        assert.strictEqual(preenchimento.getAttribute('aria-valuenow'), '100');
        assert.ok(encontrarNo(cenario.raiz,
          (no) => no.classList.contains('cards__previa-reiniciar')),
          'reiniciar durante a prévia continua disponível para não travar');

        const cartas = percorrerNo(cenario.raiz).filter((no) =>
          no.dataset?.id !== undefined && no.classList.contains('cards__card'));
        const board = encontrarNo(cenario.raiz, (no) => no.classList.contains('cards__board'));
        assert.strictEqual(cartas.length, 18);
        assert.ok(cartas.every((no) =>
          no.classList.contains('cards__card--revelada') && no.disabled === true));
        assert.ok(board.classList.contains('cards__board--bloqueado'));
        assert.strictEqual(cenario.renderer.emApresentacao, true);

        cartas[0].click();
        assert.deepEqual(selecoes, [], 'clique/toque na prévia não pode selecionar');

        cenario.renderer.atualizarPrevia(1500, 3000);
        assert.strictEqual(contagem.textContent, '2');
        assert.strictEqual(preenchimento.getAttribute('aria-valuenow'), '50');

        cenario.renderer.concluirPrevia(config, snapshot);
        assert.strictEqual(encontrarNo(cenario.raiz, (no) => no.dataset?.previa === 'true'), null);
        assert.ok(cartas.every((no) =>
          !no.classList.contains('cards__card--revelada') && no.disabled === false));
        assert.ok(!board.classList.contains('cards__board--bloqueado'));
        assert.strictEqual(cenario.renderer.emApresentacao, false);

        cartas[0].click();
        assert.deepEqual(selecoes, [0], 'interação é liberada somente após a virada');
      } finally {
        cenario.restaurar();
      }
    });

    await test('integração inicia o cronômetro após a prévia e descarta callbacks atrasados', async () => {
      const fonte = readFileSync(new URL('../src/games/cards/index.js', import.meta.url), 'utf8');
      assert.ok(fonte.includes("mensagem: 'MEMORIZE AS CARTAS!'"));
      assert.ok(fonte.includes('sequenciaSessao += 1'));
      assert.ok(fonte.includes('if (idSessao !== sequenciaSessao || !sessao || sessao.destruida) return;'));
      assert.ok(fonte.includes('sessao.iniciarCronometro();'));
      assert.ok(fonte.indexOf('renderer.mostrarPrevia') < fonte.indexOf('sessao.iniciarCronometro();'));
      assert.ok(!/renderer\.mostrarPartida\(/.test(fonte),
        'nenhum caminho pode mostrar a partida sem passar pela prévia');
      const board = readFileSync(new URL('../src/games/cards/board.js', import.meta.url), 'utf8');
      assert.ok(board.includes('let inicio = null;'));
      assert.ok(board.includes('if (inicio === null) inicio = agora();'));
      assert.ok(board.includes('if (inicio === null) return 0;'));
    });

    await test('progressão é aplicada uma vez no desfecho, nunca no Nova partida', async () => {
      const fonte = readFileSync(new URL('../src/games/cards/index.js', import.meta.url), 'utf8');
      assert.ok(fonte.includes('if (partidaFinalizada) return;'));
      assert.ok(fonte.includes('partidaFinalizada = true;'));
      assert.ok(fonte.includes('dificuldadeAtual = vitoria'));
      assert.ok(fonte.includes('dificuldadeAposVitoria(config.dificuldade, progressaoAutomatica)'));
      assert.ok(fonte.includes('const novaPartida = () => iniciarPartida();'));
      assert.ok(!/progressaoAutomatica\)\s*dificuldadeAtual\s*=\s*proximaDificuldade/.test(fonte));
      assert.ok(fonte.includes('dificuldadeAtual = dificuldadeInicial;'),
        'resultado sem continuidade volta à dificuldade configurada');
    });

    await test('dificuldade inicial e progressão usam preferências existentes com padrão compatível', async () => {
      await resetDB();
      await openDatabase();
      const preferencias = await obterPreferenciasCartas();
      assert.strictEqual(preferencias.dificuldadeCartas, 'normal');
      assert.strictEqual(preferencias.progressaoAutomaticaCartas, true);
      assert.strictEqual(PROGRESSAO_AUTOMATICA_PADRAO, true);
      assert.strictEqual(normalizarDificuldadeCartas('muitodificil'), 'muitodificil');
      assert.strictEqual(normalizarDificuldadeCartas('invalida'), 'normal');
      assert.strictEqual(normalizarProgressaoAutomaticaCartas(undefined), true);
      assert.strictEqual(normalizarProgressaoAutomaticaCartas('sim'), true);
      assert.strictEqual(normalizarProgressaoAutomaticaCartas(false), false);

      await salvarPreferenciasCartas({
        dificuldadeCartas: 'dificil',
        progressaoAutomaticaCartas: false
      });
      const atualizadas = await obterPreferenciasCartas();
      assert.strictEqual(atualizadas.dificuldadeCartas, 'dificil');
      assert.strictEqual(atualizadas.progressaoAutomaticaCartas, false);
      const registro = (await getAll('settings'))[0];
      assert.strictEqual(registro.dificuldadeCartas, 'dificil');
      assert.strictEqual(registro.progressaoAutomaticaCartas, false);
      assert.strictEqual(registro.som, true, 'campos antigos preservados');
    });

    await test('painel de Configurações edita dificuldade inicial e progressão', async () => {
      await resetDB();
      await openDatabase();
      const documentoAnterior = globalThis.document;
      globalThis.document = { createElement: (tag) => new MockNode(tag), activeElement: null };
      try {
        const root = new MockNode('div');
        await renderizarConfiguracoes(root);
        const nos = percorrerNo(root);
        const dificuldades = nos.filter((no) => no.dataset?.dificuldadeInicial);
        assert.deepEqual(dificuldades.map((no) => [no.dataset.dificuldadeInicial, no.dataset.tempoPrevia]), [
          ['facil', '3000'],
          ['normal', '4000'],
          ['dificil', '5000'],
          ['muitodificil', '6000'],
          ['extremo', '8000']
        ]);
        assert.strictEqual(dificuldades[1].getAttribute('aria-pressed'), 'true');
        const progressao = nos.find((no) => no.dataset?.progressaoAutomatica !== undefined);
        assert.strictEqual(progressao.dataset.progressaoAutomatica, 'true');

        dificuldades[4].click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        progressao.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const preferencias = await obterPreferenciasCartas();
        assert.strictEqual(preferencias.dificuldadeCartas, 'extremo');
        assert.strictEqual(preferencias.progressaoAutomaticaCartas, false);
      } finally {
        globalThis.document = documentoAnterior;
      }
    });

    await test('CSS da prévia é pixel art, central e responsivo sem mover o tabuleiro', async () => {
      const css = readFileSync(new URL('../src/games/cards/styles.css', import.meta.url), 'utf8');
      for (const trecho of [
        '.cards__game {',
        'position: relative;',
        '.cards__board--bloqueado',
        'pointer-events: none;',
        '.cards__previa {',
        'position: absolute;',
        'left: 50%;',
        'pointer-events: none;',
        '.cards__previa-mensagem',
        '.cards__previa-contagem',
        '--previa-fracao',
        '.cards__memoria-barra--previa',
        '@media (max-width: 560px)',
        '@media (max-height: 480px)',
        '@media (prefers-reduced-motion: reduce)'
      ]) {
        assert.ok(css.includes(trecho), `ausente no CSS: ${trecho}`);
      }
    });
  });
}

// ============================================================================
// ETAPA 3 — ECONOMIA ISOLADA DO MEMORY QUEST
// ============================================================================

async function grupoEtapa3() {
  await grupo('ETAPA 3 — economia, pontuação, cheats e persistência isolada', async () => {
    await test('multiplicador é determinístico e limitado a x16', async () => {
      assert.deepEqual(
        [1, 2, 3, 4, 5, 6, 50, 999].map(multiplicadorSequencia),
        [1, 2, 4, 8, 16, 16, 16, 16]
      );
      assert.strictEqual(MQ_MULTIPLICADOR_MAXIMO, 16);
      assert.strictEqual(multiplicadorSequencia(NaN), 1);
      assert.strictEqual(multiplicadorSequencia(Infinity), 1, 'valor inválido cai em x1');
    });

    await test('moedas por par usam a tabela da dificuldade e só contam pares reais', async () => {
      for (const [chave, base] of Object.entries(MQ_MOEDAS_POR_PAR)) {
        assert.strictEqual(
          calcularMoedasPorPares({ dificuldade: chave, paresEncontrados: 1, somaMultiplicadores: 1 }),
          base
        );
      }
      assert.strictEqual(calcularMoedasPorPares({ dificuldade: 'normal', paresEncontrados: 0 }), 0);
      assert.strictEqual(calcularMoedasPorPares({
        dificuldade: 'normal', paresEncontrados: 1, somaMultiplicadores: 1, elegivel: false
      }), 0);
      assert.strictEqual(calcularMoedasPorPares({
        dificuldade: 'normal', paresEncontrados: 2, somaMultiplicadores: Infinity
      }), 4, 'soma inválida cai para x1 por par');
    });

    await test('erros reiniciam a sequência sem apagar moedas já conquistadas', async () => {
      const r = criarRastreadorRecompensas({ dificuldade: 'normal', modalidade: 'pontuacao' });
      r.registrarPar(); r.registrarPar(); r.registrarPar();
      assert.strictEqual(r.sequencia, 3);
      assert.strictEqual(r.multiplicadorAtual, 4);
      r.registrarErro();
      assert.strictEqual(r.sequencia, 0);
      assert.strictEqual(r.multiplicadorAtual, 1);
      r.registrarPar();
      const resumo = r.resumo({ vitoria: false });
      assert.strictEqual(resumo.paresEncontrados, 4);
      assert.strictEqual(resumo.somaMultiplicadores, 8, '1+2+4+1');
      assert.strictEqual(resumo.moedasPares, 16);
      assert.strictEqual(resumo.erros, 1);
    });

    await test('cheat bloqueia na hora, é permanente e zerar todas as recompensas', async () => {
      for (const modalidade of ['pontuacao', 'tentativas']) {
        const r = criarRastreadorRecompensas({
          sessionId: `cheat_${modalidade}`, dificuldade: 'facil', modalidade,
          tentativasIniciais: 14, tempoAlvo: 60
        });
        r.registrarPar(); r.registrarPar();
        assert.strictEqual(r.rewardsEligible, true);
        r.registrarCheat('infinitas');
        assert.strictEqual(r.rewardsEligible, false);
        r.registrarCheat('personalizada', { origem: 'teste' });
        assert.deepEqual(r.motivosCheat, ['infinitas', 'personalizada']);
        r.registrarPar();
        const resumo = r.finalizar({
          vitoria: true, tentativas: 3, tentativasRestantes: 9, tempoSegundos: 10
        });
        assert.strictEqual(resumo.total, 0);
        assert.strictEqual(resumo.bonus, 0);
        assert.strictEqual(resumo.pontuacao, 0);
        assert.strictEqual(r.rewardsEligible, false, 'desativar não pode restaurar');
      }
    });

    await test('sessões reiniciadas são independentes e dupla finalização é ignorada', async () => {
      const cheat = criarRastreadorRecompensas({ sessionId: 'a' });
      cheat.registrarCheat('infinitas');
      const limpa = criarRastreadorRecompensas({ sessionId: 'b', dificuldade: 'facil' });
      assert.strictEqual(cheat.rewardsEligible, false);
      assert.strictEqual(limpa.rewardsEligible, true);
      limpa.registrarPar();
      const primeiro = limpa.finalizar({ vitoria: true });
      const segundo = limpa.finalizar({ vitoria: true });
      assert.strictEqual(segundo, null);
      assert.equal(primeiro.total, 1);
    });

    await test('derrota legítima paga pares; bônus só existe na vitória por Tentativas', async () => {
      const derrota = calcularLiquidacaoMQ({
        sessionId: 'derrota', dificuldade: 'normal', modalidade: 'tentativas',
        vitoria: false, elegivel: true, paresEncontrados: 3,
        somaMultiplicadores: 4, tentativas: 5, tentativasIniciais: 22,
        tentativasRestantes: 0, tempoSegundos: 40, tempoAlvo: 110
      });
      assert.strictEqual(derrota.moedasPares, 8);
      assert.strictEqual(derrota.bonus, 0);
      assert.strictEqual(derrota.total, 8);

      const vitoria = calcularLiquidacaoMQ({
        ...derrota, sessionId: 'vitoria', vitoria: true, tentativasRestantes: 11
      });
      assert.strictEqual(vitoria.bonus, 30, '60 × 11/22');
      assert.strictEqual(vitoria.total, 38);
      assert.ok(vitoria.bonus <= MQ_BONUS_MAX.normal);

      assert.strictEqual(calcularBonusTentativas({
        dificuldade: 'facil', vitoria: true, modalidade: 'pontuacao',
        tentativasIniciais: 14, tentativasRestantes: 14
      }), 0);
      assert.strictEqual(calcularBonusTentativas({
        dificuldade: 'facil', vitoria: true, modalidade: 'tentativas',
        elegivel: false, tentativasIniciais: 14, tentativasRestantes: 14
      }), 0);
      assert.strictEqual(calcularBonusTentativas({
        dificuldade: 'facil', vitoria: true, modalidade: 'tentativas',
        tentativasIniciais: 0, tentativasRestantes: 999
      }), MQ_BONUS_MAX.facil, 'valores extremos respeitam o teto');
    });

    await test('pontuação segue P = B × Fd × Fe × Ft sem dominância da velocidade', async () => {
      const entradas = {
        dificuldade: 'dificil', paresEncontrados: 6, somaMultiplicadores: 10,
        tentativas: 8, tempoSegundos: 90, tempoAlvo: 180, elegivel: true
      };
      const fe = calcularFatorEficiencia(6, 8);
      const ft = calcularFatorTempo(90, 180);
      const esperado = Math.round(100 * 10 * 1.5 * fe * ft);
      assert.strictEqual(calcularPontuacaoMQ(entradas), esperado);
      assert.strictEqual(calcularFatorEficiencia(0, 0), 0.5);
      assert.strictEqual(calcularFatorTempo(999999, 0), 0.75);
      assert.strictEqual(calcularFatorTempo(0, 0), 1.25);
      const lenta = calcularPontuacaoMQ({ ...entradas, tempoSegundos: 360 });
      const rapida = calcularPontuacaoMQ({ ...entradas, tempoSegundos: 10 });
      assert.ok(rapida > lenta);
      assert.ok(rapida / lenta < 2, 'velocidade não pode dominar a pontuação');
    });

    await test('simulações cobrem 5 dificuldades, perfis e baralhos sem valores inválidos', async () => {
      const dificuldades = Object.keys(MQ_MOEDAS_POR_PAR);
      const perfis = [
        { reset: 99, erro: 0, tempo: 0.5, resto: 0.85 },
        { reset: 3, erro: 0.5, tempo: 1, resto: 0.45 },
        { reset: 1, erro: 2, tempo: 1.5, resto: 0.1 },
        { reset: 5, erro: 0.3, tempo: 3, resto: 0.3 },
        { reset: 4, erro: 0.2, tempo: 0.25, resto: 0.7 }
      ];
      const paresPorDificuldade = [9, 15, 24, 36, 50];
      const tentativasPorDificuldade = [14, 22, 32, 45, 60];

      for (let i = 0; i < dificuldades.length; i += 1) {
        const chave = dificuldades[i];
        const pares = paresPorDificuldade[i];
        const tentativasBase = tentativasPorDificuldade[i];
        for (const perfil of perfis) {
          let soma = 0;
          let seq = 0;
          for (let p = 0; p < pares; p += 1) {
            seq += 1;
            soma += multiplicadorSequencia(seq);
            if (perfil.reset > 0 && (p + 1) % perfil.reset === 0) seq = 0;
          }
          const tentativas = pares + Math.round(pares * perfil.erro);
          const r = calcularLiquidacaoMQ({
            sessionId: `sim_${chave}_${perfil.reset}`,
            dificuldade: chave, modalidade: 'tentativas', vitoria: true, elegivel: true,
            paresEncontrados: pares, somaMultiplicadores: soma, tentativas,
            tentativasIniciais: tentativasBase,
            tentativasRestantes: Math.round(tentativasBase * perfil.resto),
            tempoSegundos: Math.round(pares * 6 * perfil.tempo), tempoAlvo: pares * 6
          });
          for (const valor of [r.moedasPares, r.bonus, r.total, r.pontuacao,
            r.fatores.fe, r.fatores.ft]) {
            assert.ok(Number.isFinite(valor), `valor inválido em ${chave}/${perfil.reset}`);
            assert.ok(valor >= 0, `valor negativo em ${chave}/${perfil.reset}`);
          }
          assert.ok(r.bonus <= MQ_BONUS_MAX[chave]);
          assert.ok(r.fatores.fe >= 0.5 && r.fatores.fe <= 1);
          assert.ok(r.fatores.ft >= 0.75 && r.fatores.ft <= 1.25);
        }
      }

      for (const tamanho of [5, 9, 15, 24, 36, 50]) {
        const r = calcularLiquidacaoMQ({
          sessionId: `baralho_${tamanho}`, dificuldade: 'dificil',
          modalidade: 'pontuacao', vitoria: true, elegivel: true,
          paresEncontrados: tamanho, somaMultiplicadores: tamanho * 2,
          tentativas: tamanho + 3, tempoSegundos: tamanho * 5, tempoAlvo: tamanho * 7
        });
        assert.ok(Number.isFinite(r.pontuacao) && r.pontuacao > 0);
      }
    });

    await test('liquidação é idempotente por sessão e persiste após fechar/reabrir o banco', async () => {
      await resetDB();
      await openDatabase();
      const anterior = await getSaldo();
      const primeiro = await liquidarSessaoMQ({
        sessionId: 'idempotente_1', dificuldade: 'normal', modalidade: 'tentativas',
        vitoria: true, elegivel: true, paresEncontrados: 4, somaMultiplicadores: 7,
        tentativas: 5, tentativasIniciais: 22, tentativasRestantes: 11,
        tempoSegundos: 70, tempoAlvo: 110
      });
      assert.strictEqual(primeiro.ok, true);
      const saldoApos = await obterSaldoMQ();
      assert.ok(saldoApos > 0);

      const repetido = await liquidarSessaoMQ({
        sessionId: 'idempotente_1', dificuldade: 'normal', modalidade: 'tentativas',
        vitoria: true, elegivel: true, paresEncontrados: 4, somaMultiplicadores: 7,
        tentativas: 5, tentativasIniciais: 22, tentativasRestantes: 11,
        tempoSegundos: 70, tempoAlvo: 110
      });
      assert.strictEqual(repetido.erro, 'duplicado');
      assert.strictEqual(await obterSaldoMQ(), saldoApos);

      const historico = await listarHistoricoMQ();
      assert.deepEqual([...new Set(historico.map((item) => item.tipo))].sort(),
        ['bonus_tentativas', 'pares']);
      assert.strictEqual(await getSaldo(), anterior, 'carteira legada não mudou');
      assert.strictEqual(await contarTransacoes(), 0, 'histórico legado não mudou');

      closeDatabase();
      await openDatabase();
      assert.strictEqual(await obterSaldoMQ(), saldoApos, 'saldo sobrevive ao reload');
      assert.strictEqual((await obterEstadoMQ()).totalConquistado, saldoApos);
    });

    await test('backup restaura a economia isolada sem corromper a legada', async () => {
      await resetDB();
      await openDatabase();
      await liquidarSessaoMQ({
        sessionId: 'backup_mq', dificuldade: 'facil', modalidade: 'pontuacao',
        vitoria: true, elegivel: true, paresEncontrados: 5, somaMultiplicadores: 8,
        tentativas: 6, tempoSegundos: 30, tempoAlvo: 60
      });
      const saldoEsperado = await obterSaldoMQ();
      const historicoEsperado = (await listarHistoricoMQ()).length;
      const backup = await exportarProgresso();
      assert.strictEqual(backup.stores.mqWallet.length, 1);
      assert.ok(backup.stores.mqTransactions.length > 0);
      assert.ok(backup.stores.mqSessions.length > 0);

      await resetDB();
      await openDatabase();
      assert.strictEqual(await obterSaldoMQ(), 0);
      const restaurado = await importarProgresso(backup);
      assert.strictEqual(restaurado.ok, true, restaurado.erros?.join(', '));
      assert.strictEqual(await obterSaldoMQ(), saldoEsperado);
      assert.strictEqual((await listarHistoricoMQ()).length, historicoEsperado);
      assert.strictEqual((await getAll('wallet'))[0].saldo, 0);
    });

    await test('HUD e resultado exibem saldo, moedas, sequência, multiplicador e pontos', async () => {
      const cenario = criarCenarioRendererNovo();
      try {
        const config = {
          ...criarConfigExpandida('normal', criarRng(11), { modalidade: 'pontuacao' }),
          saldoMQ: 77
        };
        const economia = {
          saldo: 77, moedasPares: 14, bonus: 0, total: 14, pontuacao: 1234,
          sequenciaFinal: 3, multiplicadorAtual: 4, modalidade: 'pontuacao',
          elegivel: true, motivoInelegibilidade: null
        };
        cenario.renderer.mostrarPartida(config, {
          ...criarPartida(config).estado(), economia
        });
        const hud = (chave) => encontrarNo(cenario.raiz,
          (no) => no.dataset?.hud === chave)?.textContent || '';
        assert.match(hud('saldo'), /SALDO MQ: 77/);
        assert.match(hud('moedas'), /MOEDAS: 14/);
        assert.match(hud('sequencia'), /SEQ: 3/);
        assert.match(hud('multiplicador'), /MULT: x4/);
        assert.match(hud('pontuacao'), /PONTOS: 1234/);

        cenario.renderer.mostrarResultado({
          titulo: 'DESAFIO CONCLUÍDO!', modo: 'expandido',
          economia: { ...economia, elegivel: false, motivoInelegibilidade: 'infinitas' },
          botoes: []
        });
        const texto = percorrerNo(cenario.raiz).map((no) => no.textContent).join(' ');
        assert.match(texto, /MOEDAS \+14/);
        assert.match(texto, /BÔNUS \+0/);
        assert.match(texto, /TOTAL \+14/);
        assert.match(texto, /SALDO 77/);
        assert.match(texto, /PONTOS 1234/);
        assert.match(texto, /RECOMPENSAS BLOQUEADAS: CHEAT \(infinitas\)/);
      } finally {
        cenario.restaurar();
      }
    });

    await test('menu mostra o saldo isolado sem mexer no cabeçalho legado', async () => {
      const cenario = criarCenarioRendererNovo();
      try {
        cenario.renderer.mostrarMenu({
          dificuldades: ['facil', 'normal'], nomesDificuldade: { facil: 'Fácil', normal: 'Normal' },
          saldoMQ: 321
        });
        const node = encontrarNo(cenario.raiz, (item) => item.dataset?.saldoMq !== undefined);
        assert.ok(node);
        assert.strictEqual(node.dataset.saldoMq, '321');
        assert.match(node.textContent, /SALDO MEMORY QUEST: 321/);
      } finally {
        cenario.restaurar();
      }
    });

    await test('auditoria: economia isolada, cheat centralizado e sem edição manual de saldo', async () => {
      const economia = readFileSync(new URL('../src/core/mq-economy.js', import.meta.url), 'utf8');
      const tracker = readFileSync(new URL('../src/games/cards/recompensas.js', import.meta.url), 'utf8');
      const integration = readFileSync(new URL('../src/games/cards/index.js', import.meta.url), 'utf8');
      const css = readFileSync(new URL('../src/games/cards/styles.css', import.meta.url), 'utf8');

      assert.ok(!/from\s+['"][^'"]*wallet\.js/.test(economia));
      assert.ok(!/from\s+['"][^'"]*transactions\.js/.test(economia));
      assert.ok(!/addCoins|debitCoins|getSaldo\(/.test(economia));
      assert.ok(!/definirSaldo|setSaldo|editarSaldo/.test(economia));
      assert.ok(tracker.includes('registrarCheat'));
      assert.ok(tracker.includes('rewardsEligible'));
      assert.ok(!/wallet\.js|transactions\.js/.test(tracker));

      const chamadasCheat = (integration.match(/sinalizarCheat\(/g) || []).length;
      assert.ok(chamadasCheat >= 7, `centralizador usado apenas ${chamadasCheat} vezes`);
      assert.strictEqual((integration.match(/liquidarSessaoMQ\(/g) || []).length, 1,
        'uma única liquidação no desfecho');
      assert.ok(integration.includes('idSessaoEsperado'));
      assert.ok(integration.includes('partidaFinalizada'));
      for (const trecho of [
        '.cards__saldo-mq',
        '.cards__hud-item--moedas',
        '.cards__hud-item--sequencia',
        '.cards__hud-item--multiplicador',
        '.cards__result-economia',
        '.cards__economia-bloqueio'
      ]) {
        assert.ok(css.includes(trecho), `ausente no CSS: ${trecho}`);
      }
    });
  });
}

async function grupoCorrecaoIndice() {
  await grupo('Correção crítica — índice de transações do Memory Quest', async () => {
    const esperarRequest = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Requisição falhou'));
    });

    await test('mock aplica índices únicos e aborta a transação sem persistir a escrita inválida', async () => {
      await resetDB();
      const db = await openDatabase();
      const store = db._stores.get('settings');
      store.createIndex('chaveUnicaTeste', 'chave', { unique: true });
      try {
        await put('settings', { chave: 'unica', valor: 1 });
        const quantidade = (await getAll('settings')).length;
        await assert.rejects(put('settings', { chave: 'unica', valor: 2 }));
        assert.strictEqual((await getAll('settings')).length, quantidade,
          'a segunda escrita não pode sobreviver ao abort');
      } finally {
        store.deleteIndex('chaveUnicaTeste');
      }
    });

    await test('A — vitória em Tentativas grava pares e bônus com o mesmo sessionId', async () => {
      await resetDB();
      await openDatabase();
      const saldoAntes = await obterSaldoMQ();
      const resultado = await liquidarSessaoMQ({
        sessionId: 'vitoria_tentativas_duplo',
        dificuldade: 'normal',
        modalidade: 'tentativas',
        vitoria: true,
        elegivel: true,
        paresEncontrados: 15,
        somaMultiplicadores: 150,
        tentativas: 11,
        tentativasIniciais: 22,
        tentativasRestantes: 11,
        tempoSegundos: 22,
        tempoAlvo: 110
      });
      assert.strictEqual(resultado.ok, true);
      const daSessao = (await listarHistoricoMQ())
        .filter((item) => item.sessionId === 'vitoria_tentativas_duplo');
      assert.deepEqual(daSessao.map((item) => item.tipo).sort(),
        ['bonus_tentativas', 'pares']);
      assert.strictEqual(daSessao.find((item) => item.tipo === 'pares').quantidade, 300);
      assert.strictEqual(daSessao.find((item) => item.tipo === 'bonus_tentativas').quantidade, 30);
      const sessoes = await getAll('mqSessions');
      assert.strictEqual(sessoes.length, 1);
      assert.strictEqual(sessoes[0].moedasPares, 300);
      assert.strictEqual(sessoes[0].bonus, 30);
      assert.strictEqual(sessoes[0].total, 330);
      assert.ok(sessoes[0].liquidadoEm > 0);
      assert.strictEqual(await obterSaldoMQ(), saldoAntes + 330);
      assert.strictEqual(await contarTransacoes(), 0, 'carteira legada intacta');
    });

    await test('B — derrota paga os pares encontrados e não gera bônus', async () => {
      await resetDB();
      await openDatabase();
      const saldoAntes = await obterSaldoMQ();
      const resultado = await liquidarSessaoMQ({
        sessionId: 'derrota_sem_bonus',
        dificuldade: 'normal',
        modalidade: 'tentativas',
        vitoria: false,
        elegivel: true,
        paresEncontrados: 4,
        somaMultiplicadores: 7,
        tentativas: 18,
        tentativasIniciais: 22,
        tentativasRestantes: 0,
        tempoSegundos: 80,
        tempoAlvo: 110
      });
      assert.strictEqual(resultado.ok, true);
      const daSessao = (await listarHistoricoMQ())
        .filter((item) => item.sessionId === 'derrota_sem_bonus');
      assert.deepEqual(daSessao.map((item) => item.tipo), ['pares']);
      assert.strictEqual(daSessao[0].quantidade, 14);
      const sessoes = await getAll('mqSessions');
      assert.strictEqual(sessoes[0].bonus, 0);
      assert.strictEqual(sessoes[0].total, 14);
      assert.strictEqual(await obterSaldoMQ(), saldoAntes + 14);
    });

    await test('C — partida com cheat registra bloqueio e não altera o saldo', async () => {
      await resetDB();
      await openDatabase();
      const saldoAntes = await obterSaldoMQ();
      const resultado = await liquidarSessaoMQ({
        sessionId: 'cheat_bloqueado',
        dificuldade: 'normal',
        modalidade: 'tentativas',
        vitoria: true,
        elegivel: false,
        motivoInelegibilidade: 'infinitas',
        paresEncontrados: 15,
        somaMultiplicadores: 150,
        tentativas: 11,
        tentativasIniciais: 22,
        tentativasRestantes: 11,
        tempoSegundos: 22,
        tempoAlvo: 110
      });
      assert.strictEqual(resultado.ok, true);
      const daSessao = (await listarHistoricoMQ())
        .filter((item) => item.sessionId === 'cheat_bloqueado');
      assert.deepEqual(daSessao.map((item) => item.tipo), ['recompensa_bloqueada']);
      assert.strictEqual(daSessao[0].quantidade, 0);
      const sessoes = await getAll('mqSessions');
      assert.strictEqual(sessoes[0].elegivel, false);
      assert.strictEqual(sessoes[0].motivoInelegibilidade, 'infinitas');
      assert.strictEqual(sessoes[0].total, 0);
      assert.ok(sessoes[0].liquidadoEm > 0);
      assert.strictEqual(await obterSaldoMQ(), saldoAntes);
    });

    await test('D — liquidação duplicada não credita nem repete transações', async () => {
      await resetDB();
      await openDatabase();
      const entradas = {
        sessionId: 'idempotente_duplo',
        dificuldade: 'normal',
        modalidade: 'tentativas',
        vitoria: true,
        elegivel: true,
        paresEncontrados: 4,
        somaMultiplicadores: 7,
        tentativas: 5,
        tentativasIniciais: 22,
        tentativasRestantes: 11,
        tempoSegundos: 70,
        tempoAlvo: 110
      };
      const primeiro = await liquidarSessaoMQ(entradas);
      assert.strictEqual(primeiro.ok, true);
      const saldo = await obterSaldoMQ();
      const historico = (await listarHistoricoMQ()).length;
      const sessoes = (await getAll('mqSessions')).length;
      const segundo = await liquidarSessaoMQ(entradas);
      assert.strictEqual(segundo.erro, 'duplicado');
      assert.strictEqual(await obterSaldoMQ(), saldo);
      assert.strictEqual((await listarHistoricoMQ()).length, historico);
      assert.strictEqual((await getAll('mqSessions')).length, sessoes);
      await assert.rejects(put('mqSessions', {
        sessionId: 'idempotente_duplo', total: 999, liquidadoEm: Date.now()
      }));
    });

    await test('E — falha parcial aborta carteira, histórico e sessão juntos', async () => {
      await resetDB();
      const db = await openDatabase();
      const store = db._stores.get('mqTransactions');
      // Índice artificial configura a segunda inserção (bônus) para falhar.
      store.createIndex('falhaForcada', 'quantidade', { unique: true });
      try {
        await put('mqTransactions', {
          sessionId: 'preexistente', tipo: 'pares', quantidade: 30, createdAt: 1
        });
        const saldoAntes = await obterSaldoMQ();
        const historicoAntes = (await listarHistoricoMQ()).length;
        const sessoesAntes = (await getAll('mqSessions')).length;
        await assert.rejects(liquidarSessaoMQ({
          sessionId: 'falha_parcial',
          dificuldade: 'normal',
          modalidade: 'tentativas',
          vitoria: true,
          elegivel: true,
          paresEncontrados: 4,
          somaMultiplicadores: 7,
          tentativas: 2,
          tentativasIniciais: 22,
          tentativasRestantes: 11,
          tempoSegundos: 20,
          tempoAlvo: 110
        }));
        assert.strictEqual(await obterSaldoMQ(), saldoAntes, 'carteira não pode mudar');
        assert.strictEqual((await listarHistoricoMQ()).length, historicoAntes, 'histórico não pode mudar');
        assert.strictEqual((await getAll('mqSessions')).length, sessoesAntes, 'sessão não pode ficar marcada');
      } finally {
        store.deleteIndex('falhaForcada');
      }
    });

    await test('F — migração v3 → v4 preserva registros e ajusta apenas o índice de transações', async () => {
      closeDatabase();
      mockIndexedDB.deleteDatabase('ArcadeCollection');
      const dbV3 = new IDBDatabase('ArcadeCollection', 3);
      for (const nome of STORES) {
        dbV3.createObjectStore(nome, { keyPath: 'id', autoIncrement: true });
      }
      dbV3._stores.get('mqTransactions').createIndex('sessionId', 'sessionId', { unique: true });
      dbV3._stores.get('mqSessions').createIndex('sessionId', 'sessionId', { unique: true });
      MOCK_DBS.set('ArcadeCollection', dbV3);
      await esperarRequest(dbV3._stores.get('mqWallet').add({
        id: 1, saldo: 77, totalConquistado: 77, totalLiquido: 77, atualizadoEm: 1
      }));
      await esperarRequest(dbV3._stores.get('mqTransactions').add({
        id: 1, walletId: 1, sessionId: 'v3_antiga', tipo: 'pares',
        quantidade: 14, createdAt: 1
      }));
      await esperarRequest(dbV3._stores.get('mqSessions').add({
        id: 1, sessionId: 'v3_antiga', total: 14, liquidadoEm: 1
      }));
      await esperarRequest(dbV3._stores.get('metadata').add({
        id: 1, versaoBanco: 3, criadoEm: 1, atualizadoEm: 1, integridade: 'ok'
      }));

      const db = await openDatabase();
      assert.strictEqual(db.version, 4);
      assert.strictEqual(db._stores.get('mqTransactions')._indexes.get('sessionId').unique, false,
        'mqTransactions.sessionId deve aceitar duplicatas');
      assert.strictEqual(db._stores.get('mqSessions')._indexes.get('sessionId').unique, true,
        'mqSessions.sessionId continua único');
      assert.strictEqual(await obterSaldoMQ(), 77);
      assert.strictEqual((await getAll('mqTransactions')).length, 1);
      assert.strictEqual((await getAll('mqSessions')).length, 1);
      assert.strictEqual((await getAll('metadata'))[0].versaoBanco, 4);

      await put('mqTransactions', {
        sessionId: 'v3_antiga', tipo: 'bonus_tentativas', quantidade: 5, createdAt: 2
      });
      assert.strictEqual((await getAll('mqTransactions')).length, 2,
        'pares e bônus coexistem na mesma sessão');
      await assert.rejects(put('mqSessions', {
        sessionId: 'v3_antiga', total: 999, liquidadoEm: 2
      }));
      assert.strictEqual((await getAll('mqSessions')).length, 1,
        'sessão duplicada continua proibida');
    });
  });
}

async function grupoRestauracaoCarteiraMQ() {
  await grupo('Restauração da carteira Memory Quest', async () => {
    const backupComSaldo = async (saldo) => {
      const backup = await exportarProgresso();
      backup.stores.mqWallet = [{
        id: MQ_WALLET_ID,
        saldo,
        totalConquistado: saldo,
        totalLiquido: saldo,
        atualizadoEm: Date.now()
      }];
      return backup;
    };

    await test('mock preserva autoIncrement com ID explícito e não reinicia no clear', async () => {
      await resetDB();
      await openDatabase();
      await clear('settings');
      const idExplicito = await put('settings', { id: 10, chave: 'explicito' });
      assert.strictEqual(idExplicito, 10, 'ID explícito deve ser preservado');
      const idAutomatico = await put('settings', { chave: 'automatico' });
      assert.strictEqual(idAutomatico, 11, 'gerador deve avançar após ID explícito');
      await clear('settings');
      const idAposClear = await put('settings', { chave: 'apos-clear' });
      assert.strictEqual(idAposClear, 12, 'clear não reinicia o gerador no IndexedDB real');
    });

    await test('1 — restaura em banco sem carteira e cria exatamente o ID canônico', async () => {
      await resetDB();
      await openDatabase();
      await clear('mqWallet');
      assert.strictEqual((await getAll('mqWallet')).length, 0);

      const resultado = await importarProgresso(await backupComSaldo(321));
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const carteiras = await getAll('mqWallet');
      assert.strictEqual(carteiras.length, 1);
      assert.strictEqual(carteiras[0].id, MQ_WALLET_ID);
      assert.strictEqual(carteiras[0].saldo, 321);
      assert.strictEqual(await obterSaldoMQ(), 321);
    });

    await test('2 — restaura em banco já aberto com mqWallet id 1', async () => {
      await resetDB();
      await openDatabase();
      await put('mqWallet', {
        id: MQ_WALLET_ID, saldo: 111, totalConquistado: 111, totalLiquido: 111, atualizadoEm: Date.now()
      });
      assert.strictEqual(await obterSaldoMQ(), 111);

      const resultado = await importarProgresso(await backupComSaldo(222));
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const carteiras = await getAll('mqWallet');
      assert.deepEqual(carteiras.map((carteira) => carteira.id), [MQ_WALLET_ID]);
      assert.strictEqual(carteiras[0].saldo, 222);
      assert.strictEqual(await obterSaldoMQ(), 222);
    });

    await test('3 — backup com saldo diferente do atual substitui sem somar', async () => {
      await resetDB();
      await openDatabase();
      await put('mqWallet', {
        id: MQ_WALLET_ID, saldo: 900, totalConquistado: 900, totalLiquido: 900, atualizadoEm: Date.now()
      });
      assert.strictEqual(await obterSaldoMQ(), 900);

      const resultado = await importarProgresso(await backupComSaldo(275));
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      assert.strictEqual(await obterSaldoMQ(), 275, 'não deve somar 900 + 275');
    });

    await test('4 — saldo público e totais correspondem exatamente ao backup', async () => {
      await resetDB();
      await openDatabase();
      const backup = await backupComSaldo(487);
      const resultado = await importarProgresso(backup);
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));

      const carteira = await get('mqWallet', MQ_WALLET_ID);
      assert.deepEqual(
        { saldo: carteira.saldo, totalConquistado: carteira.totalConquistado, totalLiquido: carteira.totalLiquido },
        { saldo: 487, totalConquistado: 487, totalLiquido: 487 }
      );
      assert.strictEqual(await obterSaldoMQ(), carteira.saldo);
      const estado = await obterEstadoMQ();
      assert.strictEqual(estado.saldo, 487);
    });

    await test('5 — não cria segunda carteira mesmo com gerador avançado', async () => {
      await resetDB();
      await openDatabase();
      await clear('mqWallet');
      await put('mqWallet', { id: 9, saldo: 900, totalConquistado: 900, totalLiquido: 900, atualizadoEm: Date.now() });
      const ultimoId = await put('mqWallet', { saldo: 901, totalConquistado: 901, totalLiquido: 901, atualizadoEm: Date.now() });
      assert.strictEqual(ultimoId, 10, 'gerador deve estar à frente do ID canônico');
      assert.strictEqual((await getAll('mqWallet')).length, 2);

      const resultado = await importarProgresso(await backupComSaldo(444));
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const carteiras = await getAll('mqWallet');
      assert.strictEqual(carteiras.length, 1, 'carteira concorrente não pode sobreviver');
      assert.strictEqual(carteiras[0].id, MQ_WALLET_ID);
      assert.strictEqual(await obterSaldoMQ(), 444);
    });

    await test('6 — backup antigo sem stores mq* preserva a carteira atual', async () => {
      await resetDB();
      await openDatabase();
      await put('mqWallet', {
        id: MQ_WALLET_ID, saldo: 555, totalConquistado: 555, totalLiquido: 555, atualizadoEm: Date.now()
      });
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId: 'antiga', tipo: 'pares', quantidade: 7, createdAt: 1
      });
      await put('mqSessions', { sessionId: 'antiga', total: 7, liquidadoEm: 1 });

      const antigo = await exportarProgresso();
      antigo.versaoBanco = 1;
      for (const nome of ['selfies', 'mqWallet', 'mqTransactions', 'mqSessions']) {
        delete antigo.stores[nome];
      }
      const resultado = await importarProgresso(antigo);
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      assert.ok(resultado.resumo.find((item) => item.store === 'mqWallet')?.preservada);
      assert.strictEqual(await obterSaldoMQ(), 555);
      assert.strictEqual((await getAll('mqWallet')).length, 1);
      assert.strictEqual((await getAll('mqTransactions')).length, 1);
      assert.strictEqual((await getAll('mqSessions')).length, 1);
    });

    await test('7 — backup sem ID na carteira recebe o ID canônico', async () => {
      await resetDB();
      await openDatabase();
      await clear('mqWallet');
      const backup = await backupComSaldo(666);
      delete backup.stores.mqWallet[0].id;

      const resultado = await importarProgresso(backup);
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const carteiras = await getAll('mqWallet');
      assert.strictEqual(carteiras.length, 1);
      assert.strictEqual(carteiras[0].id, MQ_WALLET_ID);
      assert.strictEqual(await obterSaldoMQ(), 666);
    });

    await test('7b — ID divergente é normalizado para evitar duas carteiras ativas', async () => {
      await resetDB();
      await openDatabase();
      await clear('mqWallet');
      const backup = await backupComSaldo(667);
      backup.stores.mqWallet[0].id = 99;

      const resultado = await importarProgresso(backup);
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const carteiras = await getAll('mqWallet');
      assert.strictEqual(carteiras.length, 1);
      assert.strictEqual(carteiras[0].id, MQ_WALLET_ID);
      assert.strictEqual(await obterSaldoMQ(), 667);
    });

    await test('8 — transações e sessões permanecem consistentes após a restauração', async () => {
      await resetDB();
      await openDatabase();
      const sessionId = 'restauracao_consistente';
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId, tipo: 'pares', quantidade: 12, createdAt: 1
      });
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId, tipo: 'bonus_tentativas', quantidade: 4, createdAt: 2
      });
      await put('mqSessions', { sessionId, total: 16, liquidadoEm: 3 });

      const resultado = await importarProgresso(await backupComSaldo(321));
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado.erros));
      const transacoes = await getAll('mqTransactions');
      const sessoes = await getAll('mqSessions');
      assert.strictEqual(transacoes.length, 2);
      assert.deepEqual(transacoes.map((item) => item.tipo).sort(), ['bonus_tentativas', 'pares']);
      assert.ok(transacoes.every((item) => item.sessionId === sessionId && item.walletId === MQ_WALLET_ID));
      assert.strictEqual(sessoes.length, 1);
      assert.strictEqual(sessoes[0].sessionId, sessionId);
      assert.strictEqual(sessoes[0].total, 16);
      assert.strictEqual(await obterSaldoMQ(), 321);
    });
  });
}

// ============================================================================
// ETAPA 4 — ESTATÍSTICAS, PERFIL, ZOOM E CONFIGURAÇÕES
// ============================================================================

/** DOM mínimo para os painéis; devolve uma função de restauração. */
function instalarDOMDePainel() {
  const anterior = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new MockNode(tag),
    activeElement: null,
    // renderizarPerfil() também sincroniza o cabeçalho legado.
    getElementById: () => new MockNode('div'),
    querySelector: () => new MockNode('div')
  };
  return () => { globalThis.document = anterior; };
}

/** Espera a re-renderização assíncrona disparada por um clique no painel. */
async function esperarTexto(root, regex, limiteMs = 2000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (regex.test(percorrerNo(root).map((no) => no.textContent).join(' '))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Texto não apareceu: ${regex}`);
}

async function grupoEtapa4() {
  await grupo('ETAPA 4 — estatísticas, perfil, zoom e configurações', async () => {
    await test('dados vazios mostram ausência de histórico, não zero', async () => {
      await resetDB();
      await openDatabase();
      const { partidas, insights } = await obterInsightsPartidas('cards');
      assert.strictEqual(partidas.length, 0);
      assert.strictEqual(insights.partidas, 0);
      assert.strictEqual(insights.taxaVitorias, null);
      assert.strictEqual(insights.tempoMedioSegundos, null);
      assert.strictEqual(insights.paresPorPartida, null);
      assert.deepEqual(insights.evolucao, []);
      assert.deepEqual(insights.porDificuldade, []);

      const restaurarDOM = instalarDOMDePainel();
      try {
        const vazio = graficoEvolucao({ partidas: [] });
        const texto = percorrerNo(vazio).map((no) => no.textContent).join(' ');
        assert.match(texto, /Nenhuma partida|Sem dados/);
        assert.strictEqual(
          encontrarNo(vazio, (no) => no.classList.contains('mq-chart__passo')), null
        );
        assert.match(percorrerNo(estadoVazio('Sem registros'))[0].textContent, /Sem registros/);
      } finally {
        restaurarDOM();
      }
      assert.strictEqual((await obterMoedasConquistadasMQ()).transacoes, 0);
    });

    await test('uma partida, vitória e derrota alimentam indicadores coerentes', async () => {
      await resetDB();
      await openDatabase();
      await registrarPartida({
        jogo: 'cards', modo: 'expandido', modalidade: 'pontuacao',
        dificuldade: 'facil', concluida: true, vitoria: true,
        paresEncontrados: 9, tentativas: 11, erros: 2, tempoSegundos: 40,
        playedAt: 1000
      });
      let leitura = await obterInsightsPartidas('cards');
      assert.strictEqual(leitura.insights.partidas, 1);
      assert.strictEqual(leitura.insights.vitorias, 1);
      assert.strictEqual(leitura.insights.derrotas, 0);
      assert.strictEqual(leitura.insights.taxaVitorias, 1);
      assert.strictEqual(leitura.insights.evolucao.length, 1);
      assert.strictEqual(leitura.insights.evolucao[0].vitoria, true);

      await registrarPartida({
        jogo: 'cards', modo: 'expandido', modalidade: 'tentativas',
        dificuldade: 'dificil', concluida: true, vitoria: false,
        paresEncontrados: 4, tentativas: 20, erros: 16, tempoSegundos: 60,
        playedAt: 2000
      });
      leitura = await obterInsightsPartidas('cards');
      const bruta = await obterEstatisticas('cards');
      assert.strictEqual(leitura.insights.concluidas, 2);
      assert.strictEqual(leitura.insights.vitorias, 1);
      assert.strictEqual(leitura.insights.derrotas, 1);
      assert.strictEqual(leitura.insights.taxaVitorias, 0.5);
      assert.strictEqual(leitura.insights.pares, 13);
      assert.strictEqual(leitura.insights.tempoMedioSegundos, 50);
      assert.deepEqual(leitura.insights.evolucao.map((item) => item.vitoria), [true, false]);
      assert.strictEqual(bruta.vitorias, leitura.insights.vitorias);
      assert.strictEqual(bruta.derrotas, leitura.insights.derrotas);
    });

    await test('diferentes dificuldades e nacionalidade dos gráficos batem com os registros', async () => {
      await resetDB();
      await openDatabase();
      const cenarios = [
        ['facil', true, 40, 9], ['normal', false, 50, 6],
        ['dificil', true, 60, 12], ['extremo', false, 80, 3]
      ];
      for (const [indice, [dificuldade, vitoria, tempoSegundos, paresEncontrados]] of cenarios.entries()) {
        await registrarPartida({
          jogo: 'cards', modo: 'expandido', dificuldade, concluida: true, vitoria,
          tempoSegundos, paresEncontrados, tentativas: 12, playedAt: 100 + indice
        });
      }
      const { insights } = await obterInsightsPartidas('cards');
      assert.strictEqual(insights.porDificuldade.length, 4);
      assert.deepEqual(insights.porDificuldade.map((item) => item.chave),
        ['facil', 'normal', 'dificil', 'muitodificil', 'extremo'].filter(
          (chave) => cenarios.some((cenario) => cenario[0] === chave)
        ));
      const extremo = insights.porDificuldade.find((item) => item.chave === 'extremo');
      assert.strictEqual(extremo.taxaVitorias, 0);
      assert.strictEqual(extremo.vitorias, 0);
      assert.strictEqual(extremo.derrotas, 1);

      const restaurarDOM = instalarDOMDePainel();
      try {
        const evolucao = graficoEvolucao({
          partidas: insights.evolucao, criterio: 'critério real', limite: 12
        });
        const passos = percorrerNo(evolucao)
          .filter((no) => no.classList.contains('mq-chart__passo'));
        assert.strictEqual(passos.length, 4);
        assert.match(percorrerNo(evolucao).map((no) => no.textContent).join(' '), /critério real/);
        const preenchimentos = percorrerNo(evolucao).filter(
          (no) => no.classList.contains('mq-chart__passo-barra')
        );
        assert.deepEqual(
          preenchimentos.map((no) => no.style.getPropertyValue('--mq-preenchimento')),
          ['100%', '0%', '100%', '0%']
        );

        const barras = graficoBarras({
          titulo: 'Taxa', criterio: 'vitórias ÷ concluídas',
          itens: insights.porDificuldade.map((item) => ({
            rotulo: item.rotulo, valor: item.taxaVitorias * 100
          })),
          formatarValor: (valor) => `${Math.round(valor)}%`
        });
        const larguras = percorrerNo(barras)
          .filter((no) => no.classList.contains('mq-chart__barra'))
          .map((no) => no.style.getPropertyValue('--mq-barra'));
        assert.deepEqual(larguras, ['100%', '0%', '100%', '0%']);
      } finally {
        restaurarDOM();
      }
    });

    await test('evolução limita o histórico exibido sem alterar os agregados', async () => {
      await resetDB();
      await openDatabase();
      const total = LIMITE_EVOLUCAO + 3;
      for (let indice = 0; indice < total; indice += 1) {
        await registrarPartida({
          concluida: true, vitoria: indice % 2 === 0,
          tempoSegundos: 10 + indice, paresEncontrados: indice,
          playedAt: 1000 + indice
        });
      }
      const { insights } = await obterInsightsPartidas('cards');
      assert.strictEqual(insights.partidas, total);
      assert.strictEqual(insights.evolucao.length, LIMITE_EVOLUCAO);
      assert.strictEqual(insights.evolucao[0].numero, 4);
      assert.strictEqual(insights.evolucao[LIMITE_EVOLUCAO - 1].numero, total);
    });

    await test('painel de estatísticas atualiza após nova partida e não grava dados', async () => {
      await resetDB();
      await openDatabase();
      const restaurarDOM = instalarDOMDePainel();
      try {
        const root = new MockNode('div');
        await renderizarEstatisticas(root);
        let texto = percorrerNo(root).map((no) => no.textContent).join(' ');
        assert.match(texto, /Nenhuma partida registrada/);
        assert.match(texto, /Critério e período/);
        assert.match(texto, /Moedas do Memory Quest/);

        await registrarPartida({
          concluida: true, vitoria: true, dificuldade: 'normal',
          paresEncontrados: 8, tempoSegundos: 32, playedAt: 1
        });
        const quantidadeAntes = (await getAll('matches')).length;
        await renderizarEstatisticas(root);
        texto = percorrerNo(root).map((no) => no.textContent).join(' ');
        assert.doesNotMatch(texto, /Nenhuma partida registrada/);
        assert.match(texto, /Partidas/);
        assert.match(texto, /Evolução/);
        assert.strictEqual((await getAll('matches')).length, quantidadeAntes);
      } finally {
        restaurarDOM();
      }
    });

    await test('moedas exibidas vêm só das transações creditadas', async () => {
      await resetDB();
      await openDatabase();
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId: 's1', tipo: MQ_TIPO_PAR,
        quantidade: 40, createdAt: 1
      });
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId: 's1', tipo: MQ_TIPO_BONUS,
        quantidade: 10, createdAt: 2
      });
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId: 's2', tipo: 'recompensa_bloqueada',
        quantidade: 0, createdAt: 3
      });
      const resultado = await obterMoedasConquistadasMQ();
      assert.strictEqual(resultado.total, 50);
      assert.strictEqual(resultado.transacoes, 2);
      assert.strictEqual(resultado.porTipo.pares, 40);
      assert.strictEqual(resultado.porTipo.bonus, 10);

      const restaurarDOM = instalarDOMDePainel();
      try {
        const root = new MockNode('div');
        await renderizarEstatisticas(root);
        const texto = percorrerNo(root).map((no) => no.textContent).join(' ');
        assert.match(texto, /Total já creditado: 50 moeda\(s\) em 2 transação\(ões\)/);
        assert.match(texto, /mqTransactions/);
      } finally {
        restaurarDOM();
      }
    });

    await test('exclusão apaga só identidade e preserva todos os dados alheios', async () => {
      await resetDB();
      await openDatabase();
      await salvarPerfil({ nome: 'Antes', avatar: 'data:image/jpeg;base64,QUJD' });
      const registro = (await getAll('profile'))[0];
      await put('profile', { ...registro, idExterno: 'externo-9', tema: 'retro' });
      await registrarPartida({ concluida: true, vitoria: true, tempoSegundos: 20 });
      await put('settings', { id: 1, dificuldadeCartas: 'dificil', volumeFxCartas: 35 });
      await put('selfies', { id: 7, nome: 'Selfie preservada', imagem: 'data:image/png;base64,QQ==' });
      await put('mqWallet', {
        id: MQ_WALLET_ID, saldo: 88, totalConquistado: 88, totalLiquido: 88
      });
      await put('mqTransactions', {
        walletId: MQ_WALLET_ID, sessionId: 'preservada', tipo: MQ_TIPO_PAR, quantidade: 88
      });

      await excluirPerfil();
      const depois = await obterPerfil();
      assert.strictEqual(depois.nome, '');
      assert.strictEqual(depois.avatar, null);
      assert.strictEqual(depois.excluido, true);
      const gravado = (await getAll('profile'))[0];
      assert.strictEqual(gravado.perfilExcluido, true);
      assert.strictEqual(gravado.idExterno, 'externo-9');
      assert.strictEqual(gravado.criadoEm, registro.criadoEm);
      assert.strictEqual(gravado.tema, 'retro');
      assert.strictEqual((await getAll('profile')).length, 1);
      assert.strictEqual((await getAll('matches')).length, 1);
      assert.strictEqual((await getAll('settings'))[0].dificuldadeCartas, 'dificil');
      assert.strictEqual((await getAll('selfies')).length, 1);
      assert.strictEqual((await getAll('mqWallet'))[0].saldo, 88);
      assert.strictEqual((await getAll('mqTransactions')).length, 1);
    });

    await test('novo perfil pode ser criado depois da exclusão', async () => {
      await excluirPerfil();
      await salvarPerfil({ nome: '  Nova pessoa  ' });
      const perfil = await obterPerfil();
      assert.strictEqual(perfil.nome, 'Nova pessoa');
      assert.strictEqual(perfil.excluido, false);
      const gravado = (await getAll('profile'))[0];
      assert.strictEqual(gravado.perfilExcluido, undefined);
      assert.strictEqual(gravado.idExterno, 'externo-9');
      assert.strictEqual((await getAll('matches')).length, 1);
      assert.strictEqual((await getAll('selfies')).length, 1);
    });

    await test('painel de perfil confirma exclusão e mostra estado sem perfil', async () => {
      await resetDB();
      await openDatabase();
      await salvarPerfil({ nome: 'Confirmar', avatar: 'data:image/jpeg;base64,QUJD' });
      const restaurarDOM = instalarDOMDePainel();
      const confirmAnterior = globalThis.confirm;
      try {
        const root = new MockNode('div');
        await renderizarPerfil(root);
        const botaoExcluir = encontrarNo(root, (no) => no.classList.contains('profile__excluir'));
        assert.ok(botaoExcluir, 'botão de exclusão ausente');
        let mensagemConfirmacao = '';
        globalThis.confirm = (texto) => {
          mensagemConfirmacao = texto;
          return false;
        };
        botaoExcluir.dispatch('click');
        // O mock de IndexedDB completa a transação após ~50 ms.
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.match(mensagemConfirmacao, /nome do jogador/);
        assert.match(mensagemConfirmacao, /foto de perfil/);
        assert.match(mensagemConfirmacao, /selfies/);
        assert.match(mensagemConfirmacao, /carteira e transações do Memory Quest/);
        assert.match(mensagemConfirmacao, /NÃO apaga todos os dados/);
        assert.strictEqual((await obterPerfil()).nome, 'Confirmar');

        globalThis.confirm = () => true;
        await renderizarPerfil(root);
        const botaoConfirmado = encontrarNo(root, (no) => no.classList.contains('profile__excluir'));
        botaoConfirmado.dispatch('click');
        await esperarTexto(root, /Perfil excluído neste dispositivo/);
        const perfil = await obterPerfil();
        assert.strictEqual(perfil.excluido, true);
      } finally {
        globalThis.confirm = confirmAnterior;
        restaurarDOM();
      }
    });

    await test('perfil excluído entra no backup e sobrevive à restauração', async () => {
      await resetDB();
      await openDatabase();
      await salvarPerfil({ nome: 'Backup', avatar: 'data:image/jpeg;base64,QUJD' });
      await excluirPerfil();
      const backup = await exportarProgresso();
      assert.strictEqual(validarEstrutura(backup).valido, true);
      const perfil = backup.stores.profile.find((item) => Number(item.id) === 1);
      assert.strictEqual(perfil.perfilExcluido, true);
      await importarProgresso(backup);
      const restaurado = await obterPerfil();
      assert.strictEqual(restaurado.excluido, true);
      assert.strictEqual(restaurado.nome, '');
      assert.strictEqual(restaurado.avatar, null);
    });

    await test('tamanho da ampliação é normalizado em 100–150% com passos de 5%', async () => {
      assert.strictEqual(TAMANHO_AMPLIACAO_PADRAO, 120);
      assert.strictEqual(TAMANHO_AMPLIACAO_MIN, 100);
      assert.strictEqual(TAMANHO_AMPLIACAO_MAX, 150);
      assert.strictEqual(TAMANHO_AMPLIACAO_PASSO, 5);
      assert.strictEqual(normalizarTamanhoAmpliacao(undefined), 120);
      assert.strictEqual(normalizarTamanhoAmpliacao(null), 120);
      assert.strictEqual(normalizarTamanhoAmpliacao('abc'), 120);
      assert.strictEqual(normalizarTamanhoAmpliacao(100), 100);
      assert.strictEqual(normalizarTamanhoAmpliacao(120), 120);
      assert.strictEqual(normalizarTamanhoAmpliacao(150), 150);
      assert.strictEqual(normalizarTamanhoAmpliacao(103), 105);
      assert.strictEqual(normalizarTamanhoAmpliacao(999), 150);
      assert.strictEqual(normalizarTamanhoAmpliacao(12), 100);
    });

    await test('tamanho persiste, aceita backup antigo e notifica a partida aberta', async () => {
      await resetDB();
      await openDatabase();
      assert.strictEqual(await obterTamanhoAmpliacaoCartas(), 120);
      await put('settings', { id: 1, dificuldadeCartas: 'normal', visualizacaoCartas: 'fixa' });
      assert.strictEqual(await obterTamanhoAmpliacaoCartas(), 120,
        'registro antigo sem o campo usa o padrão');
      await salvarTamanhoAmpliacaoCartas(150);
      assert.strictEqual(await obterTamanhoAmpliacaoCartas(), 150);
      assert.strictEqual((await getAll('settings'))[0].visualizacaoCartas, 'fixa');
      await salvarTamanhoAmpliacaoCartas(100);
      assert.strictEqual(await obterTamanhoAmpliacaoCartas(), 100);

      const notificados = [];
      const remover = registrarObservadorPreferencias((preferencias) => {
        notificados.push(preferencias.tamanhoAmpliacaoCartas);
      });
      await salvarTamanhoAmpliacaoCartas(135);
      assert.deepEqual(notificados, [135]);
      remover();
      await salvarTamanhoAmpliacaoCartas(110);
      assert.deepEqual(notificados, [135], 'observador removido não recebe mais eventos');
    });

    await test('controle de tamanho aparece em 100/120/150 e salva imediatamente', async () => {
      await resetDB();
      await openDatabase();
      const restaurarDOM = instalarDOMDePainel();
      try {
        const root = new MockNode('div');
        await renderizarConfiguracoes(root);
        const slider = encontrarNo(root, (no) => no.dataset?.ampliacaoTamanho);
        assert.ok(slider, 'slider de tamanho ausente');
        assert.strictEqual(slider.min, '100');
        assert.strictEqual(slider.max, '150');
        assert.strictEqual(slider.step, '5');
        assert.strictEqual(slider.value, '120');
        const rotulo = slider.parentNode.children.find(
          (no) => no.classList.contains('mq-panel__volume-rotulo')
        );
        slider.value = '150';
        slider.dispatch('input');
        // O mock de IndexedDB completa a transação após ~50 ms.
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.strictEqual(await obterTamanhoAmpliacaoCartas(), 150);
        assert.match(rotulo.textContent, /150%/);
        const texto = percorrerNo(root).map((no) => no.textContent).join(' ');
        assert.match(texto, /Padrão: 120%/);
        assert.match(texto, /sem reiniciar a partida/);
      } finally {
        restaurarDOM();
      }
    });

    await test('tamanho muda nos três modos sem recriar tabuleiro, mover cartas ou reflow', async () => {
      for (const modo of Object.values(VISUALIZACAO_CARTAS)) {
        const c = criarCenarioAmpliacao();
        try {
          const cfg = {
            ...configComVisualizacao('facil', modo),
            tamanhoAmpliacaoCartas: 100
          };
          const partida = criarPartida(cfg);
          c.renderer.mostrarPartida(cfg, partida.estado());
          const board = encontrarNo(c.raiz, (no) => no.classList.contains('cards__board'));
          assert.ok(board, `tabuleiro ausente no modo ${modo}`);
          const cartas = percorrerNo(board).filter((no) => no.classList.contains('cards__card'));
          const posicoes = cartas.map((no) => JSON.stringify(no._styleProps));
          const filhos = board.children.length;

          if (modo !== 'original') {
            partida.selecionar(listarPares(cfg.cartas)[0][0]);
            c.renderer.atualizar(partida.estado(), cfg, 1);
            const face = encontrarNo(c.raiz, (no) => no.dataset?.ampliacaoId);
            assert.ok(face, `face ampliada ausente no modo ${modo}`);
            assert.strictEqual(face.style.getPropertyValue('--ampliacao-escala'), '1');
            c.renderer.definirTamanhoAmpliacao(150);
            assert.strictEqual(face.style.getPropertyValue('--ampliacao-escala'), '1.5',
              `escala não aplicada no modo ${modo}`);
          } else {
            c.renderer.definirTamanhoAmpliacao(150);
          }

          const depois = encontrarNo(c.raiz, (no) => no.classList.contains('cards__board'));
          assert.strictEqual(depois, board, `tabuleiro recriado no modo ${modo}`);
          assert.strictEqual(depois.children.length, filhos);
          const cartasDepois = percorrerNo(depois)
            .filter((no) => no.classList.contains('cards__card'));
          assert.deepEqual(cartasDepois.map((no) => JSON.stringify(no._styleProps)), posicoes,
            `cartas deslocadas no modo ${modo}`);
        } finally {
          c.restaurar();
        }
      }
    });

    await test('controle na partida aplica o tamanho sem sair da rodada', async () => {
      const c = criarCenarioAmpliacao();
      try {
        const cfg = {
          ...configComVisualizacao('facil', 'fixa'),
          tamanhoAmpliacaoCartas: 120
        };
        const partida = criarPartida(cfg);
        c.renderer.mostrarPartida(cfg, partida.estado());
        const board = encontrarNo(c.raiz, (no) => no.classList.contains('cards__board'));
        const cartas = percorrerNo(board).filter((no) => no.classList.contains('cards__card'));
        const posicoes = cartas.map((no) => JSON.stringify(no._styleProps));

        const slider = encontrarNo(c.raiz, (no) => no.dataset?.ampliacaoTamanhoPartida);
        assert.ok(slider, 'controle de tamanho da partida ausente');
        assert.strictEqual(slider.min, '100');
        assert.strictEqual(slider.max, '150');
        assert.strictEqual(slider.step, '5');
        assert.strictEqual(slider.value, '120');

        partida.selecionar(listarPares(cfg.cartas)[0][0]);
        c.renderer.atualizar(partida.estado(), cfg, 1);
        const face = encontrarNo(c.raiz, (no) => no.dataset?.ampliacaoId);
        assert.ok(face);
        assert.strictEqual(face.style.getPropertyValue('--ampliacao-escala'), '1.2');

        slider.value = '100';
        slider.dispatch('input');
        assert.strictEqual(face.style.getPropertyValue('--ampliacao-escala'), '1');
        assert.deepEqual(c.eventos.filter((evento) => evento.startsWith('zoom:')), ['zoom:100']);
        assert.strictEqual(encontrarNo(c.raiz, (no) => no.classList.contains('cards__board')), board);
        assert.deepEqual(
          percorrerNo(board).filter((no) => no.classList.contains('cards__card'))
            .map((no) => JSON.stringify(no._styleProps)),
          posicoes
        );
      } finally {
        c.restaurar();
      }
    });

    await test('configurações permanecem persistentes e os padrões aprovados intactos', async () => {
      await resetDB();
      await openDatabase();
      await salvarPreferenciasCartas({
        dificuldadeCartas: 'dificil',
        progressaoAutomaticaCartas: false,
        modalidadeCartas: 'tentativas',
        visualizacaoCartas: 'temporaria',
        tamanhoAmpliacaoCartas: 135,
        volumeFxCartas: 45,
        volumeBgmCartas: 30,
        selfiesAtivas: [2, 3]
      });
      const preferencias = await obterPreferenciasCartas();
      assert.strictEqual(preferencias.dificuldadeCartas, 'dificil');
      assert.strictEqual(preferencias.progressaoAutomaticaCartas, false);
      assert.strictEqual(preferencias.modalidadeCartas, 'tentativas');
      assert.strictEqual(preferencias.visualizacaoCartas, 'temporaria');
      assert.strictEqual(preferencias.tamanhoAmpliacaoCartas, 135);
      assert.strictEqual(preferencias.volumeFxCartas, 45);
      assert.strictEqual(preferencias.volumeBgmCartas, 30);
      assert.deepEqual(preferencias.selfiesAtivas, [2, 3]);

      await resetDB();
      await openDatabase();
      const padroes = await obterPreferenciasCartas();
      assert.strictEqual(padroes.dificuldadeCartas, 'normal');
      assert.strictEqual(padroes.progressaoAutomaticaCartas, true);
      assert.strictEqual(padroes.visualizacaoCartas, 'original');
      assert.strictEqual(padroes.tamanhoAmpliacaoCartas, 120);
      assert.strictEqual(padroes.volumeFxCartas, VOLUME_FX_PADRAO);
      assert.strictEqual(padroes.volumeBgmCartas, VOLUME_BGM_PADRAO);
    });

    await test('controles avançados continuam recolhidos e CSS usa transform sem reflow', async () => {
      const painel = readFileSync(new URL('../src/ui/panels.js', import.meta.url), 'utf8');
      const renderer = readFileSync(
        new URL('../src/games/cards/renderer.js', import.meta.url), 'utf8'
      );
      const css = readFileSync(
        new URL('../src/games/cards/styles.css', import.meta.url), 'utf8'
      );
      assert.match(painel, /el\('details', 'mq-panel__secao mq-panel__secao--avancado/);
      assert.match(renderer, /el\('details', 'cards__avancado'\)/);
      assert.match(renderer, /definirTamanhoAmpliacao/);
      assert.match(css, /transform: scale\(var\(--ampliacao-escala, 1\.2\)\)/);
      assert.doesNotMatch(css, /\.cards__ampliacao-carta\s*\{[^}]*position:\s*absolute/);
      const main = readFileSync(new URL('../src/app/main.js', import.meta.url), 'utf8');
      assert.match(main, /if \(area === 'stats'\)/);
      assert.match(main, /renderizarEstatisticas/);
    });
  });
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

async function main() {
  process.stdout.write('🧪 Memory Quest Alpha — Suíte de testes automatizados\n');
  process.stdout.write('======================================================\n');

  await grupoBanco();
  await grupoCarteira();
  await grupoTransacoes();
  await grupoRecompensas();
  await grupoDificuldades();
  await grupoPlinko();
  await grupoBackup();
  await grupoCardMatch();
  await grupoVisualizacaoCartas();
  await grupoModoTentativas();
  await grupoSelfies();
  await grupoPreferenciasEStats();
  await grupoEtapa2();
  await grupoBancoV2();
  await grupoEtapa3();
  await grupoCorrecaoIndice();
  await grupoRestauracaoCarteiraMQ();
  await grupoAudioEInterface();
  await grupoVolumes();
  await grupoPerfil();
  await grupoConquistasHome();
  await grupoIconesPWA();
  await grupoIdentidade();
  await grupoBotoes();
  await grupoAuditoria();
  await grupoEtapa4();

  delete globalThis.window;
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
