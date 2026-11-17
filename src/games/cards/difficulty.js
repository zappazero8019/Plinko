/**
 * games/cards/difficulty.js — Configurações de dificuldade do Card Match (Alpha)
 *
 * Modo expandido apenas (o modo clássico terá suas próprias regras, estudadas
 * a partir do repositório de referência, sem redistribuir assets protegidos).
 */

export const DIFICULDADES_CARTAS_EXPANDIDO = {
  facil: {
    label: 'Fácil',
    cartas: 18,
    pares: 9
  },
  normal: {
    label: 'Normal',
    cartas: 30,
    pares: 15
  },
  dificil: {
    label: 'Difícil',
    cartas: 48,
    pares: 24
  },
  muitodificil: {
    label: 'Muito Difícil',
    cartas: 72,
    pares: 36
  },
  extremo: {
    label: 'Extremo',
    cartas: 100,
    pares: 50
  }
};

export function getDificuldadeCartas(chave) {
  return DIFICULDADES_CARTAS_EXPANDIDO[chave] || DIFICULDADES_CARTAS_EXPANDIDO.normal;
}
