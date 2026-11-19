# ref-open-mastery: análise completa do repositório e plano de port

> Escopo: `C:\Users\nicoolas\Pictures\learnharness\_refs\open-mastery` (clone raso; só leitura, **nenhum código foi executado ou compilado**).
> Data da análise: 2026-11-18. Autor: subagente de pesquisa (ref-open-mastery).
> Fontes lidas por inteiro: `README.md`, `CLAUDE.md`, `DEVELOPER.md`, `LICENSE`, `Makefile`, `mcp.json.example`, `.env.example`, `.gitignore`, `docs/*` (4 arquivos), `engine/**` (todo o Rust: 13 arquivos `.rs`, 4 `Cargo.toml`, README, LICENSE), `graph/README.md`, `graph/LICENSE`, `graph/schema.json`, `graph/math/4th-grade.json`, os 22 `_prompt.yaml`, amostras de cerca de 35 nós YAML, `tasks/*` (12 arquivos), `web/skilltree/*` (HTML, `export.py` e a forma dos JSON).
> Estatísticas do grafo: calculadas por um parser YAML mínimo e só de leitura sobre **todos** os 267 nós (`graph/math`, `graph/language/english`, `graph/language/japanese-kana`).

---

## 0. TL;DR

- **O que é:** um DAG de tópicos em YAML (um arquivo por nó, hierarquia por diretórios) e um engine Rust que responde "o que o aluno pode aprender agora?". A resposta é a **fronteira**: nós ainda não dominados cujos pré-requisitos estão todos dominados. Dois servidores MCP (student/teacher) expõem isso a qualquer LLM. A licença é dupla: **engine MIT** e **grafo CC BY-SA 4.0**.
- **Estado atual (verificado em 2026-11-18):** o upstream `github.com/bxxd/open-mastery` tem 36 commits, 6 stars e 1 fork. O último commit é `2b6c156`, de 2026-07-21, idêntico ao nosso clone. Não há atividade desde julho de 2026. É um projeto pequeno, de uma pessoa, em estágio de protótipo.
- **O algoritmo real é trivial:** ordenação topológica (Kahn) mais um filtro `todos os prereqs ∈ mastered`. **Não estão implementados**, apesar de a documentação descrevê-los: mastery bayesiana, decaimento ou revisão espaçada, *plans*, ranking da fronteira, diagnóstico de nivelamento e injeção do estado do aluno no prompt. O "mastery gate" **não é imposto pelo engine**: `record_mastery` aceita qualquer nó, até um bloqueado, e qualquer nível Bloom conta como dominado.
- **O que vale reaproveitar são as ideias**, não o código:
  1. As regras de aresta ("necessária, não suficiente"; "direta, não transitiva"; o teste "dá para aprender B sem A?").
  2. A **cascata de prompts pedagógicos** por nível da hierarquia (`_prompt.yaml`).
  3. O campo `encompasses` com peso (0–1) e o índice reverso, para revisão comprimida ao estilo FIRe do Math Academy.
  4. O vocabulário `assess` mais o nível Bloom mínimo por nó.
  5. Do `web/skilltree`: os 4 estados visuais (owned/open/locked/unbuilt), a projeção "nós sem conteúdo não bloqueiam", os níveis = profundidade do caminho mais longo e os nós agregados via `members`.
- **Bugs relevantes encontrados** (seção 3.14):
  1. O prompt de nível raiz (assunto) **nunca entra na cascata**.
  2. Os grafos de *language* **não carregam no engine**, porque usam a chave `teaching:` e o engine exige `system:`.
  3. As mutações gravam o YAML **antes** de validar: `add_prerequisite` consegue gravar um ciclo e deixar o servidor inconsistente.
  4. `delete_node` quebra quando o nó é alvo de `encompasses`.
  5. Há path traversal em `student_id`, `set_prompt` e artifacts, e o servidor SSE escuta em `0.0.0.0` com CORS `*` e sem auth.
  6. Restam 11 arestas transitivas no grafo de math, contra a regra do próprio projeto.
  7. `prereq_depth` é exponencial.
- **Para nós:** portar para TypeScript dentro de `src/core/curriculum/` (núcleo puro com *ports*, como o `src/core/graph.ts` do learnharness), com um schema v2 hierárquico (N níveis, *regions*, IDs estáveis, níveis acadêmicos, recursos por região, status *stub* para expansão procedural), um validador transacional e incremental (aciclicidade antes de gravar), gates impostos no servidor com evidência (BKT), e revisão por FSRS com crédito implícito via `encompasses`. A 10⁴ nós, TS puro é mais que suficiente (Kahn O(V+E) em milissegundos).
- **Licença:** o código MIT pode ser portado para o nosso app AGPL-3.0 mantendo o aviso de copyright. O grafo CC BY-SA 4.0 deve ficar como **dados separados**, sob CC BY-SA 4.0, com atribuição. A CC declara compatibilidade unidirecional BY-SA 4.0 → GPLv3, mas a AGPLv3 não está na lista. Não misturar texto do grafo no código-fonte AGPL.

---

## 1. Identificação e inventário

| Item | Valor |
|---|---|
| Upstream | `https://github.com/bxxd/open-mastery` (6 stars, 1 fork, 36 commits; consultado em 2026-11-18) |
| HEAD local | `2b6c156dbc9c96d6c95d6771ab88408ef15b1035`, 2026-07-21 (é o último commit upstream; o clone tem `--depth 1`) |
| Linguagem | Rust edition 2024 (workspace com 3 crates) + YAML + 1 página HTML/JS + 1 script Python |
| Tamanho | 343 arquivos; ~2,9 mil linhas de Rust; 267 nós YAML; 22 `_prompt.yaml` |
| Dependências core | `serde`, `serde_json`, `serde_yaml 0.9` (crate já arquivado/deprecado upstream), `thiserror 2`, `chrono` |
| Dependências MCP | `axum 0.7`, `tokio`, `tower-http` (CORS), `uuid`, `tracing`, `base64` (teacher). **Não usa SDK MCP oficial** (JSON-RPC escrito à mão) |
| Licenças | `engine/LICENSE` MIT ("Copyright (c) 2026 OpenMastery contributors"); `graph/LICENSE` CC BY-SA 4.0; `LICENSE` (raiz) diz que `engine/` é MIT para "The traversal engine and all code". `web/` não tem LICENSE próprio (por inferência: MIT, via "all code"). `docs/` e `tasks/` não têm licença explícita |

### 1.1 Mapa do repositório

```
open-mastery/
├── README.md, DEVELOPER.md (CLAUDE.md = "@DEVELOPER.md"), LICENSE, Makefile, mcp.json.example, .env.example
├── docs/
│   ├── GRAPH_FORMAT.md      ← ESPECIFICAÇÃO do formato (a fonte de verdade documental)
│   ├── BUILDER_BRIEF.md     ← brief de construção (decisões de design, estratégia de geração por LLM)
│   ├── LANDSCAPE_ANALYSIS.md← análise de mercado edtech (Math Academy, Khan, AoPS, Alpha…), 2026-03-11
│   └── STORY.md             ← narrativa/visão (2027–2031); menciona "soft edges" (recommended vs required)
├── engine/                  ← workspace Rust (MIT)
│   └── crates/
│       ├── core/            ← types.rs (96 l), graph.rs (795 l), student.rs (148 l), lib.rs
│       ├── mcp-student/     ← main.rs, server.rs (350 l), stdio.rs, sse.rs (200 l)
│       └── mcp-teacher/     ← main.rs, server.rs (794 l), git.rs, artifacts.rs, stdio.rs, sse.rs (idênticos ao student)
├── graph/                   ← dados (CC BY-SA 4.0)
│   ├── schema.json          ← LEGADO (v1.0, formato JSON por curso; não usado pelo engine)
│   ├── README.md            ← LEGADO (descreve o formato JSON v1.0)
│   ├── math/                ← 131 nós YAML + 19 _prompt.yaml + 4th-grade.json (legado, ignorado: engine só lê .yaml)
│   └── language/
│       ├── english/{grammar (15), spelling (89)} + 2 _prompt.yaml (chave `teaching:`)
│       └── japanese-kana/ (32) + 1 _prompt.yaml (chave `teaching:`)
├── tasks/                   ← 001–011 (roadmap; 006 web frontend = todo)
└── web/skilltree/           ← index.html (564 l), export.py, math.json, english.json, japanese-kana.json
```

### 1.2 Documentado vs. implementado (importante)

| Recurso | Docs dizem | Código real |
|---|---|---|
| Fronteira (prereqs dominados, nó não dominado) | sim | **sim** (`Graph::get_frontier`) |
| Ordenação topológica e detecção de ciclo | sim | **sim** (Kahn; erro genérico `CycleDetected`, sem o caminho) |
| Validações: refs resolvem, sem ciclo, IDs únicos | sim | **sim** (no load e em toda mutação) |
| Validação "ID bate com o caminho" | sim (GRAPH_FORMAT §Validation 5) | **não** (34/267 nós violam a regra) |
| Validação "sem órfãos / alcançável de raiz" | sim | só reporta raízes isoladas (sem pré-requisitos e sem filhos); não bloqueia |
| Validar pesos de `encompasses` em (0,1] e sem auto-referência | sim (task 010) | **só nos testes**; o load não checa o peso nem `self` |
| Cascata de prompts subject→domain→unit→node | sim | **parcial**: o prompt do *subject* (raiz) nunca entra (bug, §3.8) |
| Estado do aluno injetado na cascata | sim (GRAPH_FORMAT) | **não** |
| Mastery bayesiana (likelihood ratios, threshold) | README fala dela como existente | **não**: só um `HashMap<node, {level, mastered_at}>` |
| Gate estrito ("prove ou não avança") | sim | **não imposto**: `record_mastery` aceita qualquer nó; o nível é ignorado |
| Ranking da fronteira (README do engine: "course progression > prereq count > Bloom") | sim | **não**: só a ordem topológica |
| Spaced repetition / decaimento | "Future" | **não** |
| Plans (`plans/*.yaml` filtrando a fronteira) | sim | **não** (não há diretório nem código) |
| Placement diagnostic | sim | **não** |
| MCP Resources (`graph://`, `progress://`) | task 004 | **não** (só tools) |
| Web frontend (task 006) | todo | só `web/skilltree` (visualizador que depende de `../bar.js` e `../packs.json`, privados, ausentes do repo) |
| `make mcp-server` / `make run` (engine/README) | sim | não existem no Makefile |

---

## 2. (a) Schema exato do grafo

### 2.1 Layout em disco e hierarquia

