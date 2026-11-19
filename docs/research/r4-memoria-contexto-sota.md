# R4 — Memória de contexto de longo prazo para agentes LLM: SOTA (nov/2026) e arquitetura recomendada para o learnharness

> Data de corte da pesquisa: **2026-11-18**. Escopo: benchmarks e sistemas de memória de longo prazo para agentes LLM, com foco no que é **integrável num app desktop TypeScript/Electron local** (fork do learnharness, AGPL-3.0-only) e na aplicação a **tutoria / learner modeling**.
>
> Documentos irmãos: `r2-knowledge-tracing-srs-kst.md` (modelo do aluno BKT×FSRS por nó, `Evidence`, `NodeState`) e `r3-geracao-curriculo-grafo.md` (grafo de currículo). Este R4 **não** redefine o modelo de domínio do aluno: ele define a camada de memória que **alimenta** e **consome** o learner model do R2.

---

## 0. TL;DR

1. **Não existe um SOTA neutro.** Os números de manchete (LongMemEval-S 94–96%, LoCoMo 92–94%) são quase todos **auto-reportados**, com modelos de resposta e juízes diferentes. LoCoMo tem **~6,4% de gabarito errado** (teto honesto ≈ 93,6%), e o juiz LLM aceita até ~63% de respostas propositalmente erradas. LongMemEval-S (~115k tokens) cabe no contexto de modelos atuais: o Gemini 3 Pro **sem memória** faz 92,0%. Esses dois benchmarks estão **saturados**. Hoje quem separa os sistemas é **BEAM (10M tokens)**, **LongMemEval-V2**, **MemoryArena**, **StateMemBench** e **MemoryAgentBench**.
2. **Auto-reportado (topo, nov/2026):** Agent Zero Memory e Chronos (95,6% LME-S, sem código), Mastra Observational Memory (94,87% LME-S, TS, Apache-2.0), Hindsight (94,6% LME-S, 92,0% LoCoMo, 75,0 / 71,1 / 73,9 / **64,1% BEAM 100K/500K/1M/10M**, MIT), Mem0 nova (94,4% LME, 92,5% LoCoMo, 64,1% BEAM-1M, 48,6% BEAM-10M, ~7k tokens/consulta, só na plataforma gerenciada) e EverMemOS (93,05% LoCoMo em tabela padronizada). No BEAM, o maior número publicado agora é do **past.dev** (fechado): 92,08 / 89,63 / 90,65 / **85,03%**, com `gpt-5.6-luna` respondendo **e** julgando, na página do próprio vendor. Seguem Graphon (83,3 / – / 80,7 / 73,0, sem método publicado) e Exabase M-1 (76,9 / – / 75,0 / 68,0, harness fork do Hindsight não publicado).
3. **Único harness multi-sistema com a mesma configuração** (OmniMemEval, da MemTensor, snapshot de nov/2026: resposta `gpt-4.1-mini`, juiz `gpt-4o-mini`). Os números despencam em relação ao auto-reportado: Mem0 cloud tem **56,0%** em LME-S (contra 94,4% declarado), Hindsight 72,2%, Letta 77,7%, EverOS 80,4% e MemOS 89,2% (conflito de interesse: a MemTensor roda o harness). O topo é o **Maasv (fechado)**, com 91,2% em LME-S e 65,1% em BEAM-10M, **sem nenhuma chamada LLM na ingestão**. Ele usa registros crus com timestamp, retrieval híbrido e renderização cronológica. O Mnemon (MIT, TS) mostra a mesma tese, "raw records + julgamentos rápidos": 91,7% em LoCoMo com ~3,8k tokens.

   **Os melhores open-source nesse harness são todos "raw-first + híbrido local"** (linhas rodadas por contribuidores):
   - **cachly** (Apache-2.0, TS + Valkey): 89,6 LME-S e **90,7 LoCoMo**, o 1º do harness em LoCoMo;
   - **LCM-X** (MIT, Python, "lossless": guarda todo turno): 87,0 LME-S e **63,3 BEAM-10M**, o melhor OSS em 10M (o Hindsight faz 59,8);
   - **ThreadAtlas** (MIT): 87,0 LME-S e 88,9 LoCoMo, com fatos datados verificados contra a passagem-fonte;
   - **CPersona** (MIT): **um arquivo SQLite, zero LLM dentro**, FTS5 trigram + vetor bge-m3. Fez 89,6 LME-S com 4,3k tokens, numa corrida própria com o mesmo pipeline.

   O piso "SQLite + FTS + vetor + tempo" chega a ~87–90% em LME-S com 4–5k tokens. É praticamente a arquitetura que recomendamos.
4. **Lições que movem o ponteiro:**
   - Guardar **registros crus com tempo** sempre.
   - Fazer retrieval **híbrido**. O BM25 sozinho empata com HippoRAG-v2 e **supera** Mem0, Zep e Cognee no MemoryAgentBench.
   - Normalizar o **tempo** (datas absolutas, intervalos).
   - Tratar **supersessão** com modelo bitemporal, sem sobrescrever.
   - Rodar **consolidação offline** ("sleep", "dreaming", observations).
   - Respeitar o **orçamento de tokens** no pacote injetado.
   - Usar um **prefixo estável e cacheável** (Observational Memory).
   - Usar **modelos de decisão pequenos** para os micro-julgamentos.
   - Verificar cada fato extraído contra a fala-fonte. O **HaluMem** mostra que a alucinação nasce na **extração e na atualização**: em *Dynamic Update*, o Mem0 faz 42%, o Supermemory 16% e o melhor (EverOS) 80,6%.
   - **Cold start com contexto cheio.** O **ConvoMem** (Salesforce, 75k perguntas) mede contexto cheio em 70–82% contra Mem0 em 30–45%, com históricos de até ~150 conversas. A memória só compensa depois desse ponto.
   - Problema **ainda aberto**: esquecimento seletivo multi-hop. Todos ficam em 1–7%, exceto o GPT-5-mini com 28%. Personalização também segue aberta: no PersonaMem-v2, todos os sistemas ficam em ≤ 40,6%.
5. **Tutoria:** DeepTutor (arXiv 2604.26962) mede o ganho da memória num tutor: OQ 3,80 → 3,91 e personalização 4,22 → 4,59. A literatura de 2026 (survey Springer, IntelliCode, TASA, MERIT) converge num ponto: **a memória conversacional não dá um mastery calibrado**. O certo é o LLM converter diálogo em **evidência por nó** para um estimador determinístico, que é exatamente o desenho do R2.
6. **Recomendação (uma só):** **implementação TypeScript nativa, in-process, "raw-first"**, inspirada em Hindsight (TEMPR: 4 canais + RRF + rerank + orçamento) e Mastra OM (log de observações cacheável). Inclui:
   - camada **bitemporal** estilo Graphiti/Zep;
   - **grafo de entidades ligado aos nós do currículo**;
   - **consolidação periódica**, com observations e mental models;
   - **ponte com o learner model do R2**;
   - **cold start com contexto cheio** até ~40k tokens por domínio (ConvoMem);
   - **aterramento determinístico de cada fato extraído** por `quote` verificado na fonte (HaluMem, ThreadAtlas);
   - ferramenta agêntica com ***progressive disclosure*** (claude-mem);
   - fusão **RRF ou RSF** configurável (CPersona).

   Armazenamento e modelos:
   - **SQLite via `node:sqlite`**. Verifiquei: o Electron 44.9.3 do projeto embute o Node 24.22.0 e o SQLite 3.53.4, com FTS5 funcionando, então não precisa de módulo nativo. Há fallback para `better-sqlite3` 13.2.0.
   - **FTS5** com `unicode61 remove_diacritics 2`, que casa "tensao" com "tensão".
   - Vetores em **BLOB float32 + cosseno em JS** até ~100k vetores por domínio; **sqlite-vec 0.1.9** é opcional.
   - **Embeddings locais via transformers.js 4.3.2**. Login com ChatGPT/Claude por assinatura normalmente **não** dá endpoint de embeddings.
   - **Um arquivo SQLite por domínio**, com `session_id` em tudo.
   - **Sidecar (Hindsight/Honcho/MemOS server) não é recomendado.** Exigiria Python (uv), Postgres ou Neo4j, processos extras e 24–43k tokens de contexto por consulta (Hindsight no AMB e no OmniMemEval), sem ganho comprovado em harness neutro.
   - As referências TS mais próximas para **ler e portar ideias** (não para embutir) são:
     - MemOS local plugin (MIT; better-sqlite3 + transformers.js);
     - TencentDB Agent Memory (MIT; TS + SQLite + sqlite-vec; pipeline L0→L3; já tem plugin para o **Pi**, o mesmo runtime do learnharness);
     - claude-mem (Apache-2.0; busca em 3 passos com *progressive disclosure*);
     - Mastra OM (Apache-2.0).

---

## 1. Método, fontes e limitações

- **Fontes primárias lidas:**
  - Papers no arXiv: Hindsight 2512.12818 (texto completo das seções 3, 4 e 7); EverMemOS 2601.02163 (tabelas 1–3); Zep 2501.13956; MemoryAgentBench 2507.05257 (HTML); DeepTutor 2604.26962 (HTML); LightMem 2510.18866; BEAM 2510.27246; LongMemEval-V2 2605.12493; StateMemBench 2608.19652; Agent Zero Memory 2608.29606; Mnemon 2609.36059; Chronos 2603.16862; MERIT 2603.22289; TASA 2511.15163; IntelliCode 2512.18669; Always-On Agents 2606.30306.
  - READMEs e código via `gh api` em 2026-11-18: mem0, graphiti, letta, letta-code, MemOS (incluindo `apps/memos-local-plugin`: schema SQL, ALGORITHMS.md, package.json), A-mem, MIRIX, memobase, cognee, supermemory, LightMem, MemoryOS, hindsight, EverOS, Memori, langmem, memU, Second-Me, honcho, mastra (`packages/memory/.../observational-memory/constants.ts` e `ARCHITECTURE.md`), Mnemon, OmniMemEval (tabelas de resultados), agent-memory-benchmark (manifest de resultados e provider `hybrid_search.py`).
  - Páginas de produto e pesquisa: mem0.ai (state-of-ai-agent-memory-2026), mastra.ai/research/observational-memory, hindsight.vectorize.io (BEAM, models, SDK Node), plasticlabs.ai (Benchmarking Honcho), supermemory.ai/research.
  - **Revisão 2 (mesma data, segunda passada):**
    - OmniMemEval: `docs/user_memory/benchmark_results/{halumem,personamem-v2,beam,longmemeval,locomo}.md` e as páginas de proveniência `maasv.md`, `lcmx.md`, `threadatlas.md` e `cachly.md` (repo atualizado em 2026-11-17).
    - Leaderboards de vendor: past.dev/benchmarks/beam e benchmarks.hindsight.vectorize.io.
    - Agent Memory Leaderboard (AML): README e site.
    - Abstracts no arXiv: HaluMem 2511.03506, ConvoMem 2511.10523, EvoMemBench 2605.18421, StructMemEval 2602.11243, MemBench 2506.21605, MemoryArena 2602.16313, TutorLLM 2502.15709 e Agent4Edu 2501.10332. Também rechequei LME-V2, StateMemBench, Agent Zero e Mnemon.
    - READMEs e manifests: claude-mem, TencentDB-Agent-Memory (`MemoryCore/package.json`, `pi-plugin/README.md`), CPersona (+ página de arquitetura), OpenViking e tigerless-labs/agent-memory.
    - Versões: mem0 `mem0-ts/package.json` 3.3.1 (peer `better-sqlite3`), releases de sqlite-vec, better-sqlite3, transformers.js e chrono-node.
- **Repositórios locais em `_refs/`** (somente leitura, nada executado):
  - `DeepTutor/deeptutor/services/memory/*`: L1 trace JSONL, L2/L3 markdown com citações em nota de rodapé, consolidator `update`/`audit`/`dedup`.
  - `DeepTutor/deeptutor/services/learning_journal/models.py`.
  - `open-mastery/README.md`.
  - `BloomTutor/backend/app/tracing.py`.
- **Verificação local do ambiente:**
  - `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe` reportou Node **24.22.0**, Electron **44.9.3** e SQLite **3.53.4**. `node:sqlite` e FTS5 funcionam.
  - No Node 24.12 local, testei FTS5 com `unicode61 remove_diacritics 2` (a consulta `tensao` encontrou "tensão"), o tokenizer `trigram` e `loadExtension` disponível.
  - **Revalidado na revisão 2**, com o binário do Electron do projeto: `node:sqlite` com `allowExtension: true`, FTS5 `unicode61 remove_diacritics 2` (a consulta `tensao` encontrou "Tensão de ruptura do diodo") e `db.loadExtension` presente.
- **Limitações:**
  1. Na revisão 2, a cota de buscas web da sessão já estava esgotada, e a ferramenta de busca do arXiv (`paper-search-mcp`) retornou vazio. Por isso, as fontes novas foram lidas por URL direta: abstracts no arXiv, `gh api` e páginas de vendor. HaluMem, ConvoMem, EvoMemBench, StructMemEval e MemBench estão descritos pelo **abstract** e, no caso do HaluMem e do PersonaMem-v2, pelas tabelas do OmniMemEval. Os números internos dos papers não foram lidos. LoCoMo-Plus e STATE-Bench (Microsoft) continuam sem verificação primária.
  2. Quase todos os números são **auto-reportados**. Marquei a proveniência em cada tabela.
  3. Os rankings mudam mês a mês. Os números valem para o snapshot de nov/2026.

Legenda de proveniência usada abaixo: **[V]** auto-reportado pelo vendor ou autor; **[H]** harness multi-sistema com configuração fixa (ainda que rodado por alguém com interesse); **[P]** paper com baselines padronizados pelos autores.

---

## 2. Benchmarks: o que medem e quão confiáveis são

### 2.1 Catálogo

