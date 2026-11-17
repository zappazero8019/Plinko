/**
 * selfies.js — Serviço de Cartas Selfie do Card Match
 *
 * Camada de serviço sobre a store `selfies` do IndexedDB (v2). Nenhum jogo
 * acessa a store diretamente. As fotos ficam APENAS no dispositivo: sem
 * upload, sem serviços externos e sem reconhecimento facial.
 *
 * O processamento reduz cada imagem para 320×426 px (proporção 3:4 da carta)
 * e a comprime em JPEG, evitando consumo excessivo de armazenamento. Não há
 * limite artificial de quantidade de cartas.
 */

import { getAll, get, put, del } from './database.js';

/** Dimensão de saída: mesma proporção 3:4 das cartas do tabuleiro. */
export const TAMANHO_CARTA = Object.freeze({ largura: 320, altura: 426 });

export const MIME_SAIDA = 'image/jpeg';
export const QUALIDADE_SAIDA = 0.82;
export const TAMANHO_MAXIMO_ARQUIVO = 20 * 1024 * 1024;

const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;

/** Enquadramento padrão: recorte central, sem zoom e sem deslocamento. */
export const ENQUADRAMENTO_PADRAO = Object.freeze({ zoom: 1, y: 0 });

export function normalizarEnquadramento(valor = {}) {
  const zoom = Number(valor?.zoom);
  const y = Number(valor?.y);
  return {
    zoom: Number.isFinite(zoom) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : 1,
    y: Number.isFinite(y) ? Math.min(0.5, Math.max(-0.5, y)) : 0
  };
}

/** Lê um arquivo de imagem como data URL (File/Blob). */
export function lerArquivoComoDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo || typeof arquivo.type !== 'string' || !arquivo.type.startsWith('image/')) {
      reject(new Error('Escolha um arquivo de imagem válido'));
      return;
    }
    if (Number(arquivo.size) > TAMANHO_MAXIMO_ARQUIVO) {
      reject(new Error('Imagem muito grande (máximo 20 MB)'));
      return;
    }
    const leitor = typeof FileReader !== 'undefined' ? new FileReader() : null;
    if (!leitor || typeof leitor.readAsDataURL !== 'function') {
      reject(new Error('FileReader não disponível neste navegador'));
      return;
    }
    leitor.onload = (evento) => resolve(String(evento.target?.result || ''));
    leitor.onerror = () => reject(new Error('Falha ao ler a imagem'));
    leitor.readAsDataURL(arquivo);
  });
}

function carregarImagem(dataUrl) {
  return new Promise((resolve, reject) => {
    const ImageCtor = typeof Image !== 'undefined' ? Image : null;
    if (!ImageCtor) {
      reject(new Error('Não foi possível processar a imagem neste ambiente'));
      return;
    }
    const imagem = new ImageCtor();
    imagem.onload = () => resolve(imagem);
    imagem.onerror = () => reject(new Error('Não foi possível abrir a imagem'));
    imagem.src = dataUrl;
  });
}

/**
 * Recorta, redimensiona e comprime a imagem para o formato da carta.
 * @returns {Promise<{imagem: string, largura: number, altura: number, tamanhoBytes: number}>}
 */
export async function processarImagem(dataUrl, enquadramento = ENQUADRAMENTO_PADRAO) {
  const { zoom, y } = normalizarEnquadramento(enquadramento);
  const imagem = await carregarImagem(dataUrl);
  const canvas = typeof document !== 'undefined' && document.createElement
    ? document.createElement('canvas')
    : null;
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('Canvas não disponível neste navegador');
  }

  const { largura: larguraSaida, altura: alturaSaida } = TAMANHO_CARTA;
  canvas.width = larguraSaida;
  canvas.height = alturaSaida;
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('Contexto 2D indisponível');

  const larguraOrigem = imagem.naturalWidth || imagem.width || larguraSaida;
  const alturaOrigem = imagem.naturalHeight || imagem.height || alturaSaida;
  const proporcao = larguraSaida / alturaSaida;

  // Maior recorte com a proporção da carta que cabe na origem (cover).
  let recorteLargura = larguraOrigem;
  let recorteAltura = larguraOrigem / proporcao;
  if (recorteAltura > alturaOrigem) {
    recorteAltura = alturaOrigem;
    recorteLargura = alturaOrigem * proporcao;
  }

  // Zoom > 1 aproxima reduzindo o recorte; y desloca dentro da área livre.
  recorteLargura /= zoom;
  recorteAltura /= zoom;
  const folgaX = Math.max(0, larguraOrigem - recorteLargura);
  const folgaY = Math.max(0, alturaOrigem - recorteAltura);
  const origemX = folgaX / 2;
  const origemY = folgaY / 2 + y * folgaY;

  contexto.imageSmoothingEnabled = true;
  contexto.drawImage(
    imagem,
    origemX, origemY, recorteLargura, recorteAltura,
    0, 0, larguraSaida, alturaSaida
  );

  const resultado = canvas.toDataURL(MIME_SAIDA, QUALIDADE_SAIDA);
  const base64 = String(resultado).split(',')[1] || '';
  const tamanhoBytes = Math.floor((base64.length * 3) / 4);
  return { imagem: String(resultado), largura: larguraSaida, altura: alturaSaida, tamanhoBytes };
}

/** Cria e salva uma nova carta a partir de um arquivo de imagem. */
export async function criarSelfie({ arquivo, nome, enquadramento, ativa = true } = {}) {
  const dataUrl = await lerArquivoComoDataUrl(arquivo);
  const processada = await processarImagem(dataUrl, enquadramento);
  const agora = Date.now();
  const registro = {
    nome: String(nome || 'Minha selfie').slice(0, 60),
    ...processada,
    criadoEm: agora,
    atualizadoEm: agora,
    ativa: ativa !== false
  };
  const id = await put('selfies', registro);
  return { ...registro, id };
}

/** Lista todas as cartas salvas (mais recentes primeiro). */
export async function listarSelfies() {
  const registros = await getAll('selfies');
  return registros.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
}

export async function obterSelfie(id) {
  return get('selfies', Number(id));
}

/** Ativa ou desativa sem apagar: a carta permanece guardada na coleção. */
export async function definirSelfieAtiva(id, ativa) {
  const atual = await obterSelfie(id);
  if (!atual) return null;
  const atualizado = { ...atual, ativa: ativa !== false, atualizadoEm: Date.now() };
  await put('selfies', atualizado);
  return atualizado;
}

/** Substitui o conteúdo mantendo id, estado ativo e data de criação. */
export async function substituirSelfie(id, dados = {}) {
  const atual = await obterSelfie(id);
  if (!atual) return null;
  let processada;
  if (dados.imagem && !dados.arquivo) {
    processada = {
      imagem: String(dados.imagem),
      largura: Number(dados.largura) || TAMANHO_CARTA.largura,
      altura: Number(dados.altura) || TAMANHO_CARTA.altura,
      tamanhoBytes: Number(dados.tamanhoBytes) || 0
    };
  } else {
    processada = await processarImagem(
      await lerArquivoComoDataUrl(dados.arquivo),
      dados.enquadramento
    );
  }
  const atualizado = {
    ...atual,
    ...processada,
    nome: String(dados.nome || atual.nome).slice(0, 60),
    atualizadoEm: Date.now()
  };
  await put('selfies', atualizado);
  return atualizado;
}

/** Exclusão definitiva, sempre precedida de confirmação na camada de UI. */
export async function excluirSelfie(id) {
  await del('selfies', Number(id));
  return true;
}
