# Módulo `memory`: memória de contexto por domínio (raw-first, nativa em TS)

Este módulo implementa a SÍNTESE §2.3 (contrato `MemoryService`), §2.4(b)(d) (orçamento de contexto e modelos mentais) e §2.5, seguindo o r4 §7: camadas L0–L3, recall multicanal e operações. Tudo roda in-process. Cada domínio de estudo tem seu próprio SQLite, em `domains/<id>/memory/memory.db`, e nenhuma busca cruza domínios. Toda chamada a LLM entra por um *port* injetado (`Extractor`); a store nunca chama modelo.

| Camada | Pasta | Papel |
|---|---|---|
| core (puro, browser-safe) | `src/core/memory/` | Tipos e ports, fusão RRF/RSF, MMR, decaimento, supersessão bitemporal, ops de modelo mental, validação de extração (aterramento das citações), montagem do contexto, expressões de tempo pt/en. |
| store (I/O) | `src/store/memory/` | `SqlDriver` (node:sqlite), DDL, `MemoryDb` (um arquivo por domínio) e `DomainMemoryService` (roteador por domínio). |
| server (composição) | `src/server/memory/` | Embedder transformers.js (lazy), hash-embedder determinístico, extrator LLM (prompts + zod + 1 retry) e `createMemoryService`. |
| prompts | `src/agent/prompts/memory/` | `extract.md`, `supersede-judge.md`, `observe.md`, `consolidate.md`, `diary.md`. Instruções em inglês, saída em pt-BR; as citações ficam no idioma original. |

## API pública

**`MemoryDb.open(dir, { domainId, embedder, extractor?, curriculum?, learner?, profile?, settings?, clock?, onError?, title? })`**

- `ingestTurn(t)`: síncrono. Grava a mensagem L0 e a linha FTS numa transação e devolve o id. Embedding, extração e observação vão para a fila em segundo plano. Mede p50 ≈ 0,1 ms.
- `recall(ctx)`: os canais `vec` (cosseno em JS), `fts` (bm25), `graph`, `time` e `learner` passam por RRF k = 60 (ou RSF), depois prior de vida, corte relativo 0,4, MMR λ = 0,7, orçamento de tokens e renderização cronológica agrupada por dia.
  - O canal `graph` faz ativação espalhada (δ = 0,5, 2 saltos) sobre as arestas da memória, mais os vizinhos de currículo (1 salto) via port.
  - Os modos são `auto`, `skip`, `deep` (4000 tokens) e `historical` (inclui fatos superados, rotulados).
  - O recall lança `domain-mismatch` se `ctx.domainId` não for o domínio do arquivo.
- `stablePrefix(sessionId)`: perfil ≤ 300, modelo mental + "Retomada" do diário ≤ 1000, aprendiz ≤ 300 e log de observação ≤ 8000 (mantém a cauda). É a parte cacheável.
- `buildContext(ctx)`: devolve prefixo + `<!-- lh:cache-boundary -->` + recall, num total ≤ 12k.
- `endSession(id)`: extração (lotes de ≤ 6000 tokens) → juiz de supersessão → log de observação → consolidação → diário. É *best-effort*: se uma etapa falha, as seguintes rodam mesmo assim (o diário e `ended_at` são sempre gravados) e a promessa rejeita com o **primeiro** erro; os demais vão para `onError`. Sessão desconhecida rejeita com `invalid-input`.
- `hasSession(id)`: síncrono; diz se a sessão existe neste arquivo.
- `consolidate()`: idempotente.
- `forget(sel, "soft" | "hard")`: o seletor aceita `factIds`, `messageIds`, `{ query, confirmIds }`, `sessionId`, `before` ou `all`.
- `exportMarkdown(dir)`: gera `Modelo do aluno.md`, `Observações.md` e `Diário.md` para o vault do Obsidian. É espelho só de leitura.
- Leitura para o visualizador: `listFacts`, `allFacts`, `observations`, `mentalModel`, `diary`, `observationLog`, `sessionMessages`, `flashcardCandidates` / `setFlashcardStatus`, `health`.
- Ciclo de vida: `flush`, `close`.