| Benchmark | Ano / venue | O que mede | Tamanho | Status em nov/2026 |
|---|---|---|---|---|
| **LoCoMo** (snap-research) | 2024 | QA sobre conversas longas humano-humano: single-hop, multi-hop, temporal, open-domain (a cat. 5 adversarial costuma ser excluída) | 10 conversas, ~9k tokens/conv (50 no total em versões), 1.540 perguntas não adversariais | **Saturado e com ruído.** Auditoria: 99/1.540 gabaritos errados (6,4%), teto ≈ 93,6%; juiz aceita até ~63% de respostas propositalmente erradas ([locomo-audit](https://github.com/dial481/locomo-audit), [Penfield](https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer)). Dataset **CC BY-NC 4.0**. |
| **LongMemEval** (ICLR 2025) | 2024 | 5 habilidades: extração de informação, multi-sessão, temporal, *knowledge update*, abstenção. Splits S (~115k tokens, ~50 sessões), M (~1,5M, ~500 sessões), Oracle | 500 perguntas | **Saturado no S.** Gemini 3 Pro em contexto cheio faz 92,0% ([Honcho](https://plasticlabs.ai/blog/research/Benchmarking-Honcho)). Versão *cleaned* de 2025/09. Dataset **MIT**. |
| **LongMemEval-V2** (2605.12493; preprint "work in progress"; código Apache-2.0 + leaderboard público em 2 tiers) | mai/2026 | Memória de agente web em ambientes customizados: estado estático e dinâmico, *workflow knowledge*, *gotchas*, consciência de premissas | 451 perguntas, histórias de até **115M tokens** | **Difícil.** Melhor: AgentRunbook-C, 72,5% em média (74,9 Small / 70,1 Medium). Agente de código: 69,3. Melhor RAG: 48,5. LLMs sem evidência de trajetória: ≤14,1%. |
| **BEAM** (ICLR 2026, 2510.27246) | out/2025 | Conversas sintéticas de 100K, 500K, 1M e **10M** tokens; ~10 habilidades de memória; métrica *nugget* (0 / 0,5 / 1) | 100 conversas, 2.000 perguntas | **O mais discriminante hoje.** Baseline do paper: LIGHT (episódica + working memory + scratchpad), de +3,5% a +12,7% sobre baselines. Dataset **CC BY-SA 4.0**. |
| **MemoryAgentBench** (ICLR 2026 segundo o README; 2507.05257 v4 de jun/2026) | jul/2025 | 4 competências: Accurate Retrieval, Test-Time Learning, Long-Range Understanding, **Selective Forgetting / Conflict Resolution** | Datasets reformulados + EventQA + FactConsolidation | **Mostra que memória "estruturada" não bate RAG simples** (ver 2.3). |
| **MemBench** (2506.21605, ACL Findings 2025) | jun/2025 | Dois níveis de memória (factual e reflexiva), dois cenários (participação e observação) e três eixos de métrica (efetividade, eficiência e capacidade) | — (não está no abstract) | Menos usado em 2026; nenhum vendor relevante reporta. |
| **PersonaMem / v2** (2504.14225) | 2025 | Personalização: rastrear preferências que evoluem; o v2 tem 7 tipos, incluindo **ask_to_forget** (1.048 q.) e sensitive_info | 32k / 128k / 1M | **Ninguém resolve.** No OmniMemEval: MemOS 40,6 · Maasv 39,9 · Supermemory 39,6 · Hindsight 38,0 · Mem0 36,8 · Letta 35,1 · Zep 32,3 · Cognee 26,5. O EverOS declara 53,25 no paper. |
| **HaluMem** (2511.03506, v3 jan/2026, MemTensor) | nov/2025 | Alucinação **por operação**: extração, atualização e QA. Tipos: *fact recall*, *boundary* (abster-se), *conflict*, *generalization*, *multi-hop*, *dynamic update* | Medium e Long: ~15k pontos de memória, ~3,5k perguntas, 1,5k–2,6k turnos por usuário, > 1M tokens | Conclusão do paper: os sistemas **acumulam alucinação na extração e na atualização**. Tabela OmniMemEval na §2.3(f). |
| **ConvoMem** (2511.10523, Salesforce) | nov/2025 | 6 categorias: fatos do usuário, recordação do assistente, abstenção, preferências, mudanças temporais e conexões implícitas | **75.336** pares QA | Contexto cheio: **70–82%**, inclusive nos casos difíceis multi-mensagem. Mem0: **30–45%** com < 150 conversas. Pontos de virada: até ~30 conversas o contexto longo é o melhor; até ~150 ainda é viável; depois disso, híbrido ou RAG. |
| **EvoMemBench** (2605.18421, NeurIPS 2026) | mai/2026 | Escopo (intra vs. inter-episódio) × conteúdo (conhecimento vs. execução); 15 métodos de memória, protocolo padronizado | — | "Baselines de contexto longo **continuam muito competitivos**"; "nenhuma forma de memória funciona em todos os cenários". RAG vence em conhecimento; memória procedural, em execução. |
| **StructMemEval** (2602.11243, v4 out/2026) | fev/2026 | Se o agente **organiza** a memória: livros-razão, listas de tarefas, árvores | — | RAG simples falha. Agentes de memória resolvem **quando instruídos sobre a estrutura**; LLMs nem sempre a reconhecem sozinhos. Isso apoia ancorar a memória na **árvore do currículo**. |
| **AML (Agent Memory Leaderboard)** | jul/2026– | Plataforma com contrato fixo (o participante só implementa `Add` e `Search`; o modelo de resposta é travado). Trilhas Textual (6k+ instâncias, 32 fontes, ~300M tokens), Coding e Multimodal | — | Ciclo 1 (12/08/2026), Textual: MemoraX v0.5 58,02 · MemOS v2.0.1 45,89; melhor open-source InvMem 45,06. **Ciclo 2 sai em 2026-11-19**, um dia depois deste corte. |
| **LifeBench** (2603.03781) | 2026 | Memória de "vida" de longo prazo | 2.003 perguntas (EN) | Hindsight 71,5% [V]; MemOS 55,2% [paper]. |
| **MemoryArena** (2602.16313) | 2026 | Memória **agêntica** multi-sessão: compras, planejamento de viagem com preferências, busca progressiva, raciocínio formal sequencial | HF `ZexueHe/memoryarena`, CC-BY-4.0 | Sistemas que saturam LoCoMo **vão mal** aqui. |
| **StateMemBench** (2608.19652) | ago/2026 | **Estado atual vs. superado**: fatos, restrições e decisões revisados | 234 cenários | Melhor: StateMem, 0,363 de acurácia de estado atual (DeepSeek-V4-Flash), contra 0,205 do melhor baseline. O wrapper soma de +32 a +67 pontos em 6 backends. **Muito relevante para o aluno, cujo domínio muda.** |
| **PrecisionMemBench** | 2026 | Retorno exato de crenças (o ruído conta como falha), sem LLM de resposta | 77 casos | Hindsight 85,7% [V]; Mem0, Zep e A-Mem ~11,7% (baselines "não verificados"). |
| DMR (MemGPT) | 2023 | Recuperação de memória profunda | 500 | Obsoleto: Zep 98,2 e contexto cheio 98,0 com gpt-4o-mini. |
| Outros citados (não aprofundados) | 2025–26 | STATE-Bench (Microsoft, conclusão de tarefa), LoCoMo-Plus, SupportBench e SDEBench (vectorize-io/hindsight-datasets: agentes de suporte e de código) | — | Sem verificação primária nesta revisão. |

### 2.2 Por que desconfiar dos números de manchete

- **Juiz, modelo de resposta e prompt variam.** Trocar só o modelo de resposta mexe vários pontos. O próprio Mem0 já reportou 74% e 92,5% para "o mesmo" LoCoMo. O Zep aparece com 58,4, 66,0, 75,1, 84 ou 94,7, conforme quem mede. O Zep 94,7 usou gpt-5.4 para responder e para julgar.
- **Tuning por benchmark.** O Honcho ajusta *batch size* e *dreaming* por benchmark e reconhece isso ([Plastic Labs](https://plasticlabs.ai/blog/research/Benchmarking-Honcho)).
- **Plataforma ≠ OSS.** O README do Mem0 avisa que os números são da **plataforma gerenciada** "com otimizações proprietárias indisponíveis no SDK open-source".
- **Contexto gigante "esconde" a memória.** No AMB, o Hindsight injeta em média **43,6k tokens** por pergunta no LME-S e **36,2k** no LoCoMo. No OmniMemEval, o graphiti-zep injeta **117k** no LME-S. Quanto mais contexto, mais o desempenho vem do LLM de resposta e menos da memória.
- **O adaptador importa.** No OmniMemEval, o Hindsight tira 14,29% em *single-session-assistant*, o que indica que o adaptador não ingeriu falas do assistente. O Memori tira 20,8% no LME. São falhas de integração, não do algoritmo.

### 2.3 Resultados

**(a) LongMemEval-S (500 q.)**

| Sistema | Score | Modelo de resposta | Tokens/consulta | Proveniência |
|---|---|---|---|---|
| Agent Zero Memory | 95,60 | 8 LLMs (não nomeados) | — | [V] paper sem código |
| Chronos High / Low | 95,60 / 92,60 | 8 LLMs | — | [V] paper sem código |
| Mastra Observational Memory | **94,87** (gpt-5-mini); 93,27 (gemini-3-pro); 84,23 (gpt-4o) | idem; juiz gpt-4o | ~30k (prefixo cacheável) | [V] |
| Hindsight | 94,6 (AMB, Gemini); 91,4 (Gemini-3 resposta) / 89,0 (OSS-120B) / 83,6 (OSS-20B) no paper | Gemini / GPT-OSS | 43,6k (AMB) | [V], com reprodução declarada por Virginia Tech e Washington Post |
| Mem0 (algoritmo abr/2026, plataforma) | 94,4 | não divulgado | 6,8k; p50 1,09 s | [V] |
| Mnemon | 94,4 (DeepSeek-V4.1-Flash); 83,8 (gpt-4.1-mini) | idem | <4k | [V] MIT/TS |
| Honcho | 90,4 (Haiku 4.5); 92,6 (Gemini 3 Pro); LME-M 88,8 (98 q.) | idem | mediana 5% do contexto (~12,6k médio) | [V] |
| Gemini 3 Pro, contexto cheio, **sem memória** | 92,0 | — | 115k | [V] (Honcho) |
| Supermemory | 85,2 (gemini-3) / 84,6 (gpt-5) / 81,6 (gpt-4o); alega "97%" com Recall@20 agregado | — | — | [V] |
| EverMemOS | 83,0 | gpt-4.1-mini | 2,8k | [P] |
| Zep | 71,2 (gpt-4o) / 63,8 (gpt-4o-mini) | — | 1,6k; 2,58 s | [P] |
| Contexto cheio gpt-4o | 60,2 | — | 115k; 28,9 s | [P] |
| **OmniMemEval** (gpt-4.1-mini, juiz gpt-4o-mini) | Maasv **91,2** (fechado, 0 LLM na memória) · cachly 89,6 · MemOS 89,2 · LCM-X 87,0 · ThreadAtlas 87,0 · EverOS 80,4 · graphiti-zep 79,8 (117k tokens!) · mem9 78,0 · Letta 77,7 (49k) · Hindsight 72,2 (29,8k) · Supermemory 66,1 · MemMachine 63,6 · Viking 61,1 · **Mem0 56,0** · Cognee 51,8 · Memori 20,8 | — | ver colunas no repo | [H] ([OmniMemEval](https://github.com/MemTensor/OmniMemEval/blob/main/docs/user_memory/benchmark_results/longmemeval.md)) |
| CPersona 2.6.11 pro / lite (MIT, 1 arquivo SQLite, **0 LLM**, bge-m3 + FTS5 trigram) | **89,6** / 82,2 | gpt-4.1-mini, juiz gpt-4o-mini (pipeline OmniMemEval, corrida própria) | 4,3k / 1,0k | [V] em harness [H] |
| Backboard.io · Zep (pesquisa própria) | 93,4 · 90,2 | não padronizado | — / 4,4k | [V] |
| **AMB** (Gemini resposta e juiz) | Hindsight 94,6 · **hybrid-search 74,0** (Qwen3-Embedding-0.6B + BM42 + RRF, chunks de 512, top-50, **sem LLM na ingestão**) | — | 43,6k / 23,2k | [H] rodado pela Vectorize ([manifest](https://github.com/vectorize-io/agent-memory-benchmark)) |

**(b) LoCoMo (1.540 q. não adversariais)**

| Sistema | Score | Proveniência |
|---|---|---|
| Zep 94,7 (gpt-5.4 responde e julga) · Mem0 92,5 (7,0k tokens, p50 0,88 s) · Hindsight 92,0 (AMB) · Honcho 89,9 · MemMachine v0.2 91,7 (gpt-4.1-mini) · Mnemon 91,7 (gpt-4.1-mini, ~3,8k tokens) · MemOS 88,83 · Memori 87 (721 tokens) | ver coluna | [V] |
| **EverMemOS 93,05** · Zep 85,22 · MemOS 80,76 · MemU 66,67 · Mem0 64,20 · MemoryOS 60,11 (gpt-4.1-mini; tokens 2,3k / 1,4k / 2,5k / 4k / 1k / 5,5k) | tabela padronizada | [P] EverMemOS paper |
| Hindsight 85,67 (OSS-120B) / 89,61 (Gemini-3) · Memobase 75,78 · Zep 75,14 · Mem0-Graph 68,44 · Mem0 66,88 · LangMem 58,10 · OpenAI 52,90 · Letta 74,0 (gpt-4o-mini, blog) | baselines copiados de relatórios | [P]/[V] |
| **OmniMemEval:** cachly 90,7 · ThreadAtlas 88,9 · MemOS 88,8 · Maasv 87,7 · Cognee 83,5 · EverOS 82,8 · Hindsight 82,0 · LCM-X 78,8 · Mem0 77,7 · Letta 77,1 · MemMachine 73,9 · mem9 73,6 · Supermemory 73,5 · MemoryLake 72,5 · Viking 69,3 · **Zep 63,8** · Memori 41,3 · Backboard 22,4 | mesma config | [H] |
| **AMB:** Hindsight 92,0 · Cognee 80,3 (n=152) · **hybrid-search 79,1** | Gemini | [H] |

**(c) BEAM**

| Sistema | 100K | 500K | 1M | 10M | Proveniência |
|---|---|---|---|---|---|
| past.dev (fechado) | **92,08** | **89,63** | **90,65** | **85,03** | [V] página própria; `gpt-5.6-luna` responde **e** julga; usa as dicas das anotações do dataset |
| Graphon (fechado, sem método publicado) | 83,3 | — | 80,7 | 73,0 | [V] via past.dev (lido em 13/11/2026) |
| Exabase M-1 (harness fork do Hindsight, não publicado) | 76,9 | — | 75,0 | 68,0 | [V] via past.dev |
| Hindsight | 75,0 (página atual; 73,4 no AMB anterior; 86,2 citado pelo past.dev) | 71,1 | 73,9 | **64,1** | [V] AMB; retrieval de 5–15 s, 17–27k tokens |
| Mem0 (plataforma) | — | — | 64,1 | 48,6 | [V] ~6,7–6,9k tokens |
| Honcho | 63,0 | 64,9 | 63,1 | 40,6 | [V] |
| MemOS | — | — | — | 56,75 | [V]/[H] |
| LIGHT / RAG (Llama-4-Maverick) | 35,8 / 32,3 | 35,9 / 33,0 | 33,6 / 30,7 | 26,6 / 24,9 | [P] paper BEAM |
| **OmniMemEval (nugget):** Maasv 76,4 / **65,1** · LCM-X (MIT, OSS) 71,8 / **63,3** · ThreadAtlas 73,1 / – · cachly 73,0 / – · Viking 70,8 / 58,1 · Mem0 70,4 / 43,3 · Hindsight 70,2 / 59,8 · Letta 69,2 / 52,3 · graphiti-zep 68,7 / 56,1 (176k tokens no 10M!) · MemOS 66,9 / 56,8 · mem9 65,8 / 57,3 · Supermemory 66,0 / 52,5 · MemMachine 64,8 / 51,9 · Cognee 59,3 / 56,0 · EverOS 58,6 / 47,7 | 100K / 10M | | | | [H] |

**(d) MemoryAgentBench (ICLR 2026), médias por competência, gpt-4o-mini para RAG e agentes**

| Grupo | AR | TTL | LRU | SF/CR | Geral |
|---|---|---|---|---|---|
| GPT-5-mini contexto longo | 74,4 | — | 66,2 | 53,0 | **60,6** |
| BM25 | 60,5 | 44,5 | — | 25,5 | **41,5** |
| HippoRAG-v2 | 65,1 | 35,8 | — | 29,5 | 41,6 |
| MemGPT/Letta | — | 40,8 | — | 15,5 | — |
| MIRIX (gpt-4.1-mini) | 63,0 | — | 40,5 | — | — |
| Zep · GraphRAG · Mem0 · Cognee | — | — | — | Mem0 10,0 | 24,0 · 23,4 · 21,1 · 20,6 |
| FactConsolidation **multi-hop** | a maioria fica em **1–7%** (GPT-4o 5, BM25 3, MemGPT 3, MIRIX 2); GPT-5-mini 28 | | | | |

**(e) Tutoria**

| Fonte | Achado |
|---|---|
| DeepTutor (2604.26962), TutorBench: 270 tarefas, 90 perfis, aluno simulado Gemini-3-Flash, juiz Claude Sonnet 4.6 | OQ completo 3,91 · sem memória 3,80 · sem RAG 3,73 · sem os dois 3,70. A memória pesa sobretudo em **Personalização** (4,59 → 4,22), *Fitness* (3,35 → 3,15) e *Groundedness* (2,96 → 2,80). |
| TutorLLM (2502.15709) | KT (MLFBK, BERT) + RAG + LLM: **+~10% de satisfação** e **+~5% em quiz** contra o LLM puro. É evidência de que **estado do aluno explícito** + recuperação ajuda. |

**(f) HaluMem-Medium no OmniMemEval** (mesma config; 3.467 q.; *context tokens* = média enviada ao modelo de resposta)

| Sistema | Fact recall | Boundary | Conflict | Multi-hop | **Dynamic update** | Geral | Tokens |
|---|---|---|---|---|---|---|---|
| EverOS (Apache-2.0) | 87,8 | 88,9 | 90,0 | 86,4 | **80,6** | **88,7** | 10,8k |
| Letta | 85,9 | 83,5 | 85,7 | 84,3 | 71,1 | 85,4 | **45,3k** |
| Hindsight (MIT) | 78,4 | 87,5 | 86,6 | 81,3 | 73,9 | 84,0 | 14,8k |
| ThreadAtlas (MIT) | 75,3 | 92,6 | 88,4 | 78,3 | 55,6 | 83,8 | 3,1k |
| Maasv (fechado, 0 LLM) | 71,7 | 91,9 | 87,5 | 79,8 | 62,8 | 82,3 | 2,2k |
| graphiti-zep | 69,4 | 89,1 | 88,4 | 79,8 | 62,2 | 81,7 | 5,4k |
| LCM-X (MIT) | 73,1 | 89,7 | 86,0 | 78,8 | 62,8 | 81,7 | 2,0k |
| MemOS | 69,0 | 91,3 | 86,5 | 74,2 | 55,0 | 80,9 | 1,2k |
| Mem0 cloud | 56,3 | 91,9 | 74,8 | 68,7 | 42,2 | 73,6 | 0,8k |
| Cognee | 52,4 | 92,5 | 74,6 | 69,7 | 35,6 | 72,6 | 9,0k |
| Supermemory · Memori · MemMachine | 25,2 · 20,9 · 20,4 | ~93–97 | 34–45 | 24–42 | **11–16** | 47–53 | 1–3k |

Leitura: *Boundary* (abster-se) é fácil para quase todos, porque quem recupera pouco "não sabe" e acerta por omissão. A coluna que importa para um tutor é **Dynamic update** ("o aluno *agora* sabe X?"). Nela, só sistemas que guardam episódio cru **e** fazem consolidação passam de 70: EverOS (MemCells + Markdown como fonte da verdade) e Hindsight (observations). Sistemas que só guardam fatos extraídos ficam em 11–42.

**(g) PersonaMem-v2 no OmniMemEval:** o máximo é **40,6** (MemOS). Maasv 39,9, Supermemory 39,6, Hindsight 38,0, Mem0 36,8 e Letta 35,1, com Letta gastando 30,9k tokens. Em *ask_to_forget*, MemOS faz 57,8, Maasv 53,2 e Mem0 24,3. **Personalização implícita e "esqueça isso" seguem sem solução.** O nosso `forget` explícito com confirmação na UI (§7.6.6) é necessário, e não opcional.

### 2.4 Veredito "quem é SOTA agora"

- **LongMemEval-S e LoCoMo:** empate técnico no teto (92–96% auto-reportado). O benchmark parou de discriminar. No harness comum (OmniMemEval), o topo é um sistema **fechado e sem LLM na ingestão** (Maasv, 91,2 LME). Logo atrás vêm **cachly** (Apache-2.0, TS + Valkey: 89,6 LME / 90,7 LoCoMo), **MemOS** (89,2 / 88,8), **CPersona pro** (MIT, SQLite, 89,6 LME, corrida própria), **ThreadAtlas** (MIT: 87,0 / 88,9) e **LCM-X** (MIT: 87,0 / 78,8).
- **HaluMem (alucinação e atualização), no harness comum:** EverOS 88,7 > Letta 85,4 (45k tokens) > Hindsight 84,0 > ThreadAtlas 83,8.
- **BEAM-10M (escala real de 1 ano de estudo):**
  - auto-reportado: **past.dev 85,03** (fechado; mesmo modelo responde e julga) > Graphon 73,0 > Exabase 68,0 > **Hindsight 64,1** (o melhor open-source auto-reportado);
  - harness comum: Maasv 65,1 (fechado) > **LCM-X 63,3** (MIT, o melhor open-source; corrida única de contribuidor, revisão do modelo via OpenRouter não confirmada) > Hindsight 59,8 > Viking/OpenViking 58,1 (AGPL-3.0).
- **Open-source com a evidência mais ampla e consistente:** **Hindsight** (MIT). É o 1º ou 2º em todos os benchmarks do AMB e o 3º no HaluMem do harness comum. Tem paper com coautores acadêmicos, viewer público de resultados e LongMemEval reproduzido externamente segundo o README. Ressalvas: em harness de terceiros cai para 72–84% e injeta 15–30k tokens por consulta.
- **Melhor custo/benefício open-source no harness comum:** os "raw-first" **cachly**, **LCM-X**, **ThreadAtlas** e **CPersona**, com 87–90% em LME-S usando 4–5k tokens. Nenhum é embarcável em TS/Electron sem Python, Valkey ou serviço extra, mas **o desenho é reproduzível**.
- **Melhor TypeScript-nativo:** **Mastra Observational Memory** (Apache-2.0; 94,87% LME-S auto-reportado). Como referências de engenharia local:
  - **MemOS local plugin** (TS, `better-sqlite3`, transformers.js, MIT no `package.json`);
  - **TencentDB Agent Memory** (MIT, TS, SQLite + `sqlite-vec`, L0→L3; só PersonaMem 48 → 76% auto-reportado);
  - **claude-mem** (Apache-2.0, TS, 118k★; SQLite + Chroma, sem benchmark público de memória).

---

## 3. Fichas dos sistemas

> Metadados do GitHub coletados em 2026-11-18 (estrelas, licença SPDX, linguagem, último push).

### 3.1 Tabela comparativa

| Sistema | Licença | Linguagem | Infra / deps | Local em Electron? | LLM na ingestão | Números-chave | Notas |
|---|---|---|---|---|---|---|---|
| **Hindsight** (vectorize-io/hindsight, 61,7k★) | **MIT** | Python (+ clientes TS/Go) | PostgreSQL + pgvector (ou pg0 embarcado; Oracle 23ai); daemon HTTP em :8888; SDK Node `@vectorize-io/hindsight-all` **lança via `uvx`** (Python/uv obrigatórios) | Só como **sidecar** Python | Sim: extração narrativa, entidades, tempo, causalidade; observations em background | LME-S 94,6; LoCoMo 92,0; BEAM 73,4 / 71,1 / 73,9 / 64,1; PersonaMem 86,6 [V]; [H] Omni LME 72,2 / BEAM-10M 59,8 | Suporta provedores `openai-codex` (ChatGPT Plus/Pro) e `claude-code` (Pro/Max) **sem API key**. Modelos próprios (nov/2026): `hs-decide-1-flash` 0,8B Apache-2.0, `hs-rerank-1` 114M MIT, `hs-embed-1` 112M MIT 384-d, 8 idiomas **incluindo PT**, int8 ONNX. Bancos isolados ("banks"), *disposition*, MCP por banco. |
| **Mem0 / Mem0g** (mem0ai/mem0, 69,2k★) | Apache-2.0 | Python + **TS (`mem0ai` npm)** | OSS TS: vector store `memory` = **better-sqlite3** (força bruta) + histórico SQLite; outros stores (Qdrant, pgvector…) | **Sim** (embarcável) | Sim: algoritmo v3 de abr/2026, "single-pass **ADD-only**", fatos do agente de 1ª classe, entity linking em coleção `_entities`, retrieval multi-sinal (semântico + BM25 + entidade) | [V] LoCoMo 92,5 / LME 94,4 / BEAM-1M 64,1 / 10M 48,6 a ~7k tokens (plataforma). Paper ECAI 2025: Mem0 66,88, Mem0g 68,44, p95 1,44 s vs 17,12 s em contexto cheio, ~90% menos tokens. [H] Omni: LME 56,0, LoCoMo 77,7 | O v3 **removeu o grafo e as `relations`**. O OSS não tem as "otimizações proprietárias". Sem bitemporalidade explícita. |
| **Zep / Graphiti** (getzep/graphiti, 32,9k★) | Apache-2.0 | Python | **Neo4j 5.26 / FalkorDB (ou falkordblite) / Neptune** | Não (grafo externo) | Sim: entidades, fatos e invalidação por LLM | [P] DMR 94,8; LME 71,2 (gpt-4o), 2,58 s, 1,6k tokens; [H] Omni LME 79,8 (117k tokens), LoCoMo 63,8 | **Modelo bitemporal de referência:** `t_valid`, `t_invalid` (linha T do mundo) e `t'_created`, `t'_expired` (linha T' do sistema). Episódios → entidades/fatos → comunidades (label propagation). Busca cosseno + BM25 + BFS; rerank RRF, MMR, distância de nó, menções e cross-encoder. |
| **Letta (MemGPT) / Letta Code** | Apache-2.0 | **TypeScript** (letta-code); o servidor V1 em Python foi arquivado | Letta Cloud (padrão) ou backend local | Sim, mas é um **harness de agente concorrente** do pi-agent-core | Agente reescreve os próprios *memory blocks*; "dreaming" (sleep-time compute); **MemFS**: contexto versionado em git | LoCoMo 74,0 (gpt-4o-mini, filesystem) [V]; [H] Omni LME 77,7 (49k tokens) | O dreaming automático vem **desligado no Windows nativo**. Bom para ideias (blocks, MemFS), não para embutir. |
| **MemOS** (MemTensor/MemOS, 12,4k★) | Apache-2.0 (repo); **plugin local `@memtensor/memos-local-plugin` MIT** | Python (servidor) + **TypeScript (plugin local)** | Servidor: Neo4j + Qdrant. Plugin: **better-sqlite3 13 + @huggingface/transformers 4.2 + FTS5 trigram + cosseno força bruta em JS** | **Sim (plugin)** | Sim: L1 traces → L2 políticas → L3 world model → skills | [V] LoCoMo 88,83; LME 89,20; BEAM-10M 56,75; HaluMem 80,91 (OmniMemEval, harness próprio) | O plugin é ótima **referência de código**: migrations SQL, RRF k=60, MMR λ=0,7, decaimento 0,5^(Δt/30d), corte relativo 0,4 e filtro LLM *fail-closed*. Foca em memória de **tarefa e skill**, não em aluno. |
| **Mastra Observational Memory** (`@mastra/memory` 1.41, Apache-2.0) | Apache-2.0 (exceto `ee/`) | **TypeScript** | Storage do Mastra (LibSQL, PG, etc.) e `@mastra/core` | Sim, mas acopla o framework Mastra | Sim, em background: **Observer** (a 30.000 tokens de mensagens) e **Reflector** (a 40.000 tokens de observações); buffer a cada 20%, ativação de 80% | [V] LME-S 94,87 (gpt-5-mini) / 93,27 / 84,23; contexto médio ~30k; compressão ~6× em texto | **Sem retrieval por turno.** O prefixo estável aproveita o *prompt caching* (4–10× mais barato). Log com prioridades 🔴🟡🟢 e 3 datas por observação. Algoritmo portável (prompts + limiares). |
| **EverMemOS → EverOS** (14k★) | Apache-2.0 | Python | Markdown (fonte da verdade) + SQLite + LanceDB | Só via sidecar Python | Sim: MemCells (episódio + fatos atômicos + "Foresight") → MemScenes → recordação reconstrutiva agêntica | [P] LoCoMo 93,05 / LME 83,0; [H] Omni LME 80,4, LoCoMo 82,8, BEAM-10M 47,7 | A segmentação semântica de episódios supera janelas fixas: 89,16 vs 87,55 (Fixed-Token-512) vs 84,52 (1024). Saturação em N=10 cenas e K=10 episódios. |
| **Honcho** (plastic-labs, 8,2k★) | **AGPL-3.0** (compatível com o nosso AGPL) | Python (FastAPI) + SDK TS | PostgreSQL + pgvector (+ Redis opcional) | Sidecar | Sim: *deriver* (modelos pequenos), *dreaming*, endpoint de chat agêntico; **representações por "peer"** (teoria da mente) | [V] LME-S 90,4 / M 88,8; LoCoMo 89,9; BEAM 63,0 / 64,9 / 63,1 / 40,6 | O README usa literalmente o exemplo "tutor" e "learning styles". Ótimo conceito de *peer representation*; a infra é pesada. |
| **Supermemory** (31,7k★) | MIT (repo) | TypeScript | Cloud; "Supermemory local" (`npx supermemory local`, :6767, embeddings `Xenova/bge-base-en-v1.5`, Ollama opcional) | Parcial (binário/engine; abertura do engine a verificar) | Sim | [V] LME 81,6–85,2 (relatório Hindsight); claim de 97% com Recall@20; [H] Omni LME 66,1, LoCoMo 73,5 | Embedding padrão apenas em inglês. |
| **Cognee** (33,4k★) | Apache-2.0 | Python (+ SDK TS) | Padrão local: **SQLite + LanceDB + Kùzu** | Sidecar | Sim (grafo de conhecimento) | [V] BEAM 0,79 (100K, 20 q.) / 0,67 (10M, exploratório); [H] LoCoMo 83,5, LME 51,8; MemoryAgentBench 20,6 | Números de BEAM não comparáveis, como o próprio README admite. |
| **LightMem** (zjunlp, ICLR 2026) | MIT | Python | — | Sidecar | Sim, com compressão sensorial e *sleep-time update* offline | [P] até +7,7% / +29,3% de acurácia; até 38× / 20,9× menos tokens; até 30× / 55,5× menos chamadas | Ideia útil: **separar consolidação do caminho online**. |
| **A-MEM** (NeurIPS 2025) / FlexA-Mem (out/2026) | MIT | Python | ChromaDB | Sidecar | Sim: notas Zettelkasten com links e evolução | [H] Omni/TiMem LME ~63,4 | FlexA-Mem expande notas *in place* sob orçamento (2610.33274). |
| **MIRIX** | Apache-2.0 | Python | **PostgreSQL** (BM25 nativo) + Neo4j opcional (hipergrafo de proveniência) | Sidecar | Sim: 6 tipos (core, episódica, semântica, procedural, resource, knowledge vault) | Paper: LoCoMo ~85,4 (gpt-4.1-mini) [V]; MemoryAgentBench AR 63,0 | — |
| **Memobase** | Apache-2.0 | Python | FastAPI + Postgres + Redis | Sidecar | Sim: **perfil do usuário** + eventos com timeline; buffer descarregado a 1.024 tokens ou 1 h ocioso; 3 chamadas LLM fixas | LoCoMo 75,78 (v0.0.37) [V] | Útil como desenho de "perfil + eventos". |
| **MemoryOS** (BAI-LAB, EMNLP 2025 Oral) | Apache-2.0 | Python | — | Sidecar | Sim: hierarquia curto, médio e longo prazo | [V] LoCoMo F1 +49,11%, BLEU-1 +46,18% sobre baselines; [P] 60,11 na tabela do EverMemOS | — |
| **Memori** (MemoriLabs) | Apache-2.0 (README; o GitHub mostra NOASSERTION) | Python | "SQL-native" | Sidecar | Sim | [V] LoCoMo 87% a **721 tokens/consulta**; [H] Omni LoCoMo 41,3 / LME 20,8 | A discrepância enorme sugere adaptador ou config. |
| **LangMem** | MIT | Python | LangGraph store (InMemory / AsyncPostgres) | Sidecar | Sim | LoCoMo 58,10 [P via Mem0] | — |
| **memU** | Apache-2.0 | Python (+ npm) | SQLite (cosseno força bruta) ou Postgres + pgvector | Sidecar | Sim | — | — |
| **Second Me** (mindverse) | Apache-2.0 | Python | Treino local de modelo pessoal (HMM + Me-alignment) | Não se aplica | — | — | Não é camada de memória; último push em 2025-09. |
| **Mnemon** (Grivn/mnemon-memory-agent) | **MIT** | **TypeScript** | Store genérico com busca híbrida datada; `nomic-embed-text` local; decisor **Jev** via API paga (TypeSafe) | Sim (conceito) | **Não**: registros crus; consolidação de background em linhas do tempo e histórico de valores | [V] LoCoMo 91,7 / LME 83,8 (gpt-4.1-mini); 94,4 LME com DeepSeek | Snapshot de pesquisa (4★). Tese "System 1 / System 2" valiosa. |
| **Agent Zero Memory** (2608.29606) | sem código | — | 3 stores: timeline de eventos, grafo entidade-evento, memória documental com *citation locking* | — | Sim | [V] LME 95,60; LoCoMo 93,60; custo 20× menor | *Intent gate*, roteador de fonte, abstenção quando falta evidência. |
| **Chronos** (2603.16862) | sem código | — | Calendário de eventos SVO com intervalos de data + calendário de turnos; loop de tool calls | — | Sim | [V] LME 95,6 / 92,6 | O calendário de eventos sozinho responde por +58,9% sobre o baseline. |
| **StateMem** (2608.19652) | — | — | Estado-primeiro: supersessão e dependências | — | Sim | [P] 0,363 vs 0,205 | Wrapper de 1 chamada aplicável a qualquer backend. |
| **Maasv** | **fechado** | — | Serviço local | — | **Não** (0 chamadas LLM) | [H] LME 91,2; LoCoMo 87,7; BEAM 76,4 / 65,1 com 4–8,6k tokens | Retorna memórias **da mais antiga para a mais nova**, com `[YYYY-MM-DD HH:MM · #n]` e um cabeçalho "uma afirmação posterior pode revisar uma anterior". |
| **LCM-X** (electricsheephq/lcm-x, 164★, v0.28.0) | **MIT** | Python | Plugin "source-imported" do Hermes Agent; store local; `fastembed` (`BAAI/bge-small-en-v1.5`) | Sidecar | Mínimo: "lossless", **todo turno fica** no store, sem compactar | [H] LME 87,0 (5,2k tokens); LoCoMo 78,8; **BEAM 71,8 / 63,3** (9,6k); HaluMem 81,7 | Melhor OSS em BEAM-10M no harness comum. Tese: não compactar, só indexar e buscar. |
| **cachly** (cachly-dev/cachly-mcp) | Apache-2.0 | **TypeScript** | **Valkey** (Redis fork) + serviço de embedding; MCP + serviço HTTP `aml-service` (contrato AML `memory-api-v1.1`) | Parcial (exige Valkey) | Registros de texto escritos pelo agente | [H] LME 89,6; **LoCoMo 90,7 (1º)**; BEAM-100K 73,0 | Feito para agentes de código. |
| **ThreadAtlas** (jhffmn82/threadatlas) | MIT | Python | Store por usuário: fatos datados + chunks de 256 tokens + linhas de keyword + vetor | Sidecar | Sim: lê fatos com LLM e **checa cada fato contra a passagem de origem** | [H] LME 87,0; LoCoMo 88,9; BEAM-100K 73,1; HaluMem 83,8 | Busca: vetor + keyword fundidos por rank + **2 hops no grafo**, devolvendo fatos **com a passagem-fonte ao lado**; 0 LLM na busca. |
| **CPersona** (Cloto-dev/CPersona, v2.6.11) | MIT | Python (MCP) | **1 arquivo SQLite** (WAL, schema v21): `memories`, `episodes`, `profiles`, `entities`/`relations`, FTS5 **trigram**; bge-m3 ONNX 1024-d via servidor HTTP opcional | Sidecar (mas é o desenho mais parecido com o nosso) | **Não** ("nenhum modelo de linguagem dentro") | [V/H] LME 89,6 pro (4,3k tokens) / 82,2 lite (1,0k); LoCoMo 84,0 | Fusão **RRF** ou **RSF** (normaliza e soma os scores; preserva a magnitude do BM25). *Quality gate* calibrado (devolve vazio se nada passa). Isolamento `agent_id` / `project_id` / `channel`. Degrada para keyword sem embeddings e **avisa**. |
| **claude-mem** (thedotmack, 118k★, v16) | Apache-2.0 | **TypeScript** (worker em Bun) | SQLite `~/.claude-mem/claude-mem.db` + **Chroma** (requer `uv`/Python para vetores) | Parcial | Sim: um *observer* agent transforma atividade em observations e resume a sessão | — (sem benchmark de memória) | **Progressive disclosure:** `search` (índice, ~50–100 tokens por resultado) → `timeline` (contexto cronológico) → `get_observations(ids)` (~500–1.000 tokens por item). Ótimo molde para a nossa ferramenta `memory_search`. |
| **TencentDB Agent Memory** (31k★, MemoryCore 1.0.2-beta) | MIT (arquivo LICENSE; o GitHub mostra NOASSERTION) | **TypeScript** | MemoryCore: SQLite + **`sqlite-vec` 0.1.7-alpha.2** (ou MongoDB / Tencent VDB), `@node-rs/jieba`, AI SDK; stack Core + Hub + **Proxy** (Docker) | Parcial: o core é TS, mas o produto é um proxy de equipe | Sim: pipeline assíncrono **L0 Conversa → L1 Átomo → L2 Cenário → L3 Persona** | [V] PersonaMem 48 → 76% | Recall em camadas: L2/L3 dão o *bootstrap*; fatos específicos caem para **BM25 + vetor + RRF** em L1/L0, com teto de itens, caracteres e **timeout**. Tem `pi-plugin` para o **Pi (earendil-works)**. |
| **OpenViking** (volcengine, 42k★) | **AGPL-3.0** | Python | "Context database": memória + RAG + skills | Sidecar | Sim | [H] LME 61,1; LoCoMo 69,3; **BEAM 70,8 / 58,1**; HaluMem 77,4 | É o "Viking" das tabelas do OmniMemEval. |
| MemMachine · mem9 · tigerless agent-memory | Apache-2.0 · Apache-2.0 (TS) · MIT | Python · TS · Python | — · OpenClaw · **Markdown como fonte da verdade** + ranking local | Sidecar | Sim | [H] MemMachine LME 63,6; mem9 LME 78,0 / BEAM-10M 57,3 | Sem destaque em harness comum. |

### 3.2 Leitura técnica dos líderes

**Hindsight (TEMPR + CARA)**, conforme o paper 2512.12818:

- **Unidade de memória:** `f = (u, b, t, v, τs, τe, τm, ℓ, c, x)`:
  - `u` = id; `b` = banco; `t` = texto narrativo; `v` = embedding;
  - `τs`/`τe` = intervalo de ocorrência; `τm` = momento da menção;
  - `ℓ ∈ {world, experience, opinion, observation}`;
  - `c` = confiança (opiniões); `x` = metadados, incluindo `access_count`.
- **Extração narrativa:** 2–5 fatos auto-contidos por conversa, em vez de fragmentos. Passos: correferência, normalização temporal ("semana passada" → intervalo absoluto), participantes, justificativas, tipo e entidades. Antes de embutir, acrescenta uma referência temporal legível.
- **Resolução de entidades:** `ρ(m) = argmax_e α·sim_str + β·sim_co + γ·sim_temp`.
- **Links:**
  - entidade (w = 1);
  - temporal (`w = exp(−Δt/σt)`);
  - semântico (cosseno ≥ θs);
  - causal (`causes`, `caused_by`, `enables`, `prevents`; w = 1, multiplicador µ > 1).
- **Recall em 4 canais paralelos:**
  - vetor (HNSW pgvector);
  - BM25 (GIN full-text);
  - grafo por **ativação espalhada**: `A(fj,t+1) = max[A(fi,t)·w·δ·µ(ℓ)]`, com sementes nos top semânticos;
  - temporal: parser de regras com fallback em `flan-t5-small`, filtro por sobreposição de intervalo e score `1 − |mid_f − mid_Q| / (Δτ/2)`.

  Depois: **RRF (k = 60)**, **cross-encoder** `ms-marco-MiniLM-L-6-v2` e **empacotamento por orçamento de tokens** `Σ|fi| ≤ k`.
- **Observations:** resumos por entidade, regenerados em background quando chegam fatos novos. A versão atual mantém evidência com citações exatas e contagem de provas, e é *refinada*, nunca sobrescrita.
- **Mental models / Pages:** "respostas permanentes" a perguntas fixas, reescritas em background. Ler uma é uma leitura de banco, sem LLM. Podem ser projetadas como markdown, o que encaixa no Obsidian (meta 4).

**Mastra OM:**

- Defaults verificados no código (`packages/memory/src/processors/observational-memory/constants.ts`):
  - `observation.messageTokens = 30_000`, `maxTokensPerBatch = 10_000`;
  - `bufferTokens = 0.2`, `bufferActivation = 0.8`;
  - `reflection.observationTokens = 40_000`, `reflection.bufferActivation = 0.5`;
  - modelos `google/gemini-2.5-flash` (Observer com temperatura 0,3; Reflector com 0).
- Layout do contexto: `prompt` + instruções + `<observations>…</observations>` + tarefa atual + **mensagens recentes cruas**.
- O agente principal **nunca** consulta a memória: só lê o bloco.
- Achados próprios: multi-sessão é a categoria mais difícil (87,2%, empatado com Hindsight), e as preferências são voláteis (30 perguntas, 3,3 pontos por pergunta).

**Mem0 v3 (abr/2026):**

- Uma única chamada de extração, só ADD; nada é sobrescrito.
- A atualidade é resolvida no **retrieval temporal**, que ranqueia a instância datada correta.
- Três sinais em paralelo (semântico, BM25 e entidade) são normalizados e fundidos.
- `top_200` como orçamento de recuperação.

**Graphiti:** invalidação de arestas por LLM. Quando um fato novo contradiz um antigo com sobreposição temporal, `t_invalid(antigo) = t_valid(novo)`. Nada é apagado, e consultas "o que era verdade em X" continuam possíveis.

**EverMemOS:** segmentação semântica de episódios (MemCells) e agrupamento em cenas (MemScenes), com atualização do perfil do usuário. O ablation mostra que remover cenas (93,05 → 89,16) e células (→ 81,82 no LoCoMo) degrada a acurácia em degraus.

**Maasv e Mnemon (tese "raw-first"):** guardar registros crus datados, recuperar com busca híbrida e entregar **em ordem cronológica com data e um aviso de revisão** rende 87–91% sem nenhuma extração por LLM. É o **piso robusto** que o nosso desenho deve ter sempre, com as camadas derivadas por LLM somando em cima.

**A segunda onda raw-first (out–nov/2026), confirmando a tese:**

- **LCM-X** ("lossless", MIT) mostra que **não compactar** escala bem até 10M tokens: 63,3 em BEAM-10M com ~9,6k tokens.
- **CPersona** mostra que **SQLite + FTS5 trigram + vetor + gate calibrado, sem LLM**, chega a 89,6 LME-S. Dois detalhes portáveis:
  - **RSF** (*relative score fusion*: normalizar o score de cada canal por consulta e somar) como alternativa ao RRF, porque o RRF joga fora a magnitude do BM25;
  - **gate de qualidade** que prefere devolver vazio a devolver lixo, o que ajuda na abstenção.
- **ThreadAtlas** mostra que **verificar cada fato extraído contra a passagem de origem** e devolver o fato **com a passagem ao lado** dá 83,8 no HaluMem com só 3k tokens.
- **TencentDB** mostra o padrão **camadas como *fallback***: começa por persona e cenário (barato, estável) e só desce a átomos e conversa crua quando a pergunta pede fato específico. Respeita teto de itens, caracteres e **timeout**.
- **claude-mem** mostra o padrão de **ferramenta agêntica com *progressive disclosure*** (índice → linha do tempo → detalhes), que barateia o recall sob demanda.

---

## 4. Lições transversais (o que adotar)

| # | Lição | Evidência | Como entra no nosso desenho |
|---|---|---|---|
| L1 | **Raw-first:** nunca descartar os turnos crus, que são a fonte da verdade | Maasv 91,2 LME sem LLM; Mnemon; EverOS (Markdown como fonte da verdade); DeepTutor L1 em JSONL | Tabela `messages` + índice FTS e vetor por turno/chunk, disponível em < 50 ms após o turno |
| L2 | **Híbrido > puro vetor**; o BM25 é forte | MemoryAgentBench: BM25 41,5 ≈ HippoRAG-v2 41,6 > Mem0 21,1; AMB hybrid 74,0 / 79,1 | FTS5 (bm25) + cosseno + grafo + temporal, fundidos por RRF |
| L3 | **Tempo explícito:** datas absolutas, intervalos e "há N dias" | Chronos (+58,9% com calendário de eventos); Hindsight canal temporal; DeepTutor `recall.py` devolve `days_ago` porque o LLM erra aritmética de datas | `valid_from` / `valid_to`, parser `chrono-node` (MIT, 2.10.3, **locale pt**), renderização relativa |
| L4 | **Supersessão e bitemporalidade** | StateMemBench (+32 a +67 pontos); Graphiti; FactConsolidation multi-hop ≤ 7% | Colunas bitemporais + `superseded_by`; o retrieval filtra estado atual por padrão |
| L5 | **Consolidação offline** (sleep / dream / observations) | LightMem (38× menos tokens); Honcho dreaming; Letta sleeptime; Hindsight observations | Fila de jobs em background; nunca no caminho do turno |
| L6 | **Orçamento de tokens** e **prefixo cacheável** | Mastra OM (cache 4–10×); Hindsight `Σ|fi| ≤ k`; Mem0 ~7k | Prefixo estável (mental models + log de observações) + sufixo dinâmico ≤ 2–4k |
| L7 | **Micro-julgamentos com modelo pequeno** | `hs-decide-1-flash`: 147 → 61 US$ por mil casos; Jev 3–11× mais rápido | Papel de modelo "judge" configurável, barato, em lote |
| L8 | **Retrieval agêntico só sob demanda** | LongMemEval-V2: agente de código 72,5 vs RAG 48,5, porém com latência alta | Ferramenta `memory_search` para o tutor; o pré-fetch padrão é single-pass |
| L9 | **Separar memória conversacional do mastery calibrado** | Survey Springer 2026; IntelliCode (estado do aprendiz versionado, *single writer*); DeepTutor 𝒟w ativo/resolvido | A memória gera `Evidence` (R2 §9.3) e lê o snapshot do learner model |
| L10 | **Proveniência e abstenção** | Agent Zero (citation locking); DeepTutor (citações em nota de rodapé para traces) | Cada fato e observação aponta para `source_message_ids`; o tutor diz "não lembro" quando não há evidência |
| L11 | **Cold start com contexto cheio:** memória só compensa depois de um volume mínimo | ConvoMem: contexto cheio 70–82% vs Mem0 30–45% em < 150 conversas; EvoMemBench: "long-context continua muito competitivo"; Gemini 3 Pro sem memória faz 92% em LME-S | Modo `fullContext` por domínio enquanto o L0 do domínio cabe em `FULLCTX_MAX_TOKENS` (default 40k, prefixo cacheável). O recall entra quando passa disso (§7.6.4, passo −1) |
| L12 | **Aterrar cada fato extraído na fonte** | HaluMem: a alucinação nasce na extração e na atualização (Dynamic Update de 11–42% em sistemas só de fatos); ThreadAtlas checa cada fato contra a passagem | Campo `quote` obrigatório no extrator e verificação determinística (substring normalizada ou similaridade trigram ≥ 0,8) contra `source_msg_ids`; o que falha é descartado ou tem a confiança reduzida (§7.6.2) |
| L13 | **Recall agêntico com *progressive disclosure*** | claude-mem: índice com ~50–100 tokens por resultado, contra 500–1.000 do registro completo | `memory_search` devolve um índice compacto; `memory_get(ids)` e `memory_timeline(at)` trazem os detalhes (§7.5) |
| L14 | **Estrutura explícita > memória plana** | StructMemEval: agentes resolvem *ledgers*, listas e árvores **quando instruídos sobre a estrutura** | A memória é indexada pela **árvore do currículo** (`about → node`) e os mental models são "livros-razão" por nó e por misconception |
| L15 | **Fusão que preserva magnitude** quando um canal é muito preciso | CPersona: RSF recomendado em vez de RRF; o RRF descarta a magnitude do BM25 | `settings.memory.fusion = 'rrf' \| 'rsf'`, com default RRF e RSF testado no harness (§7.13) |

---

## 5. Memória aplicada a tutoria / learner modeling

### 5.1 Estado da arte

- **DeepTutor** (2604.26962; repo Apache-2.0 em `_refs/DeepTutor`):
  - **No paper:** o perfil 𝒟 tem três partes, cada uma mantida por um agente de memória:
    - **𝒟s Session History**: sessões datadas com assunto, dificuldade e resultado;
    - **𝒟w Weakness Diagnosis**: lacunas priorizadas *ativas* ou *resolvidas*. Uma lacuna resolve após aplicação correta em ≥ 2 sessões posteriores e reativa se a misconception volta;
    - **𝒟r Self-Reflection**: o que funcionou didaticamente com esse aluno.

    Há também uma *trace forest* (sessão → planejamento → execução) com SearchTrace, ListTraces e ReadNodes. A consolidação dispara por **pressão de contexto**.
  - **No código** (`deeptutor/services/memory/`):
    - L1 `trace/<surface>/<YYYY-MM-DD>.jsonl` (append-only);
    - L2 `L2/<surface>.md`;
    - L3 `L3/{recent,profile,scope,preferences}.md`, com bullets `- texto [^1] <!--m_ULID-->` e notas de rodapé apontando para fontes (`chat:…`, `notebook:…`);
    - consolidator com modos `update` (extração incremental por chunk), `audit` (edições de linha contra evidência crua) e `dedup`;
    - `learning_journal` com `mission{topic, why, level}`, `last_session{summary, next_focus}` e `records[]`.

    Recall "stamps-only" (sem ler corpo de mensagem) para uso no caminho interativo, com `days_ago` pré-calculado.
- **MERIT** (2603.22289): knowledge tracing **sem treino**. O LLM congelado raciocina sobre um banco de memória de padrões de erro (*paradigm bank*) com racionais CoT, com roteamento hierárquico e restrições lógicas.
- **TASA** (2511.15163, workshop AAAI 2026): persona (proficiência) + memória de eventos + **curva de esquecimento contínua** com KT, para calibrar a dificuldade.
- **IntelliCode** (2512.18669): **estado do aprendiz centralizado e versionado** (mastery, misconceptions, agenda de revisão, engajamento). Seis agentes como "transformações puras", sob política de **escritor único**.
- **Survey Springer 2026** ("What makes an LLM a tutor?"): a memória do LLM captura bem *o que o aluno diz*, mas **não produz estimativa calibrada de mastery**. A ponte sugerida é o LLM transformar diálogo em **evidência por componente de conhecimento** para um estimador separado.
- **Always-On Agents** (2606.30306): estado persistente precisa de governança (autoridade, escopo, mutabilidade, proveniência, **recuperabilidade**, acionabilidade) e de ciclo escrever → validar → … → auditar → rollback.
- **open-mastery** (`_refs`): grafo de pré-requisitos + *mastery gates* + atualizações bayesianas multi-evidência via MCP (`record_mastery`, `get_progress`).
- **Honcho:** a *peer representation* é literalmente um "modelo do outro" atualizado em background; o README usa o exemplo "tutor".
- **TutorLLM** (2502.15709): **KT neural (MLFBK) prevê o estado do aluno** e um LLM com RAG adapta a resposta a esse estado. Ganho de ~10% em satisfação e ~5% em quiz contra o LLM puro. É o mesmo princípio: o estado do aluno é um modelo separado, consumido pelo tutor.
- **Agent4Edu** (2501.10332, AAAI 2025): alunos simulados por LLM com **perfil + memória (fatos de prática + resumos de alto nível + reflexão) + ações**, calibrados com dados reais. Serve de molde para o **aluno simulado** do nosso harness TutorMem-lite (§7.13).
- **Busca em repositórios (gh, nov/2026):** não há projeto open-source maduro de "memória de agente para tutoria". Os resultados para "ai tutor memory" e afins são protótipos com 0★. O DeepTutor continua sendo a referência de código mais completa.

### 5.2 Consequência para nós

Precisamos de **dois subsistemas acoplados, com fronteira clara**:

1. **Memória (este R4).** É **episódica + semântica + temporal + grafo**. Responde a "o que aconteceu, o que o aluno disse, prefere, confundiu e decidiu, e quando". Guarda as misconceptions **como narrativa com evidência**, além de metas, preferências didáticas e o estado afetivo declarado.
2. **Learner model (R2 §9).** É **numérico, determinístico, event-sourced** e responde por `pL`, FSRS e `blame`. É a única fonte de "onde o aluno está" em termos de mastery.

A memória **emite** `Evidence` (R2 §9.3), quando o diálogo contém sinal avaliável, e **lê** o snapshot do learner model (~300 tokens, R2 §9.1) para montar os *mental models* "onde está / para onde vai / pontos fracos". Os mental models nunca inventam mastery: eles **citam** o learner model.

---

## 6. Decisão: TS nativo in-process vs. sidecar

### 6.1 Opções avaliadas

| Opção | Precisão esperada | Custo de tokens / consulta | Latência de recall | Complexidade de empacotar (Win/macOS) | Encaixe com assinaturas e modelos sem hardcode | Veredito |
|---|---|---|---|---|---|---|
| **A. TS nativo "raw-first + TEMPR + OM + bitemporal"** (recomendado) | Alvo: ≥ piso hybrid (74–79%) por construção, mais ganho das camadas LLM. Os componentes são os mesmos dos líderes | **2–4k** injetados + prefixo cacheável ≤ 10k | **~50–200 ms local** (estimado: FTS5 < 5 ms; cosseno de 50k×384 em JS ~10–20 ms; embedding da query ~15–40 ms; rerank 30 candidatos ~60–150 ms) | Baixa: `node:sqlite` já vem no Electron; transformers.js puro (ONNX/WASM); sqlite-vec opcional (5 binários npm) | Total: as chamadas passam pelo roteador pi-ai do app | **Escolhido** |
| B. Hindsight sidecar | Melhor evidência auto-reportada; 72–82% em harness de terceiros | 24–43k por consulta (Omni/AMB) | 0,67–0,96 s (AMB LME / LoCoMo); 5–15 s (BEAM) | Alta: Python + uv + Postgres/pg0 + daemon; o SDK Node chama `uvx` (baixa do PyPI em runtime) | Bom (tem `openai-codex` e `claude-code`), mas é um roteador paralelo ao nosso | Não. Usar como **referência de design** e de **avaliação** |
| C. Mem0 OSS TS embarcado | Incerto: o OSS não tem as otimizações; Omni cloud LME 56,0 | ~1–7k | Local, rápido | Baixa (better-sqlite3 nativo exige rebuild para o Electron) | Médio | Não: sem bitemporal, sem grafo (removido no v3), sem ponte com o currículo |
| D. Mastra `@mastra/memory` | LME 94,87 [V] | ~30k (cacheável) | ~0 no turno; o Observer roda async | Média: puxa `@mastra/core` e storage próprio | Médio: o Mastra tem router próprio | Não embutir. **Portar o algoritmo OM** (limiares e prompts) |
| E. MemOS local plugin | LME 89,2 (harness próprio) | 1,5–5k | Local | Média: acoplado a hosts (OpenClaw / Hermes / DSH) | Médio | Não embutir. **Reaproveitar padrões e código** (MIT) de storage e ranker |
| F. Honcho / Graphiti / Cognee / EverOS | Bons em partes | Variável (Graphiti até 117–176k) | Rede local + LLM | Alta: Postgres, Neo4j/FalkorDB ou Kùzu + Python | — | Não |
| G. TencentDB Agent Memory (MemoryCore TS) | PersonaMem 76% [V]; sem LME, LoCoMo ou BEAM | Limitado por item, caractere e timeout | Local | Média-alta: stack Core + Hub + Proxy, `@node-rs/jieba` (tokenizador chinês), sqlite-vec alpha; foco em equipe e ACL | Fraco: o padrão é um **proxy** de LLM com chave própria | Não embutir. **Ler** o pipeline L0→L3 e o recall em camadas |
| H. Raw-first Python (CPersona, LCM-X, ThreadAtlas) via MCP | 87–90% LME-S [H], 4–5k tokens | 1–10k | Local | Média: Python + uv + servidor de embeddings | Bom (sem LLM ou com LLM próprio) | Não. Ficam como **evidência** de que a opção A funciona, e o desenho é portado |

### 6.2 Justificativa resumida

- **Precisão:**
  - O piso "híbrido sem LLM" já entrega 74,0% (LME-S) e 79,1% (LoCoMo) com um modelo forte respondendo [H AMB]. O Maasv mostra que um raw-first bem feito chega a 91,2% / 87,7% / 65,1 (BEAM-10M) [H].
  - O que os líderes somam (extração narrativa, supersessão, observations, canal temporal e grafo) é implementável em ~4–6k linhas de TS (estimativa).
  - Não há evidência neutra de que um sidecar Python bata isso. No harness comum, o Hindsight self-hosted ficou em 72,2% (LME) e 82,0% (LoCoMo).
  - A segunda onda do OmniMemEval reforça o ponto: os quatro melhores open-source (cachly 89,6, CPersona 89,6, ThreadAtlas 87,0 e LCM-X 87,0 em LME-S) são **raw-first + FTS + vetor (+ grafo raso)**, com 4–5k tokens. É exatamente a fase F1–F2 do roadmap (§7.14).
- **Custo:** num tutor, o recall roda **a cada turno**. Com 24–43k tokens por consulta (Hindsight) contra 2–4k (alvo), a diferença por dia de estudo de ~120 turnos é de ~3–5M contra ~0,15–0,3M tokens de input no modelo principal (ver §7.12).
- **Latência:** o recall local em < 200 ms permite pré-fetch síncrono antes de cada resposta. Sidecars de 0,7–15 s obrigariam a fazer o recall de forma assíncrona e defasada.
- **Complexidade e operação:**
  - Um processo, um arquivo SQLite por domínio e zero serviços.
  - Backup é copiar arquivo. Apagar um domínio é apagar arquivo.
  - Nada de Python ou Postgres no Windows do usuário.
- **Assinaturas:** logins ChatGPT/Claude por assinatura em geral **não** expõem endpoint de embeddings. Embeddings locais são, portanto, uma necessidade, e todas as chamadas LLM da memória precisam passar pelo **mesmo roteador de modelos** do app (meta 7: sem hardcode).

---

## 7. Especificação de implementação (para o engenheiro)

### 7.1 Visão geral

```
                    ┌──────────────────────── TURNO DO TUTOR (sync) ────────────────────────┐
 aluno ──► chat-handler ──► MemoryService.recall(ctx) ──► ContextAssembler ──► pi Agent ──► resposta
                │                 │  (≤200 ms, local)          ▲                       │
                │                 ▼                            │                       ▼
                │      [domain.db] FTS5 + vec + grafo + tempo  │             MemoryService.ingest(turn)
                │                                              │              (sync: grava + FTS; async: embed)
                ▼                                              │
        LearnerModel (R2) ◄──── Evidence ◄─────────────────────┼──────────── Extractor (async, lote)
             │  snapshot ~300 tok                              │
             └────────────────────────────────────────────────►│ MentalModels (prefixo estável)
                                                               │
                ┌──────────────── BACKGROUND (worker / jobs) ──┴──────────────────────────────┐
                │ embed · segmentar episódios · extrair fatos/sinais · resolver entidades ·   │
                │ links · supersessão · Observer/Reflector (OM) · observations · mental      │
                │ models · dedup · decaimento · auditoria · candidatos a flashcard            │
                └──────────────────────────────────────────────────────────────────────────────┘
```

Camadas de memória:

| Camada | Conteúdo | Escrita | Leitura |
|---|---|---|---|
| **L0 Raw** | `messages` (turnos crus), artefatos | Síncrona, em todo turno | Canais FTS e vetor; "ver original" |
| **L1 Episódica** | `episodes` (segmentos narrativos datados, estilo MemCell) | Async (lote) | Canais vetor, FTS e tempo |
| **L2 Semântica** | `facts` bitemporais (world, experience, learner, preference, misconception, goal, affect) + `entities` + `edges` | Async (lote) + supersessão | 4 canais + grafo |
| **L3 Consolidada** | `observations` (crenças com evidência e contagem de provas) + `mental_models` (respostas permanentes, em markdown) | Background (sleep) | Prefixo estável e consulta direta |
| **WM Working memory** | `observation_log` por sessão (estilo Mastra OM) | Async, por limiar | Prefixo da sessão |
| **LM Learner model (R2)** | `evidence` (append-only) → `node_state` (fold) | Determinística | Snapshot, prioridades |

### 7.2 Stack e dependências

| Peça | Escolha | Versão verificada | Licença | Observações |
|---|---|---|---|---|
| SQLite | **`node:sqlite`** (`DatabaseSync`) | Electron 44.9.3 → Node 24.22.0 / SQLite 3.53.4 | MIT (Node) / domínio público | Testado: FTS5, `trigram`, `allowExtension`. Ainda emite `ExperimentalWarning` no Node 24, então isole atrás de um adapter `SqlDriver` com fallback para **better-sqlite3 13.2.0** (MIT; exige `electron-rebuild`). |
| Busca textual | FTS5 `tokenize='unicode61 remove_diacritics 2'` (+ tabela `trigram` opcional para termos curtos e técnicos) | idem | — | "tensao" casa com "tensão"; `bm25()` nativo |
| Vetores | **BLOB Float32 + cosseno em JS** (força bruta, top-K com heap) até ~100k por domínio; depois **sqlite-vec 0.1.9** (`vec0` com `partition key` e colunas de metadado; float, int8 e bit) | sqlite-vec 0.1.9 (2026-03-31) | Apache-2.0 / MIT | O MemOS usa força bruta "<100k vetores → dezenas de ms"; o sqlite-vec é pré-v1 (breaking changes possíveis) |
| Embeddings locais | **transformers.js** `@huggingface/transformers` 4.3.2 num **worker thread / utilityProcess** | 4.3.2 | Apache-2.0 | Ver tabela 7.2.1 |
| Reranker | cross-encoder ONNX: `hindsight-ai/hs-rerank-1` (114M, MIT, 8 idiomas com PT, int8 ONNX; compatibilidade com transformers.js **a validar**) ou `onnx-community/bge-reranker-v2-m3-ONNX` (568M; pesado em CPU) | — | MIT / Apache | Opcional na fase 1; ligar quando houver > 30 candidatos |
| Tempo | `chrono-node` com locale `pt` e `en` | 2.10.3 | MIT | Normaliza "semana passada", "em março", "ontem à noite" para intervalos |
| Validação | `zod` (já é dependência) | 4.x | MIT | Schemas de saída do extrator e do juiz |
| SRS / KT | `ts-fsrs` (via R2) | 6.0.0 | MIT | O learner model é do R2 |
| Testes de invariantes | `fast-check` (property-based) | — | MIT | Ver §7.11 |

#### 7.2.1 Embeddings: escolha

| Modelo | Tamanho / dim | Multilíngue (PT) | transformers.js | Licença | Uso sugerido |
|---|---|---|---|---|---|
| `Xenova/multilingual-e5-small` | ~118M / 384 | Sim | Sim | MIT (modelo base) | **Default leve** (máquinas modestas); prefixos `query:` e `passage:` |
| `onnx-community/embeddinggemma-300m-ONNX` | 308M / 768 (MRL → 512/256/128) | Sim (100+ idiomas) | Sim | **Gemma Terms** (não OSI) | "Alta qualidade" (~61 MTEB-multilingual v2, segundo agregadores), **baixado sob demanda**, não empacotado |
| `onnx-community/Qwen3-Embedding-0.6B-ONNX` | 0,6B / 1024 (MRL) | Sim | Sim | Apache-2.0 | Qualidade máxima OSI (~64 MTEB-multi v2, segundo agregadores); mais lento em CPU |
| `Xenova/bge-m3` | 568M / 1024 (+ esparso) | Sim | Sim | MIT | Alternativa |
| `hindsight-ai/hs-embed-1` | 112M / 384 | 8 idiomas com PT | não marcado (int8 ONNX existe) | MIT | Candidato a testar (feito para memória) |

Regras:

- Guardar `embedding_model_id` e `dim` em `meta`.
- Trocar de modelo dispara o job `reembed_all` (o Hindsight avisa a mesma coisa).
- Normalizar os vetores L2 para que cosseno vire produto escalar.
- Para o default, quantizar com `dtype: 'q8'`.

### 7.3 Isolamento por domínio e sessão

- **Arquivo por domínio:** `<userData>/memory/<domainId>/memory.db`, em WAL. Domínios iniciais: `english` e `electronics`. Subdomínios gerados pela expansão do grafo ficam **no mesmo arquivo do domínio-pai**, com namespace de nó (ex.: `elec.analog.opamp.*`).
- **Perfil global:** `<userData>/memory/_global/profile.db`. Guarda só preferências transversais: idioma, horários, acessibilidade, tom e duração preferida de explicação. É injetado **read-only** (≤ 300 tokens) em qualquer domínio. A escrita no global exige que o fato seja classificado `scope:'global'` pelo extrator e confirmado na consolidação.
- **Sessão:** toda linha tem `session_id`. A working memory (`observation_log`) é **por sessão**. O long-term é **por domínio**, com boost de recência para a sessão atual. A flag `sessionOnly` restringe o recall à sessão.
- **Troca de domínio:** `MemoryService.open(domainId)` fecha e abre o handle (cache LRU de 2 handles). Nenhuma consulta cruza arquivos.
- **Links entre domínios:** a tabela `external_refs(domain_id, node_id, reason)` aponta pré-requisitos de outro domínio (ex.: Eletrônica → `math.fractions`). Ela **referencia** sem copiar conteúdo. O recall pode pedir ao learner model do outro domínio apenas o **snapshot numérico** do nó.
- **Encaixe no learnharness:**
  - adapters em `src/store/memory/` (I/O);
  - algoritmos puros em `src/core/memory/` (RRF, MMR, decaimento, regras de supersessão e montagem);
  - ferramentas em `src/agent/tools.ts`;
  - jobs via `src/server/jobs.ts`.

  Isso respeita as fronteiras do `eslint.config.mjs` (o core não importa I/O).

### 7.4 Schema SQL (por domínio)

```sql
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- schema_version, domain_id, embedding_model_id, embedding_dim, created_at

CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER,
  title TEXT, kind TEXT NOT NULL DEFAULT 'teaching',          -- teaching|practice|review
  focus_nodes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(focus_nodes_json)),
  summary TEXT, next_focus TEXT,                                -- handoff (DeepTutor learning_journal)
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0
) STRICT;

-- L0: turnos crus (fonte da verdade). Espelho do ChatRecord, não o substitui.
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, ts INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system_note')),
  text TEXT NOT NULL, node_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(node_ids_json)),
  tokens INTEGER NOT NULL, embedding BLOB, extracted INTEGER NOT NULL DEFAULT 0,  -- 0 pendente, 1 extraído
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','forgotten'))
) STRICT;
CREATE INDEX IF NOT EXISTS ix_msg_session ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS ix_msg_pending ON messages(extracted, ts);

-- L1: episódios (segmentos narrativos)
CREATE TABLE IF NOT EXISTS episodes(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  first_msg_id TEXT NOT NULL, last_msg_id TEXT NOT NULL,
  t_start INTEGER NOT NULL, t_end INTEGER NOT NULL,
  title TEXT NOT NULL, narrative TEXT NOT NULL,                 -- 80–250 palavras, autocontido, PT
  node_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(node_ids_json)),
  importance REAL NOT NULL DEFAULT 0.5, embedding BLOB,
  access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten'))
) STRICT;

-- L2: fatos bitemporais
CREATE TABLE IF NOT EXISTS facts(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('world','experience','learner','preference','misconception','goal','affect','plan')),
  scope TEXT NOT NULL DEFAULT 'domain' CHECK(scope IN ('domain','global','session')),
  text TEXT NOT NULL,                                           -- autocontido, com sujeito explícito
  valid_from INTEGER,  valid_to INTEGER,                        -- linha T (mundo): quando foi/é verdade
  recorded_at INTEGER NOT NULL, expired_at INTEGER,             -- linha T' (sistema)
  confidence REAL NOT NULL DEFAULT 0.7 CHECK(confidence BETWEEN 0 AND 1),
  polarity INTEGER NOT NULL DEFAULT 1 CHECK(polarity IN (-1,0,1)),  -- p/ misconception: 1 presente, -1 superada
  superseded_by TEXT REFERENCES facts(id),
  source_episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  source_msg_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_msg_ids_json)),
  quote TEXT,                                                   -- trecho literal da fonte que sustenta o fato (L12)
  grounded INTEGER NOT NULL DEFAULT 0 CHECK(grounded IN (0,1)), -- 1 = quote verificado contra source_msg_ids
  importance REAL NOT NULL DEFAULT 0.5, proof_count INTEGER NOT NULL DEFAULT 1,
  embedding BLOB, access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten')),
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_from <= valid_to),
  CHECK(expired_at IS NULL OR recorded_at <= expired_at)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_fact_current ON facts(kind, expired_at, status);
CREATE INDEX IF NOT EXISTS ix_fact_valid ON facts(valid_from, valid_to);

CREATE TABLE IF NOT EXISTS entities(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, canonical TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('concept','person','resource','tool','place','org','other')),
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json)),
  node_id TEXT,                                                 -- vínculo direto a nó do currículo, se houver
  summary TEXT, embedding BLOB, updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_canon ON entities(canonical, type);

-- Grafo heterogêneo (fato↔fato, fato↔entidade, fato↔nó, entidade↔nó, episódio↔fato)
CREATE TABLE IF NOT EXISTS edges(
  src_type TEXT NOT NULL CHECK(src_type IN ('fact','entity','episode','node')),
  src_id TEXT NOT NULL,
  dst_type TEXT NOT NULL CHECK(dst_type IN ('fact','entity','episode','node')),
  dst_id TEXT NOT NULL,
  rel TEXT NOT NULL CHECK(rel IN ('mentions','about','evidence_for','evidence_against','temporal','semantic',
                                   'causes','enables','prevents','refines','supersedes','same_as','part_of')),
  weight REAL NOT NULL DEFAULT 1.0 CHECK(weight BETWEEN 0 AND 1),
  valid_from INTEGER, valid_to INTEGER, recorded_at INTEGER NOT NULL, expired_at INTEGER,
  PRIMARY KEY(src_type, src_id, rel, dst_type, dst_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_edge_dst ON edges(dst_type, dst_id, rel);

-- L3: observations (crenças consolidadas com evidência; refinadas, nunca sobrescritas)
CREATE TABLE IF NOT EXISTS observations(
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('entity','node','learner')),
  subject_id TEXT NOT NULL, text TEXT NOT NULL,
  evidence_fact_ids_json TEXT NOT NULL CHECK(json_valid(evidence_fact_ids_json)),
  quotes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(quotes_json)),
  proof_count INTEGER NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 0.6,
  version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, embedding BLOB,
  stale INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS ix_obs_subject ON observations(subject_type, subject_id);

-- L3: mental models (respostas permanentes; markdown; exportáveis p/ Obsidian)
CREATE TABLE IF NOT EXISTS mental_models(
  id TEXT PRIMARY KEY,               -- 'where_now' | 'where_next' | 'weak_points' | 'how_learns' | custom
  question TEXT NOT NULL, answer_md TEXT NOT NULL, tokens INTEGER NOT NULL,
  cites_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(cites_json)),
  updated_at INTEGER NOT NULL, stale INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Working memory por sessão (Observational Memory)
CREATE TABLE IF NOT EXISTS observation_log(
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, text TEXT NOT NULL, tokens INTEGER NOT NULL,
  covers_until_seq INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, generation)
) STRICT;

-- Ponte com o learner model (R2): log de evidências e estado derivado
CREATE TABLE IF NOT EXISTS evidence(            -- append-only; formato = R2 §9.2 Evidence
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, at INTEGER NOT NULL, session_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  source TEXT NOT NULL CHECK(source IN ('grader','dialogue_extractor','flashcard','self_report')),
  source_fact_id TEXT REFERENCES facts(id) ON DELETE SET NULL
) STRICT;
-- node_state: tabela/projeção mantida pelo módulo do R2 (fold puro de evidence)

CREATE TABLE IF NOT EXISTS external_refs(domain_id TEXT NOT NULL, node_id TEXT NOT NULL, reason TEXT,
  PRIMARY KEY(domain_id, node_id)) STRICT;

-- Fila de jobs e auditoria (recuperabilidade)
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, run_after INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_jobs_due ON jobs(status, run_after);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, op TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, actor TEXT NOT NULL      -- 'extractor'|'consolidator'|'user'|'judge'
) STRICT;

-- Contabilidade de tokens por operação (meta 6: stats)
CREATE TABLE IF NOT EXISTS llm_usage(
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, op TEXT NOT NULL, model_id TEXT NOT NULL,
  tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cached_in INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL
) STRICT;

-- FTS5 (external content) sobre messages, episodes e facts
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  kind UNINDEXED, ref_id UNINDEXED, text,
  tokenize = "unicode61 remove_diacritics 2"
);
-- Triggers (ou escrita explícita no repo) mantêm fts em sincronia: INSERT/UPDATE/DELETE em messages/episodes/facts.

-- Opcional (quando > ~100k vetores): sqlite-vec
-- CREATE VIRTUAL TABLE vec_items USING vec0(
--   item_id TEXT PRIMARY KEY, kind TEXT PARTITION KEY, embedding float[384] distance_metric=cosine);
```

Notas:

- **Bitemporal:** `valid_from` e `valid_to` são o tempo do mundo ("o aluno confundia mA com A **de** 10/03 **até** 24/03"). `recorded_at` e `expired_at` são o tempo do sistema. "Estado atual" = `expired_at IS NULL AND (valid_to IS NULL OR valid_to > now) AND status='active'`.
- **Nunca `UPDATE` destrutivo em fatos:** supersessão = fechar `valid_to` e `expired_at` e preencher `superseded_by`. Toda mudança gera linha em `audit`.

### 7.5 API TypeScript (porta do core)

```ts
// src/core/memory/types.ts (proposta)
export type DomainId = string; export type SessionId = string; export type NodeId = string
export type FactKind = 'world'|'experience'|'learner'|'preference'|'misconception'|'goal'|'affect'|'plan'

export interface RecallContext {
  domainId: DomainId; sessionId: SessionId
  query: string                       // última fala do aluno (+ opcionalmente a pergunta do tutor)
  focusNodes: NodeId[]                // nó(s) corrente(s) do currículo
  now: number
  budgetTokens?: number               // default 2000; "deep" 4000
  mode?: 'auto'|'skip'|'deep'|'historical'   // historical inclui fatos superados
  sessionOnly?: boolean
}

export interface MemoryItem {
  kind: 'message'|'episode'|'fact'|'observation'
  id: string; text: string; at: number            // data relevante (valid_from ou ts)
  validTo?: number; superseded?: boolean
  nodeIds: NodeId[]; score: number; channels: ('vec'|'fts'|'graph'|'time'|'learner')[]
  sourceMsgIds: string[]
}

export interface RecallResult { items: MemoryItem[]; rendered: string; tokens: number; ms: number; skipped?: string }

export interface MemoryService {
  open(domainId: DomainId): Promise<void>
  ingestTurn(t: { sessionId: SessionId; role: 'user'|'assistant'|'tool'; text: string; ts: number; nodeIds: NodeId[] }): void   // síncrono e barato
  recall(ctx: RecallContext): Promise<RecallResult>
  stablePrefix(domainId: DomainId, sessionId: SessionId): Promise<{ text: string; tokens: number }>  // mental models + OM log
  endSession(sessionId: SessionId): Promise<void>      // dispara extração final + consolidação + flashcards
  consolidate(opts?: { budgetTokens?: number }): Promise<void>
  forget(sel: ForgetSelector, mode: 'soft'|'hard'): Promise<{ affected: number }>
  exportMarkdown(dir: string): Promise<void>            // mental models e observations → vault Obsidian
}
export type ForgetSelector =
  | { factIds: string[] } | { query: string; confirmIds: string[] } | { sessionId: SessionId } | { before: number } | { all: true }

// Papéis de modelo: resolvidos em runtime pelo roteador pi-ai (sem hardcode)
export type MemoryModelRole = 'extractor'|'judge'|'observer'|'reflector'|'consolidator'|'flashcards'
```

Ferramentas expostas ao tutor (pi-agent-core):

- Recall `deep` agêntico, só quando o pré-fetch não basta, com *progressive disclosure* (padrão claude-mem):
  - `memory_search({query, nodeIds?, from?, to?, includeSuperseded?, limit=10})` devolve **só um índice compacto**: `#id · [data] · kind · 1 linha ≤ 20 palavras · nós`, ~50–100 tokens por linha;
  - `memory_timeline({id | at, window: '1d'})` devolve o contexto cronológico em volta;
  - `memory_get({ids})` traz o texto completo, o `quote` e a mensagem-fonte só dos ids escolhidos.

  O custo é pago só pelo que o tutor decide ler;
- `memory_note({kind, text, nodeIds})`: o tutor registra explicitamente, por exemplo, "o aluno prefere analogias hidráulicas";
- `learner_snapshot({nodeIds})`: lê o R2.

### 7.6 Operações

#### 7.6.1 `ingestTurn` (síncrono, < 5 ms)

1. `INSERT messages` + `INSERT fts(kind='message')`.
2. Enfileirar `embed(messageId)` (worker; ~15–40 ms com e5-small q8 em CPU).
3. Atualizar o contador de tokens pendentes da sessão. Se `pending ≥ EXTRACT_BATCH_TOKENS` (default **6.000**), ou se houve inatividade ≥ 10 min, ou se a sessão terminou → `enqueue('extract', {sessionId, fromSeq, toSeq})`.
4. Se os tokens não observados da sessão ≥ `OM_OBSERVE_TOKENS` (default **12.000**, menor que os 30k do Mastra para reduzir custo por turno) → `enqueue('observe', {sessionId})`.

#### 7.6.2 `extract` (async, lote, modelo `extractor`)

**Pré-segmentação barata** (EverMemOS mostra que segmentação semântica > janela fixa): abre fronteira de episódio quando há:

- (a) gap ≥ 30 min;
- (b) mudança de `focusNodes`;
- (c) queda de similaridade entre janelas de 3 turnos, com cos < 0,55 (calibrar).

**Saída JSON**, validada com `zod`. Esqueleto:

```json
{
  "episodes": [{ "firstMsgId": "...", "lastMsgId": "...", "title": "Lei de Ohm com LED",
                 "narrative": "Em 18/11/2026 o aluno ... (80–250 palavras, autocontido)",
                 "nodeIds": ["elec.ohm","elec.led.forward_voltage"], "importance": 0.7 }],
  "facts": [{ "kind": "misconception", "text": "O aluno trata 20 mA como 20 A ao calcular resistor de LED.",
              "quote": "então R = 3 / 20 = 0,15 Ω",
              "validFrom": "2026-11-18T14:05:00-03:00", "validTo": null,
              "entities": [{"name":"corrente","type":"concept"},{"name":"miliampère","type":"concept"}],
              "nodeIds": ["math.units","elec.ohm"], "confidence": 0.8, "scope": "domain",
              "sourceMsgIds": ["m_..."], "maybeSupersedes": "texto curto do fato antigo, se o aluno revisou" }],
  "evidence": [{ "nodes":[{"nodeId":"elec.ohm","q":1,"primary":true}], "format":"dialogue", "level":3,
                 "grade":1, "graderConfidence":0.6, "attributions":[{"nodeId":"math.units","blame":0.7,
                 "misconceptionId":"mc.units.mA-vs-A"}], "sourceMsgIds":["m_..."] }],
  "flashcardCandidates": [{ "front":"...", "back":"...", "nodeId":"elec.ohm" }]
}
```

**Regras do prompt** (resumo):

- Fatos **autocontidos**, com sujeito explícito ("o aluno…") e **datas absolutas**. Pré-normalizar com `chrono-node` e passar a data da sessão.
- Narrativa, não fragmentos (Hindsight).
- `evidence` **só** quando há desempenho observável. Notas de exercícios vêm do *grader* (R2 §9.3), não daqui; aqui o peso é menor (`graderConfidence ≤ 0,6`).
- Proibido inventar mastery; proibido escrever fatos sobre o tutor que não aconteceram.

**Pós-processamento** (determinístico + `judge`):

0. **Aterramento (L12; HaluMem e ThreadAtlas), determinístico e sem LLM:**
   - normalizar o `quote` e o texto das mensagens em `sourceMsgIds` (minúsculas, sem acento, espaços colapsados);
   - `grounded = 1` se o `quote` é substring de alguma fonte, ou se a similaridade de trigramas (Jaccard sobre 3-gramas de caractere) é ≥ 0,8 contra a melhor janela de mesmo tamanho;
   - se falhar, `confidence ×= 0,5` e enfileirar o fato para o `judge` confirmar no próximo lote;
   - se o `judge` também rejeitar, descartar o fato e registrar em `audit` com `actor = 'judge'`;
   - fatos `kind = 'misconception'` e `evidence` **exigem** `grounded = 1` para virar `Evidence` do R2.

   Métrica de saúde: `% grounded` por modelo extrator, exibida no painel de stats. Ela também serve para escolher o modelo do papel `extractor`.
1. **Resolução de entidades:** canonicalizar (minúsculas, sem acento, singular simples). Usar string sim (Jaro-Winkler ≥ 0,92), embedding sim (≥ 0,85) e co-ocorrência. Ligar a `node_id` quando o nome casa com um rótulo ou alias do nó do currículo (consultar o grafo do R3).
2. **Embeddings** de episódios e fatos (worker).
3. **Arestas:**
   - `mentions` (fato → entidade);
   - `about` (fato → nó);
   - `temporal` entre fatos da mesma sessão, `w = exp(−Δt/σ)` com σ = 1 dia;
   - `semantic` se cos ≥ 0,80, limitado a top-5 por fato;
   - `causes`, `enables` e `prevents` quando o extrator marcar.
4. **Supersessão (em lote, 1 chamada `judge` por lote):** para cada fato novo, buscar os top-8 fatos **atuais** com mesmo `kind` e (mesma entidade ou mesmo nó) e cos ≥ 0,75. O juiz devolve, por par, `{DUPLICATE | UPDATES | CONTRADICTS | REFINES | INDEPENDENT}`:
   - `DUPLICATE` → `proof_count++` no antigo; o novo é descartado, com fontes anexadas ao antigo.
   - `UPDATES` / `CONTRADICTS` → `antigo.valid_to = novo.valid_from ?? now`, `antigo.expired_at = now`, `antigo.superseded_by = novo.id`, aresta `supersedes`.
   - `REFINES` → manter os dois e criar aresta `refines`.
   - Misconception resolvida → fato novo `polarity = -1` que supera o anterior (regra 𝒟w do DeepTutor: resolver só após ≥ 2 sessões com aplicação correta, **confirmado pelo learner model do R2**, não só pelo LLM).
   - Fallback barato (estilo Mem0 v3): se o juiz falhar, gravar ADD-only. O retrieval já prefere o mais recente (§7.6.4) e a consolidação faz uma varredura depois.
5. `evidence` → `LearnerModel.append()` (R2), dentro da mesma transação.
6. Marcar `messages.extracted = 1`; contabilizar em `llm_usage`; escrever `audit`.

#### 7.6.3 Working memory: `observe` / `reflect` (port do Mastra OM)

- **Observer** (modelo `observer`): recebe as mensagens não observadas da sessão e o log atual. Emite bullets datados de dois níveis, com prioridade 🔴🟡🟢 (alta: erro conceitual, decisão de plano, pedido explícito do aluno). Cada bullet guarda (data da observação, data referida, data relativa), além de "tarefa atual" e "próximo passo sugerido". Grava em `observation_log(generation+1)` com `covers_until_seq`.
- **Reflector** (modelo `reflector`): quando o log passa de `OM_REFLECT_TOKENS` (default **8.000** por sessão), reorganiza o log: funde, remove o superado e destaca padrões. Não resume mensagens cruas.
- **Por que manter OM além do recall:** dá continuidade intra-sessão sem retrieval, em prefixo **estável e cacheável**. O recall long-term cobre as outras sessões. O compaction existente (`src/core/compaction.ts`, cauda de ~20k) pode passar a usar o log OM como "resumo educacional" em vez de chamar outro resumo.

#### 7.6.4 `recall` (síncrono, alvo p50 ≤ 150 ms)

```
-1. Cold start (L11; ConvoMem): se tokens(L0 ativo do domínio) ≤ FULLCTX_MAX_TOKENS (default 40k),
    não recuperar. Injetar o L0 inteiro do domínio (sessões anteriores, cronológico, com datas) no
    prefixo cacheável e retornar. A partir do limiar, desligar e seguir o pipeline abaixo
    (histerese de 10% para não oscilar).
0. Gate de intenção (heurística barata, Agent Zero):
   skip se a fala tem < 4 tokens úteis ("ok", "continua", "sim"), se é pura resposta a item já em contexto,
   ou se mode='skip'. (Registrar a decisão para avaliação.)
1. q = embed("query: " + texto)          // worker; cache LRU por texto
   tr = chrono.parse(texto, now, pt|en)  // intervalo temporal opcional
   ents = match de entidades por alias/FTS no texto
2. Canais em paralelo (top-K cada; K=50):
   vec     : cos(q, embedding) sobre episodes ∪ facts ∪ messages (filtro estado-atual salvo mode='historical')
   fts     : bm25(fts MATCH tokens(q)) (aspas p/ termos técnicos; fallback trigram para termos < 3 chars)
   graph   : ativação espalhada a partir de sementes S = focusNodes ∪ ents ∪ top-5 vec;
             A(v,0)=1 p/ nós/ents, =cos p/ fatos; A(u,t+1)=max A(v,t)·w(v,u)·δ·µ(rel), δ=0.5, 2 hops;
             µ: about/evidence_for 1.5 · causes/enables 1.3 · mentions 1.2 · refines 1.0 · temporal 0.8 · semantic 0.7
   time    : se tr: itens com [valid_from,valid_to] ∩ tr ≠ ∅, score 1 − |mid−mid_tr|/(Δ/2)
   learner : fatos kind∈{misconception,goal,preference} ligados a nós com blame alto ou pL baixo (snapshot R2)
3. Fusão RRF: s(d) = Σ_c w_c / (60 + rank_c(d)); w = {vec:1, fts:1, graph:1, time:1.2 se tr, learner:0.8}
   (alternativa L15, `fusion='rsf'`: s(d) = Σ_c w_c · (x_c(d) − min_c)/(max_c − min_c), com x_c = score
    bruto do canal na consulta (−bm25, cos, ativação, score temporal); preserva a magnitude de match exato)
4. Prior de vida útil (multiplicativo, pós-RRF):
   s *= (0.6 + 0.4·imp) · recency, recency = 0.5^(Δdias/τ), τ = 30 (episódica/message), ∞ (semântica/preferência)
   s *= 1.15 se mesma sessão; superados excluídos (ou ×0.3 com rótulo se mode='historical')
5. Corte relativo: descartar s < 0.4·s_max (MemOS); manter ≤ 40.
6. Rerank (opcional; ≥ 15 candidatos): cross-encoder(query, texto com data) → s' = 0.7·CE_norm + 0.3·s_norm
7. MMR λ=0.7 (redundância = cos entre itens), com semeadura de 1 item por tipo (fato/episódio/mensagem) se acima do corte.
8. Empacotar até budgetTokens (default 2.000). Preferir fato/observation (denso) a mensagem crua; expandir
   para a mensagem-fonte só se o fato tem confidence < 0.6 ("ver original").
9. Renderizar EM ORDEM CRONOLÓGICA, agrupado por dia, com data absoluta + relativa:
   "## Memória relevante (mais antiga → mais recente; uma afirmação posterior pode revisar uma anterior)
    - [2026-11-04 · há 14 dias] (misconception, superada em 2026-11-12) O aluno tratava 20 mA como 20 A…
    - [2026-11-12 · há 6 dias] O aluno calculou corretamente R = (5−2)/0,02 = 150 Ω…"
10. Atualizar access_count/last_accessed_at (em lote, assíncrono). Registrar ms e tokens.
```

Os parâmetros (`K`, `w_c`, `τ`, `λ`, os limiares) ficam em `settings.memory.*`, com defaults acima, e devem ser **calibrados no harness** (§7.13).

#### 7.6.5 `consolidate` ("sleep"; background; modelo `consolidator`)

Gatilhos: `endSession`; app ocioso ≥ 15 min; diariamente na primeira abertura; quando `stale` mental models > 0.

Tarefas (ordem; cada uma com orçamento e *idempotência*):

1. **Varredura de supersessão:** clusters de fatos atuais com cos ≥ 0,85 e mesma entidade ou nó vão para o juiz. Cobre o que o ADD-only deixou passar.
2. **Dedup:** fatos com cos ≥ 0,92, mesmo `kind` e texto quase igual → merge (`proof_count` soma, fontes unidas, o perdedor recebe `expired_at` e `superseded_by`).
3. **Observations:** para cada entidade, nó ou "learner" tocado desde a última rodada, regenerar a observation **refinando** a anterior (entrada: observation atual + fatos novos + citações). Saída: texto + `evidence_fact_ids` + `quotes` + `confidence`; `version++`.
4. **Mental models** (respostas permanentes, ≤ 250 tokens cada, markdown, citando fatos e evidência):
   - `where_now`: onde o aluno está. Cita o snapshot do R2: nós dominados, fronteira e últimos episódios.
   - `where_next`: para onde vai: plano, metas (`goal`) e próximo foco (`sessions.next_focus`).
   - `weak_points`: misconceptions ativas (polarity 1, atuais) + nós com `blame` alto (R2) + padrões de erro recorrentes.
   - `how_learns`: preferências didáticas e o que funcionou ou não (𝒟r do DeepTutor), como "analogias hidráulicas funcionaram", "não gosta de 3+ perguntas seguidas" (alinha com a meta 9 de didática).
5. **Decaimento e arquivamento:** episódios e mensagens com `importance < 0,3`, `access_count = 0` e idade > 180 dias → `status = 'archived'`. Saem dos canais padrão; continuam no FTS para `mode = 'historical'`.
6. **Candidatos a flashcards** (no fim da sessão): fatos `world` e `misconception` da sessão → cartões (frente e verso) ligados ao nó → exportador Anki/Obsidian (meta 4). O R2 trata o FSRS.
7. **Auditoria semanal** (modo `audit` do DeepTutor): amostrar 20 fatos e verificar contra as mensagens-fonte. Fatos não suportados → `confidence ×= 0,5`, ou `forgotten` se forem contraditos pela fonte.
8. **Exportar markdown:** mental models e observations → `<vault>/learnharness/<domínio>/*.md` (Obsidian), no formato do DeepTutor (`- texto [^n] <!--id-->` + notas de rodapé).

#### 7.6.6 `forget`

- **Soft** (padrão; reversível):
  - `status = 'forgotten'` nos alvos e nos derivados (fatos com `source_msg_ids` todos esquecidos; observations que perdem toda a evidência são regeneradas);
  - removidos do FTS e dos vetores;
  - `audit` guarda o *before* para rollback por 30 dias.
- **Hard** (pedido explícito; irreversível): `DELETE` em cascata (mensagens → fatos e episódios derivados → arestas → evidência *dialogue_extractor* derivada) + `INSERT INTO fts(fts) VALUES('optimize')` + `VACUUM`. Domínio inteiro = apagar o arquivo.
  - A evidência do *grader* (notas de exercícios) só é apagada se o usuário pedir, porque muda o learner model. O R2 refaz o fold.
- **Automático:** não apaga nada. Só arquiva (§7.6.5-5). O "esquecimento" do aluno é modelado pelo FSRS no R2, não pela memória.
- **Por comando de voz ou texto** ("esqueça que eu disse X"): `memory_search` → confirmação na UI listando os itens → `forget(soft)`.

### 7.7 Montagem do contexto por turno

```
[system prompt do tutor (estável)]
[perfil global ≤300 tok (estável)]
[mental models do domínio ≤1.000 tok (estável até a próxima consolidação)]
[snapshot learner model do(s) nó(s) em foco ≤300 tok (muda pouco)]
[observation_log da sessão ≤8.000 tok (muda a cada ~12k tokens)]
---- fronteira de cache ----
[memória recuperada ≤2.000 tok (dinâmica; cronológica)]
[mensagens recentes cruas (cauda)]
[fala atual]
```

- A ordem "estável → dinâmico" maximiza o *prompt caching* (`docs/compaction-accounting.md` já mede o cache hit).
- O orçamento total de memória fica em ≤ ~12k tokens, contra ~30k do Mastra e 24–43k do Hindsight.

### 7.8 Integração com currículo, grafo e expansão procedural

- Todo fato, episódio e entidade pode ter `about → node`. O canal `graph` usa **as arestas do currículo** (pré-requisito, englobamento; R2 §9.2 e R3) como arestas extras, com µ = 1,0 e 1 hop, para puxar memória de pré-requisitos quando o aluno trava num nó.
- Quando a expansão procedural cria nós (R3), um job `relink_nodes` re-roda o casamento entidade → nó por alias e embedding (cos ≥ 0,8), adicionando arestas `about`. Nenhum fato é reescrito.
- Livros e vídeos ligados a regiões do grafo **não** entram nesta memória. São RAG de conteúdo (outro índice). A memória só guarda "o aluno estudou o cap. 3 de X em tal data" (fato `experience`).

### 7.9 Modelos sem hardcode e assinaturas

- Cada papel (`MemoryModelRole`) resolve para um modelo configurado no roteador pi-ai, por **capabilities**: `json_mode`, contexto ≥ 32k, custo e latência.
- Defaults: o modelo **mais barato** disponível na assinatura ativa para `extractor`, `judge` e `observer`; um modelo médio para `consolidator` e `flashcards`. O usuário pode trocar em Configurações → Memória.
- Retry com degradação: se o `judge` falhar, cai no ADD-only; se o `extractor` falhar, o L0 continua íntegro e o job volta para a fila com backoff exponencial (máx. 5 tentativas).
- Toda chamada grava em `llm_usage(op, model_id, tokens_in, tokens_out, cached_in, ms)` → painel de stats (meta 6): tokens por modelo, por operação e por dia.

### 7.10 Concorrência e processos

- **Escritor único por arquivo** (política IntelliCode): o `MemoryWorker` roda em `worker_threads` no processo do servidor Next, ou num `utilityProcess` do Electron. Ele detém a conexão de escrita; as leituras do recall usam uma conexão read-only própria (WAL permite leitores concorrentes).
- Embeddings e rerank ficam num worker separado (ONNX/WASM), para não travar o event loop.
- Fila `jobs` persistente: sobrevive a crash e é retomada no boot. Locks lógicos por `session_id` evitam observer e extract simultâneos na mesma faixa de `seq`.

### 7.11 Invariantes formais e testes

Testar com `fast-check` (property-based). A especificação pode ir para Lean 4 depois, junto com a do R2.

1. **Intervalos bem formados:** `valid_from ≤ valid_to`; `recorded_at ≤ expired_at`.
2. **Supersessão acíclica e funcional:** `superseded_by` forma uma floresta; cada fato tem ≤ 1 sucessor; o sucessor é atual ou também superado (nunca `forgotten` com antecessor ativo sem auditoria).
3. **Estado atual consistente:** para todo par (entidade, kind) marcado `UPDATES`, no máximo um fato atual por "slot" quando `kind ∈ {preference, goal}` com o mesmo `slot_key` (opcional).
4. **Determinismo do learner model:** `fold(evidence[0..n])` é reprodutível; `replay` após `forget(hard)` da evidência derivada bate com o recomputado.
5. **Recall respeita o orçamento:** `Σ tokens(items) ≤ budgetTokens`; itens superados nunca aparecem fora de `mode = 'historical'`.
6. **Isolamento:** nenhum `MemoryItem` retornado tem `domainId` diferente do contexto (teste com 2 bancos sintéticos).
7. **Idempotência:** rodar `consolidate` duas vezes sem dados novos não muda nada (hash do estado).

### 7.12 Custo e latência estimados

Premissas: 3 h de estudo por dia, ~120 turnos, ~50k tokens de transcrição por dia (aluno + tutor, sem contexto injetado), papéis em modelo pequeno (e médio para consolidação). São estimativas de engenharia, a validar com `llm_usage`.

| Operação | Frequência / dia | Tokens in | Tokens out | Modelo |
|---|---|---|---|---|
| Extração (lotes de ~6k + prompt 1,5k) | ~9 | ~70k | ~9k | pequeno |
| Juiz de supersessão (em lote) | ~5 | ~20k | ~2k | pequeno |
| Observer OM (limiar 12k) | ~4 | ~55k | ~6k | pequeno |
| Reflector OM | ~1 | ~10k | ~3k | pequeno |
| Consolidação (observations + 4 mental models + dedup) | 1 | ~40k | ~8k | médio |
| Flashcards de fim de sessão | 1–2 | ~15k | ~3k | médio |
| **Subtotal memória** | | **~210k** | **~31k** | pequeno/médio |
| Memória injetada no tutor (gate ~50% dos turnos × ~2k) | ~60 | **~120k** (dinâmico) + prefixo estável cacheado | 0 | principal |
| *Comparação:* contexto Hindsight (24–43k/consulta, Omni/AMB) × 60 | | ~1,4–2,6M | | principal |
| *Comparação:* Mem0 (~7k/consulta) × 60 | | ~0,42M | | principal |
| *Comparação:* contexto cheio do domínio após 1 ano (~15–20M tokens) | | inviável | | — |

**Cold start (§7.6.4, passo −1):** enquanto o domínio tem ≤ 40k tokens de L0, cada turno leva até 40k tokens de prefixo **cacheado**. A 2–4h por dia (~50k tokens por dia), isso dura cerca de **1 dia de estudo por domínio**. O custo extra é limitado e compensa a fase em que a memória extraída ainda é rala.

Ordem de grandeza ilustrativa: a US$ 0,10 / M de input e US$ 0,40 / M de output (faixa de modelos "flash-lite" em 2026), o subtotal de memória custa ≈ US$ 0,03/dia. Em assinatura, são alguns % da cota diária.

**Armazenamento (1 ano):** ~15–20M tokens de texto ≈ 60–90 MB. Vetores (384-d): ~150k itens × 1,5 KB ≈ 225 MB em float32, ou ~60 MB em int8/q8 via sqlite-vec. Viável em disco local.

**Latência (alvo / estimativa):**

| Etapa | Alvo | Referência |
|---|---|---|
| `ingestTurn` | < 5 ms | INSERT + FTS em WAL |
| Embedding da query (e5-small q8, CPU) | 15–40 ms | Mnemon: busca quente de 14–18 ms, dominada pelo embedding |
| FTS5 bm25 top-50 | < 5 ms | — |
| Cosseno força bruta 50k × 384 | 10–20 ms | MemOS: "dezenas de ms" < 100k |
| Grafo 2 hops (SQL indexado) | < 10 ms | — |
| Rerank 30 candidatos (114M int8) | 60–150 ms | estimativa CPU |
| **Recall p50 total** | **~50–200 ms** | vs Hindsight 0,67–0,96 s (AMB) e 5–15 s (BEAM); Mem0 p50 0,88–1,09 s; Zep 2,58 s |

### 7.13 Plano de avaliação (harness interno)

1. **Sanidade em benchmarks públicos** (rodar só a nossa implementação, num script Node próprio):
   - LongMemEval-S *cleaned* (MIT, 500 q.) e LoCoMo (CC BY-NC 4.0, uso interno; aplicar as correções da auditoria);
   - resposta com o modelo principal do usuário; juiz fixo e versionado;
   - metas da fase 1: **≥ 74% LME-S** (o piso hybrid do AMB) e **≥ 80% LoCoMo**;
   - ablação por canal (vec, fts, graph, time, learner), rerank e OM;
   - registrar **tokens/consulta e p50/p95**, como o AMB e o OmniMemEval.
2. **BEAM 100K / 1M (CC BY-SA 4.0):** checar a degradação com a escala, que é o nosso caso de 1 ano.
3. **HaluMem-Medium:** foco nas colunas *Dynamic Update* e *Conflict*, as que espelham "o aluno superou a misconception?". Meta da F2: **≥ 70 em Dynamic Update**, o que nos põe entre EverOS e Hindsight. Medir também a `% grounded` do extrator (L12).
4. **Curva de cold start (ConvoMem):** rodar o mesmo conjunto com `fullContext` ligado e desligado para N = 10, 30, 75 e 150 conversas. Calibrar `FULLCTX_MAX_TOKENS` no ponto de cruzamento, considerando o custo com cache.
5. **Comparabilidade externa (opcional):** expor a `MemoryService` por um *shim* HTTP local de 2 rotas, add e search. O alvo é o contrato AML `memory-api-v1.1`, que o adapter `cachly` do OmniMemEval já consome; o AML também só exige `Add` e `Search`. Assim dá para rodar o harness Python **numa máquina de avaliação separada**, nunca no app do usuário, e comparar com Maasv, cachly e Hindsight na mesma configuração (`gpt-4.1-mini` responde, `gpt-4o-mini` julga).
6. **TutorMem-lite (próprio, sintético):** 30 sessões simuladas por domínio. O aluno é simulado por LLM, como no TutorBench do DeepTutor. O agente segue o molde do Agent4Edu: perfil + memória de prática + reflexão. O conjunto inclui:
   - (a) misconceptions injetadas e depois resolvidas;
   - (b) preferências que mudam;
   - (c) metas revistas.

   Métricas:
   - **acurácia de estado atual** (StateMemBench): o tutor usa a versão corrente?
   - **recall de pontos fracos** (precisão@5 de `weak_points` contra o gabarito);
   - **erro de estado superado**;
   - **vazamento entre domínios** (deve ser 0);
   - **tokens/turno** e **latência**.
7. **Regressão contínua:** `npm test` com bancos sintéticos pequenos (invariantes §7.11) e um subconjunto de 50 perguntas do LME rodado sob demanda.

### 7.14 Roadmap

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **F1: Raw-first** (1–2 sem.) | Adapter `SqlDriver` (`node:sqlite`, fallback better-sqlite3); schema; `ingestTurn`; FTS5; worker de embedding (e5-small); modo cold-start `fullContext`; recall vec + fts + RRF/RSF + orçamento + renderização cronológica; isolamento por arquivo; `llm_usage` | Invariantes 5–6 passam; LME-S ≥ 74% (meta esticada: ≥ 85%, o patamar do CPersona/LCM-X sem LLM) |
| **F2: Semântica e tempo** | Extrator em lote **com `quote` + aterramento**; episódios; fatos bitemporais; entidades e arestas; canal temporal (`chrono-node`); canal grafo + nós do currículo; juiz de supersessão; ponte `Evidence` → R2 | LME-S ≥ 85%; HaluMem Dynamic Update ≥ 70; TutorMem estado atual ≥ 0,8; `% grounded` ≥ 90% |
| **F3: Working memory e sleep** | Observer/Reflector (OM); `stablePrefix`; consolidação (observations, 4 mental models, dedup, arquivamento); flashcards; export Obsidian | Cache hit ↑; tokens/turno ≤ 12k; mental models citam fontes |
| **F4: Qualidade** | Rerank (hs-rerank-1 ou bge-reranker); `memory_search` / `memory_timeline` / `memory_get` agênticos (*progressive disclosure*); auditoria semanal; sqlite-vec quando > 100k vetores; tuning por harness; shim `add` / `search` para o OmniMemEval | BEAM-1M sem colapso; p50 ≤ 200 ms |

---

## 8. Riscos e questões em aberto

1. **`node:sqlite` ainda é "experimental"** no Node 24 (emite warning). Mitigação: adapter fino com fallback testado para better-sqlite3.
2. **Qualidade do extrator com modelos baratos de assinatura:** não sabemos quais modelos o usuário terá. O piso raw-first garante que a degradação seja graciosa.
3. **Licença do EmbeddingGemma** (Gemma Terms, não OSI): oferecer como download opcional, com o default OSI (e5-small ou Qwen3-0.6B).
4. **Compatibilidade `hs-rerank-1` / `hs-embed-1` com transformers.js:** não verificada. As arquiteturas base (mmBERT-small, bekko-embedding) precisam de suporte ONNX no transformers.js.
5. **Benchmarks públicos não medem tutoria.** Os números de LME e LoCoMo servem só como sanidade; a decisão real vem do TutorMem-lite.
6. **Esquecimento seletivo multi-hop** é problema aberto: ≤ 7% em quase todos, 28% no GPT-5-mini. As cadeias de misconception (A causa B) precisam de arestas `causes` explícitas e de verificação pelo R2.
7. **Privacidade:** a memória guarda dados pessoais e afetivos. É preciso UI de inspeção e edição (como o "Memory Viewer" do MemOS e o "/palace" do Letta), export e apagar tudo. Fica tudo local por padrão.
8. **Personalização implícita** (PersonaMem-v2 ≤ 40,6% para todos) e **"esqueça isso"** (*ask_to_forget*: 24–58%) estão longe de resolvidos. Preferências didáticas devem ser **confirmadas explicitamente** pelo aluno (um toque na UI) antes de virar `preference` com confiança alta.
9. **Números de leaderboard de vendor** (past.dev, Graphon, Exabase, MemoryLake, Backboard) não são comparáveis entre si: o mesmo modelo responde e julga, há dicas do dataset e não há harness publicado. Não usar para decisão.
10. **Follow-up sugerido:**
    - ler o resultado do **Ciclo 2 do AML** (publicação prevista para 2026-11-19);
    - ler os PDFs de HaluMem, EvoMemBench e StructMemEval para os números internos;
    - verificar STATE-Bench (Microsoft) e LoCoMo-Plus;
    - ler o código de `lcm-x` e `threadatlas` (MIT) como referência de implementação raw-first. Status resolvido nesta revisão: ambos são open-source MIT; o Maasv é fechado.

---

## 9. Referências (URLs)

**Benchmarks e harnesses**
- LongMemEval: https://github.com/xiaowu0162/LongMemEval · dados *cleaned*: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
- LongMemEval-V2: https://arxiv.org/abs/2605.12493
- LoCoMo: https://github.com/snap-research/locomo · auditoria: https://github.com/dial481/locomo-audit · https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer
- BEAM: https://arxiv.org/abs/2510.27246 · https://github.com/mohammadtavakoli78/BEAM
- MemoryAgentBench: https://arxiv.org/abs/2507.05257 · https://github.com/HUST-AI-HYZ/MemoryAgentBench
- MemoryArena: https://memoryarena.github.io/ (arXiv 2602.16313)
- StateMemBench / StateMem: https://arxiv.org/abs/2608.19652
- OmniMemEval (resultados multi-sistema): https://github.com/MemTensor/OmniMemEval (`docs/user_memory/benchmark_results/*.md`)
- Agent Memory Benchmark (AMB): https://agentmemorybenchmark.ai · https://github.com/vectorize-io/agent-memory-benchmark
- PersonaMem: https://arxiv.org/abs/2504.14225 · LifeBench: https://arxiv.org/abs/2603.03781
- HaluMem: https://arxiv.org/abs/2511.03506 · tabela OmniMemEval: https://github.com/MemTensor/OmniMemEval/blob/main/docs/user_memory/benchmark_results/halumem.md
- PersonaMem-v2 (OmniMemEval): https://github.com/MemTensor/OmniMemEval/blob/main/docs/user_memory/benchmark_results/personamem-v2.md
- BEAM (OmniMemEval + referências publicadas): https://github.com/MemTensor/OmniMemEval/blob/main/docs/user_memory/benchmark_results/beam.md · past.dev: https://past.dev/benchmarks/beam
- Proveniência das linhas de contribuidor: https://github.com/MemTensor/OmniMemEval/tree/main/docs/user_memory (`maasv.md`, `lcmx.md`, `threadatlas.md`, `cachly.md`)
- ConvoMem: https://arxiv.org/abs/2511.10523 · EvoMemBench: https://arxiv.org/abs/2605.18421 · StructMemEval: https://arxiv.org/abs/2602.11243 · MemBench: https://arxiv.org/abs/2506.21605
- LongMemEval-V2 (código e leaderboard): https://github.com/xiaowu0162/LongMemEval-V2 · https://xiaowu0162.github.io/longmemeval-v2/#leaderboard
- Agent Memory Leaderboard (AML): https://github.com/AML-memory/agent-memory-leaderboard · https://agentmemoryleaderboard.ai/

**Sistemas**
- Hindsight: https://github.com/vectorize-io/hindsight · paper https://arxiv.org/abs/2512.12818 · BEAM https://hindsight.vectorize.io/blog/2026/04/02/beam-sota · modelos https://hindsight.vectorize.io/blog/2026/11/03/hindsight-models · SDK Node https://hindsight.vectorize.io/sdks/hindsight-all-npm · https://benchmarks.hindsight.vectorize.io/
- Mem0: https://github.com/mem0ai/mem0 · https://mem0.ai/blog/state-of-ai-agent-memory-2026 · paper https://arxiv.org/abs/2504.19413
- Zep / Graphiti: https://github.com/getzep/graphiti · paper https://arxiv.org/abs/2501.13956
- Letta / Letta Code: https://github.com/letta-ai/letta · https://github.com/letta-ai/letta-code
- MemOS: https://github.com/MemTensor/MemOS (`apps/memos-local-plugin/`) · paper https://arxiv.org/abs/2507.03724
- Mastra Observational Memory: https://mastra.ai/research/observational-memory · código `packages/memory/src/processors/observational-memory/` em https://github.com/mastra-ai/mastra
- EverMemOS / EverOS: https://github.com/EverMind-AI/EverOS · paper https://arxiv.org/abs/2601.02163
- Honcho: https://github.com/plastic-labs/honcho · https://plasticlabs.ai/blog/research/Benchmarking-Honcho
- Supermemory: https://github.com/supermemoryai/supermemory · https://supermemory.ai/research
- Cognee: https://github.com/topoteretes/cognee
- LightMem: https://github.com/zjunlp/LightMem · https://arxiv.org/abs/2510.18866 · MemBase: https://github.com/zjunlp/MemBase
- A-MEM: https://github.com/WujiangXu/A-mem (FlexA-Mem: https://arxiv.org/html/2610.33274v1)
- MIRIX: https://github.com/Mirix-AI/MIRIX · Memobase: https://github.com/memodb-io/memobase · MemoryOS: https://github.com/BAI-LAB/MemoryOS
- Memori: https://github.com/MemoriLabs/Memori · LangMem: https://github.com/langchain-ai/langmem · memU: https://github.com/NevaMind-AI/memU · Second Me: https://github.com/mindverse/Second-Me
- Mnemon: https://arxiv.org/abs/2609.36059 · https://github.com/Grivn/mnemon-memory-agent
- Agent Zero Memory: https://arxiv.org/abs/2608.29606 · Chronos: https://arxiv.org/abs/2603.16862
- LCM-X: https://github.com/electricsheephq/lcm-x · ThreadAtlas: https://github.com/jhffmn82/threadatlas · cachly: https://github.com/cachly-dev/cachly-mcp
- CPersona: https://github.com/Cloto-dev/CPersona · arquitetura: https://cloto-dev.github.io/CPersona/architecture/
- claude-mem: https://github.com/thedotmack/claude-mem · TencentDB Agent Memory: https://github.com/TencentCloud/TencentDB-Agent-Memory (`MemoryCore/`, `MemoryCore/pi-plugin/`)
- OpenViking: https://github.com/volcengine/OpenViking · MemMachine: https://github.com/MemMachine/MemMachine · mem9: https://github.com/mem9-ai/mem9 · tigerless agent-memory: https://github.com/tigerless-labs/agent-memory

**Tutoria / learner modeling**
- DeepTutor: https://arxiv.org/abs/2604.26962 (código local `_refs/DeepTutor/deeptutor/services/memory/`)
- MERIT: https://arxiv.org/abs/2603.22289 · TASA: https://arxiv.org/abs/2511.15163 · IntelliCode: https://arxiv.org/abs/2512.18669
- Survey "What makes an LLM a tutor?": https://link.springer.com/article/10.1007/s44336-026-00047-y
- Always-On Agents: https://arxiv.org/abs/2606.30306
- TutorLLM: https://arxiv.org/abs/2502.15709 · Agent4Edu: https://arxiv.org/abs/2501.10332 (código: https://github.com/bigdata-ustc/Agent4Edu)

**Infra**
- sqlite-vec 0.1.9 (estável; 0.1.10-alpha.4 de 2026-05-18 é pré-release): https://github.com/asg017/sqlite-vec · better-sqlite3 13.2.0 (2026-11-14): https://github.com/WiseLibs/better-sqlite3
- mem0 TS (`mem0ai` 3.3.1, peer `better-sqlite3 ^12.6.2`): https://github.com/mem0ai/mem0/tree/main/mem0-ts
- transformers.js 4.3.2: https://github.com/huggingface/transformers.js · chrono-node 2.10.3: https://github.com/wanasit/chrono · ts-fsrs 6.0.0: https://github.com/open-spaced-repetition/ts-fsrs
- Modelos: https://huggingface.co/Xenova/multilingual-e5-small · https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX · https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX · https://huggingface.co/Xenova/bge-m3 · https://huggingface.co/hindsight-ai/hs-embed-1 · https://huggingface.co/hindsight-ai/hs-rerank-1 · https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX
