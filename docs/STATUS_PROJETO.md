# Status do Projeto — Memory Quest

## Repositório

- **Nome:** Plinko (representa toda a Arcade Collection)
- **URL oficial:** https://github.com/zappazero8019/Plinko
- **Branch:** `main` · **Remoto `origin`:** `https://github.com/zappazero8019/Plinko.git`
- **Primeiro commit oficial:** `270f2d4669924cc8f4187a8fb530763afa38c1c1`
- **Estado atual:** commit e push para `origin/main` autorizados e executados nesta
  etapa. Nenhum deploy ou outra publicação adicional foi realizado.
- **Backups históricos preservados (nomes de diretório originais):** `Plinko_pre_git`,
  `Plinko_pre_cardmatch_20261117_132542`, `Plinko_pre_smb3_20261117_134439`,
  `Plinko_pre_smb3_integracao_20261117_141426`, `Plinko_pre_ampliacao_cartas_20261117_144504`,
  `Plinko_pre_expansao_cartas_20261117_151133`, `Plinko_pre_camera_selfie_20261117_160004` e
  `Plinko_pre_memory_quest_20261117_164531` — todos em `C:\Users\Samuel\Documents\Backups`,
  nenhum apagado ou modificado.
- **Backups integrais preservados:** `Plinko_pre_ajustes_finais_20261117_173709`
  (4.414 arquivos, 177.788.873 bytes) e o backup pré-editação desta etapa
  `Plinko_pre_remocao_credito_dev_20261117_175710` (4.414 arquivos, 177.763.405 bytes),
  ambos em `C:\Users\Samuel\Documents\Backups`; nenhum apagado ou modificado.
- **Última validação:** **150 testes aprovados, 0 falhas**; `node --check` OK em todos
  os módulos alterados; Graphify **512 nós / 1503 arestas / 17 comunidades**;
  navegador com cache limpo confirmou inicialização direta, 0 iframes, nenhuma
  requisição externa e Service Worker `memory-quest-v12` com 26 assets em cache.

## Etapas

| Etapa | Status | Detalhes |
|-------|--------|----------|
| Alpha — Estrutura do projeto | ✅ Concluída | Estrutura, navegação, IndexedDB, carteira, backup, PWA e testes básicos |
| Fase 2A — Plinko | ✅ Concluída | Motor físico próprio, Canvas, 4 dificuldades, economia atômica — preservado, fora da nav principal |
| Integração GitHub | ✅ Concluída | Commit inicial `270f2d4`; alterações posteriores aguardam autorização |
| Fase 2B/2C — Card Match e Jogo da Memória | ✅ Concluída | Regras locais, 5 dificuldades, desafios e progressão — inalterados |
| Fase 2D — Implementação legada | 📦 Preservada | Código antigo mantido no disco para compatibilidade; sem referência funcional |
| **Visualização ampliada das cartas** | ✅ Concluída | 3 modos validados (`original`, `fixa`, `temporaria`); preferência restaurada para `original` |
| **Expansão do Card Match** | ✅ Concluída | Modo Tentativas, CHEAT, Cartas Selfie, FX/BGM independentes, DB v2; Modo Pontuação preservado |
| **Etapa A — Auditoria e backup** | ✅ Concluída | 3 frentes, 4.410 arquivos / 177.605.216 bytes preservados em backup integral |
| **Etapa B — Identidade e navegação** | ✅ Concluída | Memory Quest, cinco destinos, painéis `settings`/`stats`, SW v5; Plinko fora da nav |
| **Etapa C — Ampliação reconfirmada** | ✅ Concluída | Nenhum arquivo alterado; três modos validados e padrão `original` mantido |
| **Etapa D — Sistema visual** | ✅ Concluída | Botões 3D/pixel e alvos ≥44/52 px, escopados ao Jogo da Memória, SW v7 |
| **Etapa E — Volumes FX/BGM** | ✅ Concluída | Padrões 80/65, sliders no menu/painel, ganho por canal, fila de escrita, SW v9 |
| **Etapa F — Perfil local** | ✅ Concluída | Nome/avatar na store `profile`, estatísticas reais, `capture="user"` como preferência, SW v10 |
| **Etapa G — Documentação e grafo** | ✅ Concluída | Docs atualizados e Graphify regenerado na ocasião |
| **Ajustes finais — Jogo da Memória único** | ✅ Concluída | Fluxo direto, sem seletor de modos, sem iframe, sem porta adicional, SW v11 |
| **Ajustes finais — BGM corrigida** | ✅ Concluída | Base `0,05`, limite `0,08`, master `0,9` com limitador; BGM 65% = `0,0325`, 100% = `0,05` |
| **Ajustes finais — documentação/grafo** | ✅ Concluída | 5 docs atualizados, Graphify regenerado, relatório final registrado |
| **Remoção final e publicação** | ✅ Concluída | Backup pré-editação, 150 testes, SW v12, commit e push para `origin/main` |
| Graphify | ✅ Atualizado | **512 nós, 1503 arestas, 17 comunidades**, nenhum ciclo |
| Publicação | ✅ Autorizada | Commit e push executados nesta etapa; sem deploy ou publicação adicional |

