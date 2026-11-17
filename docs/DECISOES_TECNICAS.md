# Decisões Técnicas — Memory Quest

## 1. Motor físico próprio no Plinko (Fase 2A)
**Decisão:** motor físico próprio em JavaScript puro (`src/games/plinko/physics.js`),
sem Matter.js (os downloads da biblioteca foram truncados). Integração semi-implicit
Euler, colisões círculo-círculo e círculo-segmento, impulso com restituição/fricção,
gravidade e dormência. `vendor/matter.min.js` permanece como placeholder não usado.
Plinko não foi modificado.

## 2. Integração dos jogos por APIs centrais
**Decisão:** nenhum jogo manipula diretamente o IndexedDB nem altera o saldo. Todos
usam `src/core/wallet.js` (Plinko) e `src/core/game-stats.js` (Jogo da Memória).

## 3. Carteira virtual compartilhada
Uma única carteira, visível no cabeçalho, com operações atômicas, idempotência,
histórico unificado e saldo nunca negativo. Nenhuma alteração nesta etapa.

## 4. Persistência IndexedDB
Banco principal com 10 stores, `DB_VERSION = 2`, verificação de integridade e
`navigator.storage.persist()`. A única mudança de esquema é a store `selfies`; a
migração v1 → v2 é aditiva (nenhuma store/registro recriado ou apagado) e o seed só
roda em banco realmente novo (`oldVersion < 1`, com `undefined` tratado como 0).
A versão única vive em `migrations.js` (`DB_VERSION_ATUAL`) e `database.js` a importa,
evitando dois números divergentes. Backup v1 sem `selfies` é aceito na restauração.

## 5. Ausência de backend obrigatório
Aplicação estática, dados locais, backup/restauração por JSON. Nenhum servidor
adicional é necessário para jogar.

## 6. GitHub Pages como destino
Repositório `zappazero8019/Plinko`, compatível com subdiretórios. A autorização
expressa para commit e push foi concedida nesta etapa e o envio a `origin/main` foi
executado, sem deploy ou publicação adicional.

## 7. Graphify como ferramenta permanente
**Decisão:** executar Graphify a cada etapa para detectar dependências/ciclos.
Grafo atualizado após a remoção final: **512 nós, 1503 arestas, 17 comunidades**,
97% extraído / 3% inferido (47 arestas inferidas, confiança média 0,85),
**nenhum ciclo de importação**. God nodes: `criarRenderer()` 47 arestas,
`grupoCardMatch()` 32, `getAll()` 28, `grupoBanco()` 23,
`grupoVisualizacaoCartas()` 23, `grupoPreferenciasEStats()` 23, `init()` 23,
`grupoVolumes()` 22, `put()` 22 e `grupoSelfies()` 22. Único arquivo sem símbolos:
o placeholder preexistente `vendor/matter.min.js`. Artefatos em `graphify-out/`
(ignorado pelo Git).
Comandos: `--code-only --force`, `cluster-only <path> --no-label --no-viz` e
`export html`.

## 8. PWA e funcionamento offline
Service Worker com Cache First, manifest com `display: standalone`. Cache promovido
para **`memory-quest-v12`**, com **26 assets** no precache (inclui `migrations.js`,
`selfies.js`, `game-stats.js`, `settings.js`, `profile.js`, `panels.js` e
`ui/profile.js`). Os dois módulos legados preservados no disco não entram no precache.
A versão subiu de `arcade-collection-v4` para `memory-quest-v5` (identidade), `v7`
(estilo), `v9` (volumes/correção da corrida), `v10` (perfil), `v11` (ajustes finais)
e `v12` (remoção final) para servir sempre o JS atual; caches antigos são removidos
na ativação. Durante as validações foi necessário apagar caches e atualizar o
registro porque versões anteriores serviam JS antigo.

## 9. Referência externa preservada fora do projeto
Auditoria anterior confirmou repositório de terceiros sem licença declarada.
**Decisão vigente:** manter integralmente a cópia local de avaliação fora do
repositório, sem copiar, modificar ou redistribuir nenhum de seus arquivos. Nenhum
recurso protegido foi incorporado ao projeto. A referência não é necessária para
executar o Jogo da Memória.