- **Um arquivo `.yaml` por nó.** Arquivos chamados `_prompt.yaml` **não são nós**: são prompts em cascata. Qualquer outro `.json` é ignorado.
- Hierarquia por diretório: `subject/` (= `GRAPH_DIR`, ex. `graph/math`) → `domain/` → `unit/` → `node.yaml`. O engine **ignora a hierarquia para o DAG** e só usa `id` e `prereqs`. Ela serve a humanos, à cascata de prompts e aos campos derivados `domain`/`unit`.
- `domain` e `unit` são **derivados do caminho** relativo a `GRAPH_DIR`. `components[0]` é o domínio e `components[1]` a unidade. Com 2 componentes, a unidade fica vazia; com 1, ambos ficam vazios. Por isso, com `GRAPH_DIR=graph/language`, um nó em `english/spelling/digraphs/ch.yaml` recebe `domain=english, unit=spelling` (o nível errado). A profundidade efetiva é fixa em 3.

### 2.2 Campos do nó (struct `NodeFile` em `engine/crates/core/src/types.rs`)

```rust
pub struct NodeFile {
    pub id: String,
    pub prereqs: Vec<String>,
    pub bloom: BloomLevel,                         // enum lowercase: know|understand|apply|analyze (Ord derivado)
    pub assess: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]  pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]  pub typical_grade: Option<u8>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]pub encompasses: HashMap<String, f32>,
}
// Node = NodeFile + derivados: domain: String, unit: String, file_path: PathBuf
// display_name() = file_stem com '_' → ' ' (NÃO há campo `name`!)
```

| Campo | Obrigatório | Tipo | Semântica | Observações |
|---|---|---|---|---|
| `id` | sim | string | Chave global de 3 partes `dominio.unidade.topico` (ex. `frac.con.basics`) | Deveria espelhar o caminho, mas **não é validado**: em 34/267 nós o nome do arquivo difere da última parte do ID (`completing_the_square.yaml` → `alg.quad.completing_square`) |
| `prereqs` | sim (`[]` em raízes) | lista de IDs | Arestas **diretas** de dependência: "não dá para aprender B sem A" | Cruzam domínios livremente |
| `bloom` | sim | enum | **Nível Bloom mínimo para domínio** (`know` < `understand` < `apply` < `analyze`) | `know` nunca é usado nos 267 nós |
| `assess` | sim | lista de strings | Tipos de avaliação que demonstram domínio no nível Bloom | Vocabulário aberto, sem enum (§2.6) |
| `context` | não (presente em 267/267) | string (YAML folded `>`) | **Orientação pedagógica** para o LLM: terse, especializada, "direção, não roteiro" | Math: 15–67 palavras (média 39); English: média 27; Kana: média 22 |
| `tags` | não (0/267 usam) | lista | Tags livres | Não usada |
| `typical_grade` | não (267/267 usam) | u8 | Série escolar típica; **só consultiva, não bloqueia** | Math: 4–11; English: 1–5; Kana: 1–3 |
| `encompasses` | não (15/267 usam) | mapa `id → f32` | "Praticar este nó exercita implicitamente o sub-skill X com peso w ∈ (0,1]" | Diferente de prereq: **não bloqueia**, serve para comprimir revisões. Engine cria o índice reverso `encompassed_by` |

Exemplo real (math, com todos os campos usados):

```yaml
# graph/math/algebra/quadratics/quadratic_formula.yaml
id: alg.quad.formula
prereqs:
  - alg.quad.completing_square
bloom: analyze
assess:
  - solve
  - derive
  - word_problem
typical_grade: 9
encompasses:
  alg.eq.square_roots: 0.8
  ops.oo.basics: 0.6
  alg.exp.exponents_basics: 0.5
context: >
  x = (-b ± sqrt(b^2 - 4ac)) / 2a. Derived by completing the
  square on ax^2 + bx + c = 0. Works for ANY quadratic. Discriminant
  b^2 - 4ac tells you how many real solutions: positive = 2,
  zero = 1, negative = 0 (complex). Student should derive it once,
  then use it fluently.
```

Exemplo de raiz:

```yaml
# graph/math/number-sense/place-value/thousands.yaml
id: ns.pv.thousands
prereqs: []
bloom: understand
assess: [identify, compare]   # (no arquivo está em lista de bloco)
typical_grade: 4
context: >
  Ones, tens, hundreds, thousands. Read and write numbers to 9,999. ...
```

Exemplo de *language* (o mesmo schema serve outro assunto, o que mostra que o engine é agnóstico):

```yaml
# graph/language/english/spelling/rules/doubling_2syll.yaml
id: sp.rule.doubling_2syll
prereqs: [sp.rule.doubling, sp.syll.division]
bloom: analyze
assess: [build, dictation, explain]
typical_grade: 4
context: >
  Doubling in two-syllable words: double only if the FINAL syllable is stressed
  (begin->beginning, but visit->visiting). The 1-1-1 rule plus stress — an if-then with two conditions.
```

```yaml
# graph/language/japanese-kana/vocab/first_words.yaml  (nó "vocab" bloqueado por cobertura de kana)
id: jk.vocab.first_words
prereqs: [jk.kana.vowels, jk.kana.k_row, jk.kana.s_row]
bloom: apply
assess: [build, translate]
typical_grade: 1
context: >
  Assemble real words from mastered kana (あお, かお, すし). Production from claimed territory; ...
```

### 2.3 Convenção de IDs

- Três partes: `dominio.unidade.topico`. Prefixos de domínio documentados: `ns`, `ops`, `frac`, `dec`, `geo`, `rat`, `alg`, `trig`, `calc`, `la`, `stat`, `dm`. Unidades abreviadas: `pv`, `mul`, `eq`, `con`, `as`, `md`, `quad`, `log`, `uc`, `id` etc.
- Language: `sp.*` (spelling), `gr.*` (grammar), `jk.kana.*` / `jk.kata.*` / `jk.vocab.*`. Esses prefixos **não seguem a pasta**: `sp.base.cvc` fica em `foundations/` e `gr.pos.noun` em `parts/`.
- O teacher MCP converte ID em caminho com uma tabela **hardcoded só de math** (`id_to_path` em `mcp-teacher/src/server.rs`). A unidade abreviada vira o nome do diretório (`frac.con.x` → `fractions/con/x.yaml`, e não `fractions/concepts/`), o que diverge dos diretórios existentes. Não dá para criar nós de *language* pelo teacher.
- **Problema para escala:** o ID é semântico e mutável. Renomear ou mover quebra o estado dos alunos, que é indexado por ID, e não existe mecanismo de alias ou redirect.

### 2.4 Pré-requisitos: as regras (o "produto", segundo o projeto)

Das seções GRAPH_FORMAT §Edges e BUILDER_BRIEF §3:

1. **Necessário, não suficiente.** A→B significa "não dá para aprender B sem A", e não "A ajuda em B".
2. **Direto, não transitivo.** Se A→B→C, **não** adicionar A→C; o engine computa a transitividade.
3. **Teste:** "um aluno que domina tudo EXCETO A ainda consegue aprender B?" Se sim, não há aresta.
4. **Arestas cruzando domínios são o valor** (álgebra precisa de frações, trig precisa de geometria).
5. **Granularidade:** "se você não consegue escrever 3 problemas que testem exatamente este nó e nada mais, o nó é grande demais; divida". Para spelling, a variante é "5 palavras de ditado que isolem o nó".
6. O grafo é **hipótese a 80%**. Aluno travando indica aresta faltando; aluno passando direto indica aresta desnecessária.
7. `STORY.md` (visão) propõe **arestas suaves** `recommended` vs `required`, que o agente pode respeitar ou ignorar conforme o perfil. **Não está no schema**, mas é uma boa ideia para nós.

### 2.5 `encompasses` (task 010, inspirado no FIRe do Math Academy)

- Formato: o mapa `encompasses: { node_id: peso }`, com peso em (0,1]. Na escala informal, 0.3 = "exercita levemente" e 0.7 = "exercita fortemente".
- Decisões da task 010:
  - prereqs **bloqueiam**; encompasses **agenda revisão**.
  - Um nó pode englobar nós que não são prereqs diretos (ex. `alg.quad.formula` → `ops.oo.basics`, vários níveis abaixo).
  - Os pesos são aproximados e ajustados por professores.
- O engine valida, no load, que os alvos existem, e constrói `encompassed_by: HashMap<String, Vec<(String, f32)>>`. **Nada consome esse índice** além do `get_node` do teacher: não há scheduler.
- Dados: 21 arestas em 10 nós (math) e 14 em 5 nós (english). **3 alvos em math e 2 em english não são ancestrais** do nó, por exemplo `alg.rat.equations` → `frac.as.unlike_add` e `trig.rat.solving` → `rat.prop.solving`. Para o crédito de revisão, isso é semanticamente aceitável (o Math Academy chama de "non-ancestor encompassing"), mas merece validação explícita como *warning*.

### 2.6 Vocabulário `assess` (contagem nos 267 nós)

`solve` 105 · `explain` 105 · `identify` 84 · `word_problem` 64 · `build` 63 · `dictation` 43 · `recall` 27 · `represent` 24 · `produce` 23 · `generate` 20 · `classify` 19 · `derive` 16 · `compare` 16 · `convert` 12 · `segment` 8 · `define` 6 · `translate` 5 · `use` 4 · `locate` 4 · `expand` 4 · `sort` 3 · `predict` 3 · `explain_pattern` 3 · `combine` 3 · `sequence` 2 · `order` 2 · `manipulate` 2 · `substitute`, `split`, `repair`, `count_sounds`, `count`, `clap`, `blend`, `attach` 1 cada.

GRAPH_FORMAT define semanticamente 12 deles: `identify`, `compare`, `represent`, `recall`, `solve`, `explain`, `explain_pattern`, `generate`, `convert`, `order`, `derive`, `word_problem`. A lista é declarada **extensível**. A filosofia é que `explain`, `derive` e `generate` são mais difíceis de "fingir" que `solve`; o LLM decide os problemas concretos.

### 2.7 Níveis (o que "nível" significa aqui)

Há **três noções distintas**:

1. **Bloom por nó (`bloom`)** é o **limiar de domínio**. BUILDER_BRIEF §6 diz "Mastery = Apply mínimo; Know/Understand sozinhos não são domínio", mas 33 nós têm `understand` como alvo (introduções conceituais). Distribuição: apply 209, understand 33, analyze 25, know 0. `BloomLevel` deriva `Ord`, então a comparação `level >= node.bloom` é trivial, mas o engine **nunca a faz**.
2. **`typical_grade`** é a série escolar, só metadado ("domain-organized, not grade-organized").
3. **Nível visual no skilltree** é a profundidade do caminho mais longo de prereqs, `depth(id) = 1 + max(depth(p))`, calculada **por strand** (componente sem arestas entre si). Math tem profundidade máxima de 16 níveis.

### 2.8 Orientação pedagógica: `context` + cascata `_prompt.yaml`

- `_prompt.yaml` em qualquer diretório, com o campo `system: <texto>` (struct `PromptFile { system: String }`).
- A cascata para um nó é a concatenação, com `\n`, dos prompts dos diretórios da raiz até a pasta do nó, mais o `context` do nó (`Graph::get_prompt_cascade`).
- Uso pretendido: "uma escola Montessori troca o `_prompt.yaml` raiz e todo nó muda de estilo; o DAG fica igual". Isso **casa com a meta 9 do nosso app** (didática não cansativa): a política "explicar com calma e uma pergunta por vez" mora na cascata de domínio, não em cada nó.
- Exemplos reais:
  - raiz math: *"You are a math tutor. Socratic method — guide the student to discover answers… Verify understanding before advancing… Celebrate reasoning, not just correct answers."*
  - `algebra/quadratics`: *"…GCF first, then count terms, then pick strategy. Verify by multiplying back…"*
  - `english/spelling`: *"Frame spelling as code-cracking, never memorization… Production over recognition… Errors get a strategy prompt, never a verdict."*
- **Inconsistência:** os 3 prompts de *language* usam a chave `teaching:` em vez de `system:`. Como `PromptFile.system` é obrigatório, `Graph::load` **falha** (`missing field system`) em qualquer `GRAPH_DIR` que contenha esses arquivos. Na prática, os grafos de language só são consumidos via `export.py` → JSON → skilltree.

### 2.9 Mastery gates

- **Documentado:** gate estrito, sem crédito parcial, sem pulo; mastery como crença probabilística por nó, atualizada por evidência com likelihood ratios; limiar, LRs e decaimento são "configuração do engine, não dado do grafo".
- **Implementado:** `StudentState { student_id, mastery: HashMap<String, MasteryRecord { level: BloomLevel, mastered_at: DateTime<Utc> }> }`. "Dominado" significa `mastery.contains_key(id)`. O nível é armazenado e **ignorado**. O gate efetivo depende inteiramente do LLM decidir chamar `record_mastery`.

### 2.10 Plans e estado do aluno (só documentados)

- Plan: `plans/k12/4th-grade.yaml`, com `{name, description, nodes:[ids]}`. Ele **filtra** a fronteira e não altera o DAG. Não existe no código.
- Estado do aluno: separado do grafo (o grafo é público e estático; o estado é privado e dinâmico). Persistido em `PROGRESS_DIR/{student_id}.json`.

### 2.11 Formatos legados (ignorar)

`graph/schema.json` (JSON Schema draft 2020-12, `schema_version: "1.0"`), `graph/README.md` e `graph/math/4th-grade.json` (20 nós `4g.*`) descrevem um formato antigo: JSON por curso, com campos `name`, `course` (enum de 17 cursos), `prerequisites`, `assessment_types`, `bloom_level` e `tags`. O engine atual não o lê. Ainda assim, a task 011 manda "validar contra `graph/schema.json`", o que é incoerente. A única coisa útil ali é a **lista dos 17 cursos-alvo** (4th-grade … math-for-ml), que dá uma ideia do escopo pretendido de ~3.000 nós.

### 2.12 Estatísticas medidas dos grafos (parser próprio, todos os nós)

| Grafo | Nós | Arestas | Raízes | Folhas | Prof. máx. (nós) | Arestas transitivas redundantes | `encompasses` |
|---|---|---|---|---|---|---|---|
| math | 131 | 218 | 2 (`ns.pv.thousands`, `geo.ang.basics`) | 34 | 16 | **11** | 21 em 10 nós (3 com alvo não-ancestral) |
| english | 104 (15 grammar + 89 spelling) | 136 | 5 | 47 | 10 | 6 | 14 em 5 nós (2 com alvo não-ancestral) |
| japanese-kana | 32 | 50 | 1 | 11 | 11 | 8 | 0 |

- Grau de entrada em math: {0:2, 1:45, 2:80, 3:3, 4:1}. Ou seja, nós com 1–2 prereqs dominam, o que é bom para escalar e para o LLM.
- Maior grau de saída: `ops.mul.facts` (9 filhos), `frac.con.basics` (7), `alg.fn.linear` (7).
- Histograma de profundidade em math (nós por nível): 2,5,7,8,7,11,11,13,7,11,10,11,15,4,5,4. É uma "árvore" larga e equilibrada.
- Arestas redundantes em math que **violam a regra "direct, not transitive"** (a task 007 diz "done"): `alg.exp.exponents_basics→ops.mul.facts`, `alg.fn.quadratic_graphing→alg.eq.quadratic_intro`, `alg.seq.arithmetic→ns.pat.sequences`, `frac.md.fraction_times_whole→ops.mul.facts`, `geo.ap.rectangle→ops.add.within_1000`, `ops.wp.multi_step→ops.sub.multi_digit`, `rat.rat.understanding→ops.mul.facts`, `stat.meas.center_spread→dec.ops.add_subtract`, `stat.prob.basic→frac.con.basics`, `stat.prob.counting→ops.mul.facts`, `trig.id.pythagorean→geo.ap.pythagorean`. **Lição:** a redução transitiva precisa ser **automática no validador**, e não uma revisão manual.

### 2.13 Cobertura de conteúdo × nossas metas

- **Math (4ª série → trig, logs e sequências, nível ensino médio):** útil como **base matemática para Eletrônica**:
  - álgebra (`alg.eq.*`, `alg.fn.linear`) → lei de Ohm e Kirchhoff;
  - `alg.fn.exponential` e `alg.log.*` → transitórios RC e dB;
  - `trig.uc.radians` e `trig.gr.sinusoidal` → AC;
  - `geo.ap.pythagorean` → magnitude de fasores.

  **Faltam** números complexos, cálculo, álgebra linear, EDOs, Laplace/Fourier e probabilidade avançada, todos essenciais da graduação ao doutorado.
- **English:** fonética/ortografia e gramática para **crianças nativas** (séries 1–5). Para um falante de PT-BR rumo a C2/inglês acadêmico, o valor é limitado. Aproveitáveis:
  - a modelagem "gramática como anatomia de máquina" (`gr.*`, 15 nós);
  - a região `morphology`/`etymology` (raízes latinas/gregas, camadas normandas), útil para vocabulário C1–C2;
  - a ideia de **registro** (`sp.short.internet`).
- **Japanese kana:** fora de escopo. O padrão "vocab bloqueado por cobertura de símbolos" e os nós agregados via `members` são reutilizáveis.

---

## 3. (b) O engine: algoritmo, estruturas, validações, testes

### 3.1 Arquitetura

Hexagonal: `core` é a lógica de domínio pura (I/O de arquivo incluído, porque a persistência YAML/JSON fica dentro do core); `mcp-student` e `mcp-teacher` são adaptadores. CLI e web-server estão "planned", sem código. Cada servidor guarda `Mutex<Graph>` em memória. O student também tem um cache `Mutex<HashMap<String, StudentState>>`.

### 3.2 Estruturas de dados (`core/src/graph.rs`)

```rust
pub struct Graph {
    pub nodes: HashMap<String, Node>,                       // id → nó
    pub topo_order: Vec<String>,                            // ordem topológica (pré-computada)
    pub children: HashMap<String, Vec<String>>,             // arestas reversas: prereq → dependentes
    pub encompassed_by: HashMap<String, Vec<(String, f32)>>,// índice reverso de encompasses
    pub prompts: HashMap<PathBuf, String>,                  // dir relativo → texto do _prompt.yaml
    pub graph_dir: PathBuf,
}
pub enum GraphError { Io, Yaml{file,source}, Json{file,source}, DuplicateNode, UnknownPrerequisite{node,prereq},
                      CycleDetected, NodeNotFound, NodeAlreadyExists, HasDependents{node,dependents}, PrerequisiteNotFound }
pub struct ValidationReport { node_count, edge_count, domains: Vec<(String,usize)>, root_nodes, leaf_nodes,
                              orphan_nodes, encompasses_count }
pub struct NodeUpdate { prereqs: Option<Vec<String>>, bloom: Option<BloomLevel>, assess: Option<Vec<String>>,
                        context: Option<Option<String>>, tags: Option<Vec<String>>,
                        typical_grade: Option<Option<u8>>, encompasses: Option<HashMap<String,f32>> }
```

### 3.3 Carga (`Graph::load` → `load_dir_recursive`)

1. `read_dir` recursivo com entradas **ordenadas por nome** (determinismo).
2. `*.yaml` chamado `_prompt.yaml` → `prompts[dir_relativo] = system`.
3. Qualquer outro `*.yaml` → desserializa `NodeFile`. Se o ID já existe → `DuplicateNode`. Deriva `domain`/`unit` do caminho e insere.
4. `rebuild_indices()` (abaixo).

### 3.4 `rebuild_indices` (a validação, rodada no load e após cada mutação)

1. Todo `prereq` existe, ou `UnknownPrerequisite` (fail-fast: aborta no primeiro).
2. Reconstrói `children`.
3. Todo alvo de `encompasses` existe (reutiliza o erro `UnknownPrerequisite`) e reconstrói `encompassed_by`.
4. `topo_sort` (Kahn) → `CycleDetected` se a ordem tiver menos nós que o grafo.

Filosofia declarada: "grafo ruim = falha barulhenta, o engine se recusa a subir".

### 3.5 `topo_sort`: Kahn com desempate determinístico

```rust
// in_degree[n] = |n.prereqs|
// queue = ids com grau 0, ordenados; pop() tira o ÚLTIMO (maior lexicograficamente)
while let Some(id) = queue.pop() {
    result.push(id);
    for other in nodes.values() {                 // ← varre TODOS os nós a cada pop
        if other.prereqs.contains(id) { in_degree[other] -= 1; if 0 { queue.push(other); queue.sort(); } }
    }
}
if result.len() != nodes.len() { Err(CycleDetected) }
```

- **Complexidade:** O(V·(V·p̄) + V·V log V) ≈ O(V²), porque não usa o índice `children` que acabou de construir. Com 131 nós, é irrelevante. Com 10⁴ nós, faz ~10⁸ comparações de string **a cada mutação**: segundos.
- **Desempate:** maior ID primeiro (pilha ordenada), arbitrário pedagogicamente.
- Erro de ciclo sem o caminho do ciclo: ruim para o autor ou para o LLM corrigir.

