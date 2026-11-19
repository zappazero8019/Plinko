/**
 * games/cards/renderer.js — Renderização DOM/CSS do Card Match
 *
 * Cartesianas são elementos <button> com animação de virada em CSS 3D. DOM
 * foi escolhido em vez de Canvas para preservar acessibilidade, teclado,
 * touch e a arquitetura existente. Nenhuma regra de jogo fica aqui: o
 * renderer apenas reflete o estado recebido de board.js e repassa eventos.
 *
 * A ampliação no Jogo da Memória é apenas visual: a área/sobreposição consome
 * o mesmo snapshot já usado pelas cartas e nunca consulta símbolos de cartas
 * ocultas. Nenhuma regra, timer de jogo ou pontuação passa por aqui.
 */

/** Cria elementos sem interpolação de HTML (evita injeção). */
function el(tag, classe = '', texto = '') {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== '') node.textContent = texto;
  return node;
}

/** Ícone original da habilidade — reutilizado, sem cópia ou substituição. */
const ICONE_VISAO_TOTAL = 'assets/icons/visao.png';

/** Geometria do painel SMB3, confirmada na referência. */
const PAINEL_SMB3 = Object.freeze({
  largura: 514,
  altura: 338,
  cartaLargura: 44,
  cartaAltura: 76,
  passoX: 64,
  passoY: 96,
  origemX: 58,
  origemY: 60,
  seletorLargura: 56,
  seletorAltura: 88,
  seletorMargem: 6
});

function pct(valor, total) {
  return `${(valor / total) * 100}%`;
}

/** Números da economia do Memory Quest: nunca negativos, NaN ou decimais. */
function formatarQuantidadeMQ(valor) {
  const numero = Number(valor);
  return String(Number.isFinite(numero) ? Math.max(0, Math.floor(numero)) : 0);
}

/** Áudio procedural (sem arquivos externos, sem assets copiados). */
function criarAudio() {
  let ctx = null;
  let saida = null;
  let efeitosAtivos = true;
  let bgmAtiva = false;
  let bgmTimer = null;
  let bgmPasso = 0;
  // Padrões alinhados a settings.js: aplicados apenas se nada for informado.
  let volumeFx = 80;
  let volumeBgm = 65;
  // Amplitude da nota de BGM antes do volume do usuário. O valor antigo (0,014)
  // era inaudível em dispositivos móveis; 0,05 mantém folga para o FX e, com o
  // limitador abaixo, não aproxima o sinal de 1.0 (clipping).
  const AMPLITUDE_BGM = 0.05;
  const LIMITE_VOZ = 0.08;

  function garantirContexto() {
    if (ctx) return ctx;
    const Ctor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      // Master com headroom e limitador suaves na soma de todas as vozes.
      // Node opcional: navegadores sem DynamicsCompressor mantêm o caminho antigo.
      const master = ctx.createGain?.();
      if (master) {
        master.gain.value = 0.9;
        const limitador = typeof ctx.createDynamicsCompressor === 'function'
          ? ctx.createDynamicsCompressor()
          : null;
        if (limitador) {
          limitador.threshold.value = -6;
          limitador.knee.value = 0;
          limitador.ratio.value = 20;
          limitador.attack.value = 0.003;
          limitador.release.value = 0.25;
          master.connect(limitador);
          limitador.connect(ctx.destination);
        } else {
          master.connect(ctx.destination);
        }
        saida = master;
      }
    } catch (err) {
      return null;
    }
    return ctx;
  }

  function limitarVolume(valor, padrao) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return padrao;
    return Math.min(100, Math.max(0, Math.round(numero)));
  }

  function tocar(frequencia, duracao, tipo = 'square', volume = 0.05, origem = 'fx') {
    // FX e BGM são independentes: a música não depende do Effects ligado.
    if (origem === 'fx' && !efeitosAtivos) return;
    if (origem === 'bgm' && !bgmAtiva) return;
    const fator = (origem === 'bgm' ? volumeBgm : volumeFx) / 100;
    // Volume zero silencia apenas o canal; evita rampa exponencial a partir de 0.
    const volumeAjustado = Math.min(LIMITE_VOZ, volume * fator);
    if (volumeAjustado <= 0) return;
    const contexto = garantirContexto();
    if (!contexto) return;
    try {
      if (contexto.state === 'suspended') contexto.resume();
      const osc = contexto.createOscillator();
      const gain = contexto.createGain();
      osc.type = tipo;
      osc.frequency.value = frequencia;
      gain.gain.setValueAtTime(volumeAjustado, contexto.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + duracao);
      osc.connect(gain);
      gain.connect(saida || contexto.destination);
      osc.start();
      osc.stop(contexto.currentTime + duracao);
    } catch (err) {
      // Áudio é decorativo: falha nunca interrompe o jogo.
    }
  }

  function sequencia(notas, duracao, tipo, volume, espaco) {
    notas.forEach((frequencia, indice) => {
      if (indice === 0) tocar(frequencia, duracao, tipo, volume);
      else setTimeout(() => tocar(frequencia, duracao, tipo, volume), indice * espaco);
    });
  }

  function tocarBgm() {
    if (!bgmAtiva) return;
    const notas = [523, 659, 784, 659, 587, 698, 880, 698];
    tocar(notas[bgmPasso++ % notas.length], 0.16, 'triangle', AMPLITUDE_BGM, 'bgm');
  }

  function alternarEfeitos(valor) {
    efeitosAtivos = valor === undefined ? !efeitosAtivos : Boolean(valor);
    return efeitosAtivos;
  }

  function alternarBgm(valor) {
    bgmAtiva = valor === undefined ? !bgmAtiva : Boolean(valor);
    // O intervalo só muda quando a preferência de BGM realmente muda; ligar
    // ou desligar FX nunca interrompe a música.
    if (bgmAtiva && !bgmTimer && typeof setInterval === 'function') {
      bgmTimer = setInterval(tocarBgm, 360);
    } else if (!bgmAtiva && bgmTimer !== null) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
    return bgmAtiva;
  }

  return {
    som(nome) {
      const sons = {
        start: () => sequencia([392, 523, 659], 0.12, 'square', 0.04, 70),
        mover: () => tocar(280, 0.05, 'square', 0.025),
        selecionar: () => tocar(520, 0.09, 'square', 0.05),
        pick: () => tocar(520, 0.09, 'square', 0.05),
        match: () => sequencia([660, 880], 0.14, 'square', 0.05, 90),
        erro: () => tocar(160, 0.18, 'sawtooth', 0.04),
        nomatch: () => tocar(160, 0.18, 'sawtooth', 0.04),
        coin: () => sequencia([988, 1318], 0.12, 'square', 0.045, 75),
        oneup: () => sequencia([659, 784, 1046], 0.16, 'square', 0.045, 90),
        par: () => sequencia([660, 880], 0.14, 'square', 0.05, 90),
        vitoria: () => sequencia([523, 659, 784, 1046], 0.18, 'square', 0.05, 110)
      };
      if (sons[nome]) sons[nome]();
    },
    alternarEfeitos,
    get efeitosAtivos() { return efeitosAtivos; },
    alternarBgm,
    get bgmAtiva() { return bgmAtiva; },
    /**
     * Aplica ambas as preferências sem reiniciar a música desnecessariamente:
     * o intervalo só é recriado quando o valor de BGM realmente mudou.
     * Volumes são opcionais e não alteram fx/bgm nem o timer da música.
     */
    definirAudio({ fx, bgm, volumeFx: novoFx, volumeBgm: novoBgm } = {}) {
      if (typeof fx === 'boolean') efeitosAtivos = fx;
      if (typeof bgm === 'boolean' && bgm !== bgmAtiva) alternarBgm(bgm);
      if (novoFx !== undefined && novoFx !== null && novoFx !== '') {
        volumeFx = limitarVolume(novoFx, 80);
      }
      if (novoBgm !== undefined && novoBgm !== null && novoBgm !== '') {
        volumeBgm = limitarVolume(novoBgm, 65);
      }
      return { fx: efeitosAtivos, bgm: bgmAtiva };
    },
    get volumeFx() { return volumeFx; },
    get volumeBgm() { return volumeBgm; },
    parar() {
      if (bgmTimer !== null) clearInterval(bgmTimer);
      bgmTimer = null;
    }
  };
}

function formatarTempo(segundos) {
  const total = Math.max(0, Math.floor(segundos) || 0);
  const min = String(Math.floor(total / 60)).padStart(2, '0');
  const seg = String(total % 60).padStart(2, '0');
  return `${min}:${seg}`;
}

/** Duração da ampliação temporária (dentro da faixa de 1,5 a 2 s pedida). */
const DURACAO_AMPLIACAO_MS = 1750;

/** Normalização local, espelhando o serviço de preferências (sem acoplar o renderer ao IndexedDB). */
const MODOS_AMPLIACAO = new Set(['original', 'fixa', 'temporaria']);

function normalizarAmpliacao(valor) {
  return MODOS_AMPLIACAO.has(valor) ? valor : 'original';
}

/** Espelha settings.js sem acoplar o renderer ao IndexedDB. */
function normalizarTamanhoAmpliacao(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return 120;
  const passos = Math.round(numero / 5);
  return Math.min(30, Math.max(20, passos)) * 5;
}

/** Normalização local da quantidade de CHEAT (sem acoplar o renderer ao banco). */
function quantidadeCheat(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 1 && numero <= 999 ? numero : 20;
}

/** Converte um arquivo de imagem em data URL para o preview do enquadramento. */
function arquivoParaDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo) {
      reject(new Error('Nenhuma imagem selecionada'));
      return;
    }
    const leitor = typeof FileReader !== 'undefined' ? new FileReader() : null;
    if (!leitor) {
      reject(new Error('FileReader não disponível'));
      return;
    }
    leitor.onload = (evento) => resolve(String(evento.target?.result || ''));
    leitor.onerror = () => reject(new Error('Falha ao ler a imagem'));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * @param {HTMLElement} root - elemento #cards-board
 * @param {object} callbacks - onIniciar, onVoltar, onTrocarDificuldade,
 *   onAlternarProgressao, onTrocarVisualizacaoCartas,
 *   onAlterarTamanhoAmpliacao, onSelecionar, onReiniciar, onMenu
 * @param {object} opcoes - agendador e duração da ampliação (injetáveis em testes)
 */
