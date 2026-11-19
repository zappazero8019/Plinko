/**
 * games/cards/index.js — Integração e ciclo de vida do Card Match
 *
 * Responsabilidades:
 *  - montar a configuração do Jogo da Memória: dificuldade, modalidade, CHEAT,
 *    áudio e galeria de selfies;
 *  - conduzir o fluxo do Jogo da Memória: configuração → partida → resultado;
 *  - criar/destruir sessão, listeners e temporizadores ao entrar/sair;
 *  - persistir estatísticas e preferências via serviços centrais;
 *  - liquidar recompensas APENAS via `core/mq-economy.js`, sem tocar na carteira
 *    legada do Plinko e sem acessar IndexedDB diretamente.
 */

import {
  criarConfigExpandida,
  avaliarDesafios
} from './expanded.js';
import { criarSessao } from './board.js';
import { criarRenderer } from './renderer.js';
import { criarControladorPrevia } from './previa.js';
import {
  DIFICULDADES_CARTAS_EXPANDIDO,
  PROGRESSAO_CARTAS,
  obterTempoPrevia,
  dificuldadeAposVitoria
} from './difficulty.js';
import {
  calcularTentativasIniciais
} from './tentativas.js';
import {
  registrarPartida,
  obterEstatisticas
} from '../../core/game-stats.js';
import {
  obterSaldoMQ,
  liquidarSessaoMQ
} from '../../core/mq-economy.js';
import { criarRastreadorRecompensas } from './recompensas.js';
import {
  obterPreferenciasCartas,
  salvarPreferenciasCartas,
  normalizarVisualizacaoCartas,
  normalizarTamanhoAmpliacao,
  normalizarModalidadeCartas,
  normalizarQuantidadeCheat,
  normalizarVolumeCartas,
  normalizarDificuldadeCartas,
  normalizarProgressaoAutomaticaCartas,
  registrarObservadorPreferencias,
  VISUALIZACAO_PADRAO,
  TAMANHO_AMPLIACAO_PADRAO,
  VOLUME_FX_PADRAO,
  VOLUME_BGM_PADRAO
} from '../../core/settings.js';
import {
  listarSelfies,
  criarSelfie,
  substituirSelfie,
  excluirSelfie,
  definirSelfieAtiva,
  normalizarEnquadramento
} from '../../core/selfies.js';
import { navegarPara } from '../../app/router.js';

let iniciado = false;
let root = null;
let renderer = null;
let sessao = null;
let configAtual = null;
// `dificuldadeInicial` é a preferência persistida. `dificuldadeAtual` é a
// seleção efetiva da rodada: só ela muda quando há vitória legítima com
// progressão ligada; o avanço nunca é gravado como nova dificuldade inicial.
let dificuldadeInicial = 'normal';
let dificuldadeAtual = 'normal';
let progressaoAutomatica = true;
let visualizacaoCartasAtual = VISUALIZACAO_PADRAO;
let tamanhoAmpliacaoAtual = TAMANHO_AMPLIACAO_PADRAO;
let removerObservadorPreferencias = null;
let modalidadeAtual = 'pontuacao';
let cheatAtual = { infinitas: false, personalizada: false, quantidade: 20 };
let audioAtual = { fx: true, bgm: true };
let selfies = [];
let selfiesAtivasAtual = [];
let animFrame = null;
let controladorPrevia = null;
let emApresentacao = false;
// Identificador de geração: qualquer nova partida/menu/destroy invalida os
// callbacks da prévia anterior, mesmo que um timer atrasado ainda dispare.
let sequenciaSessao = 0;
let partidaFinalizada = false;
// ETAPA 3: economia isolada por partida. `rastreador` é descartado em abandono,
// reinício e navegação — nessas situações não há liquidação nem pagamento.
let rastreador = null;
let saldoMQAtual = 0;

/** Nomes legíveis para os botões de dificuldade. */
const NOMES_DIFICULDADE = Object.fromEntries(
  Object.entries(DIFICULDADES_CARTAS_EXPANDIDO).map(([chave, valor]) => [chave, valor.label])
);