### 3.6 O "o que fazer a seguir": `get_frontier`

```rust
pub fn get_frontier(&self, state: &StudentState) -> Vec<&Node> {
    self.topo_order.iter().filter_map(|id| {
        let node = &self.nodes[id];
        if state.mastery.contains_key(id) { return None; }                 // já dominado
        if node.prereqs.iter().all(|p| state.mastery.contains_key(p)) { Some(node) } else { None }
    }).collect()
}
```

- Retorna **todos** os nós da fronteira, em ordem topológica, sem limite, ranking, plan, revisões ou nível. Para um aluno novo, são as raízes.
- O README diz que é "o canal de flow de Csikszentmihalyi computado de um grafo": todo item disponível é alcançável (prereqs dominados) e novo. **A escolha do item é delegada ao LLM** ("o grafo diz o que está disponível; o agente escolhe", por exemplo pelo interesse do aluno).
- Complexidade O(V·p̄) por chamada: ok.

### 3.7 `record_mastery` (em `core/src/student.rs`)

```rust
pub fn record_mastery(&mut self, graph: &Graph, node_id: &str, level: BloomLevel) -> Result<Vec<String>, StudentError> {
    if !graph.nodes.contains_key(node_id) { return Err(UnknownNode) }
    self.mastery.insert(node_id, MasteryRecord { level, mastered_at: Utc::now() });   // sobrescreve
    // "newly unlocked" = filhos de node_id não dominados cujos prereqs estão TODOS dominados
    graph.children[node_id].filter(|c| !mastered(c) && graph.nodes[c].prereqs.all(mastered))
}
```

- **Não verifica** se `node_id` estava na fronteira, o que quebra o gate, nem se `level >= node.bloom`.
- Persistência: o servidor faz `StudentState::save(PROGRESS_DIR/{student_id}.json)` com `to_string_pretty` (escrita não atômica).

### 3.8 Cascata de prompts (`get_prompt_cascade`) e o bug do prompt raiz

```rust
let mut current = PathBuf::new();
for component in rel_path.parent()?.components() {    // ex.: "fractions", "equivalence"
    current = current.join(component);
    if let Some(p) = self.prompts.get(&current) { parts.push(p) }
}
if let Some(ctx) = &node.context { parts.push(ctx) }
parts.join("\n")
```

O `_prompt.yaml` da raiz é guardado com a chave `""` (PathBuf vazio), mas o laço só consulta **depois** de juntar o primeiro componente. **O prompt de nível subject nunca é incluído.** Logo, "Socratic method…", que é a política global, não chega ao tutor via `get_node`. O teste `prompt_cascade_works` só verifica `is_some()`, e o `context` do nó basta para isso, por isso o bug passou.

### 3.9 Consultas auxiliares

- `list_domains()` → `(domain, count)` ordenado.
- `list_nodes(domain, unit?, tag?)` em ordem topológica. No teacher, também filtra por `grade`.
- `search_nodes(q)`: substring case-insensitive em id, display_name, tags e context.
- `prereq_depth(id)`: o caminho mais longo até uma raiz, via **DFS com pilha e sem memoização**. Enumera **todos os caminhos**, o que é exponencial em DAGs com muitos diamantes. É chamado em todo `get_node`. Com milhares de nós e grau 2, pode explodir. É preciso fazer DP em ordem topológica.

### 3.10 `validate()` (relatório, não bloqueia)

Retorna `node_count`, `edge_count`, `domains`, `root_nodes` (sem prereqs), `leaf_nodes` (sem filhos), `orphan_nodes` (raiz **e** folha, ou seja, isolado) e `encompasses_count`. Não verifica redundância transitiva, ID↔caminho, pesos, auto-referência nem consistência de nível.

### 3.11 Mutações (para o teacher)

| Função | Validação | Ordem real | Problema |
|---|---|---|---|
| `create_node` | ID novo; prereqs existem | grava o YAML, insere e roda `rebuild_indices` | Não valida alvos de `encompasses` antes de gravar. Se `rebuild` falhar, o arquivo fica no disco e o nó na memória |
| `update_node` | prereqs existem | muta bloom/assess/context/tags/grade/encompasses **antes** de validar os prereqs; grava; só reconstrói se `prereqs` mudou | Mutação parcial em memória quando um prereq é inválido. Mudar `encompasses` **não reconstrói `encompassed_by`** (índice obsoleto) nem valida os alvos |
| `delete_node` | sem dependentes em `children` | remove da memória, apaga o arquivo, roda `rebuild` | Se outro nó tem `encompasses` apontando para ele, o arquivo já foi apagado e o `rebuild` falha: estado quebrado |
| `add_prerequisite` | prereq existe | adiciona, **grava o YAML**, roda `rebuild` | **Cria ciclos no disco.** A descrição da tool diz "Validates no cycle would be created", o que é falso: o erro vem depois da gravação e a memória fica com o ciclo |
| `remove_prerequisite` | n/a | grava e reconstrói | ok |

**Lição para o port:** aplicar o patch numa **cópia**, validar todas as invariantes e só então persistir de forma atômica (transação, ou escrita em arquivo temporário seguida de rename).

### 3.12 Revisão / repetição espaçada

Nada implementado. O desenho documentado tem quatro partes:

- confiança por nó que decai com o tempo;
- taxa de decaimento conforme a profundidade do domínio e a frequência com que o nó é englobado;
- abaixo do limiar, o nó volta à fronteira como **tarefa de revisão**;
- revisar um nó avançado refresca os prereqs via `encompasses` ("praticar na fronteira mantém as fundações frescas").

O placement diagnostic seria uma busca binária no DAG: testar um nó intermediário; se dominado, marcar o nó e seus ancestrais; senão, descer. O doc estima de 10 a 15 perguntas para ~100 nós.

### 3.13 Testes (17, todos em `core`; os crates MCP têm 0)

`graph.rs` (14):
- `load_graph`
- `topo_order_valid` (todo prereq aparece antes do dependente)
- `empty_student_frontier_has_root_nodes`
- `prompts_loaded`
- `prompt_cascade_works`
- `list_domains_works`
- `search_nodes_works`
- `validate_works`
- `encompasses_loaded` (≥10 nós)
- `encompasses_reverse_index` (`ops.mul.facts` é englobado)
- `encompasses_weights_valid` (0<w≤1, alvo existe)
- `encompasses_in_validation_report` (≥20)
- `create_and_delete_node` (tempdir)
- `update_node_encompasses` (persiste e recarrega)

`student.rs` (3): `record_mastery_returns_unlocked`, `record_mastery_unknown_node`, `save_and_load_roundtrip`.

Características: são testes de integração contra o grafo real `graph/math`, e não fixtures. Cobertura ausente:
- detecção de ciclo;
- `UnknownPrerequisite`;
- `add_prerequisite` gerando ciclo;
- a fronteira depois de dominar nós;
- o conteúdo exato da cascata (o que teria pego o bug do prompt raiz);
- gates;
- servidores MCP.

`#![deny(warnings)]` está em `lib.rs` e nos `main.rs`.

### 3.14 Bugs e lacunas (lista consolidada)

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 1 | Alta | `student.rs::record_mastery` | O gate não é imposto: domina nós bloqueados e ignora `level` vs `bloom` |
| 2 | Alta | `graph.rs::add_prerequisite` / `update_node` | Grava antes de validar: um ciclo pode ir para o disco e a memória fica inconsistente |
| 3 | Alta | `mcp-*/sse.rs` | Bind em `0.0.0.0`, CORS `*`, sem auth. O teacher expõe escrita em disco e `git add . && git commit` para a rede local |
| 4 | Alta | `student server` / `set_prompt` / `artifacts.rs` | Path traversal: `student_id`, `path`, `scope` e `filename` vão direto para `join()` |
| 5 | Média | `get_prompt_cascade` | O prompt raiz (subject) nunca é incluído |
| 6 | Média | `types.rs::PromptFile` | Os grafos de language usam `teaching:`, e o engine não os carrega |
| 7 | Média | `delete_node` | Ignora referências de `encompasses` e deixa o estado quebrado |
| 8 | Média | `update_node` | `encompassed_by` fica obsoleto; alvos não são validados |
| 9 | Média | `prereq_depth` | Exponencial (enumera caminhos) |
| 10 | Média | `topo_sort` | O(V²) e reexecutado em toda mutação |
| 11 | Baixa | `stdio.rs` | JSON inválido em uma linha derruba o servidor (`?` no parse) |
| 12 | Baixa | `handle_request` | Responde sempre `protocolVersion: "2024-11-05"`, sem negociar |
| 13 | Baixa | `get_frontier` (MCP) | Sem limite: com milhares de nós, despeja centenas de itens no contexto do LLM |
| 14 | Dados | `graph/math` | 11 arestas transitivas, 34 nomes de arquivo ≠ ID e `know` nunca usado |
| 15 | Docs | engine/README, graph/README, schema.json | Desatualizados (alvos de make inexistentes, formato v1.0) |

---

## 4. (c) Integração com LLM: MCP e como o tutor recebe contexto

### 4.1 Transportes (implementação manual de JSON-RPC 2.0)

- **stdio:** uma linha = uma requisição JSON. A resposta vai para stdout. Notificações (id nulo) não respondem.
- **HTTP+SSE legado** (axum):
  - `GET /sse` cria uma sessão UUID e emite `event: endpoint` com `/messages/{session_id}`;
  - `POST /messages/{session_id}` com o corpo JSON-RPC responde **202** e envia a resposta pelo stream SSE (`event: message`);
  - keepalive a cada 15 s; `GET /ping` retorna `pong`.
- Portas padrão: student 3001, teacher 3002 (`--port N`). A config de exemplo está em `mcp.json.example` (`command` + `args: ["--stdio"]` + `env: GRAPH_DIR, PROGRESS_DIR | REPO_DIR`).
- Métodos atendidos: `initialize`, `notifications/initialized`, `tools/list` e `tools/call`. Não há `resources/*`, `prompts/*` nem `ping` JSON-RPC. Os erros de tool vêm como `result.content[0].text = "Error: …"` com `isError: true`.
- **Estado da arte em 2026-11:** a especificação MCP mais recente é a revisão **2026-07-28**, que tornou o core *stateless*. O transporte HTTP+SSE está depreciado desde 2025-03-26, e o caminho recomendado é o **Streamable HTTP**. O open-mastery está duas gerações atrás (2024-11-05 + SSE legado).

### 4.2 Student MCP (o "tutor")