## 10. Jogo da Memória como experiência única
**Decisão:** `#cards` inicia diretamente no Jogo da Memória (`cardsInit()` →
`await abrirMenu()`). Não há seletor de modos, nem fluxo alternativo. Os
identificadores técnicos internos (`modo: 'expandido'` nas configurações e
`'classico'` em registros históricos) permanecem para compatibilidade com banco,
backup e testes, mas a interface mostra apenas **JOGO DA MEMÓRIA**. Estatísticas
legadas continuam no banco/backup; a UI exibe somente `porModo.expandido`.

## 11. Nenhum iframe nem dependência de servidor externo
**Decisão:** o jogo roda inteiramente com módulos locais (`board.js`, `renderer.js`,
`expanded.js`). Foram removidos o adaptador em iframe, a URL externa, os estilos de
moldura/escala, os observers associados e qualquer dependência de porta adicional.
Validação com cache limpo: **0 iframes** e nenhuma requisição a servidor externo.

## 12. Dificuldades preservadas
O Jogo da Memória mantém os 5 níveis (Fácil 18, Normal 30, Difícil 48, Muito Difícil
72, Extremo 100 cartas), com progressão automática opcional, Fisher-Yates, tempo
alvo, 4 desafios e HUD próprios. As dificuldades antigas de 3 níveis seguem apenas
como identificadores em módulos legados, sem participar do fluxo ativo. Nenhuma
regra, pontuação, símbolo ou animação foi alterada.

## 13. Tabuleiro responsivo
O tabuleiro usa CSS fluido com cartas 3:4 e `touch-action: manipulation`, sem viewport
fixo, transform de escala ou coordenadas absolutas. A geometria antiga de painel
fixo foi removida junto com os estilos do fluxo desativado.

## 14. Eventos de toque e desktop
Foram preservados clique, teclado e toque no tabuleiro, além do input de arquivo
anexado ao DOM antes de `click()` (compatibilidade Safari/iOS). Validação em
navegador desktop realizada; permanece pendente o teste em aparelho Android real
(Moto G35), pois `adb` não está disponível e `REA_ADB_PATH` está ausente. Não foram
instaladas ferramentas sem autorização.

## 15. Estatísticas sem interferência
Partidas são registradas pelo serviço central com modo, dificuldade, modalidade,
CHEAT, derrota, tempo, erros e bônus de selfies reais. Nenhum resultado é inventado
e nenhum dado existente é apagado. A carteira não é tocada.

## 16. Sistemas compartilhados inalterados
Carteira, Plinko, conquistas, economia, Modo Pontuação, modalidade Tentativas, CHEAT,
selfies, perfil, backup e formato `1.0.0` permanecem intactos. O IndexedDB mudou
apenas de forma aditiva (v1 → v2, store `selfies`).

## 17. Limpeza de recursos
`cardsDestroy()` → `encerrarSessao()` remove listeners de teclado/selfie, cancela os
timers de partida, ampliação e BGM, e limpa o `#cards-board`. Testes com DOM simulado
confirmam que não há resíduos entre entradas/saídas da área.

## 18. Cache do Service Worker e publicação
`service-worker.js` terminou em `memory-quest-v12`, com 26 assets no precache e sem
os módulos legados. A publicação foi autorizada e o push para `origin/main` foi
realizado; nenhum deploy ou publicação adicional foi executado.

## 19. Visualização ampliada das cartas
**Problema:** em celulares, o símbolo da carta revelada é pequeno; era preciso oferecer
ampliação sem revelar cartas ocultas, sem mexer em regras/tempo/pontuação e sem criar
um banco paralelo.

**Decisões:**
- Três modos — `original` (padrão), `fixa` (área acima do tabuleiro, última carta
  revelada válida) e `temporaria` (sobreposição de 1750 ms ao tocar em carta revelada).
- Preferência em `src/core/settings.js`, sobre a store `settings` existente: acrescenta
  o campo ao registro `id: 1`, preserva os demais campos, valida valores inválidos com
  fallback `original` e **não altera `DB_VERSION`**.
- O renderer decide a ampliação apenas com estado já revelado (`revelada`/`pareada`),
  nunca consultando símbolo de carta virada para baixo; a face usa os mesmos dados da
  frente exibida no tabuleiro.
