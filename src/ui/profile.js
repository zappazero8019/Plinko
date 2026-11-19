/**
 * profile.js — Painel de Perfil local do Memory Quest.
 *
 * Reaproveita a store `profile` e os serviços centrais (game-stats e wallet).
 * Não cria estado paralelo: cada renderização volta a ler do IndexedDB, então
 * exportar/importar backup reflete imediatamente no perfil exibido.
 */

import {
  obterPerfil,
  salvarPerfil,
  excluirPerfil,
  processarAvatar,
  NOME_MAXIMO
} from '../core/profile.js';
import { obterEstatisticas, contarPartidas } from '../core/game-stats.js';
import { obterEstadoMQ } from '../core/mq-economy.js';

function el(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto != null) no.textContent = texto;
  return no;
}

function botao(rotulo, classe, aoClicar) {
  const b = el('button', classe, rotulo);
  b.type = 'button';
  b.addEventListener('click', aoClicar);
  return b;
}

/** Mantém os elementos legados do Perfil sincronizados com a store. */
export function atualizarCabecalhoPerfil(perfil) {
  const nomeEl = document.getElementById('profile-nome');
  const idEl = document.getElementById('profile-id');
  const avatarEl = document.querySelector('.profile__avatar-placeholder');
  if (nomeEl) nomeEl.textContent = perfil.excluido ? 'Sem perfil' : perfil.nome;
  if (idEl) idEl.textContent = perfil.id == null ? 'ID: local' : `ID: ${perfil.id}`;
  if (avatarEl) {
    avatarEl.replaceChildren();
    if (perfil.avatar) {
      const img = el('img', 'profile__avatar-img', '');
      img.src = perfil.avatar;
      img.alt = `Avatar de ${perfil.nome}`;
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = '👤';
    }
  }
}

function criarCampoFoto(aoSelecionar) {
  const acoes = el('div', 'profile__foto-acoes');
  for (const [rotulo, origem] of [
    ['📷 Tirar foto', 'camera'],
    ['🖼️ Escolher da galeria', 'galeria']
  ]) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'profile__foto-input';
    input.setAttribute('aria-label', rotulo);
    if (origem === 'camera') {
      // Preferência pela câmera frontal; o navegador decide qual câmera abre.
      // A galeria continua disponível como alternativa, como nas selfies.
      input.setAttribute('capture', 'user');
    }
    input.addEventListener('change', () => {
      const arquivo = input.files?.[0];
      if (arquivo) aoSelecionar(arquivo);
    });
    acoes.appendChild(botao(rotulo, 'btn btn--arcade', () => input.click()));
    acoes.appendChild(input);
  }
  return acoes;
}

/** Renderiza o painel completo de perfil, estatísticas e foto local. */
export async function renderizarPerfil(root) {
  if (!root) return null;
  const perfil = await obterPerfil();
  atualizarCabecalhoPerfil(perfil);

  const [estatisticas, partidas, carteira] = await Promise.all([
    obterEstatisticas('cards'),
    contarPartidas('cards'),
    obterEstadoMQ()
  ]);

  root.replaceChildren();

  const identidade = el('section', 'mq-panel__bloco');
  identidade.appendChild(el('h3', 'mq-panel__titulo', 'Identidade local'));
  identidade.appendChild(el('p', 'mq-panel__dica',
    'Seu nome e sua foto ficam somente neste dispositivo e entram no backup local.'));

  const linhaNome = el('div', 'profile__linha');
  const campoNome = document.createElement('input');
  campoNome.type = 'text';
  campoNome.value = perfil.nome;
  campoNome.maxLength = NOME_MAXIMO;
  campoNome.setAttribute('aria-label', 'Nome do jogador');
  linhaNome.appendChild(campoNome);
  linhaNome.appendChild(botao('Salvar nome', 'btn btn--arcade', async () => {
    try {
      await salvarPerfil({ nome: campoNome.value });
      await renderizarPerfil(root);
    } catch (err) {
      console.warn('[perfil] Falha ao salvar nome:', err);
      mensagem.textContent = 'Não foi possível salvar o nome.';
    }
  }));
  identidade.appendChild(linhaNome);

  identidade.appendChild(criarCampoFoto(async (arquivo) => {
    try {
      const avatar = await processarAvatar(arquivo);
      await salvarPerfil({ avatar });
      await renderizarPerfil(root);
    } catch (err) {
      console.warn('[perfil] Falha ao processar avatar:', err);
      mensagem.textContent = err.message || 'Não foi possível usar esta imagem.';
    }
  }));

  const mensagem = el('p', 'profile__mensagem', perfil.excluido
    ? 'Perfil excluído neste dispositivo. Digite um nome para criar outro.'
    : '');
  mensagem.setAttribute('role', 'status');
  identidade.appendChild(mensagem);

  const exclusao = el('div', 'profile__exclusao');
  exclusao.appendChild(el('h4', 'mq-panel__titulo', 'Excluir perfil'));
  exclusao.appendChild(el('p', 'mq-panel__dica',
    'Remove somente nome, avatar selecionado e foto de perfil. ' +
    'Preserva estatísticas, histórico de partidas, conquistas, progressão, selfies de Minhas Cartas, ' +
    'configurações, carteira e transações do Memory Quest, dados do Plinko e backups existentes. ' +
    'Uma limpeza completa dos dados, se um dia existir, será uma ação separada com confirmação própria.'));
  exclusao.appendChild(botao('Excluir perfil', 'btn btn--arcade profile__excluir', async () => {
    const confirmar = typeof globalThis.confirm === 'function'
      ? globalThis.confirm(
        'Excluir perfil?\n\nSerá apagado somente:\n' +
        '• nome do jogador\n• avatar selecionado\n• foto de perfil\n\n' +
        'Será preservado:\n' +
        '• estatísticas e histórico de partidas\n' +
        '• conquistas e progressão\n' +
        '• selfies cadastradas em Minhas Cartas\n' +
        '• configurações\n' +
        '• carteira e transações do Memory Quest\n' +
        '• dados do Plinko e backups existentes\n\n' +
        'Esta ação NÃO apaga todos os dados do dispositivo.'
      )
      : false;
    if (!confirmar) {
      mensagem.textContent = 'Exclusão cancelada.';
      return;
    }
    try {
      await excluirPerfil();
      await renderizarPerfil(root);
    } catch (err) {
      console.warn('[perfil] Falha ao excluir perfil:', err);
      mensagem.textContent = 'Não foi possível excluir o perfil.';
    }
  }));
  identidade.appendChild(exclusao);
  root.appendChild(identidade);

  const resumo = el('section', 'mq-panel__bloco');
  resumo.appendChild(el('h3', 'mq-panel__titulo', 'Resumo real do progresso'));
  const grade = el('div', 'mq-panel__linha mq-panel__linha--stats');
  for (const [rotulo, valor] of [
    ['Partidas', partidas],
    ['Concluídas', estatisticas.concluidas],
    ['Vitórias', estatisticas.vitorias],
    ['Moedas', carteira.saldo]
  ]) {
    const item = el('div', 'profile__dado');
    item.appendChild(el('span', 'profile__dado-rotulo', rotulo));
    item.appendChild(el('strong', 'profile__dado-valor', String(Math.max(0, Math.floor(valor || 0)))));
    grade.appendChild(item);
  }
  resumo.appendChild(grade);
  root.appendChild(resumo);
  return perfil;
}
