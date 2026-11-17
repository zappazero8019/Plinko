/**
 * src/ui/components.js — Componentes de UI compartilhados (Alpha)
 *
 * Helpers para toasts, modais de confirmação e cartões de loja/inventário.
 * Estes componentes ainda não estão conectados a dados reais; servem como
 * estrutura para a próxima etapa.
 */

/**
 * Exibe um toast na tela.
 */
export function mostrarToast(mensagem, duracao = 3000) {
  const template = document.getElementById('toast-template');
  if (!template) return;
  const clone = template.content.cloneNode(true);
  const toast = clone.firstElementChild;
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  // Força reflow para a animação funcionar
  toast.offsetHeight;
  toast.style.opacity = '1';
  toast.style.transform = 'translate(-50%, 0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duracao);
}

/**
 * Modal de confirmação simples (retorna promise).
 */
export function confirmar(mensagem) {
  return new Promise((resolve) => {
    const ok = confirm(mensagem);
    resolve(ok);
  });
}

/**
 * Renderiza um card de item da loja (estrutura para próxima etapa).
 * @param {object} item { id, nome, categoria, raridade, preco, adquirido }
 */
export function criarCardLoja(item) {
  const card = document.createElement('div');
  card.className = 'shop-item';
  card.innerHTML = `
    <div class="shop-item__raridade" style="color:${raridadeCor(item.raridade)}">
      ${item.raridade}
    </div>
    <div class="shop-item__nome">${item.nome}</div>
    <div class="shop-item__preco">${item.preco} 🪙</div>
    <button class="shop-item__btn btn btn--arcade" ${item.adquirido ? 'disabled' : ''}>
      ${item.adquirido ? 'Adquirido' : 'Comprar'}
    </button>
  `;
  return card;
}

function raridadeCor(raridade) {
  const cores = {
    comum: '#4ade80',
    raro: '#3b82f6',
    lendario: '#a855f7'
  };
  return cores[raridade] || '#9a9ab8';
}