**`DomainMemoryService`** (implementa `MemoryService`)

- `open(domainId)` torna esse domínio o ativo.
- `recall` e `stablePrefix` vão para o domínio **nomeado**. Se ele não estiver aberto, lançam `not-open`.
- A escrita (`ingestTurn`, `consolidate`, `forget`, `exportMarkdown`) vai para o domínio ativo. `endSession` vai para o domínio aberto **dono** da sessão (o ativo primeiro): a sessão costuma ser encerrada logo depois de o aluno trocar de domínio.
- Mantém um LRU de 2 handles e expõe `get(id)`, `active()` e `close()`.

**Server**

- `createMemoryService({ dataRoot, call?, ops?, embedder?, curriculumFor?, learnerFor?, profile?, … })`.
- `TransformersEmbedder`: `Xenova/multilingual-e5-small`, q8, 384 dimensões, prefixos E5, cache em `profile/model-cache`, carregado só no 1º `embed`.
- `HashEmbedder`: FNV-1a de palavras e trigramas dobrados.
- `createLlmExtractor({ call, promptsDir?, ops? })`. O `call` recebe `{ role, op, system, messages, maxOutputTokens, json }`, com `role` ∈ extractor | judge | observer | consolidator.

## Decisões

- **Raw-first.** L0 é a fonte da verdade e é escrita de forma síncrona. Todo trabalho assíncrono (embeddings, extração, juiz, observação, consolidação, esquecimento) corre numa única cadeia de promessas por arquivo, então nunca se intercala. Falha de LLM ou de embedder é reportada via `onError` / `health().lastError` e não toca o L0.
- **Catálogo em memória.** Ele espelha os metadados de cada item e os vetores normalizados, com cosseno por força bruta. O SQL só carrega o texto dos ≤ 40 candidatos finais. Com 5k mensagens, o recall dá p50 ≈ 5 ms. Os vetores são reconstruídos ao abrir; se o `embedder.id` ou a dimensão mudam, tudo é re-embutido.
- **Aterramento estrito** (r4 §7.6.2):
  - A citação precisa aparecer *verbatim* na mensagem-fonte, comparada após minúsculas, remoção de acentos e colapso de espaços, e só em palavras inteiras (um corte no meio da palavra não aterra). Elisões com `...` são permitidas.
  - Fatos do tipo learner, preference, goal, affect e misconception precisam citar uma fala do **aluno**.
  - A evidência de diálogo é limitada a `graderConfidence` ≤ 0,6.
  - O que falha é descartado e registrado no `audit`.
- **Bitemporal, nunca sobrescreve.**
  - `UPDATES`/`CONTRADICTS` fecham o fato antigo com `valid_to` = início do sucessor, `expired_at` e `superseded_by`.
  - `DUPLICATE` soma `proof_count`.
  - `REFINES` cria uma aresta.
  - Sem juiz, o modo é só-ADD; a deduplicação da consolidação (exata ou cos ≥ 0,92 ∧ Jaccard ≥ 0,8) aposenta duplicatas via `expired_at`.
  - Os candidatos ao juiz são do mesmo tipo, com cos ≥ 0,75, compartilham nó/entidade e ficam no top 8.
- **Corte relativo antes da penalidade de superado.** O ×0,3 só reordena. Se entrasse antes do corte de 0,4, o modo `historical` nunca mostraria o fato antigo.
- **Consolidação idempotente.** A marca d'água é a coluna `facts.consolidated`, que sobrevive a hard delete e a inserções no mesmo milissegundo.
  - O lote de ops do modelo mental é atômico. Uma op inválida aplica **nada** e lança `ops-invalid`; os fatos continuam pendentes.
  - As refs precisam existir: `fact:`, `obs:`, `msg:`, `episode:`, `session:`, `node:`.