- No modo `temporaria`, o clique em carta revelada **não** chama `onSelecionar`:
  elimina seleção duplicada sem alterar o estado da partida.
- Timer injetável no renderer, cancelado em reinício/conclusão/troca de preferência;
  sobreposição `pointer-events: none` e `z-index: 80` para não bloquear o tabuleiro.
- Face proporcional 3:4, `prefers-reduced-motion`, rótulos ARIA e foco/teclado/touch
  preservados. Layout desktop inalterado quando se escolhe `original`.

**Validação:** os testes de ampliação seguem na suíte, agora com **150 aprovados,
0 falhas**. Persistência conferida após reabertura do banco no teste e após reload real
no navegador; simulação de 360 px em portrait e 740×360 em landscape confirmou face
visível e dentro da tela. O único overflow horizontal em 360 px é preexistente no
cabeçalho global (`header__wallet`), fora do tabuleiro e deste escopo.

## 20. Modo Tentativas sem alterar o Modo Pontuação
**Decisão:** acrescentar uma modalidade opcional ao Jogo da Memória, mantendo a anterior
como padrão. Erro consome 1 tentativa; acerto não consome; par de selfie concede +2;
a partida termina por esgotamento ou vitória, com contador visível no HUD. As
tentativas iniciais são Fácil 14, Normal 22, Difícil 32, Muito Difícil 45 e Extremo 60
(`TENTATIVAS_INICIAIS` em `tentativas.js`). Derrotas e bônus passam a constar nas
estatísticas, sem tocar na carteira. O usuário decidiu explicitamente: “mantenha como
está, nao incluir pontuaçao” — ou seja, sem contador numérico de pontos e sem bônus
`+50` visível.

## 21. CHEAT restrito ao Modo Tentativas
**Decisão:** três estados com prioridade `infinitas > personalizada > padrão`,
persistidos em `settings`. Infinitas mostra `∞` e não concede bônus numérico; a
quantidade personalizada (padrão 20, limites 1–999) vale apenas para novas partidas.
O painel não aparece no Modo Pontuação, e a modalidade usada em cada partida fica
registrada para não interpretar partidas antigas como Modo Tentativas.

## 22. Cartas Selfie como substituição de pares
**Decisão:** fotos locais substituem pares normais sem mudar o tamanho do tabuleiro.
Cada selfie ativa entra exatamente 2 vezes e o sorteio só ocorre em nova partida.
Processamento para 320 × 426 px, JPEG 0,82, origem limitada a 20 MB e sem limite
artificial de quantidade. CRUD com confirmação para exclusão/substituição, câmera e
galeria no mesmo fluxo, e mensagens de erro na própria galeria/editor. A preferência
`selfiesAtivas` guarda quais selfies participam; os dados ficam na store `selfies`,
nunca em arquivos do servidor.

## 23. Áudio FX/BGM independente
**Decisão:** FX e BGM são ligados por padrão, têm botões próprios no menu e na partida
e são persistidos separadamente. `alternarBgm()` só cria/limpa o intervalo quando a
preferência de BGM muda, de modo que alternar FX não reinicia a música. Botões derivam
o próximo estado do estado exibido, não do motor de áudio. Volumes independentes
foram acrescentados na decisão 30 e a correção de audição/clipping na decisão 37.

## 24. Estatísticas separadas e compatibilidade
**Decisão:** registros novos incluem `modalidade`, `cheat`, `derrota`, `bonusSelfies` e
`selfiesPares`. Registros antigos sem `modalidade` são tratados como Pontuação, nunca
como Tentativas. `bonusSelfies` é o total de tentativas concedidas (2 por par) e
`selfiesPares` conta os pares encontrados; com CHEAT infinitas o bônus numérico é 0.

## 25. Som único no fim da partida
**Decisão:** `onPar`/`onErro` já tocam o som final; `mostrarResultado()` aceita
`tocarSom` e o integrador passa `false`. Teste dedicado confirma que nenhum som extra
é disparado ao exibir o painel de resultado.

