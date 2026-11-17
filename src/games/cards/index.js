/**
 * games/cards/index.js — Integração e ciclo de vida do Card Match
 *
 * Responsabilidades:
 *  - montar a configuração do Jogo da Memória: dificuldade, modalidade, CHEAT,
 *    áudio e galeria de selfies;
 *  - conduzir o fluxo do Jogo da Memória: configuração → partida → resultado;
 *  - criar/destruir sessão, listeners e temporizadores ao entrar/sair;
 *  - persistir estatísticas e preferências via serviços centrais;
 *  - NENHUMA operação financeira: sem aposta, sem prêmio, sem IndexedDB direto.
 */

import {
  criarConfigExpandida,
  proximaDificuldade,
  avaliarDesafios
} from './expanded.js';
import { criarSessao } from './board.js';
import { criarRenderer } from './renderer.js';
import {
  DIFICULDADES_CARTAS_EXPANDIDO,
  PROGRESSAO_CARTAS
} from './difficulty.js';
import {
  calcularTentativasIniciais
} from './tentativas.js';
import {
  registrarPartida,
  obterEstatisticas
} from '../../core/game-stats.js';
import {
  obterPreferenciasCartas,
  salvarPreferenciasCartas,
  normalizarVisualizacaoCartas,
  normalizarModalidadeCartas,
  normalizarQuantidadeCheat,
  normalizarVolumeCartas,
  VISUALIZACAO_PADRAO,
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
let dificuldadeAtual = 'normal';
let progressaoAutomatica = true;
let visualizacaoCartasAtual = VISUALIZACAO_PADRAO;
let modalidadeAtual = 'pontuacao';
let cheatAtual = { infinitas: false, personalizada: false, quantidade: 20 };
let audioAtual = { fx: true, bgm: true };
let selfies = [];
let selfiesAtivasAtual = [];
let animFrame = null;
let timerApresentacao = null;
let emApresentacao = false;

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

function limparApresentacao() {
  if (timerApresentacao !== null && typeof clearTimeout === 'function') {
    clearTimeout(timerApresentacao);
  }
  timerApresentacao = null;
  emApresentacao = false;
}

function encerrarSessao() {
  pararLoop();
  limparApresentacao();
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
    estatisticas = await obterEstatisticas();
  } catch (err) {
    console.warn('[cards] Não foi possível carregar estatísticas:', err);
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
    modalidade: modalidadeAtual,
    cheat: cheatAtual,
    audioPreferencias: audioAtual,
    selfies,
    selfiesAtivas: selfiesAtivasAtual,
    foco
  });
}

function selfiesSelecionadas() {
  const ativas = new Set(selfiesAtivasAtual.map(Number));
  return selfies.filter((selfie) => ativas.has(Number(selfie.id)));
}

function configuracaoAtual() {
  // A preferência visual e o CHEAT entram na configuração da partida; nenhuma
  // regra de comparação, tempo ou desafio é alterada. A distribuição de selfies
  // acontece aqui, apenas quando uma nova partida é criada.
  const calculo = calcularTentativasIniciais(dificuldadeAtual, cheatAtual);
  return {
    ...criarConfigExpandida(dificuldadeAtual, Math.random, {
      selfies: selfiesSelecionadas(),
      modalidade: modalidadeAtual,
      cheat: calculo
    }),
    visualizacaoCartas: visualizacaoCartasAtual
  };
}