/** Exibe falhas de selfie na tela atual sem descartar o que já foi salvo. */
function erroSelfie(mensagem) {
  if (renderer?.mostrarErroSelfie) renderer.mostrarErroSelfie(mensagem);
  console.warn('[cards] Selfie:', mensagem);
}

function pararLoop() {
  if (animFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(animFrame);
  }
  animFrame = null;
}

function limparPrevia() {
  controladorPrevia?.parar();
  controladorPrevia = null;
  emApresentacao = false;
}

/** Identificador único da liquidação, estável mesmo após reload/reinício. */
function novoIdSessaoMQ() {
  const agora = Date.now().toString(36);
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `mq_${agora}_${aleatorio}_${sequenciaSessao}`;
}

async function recarregarSaldoMQ() {
  try {
    saldoMQAtual = await obterSaldoMQ();
  } catch (err) {
    console.warn('[cards] Não foi possível carregar o saldo do Memory Quest:', err);
  }
  return saldoMQAtual;
}

/** Resumo leve para o HUD; nunca liquida nem grava nada. */
function economiaNaTela() {
  if (!rastreador) return null;
  const stats = sessao?.estatisticas();
  const resumo = rastreador.resumo({
    vitoria: false,
    tempoSegundos: stats?.tempoSegundos ?? 0,
    tentativas: stats?.tentativas ?? rastreador.paresEncontrados + rastreador.erros,
    tentativasRestantes: stats?.tentativasRestantes ?? null
  });
  return {
    ...resumo,
    saldo: saldoMQAtual,
    multiplicadorAtual: rastreador.multiplicadorAtual
  };
}

function atualizarEconomiaNaTela() {
  if (!renderer || !configAtual || !sessao) return;
  const snapshot = { ...sessao.estado(), economia: economiaNaTela() };
  renderer.atualizar(snapshot, configAtual, sessao.tempoDecorrido());
}

/**
 * PONTO ÚNICO DE BLOQUEIO POR CHEAT.
 *
 * Todo cheat existente ou futuro deve chamar esta função. O bloqueio é
 * imediato, permanente na sessão e atinge todas as modalidades. Desativar o
 * cheat depois não restaura as recompensas.
 */
function sinalizarCheat(tipo, detalhes = {}, avisar = true) {
  if (!rastreador || rastreador.finalizado) return;
  rastreador.registrarCheat(tipo, detalhes);
  if (!avisar) return;
  renderer?.feedback('RECOMPENSAS BLOQUEADAS: CHEAT', 'erro');
  atualizarEconomiaNaTela();
}

function encerrarSessao() {
  // Incrementar antes de limpar garante que nenhum callback da geração anterior
  // altere a partida nova (reinício, abandonos, navegação ou destroy).
  sequenciaSessao += 1;
  partidaFinalizada = false;
  // Abandono, reinício e navegação não liquidam: o rastreador simplesmente
  // morre aqui. Nenhum par encontrado é creditado nesses casos.
  rastreador = null;
  pararLoop();
  limparPrevia();
  renderer?.cancelarAmpliacao();
  if (sessao) {
    sessao.destruir();
    sessao = null;
  }
  configAtual = null;
}

async function abrirMenu(foco = null) {
  encerrarSessao();
  if (!renderer) return;

  let estatisticas = null;
  try {
    [estatisticas, saldoMQAtual] = await Promise.all([
      obterEstatisticas(),
      obterSaldoMQ()
    ]);
  } catch (err) {
    console.warn('[cards] Não foi possível carregar estatísticas/saldo:', err);
    await recarregarSaldoMQ();
  }

  renderer.mostrarMenu({
    modo: 'expandido',
    dificuldade: dificuldadeAtual,
    progressao: progressaoAutomatica,
    estatisticas,
    estatisticasModalidade: estatisticas?.porModalidade,
    dificuldades: PROGRESSAO_CARTAS,
    nomesDificuldade: NOMES_DIFICULDADE,
    visualizacaoCartas: visualizacaoCartasAtual,
    tamanhoAmpliacaoCartas: tamanhoAmpliacaoAtual,
    modalidade: modalidadeAtual,
    cheat: cheatAtual,
    audioPreferencias: audioAtual,
    selfies,
    selfiesAtivas: selfiesAtivasAtual,
    saldoMQ: saldoMQAtual,
    foco
  });
}