`initialize.result.instructions` (é o único "system prompt" que o servidor injeta):
> "You are a math tutor powered by the Open Mastery knowledge graph. Use get_frontier to find what to teach next. Use get_node to get the topic details and teaching guidance (the prompt_cascade tells you HOW to teach). Teach, assess with problems matching the assess types, and call record_mastery when the student demonstrates mastery. Be encouraging and adaptive."

| Tool | Input | Output (JSON em texto) |
|---|---|---|
| `get_frontier` | `{student_id}` | `{student_id, frontier_count, nodes:[{id, name, domain, unit, assess, bloom}]}` |
| `get_node` | `{node_id}` | `{id, name, domain, unit, prerequisites:[{id,name}], unlocks:[{id,name}], assess, bloom, tags, typical_grade, context, prompt_cascade, prereq_depth}` |
| `record_mastery` | `{student_id, node_id, level?="apply"}` | `{mastered:{id,name,level}, newly_unlocked_count, newly_unlocked:[{id,name}]}` |
| `get_progress` | `{student_id}` | `{student_id, total_nodes, mastered_count, mastered:[{id,name,level,mastered_at}]}` (ordem de HashMap, ou seja, aleatória) |

O fluxo pretendido (DEVELOPER.md, "For students") tem 8 passos:
1. O cliente MCP conecta.
2. O tutor chama `get_frontier`.
3. O aluno escolhe, ou o tutor recomenda.
4. O tutor chama `get_node` e recebe a cascata pedagógica.
5. O tutor ensina, gera problemas segundo `assess` e avalia.
6. O tutor chama `record_mastery`.
7. O servidor devolve os novos desbloqueados.
8. O ciclo se repete.

### 4.3 O que o tutor **não** recebe (lacunas de contexto)

- Nenhum estado do aluno na cascata: o doc promete "[student state: mastered prereqs, current belief]".
- Nada de evidências, erros recorrentes, pontos fracos ou histórico de tentativas. A única memória é o conjunto de nós dominados.
- Nada de revisões vencidas nem de ranking ou recomendação.
- Nada de recursos (livros, vídeos): o teacher tem *artifacts* (arquivos base64 por escopo), mas o student não os expõe.
- **O LLM é o avaliador e o gate.** O README admite que "LLM-as-assessor é um problema fundamentalmente não resolvido".

### 4.4 Teacher MCP (curadoria conversacional), 18 tools

- **Browse:** `list_domains`, `list_nodes{domain, unit?, tag?, grade?}`, `search_nodes{query}`, `get_node{node_id}` (inclui `encompasses` e `encompassed_by`), `validate_graph`.
- **CRUD:** `create_node{id, prereqs, bloom, assess, context?, tags?, typical_grade?, encompasses?}`, `update_node{node_id, …parcial; context:null limpa}`, `delete_node`, `add_prerequisite{node_id, prerequisite_id}`, `remove_prerequisite`.
- **Prompts:** `get_prompt_cascade{node_id}`, `set_prompt{path, system}` (grava `system: >` + texto indentado).
- **Git:** `git_status` (`git status --short`), `git_commit{message}` (`git add .` + `git commit -m`), `git_log{count=10}`.
- **Artifacts:** `save_artifact{scope, filename, data(base64)}` → `GRAPH_DIR/artifacts/{scope}/{filename}`; `get_artifact`; `list_artifacts`.
- `instructions` do teacher: "You are a curriculum authoring assistant… Node IDs are three-part keys… Every change writes YAML files to disk."

É o protótipo de "o grafo é editado por conversa com IA": exatamente o mecanismo de que precisamos para a **expansão procedural**, só que sem transação, sem validação prévia e sem revisão humana.

### 4.5 `web/skilltree` (consumidor alternativo, sem MCP)

`export.py <dir>` faz parsing de YAML **por regex**. É frágil: assume `prereqs` antes de `bloom` e `context: >`. Gera `{nodes:[{id, name (última parte do id), region (diretório mais interno), prereqs, context, members?}]}`. `members` são até 5 kana extraídos do `context` para nós de linha (`.kana.`/`.kata.`), e uma linha conta como dominada quando todos os caracteres-membros estão dominados.

O `index.html` (JS puro, tema escuro) traz ideias boas e baratas:

- **Domínio por sequência:** `owned = stats[id].streak >= 3` (constante `STREAK=3`), lido de `localStorage[?progress]`. Um nó agregado é *owned* se `members.every(owned)`.
- **4 estados honestos:**
  - `owned` (verde);
  - `open` (prereqs ok; "o convite");
  - `locked` (diz quais prereqs faltam);
  - `unbuilt` (tracejado: "nós ainda não fizemos o conteúdo; isso é com a gente, não com você").
- **Projeção jogável:** `gates(n) = n.prereqs.filter(built)`. **Um prereq sem conteúdo não bloqueia nada**, o que é essencial num grafo que cresce proceduralmente (nós *stub* não podem travar o aluno).
- **Níveis = profundidade**, `depth = 1 + max(depth(prereqs))` com memo, renderizados por **strand**, ou seja, por prefixo do ID (componentes sem arestas entre si viram abas).
- **"next ▸"** é o nó aberto mais raso (`depth` asc, depois `id`) da strand visível. `?level=auto` abre o nível mais baixo ainda não concluído.
- **Intenção vs. evidência:** a escolha de aba é salva com timestamp e só vence se for mais recente que a última tentativa registrada. Isso vale para nossa troca de sessões por domínio.
- Arestas desenhadas em SVG (Bézier), acesas quando o prereq está dominado. Modo debug (`?debug=1`) para *claim/reset* de nós.
- Depende de `../bar.js` e `../packs.json` (mapa nó → jogo), que não estão no repo. A página não roda isolada.

---

## 5. (d) Como portar para TypeScript e escalar para milhares de nós e novos domínios

### 5.1 Onde encaixar no learnharness

O learnharness já tem um **grafo de conhecimento bottom-up**: `src/core/graph.ts` extrai proposições e cadeias das sessões (extrator LLM → auditor → merger determinístico em ledgers). O open-mastery é o oposto, um **currículo top-down**. Os dois são complementares:

- **Currículo (novo):** "o que existe para aprender e em que ordem" (DAG de conceitos com gates).
- **Grafo do aprendiz (existente):** "o que este aluno articulou". Pode servir de **evidência** para os nós do currículo, por exemplo ao vincular proposições a nós via o auditor.

Proposta de layout, seguindo as convenções do repo (núcleo puro com *ports* explícitos, sem imports de adaptador; tools com TypeBox + `AgentTool` de `@earendil-works/pi-agent-core` + `serverExecute`, como em `src/agent/tools/graph.ts`):

```
src/core/curriculum/
  contracts.ts      ← tipos (schema v2) + TypeBox para validar YAML/JSON e patches do LLM
  build.ts          ← indexação: nodes, children, parentOf, topo, depth, encompassedBy
  validate.ts       ← invariantes (erros e warnings), checagem incremental, redução transitiva
  frontier.ts       ← fronteira, desbloqueios, gates, projeção "stub não bloqueia"
  mastery.ts        ← evidência → crença (BKT), regra de gate
  review.ts         ← FSRS por nó + crédito implícito via encompasses (estilo FIRe)
  rank.ts           ← "próxima ação": mistura revisões × novos, score explicável
  cascade.ts        ← cascata pedagógica (domínio → … → nó) + bloco de estado do aluno
  expand.ts         ← protocolo de expansão procedural (patch do LLM → validar → aplicar)
src/core/ports.ts   ← + CurriculumStore, LearnerStateStore (por domínio/sessão)
src/server/…        ← adaptadores fs (YAML/JSONL) ou SQLite
src/agent/tools/curriculum.ts ← tools do tutor (where_am_i, next_steps, get_node, record_evidence, …)
content/curricula/<dominio>/  ← DADOS (licença própria, ver §6)
```

### 5.2 Schema v2 proposto (hierárquico, N níveis, multi-domínio)

Princípios: **separar a hierarquia (árvore, para navegação, prompts e recursos) das dependências (DAG, para os gates)**, como o open-mastery já faz implicitamente. Mas a hierarquia vira um dado explícito e de profundidade arbitrária, em vez de vir do filesystem.

```ts
// src/core/curriculum/contracts.ts (esboço)
export type NodeId = string;          // estável, opaco ao aluno: "elx:9f3k2a" (ULID/nanoid curto) — NUNCA reutilizado
export type Slug = string;            // legível e mutável: "eletronica/circuitos-dc/lei-de-ohm"
export type Bloom = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create"; // Bloom revisado (6)
export const BLOOM_RANK: Record<Bloom, number> = { remember: 0, understand: 1, apply: 2, analyze: 3, evaluate: 4, create: 5 };

export type Stage =                   // níveis acadêmicos (meta 1: "princípios → doutorado")
  | "fundamentos" | "medio" | "tecnico" | "graduacao" | "pos" | "doutorado";

export interface PrereqRef {
  id: NodeId;                         // pode apontar para um CONCEPT ou para uma REGION
  strength: "required" | "recommended";      // aresta suave (STORY.md); só "required" bloqueia
  minCoverage?: number;               // se id é REGION: fração de folhas exigida (default 1.0)
}

export interface CurriculumNode {
  id: NodeId;
  slug: Slug;
  kind: "domain" | "region" | "concept";     // domain/region = hierarquia; concept = folha ensinável
  parent: NodeId | null;              // árvore: exatamente 1 pai (exceto o domínio)
  title: string;                      // nome humano (open-mastery derivava do filename — evitar)
  aliases?: string[];                 // nomes antigos/sinônimos (busca + identidade p/ o auditor)
  redirects?: NodeId;                 // nó fundido/renomeado → estado do aluno migra (IDs nunca somem)
  prereqs: PrereqRef[];               // DAG (somente em concept; region pode ter prereqs de "entrada")
  bloom: Bloom;                       // limiar de domínio
  assess: string[];                   // vocabulário controlado + extensível (ver §2.6)
  stage: Stage;
  difficulty?: number;                // 1..10 dentro do domínio (calibração/ranking)
  cefr?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";   // Inglês
  estMinutes?: number;                // orçamento de tempo (meta: 1000–1500 h/domínio)
  context?: string;                   // orientação pedagógica (como o open-mastery)
  misconceptions?: string[];          // erros típicos (GRAPH_FORMAT cita como desejável)
  encompasses?: Record<NodeId, number>;      // peso (0,1]
  teaching?: string;                  // cascata: texto aplicado a este nó e descendentes (ex-_prompt.yaml)
  status: "stub" | "draft" | "reviewed" | "verified";   // stub = "unbuilt" (não bloqueia)
  expansion?: { policy: "on-approach" | "manual" | "frozen"; targetChildren?: number };
  provenance: { createdBy: "human" | `llm:${string}`; createdAt: string; patchId?: string; sources?: string[] };
  version: number;
}

export interface Resource {           // livros/vídeos ligados a REGIÕES (livros cobrem regiões maiores)
  id: string;
  type: "book_chapter" | "video" | "article" | "course_lecture";
  title: string; url?: string; lang: "pt" | "en" | string;
  captions?: { lang: string; auto: boolean }[];   // vídeo EN com legenda/dublagem auto
  covers: { node: NodeId; role: "primary" | "supplementary" }[];   // concept OU region
  order?: number;                     // ordem dentro da região
  locator?: { book?: string; edition?: string; chapter?: string; pages?: string; startSec?: number; endSec?: number };
}
```

