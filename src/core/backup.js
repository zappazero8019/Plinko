/**
 * backup.js — Exportação e importação de progresso (JSON)
 *
 * Regras obrigatórias:
 *  - Validar estrutura do arquivo antes de importar
 *  - Verificar versão
 *  - Detectar dados inválidos
 *  - Solicitar confirmação antes da restauração (feita na camada UI)
 *  - Nunca substituir progresso atual sem validação e confirmação explícita
 */

import {
  getAll, get, STORES, transaction, put, del, clear, DB_VERSION
} from './database.js';

/**
 * Envolve um IDBRequest em uma Promise (onsuccess/onerror).
 */
function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Requisição IndexedDB falhou'));
  });
}

const FORMATO_VERSION = '1.0.0';

/**
 * Estrutura esperada de um backup válido.
 */
const ESTRUTURA_ESPERADA = {
  versao: 'string',
  geradoEm: 'number',
  stores: 'object'
};

/**
 * Exporta todas as stores para um objeto JSON serializável.
 * @returns {Promise<object>}
 */
async function exportarProgresso() {
  const storesData = {};

  for (const storeName of STORES) {
    try {
      const registros = await getAll(storeName);
      storesData[storeName] = registros;
    } catch (err) {
      console.warn(`[backup] Falha ao exportar store "${storeName}":`, err.message);
      storesData[storeName] = [];
    }
  }

  const backup = {
    formato: FORMATO_VERSION,
    versaoBanco: DB_VERSION,
    geradoEm: Date.now(),
    fonte: 'Arcade Collection Alpha',
    stores: storesData
  };

  return backup;
}

/**
 * Gera um arquivo .json e dispara download no navegador.
 * @param {string} nomeArquivo
 * @returns {Promise<void>}
 */
async function downloadBackup(nomeArquivo = null) {
  const backup = await exportarProgresso();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const nome = nomeArquivo || `arcade-backup-${new Date().toISOString().slice(0, 10)}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return nome;
}

/**
 * Valida a estrutura de um objeto de backup antes de importar.
 * @param {any} dados
 * @returns {{valido: boolean, erros: Array<string>}}
 */
function validarEstrutura(dados) {
  const erros = [];

  if (!dados || typeof dados !== 'object') {
    erros.push('Arquivo não é um objeto JSON válido');
    return { valido: false, erros };
  }

  if (dados.formato !== FORMATO_VERSION) {
    erros.push(`Versão do formato não suportada: "${dados.formato}" (esperado "${FORMATO_VERSION}")`);
  }

  if (dados.versaoBanco == null) {
    erros.push('versaoBanco ausente no backup');
  }

  if (!dados.stores || typeof dados.stores !== 'object') {
    erros.push('Estrutura "stores" ausente ou inválida');
    return { valido: false, erros };
  }

  // Verifica se todas as stores obrigatórias estão presentes
  for (const storeName of STORES) {
    if (!(storeName in dados.stores)) {
      erros.push(`Store obrigatória ausente: ${storeName}`);
    } else if (!Array.isArray(dados.stores[storeName])) {
      erros.push(`Store "${storeName}" não é um array`);
    }
  }

  // Detecta dados inválidos dentro das stores
  for (const [storeName, registros] of Object.entries(dados.stores)) {
    if (!Array.isArray(registros)) continue;
    registros.forEach((reg, idx) => {
      if (!reg || typeof reg !== 'object') {
        erros.push(`Registro inválido em ${storeName}[${idx}]`);
      } else if (reg.id == null && reg.id !== 0) {
        // id é opcional em importação (será reatribuído), mas avisamos se ausente
      }
    });
  }

  return { valido: erros.length === 0, erros };
}

/**
 * Importa um backup válido substituindo as stores atuais.
 * Esta função NÃO pede confirmação — a confirmação é responsabilidade da UI.
 * Operação atômica por store: limpa e reinsere todos os registros.
 *
 * @param {object} backup - objeto já validado por validarEstrutura
 * @returns {Promise<{ok, resumo: Array<{store, registros}>} | {ok:false, erros}>}
 */
async function importarProgresso(backup) {
  const validacao = validarEstrutura(backup);
  if (!validacao.valido) {
    return { ok: false, erros: validacao.erros };
  }

  const resumo = [];

  // Executa store por store em transações separadas (atomicidade por store)
  for (const storeName of STORES) {
    const registros = backup.stores[storeName] || [];
    try {
      await transaction(storeName, 'readwrite', (tx) => {
        const store = tx.objectStore(storeName);
        return new Promise((resolve, reject) => {
          const clearReq = store.clear();
          clearReq.onsuccess = () => {
            const promises = registros.map((reg) => {
              const { id, ...semId } = reg;
              return requestPromise(store.add(semId));
            });
            Promise.all(promises).then(resolve, reject);
          };
          clearReq.onerror = () => reject(clearReq.error || new Error(`clear falhou em ${storeName}`));
        });
      });
      resumo.push({ store: storeName, registros: registros.length });
    } catch (err) {
      console.error(`[backup] Falha ao importar store "${storeName}":`, err);
      return {
        ok: false,
        erros: [`Falha ao importar store "${storeName}": ${err.message}`],
        parcial: resumo
      };
    }
  }

  // Atualiza metadata de restauração
  try {
    await put('metadata', {
      versaoBanco: DB_VERSION,
      atualizadoEm: Date.now(),
      ultimaRestauracao: Date.now(),
      integridade: 'ok',
      fonteBackup: backup.fonte || 'desconhecida'
    });
  } catch (err) {
    // Não falha a importação por causa do metadata
    console.warn('[backup] Falha ao atualizar metadata pós-restauração:', err.message);
  }

  return { ok: true, resumo };
}

/**
 * Lê um arquivo JSON selecionado pelo usuário (input type="file").
 * @param {File} arquivo
 * @returns {Promise<object>} objeto JSON parseado
 */
async function lerArquivoBackup(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dados = JSON.parse(event.target.result);
        resolve(dados);
      } catch (err) {
        reject(new Error('Falha ao fazer parse do JSON: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsText(arquivo);
  });
}

export {
  exportarProgresso,
  downloadBackup,
  validarEstrutura,
  importarProgresso,
  lerArquivoBackup,
  FORMATO_VERSION
};