function selfiesSelecionadas() {
  const ativas = new Set(selfiesAtivasAtual.map(Number));
  return selfies.filter((selfie) => ativas.has(Number(selfie.id)));
}

function configuracaoAtual(calculo = calcularTentativasIniciais(dificuldadeAtual, cheatAtual)) {
  // A preferência visual e o CHEAT entram na configuração da partida; nenhuma
  // regra de comparação, tempo ou desafio é alterada. A distribuição de selfies
  // acontece aqui, apenas quando uma nova partida é criada.
  return {
    ...criarConfigExpandida(dificuldadeAtual, Math.random, {
      selfies: selfiesSelecionadas(),
      modalidade: modalidadeAtual,
      cheat: calculo
    }),
    visualizacaoCartas: visualizacaoCartasAtual,
    tamanhoAmpliacaoCartas: tamanhoAmpliacaoAtual,
    saldoMQ: saldoMQAtual
  };
}

function tratarEvento(resultado) {
  if (!renderer || !configAtual || !sessao) return;

  renderer.atualizar(
    { ...sessao.estado(), economia: economiaNaTela() },
    configAtual,
    sessao.tempoDecorrido()
  );

  const mensagens = {
    revelado: 'Escolha a segunda carta',
    comparacao: 'Comparando...',
    bloqueado: 'Aguarde a comparação atual',
    ignorado: 'Esta carta já foi escolhida',
    par: 'Par encontrado!',
    erro: 'Não combina — tente lembrar',
    esgotado: 'Tentativas esgotadas!',
    concluido: 'Todas as cartas foram combinadas!'
  };
  renderer.feedback(mensagens[resultado.tipo] || '', resultado.tipo || '');
}

function somPar(resultado) {
  if (!renderer) return;
  if (resultado.tipo === 'concluido') {
    renderer.som('vitoria');
    return;
  }
  const simbolo = String(resultado.simbolo || '');
  if (simbolo.startsWith('coins10') || simbolo.startsWith('coins20')) renderer.som('coin');
  else if (simbolo.startsWith('oneup')) renderer.som('oneup');
  else renderer.som('match');
}

function iniciarLoop(config) {
  if (config.modo !== 'expandido' || typeof requestAnimationFrame !== 'function') return;
  pararLoop();
  const loop = () => {
    if (!sessao || sessao.destruida) return;
    atualizarEconomiaNaTela();
    animFrame = requestAnimationFrame(loop);
  };
  animFrame = requestAnimationFrame(loop);
}

