/**
 * router.js — Navegação sem recarregar a página (Single Page Application leve)
 *
 * Gerencia a troca entre as cinco áreas (Início, Plinko, Cartas, Loja, Perfil),
 * mantendo a carteira visível e o estado preservado. Não altera saldo nem progresso.
 */

const AREAS_VALIDAS = ['home', 'plinko', 'cards', 'shop', 'profile'];

let areaAtual = 'home';
let onAreaChange = null;

/**
 * Inicializa o router: lê o hash inicial e configura listeners dos links de navegação.
 * @param {function(nomeArea: string)} callback - chamado quando a área muda
 */
function init(callback) {
  onAreaChange = callback;

  // Navegação via clique nos links da barra inferior
  document.querySelectorAll('.nav__item').forEach((link) => {
    link.addEventListener('click', (event) => {
      const alvo = event.currentTarget.dataset.area;
      if (alvo && AREAS_VALIDAS.includes(alvo)) {
        event.preventDefault();
        navegarPara(alvo);
      }
    });
  });

  // Navegação via hashchange (botão voltar/avante do navegador)
  window.addEventListener('hashchange', () => {
    const alvo = hashParaArea(location.hash);
    if (alvo && alvo !== areaAtual) {
      irPara(alvo, false); // não sobrescreve hash se vier do navegador
    }
  });

  // Área inicial
  const inicial = hashParaArea(location.hash) || 'home';
  irPara(inicial, true);
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
 */
function navegarPara(area, substituirHash = false) {
  if (!AREAS_VALIDAS.includes(area)) {
    console.warn(`[router] Área inválida: ${area}`);
    return;
  }
  if (area === areaAtual) {
    return;
  }

  irPara(area, substituirHash);
}

/**
 * Lógica central de troca de área.
 */
function irPara(area, substituirHash) {
  const anterior = areaAtual;
  areaAtual = area;

  // Atualiza URL sem recarregar
  if (substituirHash) {
    history.replaceState(null, null, `#${area}`);
  } else {
    history.pushState(null, null, `#${area}`);
  }

  // Atualiza classes de ativação nos links da nav
  document.querySelectorAll('.nav__item').forEach((link) => {
    const ativo = link.dataset.area === area;
    link.classList.toggle('nav__item--active', ativo);
    link.setAttribute('aria-current', ativo ? 'true' : 'false');
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
    onAreaChange(area, anterior);
  }
}

/**
 * Retorna a área atual.
 */
function getAreaAtual() {
  return areaAtual;
}

export { init, navegarPara, getAreaAtual, hashParaArea };
