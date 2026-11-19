/**
 * games/cards/difficulty.js — Configurações de dificuldade do Card Match
 *
 * Existem DOIS conjuntos INDEPENDENTES:
 *  - SMB3 (modo clássico): 3 níveis que alteram SOMENTE o tempo de
 *    memorização da apresentação inicial;
 *  - Expandido: 5 níveis que alteram cartas, pares, tempo alvo e desafios.
 *
 * Nenhuma dificuldade SMB3 modifica quantidade de cartas, símbolos ou layouts.
 * Nomes de exportação antigos são preservados para compatibilidade com a
 * suíte de testes existente.
 */

/** Ordem de progressão automática do modo expandido. */
export const PROGRESSAO_CARTAS = Object.freeze([
  'facil',
  'normal',
  'dificil',
  'muitodificil',
  'extremo'
]);

/**
 * Tempos obrigatórios da prévia das cartas, por dificuldade.
 * A prévia é parte da apresentação e NUNCA entra no cronômetro oficial.
 */
export const TEMPOS_PREVIA_CARTAS = Object.freeze({
  facil: 3000,
  normal: 4000,
  dificil: 5000,
  muitodificil: 6000,
  extremo: 8000
});

/** Retorna o tempo de prévia em ms; valores desconhecidos caem em Normal. */
export function obterTempoPrevia(chave) {
  return TEMPOS_PREVIA_CARTAS[chave] ?? TEMPOS_PREVIA_CARTAS.normal;
}

/**
 * Dificuldades do modo SMB3.
 *
 * Tempos adotados (documentados em docs/DECISOES_TECNICAS.md):
 *  - Fácil:   6000 ms de apresentação;
 *  - Normal:  3500 ms de apresentação;
 *  - Difícil: 1500 ms de apresentação.
 *
 * A referência original NÃO possui fase de memorização: as cartas já começam
 * viradas e o jogo inicia após 1000 ms de tela inicial. A apresentação é,
 * portanto, uma adaptação solicitada para criar dificuldade sem alterar as
 * regras, os layouts ou a distribuição do tabuleiro.
 */
export const DIFICULDADES_CARTAS_SMB3 = Object.freeze({
  facil: Object.freeze({
    label: 'Fácil',
    tempoMemorizacaoMs: 6000,
    descricao: 'Apresentação longa: 6 s para memorizar as 18 cartas.'
  }),
  normal: Object.freeze({
    label: 'Normal',
    tempoMemorizacaoMs: 3500,
    descricao: 'Apresentação equilibrada: 3,5 s para memorizar.'
  }),
  dificil: Object.freeze({
    label: 'Difícil',
    tempoMemorizacaoMs: 1500,
    descricao: 'Apresentação curta: 1,5 s para memorizar.'
  })
});

/** Ordem de exibição das dificuldades SMB3. */
export const PROGRESSAO_SMB3 = Object.freeze(['facil', 'normal', 'dificil']);

/** Retorna a configuração SMB3; chave inválida cai em 'normal'. */
export function getDificuldadeSmb3(chave) {
  return DIFICULDADES_CARTAS_SMB3[chave] || DIFICULDADES_CARTAS_SMB3.normal;
}

export const DIFICULDADES_CARTAS_EXPANDIDO = {
  facil: {
    label: 'Fácil',
    cartas: 18,
    pares: 9,
    colunas: 6,
    linhas: 3,
    tempoAlvo: 60,
    descricao: 'Tabuleiro compacto, ideal para aquecimento.'
  },
  normal: {
    label: 'Normal',
    cartas: 30,
    pares: 15,
    colunas: 6,
    linhas: 5,
    tempoAlvo: 110,
    descricao: 'Mais cartas e combinações que a dificuldade anterior.'
  },
  dificil: {
    label: 'Difícil',
    cartas: 48,
    pares: 24,
    colunas: 8,
    linhas: 6,
    tempoAlvo: 180,
    descricao: 'Tabuleiro amplo; exige memorize posições.'
  },
  muitodificil: {
    label: 'Muito Difícil',
    cartas: 72,
    pares: 36,
    colunas: 9,
    linhas: 8,
    tempoAlvo: 280,
    descricao: 'Partida longa com 36 combinações.'
  },
  extremo: {
    label: 'Extremo',
    cartas: 100,
    pares: 50,
    colunas: 10,
    linhas: 10,
    tempoAlvo: 420,
    descricao: '50 pares, o maior desafio disponível.'
  }
};

/** Alias semântico para o modo expandido. */
export const DIFICULDADES_CARTAS = DIFICULDADES_CARTAS_EXPANDIDO;

/**
 * Retorna a configuração de uma dificuldade expandida.
 * @param {string} chave
 */
export function getDificuldadeCartas(chave) {
  return DIFICULDADES_CARTAS_EXPANDIDO[chave] || DIFICULDADES_CARTAS_EXPANDIDO.normal;
}

/** Alias explícito para o modo expandido. */
export function getDificuldadeCartasExpandido(chave) {
  return getDificuldadeCartas(chave);
}

/**
 * Próxima dificuldade da progressão expandida.
 * A progressão NÃO é cíclica: Extremo permanece em Extremo.
 * @param {string} chave
 */
export function proximaDificuldade(chave) {
  const indice = PROGRESSAO_CARTAS.indexOf(chave);
  const seguro = indice === -1 ? 0 : indice;
  const proximo = Math.min(seguro + 1, PROGRESSAO_CARTAS.length - 1);
  return PROGRESSAO_CARTAS[proximo];
}

/**
 * Dificuldade após uma vitória legítima. Se a progressão estiver desligada,
 * a dificuldade escolhida pelo jogador permanece fixa.
 */
export function dificuldadeAposVitoria(chave, progressaoAtiva) {
  return progressaoAtiva ? proximaDificuldade(chave) : chave;
}