function iniciarPartida() {
  if (!renderer) return;
  encerrarSessao();

  // A geração é capturada depois de encerrar a anterior: qualquer callback
  // pendente da partida/prévia antiga será ignorado.
  const idSessao = sequenciaSessao;
  partidaFinalizada = false;
  const calculo = calcularTentativasIniciais(dificuldadeAtual, cheatAtual);
  const config = configuracaoAtual(calculo);
  configAtual = config;

  // Rastreador novo por partida. A prévia não chama registrarPar(), portanto
  // nenhuma carta vista antes da virada pode gerar moedas.
  rastreador = criarRastreadorRecompensas({
    sessionId: novoIdSessaoMQ(),
    dificuldade: config.dificuldade,
    modalidade: config.modalidade,
    tentativasIniciais: config.tentativasIniciais,
    tempoAlvo: config.tempoAlvo
  });

  // Um cheat já ativo na preferência também invalida a partida: ele afeta o
  // orçamento/execução desde o primeiro segundo.
  if (cheatAtual.infinitas) {
    sinalizarCheat('infinitas', { origem: 'inicio' }, false);
  }
  if (cheatAtual.personalizada) {
    sinalizarCheat('personalizada', {
      origem: 'inicio', quantidade: cheatAtual.quantidade
    }, false);
  }
  if (calculo.tipo !== 'normal' && !cheatAtual.infinitas && !cheatAtual.personalizada) {
    sinalizarCheat(calculo.tipo, { origem: 'configuracao' }, false);
  }

  renderer.definirAudio(audioAtual);

  // Barreira adicional contra callbacks atrasados depois de reinício, menu ou
  // navegação, mesmo que o board ainda tenha um timer pendente.
  const seguro = (fn) => (...args) => {
    if (idSessao !== sequenciaSessao || !sessao || sessao.destruida || partidaFinalizada) return;
    fn(...args);
  };

  sessao = criarSessao(config, {
    callbacks: {
      onRevelado: seguro(tratarEvento),
      onComparacao: seguro(tratarEvento),
      onBloqueado: seguro(tratarEvento),
      onPar: seguro((resultado) => {
        rastreador?.registrarPar();
        somPar(resultado);
        tratarEvento(resultado);
      }),
      onErro: seguro((resultado) => {
        rastreador?.registrarErro();
        renderer?.som('nomatch');
        tratarEvento(resultado);
      }),
      onEsgotado: seguro(() => finalizarPartida({
        derrota: true, idSessaoEsperado: idSessao
      })),
      onConcluido: seguro(() => finalizarPartida({
        derrota: false, idSessaoEsperado: idSessao
      }))
    }
  });

  const duracaoPrevia = obterTempoPrevia(config.dificuldade);
  renderer.mostrarPrevia(config, sessao.estado(), {
    duracaoMs: duracaoPrevia,
    mensagem: 'MEMORIZE AS CARTAS!'
  });
  emApresentacao = true;

  controladorPrevia = criarControladorPrevia({
    duracaoMs: duracaoPrevia,
    onTick: (restanteMs, totalMs) => {
      if (idSessao !== sequenciaSessao || !sessao) return;
      renderer?.atualizarPrevia(restanteMs, totalMs);
    },
    onConcluir: () => {
      if (idSessao !== sequenciaSessao || !sessao || sessao.destruida) return;
      controladorPrevia = null;
      emApresentacao = false;
      // Só agora o cronômetro/tentativas/erros oficiais começam a valer.
      sessao.iniciarCronometro();
      renderer?.concluirPrevia(config, sessao.estado());
      iniciarLoop(config);
    }
  });
  controladorPrevia.iniciar();
}

