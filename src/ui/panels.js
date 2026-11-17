/**
 * panels.js — Painéis de Configurações e Estatísticas do Memory Quest.
 *
 * Painéis somente de apresentação/edição das preferências já existentes.
 * Não criam estado paralelo: leem e escrevem através de settings.js e
 * game-stats.js, preservando registros antigos e a store de selfies.
 */

import {
  obterPreferenciasCartas,
  salvarPreferenciasCartas,
  salvarVolumesCartas,
  VISUALIZACAO_CARTAS,
  normalizarVisualizacaoCartas,
  normalizarModalidadeCartas
} from '../core/settings.js';
import { obterEstatisticas } from '../core/game-stats.js';

function el(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto != null) no.textContent = texto;
  return no;
}

function botao(rotulo, classe, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = classe;
  b.textContent = rotulo;
  b.addEventListener('click', aoClicar);
  return b;
}

function bloco(titulo) {
  const sec = el('section', 'mq-panel__bloco');
  sec.appendChild(el('h3', 'mq-panel__titulo', titulo));
  return sec;
}

/**
 * Renderiza o painel de configurações na área #settings.
 * As mudanças são persistidas imediatamente nas preferências existentes.
 */
export async function renderizarConfiguracoes(root) {
  if (!root) return;
  root.replaceChildren();
  const preferencias = await obterPreferenciasCartas();

  const visualizacao = bloco('Visualização das cartas');
  visualizacao.appendChild(el('p', 'mq-panel__dica',
    'A ampliação funciona no modo Expandido e respeita a preferência salva.'));
  const linhaVisualizacao = el('div', 'mq-panel__linha');
  const opcoes = [
    [VISUALIZACAO_CARTAS.ORIGINAL, 'Original', 'Sem área extra'],
    [VISUALIZACAO_CARTAS.FIXA, 'Área fixa', 'Última carta revelada acima do tabuleiro'],
    [VISUALIZACAO_CARTAS.TEMPORARIA, 'Temporária', 'Sobreposição por 1750 ms']
  ];
  for (const [valor, rotulo, dica] of opcoes) {
    const b = botao(`${rotulo} — ${dica}`, 'btn btn--arcade mq-panel__opcao', async () => {
      await salvarPreferenciasCartas({ visualizacaoCartas: valor });
      await renderizarConfiguracoes(root);
    });
    b.dataset.visualizacao = valor;
    b.setAttribute('aria-pressed',
      normalizarVisualizacaoCartas(preferencias.visualizacaoCartas) === valor ? 'true' : 'false');
    linhaVisualizacao.appendChild(b);
  }
  visualizacao.appendChild(linhaVisualizacao);
  root.appendChild(visualizacao);

  const modalidade = bloco('Modalidade');
  const linhaModalidade = el('div', 'mq-panel__linha');
  for (const [valor, rotulo] of [['pontuacao', 'Modo Pontuação'], ['tentativas', 'Modo Tentativas']]) {
    const b = botao(rotulo, 'btn btn--arcade mq-panel__opcao', async () => {
      await salvarPreferenciasCartas({ modalidadeCartas: valor });
      await renderizarConfiguracoes(root);
    });
    b.dataset.modalidade = valor;
    b.setAttribute('aria-pressed',
      normalizarModalidadeCartas(preferencias.modalidadeCartas) === valor ? 'true' : 'false');
    linhaModalidade.appendChild(b);
  }
  modalidade.appendChild(linhaModalidade);
  root.appendChild(modalidade);

  const audio = bloco('Áudio do Memory Quest');
  audio.appendChild(el('p', 'mq-panel__dica',
    'Efeitos e música são independentes; use os controles do jogo para ouvir o resultado.'));
  const linhaAudio = el('div', 'mq-panel__linha');
  for (const [chave, rotulo, campo] of [
    ['fx', '♪ Efeitos', 'fxCartasAtivo'],
    ['bgm', '♫ Música', 'bgmCartasAtiva']
  ]) {
    const ativo = preferencias[campo] !== false;
    const b = botao(`${rotulo}: ${ativo ? 'on' : 'off'}`, 'btn btn--arcade mq-panel__opcao', async () => {
      await salvarPreferenciasCartas({ [campo]: !ativo });
      await renderizarConfiguracoes(root);
    });
    b.dataset.audio = chave;
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    linhaAudio.appendChild(b);
  }
  audio.appendChild(linhaAudio);
  root.appendChild(audio);

  const volumes = bloco('Volume do áudio');
  volumes.appendChild(el('p', 'mq-panel__dica',
    'Padrões: efeitos em 80% e música em 65%. Cada slider altera apenas o seu canal.'));
  for (const [chave, rotulo, campo] of [
    ['fx', 'Efeitos', 'volumeFxCartas'],
    ['bgm', 'Música', 'volumeBgmCartas']
  ]) {
    const valor = preferencias[campo];
    const linha = el('label', 'mq-panel__volume');
    const rotuloEl = el('span', 'mq-panel__volume-rotulo', `${rotulo}: ${valor}%`);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '5';
    range.value = String(valor);
    range.dataset.volume = chave;
    range.setAttribute('aria-label', `Volume ${rotulo}`);
    range.addEventListener('input', () => {
      const novoValor = Number(range.value);
      rotuloEl.textContent = `${rotulo}: ${novoValor}%`;
      salvarVolumesCartas({ [chave]: novoValor }).catch((err) => {
        console.warn('[painéis] Falha ao salvar volume:', err);
      });
    });
    linha.appendChild(rotuloEl);
    linha.appendChild(range);
    volumes.appendChild(linha);
  }
  root.appendChild(volumes);
}

/**
 * Renderiza estatísticas reais já persistidas, sem duplicar contagens.
 */
export async function renderizarEstatisticas(root) {
  if (!root) return;
  root.replaceChildren();
  const stats = await obterEstatisticas('cards');

  const resumo = bloco('Resumo');
  const linha = el('div', 'mq-panel__linha mq-panel__linha--stats');
  for (const [rotulo, valor] of [
    ['Partidas', stats.partidas],
    ['Concluídas', stats.concluidas],
    ['Vitórias', stats.vitorias],
    ['Derrotas', stats.derrotas],
    ['Melhor tempo', stats.melhorTempoSegundos ? `${stats.melhorTempoSegundos}s` : '—']
  ]) {
    const cartao = el('div', 'stat-card');
    cartao.appendChild(el('span', 'stat__label', rotulo));
    cartao.appendChild(el('span', 'stat__value', String(valor)));
    linha.appendChild(cartao);
  }
  resumo.appendChild(linha);
  root.appendChild(resumo);

  const detalhe = bloco('Jogo da Memória');
  const linhas = [
    ['Jogo da Memória', stats.porModo?.expandido || 0],
    ['Pontuação', stats.porModalidade?.pontuacao || 0],
    ['Tentativas', stats.porModalidade?.tentativas || 0],
    ['Sem modalidade registada', stats.porModalidade?.semModalidade || 0]
  ];
  for (const [rotulo, valor] of linhas) {
    const item = el('p', 'mq-panel__estatistica', `${rotulo}: ${valor}`);
    detalhe.appendChild(item);
  }
  root.appendChild(detalhe);
}