- **Diário.** Sem LLM, é gerado um diário determinístico em pt-BR, então a "Retomada" existe sempre. O prefixo estável usa o diário mais recente de **outra** sessão.
- **Tempo.**
  - Uma tabela de regras pt/en cobre o que o chrono-node pt não resolve.
  - "semana passada" é a semana civil anterior, de segunda a domingo; "últimos N dias" é uma janela móvel até agora.
  - Datas sem ano que caem no futuro recuam um ano.
  - "desde / a partir de / since <data>" abre o intervalo até agora ("desde outubro" = [1º de outubro, agora]); "em outubro" continua sendo o mês civil.
- **Fatos com `scope = "session"`** só entram no recall (não histórico) da sessão que os produziu.
- **Esquecer.**
  - Alvos derivados: um fato cai quando alguma fonte é esquecida **e** (não sobra fonte ou a citação não aparece em nenhuma fonte sobrevivente). Episódios caem quando toda a sua faixa cai; observações, quando toda a evidência cai. Uma sessão cujas mensagens caem todas leva junto o log de observação e o diário.
  - *Soft*: marca `status = forgotten`, remove a linha FTS, a linha de `embeddings` e o vetor do catálogo (reabrir não ressuscita), guarda a linha original no `audit` para rollback e exclui entradas do modelo mental sem fonte sobrevivente. Diário e log de sessões esvaziadas saem do prefixo estável (a linha vai para o `audit`).
  - *Hard*: faz DELETE em cascata (fatos e episódios derivados, evidência de diálogo, candidatos a flashcard, log e diário da sessão), poda `source_msg_ids` dos fatos sobreviventes, limpa o conteúdo do `audit` (inclusive os registros `reject` da sessão, que guardavam o texto do fato descartado) e roda `optimize` do FTS, `VACUUM` e `wal_checkpoint(TRUNCATE)`, para que nenhum byte do texto sobre no `.db` nem no `-wal`.
  - Um recall concorrente com um forget nunca devolve item esquecido: a elegibilidade é reconferida depois do último `await`.
- **Cold start (r4 L11) não implementado de propósito.** Injetar até 40k tokens brutos contradiz o teto de 12k da SÍNTESE §2.4(b).
- **Desvios do r4 §7.4.**
  - As linhas FTS são escritas explicitamente e mapeadas por `fts_rowid`; não há triggers.
  - Os embeddings ficam num BLOB float32 com `CHECK(length = dim*4)`.
  - As entidades usam chave canônica exata, sem fusão fuzzy.

## Integração com a aula

O tutor monta a consulta a partir da última fala ou resposta do aluno e dos nós em foco. A montagem combina os canais de busca do domínio com o estado atual do currículo. O bloco entra na chamada ao modelo como contexto histórico e fica fora da transcrição salva. O teto é de 12 mil tokens estimados, reduzido conforme o espaço disponível no modelo escolhido.

O perfil fornece a meta, o nível inicial registrado e o tempo planejado no domínio. Em **Mapa → Materiais → PDFs da região**, o aluno pode vincular ou desvincular um exemplar próprio. PDFs de editora salvos pelo painel passam pelo mesmo índice. O original fica na biblioteca local. Cada domínio mantém um índice SQLite FTS5 separado em `resources/regional-readings.sqlite`. Na aula, o BM25 busca pela pergunta e pelos títulos da habilidade nas obras vinculadas à região. Uma pergunta livre pode consultar os livros vinculados ao domínio inteiro.

O bloco **Leitura da região** traz até dois trechos com título, seção quando disponível e página física ou intervalo de páginas da seção extraída. Ele ocupa até 700 tokens estimados dentro do mesmo orçamento do turno. A busca requer texto extraível e correspondência lexical. Um PDF digitalizado sem camada de texto aparece marcado no painel. Desvincular o livro interrompe sua recuperação naquela região e conserva o original na biblioteca pessoal.