## Estado da remoção do fluxo desativado

- **Experiência única:** `#cards` abre diretamente o menu do Jogo da Memória.
- **Arquivos legados:** dois módulos antigos permanecem no disco somente por
  compatibilidade histórica; não são importados, executados nem precacheados.
- **Cópia externa preservada:**
  `C:\Users\Samuel\AppData\Local\Temp\opencode\SMB3-Cards-Minigame-ref` — integralmente
  mantida, nenhum arquivo copiado ou modificado.
- **Navegador:** 0 iframes e nenhuma requisição a servidor externo durante a
  navegação e a partida.
- **Interface:** badge e resultado mostram apenas **JOGO DA MEMÓRIA**; estatísticas
  exibem somente `porModo.expandido`, sem rótulos de modos inexistentes.
- **Identificadores internos:** `'expandido'` e `'classico'` em registros antigos,
  regras, pontuação, dificuldades, cartas, selfies, animações e estatísticas mantidos.

## Testes

- Suíte: `tests/index.test.mjs` — **150 aprovados, 0 falhas**
  (94 → 132 → 136 → 139 → 148 → 156 → 158 → 150).
- Testes do fluxo atual: inicialização direta no Jogo da Memória, menu sem seletor de
  modos, badge/resultado com identidade única, ausência de modos inexistentes na UI.
- Testes de auditoria: nenhum arquivo de aplicação contém referências funcionais ao
  fluxo removido, a iframe ou a porta antiga; estilos do adaptador removidos;
  módulos legados fora do precache; Service Worker `memory-quest-v12` com 26 assets.
- Testes de regras preservadas: Fisher-Yates, 8 disposições base, multiset 4/4/4/2/2/2,
  5 dificuldades, tempo alvo, 4 desafios, progressão, HUD e estatísticas sem tocar na
  carteira.
- Testes de ampliação: 3 modos e fallback; registro antigo sem campo usa `original`
  sem gravar; persistência após reload do banco; `original` sem área extra; área fixa;
  temporária expirando em 1750 ms e reiniciando ao trocar de carta; clique em revelada
  sem seleção duplicada; limpeza em reinício/conclusão; reduced motion.
- Testes de Modo Tentativas/CHEAT: erro consome, acerto não consome, selfie concede +2,
  fim por esgotamento/vitória, HUD com contador/∞, prioridade do CHEAT, registro da
  modalidade e ausência do painel no Modo Pontuação.
- Testes de selfies: processamento JPEG 320×426 com recorte 3:4, normalização de
  enquadramento, rejeição de tipo inválido/arquivo >20 MB, CRUD completo, uma selfie
  exatamente 2 vezes, total de cartas/pares inalterado e distribuição sorteada só em
  nova partida.
- Testes de preferências/estatísticas: padrões seguros em instalação antiga,
  normalizadores, preservação de campos, registros antigos não interpretados como
  Tentativas, separação por modalidade/CHEAT/derrota/bônus.
- Testes de banco/backup: v2 aditiva, seed protegido por `oldVersion`, migração v1 → v2
  sem reaplicar seed nem apagar dados, exportação com selfies e restauração antiga.
- Testes de áudio/UI: FX e BGM independentes sem reiniciar a música, botões derivados
  do estado exibido, `tocarSom: false` sem duplicar o som final, galeria com
  câmera/galeria e confirmações, editor com preview e erros exibidos sem sair da tela.
