/**
 * smb3-original.js — Adaptador de INTEGRAÇÃO LOCAL do jogo SMB3 original
 *
 * ⚠️ AVALIAÇÃO LOCAL / SEM PUBLICAÇÃO.
 * Este módulo executa efetivamente os arquivos do repositório:
 *   https://github.com/NavarroEmilioLuis/SMB3-Cards-Minigame
 * por meio de um iframe servido em `http://localhost:8771/index.html`.
 *
 * NENHUM arquivo original é copiado para este projeto nem modificado:
 * o código, os sprites, os áudios, os estilos, as animações, os layouts,
 * as regras e os controles executados são os do próprio repositório de origem.
 *
 * O repositório não possui licença declarada. Portanto esta integração é
 * restrita a avaliação local e NÃO deve ser publicada no GitHub Pages sem
 * autorização explícita dos titulares dos direitos.
 *
 * A camada abaixo apenas:
 *  - oferece a seleção de dificuldade já existente na Arcade Collection;
 *  - repassa a dificuldade como parâmetro externo na URL (o jogo original a
 *    ignora, pois não possui fase de memorização — ver DECISOES_TECNICAS.md);
 *  - fornece navegação de entrada/saída e registro de estatísticas sem
 *    interferir na execução do jogo.
 */

const URL_PADRAO = 'http://localhost:8771/index.html';

// Dimensões do jogo original. O viewport interno do iframe deve permanecer
// com esses valores: o CSS original fixa `body { width: 514px }`. Em telas
// menores, a camada adaptadora escala o iframe inteiro (sem tocar no jogo).
const LARGURA_ORIGINAL = 514;
const ALTURA_ORIGINAL = 409;

/** URL base do jogo original, sobrescrevível apenas em ambiente local. */
export function urlBaseSmb3Original() {
  const externa = typeof globalThis !== 'undefined'
    ? globalThis.__SMB3_ORIGINAL_URL__
    : null;
  return typeof externa === 'string' && externa.trim() ? externa.trim() : URL_PADRAO;
}

/** Monta a URL com o parâmetro de dificuldade (configuração externa). */
export function construirUrlSmb3Original(dificuldade = 'normal') {
  const base = urlBaseSmb3Original();
  const separador = base.includes('?') ? '&' : '?';
  return `${base}${separador}dificuldade=${encodeURIComponent(dificuldade)}`;
}

/**
 * Cria a camada adaptadora sobre o jogo original.
 * @param {HTMLElement} root - elemento #cards-board
 * @param {{onSair?: function, onOver?: function}} callbacks
 */
export function criarAdaptadorSmb3Original(root, callbacks = {}) {
  let iframe = null;
  let enquadramento = null;
  let observadorEscala = null;
  let listenerRedimensionamento = null;
  let barra = null;
  let dificuldadeAtual = 'normal';
  const listenerMensagem = (evento) => {
    if (evento.source !== iframe?.contentWindow) return;
    callbacks.onEvento?.(evento.data);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', listenerMensagem);
  }

  function criarElemento(tag, classe, texto) {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined && texto !== null) no.textContent = texto;
    return no;
  }

  function criarBotao(texto, classe, acao) {
    const btn = criarElemento('button', classe, texto);
    btn.type = 'button';
    btn.addEventListener('click', acao);
    return btn;
  }

  function registrarSaida() {
    callbacks.onSair?.({
      dificuldade: dificuldadeAtual,
      concluida: false,
      vitoria: false
    });
  }

  /** Escala o iframe preservando o viewport original de 514 × 409 px. */
  function aplicarEscala() {
    if (!iframe || !enquadramento) return;
    const disponivel = enquadramento.clientWidth || LARGURA_ORIGINAL;
    const escala = Math.min(1, disponivel / LARGURA_ORIGINAL);
    iframe.style.transform = `translateX(-50%) scale(${escala})`;
    enquadramento.style.height = `${ALTURA_ORIGINAL * escala}px`;
  }

  function observarEscala() {
    if (typeof ResizeObserver === 'function' && enquadramento) {
      observadorEscala = new ResizeObserver(aplicarEscala);
      observadorEscala.observe(enquadramento);
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      listenerRedimensionamento = aplicarEscala;
      window.addEventListener('resize', listenerRedimensionamento);
    }
    aplicarEscala();
  }

  function mostrar({ dificuldade = 'normal', titulo = 'SMB3 · jogo original' } = {}) {
    if (!root) return;
    dificuldadeAtual = dificuldade;
    root.replaceChildren();

    const canvas = criarElemento('section', 'cards__smb3-original');
    canvas.dataset.modo = 'classico';
    canvas.dataset.origem = 'repositorio-original';

    barra = criarElemento('div', 'cards__smb3-barra');
    barra.appendChild(criarElemento('span', 'cards__badge cards__badge--classico', 'MODO SMB3'));
    barra.appendChild(criarElemento('span', 'cards__smb3-titulo', titulo));
    barra.appendChild(criarElemento('span', 'cards__smb3-dif', `Dificuldade: ${dificuldade}`));

    const botoes = criarElemento('div', 'cards__smb3-acoes');
    botoes.appendChild(criarBotao('Reiniciar jogo original', 'btn btn--text', () => {
      if (iframe) iframe.setAttribute('src', construirUrlSmb3Original(dificuldadeAtual));
    }));
    botoes.appendChild(criarBotao('Trocar modo', 'btn btn--text', () => {
      registrarSaida();
      callbacks.onTrocarModo?.();
    }));
    botoes.appendChild(criarBotao('← Voltar à coleção', 'btn btn--text', () => {
      registrarSaida();
      callbacks.onVoltar?.();
    }));
    barra.appendChild(botoes);
    canvas.appendChild(barra);

    enquadramento = criarElemento('div', 'cards__smb3-enquadramento');
    iframe = document.createElement('iframe');
    iframe.className = 'cards__smb3-frame';
    iframe.title = 'N-Mark Spade Panel — jogo original (integração local)';
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('src', construirUrlSmb3Original(dificuldade));
    enquadramento.appendChild(iframe);
    canvas.appendChild(enquadramento);
    observarEscala();

    const aviso = criarElemento('p', 'cards__smb3-aviso',
      'Integração local de avaliação: este é o jogo original, servido a partir do repositório de referência. Não publicar sem autorização de licença.');
    canvas.appendChild(aviso);

    root.appendChild(canvas);
  }

  function destruir() {
    observadorEscala?.disconnect?.();
    observadorEscala = null;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', listenerMensagem);
      if (listenerRedimensionamento) {
        window.removeEventListener('resize', listenerRedimensionamento);
      }
    }
    if (root) root.replaceChildren();
    iframe = null;
    enquadramento = null;
    listenerRedimensionamento = null;
    barra = null;
  }

  return {
    mostrar,
    destruir,
    registrarSaida,
    get ativo() { return Boolean(iframe); },
    get url() { return iframe?.src || null; }
  };
}