Quando a aula salva um turno, a memória registra as falas visíveis com um recibo por sessão e mensagem nativa. Reprocessar uma sessão recupera pendências sem duplicar as falas. A extração valida as citações na fonte e a consolidação atualiza os fatos e o modelo do aluno. O diário continua ligado ao encerramento de sessão. A prática consulta a memória do domínio e o modo Geral usa o fluxo original.

As chamadas de fundo usam o modelo configurado para extração e o auditor para julgar conflitos, com a política de uso do provedor e o orçamento diário do domínio. Quando a conexão ou a cota impede a extração, as mensagens originais ficam no SQLite para uma tentativa posterior. A exclusão de uma sessão também remove suas falas e dados derivados da memória, inclusive na exclusão em lote pela biblioteca.

O adaptador de consulta foi portado da integração TypeScript do Hindsight, com a licença preservada em `THIRD_PARTY_NOTICES.md`. A atualização do modelo mental usa as operações do DeepTutor já portadas no núcleo. Os testes de integração usam os critérios de recuperação entre sessões e atualização de conhecimento do LongMemEval e verificam o texto efetivamente recebido pelo modelo. [Hindsight, código-fonte](https://github.com/vectorize-io/hindsight/blob/f6038a742743243c2df4a90b5b0542715f320359/hindsight-integrations/eve/src/provider-core.ts#L159-L175) · [Hindsight, ACL 2026](https://aclanthology.org/2026.acl-demo.27/) · [DeepTutor, operações](https://github.com/HKUDS/DeepTutor/blob/4c1e000d8563c5ac3b231baaaf149dc4dc4d2406/deeptutor/services/memory/ops.py) · [LongMemEval, ICLR 2025](https://arxiv.org/abs/2410.10813)

## Como testar

```bash
node scripts/run-tests.mjs "tests/memory-*.test.ts" tests/tutor-memory-flow.test.ts
```

Os testes usam diretórios temporários e modelos injetados. `memory-turn-store` verifica migração, repetição e recuperação de falhas. `memory-background-call` verifica admissão e orçamento. `tutor-memory-flow` exercita a entrega entre aulas pelo agente real com provedor simulado.

| Arquivo | O que testa |
|---|---|
| `memory-core.test.ts` | Determinismo de RRF/RSF e MMR com fast-check; supersessão e invariantes; ops atômicas; aterramento; orçamentos do `assembleContext` e do `packRecall`; tempo pt/en. |
| `memory-db.test.ts` | Isolamento entre dois domínios; "tensao" → "tensão" via FTS; `valid_to` no fato antigo; citação inexistente descartada; orçamentos de recall e contexto; forget soft e hard; consolidação idempotente com ops inválidas; diário e "Retomada"; export; reabertura; troca de modelo de embedding. |
| `memory-perf.test.ts` | 5k mensagens: `ingestTurn` p50 < 5 ms e recall p50 < 200 ms (medido: ≈ 0,1 ms e ≈ 5 ms). |
| `memory-server.test.ts` | Hash-embedder; embedder lazy com módulo falso; `extractJson`; retry corretivo; `ops-invalid`; `createMemoryService`. |
| `memory-review.test.ts` | Regressões da revisão adversarial (abaixo): `endSession` best-effort; embedding com falha volta à fila; recall × forget concorrente; hard forget sem resto em disco (varredura de bytes de todos os arquivos, nas duas ordens de fontes); soft forget de sessão; fatos de sessão; contador de extração; roteamento do serviço; "desde outubro"; FTS em fatos; propriedades de orçamento (fast-check); reabertura sem vetores esquecidos. |

## Revisão adversarial

Bugs encontrados e corrigidos (cada um tem teste em `memory-review.test.ts` ou `memory-db.test.ts`):

1. `endSession` abortava na primeira etapa que falhasse: sem diário, sem `ended_at`, e a "Retomada" da sessão seguinte sumia. Agora é best-effort.
2. Um lote de embeddings que falhava era descartado da fila até reabrir o arquivo. Agora volta para `pendingEmbed`, e o vetor de item esquecido no meio do caminho não é gravado.
3. Recall concorrente com forget: o hard forget fazia o recall lançar `TypeError`, e o soft deixava vazar o item esquecido. A elegibilidade é reconferida após o último `await`.
4. Hard forget deixava rastros: o texto do fato rejeitado ficava no `audit` (`reject`), o `after_json` de `DUPLICATE` copiava o texto, fatos sobreviventes mantinham citação e id de mensagem esquecida, o `-wal` não era truncado e o diário de uma sessão esvaziada sobrevivia.
5. Soft forget de uma sessão inteira deixava o diário e o log de observação no prefixo estável seguinte.
6. Fatos com `scope = "session"` vazavam para outras sessões.
7. Os contadores de tokens pendentes (extração e observação) eram zerados ao fim do lote, perdendo os turnos ingeridos enquanto o extrator rodava. Agora são recontados do arquivo.
8. Soft forget mantinha a linha de `embeddings`, e reabrir o arquivo ressuscitava o vetor do item esquecido.
9. `DomainMemoryService.endSession` ia sempre para o domínio ativo; encerrar uma sessão depois de trocar de domínio falhava ou gravava o diário no arquivo errado.
10. "desde outubro" virava o mês civil fechado, em vez do intervalo até agora.
11. Fixtures de `memory-db.test.ts` citavam a mensagem cortada no meio da palavra (`text.slice(0, 24)`), o que o aterramento estrito descarta. Dois testes falhavam; as fixtures agora citam palavras inteiras.

Lacunas conhecidas (não corrigidas nesta revisão):

- O MMR não semeia 1 item por tipo.
- O cold start do r4 L11 não existe (decisão acima).
- `misconception` com polaridade −1 não resolve o fato anterior.
- Fatos de escopo `global` não são escritos no banco de perfil.
- O extrator não tem backoff exponencial nem limite de 5 tentativas.
- Só episódios são arquivados.
- `buildContext` pode listar em `items` um item de recall que o teto total cortou do texto.
- `fitLines` mantém o começo de uma linha recente maior que o orçamento.
- A resolução de entidades usa só chave exata.
## Retrieval check on public conversation histories

We ran the app's SQLite recall path on the first two non-abstention questions in each of the six LongMemEval-S categories, using the full conversation history for each question (40–53 sessions). Each case got a fresh database. Only speaker, text, session and timestamp entered the index. Gold evidence labels were used for scoring after retrieval. The default 2,000-token recall budget applied. [LongMemEval protocol](https://github.com/xiaowu0162/LongMemEval#-dataset-format) · [Dataset revision](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/tree/98d7416)

| Retrieval configuration | Cases returning a relevant session | Gold evidence turns returned | Cases returning all gold turns |
| --- | ---: | ---: | ---: |
| Multilingual E5-small (q8) and the app's recall channels | 12/12 | 17/25 | 8/12 |
| Deterministic hash embeddings with the same pipeline | 12/12 | 18/25 | 7/12 |

In multi-session case `6d550036`, E5 returned a relevant conversation but missed all four annotated turns. A tutor that needs an exact detail should inspect the source or ask the learner when the retrieved passage is insufficient. This sample measures retrieval from raw history. Generated answers, background extraction, abstention, and educational outcomes require separate evaluations. It does not establish a benchmark ranking.

To reproduce, download `longmemeval_s_cleaned.json` and run `node --import tsx scripts/evaluate-study-memory.ts <file> e5 2` or replace `e5` with `hash`. The script creates temporary databases and caches the public embedding model next to the dataset. It uses no provider account.