async function finalizarPartida({ derrota = false, idSessaoEsperado = null } = {}) {
  if (!sessao || !configAtual || !rastreador) return;
  // Um único desfecho por partida: callbacks duplicados (par + conclusão, por
  // exemplo) não podem provocar dois avanços, duas liquidações ou dois pagamentos.
  if (partidaFinalizada) return;
  if (idSessaoEsperado !== null && idSessaoEsperado !== sequenciaSessao) return;
  partidaFinalizada = true;

  pararLoop();
  renderer?.cancelarAmpliacao();
  const config = configAtual;
  const stats = sessao.estatisticas();
  const vitoria = !derrota;
  const elegivel = rastreador.rewardsEligible;
  const vitoriaLegitima = vitoria && elegivel;

  const economiaFinal = rastreador.finalizar({
    vitoria,
    tempoSegundos: stats.tempoSegundos,
    tentativas: stats.tentativas,
    tentativasRestantes: stats.tentativasRestantes
  });
  if (!economiaFinal) return;

  // A progressão e os desafios são benefícios de vitória legítima: um CHEAT
  // nunca avança dificuldade nem concede conquistas.
  dificuldadeAtual = vitoriaLegitima
    ? dificuldadeAposVitoria(config.dificuldade, progressaoAutomatica)
    : config.dificuldade;
  const desafios = vitoriaLegitima ? avaliarDesafios(stats) : [];
  const nomeDificuldade = NOMES_DIFICULDADE[config.dificuldade] || config.dificuldade;

  try {
    await registrarPartida({
      ...stats,
      modalidade: config.modalidade,
      cheat: config.cheat || 'normal',
      vitoria,
      desafios,
      layoutIndice: config.layoutIndice ?? null,
      economia: {
        moedasPares: economiaFinal.moedasPares,
        bonus: economiaFinal.bonus,
        total: economiaFinal.total,
        pontuacao: economiaFinal.pontuacao,
        elegivel,
        motivoInelegibilidade: economiaFinal.motivoInelegibilidade
      }
    });
  } catch (err) {
    console.warn('[cards] Falha ao registrar estatística:', err);
  }

  let saldoFinal = saldoMQAtual;
  try {
    const resultado = await liquidarSessaoMQ(economiaFinal);
    if (Number.isFinite(resultado?.saldo)) saldoFinal = resultado.saldo;
    if (resultado?.erro === 'duplicado') {
      console.warn('[cards] Liquidação duplicada bloqueada:', economiaFinal.sessionId);
    }
  } catch (err) {
    console.warn('[cards] Falha ao liquidar recompensa do Memory Quest:', err);
  }
  saldoMQAtual = saldoFinal;

  const economia = {
    ...economiaFinal,
    saldo: saldoMQAtual,
    multiplicadorAtual: rastreador.multiplicadorAtual
  };

  const linhas = [
    `Pares: ${economiaFinal.paresEncontrados}/${stats.totalPares}`,
    `Tentativas: ${stats.tentativas}`,
    `Erros: ${stats.erros}`,
    `Tempo: ${Math.floor(stats.tempoSegundos / 60)}m ${stats.tempoSegundos % 60}s`
  ];
  if (config.modalidade === 'tentativas') {
    linhas.push(`Modalidade: Tentativas · CHEAT: ${config.cheat || 'normal'}`);
    // `bonusSelfies` já contabiliza o total concedido (2 por par) e fica em 0
    // com CHEAT de infinitas, então não exibe um bônus numérico enganoso.
    if (stats.bonusSelfies > 0) {
      linhas.push(
        `Selfies: ${stats.selfiesPares} par(es) · +${stats.bonusSelfies} tentativas`
      );
    }
  }

  // "Nova partida" apenas consome o desfecho já processado acima: se houve
  // vitória com progressão, `dificuldadeAtual` já foi avançada uma única vez.
  const novaPartida = () => iniciarPartida();
  const sairDoResultado = () => {
    // Sem um resultado válido para a próxima rodada, volta à dificuldade
    // configurada em Configurações.
    dificuldadeAtual = dificuldadeInicial;
  };
  const botoes = [
    { id: 'rejogar', texto: 'Nova partida', classe: 'btn btn--arcade', acao: novaPartida },
    {
      id: 'selecao-modos',
      texto: 'Alterar configurações',
      classe: 'btn btn--text',
      acao: () => { sairDoResultado(); abrirMenu(); }
    },
    {
      id: 'home',
      texto: 'Voltar à coleção',
      classe: 'btn btn--text',
      acao: () => { sairDoResultado(); navegarPara('home'); }
    }
  ];

  renderer?.mostrarResultado({
    titulo: derrota ? 'FIM DAS TENTATIVAS' : 'DESAFIO CONCLUÍDO!',
    linhas,
    desafios,
    botoes,
    economia,
    modo: config.modo,
    dificuldade: nomeDificuldade,
    somVitoria: vitoria,
    // Som de fim já tocado por onPar/onErro; evita duplicação.
    tocarSom: false
  });
}

/** Persiste um patch de preferências sem interromper a partida em andamento. */
function persistir(patch) {
  salvarPreferenciasCartas(patch).catch((err) => {
    console.warn('[cards] Falha ao salvar preferências:', err);
  });
}

