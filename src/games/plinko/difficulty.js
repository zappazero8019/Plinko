/**
 * games/plinko/difficulty.js — Configurações de dificuldade do Plinko (Alpha)
 *
 * Valores independentes do motor físico. Serão consumidos pelo renderer e
 * pela física na próxima etapa.
 */

export const DIFICULDADES_PLINKO = {
  facil: {
    label: 'Fácil',
    fileiras: 8,
    multiplicadores: [0.2, 0.5, 1, 2, 5, 10, 5, 2, 1, 0.5, 0.2]
  },
  normal: {
    label: 'Normal',
    fileiras: 12,
    multiplicadores: [0.1, 0.3, 0.7, 1.5, 3, 8, 20, 8, 3, 1.5, 0.7, 0.3, 0.1]
  },
  dificil: {
    label: 'Difícil',
    fileiras: 14,
    multiplicadores: [0.05, 0.2, 0.5, 1, 2, 5, 12, 50, 12, 5, 2, 1, 0.5, 0.2, 0.05]
  },
  extremo: {
    label: 'Extremo',
    fileiras: 16,
    multiplicadores: [0.02, 0.1, 0.3, 0.7, 1.5, 3, 7, 25, 100, 25, 7, 3, 1.5, 0.7, 0.3, 0.1, 0.02]
  }
};

export function getDificuldadePlinko(chave) {
  return DIFICULDADES_PLINKO[chave] || DIFICULDADES_PLINKO.normal;
}