export function criarRenderer(root, callbacks = {}, opcoes = {}) {
  const controller = new AbortController();
  // Controller separado para os listeners da partida: cada nova rodada substitui
  // o anterior, evitando acúmulo de handlers de teclado na window.
  let controllerPartida = null;
  const audio = criarAudio();
  const agendar = typeof opcoes.setTimeout === 'function'
    ? opcoes.setTimeout
    : (fn, ms) => setTimeout(fn, ms);
  const cancelar = typeof opcoes.clearTimeout === 'function'
    ? opcoes.clearTimeout
    : (id) => clearTimeout(id);
  const duracaoAmpliacao = Number.isFinite(opcoes.duracaoAmpliacaoMs)
    ? opcoes.duracaoAmpliacaoMs
    : DURACAO_AMPLIACAO_MS;

  let simbolos = new Map();
  let cartasEls = new Map();
  let ordemIds = [];
  let cursorId = null;
  let seletorEl = null;
  let hud = {};
  let saldoNode = null;
  let saldoMQVisivel = 0;
  let botaoVisaoTotal = null;
  let contadorVisaoTotal = null;
  let estadoVisaoTotal = null;
  let visaoTotalAtivo = false;
  // Estados visuais temporários, separados do snapshot lógico do board.
  let visaoTotalRevelados = new Set();
  let visaoTotalOcultados = new Set();
  let visaoTotalDuracaoMs = 3000;
  let controlesCheatMoedas = [];
  let usosVisaoTotal = 0;
  let ultimoTempoSegundos = 0;
  let boardEl = null;
  let feedbackEl = null;
  let resultEl = null;
  let emApresentacao = false;
  let configAtiva = null;
  let previaOverlayEl = null;
  let previaContagemEl = null;
  let previaBarraEl = null;

  // Estado exclusivo da ampliação visual.
  let ultimoSnapshot = null;
  let ampliacaoEl = null;
  let ampliacaoConteudoEl = null;
  let ampliacaoModo = 'original';
  let ampliacaoIdAtual = null;
  let faceAmpliadaEl = null;
  let dicaTamanhoEl = null;
  // 100–150% em passos de 5%; padrão 120%. A escala é aplicada por CSS
  // transform, sem tocar na geometria do grid nem nas cartas vizinhas.
  let tamanhoAmpliacao = 120;
  let timerAmpliacao = null;
  let overlaySelfie = null;

  function escutar(target, tipo, fn, opcoes = {}) {
    if (!target) return;
    target.addEventListener(tipo, fn, {
      ...opcoes,
      signal: opcoes.signal || controller.signal
    });
  }

  function cancelarTimerAmpliacao() {
    if (timerAmpliacao !== null) {
      cancelar(timerAmpliacao);
      timerAmpliacao = null;
    }
  }

  function definirCheatMoedasBloqueado(bloqueado) {
    for (const controle of controlesCheatMoedas) {
      controle.entrada.disabled = bloqueado;
      controle.botao.disabled = bloqueado;
      controle.bloco.classList.toggle('cards__cheat-moedas--bloqueado', bloqueado);
      if (bloqueado) {
        const detalhes = controle.bloco.closest?.('details');
        if (detalhes) detalhes.open = false;
      }
    }
  }

  function limpar() {
    cancelarTimerAmpliacao();
    if (controllerPartida) {
      controllerPartida.abort();
      controllerPartida = null;
    }
    if (root) root.replaceChildren();
    cartasEls = new Map();
    ordemIds = [];
    cursorId = null;
    seletorEl = null;
    hud = {};
    saldoNode = null;
    saldoMQVisivel = 0;
    botaoVisaoTotal = null;
    contadorVisaoTotal = null;
    estadoVisaoTotal = null;
    visaoTotalAtivo = false;
    visaoTotalRevelados = new Set();
    visaoTotalOcultados = new Set();
    visaoTotalDuracaoMs = 3000;
    controlesCheatMoedas = [];
    usosVisaoTotal = 0;
    ultimoTempoSegundos = 0;
    boardEl = null;
    feedbackEl = null;
    resultEl = null;
    emApresentacao = false;
    configAtiva = null;
    previaOverlayEl = null;
    previaContagemEl = null;
    previaBarraEl = null;
    ultimoSnapshot = null;
    ampliacaoEl = null;
    ampliacaoConteudoEl = null;
    faceAmpliadaEl = null;
    dicaTamanhoEl = null;
    ampliacaoModo = 'original';
    ampliacaoIdAtual = null;
    overlaySelfie = null;
  }

  function badge(modo) {
    const node = el('div', 'cards__badge cards__badge--expandido', 'JOGO DA MEMÓRIA');
    node.dataset.modo = modo || 'expandido';
    return node;
  }

  function botao(texto, classe, fn) {
    const btn = el('button', classe, texto);
    btn.type = 'button';
    escutar(btn, 'click', fn);
    return btn;
  }

  /**
   * Controle reutilizável do CHEAT "Adicionar moedas". O estado lógico da
   * carteira fica em core/mq-economy.js; aqui só existe entrada, confirmação e
   * exibição do saldo. Cada instância recebe o mesmo observer do saldo MQ.
   */
  function criarControleAdicionarMoedas({ compacto = false } = {}) {
    const bloco = el('div', `cards__cheat-moedas${compacto ? ' cards__cheat-moedas--compacto' : ''}`);
    bloco.dataset.cheatMoedasControle = 'true';

    const rotulo = el('label', 'cards__cheat-moedas__rotulo', 'Adicionar moedas');
    const entrada = document.createElement('input');
    entrada.type = 'number';
    entrada.min = '1';
    entrada.max = String(Number.MAX_SAFE_INTEGER);
    entrada.step = '1';
    entrada.inputMode = 'numeric';
    entrada.placeholder = 'Quantidade';
    entrada.dataset.cheatMoedasQuantidade = 'true';
    entrada.setAttribute('aria-label', 'Quantidade de moedas para adicionar');
    rotulo.appendChild(entrada);

    const acao = botao('Adicionar moedas', 'btn btn--arcade cards__cheat-moedas__botao', async () => {
      if (visaoTotalAtivo) {
        bloco.dataset.erro = 'true';
        feedback('Aguarde o fim da Visão total', 'erro');
        return;
      }
      try {
        const resultado = await callbacks.onAdicionarMoedasCheat?.(entrada.value);
        if (resultado?.ok) {
          entrada.value = '';
          bloco.dataset.erro = 'false';
        } else {
          bloco.dataset.erro = 'true';
        }
        const mensagens = {
          quantidade_invalida: 'Informe um número inteiro positivo',
          saldo_excedido: 'Quantidade estoura o limite seguro da carteira',
          sem_servico: 'Não foi possível adicionar moedas'
        };
        feedback(
          resultado?.mensagem || mensagens[resultado?.erro] || 'Não foi possível adicionar moedas',
          resultado?.ok ? 'sucesso' : 'erro'
        );
      } catch (err) {
        bloco.dataset.erro = 'true';
        feedback(`Não foi possível adicionar moedas: ${err?.message || 'erro desconhecido'}`, 'erro');
      }
    });
    acao.dataset.cheatMoedasConfirmar = 'true';

    const saldo = el('span', 'cards__cheat-moedas__saldo',
      `Saldo atual: ${formatarQuantidadeMQ(saldoMQVisivel)}`);
    saldo.dataset.cheatMoedasSaldo = 'true';

    bloco.appendChild(rotulo);
    bloco.appendChild(acao);
    bloco.appendChild(saldo);
    controlesCheatMoedas.push({ bloco, entrada, botao: acao, saldo });
    return bloco;
  }

  function mostrarMenu({
    modo = 'expandido',
    dificuldade = 'normal',
    progressao = true,
    estatisticas = null,
    dificuldades = [],
    nomesDificuldade = {},
    visualizacaoCartas = 'original',
    tamanhoAmpliacaoCartas = 120,
    modalidade = 'pontuacao',
    cheat = { infinitas: false, personalizada: false, quantidade: 20 },
    audioPreferencias = { fx: true, bgm: true, volumeFx: 80, volumeBgm: 65 },
    selfies = [],
    selfiesAtivas = [],
    saldoMQ = 0,
    estatisticasModalidade = null,
    foco = null
  } = {}) {
    if (!root) return;
    limpar();
    tamanhoAmpliacao = normalizarTamanhoAmpliacao(tamanhoAmpliacaoCartas);

    if (foco === 'selfies') {
      mostrarGaleriaSelfies({ selfies, ativas: selfiesAtivas });
      return;
    }

    const menu = el('section', 'cards__menu');
    menu.dataset.foco = foco || 'config';
    menu.appendChild(el('h3', 'cards__titulo', 'MEMORY QUEST'));
    menu.appendChild(badge(modo));
    menu.appendChild(el('p', 'cards__intro',
      'Jogo da Memória: mais cartas, desafios e progressão.'));

    saldoMQVisivel = formatarQuantidadeMQ(saldoMQ);
    saldoNode = el('div', 'cards__saldo-mq',
      `🪙 SALDO MEMORY QUEST: ${saldoMQVisivel}`);
    saldoNode.dataset.saldoMq = String(formatarQuantidadeMQ(saldoMQ));
    const linhaSaldo = el('div', 'cards__saldo-linha');
    linhaSaldo.appendChild(saldoNode);
    linhaSaldo.appendChild(botao('🛒 Loja de habilidades', 'btn btn--arcade cards__btn-loja', () => {
      callbacks.onAbrirLoja?.();
    }));
    menu.appendChild(linhaSaldo);

    // Configurações do Jogo da Memória.
    {
      const blocoDiff = el('div', 'cards__diff');
      blocoDiff.appendChild(el('h4', 'cards__subtitulo', 'Dificuldade'));
      const linha = el('div', 'cards__diff-linha');
      for (const chave of dificuldades) {
        const btn = botao(nomesDificuldade[chave] || chave,
          `diff-btn ${dificuldade === chave ? 'active' : ''}`,
          () => { audio.som('mover'); callbacks.onTrocarDificuldade?.(chave); });
        btn.dataset.diff = chave;
        linha.appendChild(btn);
      }
      blocoDiff.appendChild(linha);
      menu.appendChild(blocoDiff);

      // Controles avançados ficam recolhidos: continuam no DOM e funcionais,
      // mas fora do caminho principal (dificuldade → iniciar partida).
      const avancado = el('details', 'cards__avancado');
      avancado.appendChild(el('summary', '', '⚙ Opções avançadas'));
      const corpoAvancado = el('div', 'cards__avancado-corpo');
      avancado.appendChild(corpoAvancado);

      const prog = botao(
        `Progressão automática: ${progressao ? 'ligada' : 'desligada'}`,
        'cards__toggle',
        () => { audio.som('mover'); callbacks.onAlternarProgressao?.(); }
      );
      prog.dataset.progressao = String(progressao);
      corpoAvancado.appendChild(prog);

      const blocoVisual = el('div', 'cards__visual');
      blocoVisual.appendChild(el('h4', 'cards__subtitulo', 'Visualização das cartas'));
      const opcoesVisual = el('div', 'cards__visual-opcoes');
      const visualAtiva = normalizarAmpliacao(visualizacaoCartas);
      const descricoesVisuais = {
        original: 'Layout atual, sem área extra',
        fixa: 'Área fixa acima do tabuleiro',
        temporaria: 'Toque na carta para ampliar'
      };
      for (const chave of ['original', 'fixa', 'temporaria']) {
        const btn = botao('', `cards__visual-opt ${visualAtiva === chave ? 'cards__visual-opt--ativo' : ''}`, () => {
          audio.som('mover');
          callbacks.onTrocarVisualizacaoCartas?.(chave);
        });
        btn.appendChild(el('strong', '', {
          original: 'Original',
          fixa: 'Área fixa',
          temporaria: 'Temporária'
        }[chave]));
        btn.appendChild(el('small', '', descricoesVisuais[chave]));
        btn.dataset.visualizacao = chave;
        btn.setAttribute('aria-pressed', String(visualAtiva === chave));
        opcoesVisual.appendChild(btn);
      }
      blocoVisual.appendChild(opcoesVisual);
      dicaTamanhoEl = el('p', 'cards__visual-dica',
        `Tamanho da carta ampliada: ${tamanhoAmpliacao}%. Ajuste aqui ou em Configurações → Visual.`);
      blocoVisual.appendChild(dicaTamanhoEl);
      corpoAvancado.appendChild(blocoVisual);

      const blocoModalidade = el('div', 'cards__bloco cards__modalidade');
      blocoModalidade.appendChild(el('h4', 'cards__subtitulo', 'Modalidade'));
      const linhaModalidade = el('div', 'cards__diff-linha');
      for (const opcao of [
        { id: 'pontuacao', titulo: 'Modo Pontuação', detalhe: 'Regras atuais' },
        { id: 'tentativas', titulo: 'Modo Tentativas', detalhe: 'Erros consomem tentativas' }
      ]) {
        const btn = botao('', `cards__visual-opt ${modalidade === opcao.id ? 'cards__visual-opt--ativo' : ''}`, () => {
          audio.som('mover');
          callbacks.onTrocarModalidade?.(opcao.id);
        });
        btn.appendChild(el('strong', '', opcao.titulo));
        btn.appendChild(el('small', '', opcao.detalhe));
        btn.dataset.modalidade = opcao.id;
        btn.setAttribute('aria-pressed', String(modalidade === opcao.id));
        linhaModalidade.appendChild(btn);
      }
      blocoModalidade.appendChild(linhaModalidade);
      corpoAvancado.appendChild(blocoModalidade);

      if (modalidade === 'tentativas') {
        const blocoCheat = el('div', 'cards__bloco cards__cheat');
        blocoCheat.appendChild(el('h4', 'cards__subtitulo', 'CHEAT — exclusivo do Modo Tentativas'));

        const infinitas = botao(
          `Tentativas infinitas: ${cheat.infinitas ? 'on' : 'off'}`,
          'cards__toggle',
          () => {
            audio.som('mover');
            callbacks.onAlternarCheatInfinitas?.();
          }
        );
        infinitas.dataset.cheat = 'infinitas';
        infinitas.setAttribute('aria-pressed', String(Boolean(cheat.infinitas)));
        blocoCheat.appendChild(infinitas);

        const personalizada = botao(
          `Quantidade personalizada: ${cheat.personalizada ? 'on' : 'off'}`,
          'cards__toggle',
          () => {
            audio.som('mover');
            callbacks.onAlternarCheatPersonalizada?.();
          }
        );
        personalizada.dataset.cheat = 'personalizada';
        personalizada.setAttribute('aria-pressed', String(Boolean(cheat.personalizada)));
        blocoCheat.appendChild(personalizada);

        const campo = document.createElement('input');
        campo.type = 'number';
        campo.min = '1';
        campo.max = '999';
        campo.step = '1';
        campo.value = String(quantidadeCheat(cheat.quantidade));
        campo.dataset.cheatQuantidade = 'true';
        campo.setAttribute('aria-label', 'Quantidade personalizada de tentativas');
        escutar(campo, 'change', () => {
          callbacks.onAlterarQuantidadeCheat?.(campo.value);
        });
        blocoCheat.appendChild(campo);
        blocoCheat.appendChild(el('p', 'cards__dica',
          'Prioridade: infinitas → personalizada → padrão da dificuldade. Vale somente para novas partidas.'));
        corpoAvancado.appendChild(blocoCheat);
      }

      // Cheat econômico da carteira MQ, disponível em qualquer modalidade.
      const blocoCheatMoedas = el('div', 'cards__bloco cards__cheat cards__cheat-moedas-bloco');
      blocoCheatMoedas.appendChild(el('h4', 'cards__subtitulo', 'CHEAT — carteira Memory Quest'));
      blocoCheatMoedas.appendChild(criarControleAdicionarMoedas());
      blocoCheatMoedas.appendChild(el('p', 'cards__dica',
        'O saldo entra na carteira MQ, mas não conta como moeda conquistada. ' +
        'Usado durante uma partida, bloqueia as recompensas dela para sempre.'));
      corpoAvancado.appendChild(blocoCheatMoedas);

      const blocoAudio = el('div', 'cards__bloco cards__audio-config');
      blocoAudio.appendChild(el('h4', 'cards__subtitulo', 'Áudio'));
      const linhaAudio = el('div', 'cards__diff-linha');
      for (const [chave, rotulo, ativo] of [
        ['fx', 'FX', audioPreferencias?.fx !== false],
        ['bgm', 'BGM', audioPreferencias?.bgm !== false]
      ]) {
        // O estado do botão é a fonte da verdade exibida: usá-lo evita
        // dessincronização com o motor de áudio antes de definirAudio().
        let estado = ativo;
        const btn = botao(`${rotulo}: ${estado ? 'on' : 'off'}`, 'cards__audio-btn', () => {
          estado = !estado;
          if (chave === 'fx') audio.alternarEfeitos(estado);
          else audio.alternarBgm(estado);
          btn.textContent = `${rotulo}: ${estado ? 'on' : 'off'}`;
          btn.setAttribute('aria-pressed', String(estado));
          callbacks.onAlternarAudio?.(chave, estado);
        });
        btn.dataset.audio = chave;
        btn.setAttribute('aria-pressed', String(estado));
        linhaAudio.appendChild(btn);
      }
      blocoAudio.appendChild(linhaAudio);

      const linhasVolume = el('div', 'cards__volumes');
      for (const [chave, rotulo, valor] of [
        ['fx', 'FX', audioPreferencias?.volumeFx ?? 80],
        ['bgm', 'BGM', audioPreferencias?.volumeBgm ?? 65]
      ]) {
        const linha = el('label', 'cards__volume');
        const rotuloEl = el('span', 'cards__volume-rotulo', `${rotulo}: ${valor}%`);
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.step = '5';
        range.value = String(valor);
        range.dataset.volume = chave;
        range.setAttribute('aria-label', `Volume ${rotulo}`);
        escutar(range, 'input', () => {
          const novoValor = Number(range.value);
          rotuloEl.textContent = `${rotulo}: ${novoValor}%`;
          callbacks.onAlterarVolume?.(chave, novoValor);
        });
        linha.appendChild(rotuloEl);
        linha.appendChild(range);
        linhasVolume.appendChild(linha);
      }
      blocoAudio.appendChild(linhasVolume);
      corpoAvancado.appendChild(blocoAudio);
      menu.appendChild(avancado);

      const blocoSelfies = el('div', 'cards__bloco cards__selfies-resumo');
      blocoSelfies.appendChild(el('h4', 'cards__subtitulo', 'MINHAS CARTAS'));
      blocoSelfies.appendChild(el('p', 'cards__dica',
        `${selfiesAtivas.length} ativas de ${selfies.length} guardadas · cada selfie substitui um par`));
      const abrirGaleria = botao('Abrir galeria de selfies', 'cards__toggle', () => {
        audio.som('mover');
        callbacks.onAbrirSelfies?.();
      });
      abrirGaleria.dataset.acao = 'minhas-cartas';
      blocoSelfies.appendChild(abrirGaleria);
      menu.appendChild(blocoSelfies);
    }

    if (estatisticas) {
      const stats = el('div', 'cards__stats');
      stats.appendChild(el('span', '', `Partidas: ${estatisticas.partidas || 0}`));
      stats.appendChild(el('span', '', `Concluídas: ${estatisticas.concluidas || 0}`));
      stats.appendChild(el('span', '',
        `Jogo da Memória: ${estatisticas.porModo?.expandido || 0}`));
      if (estatisticasModalidade) {
        stats.appendChild(el('span', '',
          `Pontuação: ${estatisticasModalidade.pontuacao || 0}`));
        stats.appendChild(el('span', '',
          `Tentativas: ${estatisticasModalidade.tentativas || 0}`));
      }
      menu.appendChild(stats);
    }

    const acoes = el('div', 'cards__acoes');
    acoes.appendChild(botao('Iniciar partida', 'btn btn--arcade', () => {
      audio.som('start');
      callbacks.onIniciar?.();
    }));
    acoes.appendChild(botao('← Voltar à coleção', 'btn btn--text', () => callbacks.onVoltar?.()));
    menu.appendChild(acoes);

    root.appendChild(menu);
  }

  // ---------- Galeria de Cartas Selfie (somente UI / callbacks) ----------

  function criarFaceSelfie(selfie) {
    const face = el('div', 'cards__ampliacao-carta cards__carta-selfie');
    face.style.setProperty('--card-color', '#a78bfa');
    face.dataset.ampliacaoId = `selfie-${selfie?.id ?? 'nova'}`;
    face.setAttribute('aria-label', `Carta ampliada: ${selfie?.nome || 'Selfie'}`);
    if (selfie?.imagem) {
      const img = el('img', 'cards__selfie-img');
      img.src = selfie.imagem;
      img.alt = `Foto de ${selfie.nome || 'selfie'}`;
      face.appendChild(img);
    }
    face.appendChild(el('span', 'cards__name', selfie?.nome || 'Minha selfie'));
    return face;
  }

  function ampliarSelfie(selfie) {
    if (overlaySelfie) removerNo(overlaySelfie);
    const overlay = el('div', 'cards__ampliacao cards__ampliacao--temporaria cards__ampliacao--visivel');
    overlay.dataset.ampliacaoSelfie = 'true';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.appendChild(criarFaceSelfie(selfie));
    root?.appendChild(overlay);
    overlaySelfie = overlay;
    cancelarTimerAmpliacao();
    timerAmpliacao = agendar(() => {
      timerAmpliacao = null;
      removerNo(overlay);
      if (overlaySelfie === overlay) overlaySelfie = null;
    }, duracaoAmpliacao);
  }

  function mostrarGaleriaSelfies({ selfies = [], ativas = [] } = {}) {
    if (!root) return;
    const sec = el('section', 'cards__menu cards__selfies');
    sec.dataset.foco = 'selfies';
    sec.appendChild(el('h3', 'cards__titulo', 'MINHAS CARTAS'));
    sec.appendChild(el('p', 'cards__intro',
      'Fotos guardadas apenas neste dispositivo. Cada selfie ativa substitui um par normal. '
      + 'No celular, “Tirar foto” prefere a câmera frontal; se ela não abrir, permita o '
      + 'acesso à câmera ou use “Escolher da galeria”.'));

    const acoes = el('div', 'cards__acoes');
    for (const [rotulo, origem] of [
      ['📷 Tirar foto', 'camera'],
      ['🖼️ Escolher da galeria', 'galeria']
    ]) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.className = 'cards__selfie-input';
      input.setAttribute('aria-label', rotulo);
      if (origem === 'camera') {
        // "user" é uma PREFERÊNCIA pela câmera frontal, não uma garantia: o
        // navegador/sistema é quem decide qual câmera abrir. A alternância real
        // exigiria getUserMedia + preview e mudaria o fluxo que já funciona.
        // "Escolher da galeria" continua disponível como alternativa.
        input.setAttribute('capture', 'user');
      }
      escutar(input, 'change', () => {
        const arquivo = input.files?.[0];
        if (arquivo) callbacks.onNovaSelfie?.({ arquivo, origem });
      });
      acoes.appendChild(botao(rotulo, 'btn btn--arcade', () => input.click()));
      acoes.appendChild(input);
    }
    sec.appendChild(acoes);

    const grade = el('div', 'cards__selfies-grade');
    for (const selfie of selfies) {
      const ativa = ativas.includes(Number(selfie.id));
      const item = el('article', `cards__selfie-item ${ativa ? 'cards__selfie-item--ativa' : ''}`);
      item.dataset.selfieId = String(selfie.id);

      const miniatura = el('div', 'cards__selfie-miniatura');
      if (selfie.imagem) {
        const img = el('img', 'cards__selfie-img');
        img.src = selfie.imagem;
        img.alt = `Miniatura de ${selfie.nome || 'selfie'}`;
        miniatura.appendChild(img);
      }
      item.appendChild(miniatura);
      item.appendChild(el('strong', 'cards__selfie-nome', selfie.nome || 'Minha selfie'));
      item.appendChild(el('span', 'cards__selfie-estado', ativa ? 'Ativa' : 'Desativada'));

      const botoes = el('div', 'cards__selfie-acoes');
      const alternar = botao(ativa ? 'Desativar' : 'Ativar', 'cards__toggle', () => {
        callbacks.onAlternarSelfie?.(Number(selfie.id), !ativa);
      });
      alternar.dataset.selfieAcao = 'alternar';
      botoes.appendChild(alternar);

      const ver = botao('Ampliar', 'cards__toggle', () => ampliarSelfie(selfie));
      ver.dataset.selfieAcao = 'ampliar';
      botoes.appendChild(ver);

      const substituir = botao('Substituir', 'cards__toggle', () => {
        callbacks.onSubstituirSelfie?.(selfie);
      });
      substituir.dataset.selfieAcao = 'substituir';
      botoes.appendChild(substituir);

      const excluir = botao('Excluir', 'cards__toggle cards__toggle--perigo', () => {
        const confirmado = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(`Excluir definitivamente a carta "${selfie.nome || 'Minha selfie'}"?`)
          : true;
        if (confirmado) callbacks.onExcluirSelfie?.(Number(selfie.id));
      });
      excluir.dataset.selfieAcao = 'excluir';
      botoes.appendChild(excluir);
      item.appendChild(botoes);
      grade.appendChild(item);
    }
    sec.appendChild(grade);

    const rodape = el('div', 'cards__acoes');
    rodape.appendChild(botao('← Voltar às configurações', 'btn btn--text', () => {
      callbacks.onVoltarSelfies?.();
    }));
    sec.appendChild(rodape);
    root.appendChild(sec);
  }

  function mostrarEditorSelfie({ arquivo, selfie = null, origem = 'galeria' } = {}) {
    if (!root) return;
    limpar();
    const sec = el('section', 'cards__menu cards__editor-selfie');
    sec.dataset.foco = 'selfie-editor';
    sec.appendChild(el('h3', 'cards__titulo', selfie ? 'SUBSTITUIR CARTA' : 'NOVA CARTA SELFIE'));
    sec.appendChild(el('p', 'cards__intro',
      'Ajuste o enquadramento para o formato 3:4 da carta antes de salvar.'));

    const caixa = el('div', 'cards__editor-caixa');
    const preview = el('img', 'cards__editor-preview');
    preview.alt = 'Prévia da carta selfie';
    preview.style.setProperty('--selfie-zoom', '1');
    preview.style.setProperty('--selfie-y', '0');
    caixa.appendChild(preview);
    sec.appendChild(caixa);

    arquivoParaDataUrl(arquivo).then((dataUrl) => {
      preview.src = dataUrl;
    }).catch((err) => {
      callbacks.onErroSelfie?.(err.message);
    });

    const controles = el('div', 'cards__editor-controles');
    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.min = '1'; zoom.max = '2.5'; zoom.step = '0.05'; zoom.value = '1';
    zoom.dataset.enquadramento = 'zoom';
    zoom.setAttribute('aria-label', 'Zoom do enquadramento');
    const deslocamento = document.createElement('input');
    deslocamento.type = 'range';
    deslocamento.min = '-0.5'; deslocamento.max = '0.5'; deslocamento.step = '0.05';
    deslocamento.value = '0';
    deslocamento.dataset.enquadramento = 'y';
    deslocamento.setAttribute('aria-label', 'Deslocamento vertical do enquadramento');
    const aplicar = () => {
      preview.style.setProperty('--selfie-zoom', zoom.value);
      preview.style.setProperty('--selfie-y', deslocamento.value);
    };
    escutar(zoom, 'input', aplicar);
    escutar(deslocamento, 'input', aplicar);
    controles.appendChild(zoom);
    controles.appendChild(deslocamento);

    const nome = document.createElement('input');
    nome.type = 'text';
    nome.maxLength = 60;
    nome.value = selfie?.nome || '';
    nome.dataset.nomeSelfie = 'true';
    nome.setAttribute('aria-label', 'Nome da carta');
    controles.appendChild(nome);
    sec.appendChild(controles);

    const acoes = el('div', 'cards__acoes');
    acoes.appendChild(botao('Salvar carta', 'btn btn--arcade', () => {
      callbacks.onSalvarSelfie?.({
        arquivo,
        origem,
        nome: nome.value,
        enquadramento: { zoom: Number(zoom.value), y: Number(deslocamento.value) },
        substituirId: selfie?.id ?? null
      });
    }));
    acoes.appendChild(botao('Cancelar', 'btn btn--text', () => callbacks.onVoltarSelfies?.()));
    sec.appendChild(acoes);
    root.appendChild(sec);
  }

  /** Mostra falhas de leitura/quota da selfie sem sair da galeria/editor. */
  function mostrarErroSelfie(mensagem) {
    if (!root) return;
    const secoes = Array.from(root.children || []);
    const sec = secoes.find((no) =>
      no.dataset?.foco === 'selfies' || no.dataset?.foco === 'selfie-editor');
    if (!sec) {
      feedback(mensagem, 'erro');
      return;
    }
    let aviso = Array.from(sec.children || [])
      .find((no) => no.dataset?.selfieErro === 'true');
    if (!aviso) {
      aviso = el('p', 'cards__selfie-erro');
      aviso.dataset.selfieErro = 'true';
      aviso.setAttribute('role', 'alert');
      sec.appendChild(aviso);
    }
    aviso.textContent = mensagem;
  }

  function criarTopo(config, tituloExtra, opcoes = {}) {
    const topo = el('div', 'cards__topo');
    topo.appendChild(badge(config.modo));
    topo.appendChild(el('span', 'cards__modo-titulo',
      tituloExtra || config.titulo || 'Memory Quest'));

    // Áudio permanece configurável no menu (Opções avançadas); a partida mostra
    // apenas saídas secundárias, mantendo o tabuleiro como foco.
    const botoesTopo = el('div', 'cards__topo-botoes');
    if (opcoes.previa) {
      botoesTopo.appendChild(botao('⟳ Reiniciar', 'btn btn--text cards__previa-reiniciar',
        () => callbacks.onReiniciar?.()));
    }
    // Controle da própria partida: altera a escala da face ampliada sem sair da
    // rodada, sem recriar o tabuleiro e sem reiniciar o timer. Presente já na
    // prévia para que o fim dela não desloque o tabuleiro.
    if (config.modo === 'expandido') {
      const controleZoom = el('label', 'cards__zoom-controle');
      const rotuloZoom = el('span', 'cards__zoom-rotulo', `Carta ${tamanhoAmpliacao}%`);
      const rangeZoom = document.createElement('input');
      rangeZoom.type = 'range';
      rangeZoom.min = '100';
      rangeZoom.max = '150';
      rangeZoom.step = '5';
      rangeZoom.value = String(tamanhoAmpliacao);
      rangeZoom.dataset.ampliacaoTamanhoPartida = 'true';
      rangeZoom.setAttribute('aria-label', 'Tamanho da carta ampliada');
      rangeZoom.addEventListener('input', () => {
        const novo = normalizarTamanhoAmpliacao(rangeZoom.value);
        rotuloZoom.textContent = `Carta ${novo}%`;
        callbacks.onAlterarTamanhoAmpliacao?.(novo);
      });
      controleZoom.appendChild(rotuloZoom);
      controleZoom.appendChild(rangeZoom);
      botoesTopo.appendChild(controleZoom);
    }
    // Habilidade paga da Fase 2: fica no topo da partida, fora do tabuleiro,
    // para não alterar geometria nem bloquear navegação/saída segura.
    const visao = el('button', 'cards__visao-total btn btn--arcade');
    visao.type = 'button';
    visao.dataset.visaoTotal = 'true';
    const iconeVisao = document.createElement('img');
    iconeVisao.className = 'cards__visao-total__icone';
    iconeVisao.setAttribute('src', ICONE_VISAO_TOTAL);
    iconeVisao.setAttribute('alt', 'Ícone da habilidade Visão total');
    iconeVisao.setAttribute('width', '28');
    iconeVisao.setAttribute('height', '28');
    iconeVisao.setAttribute('decoding', 'async');
    visao.appendChild(iconeVisao);
    visao.appendChild(el('span', 'cards__visao-total__nome', 'Visão total'));
    contadorVisaoTotal = el('span', 'cards__visao-total__contador', '0');
    contadorVisaoTotal.dataset.usosVisaoTotal = '0';
    visao.appendChild(contadorVisaoTotal);
    estadoVisaoTotal = el('span', 'cards__visao-total__estado', '0 usos');
    estadoVisaoTotal.setAttribute('role', 'status');
    visao.appendChild(estadoVisaoTotal);
    escutar(visao, 'click', () => callbacks.onVisaoTotal?.());
    botaoVisaoTotal = visao;
    botoesTopo.appendChild(visao);

    // Mesmo cheat do menu, acessível durante a partida para marcar a sessão.
    const cheatMoedasTopo = el('details', 'cards__cheat-moedas-topo');
    cheatMoedasTopo.dataset.cheatMoedasTopo = 'true';
    cheatMoedasTopo.appendChild(el('summary', '', 'CHEAT · +MOEDAS'));
    cheatMoedasTopo.appendChild(criarControleAdicionarMoedas({ compacto: true }));
    botoesTopo.appendChild(cheatMoedasTopo);

    botoesTopo.appendChild(botao('⚙ Configurações', 'btn btn--text', () => callbacks.onMenu?.()));
    botoesTopo.appendChild(botao('← Coleção', 'btn btn--text', () => callbacks.onVoltar?.()));
    topo.appendChild(botoesTopo);
    definirUsosVisaoTotal(config.usosVisaoTotal ?? 0);
    return topo;
  }

  function criarHud(config) {
    const hudEl = el('div', 'cards__hud');
    const valorTentativas = config.modalidade === 'tentativas'
      ? (config.tentativasInfinitas ? 'TENTATIVAS: ∞' : `TENTATIVAS: ${config.tentativasIniciais ?? 0}`)
      : 'Tentativas 0';
    // `titulo` pode trazer o identificador interno ("Expandido · Normal");
    // no HUD mostramos apenas o nome da dificuldade.
    const nomeDificuldade = String(config.titulo || '—').split('·').pop().trim();
    const campos = [
      ['dificuldade', `DIFICULDADE: ${nomeDificuldade}`],
      ['modalidade', `MODALIDADE: ${config.modalidade === 'tentativas' ? 'Tentativas' : 'Pontuação'}`],
      ['pares', `Pares 0/${config.totalPares}`],
      ['tentativas', valorTentativas],
      ['erros', 'Erros 0'],
      ['tempo', 'Tempo 00:00'],
      ['saldo', `SALDO MQ: ${formatarQuantidadeMQ(config.saldoMQ)}`],
      ['moedas', 'MOEDAS: 0'],
      ['sequencia', 'SEQ: 0'],
      ['multiplicador', 'MULT: x1']
    ];
    // O contador numérico de pontos permanece exclusivo do Modo Pontuação.
    if (config.modalidade === 'pontuacao' || config.pontuacao != null) {
      campos.push(['pontuacao', `PONTOS: ${formatarQuantidadeMQ(config.pontuacao)}`]);
    }
    for (const [chave, texto] of campos) {
      const classes = ['cards__hud-item'];
      if (chave === 'tentativas' && config.modalidade === 'tentativas') {
        classes.push('cards__hud-item--tentativas');
      } else if ([
        'dificuldade', 'modalidade', 'pontuacao',
        'saldo', 'moedas', 'sequencia', 'multiplicador'
      ].includes(chave)) {
        classes.push(`cards__hud-item--${chave}`);
      }
      const item = el('div', classes.join(' '), texto);
      item.dataset.hud = chave;
      hud[chave] = item;
      hudEl.appendChild(item);
    }
    return hudEl;
  }

  // ---------- Visualização ampliada (somente leitura do snapshot) ----------

  /** Remove um nó sem depender de Element.remove() (útil no DOM mock dos testes). */
  function removerNo(node) {
    const pai = node?.parentNode;
    if (!pai) return;
    // `children` é HTMLCollection no navegador (sem .filter) e array no mock
    // dos testes. Array.from cobre os dois casos.
    const restantes = Array.from(pai.children || []).filter((filho) => filho !== node);
    // No DOM real `parentNode` é somente leitura; `replaceChildren` já desanexa
    // o nó (o mock dos testes faz o mesmo ao limpar `parentNode` dos filhos).
    pai.replaceChildren(...restantes);
  }

  /** Só devolve cartas que o fluxo normal já revelou. */
  function cartaVisivel(snapshot, id) {
    if (!snapshot || id === null || id === undefined) return null;
    return snapshot.cartas.find((carta) =>
      carta.id === id && (carta.revelada || carta.pareada)) || null;
  }

  /**
   * Última carta revelada ainda válida: a mais recente seleção visível ou,
   * depois da comparação, a última carta pareada. Nunca lê `simbolo` de carta
   * virada para baixo.
   */
  function ultimaCartaVisivel(snapshot) {
    if (!snapshot) return null;
    const selecionadas = snapshot.selecionadas || [];
    for (let i = selecionadas.length - 1; i >= 0; i -= 1) {
      const carta = cartaVisivel(snapshot, selecionadas[i]);
      if (carta) return carta;
    }
    const pareadas = snapshot.pareadas || [];
    for (let i = pareadas.length - 1; i >= 0; i -= 1) {
      const carta = cartaVisivel(snapshot, pareadas[i]);
      if (carta) return carta;
    }
    return null;
  }

  /** Conteúdo visual da frente: imagem da selfie ou glifo do símbolo padrão. */
  function criarConteudoFrente(def, carta) {
    if (def?.imagem) {
      const img = el('img', 'cards__selfie-img');
      img.src = def.imagem;
      img.alt = `Foto da carta ${def?.nome || `nº ${carta.id + 1}`}`;
      img.setAttribute('aria-hidden', 'true');
      return img;
    }
    return el('span', 'cards__glyph', def?.glyph || '❓');
  }

  /** Face ampliada com a mesma aparência da frente da carta do tabuleiro. */
  function criarFaceAmpliada(carta) {
    const def = simbolos.get(carta.simbolo) || {
      nome: `Carta ${carta.id + 1}`,
      glyph: '❓',
      cor: '#9a9ab8'
    };
    const nome = def.nome || `Carta ${carta.id + 1}`;
    const face = el('div', 'cards__ampliacao-carta');
    face.style.setProperty('--card-color', def.cor || '#9a9ab8');
    face.style.setProperty('--ampliacao-escala', String(tamanhoAmpliacao / 100));
    face.dataset.ampliacaoId = String(carta.id);
    face.setAttribute('aria-label', `Carta ampliada: ${nome}`);
    face.appendChild(criarConteudoFrente(def, carta));
    face.appendChild(el('span', 'cards__name', nome));
    if (def.variante > 0) face.appendChild(el('span', 'cards__variant', `v${def.variante + 1}`));
    return face;
  }

  function criarAreaAmpliacao(modo) {
    const area = el('div', `cards__ampliacao cards__ampliacao--${modo}`);
    area.dataset.ampliacao = modo;
    if (modo === 'fixa') {
      area.setAttribute('aria-label', 'Visualização ampliada da carta');
      area.appendChild(el('span', 'cards__ampliacao-titulo', 'CARTA AMPLIADA'));
    } else {
      area.setAttribute('role', 'status');
      area.setAttribute('aria-live', 'polite');
      area.setAttribute('aria-atomic', 'true');
      area.setAttribute('aria-hidden', 'true');
    }
    const conteudo = el('div', 'cards__ampliacao-conteudo');
    if (modo === 'fixa') {
      conteudo.setAttribute('aria-live', 'polite');
      conteudo.appendChild(el('span', 'cards__ampliacao-vazio', 'Nenhuma carta revelada'));
    }
    area.appendChild(conteudo);
    ampliacaoEl = area;
    ampliacaoConteudoEl = conteudo;
    return area;
  }

  function esconderOverlay() {
    if (ampliacaoEl?.dataset?.ampliacao !== 'temporaria') return;
    ampliacaoEl.classList.remove('cards__ampliacao--visivel');
    ampliacaoEl.setAttribute('aria-hidden', 'true');
  }

  function limparConteudoAmpliacao() {
    cancelarTimerAmpliacao();
    ampliacaoIdAtual = null;
    faceAmpliadaEl = null;
    if (ampliacaoConteudoEl) {
      ampliacaoConteudoEl.replaceChildren();
      if (ampliacaoEl?.dataset?.ampliacao === 'fixa') {
        ampliacaoConteudoEl.appendChild(
          el('span', 'cards__ampliacao-vazio', 'Nenhuma carta revelada')
        );
      }
    }
    esconderOverlay();
  }

  function mostrarAmpliacao(carta, modo) {
    if (!ampliacaoEl || !ampliacaoConteudoEl) return;
    ampliacaoConteudoEl.replaceChildren();
    faceAmpliadaEl = criarFaceAmpliada(carta);
    ampliacaoConteudoEl.appendChild(faceAmpliadaEl);
    ampliacaoIdAtual = carta.id;

    if (modo !== 'temporaria') return;
    ampliacaoEl.classList.add('cards__ampliacao--visivel');
    ampliacaoEl.setAttribute('aria-hidden', 'false');
    cancelarTimerAmpliacao();
    timerAmpliacao = agendar(() => {
      timerAmpliacao = null;
      esconderOverlay();
    }, duracaoAmpliacao);
  }

  /** Recria a área na posição correta (acima do tabuleiro) quando o modo muda. */
  function reconstruirAreaAmpliacao(config, modo) {
    cancelarTimerAmpliacao();
    if (ampliacaoEl) removerNo(ampliacaoEl);
    ampliacaoEl = null;
    ampliacaoConteudoEl = null;
    ampliacaoIdAtual = null;
    faceAmpliadaEl = null;
    ampliacaoModo = modo;
    if (modo === 'original' || config?.modo !== 'expandido') return;

    const area = criarAreaAmpliacao(modo);
    const pai = boardEl?.parentNode;
    if (pai) {
      const ordem = [];
      for (const filho of pai.children) {
        if (filho === boardEl) ordem.push(area);
        ordem.push(filho);
      }
      pai.replaceChildren(...ordem);
    } else {
      root?.appendChild(area);
    }
  }

  function atualizarAmpliacao(snapshot, config) {
    ultimoSnapshot = snapshot;
    if (config?.tamanhoAmpliacaoCartas !== undefined) {
      tamanhoAmpliacao = normalizarTamanhoAmpliacao(config.tamanhoAmpliacaoCartas);
    }
    const modo = config?.modo === 'expandido'
      ? normalizarAmpliacao(config.visualizacaoCartas)
      : 'original';
    if (modo !== ampliacaoModo || (modo !== 'original' && !ampliacaoEl)) {
      reconstruirAreaAmpliacao(config, modo);
    }
    if (modo === 'original') return;

    const carta = ultimaCartaVisivel(snapshot);
    if (!carta) {
      if (ampliacaoIdAtual !== null) limparConteudoAmpliacao();
      return;
    }
    // Mesmo id não reinicia o timer: o loop de renderização roda a cada frame.
    if (carta.id === ampliacaoIdAtual) return;
    mostrarAmpliacao(carta, modo);
  }

  /** Cancela a ampliação ao reiniciar, trocar de modo ou concluir a partida. */
  function cancelarAmpliacao() {
    limparConteudoAmpliacao();
  }

  /** Aplica uma nova preferência sem recriar o renderer. */
  function definirVisualizacaoCartas(modo) {
    const normalizado = normalizarAmpliacao(modo);
    if (normalizado === ampliacaoModo) return;
    if (configAtiva?.modo !== 'expandido') {
      ampliacaoModo = normalizado;
      return;
    }
    configAtiva = { ...configAtiva, visualizacaoCartas: normalizado };
    reconstruirAreaAmpliacao(configAtiva, normalizado);
    if (ultimoSnapshot) atualizarAmpliacao(ultimoSnapshot, configAtiva);
  }

  /**
   * Aplica o novo tamanho à carta já ampliada sem recriar a área, reiniciar a
   * partida ou tocar no grid. Válido nos três modos existentes.
   */
  function definirTamanhoAmpliacao(valor) {
    const normalizado = normalizarTamanhoAmpliacao(valor);
    if (normalizado === tamanhoAmpliacao) return normalizado;
    tamanhoAmpliacao = normalizado;
    if (configAtiva) configAtiva.tamanhoAmpliacaoCartas = normalizado;
    faceAmpliadaEl?.style.setProperty('--ampliacao-escala', String(normalizado / 100));
    if (dicaTamanhoEl) {
      dicaTamanhoEl.textContent =
        `Tamanho da carta ampliada: ${normalizado}%. Ajuste aqui ou em Configurações → Visual.`;
    }
    return normalizado;
  }

  function posicionarSmb3(node, carta, indice) {
    const colunas = configAtiva?.colunas || 6;
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const esquerda = PAINEL_SMB3.origemX + coluna * PAINEL_SMB3.passoX;
    const topo = PAINEL_SMB3.origemY + linha * PAINEL_SMB3.passoY;
    node.style.left = pct(esquerda, PAINEL_SMB3.largura);
    node.style.top = pct(topo, PAINEL_SMB3.altura);
    node.style.width = pct(PAINEL_SMB3.cartaLargura, PAINEL_SMB3.largura);
    node.style.height = pct(PAINEL_SMB3.cartaAltura, PAINEL_SMB3.altura);
    void carta;
  }

  function posicionarSeletor(indice) {
    if (!seletorEl || !configAtiva) return;
    const coluna = indice % configAtiva.colunas;
    const linha = Math.floor(indice / configAtiva.colunas);
    seletorEl.style.left = pct(
      PAINEL_SMB3.origemX - PAINEL_SMB3.seletorMargem + coluna * PAINEL_SMB3.passoX,
      PAINEL_SMB3.largura
    );
    seletorEl.style.top = pct(
      PAINEL_SMB3.origemY - PAINEL_SMB3.seletorMargem + linha * PAINEL_SMB3.passoY,
      PAINEL_SMB3.altura
    );
    seletorEl.style.width = pct(PAINEL_SMB3.seletorLargura, PAINEL_SMB3.largura);
    seletorEl.style.height = pct(PAINEL_SMB3.seletorAltura, PAINEL_SMB3.altura);
  }

  function criarCarta(carta, indice, somenteLeitura = false) {
    const def = simbolos.get(carta.simbolo) || {
      nome: `Carta ${carta.id + 1}`,
      glyph: '❓',
      cor: '#9a9ab8'
    };

    const btn = el('button', 'cards__card');
    btn.type = 'button';
    btn.dataset.id = String(carta.id);
    btn.setAttribute('aria-label', `Carta ${carta.id + 1}`);
    btn.setAttribute('aria-pressed', 'false');

    const inner = el('span', 'cards__card-inner');
    const verso = el('span', 'cards__face cards__face--back', '?');
    verso.setAttribute('aria-hidden', 'true');
    const frente = el('span', 'cards__face cards__face--front');
    frente.style.setProperty('--card-color', def.cor || '#9a9ab8');
    frente.appendChild(criarConteudoFrente(def, carta));
    frente.appendChild(el('span', 'cards__name', def.nome || ''));
    if (def.variante > 0) frente.appendChild(el('span', 'cards__variant', `v${def.variante + 1}`));

    inner.appendChild(verso);
    inner.appendChild(frente);
    btn.appendChild(inner);

    if (configAtiva?.modo === 'classico') posicionarSmb3(btn, carta, indice);

    if (!somenteLeitura) {
      escutar(btn, 'click', () => {
        // Defesa dupla: o botão já vem desativado na prévia, mas um clique
        // sintético/programático não pode iniciar tentativa nem seleção.
        if (emApresentacao || visaoTotalAtivo || btn.disabled) return;
        const revelada = cartaVisivel(ultimoSnapshot, carta.id);
        if (
          configAtiva?.modo === 'expandido' &&
          normalizarAmpliacao(configAtiva.visualizacaoCartas) === 'temporaria' &&
          revelada
        ) {
          // Carta já revelada: só amplia. Não repassa a seleção nem altera estado.
          audio.som('pick');
          mostrarAmpliacao(revelada, 'temporaria');
          return;
        }
        audio.som('pick');
        cursorId = carta.id;
        if (configAtiva?.modo === 'classico') {
          const posicao = ordemIds.indexOf(carta.id);
          if (posicao >= 0) posicionarSeletor(posicao);
        }
        callbacks.onSelecionar?.(carta.id);
      });
    } else {
      btn.disabled = true;
    }

    cartasEls.set(carta.id, btn);
    return btn;
  }

  function criarBoard(config, snapshot, somenteLeitura = false) {
    const board = el('div', 'cards__board');
    if (config.modo === 'classico') board.classList.add('cards__board--smb3');
    board.setAttribute('role', 'grid');
    board.style.setProperty('--cards-cols', String(config.colunas));
    board.style.setProperty('--cards-linhas', String(config.linhas));

    ordemIds = snapshot.cartas.map((carta) => carta.id);
    snapshot.cartas.forEach((carta, indice) => {
      board.appendChild(criarCarta(carta, indice, somenteLeitura));
    });

    if (config.modo === 'classico') {
      seletorEl = el('div', 'cards__sel');
      seletorEl.setAttribute('aria-hidden', 'true');
      posicionarSeletor(0);
      board.appendChild(seletorEl);
    }
    return board;
  }

  function moverCursor(deltaCol, deltaLin, colunas) {
    if (!ordemIds.length || cursorId === null) return;
    const atual = ordemIds.indexOf(cursorId);
    if (atual === -1) return;

    let destino;
    if (configAtiva?.modo === 'classico') {
      const passo = deltaCol !== 0 ? deltaCol : deltaLin * colunas;
      destino = (atual + passo + ordemIds.length) % ordemIds.length;
    } else {
      const linha = Math.floor(atual / colunas);
      const coluna = atual % colunas;
      const linhas = Math.ceil(ordemIds.length / colunas);
      const novaLinha = Math.min(linhas - 1, Math.max(0, linha + deltaLin));
      const novaColuna = Math.min(colunas - 1, Math.max(0, coluna + deltaCol));
      destino = novaLinha * colunas + novaColuna;
    }
    if (destino < 0 || destino >= ordemIds.length) return;

    const proximo = ordemIds[destino];
    cartasEls.get(cursorId)?.classList.remove('cards__card--cursor');
    cursorId = proximo;
    const elemento = cartasEls.get(cursorId);
    elemento?.classList.add('cards__card--cursor');
    elemento?.focus({ preventScroll: true });
    if (configAtiva?.modo === 'classico') posicionarSeletor(destino);
    audio.som('mover');
  }

  function instalarTeclado(config) {
    // Substitui o controller da partida anterior (limpar() também aborta).
    controllerPartida?.abort();
    controllerPartida = new AbortController();
    escutar(window, 'keydown', (event) => {
      if (resultEl && !resultEl.classList.contains('hidden')) return;
      if (emApresentacao || visaoTotalAtivo) return;
      const chave = event.key;

      if (chave === 'ArrowLeft') { event.preventDefault(); moverCursor(-1, 0, config.colunas); }
      else if (chave === 'ArrowRight') { event.preventDefault(); moverCursor(1, 0, config.colunas); }
      else if (chave === 'ArrowUp') { event.preventDefault(); moverCursor(0, -1, config.colunas); }
      else if (chave === 'ArrowDown') { event.preventDefault(); moverCursor(0, 1, config.colunas); }
      else if (chave === 'Enter' || chave === ' ') {
        if (cursorId !== null && document.activeElement !== cartasEls.get(cursorId)) {
          event.preventDefault();
          cartasEls.get(cursorId)?.click();
        }
      }
    }, { signal: controllerPartida.signal });
  }

  /** Apresentação inicial: cartas viradas para memorização. */
  function mostrarApresentacao(config, snapshot) {
    if (!root) return;
    limpar();
    configAtiva = config;
    tamanhoAmpliacao = normalizarTamanhoAmpliacao(
      config?.tamanhoAmpliacaoCartas ?? tamanhoAmpliacao
    );
    emApresentacao = true;
    simbolos = new Map((config.simbolos || []).map((item) => [item.id, item]));

    const game = el('section', 'cards__game');
    game.appendChild(criarTopo(config, 'Memorize as cartas'));
    game.appendChild(el('p', 'cards__meta',
      `Memorize as 18 cartas por ${(config.tempoMemorizacaoMs / 1000).toFixed(1)} s · ${config.descricao || ''}`));

    boardEl = criarBoard(config, snapshot, true);
    for (const carta of snapshot.cartas) {
      cartasEls.get(carta.id)?.classList.add('cards__card--revelada');
    }
    game.appendChild(boardEl);

    const barra = el('div', 'cards__memoria');
    const preenchimento = el('div', 'cards__memoria-barra');
    preenchimento.style.setProperty('--memoria-ms', `${config.tempoMemorizacaoMs}ms`);
    barra.appendChild(preenchimento);
    game.appendChild(barra);
    feedbackEl = el('div', 'cards__feedback', 'Memorize as posições...');
    feedbackEl.setAttribute('aria-live', 'polite');
    game.appendChild(feedbackEl);

    resultEl = el('div', 'cards__result hidden');
    game.appendChild(resultEl);
    root.appendChild(game);
  }

  /** Estrutura comum: a mesma partida é reaproveitada na prévia e no jogo. */
  function criarEstruturaPartida(config, snapshot, { previa = false } = {}) {
    if (!root) return;
    limpar();
    configAtiva = config;
    tamanhoAmpliacao = normalizarTamanhoAmpliacao(
      config?.tamanhoAmpliacaoCartas ?? tamanhoAmpliacao
    );
    emApresentacao = previa;
    simbolos = new Map((config.simbolos || []).map((item) => [item.id, item]));
    if (config.saldoMQ !== undefined) saldoMQVisivel = formatarQuantidadeMQ(config.saldoMQ);

    const game = el('section', 'cards__game');
    if (previa) game.classList.add('cards__game--previa');
    game.appendChild(criarTopo(config, previa ? 'Memorize as cartas' : null, { previa }));

    if (config.tempoAlvo) {
      game.appendChild(el('p', 'cards__meta',
        `Tempo alvo: ${formatarTempo(config.tempoAlvo)} · Dificuldade: ${config.titulo}`));
    }

    game.appendChild(criarHud(config));

    // Os listeners já são instalados, mas ficam desativados enquanto a prévia
    // está ativa. Assim as mesmas cartas viram para baixo com animação ao fim.
    boardEl = criarBoard(config, snapshot, false);
    game.appendChild(boardEl);

    feedbackEl = el('div', 'cards__feedback', 'Selecione duas cartas');
    feedbackEl.setAttribute('aria-live', 'polite');
    game.appendChild(feedbackEl);

    resultEl = el('div', 'cards__result hidden');
    resultEl.setAttribute('role', 'dialog');
    resultEl.setAttribute('aria-modal', 'true');
    game.appendChild(resultEl);

    root.appendChild(game);

    cursorId = ordemIds[0] ?? null;
    cartasEls.get(cursorId)?.classList.add('cards__card--cursor');
  }

  /**
   * Prévia obrigatória: todas as cartas abertas, mensagem central, contagem
   * regressiva e indicador de tempo restante. Nenhuma tentativa/erro é tocado.
   */
  function mostrarPrevia(config, snapshot, opcoes = {}) {
    if (!root) return;
    const duracaoMs = Math.max(
      0,
      Number(opcoes.duracaoMs ?? config.tempoPreviaMs ?? config.tempoMemorizacaoMs ?? 0) || 0
    );
    const mensagem = opcoes.mensagem || 'MEMORIZE AS CARTAS!';
    criarEstruturaPartida(config, snapshot, { previa: true });
    if (!boardEl) return;

    const game = boardEl.parentNode;
    const aviso = el('div', 'cards__previa');
    aviso.dataset.previa = 'true';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    aviso.setAttribute('aria-atomic', 'true');
    aviso.appendChild(el('div', 'cards__previa-mensagem', mensagem));
    previaContagemEl = el('div', 'cards__previa-contagem',
      String(Math.ceil(duracaoMs / 1000)));
    previaContagemEl.setAttribute('aria-label', 'Segundos restantes');
    aviso.appendChild(previaContagemEl);

    const barra = el('div', 'cards__memoria cards__memoria--previa');
    barra.setAttribute('role', 'progressbar');
    barra.setAttribute('aria-label', 'Tempo restante da prévia');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    previaBarraEl = el('div', 'cards__memoria-barra cards__memoria-barra--previa');
    barra.appendChild(previaBarraEl);
    aviso.appendChild(barra);
    // A contagem ocupa espaço próprio no fluxo, acima do tabuleiro. Assim nenhuma
    // carta fica encoberta em nenhum tamanho de tela.
    game.insertBefore(aviso, boardEl);
    previaOverlayEl = aviso;

    boardEl.classList.add('cards__board--bloqueado');
    for (const carta of snapshot.cartas) {
      const no = cartasEls.get(carta.id);
      if (!no) continue;
      no.classList.add('cards__card--revelada');
      no.disabled = true;
    }
    feedback(mensagem, 'previa');
    atualizarPrevia(duracaoMs, duracaoMs);
  }

  /** Atualiza apenas a apresentação da prévia; nunca toca no estado da partida. */
  function atualizarPrevia(restanteMs, duracaoMs) {
    const restante = Math.max(0, restanteMs);
    const segundos = Math.ceil(restante / 1000);
    if (previaContagemEl) {
      previaContagemEl.textContent = String(segundos);
      previaContagemEl.classList.toggle('cards__previa-contagem--urgente', segundos <= 2);
    }
    if (previaBarraEl) {
      const fracao = duracaoMs > 0 ? Math.min(1, Math.max(0, restante / duracaoMs)) : 0;
      previaBarraEl.style.setProperty('--previa-fracao', String(fracao));
      previaBarraEl.setAttribute('aria-valuenow', String(Math.round(fracao * 100)));
    }
  }

  /** Encerra a prévia: vira as cartas, libera a interação e mostra o HUD real. */
  function concluirPrevia(config, snapshot) {
    if (!boardEl) return;
    emApresentacao = false;
    if (previaOverlayEl) removerNo(previaOverlayEl);
    previaOverlayEl = null;
    previaContagemEl = null;
    previaBarraEl = null;
    boardEl.classList.remove('cards__board--bloqueado');

    reconstruirAreaAmpliacao(config, normalizarAmpliacao(config.visualizacaoCartas));
    instalarTeclado(config);
    definirUsosVisaoTotal(config.usosVisaoTotal ?? usosVisaoTotal);
    // O snapshot ainda tem todas as cartas viradas: atualizar() remove a classe
    // --revelada e o CSS 3D faz a virada sem recriar o tabuleiro.
    atualizar(snapshot, config, 0);
    feedback('Selecione duas cartas');
    audio.som('select');
  }

  function mostrarPartida(config, snapshot) {
    if (!root) return;
    criarEstruturaPartida(config, snapshot);
    reconstruirAreaAmpliacao(config, normalizarAmpliacao(config.visualizacaoCartas));
    instalarTeclado(config);
    definirUsosVisaoTotal(config.usosVisaoTotal ?? usosVisaoTotal);
    atualizar(snapshot, config, 0);
  }

  /** Reflete o saldo MQ após uma compra/liquidação sem recriar a tela. */
  function atualizarSaldoMQ(saldo) {
    const texto = formatarQuantidadeMQ(saldo);
    saldoMQVisivel = texto;
    if (saldoNode) {
      saldoNode.textContent = `🪙 SALDO MEMORY QUEST: ${texto}`;
      saldoNode.dataset.saldoMq = texto;
    }
    if (hud.saldo) hud.saldo.textContent = `SALDO MQ: ${texto}`;
    for (const controle of controlesCheatMoedas) {
      controle.saldo.textContent = `Saldo atual: ${texto}`;
    }
  }

  /** Sincroniza o botão da habilidade com o inventário real e o ciclo da habilidade. */
  function definirUsosVisaoTotal(usos, opcoes = {}) {
    usosVisaoTotal = formatarQuantidadeMQ(usos);
    const rotulo = `${usosVisaoTotal} ${usosVisaoTotal === 1 ? 'uso' : 'usos'}`;
    if (contadorVisaoTotal) {
      contadorVisaoTotal.textContent = String(usosVisaoTotal);
      contadorVisaoTotal.dataset.usosVisaoTotal = String(usosVisaoTotal);
    }
    if (Number.isFinite(opcoes.duracaoMs) && opcoes.duracaoMs > 0) {
      visaoTotalDuracaoMs = opcoes.duracaoMs;
    }
    if (estadoVisaoTotal) {
      estadoVisaoTotal.textContent = visaoTotalAtivo
        ? `ATIVA · ${Math.ceil(visaoTotalDuracaoMs / 1000)}s`
        : opcoes.estado === 'consumindo' ? 'Processando…' : rotulo;
    }
    if (botaoVisaoTotal) {
      botaoVisaoTotal.disabled = usosVisaoTotal < 1 || visaoTotalAtivo
        || opcoes.estado === 'consumindo' || emApresentacao;
      botaoVisaoTotal.setAttribute(
        'aria-label', `Usar Visão total. ${rotulo} disponíveis`
      );
      botaoVisaoTotal.classList.toggle('cards__visao-total--ativo', visaoTotalAtivo);
      botaoVisaoTotal.classList.toggle('cards__visao-total--sem-usos', usosVisaoTotal < 1);
    }
  }

  /** Verifica se uma carta está visível apenas por causa da habilidade ativa. */
  function cartaReveladaPorVisao(id) {
    return visaoTotalAtivo && visaoTotalRevelados.has(id);
  }

  /**
   * Inversão 100% visual: cartas não encontradas ficam reveladas e cartas de
   * pares já encontrados ficam ocultas. O snapshot lógico (`board.js`) continua
   * intacto: nenhum par é desfeito e nenhum acerto é registrado.
   */
  function ativarVisaoTotal(snapshot, duracaoMs = 3000) {
    if (!boardEl) return;
    cancelarAmpliacao();
    visaoTotalAtivo = true;
    visaoTotalDuracaoMs = Math.max(1, Math.ceil(Number(duracaoMs) || 3000));
    visaoTotalRevelados = new Set(
      (snapshot?.cartas || []).filter((carta) => !carta.pareada).map((carta) => carta.id)
    );
    visaoTotalOcultados = new Set(
      (snapshot?.cartas || []).filter((carta) => carta.pareada).map((carta) => carta.id)
    );
    boardEl.classList.add('cards__board--bloqueado');
    boardEl.classList.add('cards__board--visao-total');
    for (const carta of snapshot?.cartas || []) {
      const no = cartasEls.get(carta.id);
      if (!no) continue;
      const revelada = visaoTotalRevelados.has(carta.id);
      no.classList.toggle('cards__card--revelada', revelada);
      no.classList.toggle('cards__card--oculta-visao', visaoTotalOcultados.has(carta.id));
      no.classList.remove('cards__card--selecionada');
      no.setAttribute('aria-pressed', revelada ? 'true' : 'false');
      no.disabled = true;
    }
    definirCheatMoedasBloqueado(true);
    definirUsosVisaoTotal(usosVisaoTotal, { duracaoMs: visaoTotalDuracaoMs });
    const segundos = Math.ceil(visaoTotalDuracaoMs / 1000);
    feedback(
      `VISÃO TOTAL — ${visaoTotalRevelados.size} cartas reveladas · ` +
      `${visaoTotalOcultados.size} pares ocultos por ${segundos}s`,
      'previa'
    );
    if (botaoVisaoTotal) botaoVisaoTotal.dataset.visaoTotalAtiva = 'true';
  }

  /** Restaura exatamente o estado visual anterior ao término/cancelamento. */
  function restaurarVisaoTotal(snapshot) {
    visaoTotalAtivo = false;
    visaoTotalRevelados = new Set();
    visaoTotalOcultados = new Set();
    definirCheatMoedasBloqueado(false);
    if (botaoVisaoTotal) botaoVisaoTotal.dataset.visaoTotalAtiva = 'false';
    if (!boardEl) {
      definirUsosVisaoTotal(usosVisaoTotal);
      return;
    }
    for (const no of cartasEls.values()) no.classList.remove('cards__card--oculta-visao');
    boardEl.classList.remove('cards__board--visao-total');
    atualizar(snapshot || ultimoSnapshot || { cartas: [], selecionadas: [], aguardandoComparacao: false },
      configAtiva, ultimoTempoSegundos);
    definirUsosVisaoTotal(usosVisaoTotal);
    feedback('Visão total encerrada');
  }

  function atualizar(snapshot, config, tempoSegundos = 0) {
    if (!boardEl) return;
    ultimoTempoSegundos = tempoSegundos;
    for (const carta of snapshot.cartas) {
      const node = cartasEls.get(carta.id);
      if (!node) continue;
      const ocultaPelaVisao = visaoTotalOcultados.has(carta.id);
      const revelada = !ocultaPelaVisao && (
        carta.revelada || carta.pareada || cartaReveladaPorVisao(carta.id)
      );
      node.classList.toggle('cards__card--revelada', revelada);
      node.classList.toggle('cards__card--oculta-visao', ocultaPelaVisao);
      node.classList.toggle('cards__card--pareada', carta.pareada);
      node.classList.toggle(
        'cards__card--selecionada',
        snapshot.selecionadas.includes(carta.id) && !visaoTotalAtivo
      );
      node.setAttribute('aria-pressed', revelada ? 'true' : 'false');
      node.disabled = carta.pareada || emApresentacao || visaoTotalAtivo;
    }

    boardEl.classList.toggle(
      'cards__board--bloqueado',
      snapshot.aguardandoComparacao || visaoTotalAtivo
    );
    boardEl.classList.toggle('cards__board--visao-total', visaoTotalAtivo);

    if (hud.pares) hud.pares.textContent = `Pares ${snapshot.progresso.pares}/${snapshot.progresso.totalPares}`;
    if (hud.tentativas) {
      hud.tentativas.textContent = config.modalidade === 'tentativas'
        ? (snapshot.tentativasInfinitas
          ? 'TENTATIVAS: ∞'
          : `TENTATIVAS: ${snapshot.tentativasRestantes ?? 0}`)
        : `Tentativas ${snapshot.tentativas}`;
    }
    if (hud.erros) hud.erros.textContent = `Erros ${snapshot.erros}`;

    const economia = snapshot.economia || config.economia;
    if (hud.saldo) {
      hud.saldo.textContent = `SALDO MQ: ${formatarQuantidadeMQ(economia?.saldo ?? config.saldoMQ)}`;
    }
    if (hud.moedas) {
      hud.moedas.textContent = `MOEDAS: ${formatarQuantidadeMQ(economia?.moedasPares)}`;
    }
    if (hud.sequencia) {
      hud.sequencia.textContent = `SEQ: ${formatarQuantidadeMQ(economia?.sequenciaFinal)}`;
    }
    if (hud.multiplicador) {
      hud.multiplicador.textContent = `MULT: x${formatarQuantidadeMQ(economia?.multiplicadorAtual || 1)}`;
    }
    if (hud.pontuacao && economia?.pontuacao != null) {
      hud.pontuacao.textContent = `PONTOS: ${formatarQuantidadeMQ(economia.pontuacao)}`;
    } else if (hud.pontuacao && snapshot.pontuacao != null) {
      hud.pontuacao.textContent = `PONTOS: ${snapshot.pontuacao}`;
    }
    if (hud.tempo) {
      hud.tempo.textContent = config.modo === 'expandido'
        ? `Tempo ${formatarTempo(tempoSegundos)}`
        : 'Tempo —';
    }

    atualizarAmpliacao(snapshot, config);
  }

  function feedback(texto, tipo = '') {
    if (!feedbackEl) return;
    feedbackEl.textContent = texto;
    feedbackEl.className = `cards__feedback ${tipo ? `cards__feedback--${tipo}` : ''}`.trim();
  }

  function mostrarResultado({
    titulo = 'Partida concluída',
    linhas = [],
    desafios = [],
    botoes = [],
    modo = null,
    dificuldade = null,
    economia = null,
    somVitoria = true,
    tocarSom = true
  } = {}) {
    cancelarAmpliacao();
    if (!resultEl) return;
    resultEl.replaceChildren();
    resultEl.appendChild(el('h3', 'cards__result-titulo', titulo));

    const ident = el('div', 'cards__result-ident');
    ident.appendChild(badge(modo || 'expandido'));
    if (dificuldade) {
      ident.appendChild(el('span', 'cards__result-diff', `Dificuldade: ${dificuldade}`));
    }
    resultEl.appendChild(ident);

    const lista = el('ul', 'cards__result-linhas');
    for (const linha of linhas) lista.appendChild(el('li', '', String(linha)));
    resultEl.appendChild(lista);

    if (economia) {
      const painel = el('div', 'cards__result-economia');
      const itens = [
        ['moedas', `MOEDAS +${formatarQuantidadeMQ(economia.moedasPares)}`],
        ['bonus', `BÔNUS +${formatarQuantidadeMQ(economia.bonus)}`],
        ['total', `TOTAL +${formatarQuantidadeMQ(economia.total)}`],
        ['saldo', `SALDO ${formatarQuantidadeMQ(economia.saldo)}`]
      ];
      if (economia.modalidade === 'pontuacao' && economia.pontuacao != null) {
        itens.push(['pontos', `PONTOS ${formatarQuantidadeMQ(economia.pontuacao)}`]);
      }
      for (const [chave, texto] of itens) {
        painel.appendChild(el('span', `cards__economia-item cards__economia-item--${chave}`, texto));
      }
      if (!economia.elegivel) {
        painel.appendChild(el('span', 'cards__economia-bloqueio',
          `🚫 RECOMPENSAS BLOQUEADAS: CHEAT${economia.motivoInelegibilidade
            ? ` (${economia.motivoInelegibilidade})` : ''}`
        ));
      }
      resultEl.appendChild(painel);
    }

    if (desafios.length) {
      const chips = el('div', 'cards__desafios');
      for (const desafio of desafios) {
        chips.appendChild(el('span',
          `cards__desafio ${desafio.concluido ? 'cards__desafio--ok' : 'cards__desafio--falha'}`,
          `${desafio.concluido ? '✓' : '·'} ${desafio.descricao}`));
      }
      resultEl.appendChild(chips);
    }

    const acoes = el('div', 'cards__result-acoes');
    for (const item of botoes) {
      const btn = botao(item.texto, item.classe || 'btn btn--arcade', item.acao);
      if (item.id) btn.dataset.acao = item.id;
      acoes.appendChild(btn);
    }
    resultEl.appendChild(acoes);

    resultEl.classList.remove('hidden');
    // O integrador já toca o som adequado nos callbacks de par/erro; `tocarSom`
    // evita o som duplicado no fim da partida.
    if (tocarSom) audio.som(somVitoria ? 'vitoria' : 'erro');
  }

  function esconderResultado() {
    resultEl?.classList.add('hidden');
  }

  function destruir() {
    controller.abort();
    audio.parar();
    limpar();
  }

  return {
    mostrarMenu,
    mostrarApresentacao,
    mostrarPrevia,
    atualizarPrevia,
    concluirPrevia,
    mostrarPartida,
    atualizar,
    atualizarSaldoMQ,
    definirUsosVisaoTotal,
    ativarVisaoTotal,
    restaurarVisaoTotal,
    feedback,
    mostrarResultado,
    esconderResultado,
    cancelarAmpliacao,
    definirVisualizacaoCartas,
    definirTamanhoAmpliacao,
    mostrarSelfies: mostrarGaleriaSelfies,
    mostrarEditorSelfie,
    mostrarErroSelfie,
    definirAudio: (preferencias) => audio.definirAudio(preferencias),
    get volumeFx() { return audio.volumeFx; },
    get volumeBgm() { return audio.volumeBgm; },
    destruir,
    som: (nome) => audio.som(nome),
    get emApresentacao() { return emApresentacao; },
    get ativo() { return Boolean(root); }
  };
}
