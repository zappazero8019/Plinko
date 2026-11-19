/**
 * panels.js — Painéis de Configurações e Estatísticas do Memory Quest.
 *
 * Painéis somente de apresentação/edição das preferências já existentes.
 * Não criam estado paralelo: leem e escrevem através de settings.js e
 * game-stats.js, preservando registros antigos e a store de selfies.
 *
 * Os gráficos usam exclusivamente registros persistidos (ver stats-insights.js)
 * e mostram estados vazios quando o histórico ainda não existe.
 */

import {
  obterPreferenciasCartas,
  salvarPreferenciasCartas,
  salvarVolumesCartas,
  VISUALIZACAO_CARTAS,
  normalizarVisualizacaoCartas,
  normalizarTamanhoAmpliacao,
  normalizarModalidadeCartas,
  normalizarDificuldadeCartas,
  normalizarProgressaoAutomaticaCartas,
  PROGRESSAO_AUTOMATICA_PADRAO,
  TAMANHO_AMPLIACAO_MIN,
  TAMANHO_AMPLIACAO_MAX,
  TAMANHO_AMPLIACAO_PASSO,
  TAMANHO_AMPLIACAO_PADRAO
} from '../core/settings.js';
import {
  DIFICULDADES_CARTAS_EXPANDIDO,
  PROGRESSAO_CARTAS,
  obterTempoPrevia
} from '../games/cards/difficulty.js';
import { obterEstatisticas } from '../core/game-stats.js';
import {
  obterInsightsPartidas,
  obterMoedasConquistadasMQ
} from '../core/stats-insights.js';
import { estadoVazio, graficoBarras, graficoEvolucao } from './charts.js';

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

function secao(titulo, classe) {
  const sec = el('section', `mq-panel__secao mq-panel__secao--${classe}`);
  sec.appendChild(el('h3', 'mq-panel__titulo', titulo));
  return sec;
}

function porcentagem(valor) {
  return Number.isFinite(valor) ? `${Math.round(valor * 100)}%` : '—';
}

function segundos(valor) {
  return Number.isFinite(valor) ? `${Math.round(valor)}s` : '—';
}

/**
 * Renderiza o painel de configurações na área #settings.
 * As mudanças são persistidas imediatamente nas preferências existentes.
 */