/** Abre um seletor de arquivo para substituir uma selfie existente. */
function escolherArquivo(substituir) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'cards__selfie-input';

  const remover = () => {
    input.removeEventListener('change', aoMudar);
    input.removeEventListener('cancel', remover);
    input.parentNode?.removeChild(input);
  };
  const aoMudar = () => {
    const arquivo = input.files?.[0];
    remover();
    if (arquivo) {
      renderer?.mostrarEditorSelfie({ arquivo, selfie: substituir, origem: 'galeria' });
    }
  };
  input.addEventListener('change', aoMudar);
  input.addEventListener('cancel', remover);
  // Safari/iOS exigem que o input esteja no DOM para abrir o seletor.
  document.body?.appendChild(input);
  input.click();
}

/** Recarrega a coleção e a lista de ativas após qualquer alteração. */
async function recarregarSelfies() {
  try {
    selfies = await listarSelfies();
  } catch (err) {
    erroSelfie(`Não foi possível carregar suas cartas: ${err?.message || 'erro desconhecido'}`);
    selfies = [];
  }
  const ids = new Set(selfies.map((selfie) => Number(selfie.id)));
  selfiesAtivasAtual = selfiesAtivasAtual.filter((id) => ids.has(Number(id)));
}

/**
 * Inicializa o jogo ao entrar na área #cards.
 */
