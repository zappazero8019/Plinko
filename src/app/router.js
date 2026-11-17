/**
 * router.js — Navegação sem recarregar a página (Single Page Application leve)
 *
 * Gerencia as áreas do Memory Quest, mantendo a carteira visível e o estado
 * preservado. As áreas legadas (`plinko` e `shop`) continuam válidas por hash,
 * mas não aparecem na navegação principal. Não altera saldo nem progresso.
 */

const AREAS_VALIDAS = ['home', 'plinko', 'cards', 'shop', 'profile', 'settings', 'stats'];

let areaAtual = 'home';
let focoAtual = null;
let onAreaChange = null;

/**
 * Inicializa o router: lê o hash inicial e configura listeners dos links de navegação.
 * @param {function(nomeArea: string, areaAnterior: string, foco: string|null)} callback
 */
function init(callback) {
  onAreaChange = callback;

  // Navegação via clique nos links da barra inferior / atalhos da home.
  // `data-foco` permite que dois destinos para a mesma área tenham destaque próprio
  // (ex.: Jogar e Minhas Cartas, ambos em #cards).
  document.querySelectorAll('[data-area]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const alvo = event.currentTarget.dataset.area;
      if (alvo && AREAS_VALIDAS.includes(alvo)) {
        event.preventDefault();
        navegarPara(alvo, false, event.currentTarget.dataset.foco || null);
      }
    });
  });

  // Navegação via hashchange (botão voltar/avante do navegador)
  window.addEventListener('hashchange', () => {
    const alvo = hashParaArea(location.hash);
    if (alvo && alvo !== areaAtual) {
      irPara(alvo, false, null); // não sobrescreve hash se vier do navegador
    }
  });

  // Área inicial
  const inicial = hashParaArea(location.hash) || 'home';
  irPara(inicial, true, null);
}

/**
 * Converte um hash (#plinko) em nome de área.
 */
function hashParaArea(hash) {
  if (!hash) return 'home';
  const limpo = hash.replace(/^#/, '');
  return AREAS_VALIDAS.includes(limpo) ? limpo : null;
}

/**
 * Navega para uma área, atualizando hash e DOM.
 * @param {string} area
 * @param {boolean} substituirHash - se true, usa replaceState (não entra no histórico)
 * @param {string|null} foco - destaque intra-área (ex.: 'selfies')
 */
function navegarPara(area, substituirHash = false, foco = null) {
  if (!AREAS_VALIDAS.includes(area)) {
    console.warn(`[router] Área inválida: ${area}`);
    return;
  }
  if (area === areaAtual && foco === focoAtual) {
    return;
  }

  irPara(area, substituirHash, foco);
}

/**
 * Lógica central de troca de área.
 */
function irPara(area, substituirHash, foco) {
  const anterior = areaAtual;
  areaAtual = area;
  focoAtual = foco || null;

  // Atualiza URL sem recarregar
  if (substituirHash) {
    history.replaceState(null, null, `#${area}`);
  } else {
    history.pushState(null, null, `#${area}`);
  }

  // Atualiza classes de ativação nos links da nav
  document.querySelectorAll('[data-area]').forEach((link) => {
    const mesmoFoco = (link.dataset.foco || null) === focoAtual;
    const ativo = link.dataset.area === area && mesmoFoco;
    link.classList.toggle('nav__item--active', ativo);
    if (link.classList?.contains?.('nav__item')) {
      link.setAttribute('aria-current', ativo ? 'true' : 'false');
    }
  });

  // Mostra/esconde áreas
  document.querySelectorAll('.area').forEach((el) => {
    const ativo = el.id === `area-${area}`;
    el.classList.toggle('area--active', ativo);
    el.classList.toggle('hidden', !ativo);
    if (ativo) {
      el.removeAttribute('aria-hidden');
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
  });

  if (typeof onAreaChange === 'function') {
    onAreaChange(area, anterior, focoAtual);
  }
}

/**
 * Retorna a área atual.
 */
function getAreaAtual() {
  return areaAtual;
}

/**
 * Retorna o foco intra-área atual (ou null).
 */
function getFocoAtual() {
  return focoAtual;
}

export { init, navegarPara, getAreaAtual, getFocoAtual, hashParaArea };
