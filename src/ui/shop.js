/**
 * shop.js — Loja de habilidades do Memory Quest (Fase 1)
 *
 * Uma única habilidade: Visão total, por 100 moedas MQ por uso. O saldo e o
 * inventário exibidos vêm de `mqWallet`; a carteira legada do Plinko não
 * participa desta tela. O ícone é o arquivo original de `assets/icons`,
 * reutilizado sem cópia, substituição ou transformação.
 */

import { obterEstadoMQ, registrarObservadorCarteiraMQ } from '../core/mq-economy.js';
import {
  ITEM_VISAO_TOTAL,
  PRECO_VISAO_TOTAL,
  comprarVisaoTotal,
  criarChaveOperacaoCompra
} from '../core/mq-shop.js';
import { mostrarToast } from './components.js';

let rootAtivo = null;
let removerObservador = null;
let pendente = false;
let nos = null;

function el(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto != null) no.textContent = texto;
  return no;
}

/** Atualiza saldo e estoque sem recriar o DOM (mantém o botão e seus estados). */
async function atualizarValores() {
  if (!rootAtivo || !nos) return;
  try {
    const estado = await obterEstadoMQ();
    const saldo = estado.saldo;
    const estoque = estado.habilidades.visaoTotal;

    nos.saldo.textContent = `${saldo} 🪙`;
    nos.saldo.dataset.saldoMq = String(saldo);
    if (nos.saldoGlobal) {
      nos.saldoGlobal.textContent = `${saldo} 🪙`;
      nos.saldoGlobal.dataset.saldoMq = String(saldo);
    }
    nos.estoque.textContent = `${estoque} ${estoque === 1 ? 'uso' : 'usos'}`;
    nos.estoque.dataset.estoqueVisaoTotal = String(estoque);

    nos.botao.disabled = pendente || saldo < PRECO_VISAO_TOTAL;
    if (pendente) {
      nos.estado.textContent = 'Processando compra…';
    } else if (saldo < PRECO_VISAO_TOTAL) {
      nos.estado.textContent = `Faltam ${PRECO_VISAO_TOTAL - saldo} moedas para o próximo uso`;
    } else {
      nos.estado.textContent = 'Disponível para compra';
    }
  } catch (err) {
    console.warn('[loja] Falha ao carregar saldo/estoque:', err);
    if (nos) nos.estado.textContent = 'Não foi possível carregar a carteira MQ.';
  }
}

function criarHabilidade() {
  const card = el('article', 'shop-item shop-ability');

  const img = document.createElement('img');
  img.className = 'shop-ability__icone';
  img.setAttribute('src', ITEM_VISAO_TOTAL.icone);
  img.setAttribute('alt', `Ícone da habilidade ${ITEM_VISAO_TOTAL.nome}`);
  img.setAttribute('width', '6400');
  img.setAttribute('height', '6400');
  img.setAttribute('decoding', 'async');
  card.appendChild(img);

  card.appendChild(el('h3', 'shop-item__nome', ITEM_VISAO_TOTAL.nome));
  card.appendChild(el('p', 'shop-ability__descricao', ITEM_VISAO_TOTAL.descricao));

  const preco = el('p', 'shop-item__preco', `${PRECO_VISAO_TOTAL} 🪙 por uso`);
  card.appendChild(preco);

  const linhas = el('div', 'shop-ability__linhas');
  const saldo = el('strong', 'shop-ability__saldo', '0 🪙');
  const estoque = el('strong', 'shop-ability__estoque', '0 usos');
  saldo.dataset.saldoMq = '0';
  estoque.dataset.estoqueVisaoTotal = '0';
  for (const [rotulo, valor] of [
    ['Saldo MQ disponível', saldo],
    ['Usos em estoque', estoque]
  ]) {
    const linha = el('div', 'shop-ability__linha');
    linha.appendChild(el('span', 'shop-ability__rotulo', rotulo));
    linha.appendChild(valor);
    linhas.appendChild(linha);
  }
  card.appendChild(linhas);

  const botao = el('button', 'shop-item__btn btn btn--arcade', 'Comprar');
  botao.type = 'button';
  botao.setAttribute('aria-label', `Comprar um uso de ${ITEM_VISAO_TOTAL.nome} por ${PRECO_VISAO_TOTAL} moedas`);
  const estado = el('p', 'shop-ability__estado', '');
  estado.setAttribute('role', 'status');

  botao.addEventListener('click', async () => {
    // Trava imediata de UI; a idempotência real está na camada de dados.
    if (pendente) return;
    pendente = true;
    botao.disabled = true;
    estado.textContent = 'Processando compra…';

    // Uma chave por intenção de compra. Reutilizar a mesma chave em retries da
    // MESMA operação não debita duas vezes; um novo clique gera outra chave.
    const chave = criarChaveOperacaoCompra();
    try {
      const resultado = await comprarVisaoTotal(chave);
      if (resultado?.ok) {
        mostrarToast(resultado.duplicado
          ? 'Compra já registrada. Nenhuma cobrança adicional.'
          : `${ITEM_VISAO_TOTAL.nome}: +1 uso adquirido!`);
      } else if (resultado?.erro === 'saldo_insuficiente') {
        mostrarToast(`Saldo insuficiente: faltam ${PRECO_VISAO_TOTAL - resultado.saldo} moedas MQ.`);
      } else {
        mostrarToast('Não foi possível concluir a compra.');
      }
    } catch (err) {
      console.warn('[loja] Falha na compra:', err);
      mostrarToast('Não foi possível concluir a compra.');
    } finally {
      pendente = false;
      await atualizarValores();
    }
  });

  card.appendChild(botao);
  card.appendChild(estado);
  return { card, nos: { saldo, estoque, botao, estado } };
}

/** Renderiza a loja e passa a observar a carteira MQ enquanto estiver ativa. */
export async function renderizarLoja(root) {
  if (!root) return null;
  destruirLoja();
  rootAtivo = root;
  pendente = false;
  root.replaceChildren();

  const cabecalho = el('header', 'shop__cabecalho');
  cabecalho.appendChild(el('h3', 'cards__titulo', 'LOJA DE HABILIDADES'));
  const saldoGlobal = el('span', 'shop__saldo', '0 🪙');
  saldoGlobal.dataset.saldoMq = '0';
  cabecalho.appendChild(saldoGlobal);
  root.appendChild(cabecalho);

  root.appendChild(el('p', 'shop__dica',
    'As moedas vêm das partidas concluídas do Memory Quest. ' +
    'Cada compra adiciona um uso de Visão total ao seu inventário, que permanece entre partidas.'));

  const grade = el('div', 'shop__grade');
  const { card, nos: referencias } = criarHabilidade();
  grade.appendChild(card);
  root.appendChild(grade);

  nos = { ...referencias, saldoGlobal };
  removerObservador = registrarObservadorCarteiraMQ(() => { atualizarValores(); });
  await atualizarValores();
  return root;
}

/** Cancela a assinatura ao sair da loja. */
export function destruirLoja() {
  if (removerObservador) {
    removerObservador();
    removerObservador = null;
  }
  rootAtivo = null;
  nos = null;
  pendente = false;
}