export async function renderizarConfiguracoes(root) {
  if (!root) return;
  root.replaceChildren();
  const preferencias = await obterPreferenciasCartas();

  // Jogo — dificuldade inicial, progressão e modalidade existente.
  const jogo = secao('Jogo', 'jogo');
  const dificuldadeInicial = normalizarDificuldadeCartas(preferencias.dificuldadeCartas);
  jogo.appendChild(el('p', 'mq-panel__dica',
    'A dificuldade inicial vale para a próxima entrada no Jogo da Memória. A prévia das cartas é obrigatória.'));

  const linhaDificuldade = el('div', 'mq-panel__linha');
  for (const chave of PROGRESSAO_CARTAS) {
    const rotulo = DIFICULDADES_CARTAS_EXPANDIDO[chave].label;
    const tempo = obterTempoPrevia(chave);
    const b = botao(`${rotulo} · prévia ${tempo / 1000}s`,
      'btn btn--arcade mq-panel__opcao', async () => {
        await salvarPreferenciasCartas({ dificuldadeCartas: chave });
        await renderizarConfiguracoes(root);
      });
    b.dataset.dificuldadeInicial = chave;
    b.dataset.tempoPrevia = String(tempo);
    b.setAttribute('aria-pressed', dificuldadeInicial === chave ? 'true' : 'false');
    linhaDificuldade.appendChild(b);
  }
  jogo.appendChild(linhaDificuldade);

  const progressaoAtiva = normalizarProgressaoAutomaticaCartas(
    preferencias.progressaoAutomaticaCartas ?? PROGRESSAO_AUTOMATICA_PADRAO
  );
  const botaoProgressao = botao(
    `Progressão automática: ${progressaoAtiva ? 'ligada' : 'desligada'}`,
    'btn btn--arcade mq-panel__opcao',
    async () => {
      await salvarPreferenciasCartas({ progressaoAutomaticaCartas: !progressaoAtiva });
      await renderizarConfiguracoes(root);
    }
  );
  botaoProgressao.dataset.progressaoAutomatica = String(progressaoAtiva);
  botaoProgressao.setAttribute('aria-pressed', progressaoAtiva ? 'true' : 'false');
  jogo.appendChild(botaoProgressao);
  jogo.appendChild(el('p', 'mq-panel__dica',
    'A progressão automática só altera a dificuldade da próxima partida após uma vitória legítima, sem CHEAT.'));

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
  jogo.appendChild(linhaModalidade);
  root.appendChild(jogo);

  // Áudio — liga/desliga e volumes já existentes.
  const audio = secao('Áudio', 'audio');
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

  audio.appendChild(el('p', 'mq-panel__dica',
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
    audio.appendChild(linha);
  }
  root.appendChild(audio);

  // Visual — três modos existentes + tamanho configurável da ampliação.
  const visual = secao('Visual', 'visual');
  visual.appendChild(el('p', 'mq-panel__dica',
    'A ampliação funciona no modo Expandido e respeita a preferência salva.'));
  const linhaVisualizacao = el('div', 'mq-panel__linha');
  const opcoes = [
    [VISUALIZACAO_CARTAS.ORIGINAL, 'Original', 'Sem área extra'],
    [VISUALIZACAO_CARTAS.FIXA, 'Área fixa', 'Última carta revelada em destaque'],
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
  visual.appendChild(linhaVisualizacao);

  const tamanhoAtual = normalizarTamanhoAmpliacao(preferencias.tamanhoAmpliacaoCartas);
  const linhaTamanho = el('label', 'mq-panel__volume');
  const rotuloTamanho = el('span', 'mq-panel__volume-rotulo', `Tamanho: ${tamanhoAtual}%`);
  const rangeTamanho = document.createElement('input');
  rangeTamanho.type = 'range';
  rangeTamanho.min = String(TAMANHO_AMPLIACAO_MIN);
  rangeTamanho.max = String(TAMANHO_AMPLIACAO_MAX);
  rangeTamanho.step = String(TAMANHO_AMPLIACAO_PASSO);
  rangeTamanho.value = String(tamanhoAtual);
  rangeTamanho.dataset.ampliacaoTamanho = 'true';
  rangeTamanho.setAttribute('aria-label', 'Tamanho da carta ampliada');
  rangeTamanho.addEventListener('input', () => {
    const novo = normalizarTamanhoAmpliacao(rangeTamanho.value);
    rotuloTamanho.textContent = `Tamanho: ${novo}%`;
    salvarPreferenciasCartas({ tamanhoAmpliacaoCartas: novo }).catch((err) => {
      console.warn('[painéis] Falha ao salvar tamanho da ampliação:', err);
    });
  });
  linhaTamanho.appendChild(rotuloTamanho);
  linhaTamanho.appendChild(rangeTamanho);
  visual.appendChild(linhaTamanho);
  visual.appendChild(el('p', 'mq-panel__dica',
    `De ${TAMANHO_AMPLIACAO_MIN}% a ${TAMANHO_AMPLIACAO_MAX}%, em passos de ` +
    `${TAMANHO_AMPLIACAO_PASSO}%. Padrão: ${TAMANHO_AMPLIACAO_PADRAO}%. ` +
    'Aplica-se de imediato nos três modos, sem reiniciar a partida, mover outras cartas ou alterar o grid.'));
  root.appendChild(visual);

  // Avançado — recolhido por padrão; CONTROLES reais ficam no menu do jogo.
  const avancado = el('details', 'mq-panel__secao mq-panel__secao--avancado mq-panel__avancado');
  avancado.appendChild(el('summary', 'mq-panel__titulo', 'Avançado'));
  avancado.appendChild(el('p', 'mq-panel__dica',
    'CHEAT e áudio da partida ficam em “Opções avançadas”, no menu do Jogo da Memória. ' +
    'Se qualquer CHEAT for usado, a partida inteira perde a elegibilidade para moedas, ' +
    'mesmo que ele seja desativado antes do fim.'));
  root.appendChild(avancado);

  // Dados — apenas indicação dos fluxos existentes; nenhum dado é gerado aqui.
  const dados = secao('Dados', 'dados');
  dados.appendChild(el('p', 'mq-panel__dica',
    'Perfil, selfies, backups e estatísticas continuam em suas telas. Nenhuma informação é criada nesta seção.'));
  root.appendChild(dados);
}

/**
 * Renderiza estatísticas reais já persistidas, sem duplicar contagens.
 * Período: todo o histórico registrado neste dispositivo; partidas abandonadas
 * ou reiniciadas não entram em `matches` e, portanto, não aparecem aqui.
 */
export async function renderizarEstatisticas(root) {
  if (!root) return;
  root.replaceChildren();
  const [{ partidas, insights }, stats, moedas] = await Promise.all([
    obterInsightsPartidas('cards'),
    obterEstatisticas('cards'),
    obterMoedasConquistadasMQ()
  ]);

  const periodo = bloco('Critério e período');
  periodo.appendChild(el('p', 'mq-panel__dica',
    'Acumulado desde o primeiro registro neste dispositivo. Só entram partidas ' +
    'concluídas com vitória ou derrota; abandono e reinício não são registrados. ' +
    '“Sem dados” significa ausência de registros, não valor zero.'));
  root.appendChild(periodo);

  const resumo = bloco('Resumo');
  const linha = el('div', 'mq-panel__linha mq-panel__linha--stats');
  for (const [rotulo, valor] of [
    ['Partidas', insights.partidas],
    ['Concluídas', insights.concluidas],
    ['Vitórias', insights.vitorias],
    ['Derrotas', insights.derrotas],
    ['Taxa de vitória', porcentagem(insights.taxaVitorias)],
    ['Tempo médio', segundos(insights.tempoMedioSegundos)],
    ['Pares', insights.pares],
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
    detalhe.appendChild(el('p', 'mq-panel__estatistica', `${rotulo}: ${valor}`));
  }
  detalhe.appendChild(el('p', 'mq-panel__estatistica',
    `Tentativas: ${insights.tentativas} · Erros: ${insights.erros}`));
  root.appendChild(detalhe);

  const evolucao = bloco('Evolução');
  evolucao.appendChild(graficoEvolucao({
    titulo: 'Desfecho das partidas concluídas',
    criterio: 'Da mais antiga para a mais recente. Cada posição é uma partida real; ' +
      'a barra preenchida indica vitória.',
    partidas: insights.evolucao,
    vazio: partidas.length
      ? 'Ainda não há partidas concluídas.'
      : 'Nenhuma partida registrada neste dispositivo.',
    limite: insights.limiteEvolucao
  }));
  root.appendChild(evolucao);

  const dificuldade = bloco('Desempenho por dificuldade');
  const comConclusao = insights.porDificuldade.filter((item) => item.concluidas > 0);
  dificuldade.appendChild(graficoBarras({
    titulo: 'Taxa de vitória',
    criterio: 'Vitórias ÷ partidas concluídas, por dificuldade registrada.',
    itens: comConclusao.map((item) => ({
      rotulo: item.rotulo,
      valor: item.taxaVitorias * 100
    })),
    formatarValor: (valor) => `${Math.round(valor)}%`,
    vazio: comConclusao.length
      ? 'Sem partidas concluídas para calcular a taxa.'
      : 'Nenhuma partida concluída registrada.'
  }));
  dificuldade.appendChild(graficoBarras({
    titulo: 'Pares encontrados',
    criterio: 'Total de pares efetivamente encontrados nas partidas registradas.',
    itens: insights.porDificuldade.map((item) => ({
      rotulo: item.rotulo,
      valor: item.pares
    })),
    vazio: 'Nenhuma partida registrada.'
  }));
  root.appendChild(dificuldade);

  const economia = bloco('Moedas do Memory Quest');
  if (!Number.isFinite(moedas.total) || moedas.transacoes === 0) {
    economia.appendChild(estadoVazio('Nenhuma moeda creditada no Memory Quest ainda.'));
  } else {
    economia.appendChild(el('p', 'mq-panel__estatistica',
      `Total já creditado: ${moedas.total} moeda(s) em ${moedas.transacoes} transação(ões).`));
    economia.appendChild(graficoBarras({
      titulo: 'Origem das moedas creditadas',
      criterio: 'Soma das transações de pares e bônus gravadas em mqTransactions. ' +
        'Não é o saldo disponível nem uma estimativa.',
      itens: [
        { rotulo: 'Pares', valor: moedas.porTipo.pares },
        { rotulo: 'Bônus de tentativas', valor: moedas.porTipo.bonus }
      ],
      vazio: 'Nenhuma transação de recompensa registrada.'
    }));
  }
  root.appendChild(economia);
}