Exemplo YAML (um arquivo por nó continua bom para git/PR; para geração procedural, ver §5.9):

```yaml
# content/curricula/eletronica/circuitos-dc/lei-de-ohm.yaml
id: elx:01JD3Q8M
slug: eletronica/circuitos-dc/lei-de-ohm
kind: concept
parent: elx:01JD3Q2A            # region "circuitos-dc"
title: Lei de Ohm
prereqs:
  - { id: elx:01JD3P9C, strength: required }            # corrente, tensão e resistência
  - { id: mat:alg-eq-one-step, strength: required }     # nó importado da "Matemática base"
bloom: apply
assess: [solve, explain, predict, word_problem]
stage: tecnico
difficulty: 2
estMinutes: 45
context: >
  V = R·I como relação constitutiva de resistores ôhmicos (e quando NÃO vale: diodos, lâmpadas).
  Partir de medição intuitiva (multímetro), depois algebrizar. Unidades sempre explícitas.
misconceptions:
  - "corrente é 'consumida' pelo resistor"
encompasses: { mat:alg-eq-one-step: 0.6 }
status: reviewed
provenance: { createdBy: "llm:<modelo>", createdAt: 2026-11-18T00:00:00Z }
version: 1
```

```yaml
# content/curricula/ingles/pronuncia/th-surdo.yaml (para falante de PT-BR)
id: eng:01JD4A11
slug: ingles/pronuncia/consoantes/th-surdo
kind: concept
parent: eng:01JD49ZZ
title: "/θ/ (think) sem virar /f/ ou /t/"
prereqs: [{ id: eng:01JD49X0, strength: required }]   # IPA básico
bloom: apply
assess: [identify, produce, dictation]
stage: fundamentos
cefr: A2
estMinutes: 30
context: >
  Falantes de PT tendem a substituir por /f/ ou /t/. Pares mínimos (think/fink/tink), posição da língua.
status: draft
provenance: { createdBy: "llm:<modelo>", createdAt: 2026-11-18T00:00:00Z }
version: 1
```

**Pré-requisito de região** (para escalar sem explodir arestas): "Circuitos AC exige a região Trigonometria com 80% de cobertura" vira **uma** aresta `{id: mat:trigonometria, strength: required, minCoverage: 0.8}`, em vez de 20 arestas para as folhas. O engine expande ou agrega na hora: a cobertura da região é a fração de folhas `concept` dominadas, o mesmo padrão do `members` do skilltree.

### 5.3 Algoritmos em TypeScript (esboço fiel ao Rust, mas corrigido)

```ts
// build.ts — O((V+E) log V), determinístico, com caminho do ciclo
export interface Built {
  nodes: Map<NodeId, CurriculumNode>;
  children: Map<NodeId, NodeId[]>;        // DAG reverso (só prereqs "required"+"recommended")
  kids: Map<NodeId, NodeId[]>;            // árvore (parent → filhos)
  topo: NodeId[]; topoIndex: Map<NodeId, number>;
  depth: Map<NodeId, number>;             // caminho mais longo (DP), = "nível" visual
  encompassedBy: Map<NodeId, Array<[NodeId, number]>>;
}

export function topoSort(nodes: Map<NodeId, CurriculumNode>, children: Map<NodeId, NodeId[]>):
  { ok: true; order: NodeId[] } | { ok: false; cycle: NodeId[] } {
  const indeg = new Map<NodeId, number>();
  for (const n of nodes.values()) indeg.set(n.id, n.prereqs.length);
  const ready = [...nodes.keys()].filter((id) => indeg.get(id) === 0).sort(); // min primeiro
  const order: NodeId[] = [];
  while (ready.length) {
    const id = ready.shift()!;                       // menor slug/id primeiro (troque por min-heap se V > 50k)
    order.push(id);
    for (const c of children.get(id) ?? []) {
      const d = indeg.get(c)! - 1; indeg.set(c, d);
      if (d === 0) insertSorted(ready, c);
    }
  }
  return order.length === nodes.size ? { ok: true, order } : { ok: false, cycle: findCycle(nodes) };
}

function insertSorted(arr: NodeId[], x: NodeId): void {             // busca binária; O(n) no splice (ok até ~10^5)
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  arr.splice(lo, 0, x);
}

function findCycle(nodes: Map<NodeId, CurriculumNode>): NodeId[] {   // DFS 3 cores → caminho legível
  const color = new Map<NodeId, 0 | 1 | 2>(); const stack: NodeId[] = [];
  const dfs = (u: NodeId): NodeId[] | null => {
    color.set(u, 1); stack.push(u);
    for (const p of nodes.get(u)!.prereqs) {
      const c = color.get(p.id) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(p.id)), p.id];
      if (c === 0) { const r = dfs(p.id); if (r) return r; }
    }
    stack.pop(); color.set(u, 2); return null;
  };
  for (const id of nodes.keys()) if (!color.get(id)) { const r = dfs(id); if (r) return r; }
  return [];
}

export function longestDepth(b: Pick<Built, "nodes" | "topo">): Map<NodeId, number> {   // O(V+E), não exponencial
  const d = new Map<NodeId, number>();
  for (const id of b.topo) d.set(id, 1 + Math.max(0, ...b.nodes.get(id)!.prereqs.map((p) => d.get(p.id) ?? 0)));
  return d;
}

/** Adicionar aresta prereq→node cria ciclo sse `node` já alcança `prereq` seguindo `children`. */
export function wouldCreateCycle(b: Built, node: NodeId, prereq: NodeId): boolean {
  if (node === prereq) return true;
  const seen = new Set<NodeId>(); const st = [node];
  while (st.length) { const u = st.pop()!; if (u === prereq) return true;
    for (const c of b.children.get(u) ?? []) if (!seen.has(c)) { seen.add(c); st.push(c); } }
  return false;
}
```

```ts
// frontier.ts — gate imposto + projeção "stub não bloqueia" + soft edges + região
export interface MasteryView { isMastered(id: NodeId): boolean; regionCoverage(id: NodeId): number; }

export function prereqSatisfied(b: Built, m: MasteryView, p: PrereqRef): boolean {
  if (p.strength === "recommended") return true;                   // aresta suave não bloqueia
  const target = b.nodes.get(p.id)!;
  if (target.status === "stub") return true;                       // sem conteúdo → não bloqueia (skilltree)
  return target.kind === "concept" ? m.isMastered(p.id) : m.regionCoverage(p.id) >= (p.minCoverage ?? 1);
}

export function frontier(b: Built, m: MasteryView, opts: { domain?: NodeId; includeStubs?: boolean } = {}): NodeId[] {
  return b.topo.filter((id) => {
    const n = b.nodes.get(id)!;
    if (n.kind !== "concept" || m.isMastered(id)) return false;
    if (n.status === "stub" && !opts.includeStubs) return false;   // stub = gatilho de expansão, não item de estudo
    return n.prereqs.every((p) => prereqSatisfied(b, m, p));
  });
}

/** "newly unlocked" após dominar x (para o feedback e para XP). */
export function unlockedBy(b: Built, m: MasteryView, x: NodeId): NodeId[] {
  return (b.children.get(x) ?? []).filter((c) => !m.isMastered(c) &&
    b.nodes.get(c)!.prereqs.every((p) => prereqSatisfied(b, m, p)));
}
```

Desempenho esperado: com V=10⁴ e E=3·10⁴, `build` + `validate` levam dezenas de ms em Node, e `frontier` leva menos de 5 ms. **Não há motivo para Rust/WASM.** Se for preciso, bitsets de alcançabilidade (`Uint32Array`, V² bits = 12,5 MB para 10⁴) dão ancestrais e descendentes em O(1) para o ranking e a redução transitiva.

### 5.4 Invariantes (validador transacional) e "lógica de evolução formalmente correta"

Toda mutação (de humano, teacher-tool ou expansão por LLM) vira um **patch**. O fluxo é aplicar o patch numa cópia, rodar `validate()`, **só então** persistir (append no ledger JSONL ou transação SQLite) e reconstruir os índices. É o contrário do open-mastery.

| # | Invariante | Tipo | Como checar |
|---|---|---|---|
| I1 | Todo `prereq.id`, `parent`, alvo de `encompasses` e `redirects` existe | erro | lookup |
| I2 | O DAG de prereqs é acíclico | erro | Kahn; incremental com `wouldCreateCycle` |
| I3 | A hierarquia é uma árvore: 1 pai, sem ciclo, `domain` na raiz, `concept` só como folha | erro | DFS pelos `parent` |
| I4 | Prereq de região não aponta para ancestral nem descendente do próprio nó | erro | ancestrais na árvore |
| I5 | IDs únicos e **nunca reutilizados**; nó removido vira `redirects` ou tombstone | erro | ledger |
| I6 | `encompasses`: w ∈ (0,1], sem auto-referência | erro | |
| I7 | `encompasses` com alvo não-ancestral | warning | ancestrais no DAG |
| I8 | Aresta transitiva redundante (p ∈ ancestors(q), q ∈ prereqs) | warning e **autofix** opcional | bitset de ancestrais |
| I9 | Monotonicidade de nível: `stage`/`difficulty` do prereq ≤ do dependente | warning | |
| I10 | Todo `concept` alcança uma raiz do domínio | warning | BFS |
| I11 | **Não-regressão do aluno:** um patch que adiciona prereq a um nó já dominado não revoga o domínio (o novo prereq vira "revisão sugerida") | política | aplicada no `MasteryView` |
| I12 | Patch do LLM só referencia IDs existentes ou criados no próprio patch; cada nó novo tem ≥1 `assess` e `context` | erro | TypeBox + checagem |

