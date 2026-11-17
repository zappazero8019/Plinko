/**
 * settings.js — Serviço central de preferências do Arcade Collection
 *
 * Camada fina sobre a store `settings` do IndexedDB (já existente no banco).
 * Nenhum jogo manipula a store diretamente: todos leem/escrevem preferências
 * por aqui, seguindo o mesmo padrão de game-stats.js.
 *
 * Todas as preferências acrescentadas nesta etapa são CAMPOS do registro já
 * existente. Como o IndexedDB não exige esquema fixo, instalações antigas
 * recebem os valores padrão na leitura, sem migração e sem apagar dados.
 *
 * Este serviço NÃO altera saldo, transações, estatísticas nem a versão do banco.
 */

import { getAll, put } from './database.js';

/** Modos de visualização ampliada aceitos pelo Card Match Expandido. */
export const VISUALIZACAO_CARTAS = Object.freeze({
  ORIGINAL: 'original',
  FIXA: 'fixa',
  TEMPORARIA: 'temporaria'
});

/** Padrão para instalações novas e existentes. */
export const VISUALIZACAO_PADRAO = VISUALIZACAO_CARTAS.ORIGINAL;

/** Modalidades do Card Match Expandido. */
export const MODALIDADES_CARTAS = Object.freeze({
  PONTUACAO: 'pontuacao',
  TENTATIVAS: 'tentativas'
});

export const MODALIDADE_PADRAO = MODALIDADES_CARTAS.PONTUACAO;

/** Limites seguros para a quantidade personalizada de tentativas. */
export const QUANTIDADE_CHEAT_PADRAO = 20;
export const QUANTIDADE_CHEAT_MIN = 1;
export const QUANTIDADE_CHEAT_MAX = 999;

/** Volumes padrão aplicados somente quando a preferência ainda não existe. */
export const VOLUME_FX_PADRAO = 80;
export const VOLUME_BGM_PADRAO = 65;
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;

const MODOS_VALIDOS = new Set(Object.values(VISUALIZACAO_CARTAS));
const MODALIDADES_VALIDAS = new Set(Object.values(MODALIDADES_CARTAS));

/** Valores iniciais mantidos quando o registro ainda não existe. */
const PADRAO_SETTINGS = Object.freeze({
  som: true,
  vibracao: true,
  dificuldadePlinko: 'normal',
  dificuldadeCartas: 'normal',
  cronometroCartas: false,
  visualizacaoCartas: VISUALIZACAO_PADRAO,
  modalidadeCartas: MODALIDADE_PADRAO,
  cheatInfinitasCartas: false,
  cheatPersonalizadaCartas: false,
  cheatQuantidadeCartas: QUANTIDADE_CHEAT_PADRAO,
  fxCartasAtivo: true,
  bgmCartasAtiva: true,
  volumeFxCartas: VOLUME_FX_PADRAO,
  volumeBgmCartas: VOLUME_BGM_PADRAO,
  selfiesAtivas: Object.freeze([])
});

/** Valida qualquer valor recebido (inclusive de backup/importação antiga). */
export function normalizarVisualizacaoCartas(valor) {
  return MODOS_VALIDOS.has(valor) ? valor : VISUALIZACAO_PADRAO;
}

export function normalizarModalidadeCartas(valor) {
  return MODALIDADES_VALIDAS.has(valor) ? valor : MODALIDADE_PADRAO;
}

export function normalizarBooleano(valor, padrao) {
  return typeof valor === 'boolean' ? valor : padrao;
}

export function normalizarQuantidadeCheat(valor) {
  // null/undefined/'' precisam cair no padrão: Number(null) é 0 e viraria 1.
  if (typeof valor !== 'number' && typeof valor !== 'string') return QUANTIDADE_CHEAT_PADRAO;
  if (typeof valor === 'string' && valor.trim() === '') return QUANTIDADE_CHEAT_PADRAO;
  const numero = Number(valor);
  if (!Number.isInteger(numero)) return QUANTIDADE_CHEAT_PADRAO;
  return Math.min(QUANTIDADE_CHEAT_MAX, Math.max(QUANTIDADE_CHEAT_MIN, numero));
}

/**
 * Normaliza volume em porcentagem. Valores ausentes recebem o padrão informado
 * (80 para FX, 65 para BGM); valores antigos/importados são preservados.
 */
export function normalizarVolumeCartas(valor, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(numero)));
}

export function normalizarSelfiesAtivas(valor) {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set();
  const ids = [];
  for (const item of valor) {
    const id = Number(item);
    if (Number.isInteger(id) && id > 0 && !vistos.has(id)) {
      vistos.add(id);
      ids.push(id);
    }
  }
  return ids;
}

const NORMALIZADORES = Object.freeze({
  visualizacaoCartas: (valor) => normalizarVisualizacaoCartas(valor),
  modalidadeCartas: (valor) => normalizarModalidadeCartas(valor),
  cheatInfinitasCartas: (valor) => normalizarBooleano(valor, false),
  cheatPersonalizadaCartas: (valor) => normalizarBooleano(valor, false),
  cheatQuantidadeCartas: (valor) => normalizarQuantidadeCheat(valor),
  fxCartasAtivo: (valor) => normalizarBooleano(valor, true),
  bgmCartasAtiva: (valor) => normalizarBooleano(valor, true),
  volumeFxCartas: (valor) => normalizarVolumeCartas(valor, VOLUME_FX_PADRAO),
  volumeBgmCartas: (valor) => normalizarVolumeCartas(valor, VOLUME_BGM_PADRAO),
  selfiesAtivas: (valor) => normalizarSelfiesAtivas(valor)
});