- Testes de volumes: padrões 80/65, normalização (inclui zero), canais independentes,
  sliders no menu/painel, persistência após fechar/reabrir o banco, corrida de escrita,
  BGM em 0/25/50/65/100%, nenhuma voz acima de `0,08` e FX inalterado ao mudar BGM.
- Testes de auditoria DOM: `HTMLCollection` real sem `.filter`, listeners de teclado
  sem acumular entre partidas e erro de selfie exibido na galeria/editor.
- Testes Memory Quest: identidade/navegação e rotas legadas, sistema visual de botões,
  volumes e perfil local (normalizadores, preservação de campos, escritas rápidas,
  backup, estatísticas reais e integração no bootstrap/SW).
- `node --check`: OK em `index.js`, `renderer.js`, `difficulty.js`, `panels.js`,
  `service-worker.js` e `tests/index.test.mjs` (além dos módulos validados nas etapas
  anteriores).

## Validação no navegador (remoção final)

- Ambiente: `http://localhost:8770/index.html`, cache e registro do Service Worker
  limpos antes do teste (cache antigo `memory-quest-v11` removido).
- Navegação principal: **Jogar** abriu diretamente o menu do Jogo da Memória, com
  “JOGO DA MEMÓRIA” e as 5 dificuldades; 0 iframes no DOM.
- Nenhuma requisição a servidor externo foi observada na rede; único cache ativo:
  `memory-quest-v12`, com exatamente 26 assets e nenhum módulo removido.
- O HTML e o texto visíveis não contêm identificadores, logs, avisos ou valores do
  mecanismo removido; o saldo e o histórico existentes no IndexedDB foram preservados.
- Preferências de áudio existentes foram preservadas e reconfirmadas após reload:
  `FX 25`, `BGM 50`, `FX: ON`, `BGM: OFF`.
- Console sem erros novos; permanece apenas o 404 pré-existente de
  `assets/fonts/pixel.ttf`.
- Validações preservadas das etapas anteriores: 5 dificuldades com 30 cartas no
  Normal, modalidade Tentativas com `TENTATIVAS: 22`, bônus de selfie `+2`, CHEAT
  infinitas com `∞`, ampliação `fixa`/`temporaria`/`original` com persistência,
  perfil com nome/avatar reais e sem rolagem horizontal no tabuleiro.
- **Android:** sem dispositivo real (`adb` indisponível e `REA_ADB_PATH` ausente).
  Permanece como pendência o teste em aparelho físico (Moto G35); nenhuma ferramenta
  foi instalada sem autorização.

## Graphify

- Última execução (remoção final): **32 arquivos de código reprocessados com
  `--force`, 5 documentos ignorados pelo `--code-only`**, resultado **512 nós,
  1503 arestas, 17 comunidades**, nenhum ciclo de importação.
- 97% extraído / 3% inferido (47 arestas, confiança média 0,85).
- God nodes: `criarRenderer()` = 47 arestas, `grupoCardMatch()` = 32, `getAll()` = 28,
  `grupoBanco()` = 23, `grupoVisualizacaoCartas()` = 23,
  `grupoPreferenciasEStats()` = 23, `init()` = 23, `grupoVolumes()` = 22,
  `put()` = 22 e `grupoSelfies()` = 22.
- Único arquivo sem símbolos extraídos: `vendor/matter.min.js` (placeholder
  preexistente e não usado). Nenhum módulo do fluxo ativo ficou isolado.
- Artefatos em `graphify-out/` (não versionados). Ver `docs/GRAPHIFY.md`.

## Pendências

1. Validar em dispositivo Android real, priorizando Moto G35 (sem `adb` no ambiente e
   sem `REA_ADB_PATH`; não instalar ferramentas sem autorização).
2. Definir economia do Jogo da Memória (atualmente nenhuma).
3. Avaliar o overflow horizontal preexistente do cabeçalho em 360 px
   (`header__wallet`), fora do tabuleiro e deste escopo.
4. 404 conhecido de `assets/fonts/pixel.ttf`: caminho preservado, sem correção nesta
   etapa.

## Recomendação

Commit e push para `origin/main` concluídos com autorização expressa. Não houve deploy
nem publicação adicional, nem alteração em Plinko, carteira, transações, regras,
pontuação, estatísticas, selfies, áudio, IndexedDB ou dados existentes. Os arquivos
legados, a cópia externa e todos os backups permanecem intactos; nenhum dado foi
apagado.