## 26. Limpeza e robustez de DOM
**Decisão:** `removerNo()` usa `Array.from` para tratar `HTMLCollection` real; listeners
de teclado são substituídos por partida e removidos ao voltar ao menu; o loop RAF é
cancelado em `finalizarPartida()`; o input de arquivo é anexado ao DOM antes de
`click()` para Safari/iOS. Falhas de leitura/quota são exibidas sem avançar de tela.

## 27. Backup pré-alteração preservado
**Decisão:** manter integralmente todos os backups anteriores, em especial
`C:\Users\Samuel\Documents\Backups\Plinko_pre_expansao_cartas_20261117_151133`
(15 arquivos) e o backup integral dos ajustes finais (decisão 38). Nenhum backup,
IndexedDB ou repositório remoto foi apagado ou alterado; commits/push/publicação
seguem aguardando autorização explícita.

## 28. Identidade Memory Quest sem quebrar o legado
**Decisão:** trocar título, manifesto, descrição, banner PWA e apresentação para
**Memory Quest**, preservando identificadores técnicos: `DB_NAME = 'ArcadeCollection'`,
`DB_VERSION_ATUAL = 2`, stores, hashes legados, `dificuldadePlinko` e classes
internas. Plinko saiu apenas da navegação/apresentação principal; código, física,
carteira, transações e arquivos permanecem intactos e `#plinko` continua válido.

## 29. Navegação principal e “Minhas Cartas”
**Decisão:** navegação inferior com Jogar, Perfil, Minhas Cartas, Configurações e
Estatísticas. `#settings` e `#stats` viraram áreas reais do router. “Minhas Cartas”
usa `#cards` com `data-foco="selfies"` para abrir a galeria existente, sem duplicar
DOM nem estado. A loja permanece disponível pelo fluxo legado.

## 30. Volumes FX/BGM aditivos
**Decisão:** `volumeFxCartas` (padrão 80) e `volumeBgmCartas` (padrão 65) são campos
novos no registro `settings` já existente. Padrões aplicados somente na leitura quando
ausentes; `0` é silêncio válido, faixa `0–100`, arredondamento. Sliders no menu do
Jogo da Memória e no painel de Configurações. O ganho escala as amplitudes procedurais
sem reiniciar o timer da BGM; canais ligados/desligados e volumes são independentes.
Nenhum bump de DB, nenhuma store nova e nenhuma mudança no formato de backup `1.0.0`.

## 31. Escritas serializadas de preferências
**Decisão:** arrastar os dois sliders em sequência gerou uma corrida real no navegador:
a segunda gravação podia ler o registro antigo e apagar o primeiro volume. Agora
`settings.js` usa uma fila de promessas; uma falha não trava gravações seguintes. Teste
de regressão confirma FX `0` + BGM `100` simultâneos. O mesmo padrão foi adotado no
perfil.

## 32. Perfil local na store existente
**Decisão:** `src/core/profile.js` e `src/ui/profile.js` usam `profile` (já existente),
sem nova store, sem migração e sem alterar formato de backup. Nome e avatar são
normalizados; campos `id`, `idExterno`, `criadoEm`, `tema` e demais dados antigos são
preservados. A foto fica apenas no dispositivo, como data URL JPEG 192 × 192 no campo
`avatar`. `capture="user"` é preferência pela câmera frontal, não garantia; a galeria
continua disponível, como nas selfies.

## 33. Estatísticas exibidas no perfil
**Decisão:** o resumo usa `contarPartidas()`, `obterEstatisticas()` e `getEstado()`,
sem estado paralelo e sem inventar números. O cabeçalho legado
(`#profile-nome`, `#profile-id`, avatar) é sincronizado, e após importar backup o painel
é renderizado novamente.

## 34. Cache versionado por mudança de código
**Decisão:** cada alteração de JS/PWA recebeu bump do SW para evitar JS obsoleto:
`memory-quest-v5` (B), `v7` (D), `v9` (E, após a correção da corrida), `v10` (F),
`v11` (ajustes finais, remoção do fluxo desativado) e `v12` (remoção final). O cache
final contém 26 assets. Validação com cache limpo confirmou persistência de
volumes/perfil, cache ativo único e nenhuma requisição a servidor externo.