async function init() {
  if (iniciado) return;
  root = document.getElementById('cards-board');
  if (!root) {
    console.warn('[cards] Elemento #cards-board não encontrado');
    return;
  }

  try {
    const preferencias = await obterPreferenciasCartas();
    dificuldadeInicial = normalizarDificuldadeCartas(preferencias.dificuldadeCartas);
    dificuldadeAtual = dificuldadeInicial;
    progressaoAutomatica = normalizarProgressaoAutomaticaCartas(
      preferencias.progressaoAutomaticaCartas
    );
    visualizacaoCartasAtual = normalizarVisualizacaoCartas(preferencias.visualizacaoCartas);
    tamanhoAmpliacaoAtual = normalizarTamanhoAmpliacao(preferencias.tamanhoAmpliacaoCartas);
    modalidadeAtual = normalizarModalidadeCartas(preferencias.modalidadeCartas);
    cheatAtual = {
      infinitas: preferencias.cheatInfinitasCartas === true,
      personalizada: preferencias.cheatPersonalizadaCartas === true,
      quantidade: normalizarQuantidadeCheat(preferencias.cheatQuantidadeCartas)
    };
    audioAtual = {
      fx: preferencias.fxCartasAtivo !== false,
      bgm: preferencias.bgmCartasAtiva !== false,
      volumeFx: normalizarVolumeCartas(preferencias.volumeFxCartas, VOLUME_FX_PADRAO),
      volumeBgm: normalizarVolumeCartas(preferencias.volumeBgmCartas, VOLUME_BGM_PADRAO)
    };
    selfiesAtivasAtual = Array.isArray(preferencias.selfiesAtivas)
      ? preferencias.selfiesAtivas.map(Number)
      : [];
  } catch (err) {
    console.warn('[cards] Falha ao carregar preferências das cartas:', err);
    dificuldadeInicial = normalizarDificuldadeCartas(undefined);
    dificuldadeAtual = dificuldadeInicial;
    progressaoAutomatica = normalizarProgressaoAutomaticaCartas(undefined);
    visualizacaoCartasAtual = VISUALIZACAO_PADRAO;
    tamanhoAmpliacaoAtual = TAMANHO_AMPLIACAO_PADRAO;
  }

  // Mudanças feitas no painel de Configurações chegam à partida em andamento
  // sem recriar o renderer: apenas a escala da face ampliada é atualizada.
  if (removerObservadorPreferencias) removerObservadorPreferencias();
  removerObservadorPreferencias = registrarObservadorPreferencias((preferencias) => {
    const novo = normalizarTamanhoAmpliacao(preferencias?.tamanhoAmpliacaoCartas);
    if (novo === tamanhoAmpliacaoAtual) return;
    tamanhoAmpliacaoAtual = novo;
    if (configAtual) configAtual.tamanhoAmpliacaoCartas = novo;
    renderer?.definirTamanhoAmpliacao(novo);
  });

  await recarregarSelfies();
  await recarregarSaldoMQ();

  renderer = criarRenderer(root, {
    onIniciar: () => iniciarPartida(),
    onVoltar: () => navegarPara('home'),
    onTrocarDificuldade: (chave) => {
      const normalizada = normalizarDificuldadeCartas(chave);
      if (!DIFICULDADES_CARTAS_EXPANDIDO[normalizada]) return;
      // Escolha manual define a dificuldade inicial persistida. O avanço por
      // vitória permanece transitório e nunca sobrescreve esta preferência.
      dificuldadeAtual = normalizada;
      dificuldadeInicial = normalizada;
      persistir({ dificuldadeCartas: normalizada });
      abrirMenu();
    },
    onAlternarProgressao: () => {
      progressaoAutomatica = !progressaoAutomatica;
      persistir({ progressaoAutomaticaCartas: progressaoAutomatica });
      abrirMenu();
    },
    onTrocarVisualizacaoCartas: (modo) => {
      visualizacaoCartasAtual = normalizarVisualizacaoCartas(modo);
      if (configAtual?.modo === 'expandido') {
        configAtual.visualizacaoCartas = visualizacaoCartasAtual;
      }
      renderer?.definirVisualizacaoCartas(visualizacaoCartasAtual);
      persistir({ visualizacaoCartas: visualizacaoCartasAtual });
      abrirMenu();
    },
    onAlterarTamanhoAmpliacao: (valor) => {
      const normalizado = normalizarTamanhoAmpliacao(valor);
      tamanhoAmpliacaoAtual = normalizado;
      if (configAtual) configAtual.tamanhoAmpliacaoCartas = normalizado;
      renderer?.definirTamanhoAmpliacao(normalizado);
      persistir({ tamanhoAmpliacaoCartas: normalizado });
    },
    onTrocarModalidade: (modalidade) => {
      modalidadeAtual = normalizarModalidadeCartas(modalidade);
      persistir({ modalidadeCartas: modalidadeAtual });
      abrirMenu();
    },
    onAlternarCheatInfinitas: () => {
      cheatAtual = { ...cheatAtual, infinitas: !cheatAtual.infinitas };
      if (cheatAtual.infinitas) sinalizarCheat('infinitas', { origem: 'menu' });
      persistir({ cheatInfinitasCartas: cheatAtual.infinitas });
      abrirMenu();
    },
    onAlternarCheatPersonalizada: () => {
      cheatAtual = { ...cheatAtual, personalizada: !cheatAtual.personalizada };
      if (cheatAtual.personalizada) sinalizarCheat('personalizada', { origem: 'menu' });
      persistir({ cheatPersonalizadaCartas: cheatAtual.personalizada });
      abrirMenu();
    },
    onAlterarQuantidadeCheat: (valor) => {
      cheatAtual = {
        ...cheatAtual,
        quantidade: normalizarQuantidadeCheat(valor)
      };
      if (cheatAtual.personalizada) {
        sinalizarCheat('personalizada', {
          origem: 'quantidade', quantidade: cheatAtual.quantidade
        });
      }
      persistir({ cheatQuantidadeCartas: cheatAtual.quantidade });
      abrirMenu();
    },
    onAlternarAudio: (chave, ativo) => {
      if (chave === 'fx') audioAtual = { ...audioAtual, fx: Boolean(ativo) };
      if (chave === 'bgm') audioAtual = { ...audioAtual, bgm: Boolean(ativo) };
      renderer?.definirAudio(audioAtual);
      persistir({ fxCartasAtivo: audioAtual.fx, bgmCartasAtiva: audioAtual.bgm });
    },
    onAlterarVolume: (chave, valor) => {
      const ehFx = chave === 'fx';
      const normalizado = normalizarVolumeCartas(
        valor,
        ehFx ? VOLUME_FX_PADRAO : VOLUME_BGM_PADRAO
      );
      audioAtual = ehFx
        ? { ...audioAtual, volumeFx: normalizado }
        : { ...audioAtual, volumeBgm: normalizado };
      // Aplica na hora; definirAudio não recria o intervalo da BGM ao mudar só volume.
      renderer?.definirAudio(audioAtual);
      persistir({ [ehFx ? 'volumeFxCartas' : 'volumeBgmCartas']: normalizado });
    },
    onAbrirSelfies: () => abrirMenu('selfies'),
    onVoltarSelfies: () => abrirMenu(),
    onNovaSelfie: ({ arquivo } = {}) => {
      renderer?.mostrarEditorSelfie({ arquivo });
    },
    onSubstituirSelfie: (selfie) => escolherArquivo(selfie),
    onSalvarSelfie: async ({ arquivo, nome, enquadramento, substituirId } = {}) => {
      const ajuste = normalizarEnquadramento(enquadramento);
      try {
        if (substituirId != null) {
          await substituirSelfie(substituirId, { arquivo, nome, enquadramento: ajuste });
        } else {
          const salva = await criarSelfie({ arquivo, nome, enquadramento: ajuste });
          selfiesAtivasAtual = [...selfiesAtivasAtual, Number(salva.id)];
        }
        persistir({ selfiesAtivas: selfiesAtivasAtual });
        await recarregarSelfies();
      } catch (err) {
        erroSelfie(`Não foi possível salvar a carta: ${err?.message || 'erro desconhecido'}`);
        return; // mantém o editor aberto para tentar novamente
      }
      abrirMenu('selfies');
    },
    onExcluirSelfie: async (id) => {
      try {
        await excluirSelfie(id);
      } catch (err) {
        erroSelfie(`Não foi possível excluir a carta: ${err?.message || 'erro desconhecido'}`);
        return;
      }
      selfiesAtivasAtual = selfiesAtivasAtual.filter((ativo) => Number(ativo) !== Number(id));
      persistir({ selfiesAtivas: selfiesAtivasAtual });
      await recarregarSelfies();
      abrirMenu('selfies');
    },
    onAlternarSelfie: async (id, ativa) => {
      try {
        const atualizada = await definirSelfieAtiva(id, ativa);
        if (atualizada) {
          selfies = selfies.map((item) => Number(item.id) === Number(id) ? atualizada : item);
        }
        selfiesAtivasAtual = ativa
          ? [...new Set([...selfiesAtivasAtual, Number(id)])]
          : selfiesAtivasAtual.filter((item) => Number(item) !== Number(id));
        persistir({ selfiesAtivas: selfiesAtivasAtual });
      } catch (err) {
        erroSelfie(`Não foi possível atualizar a carta: ${err?.message || 'erro desconhecido'}`);
        return;
      }
      abrirMenu('selfies');
    },
    onErroSelfie: (mensagem) => erroSelfie(mensagem),
    onSelecionar: (id) => {
      if (!sessao || emApresentacao) return;
      tratarEvento(sessao.selecionar(id));
    },
    onMenu: () => abrirMenu(),
    onReiniciar: () => iniciarPartida()
  });

  renderer.definirAudio(audioAtual);
  iniciado = true;
  await abrirMenu();
}

/**
 * Remove listeners, temporizadores e animações ao sair da área.
 */
function destroy() {
  encerrarSessao();
  renderer?.destruir();
  renderer = null;
  if (removerObservadorPreferencias) removerObservadorPreferencias();
  removerObservadorPreferencias = null;
  root = null;
  iniciado = false;
}

/**
 * Abre diretamente a galeria "Minhas Cartas" (usada pelo destino de navegação).
 * Reaproveita o init e o abrirMenu existentes: nenhum estado é duplicado.
 */
async function abrirGaleria() {
  if (!iniciado) await init();
  if (renderer) await abrirMenu('selfies');
}

export { init, destroy, abrirGaleria };