/** Localiza o registro principal de configurações, com fallback para backups antigos. */
async function obterRegistro() {
  const registros = await getAll('settings');
  return registros.find((item) => item && Number(item.id) === 1)
    || registros.find((item) => item && ('dificuldadeCartas' in item || 'som' in item))
    || registros[0]
    || null;
}

/** Normaliza o registro bruto, preenchendo campos ausentes com os padrões. */
function aplicarPadroes(registro) {
  const base = { ...PADRAO_SETTINGS, ...(registro || {}) };
  for (const [chave, normalizar] of Object.entries(NORMALIZADORES)) {
    base[chave] = normalizar(base[chave]);
  }
  return base;
}

/**
 * Lê TODAS as preferências do Card Match de uma vez. Nunca lança: falha de
 * storage cai nos padrões, mantendo o jogo jogável.
 */
export async function obterPreferenciasCartas() {
  try {
    return aplicarPadroes(await obterRegistro());
  } catch (err) {
    console.warn('[settings] Falha ao ler preferências das cartas:', err);
    return aplicarPadroes(null);
  }
}

/**
 * Fila de escrita: duas mudanças rápidas (por exemplo, arrastar os dois sliders
 * de volume) não podem ler o mesmo registro antigo e sobrescrever a primeira.
 * Cada gravação enxerga o resultado da anterior.
 */
let filaEscrita = Promise.resolve();

/**
 * Salva um subconjunto de preferências preservando todos os outros campos.
 * Valores inválidos são normalizados antes da gravação.
 */
export async function salvarPreferenciasCartas(patch = {}) {
  const escrita = filaEscrita.then(async () => {
    const registro = await obterRegistro();
    const atual = aplicarPadroes(registro);
    const proximo = { ...atual, id: registro?.id ?? 1 };
    for (const [chave, normalizar] of Object.entries(NORMALIZADORES)) {
      if (Object.prototype.hasOwnProperty.call(patch, chave)) {
        proximo[chave] = normalizar(patch[chave]);
      }
    }
    await put('settings', proximo);
    return proximo;
  });
  // Uma falha não pode travar as gravações seguintes.
  filaEscrita = escrita.catch(() => {});
  return escrita;
}

/**
 * Lê a preferência de visualização. Nunca lança: falha de storage cai no padrão.
 */
export async function obterVisualizacaoCartas() {
  try {
    const registro = await obterRegistro();
    return normalizarVisualizacaoCartas(registro?.visualizacaoCartas);
  } catch (err) {
    console.warn('[settings] Falha ao ler visualização das cartas:', err);
    return VISUALIZACAO_PADRAO;
  }
}

/** Salva a preferência de visualização preservando todos os outros campos. */
export async function salvarVisualizacaoCartas(modo) {
  const preferencias = await salvarPreferenciasCartas({ visualizacaoCartas: modo });
  return preferencias.visualizacaoCartas;
}

/** Atalhos semânticos usados pelo integrador do Card Match. */
export async function obterModalidadeCartas() {
  return (await obterPreferenciasCartas()).modalidadeCartas;
}

export async function salvarModalidadeCartas(modalidade) {
  const preferencias = await salvarPreferenciasCartas({ modalidadeCartas: modalidade });
  return preferencias.modalidadeCartas;
}

export async function obterAudioCartas() {
  const preferencias = await obterPreferenciasCartas();
  return { fx: preferencias.fxCartasAtivo, bgm: preferencias.bgmCartasAtiva };
}

export async function salvarAudioCartas({ fx, bgm } = {}) {
  const patch = {};
  if (typeof fx === 'boolean') patch.fxCartasAtivo = fx;
  if (typeof bgm === 'boolean') patch.bgmCartasAtiva = bgm;
  const preferencias = await salvarPreferenciasCartas(patch);
  return { fx: preferencias.fxCartasAtivo, bgm: preferencias.bgmCartasAtiva };
}

/** Lê os dois volumes independentes já normalizados. */
export async function obterVolumesCartas() {
  const preferencias = await obterPreferenciasCartas();
  return { fx: preferencias.volumeFxCartas, bgm: preferencias.volumeBgmCartas };
}

/**
 * Salva um ou dois volumes sem apagar os demais campos. Zero é um valor válido.
 */
export async function salvarVolumesCartas({ fx, bgm } = {}) {
  const patch = {};
  if (fx !== undefined && fx !== null && fx !== '') patch.volumeFxCartas = fx;
  if (bgm !== undefined && bgm !== null && bgm !== '') patch.volumeBgmCartas = bgm;
  const preferencias = await salvarPreferenciasCartas(patch);
  return { fx: preferencias.volumeFxCartas, bgm: preferencias.volumeBgmCartas };
}

export async function obterSelfiesAtivas() {
  return (await obterPreferenciasCartas()).selfiesAtivas;
}

export async function salvarSelfiesAtivas(ids) {
  const preferencias = await salvarPreferenciasCartas({ selfiesAtivas: ids });
  return preferencias.selfiesAtivas;
}

export { PADRAO_SETTINGS };