Sobre **Lean 4 / provas**: essas propriedades são clássicas e fáceis de especificar. Exemplos:

- "a fronteira só contém nós com prereqs `required` satisfeitos";
- "acrescentar um nó novo cujos prereqs já existem preserva a aciclicidade" (ninguém depende dele ainda);
- "acrescentar a aresta u→v preserva a aciclicidade ⇔ ¬reach(v,u)";
- "dominar x só remove x da fronteira e só adiciona filhos de x".

Recomendação pragmática:

1. Escrever a especificação dessas 4–6 propriedades em Lean 4 sobre um modelo abstrato (relação finita) como **documento de referência**.
2. A garantia em produção vem de **property-based tests** em TS (ex. `fast-check`), gerando DAGs e patches aleatórios e verificando as mesmas propriedades contra `frontier`/`validate`/`applyPatch`.

O código Rust não tem nenhuma dessas propriedades testadas.

### 5.5 Mastery com evidência (gate imposto pelo servidor)

O tutor não chama mais "record_mastery". Ele chama **`record_evidence`**, e o engine decide.

```ts
export interface Evidence {
  nodeId: NodeId; at: string;
  assess: string;                 // tipo de item (solve, explain, derive…)
  bloom: Bloom;                   // nível cognitivo do item
  correct: boolean | number;      // 0..1 se nota parcial
  difficulty?: number;            // relativo ao nó
  misconceptions?: string[];      // tags → "pontos fracos" (meta 2)
  source: "tutor" | "flashcard" | "quiz" | "anki-sync";
}
// BKT por nó (Corbett & Anderson 1994): P(L0), P(T), P(G) por tipo de item, P(S)
//   correto: post = L(1-S) / (L(1-S) + (1-L)G)      errado: post = L·S / (L·S + (1-L)(1-G))
//   L' = post + (1 - post)·T
// G (chute) baixo para explain/derive/generate (~0.05), alto para identify/compare (~0.25) —
// formaliza a intuição do open-mastery de que explain/derive são "difíceis de fingir".
// GATE: L ≥ 0.95 ∧ ≥ 2 tipos de assess distintos ∧ ≥ 1 evidência com BLOOM_RANK ≥ BLOOM_RANK[node.bloom]
```

O `isMastered(id)` do `MasteryView` passa a ser o estado derivado do *fold* das evidências, que é reprodutível e auditável. Os pontos fracos são consultáveis: nós com L em queda, `misconceptions` recorrentes e prereqs de nós em que o aluno falha.

### 5.6 Revisão: FSRS por nó + crédito implícito via `encompasses` (estilo FIRe)

- O campo `encompasses` do open-mastery vem do **FIRe (Fractional Implicit Repetition)** de Justin Skycak/Math Academy. Pelas descrições públicas (cap. 26 de *The Math Academy Way*, rascunho de 2024), repetições em tópicos avançados "escorrem" para baixo no grafo e atualizam o agendamento dos tópicos mais simples praticados implicitamente, inclusive prereqs de prereqs, com crédito fracionário quando a dependência é parcial. As fórmulas exatas não são públicas: **validar contra a fonte antes de copiar**.
- Proposta:
  1. Cada nó dominado ganha um cartão FSRS. A biblioteca é `ts-fsrs` (MIT). Segundo o README consultado em 2026-11-18, a linha v6 suporta FSRS 3 a 7, usa FSRS-7 por padrão e expõe a API `DefaultScheduler()`, `newCard`, `preview` e `review`, que difere da API antiga `fsrs()/createEmptyCard/repeat`. **Fixar a versão.**
  2. Revisar X com sucesso: para cada Y no fecho de `encompasses` de X, calcular o peso efetivo `w_eff = max sobre caminhos de Π w`. Se `w_eff ≥ 0.8`, registrar no cartão de Y uma revisão implícita *Good*. Se `0.3 ≤ w_eff < 0.8`, apenas adiar o vencimento de Y em `w_eff ×` (intervalo que *Good* daria), sem mexer na estabilidade. Abaixo de 0.3, nada. **Esses limiares são decisão nossa**; calibrar com dados.
  3. Falha em X: sinal fraco de fragilidade nos Y fortemente englobados, que vira candidato a sondagem e não penalidade automática.
  4. **Compressão de revisões:** dado o conjunto D de nós vencidos, escolher por guloso o menor conjunto de tarefas, preferindo nós da fronteira ou recentes que englobem o máximo de D (set cover ponderado). É o argumento do GRAPH_FORMAT: "praticar na fronteira mantém as fundações frescas".
- Os flashcards (meta 4: Anki/Obsidian) devem levar o **ID do nó como tag**. As revisões feitas no Anki voltam como `Evidence{source:"anki-sync"}`, num único modelo de memória.

### 5.7 Ranking do "próximo passo" (o open-mastery promete, mas não faz)

```
nextAction = (revisões vencidas comprimidas, se carga > orçamento) ?? argmax_score(fronteira)
score(n) = a·unlockGain(n)            // filhos que n desbloqueia de imediato + 0.1·log(1+|descendentes|)
         + b·planWeight(n)            // pertence ao plano/trilha ativa (plans do open-mastery)
         + c·weaknessProximity(n)     // reforça ou depende de nós com L baixo / misconceptions
         + d·continuity(n)            // mesma região do último estudo (sessão por domínio)
         + e·levelFit(n)              // stage/difficulty próximo do nível atual
         - f·stubPenalty(n)
desempate: topoIndex (determinístico)
```

O score deve devolver o **motivo** (decomposição dos termos), para o tutor explicar a escolha em uma frase e não despejar a lista. Limite: o tutor recebe os 3–5 primeiros, não a fronteira inteira (bug 13 do original).

### 5.8 Expansão procedural com LLM (o teacher MCP, com transação)

1. **Gatilho** (determinístico): uma região tem menos de k nós abertos para o aluno; ou o aluno se aproxima de um nó `stub` (profundidade de fronteira ≤ 2); ou o tutor detecta uma lacuna ("aluno travou: aresta faltando", a mesma heurística do open-mastery).
2. **Contexto para o LLM:** o subgrafo local (região, ancestrais e vizinhos), as regras de aresta da §2.4, as regras de granularidade ("3 problemas que isolam o nó") e o orçamento de horas da região.
3. **Saída obrigatória:** um JSON `Patch { addNodes[], addEdges[], updateNodes[], rationale }` validado por TypeBox. IDs novos são cunhados pelo engine e nunca pelo LLM; o LLM usa referências locais (`$new1`), como o learnharness já faz com ids locais no extrator.
4. **Validação** (§5.4). Em caso de falha, o erro estruturado (ex. o caminho do ciclo) volta ao LLM para correção, com no máximo N tentativas.
5. **Aplicação:** append no ledger com `patchId` e `provenance`. Os nós entram como `draft`. Depois, um segundo modelo-auditor ou o usuário os promove a `reviewed`.
6. **Subdomínios novos:** um patch pode criar uma `region` (ou um `domain`) com `status: stub` e `expansion.policy: on-approach`, que cresce sob demanda.

### 5.9 Escala: armazenamento, IDs e performance

- **Volume-alvo:** de 1000 a 1500 h por domínio, com nós de 30 a 60 min (ensino + prática + revisões), dá **≈1.500–3.000 conceitos por domínio**. É a mesma ordem do alvo do próprio open-mastery (~3.000 tópicos para math do 4º ano à universidade). Somando a "matemática base" compartilhada, são algo como 5–10 mil nós no app.
- **Armazenamento:** YAML por nó é ótimo para curadoria humana via git/PR, mas ruim para milhares de escritas procedurais. Proposta, coerente com o learnharness, que já usa ledgers JSONL e *fold* determinístico:
  - **fonte da verdade** = um `curriculum.jsonl` por domínio, só de patches (event-sourced);
  - **snapshot** materializado em memória ou SQLite;
  - **export/import YAML** para revisão e contribuição.
- **IDs estáveis e opacos** mais `slug` legível. Renomear ou mover só altera `slug`/`parent`. Fusão usa `redirects`. Com isso, o estado do aluno, os flashcards e as tags no Anki nunca quebram, um problema que o open-mastery não resolve.
- **Índices:** reconstrução total é O(V+E). Em patches pequenos, uma checagem incremental de ciclo (`wouldCreateCycle`) seguida de reconstrução total ainda é barata.

### 5.10 Domínios novos: semente para Eletrônica e Inglês

- **Matemática base (compartilhada):**
  - importar o grafo de math do open-mastery (131 nós; CC BY-SA, ver §6), traduzindo `context` para PT-BR e remapeando IDs;
  - acrescentar complexos, cálculo 1–3, álgebra linear, EDOs, Laplace/Fourier/Z e probabilidade/estatística;
  - deve ser um **domínio separado e compartilhado**. O domínio dos nós base é global por aprendiz, porque dominar log em Eletrônica vale para qualquer sessão.
- **Eletrônica** (regiões de 1º nível):
  - fundamentos de física elétrica;
  - circuitos DC;
  - circuitos AC/fasores;
  - transitórios e Laplace;
  - semicondutores e dispositivos;
  - analógica (amp-op, realimentação, filtros, osciladores);
  - digital (lógica, sequencial, FSM, HDL);
  - sinais e sistemas;
  - eletrônica de potência;
  - eletromagnetismo e RF;
  - instrumentação e medidas;
  - embarcados;
  - controle;
  - pós/doutorado: projeto de CI/VLSI, RF/microondas, física de semicondutores avançada, potência avançada, processamento estatístico de sinais, nanoeletrônica e tópicos de pesquisa (os últimos como `stub` expansíveis).

  Os recursos ficam em `Resource.covers` apontando para **regiões**, por exemplo um capítulo de livro-texto de microeletrônica cobrindo a região de amp-ops. A lei de Ohm (§5.2) é o exemplo de arestas que cruzam domínios.
- **Inglês (aprendiz PT-BR):**
  - pronúncia (IPA, pares mínimos críticos para lusófonos, acento, fala conectada);
  - gramática por banda CEFR A1→C2, reaproveitando a modelagem "anatomia da frase" dos 15 nós `gr.*`;
  - vocabulário por frequência, depois acadêmico, depois morfologia e etimologia, reaproveitando ideias de `sp.morph.*` e `sp.etym.*`;
  - listening, reading, writing (até escrita acadêmica C2, o "doutorado" do domínio), speaking, pragmática e registro.

  O `cefr` do nó substitui o `typical_grade`. Verificar a licença de qualquer lista de referência (descritores CEFR, listas de frequência) antes de importar o conteúdo.

