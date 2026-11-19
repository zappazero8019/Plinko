/**
 * profile.js — Serviço local do perfil do Memory Quest.
 *
 * Camada fina sobre a store `profile` já existente no banco v1/v2. Nenhuma
 * store é criada, nenhuma migração é disparada e o formato de backup continua
 * exatamente o mesmo: o perfil já faz parte do export de todas as stores.
 *
 * A foto do perfil fica apenas neste dispositivo, como data URL JPEG pequena,
 * no campo `avatar` que já existe no registro padrão. Nada é enviado para fora.
 */

import { getAll, put } from './database.js';
import { lerArquivoComoDataUrl } from './selfies.js';

export const NOME_PADRAO = 'Jogador';
export const TEMA_PADRAO = 'retro';
export const NOME_MAXIMO = 60;

/** Dimensão do avatar: quadrada e leve o bastante para um backup pequeno. */
export const TAMANHO_AVATAR = Object.freeze({ largura: 192, altura: 192 });
export const AVATAR_MAXIMO_BYTES = 2 * 1024 * 1024;

/** Normaliza o nome sem apagar o registro original quando o campo vem inválido. */
export function normalizarNomePerfil(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  return texto ? texto.slice(0, NOME_MAXIMO) : NOME_PADRAO;
}

/** Aceita apenas data URLs de imagem geradas localmente e dentro do limite. */
export function normalizarAvatarPerfil(valor) {
  if (typeof valor !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(valor)) {
    return null;
  }
  const base64 = valor.split(',')[1] || '';
  const tamanho = Math.floor((base64.length * 3) / 4);
  return tamanho > 0 && tamanho <= AVATAR_MAXIMO_BYTES ? valor : null;
}

/** Localiza o registro principal, com fallback para perfis antigos sem id. */
async function obterRegistro() {
  const registros = await getAll('profile');
  return registros.find((item) => item && Number(item.id) === 1)
    || registros.find((item) => item && ('nome' in item || 'avatar' in item))
    || registros[0]
    || null;
}

/** Lê o perfil sem criar registro novo: instalações antigas veem os padrões. */
export async function obterPerfil() {
  try {
    const registro = await obterRegistro();
    // `perfilExcluido` sinaliza a ausência intencional de identidade: o campo
    // `nome` fica vazio de propósito até que um novo nome seja salvo.
    const excluido = Boolean(registro?.perfilExcluido);
    return {
      id: registro?.id ?? null,
      nome: excluido ? '' : normalizarNomePerfil(registro?.nome),
      idExterno: registro?.idExterno ?? null,
      criadoEm: Number(registro?.criadoEm) || null,
      atualizadoEm: Number(registro?.atualizadoEm) || null,
      avatar: excluido ? null : normalizarAvatarPerfil(registro?.avatar),
      tema: typeof registro?.tema === 'string' ? registro.tema : TEMA_PADRAO,
      excluido
    };
  } catch (err) {
    console.warn('[profile] Falha ao ler perfil:', err);
    return {
      id: null,
      nome: NOME_PADRAO,
      idExterno: null,
      criadoEm: null,
      atualizadoEm: null,
      avatar: null,
      tema: TEMA_PADRAO,
      excluido: false
    };
  }
}

/**
 * Salva um subconjunto preservando id, criação, tema e demais campos antigos.
 * Escritas são serializadas para duas mudanças rápidas não se sobrescreverem.
 */
let filaPerfil = Promise.resolve();

export async function salvarPerfil(patch = {}) {
  const escrita = filaPerfil.then(async () => {
    const registro = await obterRegistro();
    const atual = await obterPerfil();
    const proximo = {
      ...(registro || {}),
      ...atual,
      id: registro?.id ?? 1,
      criadoEm: atual.criadoEm || Date.now(),
      atualizadoEm: Date.now()
    };
    if (Object.prototype.hasOwnProperty.call(patch, 'nome')) {
      proximo.nome = normalizarNomePerfil(patch.nome);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'avatar')) {
      proximo.avatar = normalizarAvatarPerfil(patch.avatar);
    }
    // Salvar qualquer nome recria a identidade explicitamente excluída.
    if (Object.prototype.hasOwnProperty.call(patch, 'nome')) {
      delete proximo.perfilExcluido;
    }
    delete proximo.excluido;
    const id = await put('profile', proximo);
    return { ...proximo, id };
  });
  filaPerfil = escrita.catch(() => {});
  return escrita;
}

/**
 * Exclusão pontual do perfil: apaga somente nome, avatar e foto.
 *
 * Tudo o mais permanece no mesmo registro — id, idExterno, criação, tema,
 * conquestas, progresso, selfies, estatísticas, configurações e carteiras vivem
 * em stores separadas e não são tocadas. Não há limpeza completa automática.
 */
export async function excluirPerfil() {
  const escrita = filaPerfil.then(async () => {
    const registro = await obterRegistro();
    const atual = await obterPerfil();
    const proximo = {
      ...(registro || {}),
      ...atual,
      id: registro?.id ?? 1,
      criadoEm: atual.criadoEm || Date.now(),
      nome: '',
      avatar: null,
      perfilExcluido: true,
      atualizadoEm: Date.now()
    };
    delete proximo.excluido;
    const id = await put('profile', proximo);
    return { ...proximo, id };
  });
  filaPerfil = escrita.catch(() => {});
  return escrita;
}

/**
 * Reduz a foto do perfil para um avatar quadrado (recorte central/cover).
 * Usa o mesmo leitor das selfies; nenhum arquivo sai do dispositivo.
 */
export async function processarAvatar(arquivo) {
  const dataUrl = await lerArquivoComoDataUrl(arquivo);
  const ImageCtor = typeof Image !== 'undefined' ? Image : null;
  const canvas = typeof document !== 'undefined' && document.createElement
    ? document.createElement('canvas')
    : null;
  if (!ImageCtor || !canvas || typeof canvas.getContext !== 'function') {
    throw new Error('Não foi possível processar a imagem neste navegador');
  }

  const imagem = await new Promise((resolve, reject) => {
    const objeto = new ImageCtor();
    objeto.onload = () => resolve(objeto);
    objeto.onerror = () => reject(new Error('Não foi possível abrir a imagem'));
    objeto.src = dataUrl;
  });

  const { largura, altura } = TAMANHO_AVATAR;
  canvas.width = largura;
  canvas.height = altura;
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('Contexto 2D indisponível');

  const origemLargura = imagem.naturalWidth || imagem.width || largura;
  const origemAltura = imagem.naturalHeight || imagem.height || altura;
  const lado = Math.min(origemLargura, origemAltura);
  contexto.imageSmoothingEnabled = true;
  contexto.drawImage(
    imagem,
    (origemLargura - lado) / 2, (origemAltura - lado) / 2, lado, lado,
    0, 0, largura, altura
  );

  const avatar = normalizarAvatarPerfil(canvas.toDataURL('image/jpeg', 0.82));
  if (!avatar) throw new Error('Avatar gerado é grande demais');
  return avatar;
}
