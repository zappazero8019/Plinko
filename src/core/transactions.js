/**
 * transactions.js — Serviço de histórico e integridade de transações
 *
 * Fornece consultas agregadas sobre o histórico financeiro, validação de
 * duplicatas e relatórios de totais. Camada leitura sobre as store
 * `transactions` e `wallet`.
 */

import { getAll, get, count, getByIndex } from './database.js';

/**
 * Resumo financeiro da carteira.
 * @returns {Promise<{saldo, totalConquistado, totalGasto, totalTransacoes}>}
 */
async function resumoFinanceiro() {
  const wallet = await get('wallet', 1);
  const totalTransacoes = await count('transactions');
  return {
    saldo: wallet ? wallet.saldo : 0,
    totalConquistado: wallet ? wallet.totalConquistado : 0,
    totalGasto: wallet ? wallet.totalGasto : 0,
    totalTransacoes
  };
}

/**
 * Lista todas as transações, mais recentes primeiro.
 * @param {number} limite
 * @returns {Promise<Array>}
 */
async function listarTodas(limite = 100) {
  const todas = await getAll('transactions');
  todas.sort((a, b) => b.criadoEm - a.criadoEm);
  return todas.slice(0, limite);
}

/**
 * Transações de um jogo específico.
 * @param {string|null} jogo
 * @returns {Promise<Array>}
 */
async function porJogo(jogo) {
  const todas = await getAll('transactions');
  return todas.filter((t) => t.jogo === jogo).sort((a, b) => b.criadoEm - a.criadoEm);
}

/**
 * Detecta possíveis chaves de idempotência duplicadas (verificação de integridade).
 * @returns {Promise<Array<{chave, ocorrencias}>>}
 */
async function detectarDuplicatas() {
  const todas = await getAll('transactions');
  const mapa = {};
  for (const t of todas) {
    const chave = t.idempotencyKey;
    if (!mapa[chave]) mapa[chave] = [];
    mapa[chave].push(t.id);
  }
  return Object.entries(mapa)
    .filter(([, ids]) => ids.length > 1)
    .map(([chave, ids]) => ({ chave, ocorrencias: ids.length }));
}

/**
 * Valida a consistência entre saldo da carteira e soma das transações.
 * Útil para verificação de integridade após falhas.
 * @returns {Promise<{consistente, saldoCarteira, saldoCalculado, diferenca}>}
 */
async function validarConsistencia() {
  const wallet = await get('wallet', 1);
  const todas = await getAll('transactions');
  let calculado = 0;
  for (const t of todas) {
    if (t.tipo === 'credito') calculado += t.quantidade;
    else if (t.tipo === 'debito') calculado -= t.quantidade;
  }
  const saldoCarteira = wallet ? wallet.saldo : 0;
  const diferenca = saldoCarteira - calculado;
  return {
    consistente: diferenca === 0,
    saldoCarteira,
    saldoCalculado: calculado,
    diferenca
  };
}

export {
  resumoFinanceiro,
  listarTodas,
  porJogo,
  detectarDuplicatas,
  validarConsistencia
};
