/**
 * charts.js — gráficos leves do painel de estatísticas do Memory Quest.
 *
 * SVG/CSS puros, sem bibliotecas externas. Todos os valores vêm de
 * `stats-insights.js`; este arquivo apenas desenha o que já foi persistido.
 * Quando não há registros, mostra um estado vazio em vez de barras zeradas.
 */

function el(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto != null) no.textContent = texto;
  return no;
}

function textoPadrao(valor) {
  return String(valor);
}

export function estadoVazio(mensagem) {
  return el('p', 'mq-chart__vazio', mensagem || 'Sem dados registrados ainda.');
}

function cabecalho(titulo, criterio) {
  const secao = el('section', 'mq-chart');
  secao.appendChild(el('h4', 'mq-chart__titulo', titulo));
  if (criterio) {
    secao.appendChild(el('p', 'mq-chart__criterio', criterio));
  }
  return secao;
}

/** Gráfico de barras horizontais; cada item é { rotulo, valor }. */
export function graficoBarras({
  titulo,
  criterio,
  itens = [],
  vazio = 'Sem dados registrados ainda.',
  formatarValor = textoPadrao,
  classe = ''
} = {}) {
  const secao = cabecalho(titulo, criterio);
  if (classe) secao.classList.add(classe);
  const validos = itens.filter((item) => (
    item && Number.isFinite(Number(item.valor)) && Number(item.valor) >= 0
  ));
  if (!validos.length) {
    secao.appendChild(estadoVazio(vazio));
    return secao;
  }

  const maximo = Math.max(1, ...validos.map((item) => Number(item.valor)));
  const corpo = el('div', 'mq-chart__barras');
  for (const item of validos) {
    const valor = Number(item.valor);
    const linha = el('div', 'mq-chart__linha');
    const rotulo = el('span', 'mq-chart__rotulo', item.rotulo);
    const trilha = el('div', 'mq-chart__trilha');
    const barra = el('span', `mq-chart__barra${item.classe ? ` ${item.classe}` : ''}`);
    const porcentagem = Math.round((valor / maximo) * 100);
    barra.style.setProperty('--mq-barra', `${porcentagem}%`);
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', `${item.rotulo}: ${formatarValor(valor)}`);
    trilha.appendChild(barra);
    linha.appendChild(rotulo);
    linha.appendChild(trilha);
    linha.appendChild(el('span', 'mq-chart__valor', formatarValor(valor)));
    corpo.appendChild(linha);
  }
  secao.appendChild(corpo);
  return secao;
}

/**
 * Evolução por partida concluída, da mais antiga para a mais recente.
 * A altura é constante: a cor/distinção representa vitória ou derrota, evitando
 * sugerir magnitude onde o registro só guarda um desfecho binário.
 */
export function graficoEvolucao({
  titulo = 'Evolução das partidas',
  criterio = '',
  partidas = [],
  vazio = 'Nenhuma partida concluída ainda.',
  limite = 12
} = {}) {
  const secao = cabecalho(titulo, criterio);
  const concluidas = partidas.filter((partida) => partida && partida.numero > 0);
  if (!concluidas.length) {
    secao.appendChild(estadoVazio(vazio));
    return secao;
  }

  const corpo = el('div', 'mq-chart__evolucao');
  for (const partida of concluidas) {
    const item = el('div', `mq-chart__passo ${partida.vitoria ? 'is-vitoria' : 'is-derrota'}`);
    const trilha = el('div', 'mq-chart__passo-trilha');
    const preenchimento = el('span', 'mq-chart__passo-barra');
    preenchimento.style.setProperty(
      '--mq-preenchimento', partida.vitoria ? '100%' : '0%'
    );
    preenchimento.setAttribute('role', 'img');
    preenchimento.setAttribute('aria-label',
      `Partida ${partida.numero}: ${partida.vitoria ? 'vitória' : 'derrota'}; ` +
      `${partida.paresEncontrados} par(es); ${partida.tempoSegundos}s; ` +
      `${partida.rotuloDificuldade || 'sem dificuldade'}`
    );
    trilha.appendChild(preenchimento);
    item.appendChild(trilha);
    item.appendChild(el('span', 'mq-chart__passo-numero', String(partida.numero)));
    corpo.appendChild(item);
  }
  secao.appendChild(corpo);
  secao.appendChild(el('p', 'mq-chart__legenda', '■ vitória · □ derrota'));
  if (limite && concluidas.length >= limite) {
    secao.appendChild(el('p', 'mq-chart__nota',
      `Mostrando as últimas ${concluidas.length} partidas concluídas.`));
  }
  return secao;
}