function tratarEvento(resultado) {
  if (!renderer || !configAtual || !sessao) return;

  renderer.atualizar(sessao.estado(), configAtual, sessao.tempoDecorrido());

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

function mostrarTabuleiro(config) {
  if (!renderer || !sessao) return;
  emApresentacao = false;
  renderer.mostrarPartida(config, sessao.estado());
  renderer.feedback('Selecione duas cartas');

  if (config.modo === 'expandido' && typeof requestAnimationFrame === 'function') {
    const loop = () => {
      if (!sessao || sessao.destruida) return;
      renderer?.atualizar(sessao.estado(), configAtual, sessao.tempoDecorrido());
      animFrame = requestAnimationFrame(loop);
    };
    animFrame = requestAnimationFrame(loop);
  }
}

function iniciarPartida() {
  if (!renderer) return;
  encerrarSessao();

  const config = configuracaoAtual();
  configAtual = config;
  renderer.definirAudio(audioAtual);

  sessao = criarSessao(config, {
    callbacks: {
      onRevelado: tratarEvento,
      onComparacao: tratarEvento,
      onBloqueado: tratarEvento,
      onPar: (resultado) => {
        somPar(resultado);
        tratarEvento(resultado);
      },
      onErro: (resultado) => {
        renderer?.som('nomatch');
        tratarEvento(resultado);
      },
      onEsgotado: () => finalizarPartida({ derrota: true }),
      onConcluido: () => finalizarPartida()
    }
  });

  mostrarTabuleiro(config);
}

async function finalizarPartida({ derrota = false } = {}) {
  if (!sessao || !configAtual) return;

  pararLoop();
  renderer?.cancelarAmpliacao();
  const config = configAtual;
  const stats = sessao.estatisticas();
  const vitoria = !derrota;
  const desafios = vitoria ? avaliarDesafios(stats) : [];
  const nomeDificuldade = NOMES_DIFICULDADE[config.dificuldade] || config.dificuldade;

  try {
    await registrarPartida({
      ...stats,
      modalidade: config.modalidade,
      cheat: config.cheat || 'normal',
      vitoria,
      desafios,
      layoutIndice: config.layoutIndice ?? null
    });
  } catch (err) {
    console.warn('[cards] Falha ao registrar estatística:', err);
  }

  const linhas = [
    `Pares: ${stats.paresEncontrados}/${stats.totalPares}`,
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

  const proxima = () => {
    if (progressaoAutomatica) dificuldadeAtual = proximaDificuldade(dificuldadeAtual);
    iniciarPartida();
  };
  const botoes = [
    { id: 'rejogar', texto: 'Nova partida', classe: 'btn btn--arcade', acao: proxima },
    {
      id: 'selecao-modos',
      texto: 'Alterar configurações',
      classe: 'btn btn--text',
      acao: () => abrirMenu()
    },
    {
      id: 'home',
      texto: 'Voltar à coleção',
      classe: 'btn btn--text',
      acao: () => navegarPara('home')
    }
  ];

  renderer?.mostrarResultado({
    titulo: derrota ? 'FIM DAS TENTATIVAS' : 'DESAFIO CONCLUÍDO!',
    linhas,
    desafios,
    botoes,
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
    visualizacaoCartasAtual = normalizarVisualizacaoCartas(preferencias.visualizacaoCartas);
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
    visualizacaoCartasAtual = VISUALIZACAO_PADRAO;
  }
  await recarregarSelfies();

  renderer = criarRenderer(root, {
    onIniciar: () => iniciarPartida(),
    onVoltar: () => navegarPara('home'),
    onTrocarDificuldade: (chave) => {
      if (DIFICULDADES_CARTAS_EXPANDIDO[chave]) dificuldadeAtual = chave;
      abrirMenu();
    },
    onAlternarProgressao: () => {
      progressaoAutomatica = !progressaoAutomatica;
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
    onTrocarModalidade: (modalidade) => {
      modalidadeAtual = normalizarModalidadeCartas(modalidade);
      persistir({ modalidadeCartas: modalidadeAtual });
      abrirMenu();
    },
    onAlternarCheatInfinitas: () => {
      cheatAtual = { ...cheatAtual, infinitas: !cheatAtual.infinitas };
      persistir({ cheatInfinitasCartas: cheatAtual.infinitas });
      abrirMenu();
    },
    onAlternarCheatPersonalizada: () => {
      cheatAtual = { ...cheatAtual, personalizada: !cheatAtual.personalizada };
      persistir({ cheatPersonalizadaCartas: cheatAtual.personalizada });
      abrirMenu();
    },
    onAlterarQuantidadeCheat: (valor) => {
      cheatAtual = {
        ...cheatAtual,
        quantidade: normalizarQuantidadeCheat(valor)
      };
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