### 5.11 Sessões separadas por domínio (meta 3)

- Estado do aprendiz particionado em `learners/<id>/domains/<domainId>/{evidence.jsonl, fsrs.json, memory/…}`. Os nós do domínio compartilhado (Matemática base) têm o estado em `domains/shared/`, acessível de qualquer sessão como leitura e escrita (decisão explícita).
- A **cascata pedagógica** começa no nó `domain` (`teaching`). É ali que mora a política anti-"explica rápido e despeja perguntas" (meta 9). Exemplo: "explique por completo, com exemplo, antes de qualquer pergunta; no máximo uma pergunta por vez; verifique o entendimento por aplicação, não por quiz em rajada".
- A troca de sessão segue o padrão "intenção (clique) vs. evidência (última tentativa), vence o mais recente" do skilltree.
- **Corrigir o bug do original:** a cascata deve **incluir o nível raiz** e acrescentar um bloco de estado do aluno: nó atual, prereqs frágeis, misconceptions ativas e revisões vencidas relacionadas.

### 5.12 Superfície de tools para o tutor (pi-agent-core) e MCP opcional

As tools são internas, como as de `src/agent/tools/graph.ts`, e não precisam de MCP.

| Tool | Equivalente no open-mastery | Mudança |
|---|---|---|
| `curriculum_where_am_i` | `get_progress` | Resumo compacto: nível por região, pontos fracos, revisões vencidas |
| `curriculum_next` | `get_frontier` | Top-k ranqueado **com motivo**; inclui revisões comprimidas |
| `curriculum_node` | `get_node` | Inclui a cascata completa (com raiz), recursos ordenados e misconceptions |
| `curriculum_record_evidence` | `record_mastery` | Gate decidido pelo engine; retorna "dominado?" e os desbloqueios |
| `curriculum_propose_expansion` | `create_node` / `add_prerequisite` | Patch transacional e validado (§5.8) |

Um servidor MCP opcional para clientes externos (Claude Desktop, Codex) pode reaproveitar o `@modelcontextprotocol/sdk` que o learnharness já declara (`1.32.1`), com transporte stdio ou Streamable HTTP. **Nunca** usar SSE legado sem auth em `0.0.0.0`.

---

## 6. (e) Copiar literalmente vs. reimplementar, e licenças

### 6.1 Decisão por artefato

| Artefato | Licença | Decisão | Motivo |
|---|---|---|---|
| `engine/crates/core` (Rust) | MIT | **Reimplementar em TS** (§5.3), com nota de atribuição por ser tradução e adaptação | Outra linguagem. Tem bugs de gate, mutação e prompt raiz. O algoritmo é trivial e o valor está nas correções |
| Nomes e contratos das tools (`get_frontier`, `get_node`, `record_mastery`, `get_progress`) e o texto de `instructions` | MIT | Inspirar-se (renomear e estender) | Úteis como referência do fluxo do tutor |
| `mcp-*/sse.rs`, `stdio.rs`, JSON-RPC manual | MIT | **Não copiar** | Protocolo obsoleto (2024-11-05 / SSE) e inseguro; usar o SDK oficial |
| `mcp-teacher/git.rs`, `artifacts.rs` | MIT | Não copiar | `git add .` cego, path traversal |
| `web/skilltree/index.html` | MIT (inferido do "all code" do LICENSE raiz) | **Reimplementar as ideias** em React (`@xyflow/react`/d3 já estão no learnharness) | Ideias valiosas (§4.5); código acoplado a `bar.js`/`packs.json` ausentes |
| `web/skilltree/export.py` | MIT (inferido) | Descartar | Parsing de YAML por regex |
| `graph/math/**` (131 nós + 19 prompts) | **CC BY-SA 4.0** | **Copiar e adaptar como dados** (domínio "Matemática base"), sob CC BY-SA 4.0, com atribuição e nota de modificações | A base para Eletrônica é economia real de curadoria. Remover as 11 arestas transitivas no import |
| `graph/language/english/grammar` (15) e `morphology`/`etymology` | CC BY-SA 4.0 | Copiar seletivamente como dados, se fizer sentido no Inglês avançado | Público-alvo diferente (crianças nativas) |
| `graph/language/japanese-kana` | CC BY-SA 4.0 | Não usar | Fora de escopo |
| `docs/GRAPH_FORMAT.md`, `BUILDER_BRIEF.md` (regras de aresta, granularidade, cascata) | **Sem licença explícita** | **Parafrasear** ideias (não são protegíveis); não copiar texto | `docs/` não está coberto pelo LICENSE raiz |
| `graph/schema.json`, `4th-grade.json` | CC BY-SA 4.0 | Ignorar | Legado |

### 6.2 Compatibilidade com AGPL-3.0 (nosso fork do learnharness: `"license": "AGPL-3.0-only"`)

- **MIT → AGPL-3.0:** compatível. Ao portar trechos (tradução de código também é obra derivada), manter o aviso: "Portions adapted from open-mastery (https://github.com/bxxd/open-mastery), MIT License, Copyright (c) 2026 OpenMastery contributors", junto com o texto da licença MIT, por exemplo em `THIRD_PARTY_NOTICES` e no cabeçalho dos arquivos portados.
- **CC BY-SA 4.0 (dados do grafo):**
  - Obrigações: **atribuição** (autor, link, licença), **indicar as modificações** (tradução, remapeamento, remoção de arestas), **ShareAlike** (adaptações sob BY-SA 4.0 ou licença compatível) e **sem restrições adicionais** (nada de DRM ou termos que limitem os direitos).
  - A Creative Commons declarou a BY-SA 4.0 **unidirecionalmente compatível com a GPLv3**. A **AGPLv3 não consta** dessa lista. Portanto, não incorporar o texto do grafo dentro de arquivos-fonte AGPL (ex. constantes TS com os `context`).
  - Manter os dados como **obra separada** (`content/curricula/**` com o próprio `LICENSE` CC BY-SA 4.0 e `NOTICE` de atribuição), carregados em runtime. É **agregação**, permitida tanto pela AGPL quanto pela BY-SA.
- **Conteúdo gerado por LLM a partir desses nós** (traduções, expansões sobre o `context` original) deve ser tratado como **adaptação**, sob CC BY-SA 4.0. Recomendação simples e coerente com o espírito do projeto: **licenciar todo o currículo do app sob CC BY-SA 4.0** e o código sob AGPL-3.0.
- Nota: no Brasil, bases de dados são protegidas como compilações (Lei 9.610/98, art. 7º, XIII). Os fatos de dependência em si ("log depende de expoentes") não são protegíveis, mas a seleção e o arranjo, e principalmente os textos de `context`, são. Isto não é parecer jurídico.

### 6.3 Checklist de atribuição

1. `content/curricula/matematica-base/LICENSE` com o texto da CC BY-SA 4.0 e `NOTICE.md` do tipo: "Derivado de open-mastery/graph/math (commit 2b6c156), © 2026 OpenMastery contributors, CC BY-SA 4.0. Modificações: tradução para PT-BR, IDs remapeados, arestas transitivas removidas, campos adicionados (stage, estMinutes…)."
2. `THIRD_PARTY_NOTICES` do app com o aviso MIT do engine, se qualquer trecho for portado.
3. Na UI (tela "sobre" ou créditos do domínio), a atribuição BY-SA visível.

---

## 7. Riscos e questões em aberto

1. **O LLM como avaliador** continua sendo o ponto fraco, como o próprio README admite. Mitigar com evidência multi-tipo, Bloom mínimo por item, rubricas por `assess` e checagem automática quando possível (numérica em Eletrônica, transcrição de áudio em Pronúncia).
2. **A curadoria em escala** é "onde todo projeto de currículo morre" (README). A expansão por LLM precisa de validação automática forte (§5.4), status `draft/reviewed` e sinais de uso, como no open-mastery: travou = aresta faltando; passou direto = aresta sobrando.
3. **Os pesos de `encompasses` e os limiares de crédito implícito** não têm base empírica no repo. Calibrar com dados próprios (ou simulação Monte Carlo, que a meta 5 já pede para XP).
4. **A crítica do próprio repo** (`docs/LANDSCAPE_ANALYSIS.md`, "Assumption 2"): o grafo de pré-requisitos é uma "mentira útil". Ele sequencia conteúdo, mas não modela a transferência. Vale incluir nós e avaliações de **transferência** (`word_problem`, `predict`, `repair`) e atrito produtivo, e não só um "progresso verde".
5. **O FIRe original** (Math Academy) é proprietário e só descrito em linhas gerais. Implementar a nossa versão, documentada como tal.
6. **O ts-fsrs mudou de API** (v6/FSRS-7). Fixar a versão e encapsular atrás de um port `Scheduler`.

---

## 8. Fontes

- Repositório local: `C:\Users\nicoolas\Pictures\learnharness\_refs\open-mastery` (HEAD `2b6c156`, 2026-07-21). Arquivos-chave:
  - `engine/crates/core/src/{types.rs, graph.rs, student.rs}`
  - `engine/crates/mcp-student/src/{server.rs, sse.rs, stdio.rs, main.rs}`
  - `engine/crates/mcp-teacher/src/{server.rs, git.rs, artifacts.rs}`
  - `docs/GRAPH_FORMAT.md`
  - `docs/BUILDER_BRIEF.md`
  - `tasks/010-encompassing-relationships.md`
  - `tasks/011-language-graphs.md`
  - `web/skilltree/index.html`
- Upstream: https://github.com/bxxd/open-mastery e https://github.com/bxxd/open-mastery/commits/main (consultados em 2026-11-18: 36 commits, último em 2026-07-21).
- FIRe / Math Academy: https://mathacademy.com/how-our-ai-works, https://frankhecker.com/2025/02/14/math-academy-part-7/ (resumo do cap. 26), https://justinmath.com/files/the-math-academy-way.pdf (rascunho de 2024).
- FSRS: https://github.com/open-spaced-repetition/ts-fsrs (MIT; v6 com suporte a FSRS-7, consultado em 2026-11-18).
- MCP: https://modelcontextprotocol.io/specification/latest/changelog (revisão 2026-07-28; HTTP+SSE depreciado desde 2025-03-26).
- CC BY-SA 4.0 ↔ GPLv3: https://creativecommons.org/share-your-work/licensing-considerations/compatible-licenses (compatibilidade unidirecional declarada pela CC).
- Contexto do learnharness: `src/core/graph.ts`, `src/core/ports.ts`, `src/agent/tools/graph.ts`, `package.json` (AGPL-3.0-only; `@modelcontextprotocol/sdk` 1.32.1; `typebox`).