## 35. Backup integral pré-Memory Quest preservado
**Decisão:** manter integralmente
`C:\Users\Samuel\Documents\Backups\Plinko_pre_memory_quest_20261117_164531`
(4.410 arquivos, 177.605.216 bytes), além de todos os backups anteriores. Nenhum
IndexedDB, backup, commit, push ou publicação foi apagado/alterado. Nenhuma dependência
foi instalada.

## 36. Remoção funcional do fluxo desativado
**Decisão:** preservar os arquivos legados no disco, mas eliminar todo uso funcional:
imports, callbacks, seletor de modos, estilos de moldura/iframe, parâmetros de URL,
dependência de porta, listeners/observers e entradas no precache. A suíte inclui um
teste de auditoria que falha se arquivos da aplicação voltarem a conter essas
referências. A cópia externa de avaliação permanece intacta e fora do projeto.
Nenhum material protegido foi copiado ou distribuído.

## 37. BGM audível sem clipping
**Problema:** a amplitude da nota da BGM era `0,014` (com volume padrão de 65%,
ganho final `0,0091`), inaudível em dispositivos móveis. Aumentá-la sem controle
podia saturar a soma com os FX.

**Decisão:** elevar a base procedural da BGM para `0,05` (65% → `0,0325`; 100% →
`0,05`), manter o limite por voz em `0,08` e acrescentar um barramento master com
ganho `0,9` e `DynamicsCompressorNode` opcional como limitador (`threshold -6`,
`knee 0`, `ratio 20`, `attack 0.003`, `release 0.25`). Navegadores sem o nó de
compressão usam apenas o ganho de headroom. FX permanece em `0,02` (80%) e os canais
continuam independentes. Volume `0` silencia apenas o canal correspondente e mudar
o volume não reinicia o timer da BGM.

**Validação:** testes cobrem BGM em 0/25/50/65/100%, afirmam que nenhuma voz passa de
`0,08`, que o FX não muda ao ajustar a BGM e que os volumes persistem após fechar e
reabrir o banco. No navegador, sliders e toggles independentes foram alterados e
confirmados após reload.

## 38. Backup integral e documentação final dos ajustes
**Decisão:** criar antes das edições o backup integral
`C:\Users\Samuel\Documents\Backups\Plinko_pre_ajustes_finais_20261117_173709`
(4.414 arquivos, 177.788.873 bytes), preservando os 9 backups anteriores. Após as
alterações, a suíte passou a ter **158 aprovados, 0 falhas**, `node --check` ficou OK
nos módulos alterados, o navegador confirmou inicialização direta, 0 iframes, nenhuma
requisição externa e cache `memory-quest-v11`, e o Graphify foi regenerado
(519 nós / 1531 arestas / 17 comunidades). Documentação e relatório final atualizados
naquela ocasião, antes da autorização de publicação.

## 39. Remoção final e publicação autorizada
**Decisão:** eliminar por completo o mecanismo temporário criado apenas para testes
locais: import e bloco de inicialização, módulo exclusivo, entrada no precache,
grupo de testes e documento dedicado. Nenhum saldo, transação, store ou dado do
IndexedDB foi apagado; licenças, avisos e atribuições de terceiros foram preservados.
O precache caiu para 26 assets e o SW subiu para `memory-quest-v12`, expurgando a
versão anterior na ativação. Backup integral pré-editação preservado em
`C:\Users\Samuel\Documents\Backups\Plinko_pre_remocao_credito_dev_20261117_175710`
(4.414 arquivos, 177.763.405 bytes). A suíte ficou com **150 aprovados, 0 falhas**;
Graphify registrou **512 nós / 1503 arestas / 17 comunidades**. Commit e push para
`origin/main` autorizados e executados, sem deploy ou publicação adicional.

## Histórico de decisões superadas
As decisões 10–18 descreviam a integração externa anterior e foram **substituídas**
pelas decisões 36–39. O critério atual é uma experiência única, local e offline:
Jogo da Memória, sem seletor de modos e sem recursos de terceiros. Também continua
descartada a ideia de exibir pontuação numérica ou bônus de pontos (decisão 20): o
feedback de selfie no Modo Tentativas é apenas o bônus de +2 tentativas.
