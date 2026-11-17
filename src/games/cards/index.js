/**
 * games/cards/index.js — Stub do jogo Card Match (Alpha)
 *
 * Apenas tela inicial e integração com a carteira. Os modos clássico e
 * expandido serão implementados na próxima etapa.
 *
 * Este módulo NÃO manipula o banco nem o saldo diretamente.
 */

const boardEl = document.getElementById('cards-board');

function render() {
  if (!boardEl) return;
  boardEl.innerHTML = `
    <div class="plinko-stub__content">
      <h3 style="margin:0 0 0.5rem;color:#ff3e6b">🃏 Card Match — Em desenvolvimento</h3>
      <p style="color:#9a9ab8;font-size:0.9rem;max-width:300px;margin:0 auto 1rem;">
        Modo clássico e modo expandido (18, 30, 48, 72, 100 cartas) em desenvolvimento.<br/>
        Embaralhamento, revelação, pares, cronômetro opcional e pontuação.
      </p>
      <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
        <button id="cards-btn-demo" class="btn btn--arcade">Simular partida (demo)</button>
      </div>
      <div id="cards-saldo" style="margin-top:1rem;font-family:'Pixel',monospace;color:#4ade80"></div>
    </div>
  `;

  const btnDemo = boardEl.querySelector('#cards-btn-demo');
  const saldoEl = boardEl.querySelector('#cards-saldo');

  async function atualizarSaldo() {
    const { getSaldo } = await import('../../core/wallet.js');
    const saldo = await getSaldo();
    if (saldoEl) saldoEl.textContent = `Saldo: ${saldo} 🪙`;
  }

  if (btnDemo) {
    btnDemo.addEventListener('click', async () => {
      const custo = 2;
      const { getSaldo, debitCoins, addCoins } = await import('../../core/wallet.js');
      const saldoAtual = await getSaldo();
      if (saldoAtual < custo) {
        alert('Saldo insuficiente para a demo.');
        return;
      }

      await debitCoins(custo, { origem: 'cards', descricao: 'Partida Card Match (demo)', jogo: 'cards' });

      const premio = 4;
      await addCoins(premio, {
        origem: 'cards',
        descricao: 'Prêmio Card Match (demo)',
        jogo: 'cards',
        idempotencyKey: `cards_demo_${Date.now()}`
      });

      await atualizarSaldo();
      alert(`Card Match demo: você ganhou ${premio} moedas`);
    });
  }

  atualizarSaldo();
}

export { render };
