/**
 * games/plinko/rewards.js — Cálculo de recompensas do Plinko (Alpha)
 *
 * Stub: valida multiplicador e calcula prêmio. O processamento financeiro
 * é feito pelo core/wallet (addCoins / debitCoins).
 */

import { validarRecompensa } from '../../core/wallet.js';

export function calcularPremio(aposta, multiplicador) {
  if (!Number.isFinite(aposta) || aposta <= 0) {
    return { valido: false, motivo: 'aposta_invalida' };
  }
  if (!Number.isFinite(multiplicador) || multiplicador < 0) {
    return { valido: false, motivo: 'multiplicador_invalido' };
  }

  const premio = Math.floor(aposta * multiplicador);
  const validacao = validarRecompensa(premio, 'plinko');
  if (!validacao.valido) {
    return { valido: false, motivo: validacao.motivo };
  }

  return { valido: true, aposta, multiplicador, premio };
}
