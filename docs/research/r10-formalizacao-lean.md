# r10 — Formalização da lógica de evolução do currículo-grafo (Lean 4 + provas + ponte TypeScript)

> Pesquisa feita em 2026-11-18. Objetivo: impedir que o grafo de currículo "evolua sem lógica" quando a IA o expande. O relatório define **o que formalizar**, mostra **o que já existe em Lean 4/Mathlib** e propõe **como ligar a especificação ao runtime TypeScript** do fork do learnharness.
>
> Convenções: "item", "nó" e "tópico" são sinônimos. `K` é o estado de conhecimento do aluno (conjunto de itens dominados). `Q` é o conjunto de itens de um domínio. Os trechos de código TS em §6.2 foram **executados e testados** nesta sessão (Node 24.12, 660.171 asserções aleatórias, zero falhas). Os trechos Lean são **esboços não compilados**, porque não há toolchain Lean nesta máquina. Os nomes de lemas Mathlib estão marcados para conferir com `#check`.
>
> **Revisão 2 (mesmo dia):** a §11 foi acrescentada. Ela generaliza o modelo para sistemas E/OU **sem rank** (definição por palavras de aprendizagem, plenitude, itens mortos; caracterização MPS ⇔ antimatroide pleno de [Berendsohn, arXiv 2507.13994](https://arxiv.org/abs/2507.13994)), acrescenta maestria multinível com projeção por cortes, os teoremas `Relaxes` e de extensão conservativa, cotas de horas E/OU mais fortes, um segundo núcleo TS com ids densos (testado contra força bruta, incluindo sistemas **com ciclos**), novos benchmarks (carga em lote × PK), o gerador fast-check e o mapa propriedade ↔ teorema Lean, e perguntas em aberto para o usuário. Também corrige versões (elan v4.4.0, Lean v4.37.0-rc1) e uma atribuição de venue não verificada.

---

## 0. TL;DR: decisões recomendadas

1. **Modelo matemático.** Cada domínio é um **sistema de cláusulas E/OU com rank**: cada item `q` tem uma lista de alternativas, e cada alternativa é um conjunto de pré-requisitos que, juntos, bastam. Existe uma ordem (certificado) em que toda cláusula de `q` só usa itens anteriores a `q`, e todo item tem ≥ 1 cláusula; uma raiz tem a cláusula vazia. **Teorema LS-rank (§3.3):** essas duas condições garantem que a família de estados viáveis é um **learning space** da Knowledge Space Theory, ou seja, um **antimatroide**: ∪-fechada, acessível, *learning smoothness* [L1] e *learning consistency* [L2]. A fronteira externa nunca fica vazia antes de `K = Q`. O caso só-E, com uma cláusula por item, é o DAG clássico: os estados são os *down-sets* (Birkhoff).
2. **Toda expansão feita pela IA é um *patch* tipado.** O patch é validado de forma determinística antes de ser gravado: schema zod, aciclicidade incremental Pearce–Kelly, certificado de rank, viabilidade do estado do aluno com reparo formal e orçamento de horas/nós. Os operadores (`addItem`, `addAlternative`, `addPrereq`, `refine`, `addSubdomain`, `retire`) têm **teoremas de preservação** (§4). O mais importante é o **refinamento-marco**: refinar `x` num subgrafo mantém o id de `x`, preserva aciclicidade com uma fórmula explícita de rank, **não cria nem destrói dependências** entre nós antigos e "levanta" o estado do aluno sem perda.
3. **O próximo passo não deve ser decidido pelo LLM.** Ele é calculado: a fronteira externa ∩ o plano da meta. O LLM só escolhe *dentro* da fronteira, por interesse e didática. Há evidência de 2026 para isso: LLMs acertam o conjunto exato de próximos passos só em **61,3%** dos casos sem a relação de pré-requisitos, contra **96,3%** com ela ([Steiner & Hochweber, arXiv 2611.13667](https://arxiv.org/abs/2611.13667)).
4. **Ponte Lean ↔ TS:** usar **verification-guided development** no estilo do Cedar/AWS ([arXiv 2407.01688](https://arxiv.org/abs/2407.01688)):
   - **(a)** um modelo executável legível em Lean (`formal/`) e teoremas sobre ele;
   - **(b)** **certificados em runtime**: ordem topológica/rank e testemunha de ciclo, conferidos por um checador TS minúsculo O(V+E);
   - **(c)** **property-based testing** com fast-check 4.10.2, espelhando cada teorema;
   - **(d)** **differential random testing** em CI: o executável Lean compilado (`lake build lh-check`) roda contra o TS nas mesmas instâncias aleatórias.
   Lean **não** entra no app Electron. Lean→WASM só existe em ferramentas comunitárias, não em produção.
5. **Escopo Lean pragmático** (§7.3). A fase P0 tem cerca de 10 teoremas pequenos e cabe em ~1–2 semanas de quem já sabe Lean básico:
   - `acyclic_of_ranking` e `checkTopo_sound`;
   - `feasible_union`, `accessible`, `fringe_nonempty`, `learning_consistency` e `plan_progress`;
   - `interior_feasible` e `interior_maximal`;
   - `implicitCredit_mono` e `bkt_postCorrect_ge`;
   - `remaining_anti`.

   **Não** formalizar o algoritmo Pearce–Kelly por dentro. Ele é um *certifying algorithm*: verifica-se a saída (o certificado), não o código.
6. **Lean no Windows:** instalar via elan (PowerShell), `lake new … math`, `lake exe cache get`. Os problemas conhecidos são antivírus, cache corrompido e servidor Lean rodando junto; WSL2 é a alternativa. A **CI oficial deve rodar Lean em `ubuntu-latest`** com `leanprover/lean-action@v1` (v1.7.1), usando `lake-package-directory: formal`, `leanchecker` e `axiom-audit`.
7. **Desempenho medido.** Num grafo com V = 10⁴ e E ≈ 5·10⁴, as inserções incrementais levam ~58 ms no total (~1,2 µs/aresta). Checar o certificado completo leva ~16 ms. O DFS ingênuo que reconstrói a adjacência a cada aresta, como `src/core/plan-tree.ts#createsCycle`, custa **~2 ms por aresta**: ~100 s para montar 5·10⁴ arestas uma a uma. Por isso o PK só vale para o grafo de currículo; o plan-tree por sessão pode ficar como está. **Ressalva da revisão 2 (§11.6):** o PK tem caso patológico quando se carrega um grafo inteiro inserindo arestas em ordem aleatória a partir de uma ordem inicial arbitrária (9,6 s com n = 20.000 num currículo profundo). A regra é **carregar em lote com Kahn** (8,4 ms) e usar PK só para edições incrementais (~2–3 µs por inserção).
8. **Revisão 2: modo estrito e modo relaxado (§11.1).** Validar sempre com dois certificados lineares: (i) ordem topológica do grafo de dependência e (ii) **palavra plena** (`checkWordCertificate`), que é a "ordem topológica E/OU". O modo estrito exige os dois e é o padrão. Um modo relaxado opcional exige só (ii) e aceita ciclos entre alternativas OU sem criar itens mortos. A definição de estado deve ser **por palavras** (`Reachable`), não por fecho: com rank as duas coincidem, sem rank só a definição por palavras é um antimatroide.

---

## 1. O problema: como um grafo "evolui sem lógica"

Falhas concretas que a formalização precisa tornar **impossíveis** ou **detectáveis**:

| # | Falha | Exemplo real | Consequência |
|---|---|---|---|
| F1 | Ciclo de pré-requisitos | LLM adiciona "Fasores → Impedância" e depois "Impedância → Fasores" | Nós ficam bloqueados para sempre. O `add_prerequisite` do open-mastery **grava o ciclo antes de validar** (ver `docs/research/ref-open-mastery.md`, bug 3) |
| F2 | Item inalcançável | Nó novo sem cláusula satisfazível, ou com pré-requisito apontando para um id inexistente | Promessa de currículo "até doutorado" com buracos |
| F3 | Estado do aluno inválido após expansão | O aluno domina `v` e a IA adiciona o pré-requisito `u → v` com `u` não dominado | A UI mostra `v` "dominado" com pré-requisito "bloqueado"; a fronteira fica incoerente |
| F4 | Travamento (fronteira vazia) | Os itens restantes dependem uns dos outros (ciclo de alternativas, "hanging states") | O aluno não tem o que estudar |
| F5 | Dependência espúria | Ao "detalhar" um nó, a IA religa sub-nós de forma que um nó antigo passa a depender de outro sem relação | O caminho real muda sem ninguém pedir |
| F6 | Inflação ou deflação de horas | Refinamentos sucessivos somam 3× as horas do nó original | Meta de ~1000–1500 h por domínio estoura |
| F7 | Expansão infinita | O gatilho de expansão dispara a cada sessão | Custo de tokens sem limite; o grafo nunca "termina" |
| F8 | Próximo passo errado | O LLM escolhe um tópico cujo pré-requisito o aluno não tem | Benchmark KST 2026: **61,3%** de acerto exato só com descrições, **96,3%** com a relação de pré-requisitos e **98,2%** com o espaço completo ([2611.13667](https://arxiv.org/abs/2611.13667)). LLMs também **violam dependências** em matemática ([Cui, Do, Sachan, arXiv 2609.05245](https://arxiv.org/abs/2609.05245); venue não confirmado) e "ainda têm dificuldade" em planejar trilhas personalizadas ([PersonaPath, 2609.18861](https://arxiv.org/abs/2609.18861)) |

A formalização **não** garante que uma aresta seja pedagogicamente verdadeira ("A é mesmo pré-requisito de B?"). Isso é empírico (§9). Ela garante **estrutura**: nada fica inalcançável, nada trava, nenhuma expansão corrompe o progresso, os limites são respeitados e o algoritmo de seleção sempre progride.

---

## 2. Fundamentos: grafos, ordens e Knowledge Space Theory (KST)

### 2.1 DAG de pré-requisitos, ordem topológica e fecho

- Grafo `G = (V, E)`, com `(u, v) ∈ E` significando que "u é pré-requisito direto de v".
- **Acíclico** ⇔ o fecho transitivo `E⁺` é irreflexivo. É a definição `Relation.Acyclic r := Std.Irrefl (TransGen r)` do CSLib, em `Cslib/Foundations/Relation/Defs.lean`.
- **Certificado de aciclicidade:** uma função de rank `r : V → ℕ` com `r u < r v` para toda aresta. Uma ordem topológica é o caso em que `r` é bijetivo em `0..n-1`. Os dois lados da equivalência:
  - *Soundness:* rank ⇒ acíclico. A prova é uma indução em `TransGen`, de 3 linhas.
  - *Completude, para grafo finito:* acíclico ⇒ existe ordem topológica. Pode-se usar `r(v)` = comprimento do maior caminho que termina em `v`, ou o DFS de CLRS.
  - O certificado é **verificável em O(V+E)**: confere-se que a ordem é uma permutação e que toda aresta aponta para frente. Esse é o princípio dos *certifying algorithms* (McConnell, Mehlhorn, Näher, Schweitzer, *Computer Science Review* 5(2), 2011): o algoritmo complexo devolve um certificado e um checador simples o confere.
- **Testemunha de não-aciclicidade:** um ciclo `[x, y, …, x]` com todas as arestas presentes, verificável em O(|ciclo|).
- **Ordem de pré-requisito:** `u ≤ v :⇔ ReflTransGen E u v`. É uma ordem parcial **se e só se** `G` é acíclico (antissimetria).
- **Fecho de pré-requisitos** de um conjunto `S`: `↓S = {u | ∃ v ∈ S, u ≤ v}`. Em Mathlib é `lowerClosure` (`Mathlib/Order/UpperLower/Closure.lean`), com `lowerClosure_mono`, `lowerClosure_union`, `lowerClosure_le` e a inserção de Galois `giLowerClosureCoe`. Propriedades: extensivo, monótono, idempotente e o **menor** down-set ⊇ `S`.

### 2.2 KST: as definições que importam

Fonte primária: Doignon & Falmagne, *Knowledge Spaces and Learning Spaces*, [arXiv 1511.06757](https://arxiv.org/abs/1511.06757) (capítulo do *New Handbook of Mathematical Psychology*), que resume o livro *Learning Spaces* (Falmagne & Doignon, Springer 2011).

- **Estrutura de conhecimento** `(Q, 𝒦)`: uma família de subconjuntos de `Q` com `∅, Q ∈ 𝒦`. Os elementos de 𝒦 são os **estados**.
- **Learning space** (Def. 3), as duas condições:
  - **[L1] Learning smoothness:** se `K ⊂ L` são estados, existe uma cadeia `K = K₀ ⊂ K₁ ⊂ … ⊂ K_p = L` de estados, um item de cada vez. *Dá para chegar a L aprendendo um item por vez.*
  - **[L2] Learning consistency:** se `K ⊂ L` e `K ∪ {q}` é estado, então `L ∪ {q}` é estado. *Saber mais não impede aprender algo novo.*
- **Teorema 7** (Cosyn & Uzun 2009 para (i)⇔(ii); Korte–Lovász–Schrader 1991): para `(Q, 𝒦)` são equivalentes:
  - (i) learning space;
  - (ii) **antimatroide**: finito, ∪-fechado e *downgradable/acessível*, isto é, todo estado não vazio tem um item cuja remoção dá um estado;
  - (iii) espaço de conhecimento (∪-fechado) **well-graded**.
- **Teorema 8:** learning space ⇔ (a) `Q` finito; (b) downgradable; (c) se `K ∪ {q}` e `K ∪ {r}` são estados, então `K ∪ {q, r}` é estado. É uma **checagem local**, útil para testes exaustivos em instâncias pequenas.
- **Teorema 10 (Birkhoff 1937):** os espaços *quasi ordinais* (fechados por ∪ e ∩) correspondem um a um às quase-ordens em `Q`. Os estados são exatamente os down-sets. **Este é o caso "só-E" (DAG).** Em Mathlib: `Mathlib/Order/Birkhoff.lean` (`OrderIso.lowerSetSupIrred`, `LatticeHom.birkhoffFinset`).
- **Sistemas de surmise (Def. 17, Teor. 18–19):** uma função `σ` associa a cada item `q` uma coleção de **cláusulas**. Dominar `q` exige ter dominado *alguma* cláusula. Toda função de atribuição define um espaço de conhecimento via `K ∈ 𝒦 ⇔ ∀ q ∈ K ∃ C ∈ σ(q): C ⊆ K`. Esse espaço é ∪-fechado, mas **não necessariamente** um learning space. **Este é o caso "E/OU"** (rotas alternativas).
- **Fronteiras (Def. 20):**
  - interna: `K^I = {q ∈ K | K∖{q} ∈ 𝒦}`;
  - externa: `K^O = {q ∉ K | K ∪ {q} ∈ 𝒦}`, os itens **prontos para aprender**.
  - **Teorema 21:** num learning space, o par (fronteira interna, fronteira externa) determina o estado.
  - Dado empírico do ALEKS: a probabilidade de o aluno aprender um item da fronteira externa é **≈ 0,93**, estimada em centenas de milhares de avaliações (p. 45 do capítulo).
- **Hanging states (Def. 39, Teor. 41, 43):** um estado não vazio com fronteira interna vazia é *hanging*. **Um espaço de conhecimento finito é learning space sse não tem hanging states.** O Teorema 43 diz quando remover estados (após responder a uma *query* `(A, q)`) preserva o learning space: não pode existir estado *quase hanging* `L` com `A ∩ L = L^I` e `q ∈ L`. É a base para **podar arestas com dados** (§9).
- **Projeção (Def. 31, Teor. 33; também Falmagne, [arXiv 0803.0575](https://arxiv.org/abs/0803.0575)):** a projeção `𝒦|Q' = {K ∩ Q' | K ∈ 𝒦}` de um learning space é um learning space. **Uso no app:** planejar por "regiões" (capítulos de livro cobrem regiões grandes) é estruturalmente sólido, porque a visão grossa continua sendo learning space.
- **Learning words/strings (Def. 23, Teor. 24/26):** sequências de itens cujos prefixos são todos estados. **Uma trilha de estudos válida é exatamente uma learning word.** Eppstein ([*Learning Sequences*, arXiv 0803.4030](https://arxiv.org/abs/0803.4030)) usa conjuntos de learning strings como estrutura de dados compacta: um estado vira um vetor de comprimentos de prefixo.
- **Escala real:** Beginning Algebra no ALEKS tem ~650 itens e milhões de estados. A avaliação adaptativa leva 25–35 perguntas. Nunca enumere estados: trabalhe com o **sistema gerador** (cláusulas) e com fronteiras.

Trabalho recente que transpõe a KST para recomendação com garantias formais: *Exploration Space Theory* ([Sadallah 2026, arXiv 2603.06624](https://arxiv.org/abs/2603.06624)). Ele prova que os estados (ideais de uma ordem de surmise) formam um reticulado distributivo e um learning space, e deriva "fringe em tempo linear" e um "certificado de validade" para cada recomendação. É o mesmo desenho deste relatório, aplicado a outro domínio.

---

## 3. O modelo do app: sistema de cláusulas com rank

### 3.1 Definição

Para cada domínio, independente (meta 3: sessões e memórias isoladas por domínio):

```
items : Finset V                         -- Q
cl    : V → List (Finset V)              -- alternativas (OU) de conjuntos de pré-requisitos (E)
                                         -- raiz:  cl q = [∅]
Feasible K :⇔ K ⊆ items ∧ ∀ q ∈ K, ∃ C ∈ cl q, C ⊆ K
Ranked r   :⇔ (∀ q ∈ items, cl q ≠ [])                         -- (R1) todo item tem rota
             ∧ (∀ q ∈ items, ∀ C ∈ cl q, ∀ p ∈ C, r p < r q)    -- (R2) cláusulas apontam "para trás"
             ∧ (∀ q ∈ items, ∀ C ∈ cl q, C ⊆ items)            -- (R3) sem referências soltas
```

(R2) diz exatamente que o **grafo-união** (aresta `p → q` para todo `p` em alguma cláusula de `q`) tem a ordem `r` como certificado topológico. O mesmo validador incremental de DAG serve aos dois casos.

**Por que E/OU e não só um DAG?** Num currículo de eletrônica até doutorado existem rotas alternativas legítimas, por exemplo "Transformada de Laplace via cálculo" **ou** "via sinais e sistemas". No caso só-E basta `cl q = [prereqs q]`, e tudo vira DAG/Birkhoff. O modelo E/OU é estritamente mais expressivo e continua sendo learning space sob (R1–R3).

### 3.2 Exemplo de quebra sem (R2)

`cl a = [{b}]`, `cl b = [{a}]`. O estado `{a, b}` é viável, porque cada um tem a cláusula satisfeita pelo outro. Mas `{a}` e `{b}` não são: `{a, b}` é um **hanging state**. A família não é learning space (Teor. 41), e um aluno em `∅` nunca chega a `a` nem a `b` (F4). (R2) proíbe isso.

### 3.3 Teorema LS-rank (enunciado e prova)

**Teorema.** Se `Ranked r` vale, a família `𝒦 = {K | Feasible K}` é um learning space (antimatroide) com `∅, Q ∈ 𝒦`. Em particular:

- **(a)** `∅ ∈ 𝒦` e `Q ∈ 𝒦`.
- **(b) União:** `K, L ∈ 𝒦 ⇒ K ∪ L ∈ 𝒦`.
- **(c) Acessibilidade:** `K ∈ 𝒦, K ≠ ∅ ⇒ ∃ q ∈ K, K∖{q} ∈ 𝒦`.
- **(d) Fronteira não vazia:** `K ∈ 𝒦, K ⊊ Q ⇒ ∃ q ∈ Q∖K, K ∪ {q} ∈ 𝒦`.
- **(e) Caracterização da fronteira:** para `K ∈ 𝒦` e `q ∉ K`, temos `K ∪ {q} ∈ 𝒦 ⇔ ∃ C ∈ cl q, C ⊆ K`.
- **(f) [L2]:** `K ⊆ L ∈ 𝒦, K ∪ {q} ∈ 𝒦 ⇒ L ∪ {q} ∈ 𝒦`.
- **(g) Progresso dirigido a meta:** `K, P ∈ 𝒦, P ⊄ K ⇒ ∃ q ∈ P∖K, K ∪ {q} ∈ 𝒦`.
- **(h) [L1]:** segue de (g) com `P = L`, por indução em `|L∖K|`.

*Provas.*

- **(a)** `∅` satisfaz vacuamente. Para `Q`, cada `q` tem uma cláusula por (R1), contida em `items` por (R3).
- **(b)** Se `q ∈ K`, a cláusula que vale em `K` vale em `K ∪ L`. O caso `q ∈ L` é simétrico.
- **(c)** Seja `q*` o item de rank máximo em `K`. Para `x ∈ K∖{q*}`, a cláusula `C ⊆ K` de `x` não contém `q*`, porque os itens de `C` têm rank `< r x ≤ r q*`. Logo `C ⊆ K∖{q*}`.
- **(d)** É o caso `P = Q` de (g).
- **(e)** (⇐) A cláusula de `q` já está em `K`, e as cláusulas dos outros itens continuam valendo. (⇒) Alguma cláusula de `q` está em `K ∪ {q}` e, por (R2), não contém `q`.
- **(f)** A cláusula de `q` está em `K ∪ {q}`, logo em `K` por (R2), logo em `L`.
- **(g)** Seja `q` de rank mínimo em `P∖K`. Como `P` é viável, `q` tem uma cláusula `C ⊆ P`. Cada `p ∈ C` tem `r p < r q`. Se `p ∉ K`, então `p ∈ P∖K` com rank menor, o que contradiz a minimalidade. Logo `C ⊆ K`, e `K ∪ {q} ∈ 𝒦` por (e). ∎

(R2) é **suficiente, não necessário**: existem antimatroides cujas cláusulas mínimas não admitem rank global. Para o app, a condição suficiente basta e tem certificado barato. **Revisão 2:** §11.1 mostra o caso geral sem rank (definição por palavras, Berendsohn 2025) e por que o algoritmo de interior de §3.4 deve ser trocado por encadeamento para frente restrito quando não houver rank. A verificação empírica deste teorema, com `n ≤ 9` e enumeração de todos os 2ⁿ subconjuntos em 300 sistemas aleatórios, está em §6.2 (passou).

### 3.4 Reparo do estado: interior e fecho

Quando uma expansão ou reavaliação torna `K` inviável, há duas reparações canônicas:

- **Interior (conservador): o maior estado viável contido em `X`.** Existe porque 𝒦 é ∪-fechado e finito: é a união de todos os estados `⊆ X`. Algoritmo: remover repetidamente itens sem cláusula satisfeita. *Prova de maximalidade:* se `F ⊆ X` é viável, nenhum item de `F` é removido. Por indução, `F ⊆ K` vale em toda iteração, e a cláusula de `q ∈ F` está em `F ⊆ K`. Termina em `≤ |X|` rodadas.
- **Fecho (otimista, só no caso só-E): o menor down-set contendo `K`** (`lowerClosure`). No caso E/OU **não existe** um menor estado único (há várias rotas). Escolhe-se um plano barato (§3.6).

**Política recomendada:**
- Em expansões (`addPrereq`, `refine`), use **inferência otimista** marcada (`inferred: true`). Pelo princípio de *surmise* da KST, quem domina `v` provavelmente domina os pré-requisitos de `v`. Agende uma **sonda rápida** de verificação.
- Em **avaliação explícita que falhou**, use o **interior**.

### 3.5 Maestria: separar "atingido" de "retenção"

Para que os teoremas de progresso valham, o estado `K` usado para **desbloqueio** precisa ser **monótono** (*attained*: "aprendeu ao menos uma vez com evidência"). A **retenção** (FSRS/Anki, meta 4) fica numa camada separada, que só agenda revisão. Falhar numa revisão **não** rebloqueia. Só uma decisão explícita de "re-ensinar" aplica `interior`.

**Propagação de crédito implícito** (FIRe do Math Academy / `encompasses` do open-mastery):

```
m*(u) = max( raw(u), α · max{ m*(v) | u é pré-requisito de v } ),  α ∈ [0,1]
```

**Especificação:** `m*` é o **menor** vetor que (i) domina `raw` e (ii) satisfaz `α·m(v) ≤ m(u)` em toda aresta. Pelo teorema de Knaster–Tarski é o `lfp` de um operador monótono: `OrderHom.lfp` em `Mathlib/Order/FixedPoints.lean`, com `map_lfp`, `lfp_le` e `isLeast_lfp_le`. Num DAG é calculado **numa passada em ordem topológica reversa**. Consequências:

- **Monotonia na evidência** (`raw ≤ raw' ⇒ m* ≤ m'*`): sai direto da minimalidade, numa prova de uma linha (§7.4).
- **Antitonia ao longo das arestas** quando `α = 1`: o pré-requisito sempre tem maestria ≥ a do dependente.
- **Idempotência.**
- No caso E/OU, só há crédito implícito garantido para itens com **uma única** cláusula. Se há alternativas, saber `v` não diz *qual* rota foi usada.

**BKT não degenerado.** Num modelo BKT com chute `G` e deslize `S`:

```
P(L | correto) = P(L)(1−S) / (P(L)(1−S) + (1−P(L))G)
```

Isso é **≥ P(L) se e só se G ≤ 1 − S** (para `0 < P(L) < 1`). Prova: `P(L)·D ≤ P(L)(1−S)` ⇔ `(1−P(L))·G ≤ (1−P(L))(1−S)`. Simetricamente, a resposta errada nunca aumenta `P(L)`. A transição de aprendizado `P' = P + (1−P)T` também é monótona. **Invariante de runtime:** ao ajustar os parâmetros, impor `G + S ≤ 1`, que é a noção de "degenerescência teórica" de Baker, Corbett & Aleven (ITS 2008, LNCS 5091, pp. 406–415, [DOI 10.1007/978-3-540-69132-7_44](https://link.springer.com/doi/10.1007/978-3-540-69132-7_44)). O limiar exato que eles usam não foi reverificado aqui; a condição algébrica acima é a que importa e foi derivada neste relatório.

### 3.6 Cotas de horas

Cada item tem uma estimativa `hours = {lo, hi}`, gerada pela IA e calibrada depois pelo tempo real observado.

- **Itens obrigatórios para a meta `t`** (presentes em *todo* estado viável que contém `t`):

  ```
  mand(t) = {t} ∪ ⋂_{C ∈ cl t} ⋃_{c ∈ C} mand(c)        (raiz: mand(r) = {r})
  ```

  *Soundness* por indução forte no rank: se `t ∈ K` viável, alguma `C ⊆ K`. Por hipótese de indução, `mand(c) ⊆ K` para cada `c ∈ C`, logo a interseção sobre as cláusulas está em `K`.
- **Cota inferior sólida:** `LB(K, t) = Σ_{v ∈ mand(t)∖K} lo(v)`. Ela é **antítona em K**: `K ⊆ K' ⇒ LB(K') ≤ LB(K)` (`Finset.sum_le_sum_of_subset`).
- **Cota superior:** é o custo `Σ hi` de um **plano concreto**: para cada item necessário, escolher a cláusula de menor custo estimado e unir. Todo plano viável dá uma cota superior válida.
- **O plano ótimo é NP-difícil no caso E/OU com compartilhamento.** Redução de *Set Cover*: cada conjunto `S_i` vira uma raiz de custo 1; cada elemento `e_j` tem as cláusulas `{{S_i} | e_j ∈ S_i}` e custo 0; a meta `t` tem a cláusula única `{e_1, …, e_m}`. O estado viável mais barato que contém `t` é a cobertura mínima. **Conclusão:** reportar o intervalo `[LB, UB]`, usar heurística gulosa e restringir alternativas a poucas por item.
- **Invariantes de orçamento do domínio:**
  - `H_min ≤ Σ_{v ∈ Q, obrigatório} mid(v) ≤ H_max`, com 1000–1500 h para "1 ano a 2–4 h/dia";
  - folhas com `hi ≤ 4 h`; acima disso, dispara `refine`;
  - **conservação sob refinamento:** `|Σ_{w ∈ W} mid(w) − mid(x)| ≤ ε·mid(x)` (ex.: ε = 0,25); acima disso, reestimar e sinalizar.

### 3.7 Política de seleção: terminação e progresso

- **Passo:** `K → K ∪ {q}` com `q ∈ K^O`, ou seja, o aluno domina um item da fronteira.
- **Sem expansão:** cada passo aumenta `|K|` em 1, então o processo termina em **exatamente `|Q∖K|` sucessos**. A função de variante é `|Q| − |K|`. Pelo LS-rank (d), nunca falta candidato antes do fim.
- **Dirigido à meta:** fixe um plano `P` viável com `t ∈ P`, por exemplo o UB de §3.6. Pelo LS-rank (g), `K^O ∩ P ≠ ∅` enquanto `P ⊄ K`. Uma política que só escolhe dentro de `K^O ∩ P` alcança `t` em `|P∖K|` sucessos. O LLM escolhe **qual** item dentro desse conjunto, por interesse ou didática, sem poder travar o progresso.
- **Com expansões:** cada expansão consome uma unidade de orçamento `B` (nós por domínio, expansões por sessão/dia). A medida lexicográfica `(B, |Q∖K|)` decresce a cada evento: expansão reduz `B`, domínio reduz `|Q∖K|`. Logo **o processo termina** (expansão + estudo), mesmo que a expansão aumente `|Q∖K|`.
- **Versão probabilística:** se cada tentativa num item da fronteira tem sucesso com probabilidade `≥ p > 0`, independente, o número esperado de tentativas é `≤ |Q∖K| / p`. É uma soma de geométricas e não precisa de Lean. A "justiça" (todo item do plano é eventualmente tentado) é garantida porque a política escolhe **dentro de `K^O ∩ P`**, que fica não vazio e diminui.

---

## 4. Operadores de evolução (expansão procedural) e teoremas de preservação

Toda mudança no grafo é um **evento** no ledger append-only do domínio. É o padrão de `src/store/graph.ts` e `src/core/contracts/graph.ts` do learnharness, com JSONL e estado derivado. Os eventos aplicáveis são:

| Operador | Efeito | Aciclicidade / rank | Estados de aluno existentes | Teorema |
|---|---|---|---|---|
| `addItem(q, clauses)` | Novo item com cláusulas sobre itens existentes (ou `[∅]`) | Preservado: `r q := max r + 1` (anexar ao fim da ordem) | **Preservados** (`q ∉ K`; cláusulas antigas intactas) | `addItem_preserves` |
| `addAlternative(q, C)` | Nova rota OU para `q` (relaxa) | Exige `∀ p ∈ C, r p < r q` ou reordenação (PK) | **Preservados**: família monótona (mais estados) | `addAlternative_preserves` |
| `addPrereq(q, i, p)` | Adiciona `p` à cláusula `i` de `q` (fortalece) | É a aresta `p → q` no grafo-união; o PK decide | **Podem quebrar**; reparo: inferir `p` ("surmise", com sonda) ou `interior` | `interior_feasible`, `interior_maximal` |
| `refine(x, H)` | Detalha `x` num subgrafo `H` (itens `W`), mantendo `x` como **marco** | Fórmula de rank explícita (abaixo) | **Levantados**: `x ∈ K ⇒ K ∪ W`; senão `K` | `refine_ranked`, `refine_lift`, `refine_project`, `refine_reach_iff` |
| `addSubdomain(D, bridges)` | Novo componente (itens de `D`) + cláusulas-ponte | Ranks de `D` deslocados acima do máximo atual | Preservados | `union_ranked` |
| `retire(q, reroute)` | Desativa `q` (tombstone); dependentes ganham rota alternativa | Remover arestas nunca cria ciclo | Se `q ∈ K`, mantém histórico; dependentes ficam viáveis se `reroute` cobre | checado em runtime + `interior` |
| `setHours(q, h)` | Reestimativa | — | — | invariantes de orçamento (runtime) |

### 4.1 Refinamento-marco (o operador central)

**Definição.** Seja `x` um item e `H` um sistema de cláusulas novo sobre itens `W` (disjuntos de `Q`), com ranks internos `rH : W → [0, N]`. No novo sistema `S'`:

- cada **fonte** `s ∈ W` (sem cláusula interna) recebe as cláusulas **antigas** de `x`: `cl' s = cl x`;
- os demais `w ∈ W` mantêm as cláusulas internas de `H` (contidas em `W`);
- `x` passa a ter a cláusula única `cl' x = [W]`: o marco exige tudo;
- os outros itens antigos **não mudam**, inclusive os que têm `x` como pré-requisito.

**Fórmula de rank (certificado).** Para itens antigos `v`, `r'(v) = (N+2)·r(v) + N + 1`; para `w ∈ W`, `r'(w) = (N+2)·r(x) + rH(w)`. Conferência das arestas do grafo-união:

- antigo `u → v` (`r u < r v`): `(N+2)r u + N+1 < (N+2)r v + N+1` ✓;
- `p → s`, com `p` numa cláusula antiga de `x`, logo `r p ≤ r x − 1`: `(N+2)r p + N+1 ≤ (N+2)r x − 1 < (N+2)r x + rH s` ✓;
- interno `w → w'` (`rH w < rH w'`) ✓;
- `w → x`: `(N+2)r x + rH w ≤ (N+2)r x + N < (N+2)r x + N + 1 = r'(x)` ✓.

No TS isso é ainda mais simples: **inserir o bloco `W`, na ordem topológica de `H`, imediatamente antes de `x`** na ordem global.

**Teoremas** (as provas são curtas):

- `refine_lift` (preservação de progresso): `K ∈ 𝒦 ⇒ lift K ∈ 𝒦'`, com `lift K = K ∪ W` se `x ∈ K`, senão `K`. Se `x ∈ K`, alguma cláusula antiga `C ⊆ K` satisfaz as fontes; o resto de `W` é interno; e `x` tem `W ⊆ lift K`.
- `refine_project` (**fidelidade**, eco do Teorema 33 de projeção): `K' ∈ 𝒦' ⇒ K' ∩ Q ∈ 𝒦`. Se `x ∈ K'`, então `W ⊆ K'`; uma fonte `s ∈ W` tem uma cláusula antiga de `x` contida em `K' ∩ Q`.
- `refine_reach_iff` (**sem dependências espúrias**, caso só-E): para `a, b ∈ Q∖{x}`, `a →⁺ b` em `G'` ⇔ `a →⁺ b` em `G`. Todo caminho de `G'` que entra em `W` entra por uma fonte (vindo de um pré-requisito de `x`) e sai por `x`, então pode ser trocado por `pré-req(x) → x`.

Por isso o refinamento é o operador certo para "nós novos surgem quando necessário". O id `x` continua estável: links de livros e vídeos, histórico e flashcards seguem válidos. A visão grossa (projeção em `Q`) é **exatamente** o grafo anterior.

### 4.2 Gatilhos de expansão (quando chamar a IA)

São funções **determinísticas** do estado, todas com orçamento (medida de §3.7):

1. **Lookahead raso:** `|K^O ∩ P|` com conteúdo pronto `< k` (ex.: `k = 3`) ⇒ pedir `addItem`/`refine` na região da meta.
2. **Granularidade:** uma folha com `hi > 4 h`, ou com taxa de falha alta mesmo com os pré-requisitos dominados, ⇒ `refine`.
3. **Diagnóstico de lacuna:** falhas repetidas em `v` com todas as cláusulas dominadas ⇒ hipótese de pré-requisito faltante ⇒ `addItem(remedial)` + `addAlternative`/`addPrereq`.
4. **Pedido do aluno:** "quero RF/micro-ondas" ⇒ `addSubdomain` com pontes.

---

## 5. O que já existe em Lean 4 / Mathlib (estado em 2026-11-18)

### 5.1 Versões atuais

- **Lean `v4.36.0`**, publicado em 2026-11-16 ([releases](https://github.com/leanprover/lean4/releases)). O rc anterior, `v4.36.0-rc2`, é de 2026-10-27. **`v4.37.0-rc1` saiu hoje (2026-11-18)**; para `formal/`, fixe a estável `v4.36.0`.
- **Mathlib:** a `master` está em `leanprover/lean4:v4.36.0` e existe a tag `v4.36.0` ([mathlib4](https://github.com/leanprover-community/mathlib4)).
- **elan `v4.4.0`**, publicado em 2026-11-18 (a primeira versão deste relatório citava `v4.3.0`, já superada). O README do elan diz que ele também instala os proxies **`lean-beam`** e **`lean-beam-mcp`** (ver §11.8).
- **Sistema de módulos novo** (`module`, `public import`, `@[expose] public section`): já é usado por Mathlib, CSLib e linglib. É opcional para arquivos novos; o `import` clássico continua funcionando.

### 5.2 Mathlib: o que serve e o que falta

| Necessidade | Mathlib tem? | Onde / observação |
|---|---|---|
| Digrafo | Sim, mínimo | `Mathlib/Combinatorics/Digraph/Basic.lean` (`structure Digraph (V) where Adj : V → V → Prop`, reticulado booleano de digrafos) e `Orientation.lean`. **Não tem** aciclicidade nem ordem topológica |
| Grafo não dirigido acíclico | Sim | `Mathlib/Combinatorics/SimpleGraph/Acyclic.lean` (árvores; **não** serve para DAG) |
| Caminhos | Sim | `Mathlib/Combinatorics/Quiver/Path.lean`; `Relation.TransGen` (core) e `Relation.ReflTransGen` (`Mathlib/Logic/Relation.lean`) |
| Fecho de pré-requisitos | **Sim** | `lowerClosure`, `lowerClosure_mono`, `lowerClosure_union`, `giLowerClosureCoe` (`Mathlib/Order/UpperLower/Closure.lean`); `IsLowerSet`/`LowerSet` (`Mathlib/Order/Defs/Unbundled.lean`) |
| Estados = down-sets (caso só-E) | **Sim** | Birkhoff: `Mathlib/Order/Birkhoff.lean` (`OrderIso.lowerSetSupIrred`, `LatticeHom.birkhoffFinset`) |
| Extensão linear (Szpilrajn) | Sim | `Mathlib/Order/Extension/Linear.lean` (`extend_partialOrder`, `LinearExtension`, `toLinearExtension`): existência de ordem topológica para ordens parciais |
| Ponto fixo (propagação) | **Sim** | `OrderHom.lfp`, `map_lfp`, `lfp_le`, `isLeast_lfp_le` (`Mathlib/Order/FixedPoints.lean`) |
| Matroides | Sim | `Mathlib/Combinatorics/Matroid/*` |
| **Antimatroide / greedoide / learning space** | **Não** | Confirmado pelo comentário `[UPSTREAM]: mathlib has Matroid but no Antimatroid/Greedoid` em linglib |
| Somas finitas (horas) | Sim | `Finset.sum_le_sum_of_subset`, `Finset.sdiff_subset_sdiff` |

### 5.3 Projetos Lean 4 relevantes (verificados no GitHub)

- **CSLib** ([leanprover/cslib](https://github.com/leanprover/cslib), Apache-2.0, toolchain v4.36.0): a biblioteca de CS do ecossistema Lean. Define `Relation.Acyclic r := Std.Irrefl (TransGen r)` em `Cslib/Foundations/Relation/Defs.lean`. Para depender dele, use `[[require]] name = "cslib", scope = "leanprover"`.
- **cslib-frontier** ([cslib-community/cslib-frontier](https://github.com/cslib-community/cslib-frontier), Apache-2.0). O arquivo `CslibFrontier/Algorithms/Lean/DFS/TopologicalSort.lean` (Samuel Schlesinger, 2026) tem uma **ordenação topológica verificada** por DFS (CLRS 22.4):
  - `IsTopologicalOrder` (lista sem repetição, todos os vértices, `[u, v] <+ l` para cada aresta);
  - `IsTopologicalOrder.acyclic`;
  - `isTopologicalOrder_topologicalSort_iff` (o resultado é ordem topológica **sse** o grafo é acíclico);
  - `acyclic_iff_exists_isTopologicalOrder`;
  - `time_topologicalSortM` (custo exatamente `|vs| + Σ|adj v|`, numa mônada de tempo).

  O diretório também tem `SCC.lean`. **É o melhor ponto de partida** para o teorema de completude (`exists_ranking_of_acyclic`): pode ser importado ou copiado com atribuição, já que Apache-2.0 é compatível com AGPL-3.0.
- **ATLAS / atlas-lean** ([facebookresearch/atlas-lean](https://github.com/facebookresearch/atlas-lean)). O arquivo `CSLibExt/Algorithms/Lean/Graph/TopologicalSort.lean` tem um **Kahn determinístico certificante**: em caso de sucesso devolve a ordem completa; em caso de falha, "devolve os vértices restantes e produz um ciclo simples contido". É exatamente o padrão de certificados deste relatório. **Licença:** Apache-2.0, mas o repositório acrescenta "*not intended for use to train, fine-tune, distill, evaluate, or otherwise develop ML models*". Leia como referência e **não copie**.
- **linglib** ([linglib-community/linglib](https://github.com/linglib-community/linglib), Apache-2.0). `Linglib/Core/Combinatorics/Antimatroid.lean` define `SetSystem`, `AccessibleSetSystem` (aumento + remoção), `Antimatroid` (+ `union_closed`), `Antimatroid.free`, `trace` (= projeção KST!) e `RootedCircuit`, no estilo do `Matroid` da Mathlib. **É a única formalização de antimatroide em Lean 4 encontrada.** Serve para ligar nosso Teorema LS-rank à noção padrão.
- **Algoritmos de grafo verificados em outros provadores** (referência de método):
  - Tarjan SCC em Why3/Coq/Isabelle ([Chen, Cohen, Lévy, Merz, Théry, arXiv 1810.11979](https://arxiv.org/abs/1810.11979));
  - **detecção incremental de ciclos de Bender–Fineman–Gilbert–Tarjan verificada em Coq**, com **complexidade amortizada** via Separation Logic com time credits (Guéneau, Jourdan, Charguéraud, Pottier, ITP 2019, [DOI 10.4230/LIPIcs.ITP.2019.18](https://doi.org/10.4230/LIPIcs.ITP.2019.18)). Mostra que verificar o algoritmo incremental é um projeto de pesquisa. Para nós, **checar o certificado** é o caminho pragmático.

### 5.4 Confiança: o que conta como "provado"

Da referência oficial ([Validating Proofs](https://lean-lang.org/doc/reference/latest/ValidatingProofs/)), em ordem crescente de rigor:

1. **IDE/`lake build`:** o kernel aceitou, mas isso **não** revela `sorry` em dependências.
2. **`#print axioms thm`:** só `propext`, `Classical.choice` e `Quot.sound` são aceitáveis. `sorryAx` indica prova incompleta; nomes com `_native` indicam avaliação nativa.
3. **`lean4checker`/`leanchecker`:** replay das `.olean` no kernel; recomendado em CI.
4. **`lake comparator`** com checadores externos (ex.: **nanoda**): o padrão-ouro contra provas maliciosas. O antigo repositório [leanprover/comparator](https://github.com/leanprover/comparator) (Apache-2.0) foi **descontinuado**: virou `lake comparator` e `lake check` no core a partir da **v4.35.0**. Ele depende de [`landrun`](https://github.com/Zouuup/landrun) (sandbox Landlock, **só Linux**) e de `lean4export`, portanto só roda na CI Ubuntu, não no Windows.

Sobre `decide`:
- **`decide +kernel`:** redução no kernel, ignora transparência, avalia a instância uma vez. Serve para **instâncias pequenas**.
- **`decide +native`** (antigo `native_decide`): amplia a base confiável ao compilador. **Desde a v4.29.0 cada uso gera um axioma dedicado**, e `Lean.trustCompiler` **foi removido na v4.35.0**.

A referência recomenda tratar provas geradas por IA não revisadas como potencialmente maliciosas. Para nós, isso significa **escrever os enunciados à mão** e deixar a IA apenas preencher provas, sempre com `axiom-audit` na CI.

**Certificado → teorema em escala:** Szeider (2026) importa certificados de solvers para teoremas Lean por *reflection*, com checador Booleano provado correto e executado como código nativo: [PBLean, arXiv 2602.08692](https://arxiv.org/abs/2602.08692) e [lrat-catcher, arXiv 2607.00815](https://arxiv.org/abs/2607.00815) (174 TB de certificados LRAT em streaming). É o mesmo padrão do nosso `checkTopo_sound`, mas para nós basta o **veredito** do checador compilado. Não precisamos de um "teorema por snapshot".

### 5.5 Lean no Windows

Passos oficiais ([lean-lang.org/install/manual](https://lean-lang.org/install/manual/)):

```powershell
git --version; curl --version           # pré-requisitos
curl -O --location https://elan.lean-lang.org/elan-init.ps1
powershell -ExecutionPolicy Bypass -f elan-init.ps1    # opção 1 (padrão)
del elan-init.ps1
# reabrir o terminal; instalar a extensão "lean4" (publisher leanprover) no VS Code
lake +leanprover-community/mathlib4:lean-toolchain new formal math   # projeto com Mathlib
cd formal; lake exe cache get; lake build
```

Atenção: a página oficial tem dois erros de copy-paste. O passo de build manda dar `cd` para o diretório errado, e o arquivo de teste aparece como `est.lean`.

Problemas conhecidos no Windows (Zulip, [1](https://leanprover-community.github.io/archive/stream/287929-mathlib4/topic/lake.20exe.20cache.20get.20errors.html), [2](https://leanprover-community.github.io/archive/stream/113489-new-members/topic/installing.20mathlib.20problem.html), [3](https://leanprover-community.github.io/archive/stream/270676-lean4/topic/installation.20issues.20on.20windows.html)):

- **Antivírus de terceiros e o Windows Defender** podem bloquear o elan ou o cache. Já houve casos em que o cache "baixou" e mesmo assim tudo foi recompilado.
- **Cache corrompido.** Os `.ltar` ficam em `%USERPROFILE%\.cache\mathlib\`. Se baixarem corrompidos, rode `lake clean` e depois `lake exe cache get`, ou apague `.lake`.
- **Não rode `lake exe cache get` com o servidor Lean do VS Code compilando no mesmo diretório.**
- O `cache get` pode tentar baixar outro toolchain e falhar. A versão em `lean-toolchain` tem de bater com a da Mathlib.
- **Alternativa robusta:** WSL2 Ubuntu.
- **Espaço em disco:** o cache da Mathlib ocupa vários GB. Não medi o valor exato.

**CI:** use [`leanprover/lean-action@v1`](https://github.com/leanprover/lean-action), v1.7.1 de 2026-11-06, testado em `ubuntu-latest`, `macos-latest` e `windows-latest`. Entradas úteis:
- `lake-package-directory: formal`;
- `leanchecker: true` (exige `LEAN_NUM_THREADS` se houver Mathlib);
- `axiom-audit: true` com allowlist `propext,Classical.choice,Quot.sound`, que **pega `sorry` e `native_decide`**;
- `nanoda: true` para um checador independente.

O próprio lean-action roda `lake exe cache get` com `MATHLIB_CACHE_GET_URL=https://cache.mathlib.org/mathlib4`.

**Lean dentro do app?** Não. Lean→WASM só existe em ferramentas comunitárias: `lasm` (AOT para WASM, sem threads, sem sockets e sem processos no browser), [xeus-lean](https://github.com/Verilean/xeus-lean) (kernel Jupyter, runtime inteiro em WASM) e o experimental `lean2wasm`. Não há suporte oficial ([setup docs](https://docs.lean-lang.org/lean4/doc/setup.html)). Estado conferido na revisão 2: [ranvier-labs/lean-wasm-examples](https://github.com/ranvier-labs/lean-wasm-examples) usa um `lean --wasm=` experimental de um branch não lançado (`feat/wasm-backend`); [kshitijl/lean-wasm](https://github.com/kshitijl/lean-wasm) roda Lean inteiro no browser com download de ~40 MB (brotli) e limites de pilha; [cronch-ai/lean-wasm](https://github.com/cronch-ai/lean-wasm) empacota só o **kernel nanoda** (checagem, não elaboração). Nenhum serve para rodar o validador no app. O runtime do app fica em TS. Lean roda em CI e, opcionalmente, como binário de dev.

---

## 6. Ponte com o runtime TypeScript

### 6.1 Opções comparadas

| Opção | O que dá | Custo | Veredito |
|---|---|---|---|
| **A. Spec Lean + PBT espelhando teoremas** | Os teoremas guiam *quais* propriedades testar no TS | Baixo | **Sim**, base de tudo |
| **B. DRT: executável Lean (modelo) × TS (produção)** em CI | Evidência de que o TS implementa o modelo provado. O Cedar achou **21 bugs** com DRT/PBT e **4** fazendo provas. Modelo Lean 1.673 LOC, provas 5.714 LOC (razão ≈ 3,4:1). Mediana do autorizador Lean: 6 µs, contra 10 µs em Rust. Checar provas e compilar leva ~3 min ([2407.01688](https://arxiv.org/abs/2407.01688), [cedar-spec](https://github.com/cedar-policy/cedar-spec)) | Médio: precisa de toolchain Lean na CI | **Sim**, em CI (Linux) |
| **C. Certificados em runtime** (ordem/rank, ciclo, reparo) + checador TS minúsculo | Toda mutação do grafo é conferida por código independente e trivial | Muito baixo: O(V+E), ~16 ms a 10⁴/5·10⁴ | **Sim**, sempre |
| **D. Exportar instâncias → Lean e provar por `decide`** | Teorema por snapshot | `decide +kernel` não escala; `+native` amplia a base confiável | **Só** para snapshots-semente pequenos ou exemplos de regressão |
| **E. Dafny → JavaScript** (código verificado roda no app) | Código verificado em produção | Toolchain .NET; JS gerado pouco idiomático; interop manual (Dafny v4.11.0, 2025-08-25) | Não, por ora |
| **F. Lean → WASM no app** | Mesmo código do modelo em runtime | Imaturo (só comunitário) | Não |

### 6.2 Núcleo TS: validador incremental (Pearce–Kelly) e checadores (testado)

O algoritmo é de Pearce & Kelly, *A dynamic topological sort algorithm for directed acyclic graphs* (ACM JEA 11, 2006/2007, [DOI 10.1145/1187436.1210590](https://whileydave.com/publications/pk07_jea/); código C++ BSD-3 em [DavePearce/DynamicTopologicalSort](https://github.com/DavePearce/DynamicTopologicalSort)). A ideia é guardar o grafo **como** uma ordem topológica. Ao inserir `u → v` com `ord(u) > ord(v)`:

1. busca para frente a partir de `v`, limitada a `ord ≤ ord(u)` (se achar `u`, há ciclo);
2. busca para trás a partir de `u`, limitada a `ord > ord(v)`;
3. reatribui os mesmos *slots* com os ancestrais antes dos descendentes.

O custo é proporcional à **região afetada**. Ao remover uma aresta, não é preciso reordenar. Variante tolerante a ciclos: [Smith, arXiv 2306.05475](https://arxiv.org/abs/2306.05475).

Panorama teórico, que **não é necessário** na nossa escala:
- Bender–Fineman–Gilbert–Tarjan: `O(min(m^{3/2}, m·n^{2/3}))` total ([1112.0784](https://arxiv.org/abs/1112.0784));
- Bhattacharya–Kulkarni: `Õ(m^{4/3})` randomizado ([1810.03491](https://arxiv.org/abs/1810.03491));
- **tempo quase linear** `m^{1+o(1)}` (Chen, Kyng, Liu, Meierhans, Probst Gutenberg, [2311.18295](https://arxiv.org/abs/2311.18295));
- **com predições** (McCauley et al., ICML 2024, [2402.11028](https://arxiv.org/abs/2402.11028)): a ordem sugerida pelo LLM, por nível ou dificuldade, poderia servir de "predição".

O código abaixo é o arquivo proposto `src/core/curriculum/dag.ts`. Foi testado contra o oráculo ingênuo em 400 grafos aleatórios, com certificado conferido após **cada** inserção e testemunha de ciclo conferida a cada rejeição:

```ts
export type NodeId = string;
export type AddEdgeResult =
	| { ok: true; reordered: number }
	| { ok: false; cycle: NodeId[] }; // [x, y, ..., x]: pares consecutivos são arestas (incl. a nova x→y)

export class IncrementalDag {
	private ord = new Map<NodeId, number>();
	private slots: (NodeId | null)[] = [];
	private out = new Map<NodeId, Set<NodeId>>();
	private inn = new Map<NodeId, Set<NodeId>>();

	hasNode(v: NodeId): boolean { return this.ord.has(v); }
	hasEdge(u: NodeId, v: NodeId): boolean { return this.out.get(u)?.has(v) ?? false; }
	addNode(v: NodeId): void {
		if (this.ord.has(v)) throw new Error(`duplicate node ${v}`);
		this.ord.set(v, this.slots.length);
		this.slots.push(v);
		this.out.set(v, new Set());
		this.inn.set(v, new Set());
	}
	/** u é pré-requisito de v (u deve vir antes de v). */
	addEdge(u: NodeId, v: NodeId): AddEdgeResult {
		const ou = this.ord.get(u), ov = this.ord.get(v);
		if (ou === undefined || ov === undefined) throw new Error(`unknown endpoint ${u}->${v}`);
		if (u === v) return { ok: false, cycle: [u, u] };
		if (this.hasEdge(u, v)) return { ok: true, reordered: 0 };
		let reordered = 0;
		if (ou > ov) {
			const lb = ov, ub = ou;
			// dfsF: descendentes de v na região afetada (ord < ub); achar u ⇒ ciclo
			const parent = new Map<NodeId, NodeId | null>([[v, null]]);
			const deltaF: NodeId[] = [];
			const stack: NodeId[] = [v];
			while (stack.length > 0) {
				const n = stack.pop()!;
				deltaF.push(n);
				for (const w of this.out.get(n)!) {
					if (w === u) {
						const path: NodeId[] = [];
						for (let c: NodeId | null = n; c !== null; c = parent.get(c)!) path.push(c);
						path.reverse();
						return { ok: false, cycle: [u, ...path, u] };
					}
					if (this.ord.get(w)! < ub && !parent.has(w)) { parent.set(w, n); stack.push(w); }
				}
			}
			// dfsB: ancestrais de u na região afetada (ord > lb)
			const seenB = new Set<NodeId>([u]);
			const deltaB: NodeId[] = [];
			const stackB: NodeId[] = [u];
			while (stackB.length > 0) {
				const n = stackB.pop()!;
				deltaB.push(n);
				for (const w of this.inn.get(n)!)
					if (this.ord.get(w)! > lb && !seenB.has(w)) { seenB.add(w); stackB.push(w); }
			}
			// reorder: ancestrais de u antes dos descendentes de v, reaproveitando os mesmos slots
			const byOrd = (a: NodeId, b: NodeId) => this.ord.get(a)! - this.ord.get(b)!;
			deltaB.sort(byOrd); deltaF.sort(byOrd);
			const L = [...deltaB, ...deltaF];
			const R = L.map((n) => this.ord.get(n)!).sort((a, b) => a - b);
			for (let i = 0; i < L.length; i++) { this.ord.set(L[i], R[i]); this.slots[R[i]] = L[i]; }
			reordered = L.length;
		}
		this.out.get(u)!.add(v);
		this.inn.get(v)!.add(u);
		return { ok: true, reordered };
	}
	removeEdge(u: NodeId, v: NodeId): void { this.out.get(u)?.delete(v); this.inn.get(v)?.delete(u); }
	/** Certificado de aciclicidade: a ordem topológica mantida. */
	order(): NodeId[] { return this.slots.filter((x): x is NodeId => x !== null); }
	edges(): [NodeId, NodeId][] {
		const es: [NodeId, NodeId][] = [];
		for (const [u, vs] of this.out) for (const v of vs) es.push([u, v]);
		return es;
	}
}

// ─── Checadores de certificado: o "núcleo confiável" (pequeno, sem dependências) ───
export type Check = { ok: true } | { ok: false; reason: string };

/** O(V+E): `order` é permutação de `nodes` e toda aresta aponta para frente. */
export function checkTopoCertificate(nodes: readonly NodeId[], edges: readonly (readonly [NodeId, NodeId])[], order: readonly NodeId[]): Check {
	if (order.length !== nodes.length) return { ok: false, reason: `order has ${order.length} entries, graph has ${nodes.length} nodes` };
	const pos = new Map<NodeId, number>();
	order.forEach((v, i) => pos.set(v, i));
	if (pos.size !== order.length) return { ok: false, reason: "order repeats a node" };
	for (const v of nodes) if (!pos.has(v)) return { ok: false, reason: `node ${v} missing from order` };
	for (const [u, v] of edges) {
		const pu = pos.get(u), pv = pos.get(v);
		if (pu === undefined || pv === undefined) return { ok: false, reason: `edge ${u}->${v} has unknown endpoint` };
		if (!(pu < pv)) return { ok: false, reason: `edge ${u}->${v} points backwards in the order` };
	}
	return { ok: true };
}

/** O(|cycle|): testemunha de não-aciclicidade. */
export function checkCycleWitness(hasEdge: (u: NodeId, v: NodeId) => boolean, cycle: readonly NodeId[]): Check {
	if (cycle.length < 2 || cycle[0] !== cycle[cycle.length - 1]) return { ok: false, reason: "not a closed walk" };
	for (let i = 0; i + 1 < cycle.length; i++)
		if (!hasEdge(cycle[i], cycle[i + 1])) return { ok: false, reason: `missing edge ${cycle[i]}->${cycle[i + 1]}` };
	return { ok: true };
}
```

Arquivo proposto `src/core/curriculum/space.ts`: sistema de cláusulas, fronteiras, interior, itens obrigatórios e propagação. Testado em 300 sistemas aleatórios com rank (`n ≤ 9`, enumeração exaustiva dos 2ⁿ subconjuntos). Conferiu `∅, Q ∈ 𝒦`, ∪-fechamento, acessibilidade, fronteira não vazia, "fronteira = aprendível", interior viável e máximo e `mandatory` sólido. A propagação foi testada em 300 DAGs: `≥ raw`, monótona na evidência, antítona e idempotente.

```ts
import type { NodeId } from "./dag.ts";
export type ClauseSystem = Map<NodeId, NodeId[][]>; // raiz: [[]]; [] (sem cláusula) é proibido
export type State = ReadonlySet<NodeId>;

export function isFeasible(sys: ClauseSystem, K: State): boolean {
	for (const q of K) {
		const cs = sys.get(q);
		if (!cs || !cs.some((c) => c.every((p) => K.has(p)))) return false;
	}
	return true;
}
/** Fronteira externa (= "K ∪ {q} é estado", dado K viável e rank — LS-rank (e)). */
export function outerFringe(sys: ClauseSystem, K: State): NodeId[] {
	const res: NodeId[] = [];
	for (const [q, cs] of sys) if (!K.has(q) && cs.some((c) => c.every((p) => K.has(p)))) res.push(q);
	return res;
}
export function innerFringe(sys: ClauseSystem, K: State): NodeId[] {
	const res: NodeId[] = [];
	for (const q of K) { const rest = new Set(K); rest.delete(q); if (isFeasible(sys, rest)) res.push(q); }
	return res;
}
/** Interior: maior estado viável ⊆ S (reparo conservador). */
export function interior(sys: ClauseSystem, S: State): Set<NodeId> {
	const K = new Set(S);
	for (let changed = true; changed; ) {
		changed = false;
		for (const q of [...K]) {
			const cs = sys.get(q);
			if (!cs || !cs.some((c) => c.every((p) => K.has(p)))) { K.delete(q); changed = true; }
		}
	}
	return K;
}
/** Certificado de learning space (condições R1–R3 de §3.1). */
export function checkRankCertificate(sys: ClauseSystem, order: readonly NodeId[]): { ok: true } | { ok: false; reason: string } {
	const pos = new Map<NodeId, number>();
	order.forEach((v, i) => pos.set(v, i));
	if (pos.size !== order.length || order.length !== sys.size) return { ok: false, reason: "order is not a permutation of the items" };
	for (const [q, cs] of sys) {
		const pq = pos.get(q);
		if (pq === undefined) return { ok: false, reason: `item ${q} missing from order` };
		if (cs.length === 0) return { ok: false, reason: `item ${q} has no clause (unreachable)` };
		for (const c of cs) for (const p of c) {
			const pp = pos.get(p);
			if (pp === undefined) return { ok: false, reason: `clause of ${q} mentions unknown ${p}` };
			if (!(pp < pq)) return { ok: false, reason: `clause of ${q} uses ${p}, which is not earlier` };
		}
	}
	return { ok: true };
}
/** mand(t) = {t} ∪ ⋂_{C ∈ cl t} ⋃_{c ∈ C} mand(c): itens em TODO estado que contém t (cota inferior de horas). */
export function mandatory(sys: ClauseSystem, t: NodeId, memo = new Map<NodeId, Set<NodeId>>()): Set<NodeId> {
	const m = memo.get(t);
	if (m) return m;
	let inter: Set<NodeId> | null = null;
	for (const c of sys.get(t) ?? []) {
		const u = new Set<NodeId>();
		for (const p of c) for (const x of mandatory(sys, p, memo)) u.add(x);
		inter = inter === null ? u : new Set([...inter].filter((x) => u.has(x)));
	}
	const res = new Set<NodeId>(inter ?? []);
	res.add(t);
	memo.set(t, res);
	return res;
}
/** Crédito implícito (só itens com UMA cláusula): m*(p) = max(raw(p), α·m*(v)) para p ∈ cláusula de v.
 *  Uma passada em ordem topológica reversa = lfp do operador monótono (§3.5). */
export function propagateMastery(sys: ClauseSystem, order: readonly NodeId[], raw: ReadonlyMap<NodeId, number>, alpha: number): Map<NodeId, number> {
	const m = new Map<NodeId, number>();
	for (const v of order) m.set(v, raw.get(v) ?? 0);
	for (let i = order.length - 1; i >= 0; i--) {
		const cs = sys.get(order[i]) ?? [];
		if (cs.length !== 1) continue;
		for (const p of cs[0]) m.set(p, Math.max(m.get(p)!, alpha * m.get(order[i])!));
	}
	return m;
}
```

**Medições** (Node 24.12, esta máquina; DAG aleatório com rank oculto e arestas inseridas em ordem aleatória):

| Operação | V = 10⁴, E = 49.965 |
|---|---|
| PK: 49.994 inserções (38.790 nós reordenados no total) | **57,7 ms** no total |
| `checkTopoCertificate` completo | **15,9 ms** |
| DFS ingênuo por aresta, reconstruindo a adjacência (estilo `plan-tree.ts#createsCycle`) | **1,96 ms por aresta** (≈ 98 s para 5·10⁴ arestas) |
| 1.000 inserções "para trás" (340 ciclos detectados) | 247 ms |

Um domínio de 1000–1500 h com nós de 1–4 h tem algo como 300–1500 itens. Com subdomínios, chega a ~10⁴. **Qualquer validação completa custa milissegundos.** O PK se justifica por manter o **certificado** (a ordem) sempre pronto e por evitar o padrão O(E²). A revisão 2 mediu o outro lado (§11.6): carregar um grafo **inteiro** pelo PK a partir de uma ordem arbitrária pode ser patológico; carregue em lote com Kahn e use o PK só depois.

### 6.3 Pipeline de expansão (transacional)

```
 LLM (pi-agent-core tool "propose_expansion")
   │  ExpansionPatch JSON (ids novos com prefixo; referências a itens existentes por id OU por
   │  número de candidato — padrão "candidatos numerados" do BloomTutor, ref-bloomtutor-core.md)
   ▼
 [1] zod (já é dependência do repo: "zod": "^4.4.3") ── falha ⇒ erro legível pelo agente
   ▼
 [2] aplicar num CLONE: IncrementalDag + ClauseSystem (ops em ordem; addEdge devolve ciclo)
   ▼
 [3] invariantes: R1–R3 (checkRankCertificate), contains = floresta, sem pré-req ancestral→
     descendente, conservação de horas no refine, orçamento (N_max, H_max, expansões/dia)
   ▼
 [4] migração dos estados de aluno: isFeasible? senão lift/inferência (refine, addPrereq) ou interior
     → "diff de estado" (o que muda para o aluno) anexado ao evento
   ▼
 [5] certificado = ordem (hash) ; checkTopoCertificate + checkRankCertificate (checador independente)
   ▼
 [6] commit: append em data/curricula/<domínio>/events.jsonl (um escritor por domínio)
     replay do ledger na carga ⇒ mesmo grafo e mesmo hash de certificado (teste de regressão)
```

Os erros seguem o padrão `PlanTreeError` de `src/core/plan-tree.ts`: mensagem escrita **para o agente**, nomeando a aresta ou o id culpado. Exemplo: `Edge "fasores" → "impedancia" would create a cycle: impedancia → … → fasores`, incluindo a testemunha. O agente corrige e reenvia, com no máximo *k* tentativas, contando no orçamento.

Esboço (não executado; os tipos ficariam em `src/core/contracts/curriculum.ts`):

```ts
export type Hours = { lo: number; hi: number };
export type ExpansionOp =
	| { op: "addItem"; id: string; title: string; region: string; hours: Hours; clauses: string[][] }
	| { op: "addAlternative"; item: string; clause: string[] }
	| { op: "addPrereq"; item: string; clauseIndex: number; prereq: string }
	| { op: "refine"; item: string; sub: { id: string; title: string; hours: Hours; clauses: string[][] | "entry" }[] }
	| { op: "addSubdomain"; id: string; title: string; items: Extract<ExpansionOp, { op: "addItem" }>[] }
	| { op: "retire"; item: string; reroute: { item: string; clause: string[] }[] }
	| { op: "setHours"; item: string; hours: Hours };

export type ValidationError = { code: "schema" | "cycle" | "unknown-id" | "no-route" | "budget" | "hours-conservation" | "hierarchy"; message: string; witness?: string[] };

export function applyPatch(domain: DomainSnapshot, ops: ExpansionOp[], learners: LearnerState[], budget: Budget):
	| { ok: true; next: DomainSnapshot; certificate: { order: string[]; hash: string }; stateDiffs: StateDiff[] }
	| { ok: false; errors: ValidationError[] } {
	const g = domain.dag.clone();               // IncrementalDag (cópia barata a 10⁴)
	const sys = cloneSystem(domain.clauses);
	for (const op of ops) { /* aplica; addEdge → se !ok, push {code:"cycle", witness: r.cycle} */ }
	// refine: insere o bloco W na ordem imediatamente antes de x (§4.1) — no PK, basta inserir as arestas
	const cert = g.order();
	const c1 = checkTopoCertificate(nodesOf(sys), unionEdges(sys), cert);
	const c2 = checkRankCertificate(sys, cert);
	// orçamento, hierarquia, conservação de horas …
	// estados: para cada aluno, K' = isFeasible(sys, lifted(K)) ? lifted(K) : inferOrInterior(...)
	/* … */
}
```

---

## 7. Lean: o que provar, onde e como

### 7.1 Estrutura do diretório `formal/` (no repo)

```
formal/
  lean-toolchain            # leanprover/lean4:v4.36.0  (igual à Mathlib)
  lakefile.toml
  LHFormal.lean             # importa tudo
  LHFormal/Dag.lean         # Acyclic, IsRanking, acyclic_of_ranking, acyclic_addEdge_iff
  LHFormal/ClauseSystem.lean# Feasible, Ranked, LS-rank (a)–(h), fronteira, interior
  LHFormal/Refine.lean      # refinamento-marco: ranked, lift, project, reach_iff
  LHFormal/Mastery.lean     # crédito implícito (lfp), BKT
  LHFormal/Hours.lean       # remaining_anti, mandatory_subset
  LHFormal/Progress.lean    # variante, plano, orçamento (lexicográfico)
  LHFormal/Checker.lean     # checadores Bool sobre Array (núcleo Lean, sem Mathlib) + Instance JSON
  LHFormal/CheckerSound.lean# checkTopo_sound, checkRanked_sound (ligam Bool ↔ Prop)
  LHFormal/Main.lean        # executável lh-check (modo cert e modo modelo p/ DRT)
  scripts/Axioms.lean       # #print axioms dos teoremas exportados (gate de CI)
```

`lakefile.toml`:

```toml
name = "lhformal"
version = "0.1.0"
defaultTargets = ["LHFormal", "lh-check"]

[[require]]
name = "mathlib"
scope = "leanprover-community"
rev = "v4.36.0"

[[lean_lib]]
name = "LHFormal"

[[lean_exe]]
name = "lh-check"
root = "LHFormal.Main"
```

### 7.2 Esboços Lean 4

> **Não compilado nesta sessão.** Os nomes de lemas Mathlib estão marcados com "conferir" e devem ser confirmados com `#check`. `sorry` marca provas a fazer, com o roteiro em comentário. As provas escritas por extenso são curtas e usam só construções estáveis.

**`Dag.lean`**

```lean
import Mathlib.Logic.Relation

namespace LH

/-- `G u v`: u é pré-requisito direto de v. -/
abbrev Rel (V : Type*) := V → V → Prop

/-- Mesma definição que `Cslib.Relation.Acyclic` (fecho transitivo irreflexivo). -/
def Acyclic {V : Type*} (G : Rel V) : Prop := ∀ v, ¬ Relation.TransGen G v v

/-- Certificado: rank estritamente crescente nas arestas (o `ord` do Pearce–Kelly). -/
def IsRanking {V : Type*} (G : Rel V) (r : V → ℕ) : Prop := ∀ ⦃u v⦄, G u v → r u < r v

theorem IsRanking.transGen {V : Type*} {G : Rel V} {r : V → ℕ} (h : IsRanking G r)
    {a b : V} (hab : Relation.TransGen G a b) : r a < r b := by
  induction hab with
  | single h1 => exact h h1
  | tail _ h2 ih => exact ih.trans (h h2)

/-- Soundness do certificado (o que o checador usa). -/
theorem acyclic_of_ranking {V : Type*} {G : Rel V} {r : V → ℕ} (h : IsRanking G r) :
    Acyclic G :=
  fun v hv => lt_irrefl _ (h.transGen hv)

/-- Completude (grafo finito). Roteiro: r v := comprimento do maior caminho até v, ou importar
  `Cslib.Algorithms.Lean.DFS.acyclic_iff_exists_isTopologicalOrder` (cslib-frontier). -/
theorem exists_ranking_of_acyclic {V : Type*} [Fintype V] [DecidableEq V] {G : Rel V}
    [DecidableRel G] (h : Acyclic G) : ∃ r : V → ℕ, IsRanking G r := by
  sorry

/-- A pergunta que o PK responde: inserir x→y preserva aciclicidade sse y não alcança x. -/
theorem acyclic_addEdge_iff {V : Type*} {G : Rel V} (hG : Acyclic G) (x y : V) :
    Acyclic (fun a b => G a b ∨ (a = x ∧ b = y)) ↔ ¬ Relation.ReflTransGen G y x := by
  sorry -- (→) um caminho y →* x mais a nova aresta fecha um ciclo;
        -- (←) um ciclo novo usa x→y; o resto é caminho y →* x em G.

end LH
```

**`ClauseSystem.lean`**

```lean
import Mathlib.Data.Finset.Lattice.Fold   -- conferir: Finset.exists_max_image / exists_min_image
import Mathlib.Data.Finset.Basic

namespace LH
variable {V : Type*} [DecidableEq V]

/-- Sistema de cláusulas E/OU: `cl q` = alternativas; cada alternativa é um conjunto de pré-requisitos. -/
structure ClauseSys (V : Type*) [DecidableEq V] where
  items : Finset V
  cl    : V → List (Finset V)

namespace ClauseSys
variable (S : ClauseSys V)

def Feasible (K : Finset V) : Prop :=
  K ⊆ S.items ∧ ∀ q ∈ K, ∃ C ∈ S.cl q, C ⊆ K

/-- Condições R1–R3 (§3.1). -/
structure Ranked (r : V → ℕ) : Prop where
  nonempty : ∀ q ∈ S.items, S.cl q ≠ []
  below    : ∀ q ∈ S.items, ∀ C ∈ S.cl q, ∀ p ∈ C, r p < r q
  closed   : ∀ q ∈ S.items, ∀ C ∈ S.cl q, C ⊆ S.items

variable {S}

theorem feasible_empty : S.Feasible ∅ := ⟨Finset.empty_subset _, by simp⟩

theorem feasible_union {K L : Finset V} (hK : S.Feasible K) (hL : S.Feasible L) :
    S.Feasible (K ∪ L) := by
  refine ⟨Finset.union_subset hK.1 hL.1, fun q hq => ?_⟩
  rcases Finset.mem_union.1 hq with h | h
  · obtain ⟨C, hC, hCK⟩ := hK.2 q h
    exact ⟨C, hC, hCK.trans Finset.subset_union_left⟩
  · obtain ⟨C, hC, hCL⟩ := hL.2 q h
    exact ⟨C, hC, hCL.trans Finset.subset_union_right⟩

/-- LS-rank (c): acessibilidade — remover o item de rank máximo. -/
theorem accessible {r : V → ℕ} (hr : S.Ranked r) {K : Finset V} (hK : S.Feasible K)
    (hne : K.Nonempty) : ∃ q ∈ K, S.Feasible (K.erase q) := by
  obtain ⟨q, hqK, hmax⟩ := K.exists_max_image r hne
  refine ⟨q, hqK, (Finset.erase_subset q K).trans hK.1, fun x hx => ?_⟩
  have hxK := Finset.mem_of_mem_erase hx
  obtain ⟨C, hC, hCK⟩ := hK.2 x hxK
  refine ⟨C, hC, fun p hp => Finset.mem_erase.2 ⟨?_, hCK hp⟩⟩
  rintro rfl
  exact absurd (hmax x hxK) (not_le.2 (hr.below x (hK.1 hxK) C hC _ hp))

/-- LS-rank (g): progresso dirigido a meta. Com `P := S.items` dá a fronteira não vazia (d). -/
theorem plan_progress {r : V → ℕ} (hr : S.Ranked r) {K P : Finset V}
    (hK : S.Feasible K) (hP : S.Feasible P) (hnot : ¬ P ⊆ K) :
    ∃ q ∈ P \ K, S.Feasible (insert q K) := by
  obtain ⟨q, hq, hmin⟩ := (P \ K).exists_min_image r (Finset.sdiff_nonempty.2 hnot)
  obtain ⟨hqP, hqK⟩ := Finset.mem_sdiff.1 hq
  obtain ⟨C, hC, hCP⟩ := hP.2 q hqP
  have hCK : C ⊆ K := fun p hp => by
    by_contra hpK
    have h1 := hmin p (Finset.mem_sdiff.2 ⟨hCP hp, hpK⟩)        -- r q ≤ r p
    exact absurd (hr.below q (hP.1 hqP) C hC p hp) (not_lt.2 h1)  -- mas r p < r q
  refine ⟨q, hq, Finset.insert_subset (hP.1 hqP) hK.1, fun x hx => ?_⟩
  rcases Finset.mem_insert.1 hx with rfl | hxK
  · exact ⟨C, hC, hCK.trans (Finset.subset_insert _ _)⟩
  · obtain ⟨D, hD, hDK⟩ := hK.2 x hxK
    exact ⟨D, hD, hDK.trans (Finset.subset_insert _ _)⟩

/-- LS-rank (a)+(d): Q é viável e nunca há travamento antes do fim. -/
theorem feasible_items {r : V → ℕ} (hr : S.Ranked r) : S.Feasible S.items := by
  sorry -- cada q tem cláusula (nonempty) contida em items (closed)

theorem fringe_nonempty {r : V → ℕ} (hr : S.Ranked r) {K : Finset V} (hK : S.Feasible K)
    (hlt : K ⊂ S.items) : ∃ q ∈ S.items \ K, S.Feasible (insert q K) :=
  plan_progress hr hK (feasible_items hr) hlt.2

/-- LS-rank (f) = [L2] learning consistency. -/
theorem learning_consistency {r : V → ℕ} (hr : S.Ranked r) {K L : Finset V} {q : V}
    (hKL : K ⊆ L) (hL : S.Feasible L) (hKq : S.Feasible (insert q K)) :
    S.Feasible (insert q L) := by
  have hqI := hKq.1 (Finset.mem_insert_self q K)
  obtain ⟨C, hC, hCK⟩ := hKq.2 q (Finset.mem_insert_self q K)
  have hCL : C ⊆ L := fun p hp => by
    rcases Finset.mem_insert.1 (hCK hp) with rfl | hpK
    · exact absurd (hr.below _ hqI C hC _ hp) (lt_irrefl _)
    · exact hKL hpK
  refine ⟨Finset.insert_subset hqI hL.1, fun x hx => ?_⟩
  rcases Finset.mem_insert.1 hx with rfl | hxL
  · exact ⟨C, hC, hCL.trans (Finset.subset_insert _ _)⟩
  · obtain ⟨D, hD, hDL⟩ := hL.2 x hxL
    exact ⟨D, hD, hDL.trans (Finset.subset_insert _ _)⟩

/-- [L1] learning smoothness: indução em (L \ K).card usando plan_progress com P := L. -/
theorem learning_smoothness {r : V → ℕ} (hr : S.Ranked r) {K L : Finset V}
    (hK : S.Feasible K) (hL : S.Feasible L) (hKL : K ⊆ L) :
    ∃ w : List V, w.Nodup ∧ w.toFinset = L \ K ∧
      ∀ i ≤ w.length, S.Feasible (K ∪ (w.take i).toFinset) := by
  sorry

/-! ### Reparo: interior (maior estado viável contido em X) -/

/-- Uma rodada de poda: mantém só itens com alguma cláusula contida no conjunto atual. -/
def prune (S : ClauseSys V) (K : Finset V) : Finset V :=
  (K ∩ S.items).filter (fun q => (S.cl q).any (fun C => decide (C ⊆ K)))

def interior (S : ClauseSys V) (X : Finset V) : Finset V := (S.prune)^[X.card + 1] X

theorem interior_subset (X : Finset V) : S.interior X ⊆ X := by sorry
theorem interior_feasible (X : Finset V) : S.Feasible (S.interior X) := by
  sorry -- após ≤ |X| rodadas que removem algo, prune atinge ponto fixo; ponto fixo ⇒ viável
theorem interior_maximal {K X : Finset V} (hK : S.Feasible K) (hKX : K ⊆ X) :
    K ⊆ S.interior X := by
  sorry -- invariante: K ⊆ iterado; prune nunca remove q ∈ K (cláusula de q está em K ⊆ iterado)

end ClauseSys
end LH
```

**`Refine.lean`** (enunciados)

```lean
namespace LH.ClauseSys
variable {V : Type*} [DecidableEq V]

/-- Refinamento-marco: fontes de W herdam `S.cl x`; internos de W usam `H.cl`; `x` exige W inteiro. -/
def refine (S : ClauseSys V) (x : V) (H : ClauseSys V) (sources : Finset V) : ClauseSys V where
  items := S.items ∪ H.items
  cl q  := if q = x then [H.items]
           else if q ∈ sources then S.cl x
           else if q ∈ H.items then H.cl q
           else S.cl q

/-- Fórmula de rank do §4.1 (N limita rH). -/
def refineRank (r rH : V → ℕ) (N : ℕ) (x : V) (W : Finset V) (v : V) : ℕ :=
  if v ∈ W then (N + 2) * r x + rH v else (N + 2) * r v + N + 1

theorem refine_ranked {S H : ClauseSys V} {x : V} {sources : Finset V} {r rH : V → ℕ} {N : ℕ}
    (hS : S.Ranked r) (hH : ∀ w ∈ H.items, w ∉ sources → H.cl w ≠ [] ∧
        ∀ C ∈ H.cl w, C ⊆ H.items ∧ ∀ p ∈ C, rH p < rH w)
    (hsrc : sources ⊆ H.items) (hsne : sources.Nonempty) (hx : x ∈ S.items)
    (hdisj : Disjoint S.items H.items) (hN : ∀ w ∈ H.items, rH w ≤ N) :
    (S.refine x H sources).Ranked (refineRank r rH N x H.items) := by
  sorry -- aritmética caso a caso (§4.1); `omega`/`nlinarith` fecham cada caso

theorem refine_lift {S H : ClauseSys V} {x : V} {sources : Finset V} {K : Finset V}
    (hK : S.Feasible K) /- + hipóteses de refine_ranked -/ :
    (S.refine x H sources).Feasible (if x ∈ K then K ∪ H.items else K) := by sorry

theorem refine_project {S H : ClauseSys V} {x : V} {sources : Finset V} {K' : Finset V}
    (hK' : (S.refine x H sources).Feasible K') /- + hipóteses -/ :
    S.Feasible (K' ∩ S.items) := by sorry
end LH.ClauseSys
```

**`Mastery.lean`**

```lean
import Mathlib.Data.Real.Basic
import Mathlib.Tactic

namespace LH
variable {V : Type*}

/-- Especificação do crédito implícito: menor majorante de `raw` com `α·m v ≤ m u` nas arestas.
  Existência/cálculo: `OrderHom.lfp` (Mathlib/Order/FixedPoints.lean) ou a passada em ordem
  topológica reversa (o `propagateMastery` do TS). -/
structure IsImplicitCredit (G : V → V → Prop) (α : ℝ) (raw m : V → ℝ) : Prop where
  ge_raw : ∀ v, raw v ≤ m v
  credit : ∀ ⦃u v⦄, G u v → α * m v ≤ m u
  least  : ∀ m' : V → ℝ, (∀ v, raw v ≤ m' v) → (∀ ⦃u v⦄, G u v → α * m' v ≤ m' u) →
             ∀ v, m v ≤ m' v

/-- Monotonia na evidência: mais acertos nunca diminuem a maestria propagada. -/
theorem implicitCredit_mono {G : V → V → Prop} {α : ℝ} {raw raw' m m' : V → ℝ}
    (hraw : ∀ v, raw v ≤ raw' v) (h : IsImplicitCredit G α raw m)
    (h' : IsImplicitCredit G α raw' m') : ∀ v, m v ≤ m' v :=
  h.least m' (fun v => (hraw v).trans (h'.ge_raw v)) h'.credit

/-- Posterior BKT após resposta correta. -/
noncomputable def bktPostCorrect (pL g s : ℝ) : ℝ :=
  pL * (1 - s) / (pL * (1 - s) + (1 - pL) * g)

/-- Não-degenerescência G ≤ 1 − S ⇒ acerto nunca reduz P(L). -/
theorem bkt_postCorrect_ge {pL g s : ℝ} (h0 : 0 ≤ pL) (h1 : pL ≤ 1) (hgs : g ≤ 1 - s)
    (hpos : 0 < pL * (1 - s) + (1 - pL) * g) : pL ≤ bktPostCorrect pL g s := by
  unfold bktPostCorrect
  rw [le_div_iff₀ hpos]   -- conferir o nome (le_div_iff₀) na Mathlib atual
  have : (1 - pL) * g ≤ (1 - pL) * (1 - s) := mul_le_mul_of_nonneg_left hgs (by linarith)
  nlinarith [mul_le_mul_of_nonneg_left this h0]
end LH
```

**`Hours.lean`**

```lean
import Mathlib.Algebra.BigOperators.Group.Finset.Basic  -- conferir caminho atual

namespace LH
variable {V : Type*} [DecidableEq V]

def remaining (h : V → ℕ) (need K : Finset V) : ℕ := ∑ v ∈ need \ K, h v

/-- Cota de horas restante é antítona no estado: aprender nunca aumenta o que falta. -/
theorem remaining_anti (h : V → ℕ) (need : Finset V) {K K' : Finset V} (hKK' : K ⊆ K') :
    remaining h need K' ≤ remaining h need K :=
  Finset.sum_le_sum_of_subset (Finset.sdiff_subset_sdiff (subset_refl _) hKK')

/-- Soundness da cota inferior: `M` está em todo estado viável que contém t.
  (Provar para a fórmula mand(t) por indução forte no rank.) -/
def IsMandatory (S : ClauseSys V) (t : V) (M : Finset V) : Prop :=
  ∀ K, S.Feasible K → t ∈ K → M ⊆ K
end LH
```

**`Progress.lean`** (enunciados)

```lean
namespace LH.ClauseSys
variable {V : Type*} [DecidableEq V] {S : ClauseSys V}

/-- Um passo de domínio bem-sucedido a partir da fronteira. -/
def Step (S : ClauseSys V) (K K' : Finset V) : Prop := ∃ q ∉ K, K' = insert q K ∧ S.Feasible K'

theorem step_card {K K' : Finset V} (h : S.Step K K') : K'.card = K.card + 1 := by
  obtain ⟨q, hq, rfl, -⟩ := h; exact Finset.card_insert_of_not_mem hq  -- conferir nome

/-- Variante: (items.card - K.card) decresce ⇒ todo encadeamento de passos termina em ≤ |Q∖K|. -/
theorem step_wf : WellFounded (fun K' K => S.Step K K' ∧ K' ⊆ S.items) := by sorry

/-- Com expansões: o par (orçamento, faltantes) decresce lexicograficamente a cada evento. -/
theorem progress_with_budget : True := by trivial  -- enunciar sobre o tipo de eventos do ledger
end LH.ClauseSys
```

**`Checker.lean` + `CheckerSound.lean` + `Main.lean`** (núcleo Lean para o executável; o checador não depende da Mathlib)

```lean
-- Checker.lean
import Lean.Data.Json
namespace LH.Checker

/-- Instância exportada pelo TS (ids normalizados para 0..n-1). -/
structure Instance where
  n     : Nat
  edges : Array (Nat × Nat)
  order : Array Nat          -- certificado
  deriving Lean.FromJson, Lean.ToJson

def Instance.positions (I : Instance) : Array (Option Nat) := Id.run do
  let mut pos : Array (Option Nat) := Array.replicate I.n none
  for i in [0:I.order.size] do
    let v := I.order[i]!
    if v < I.n then pos := pos.set! v (some i)
  return pos

/-- O(V+E). Tamanho n + todos presentes ⇒ permutação (pombos). -/
def Instance.checkTopo (I : Instance) : Bool :=
  let pos := I.positions
  I.order.size == I.n && pos.all Option.isSome &&
  I.edges.all fun (u, v) =>
    match pos[u]?.join, pos[v]?.join with
    | some pu, some pv => decide (pu < pv)
    | _, _ => false
end LH.Checker

-- CheckerSound.lean
import LHFormal.Checker
import LHFormal.Dag
namespace LH.Checker
theorem checkTopo_sound (I : Instance) (h : I.checkTopo = true) :
    LH.Acyclic (fun u v => (u, v) ∈ I.edges.toList) := by
  sorry -- r u := posição de u em I.order; IsRanking pelas arestas; acyclic_of_ranking

/-- Exemplo pequeno, provado por avaliação no kernel. -/
example : ({ n := 3, edges := #[(0,1),(1,2)], order := #[0,1,2] } : Instance).checkTopo = true := by
  decide   -- se travar: `decide +kernel`; evitar `decide +native` fora de exemplos marcados
end LH.Checker

-- Main.lean  (executável `lh-check <arquivo.json>`; modo DRT lê JSONL e aplica o modelo)
import LHFormal.Checker
open Lean LH.Checker
def main (args : List String) : IO UInt32 := do
  let some path := args.head? | do IO.eprintln "uso: lh-check <instancia.json>"; return 2
  let txt ← IO.FS.readFile path
  match Json.parse txt >>= fromJson? (α := Instance) with
  | .error e => IO.eprintln s!"json inválido: {e}"; return 2
  | .ok inst =>
    let ok := inst.checkTopo
    IO.println (Json.compress (Json.mkObj [("acyclic", Json.bool ok)]))
    return if ok then 0 else 1
```

Para o **DRT de fronteira, interior e mandatory**, o modo "modelo" do `lh-check` executa as próprias definições de `ClauseSystem.lean`. Em `Finset Nat` elas são computáveis e lentas, o que basta para `n ≤ 50`, e são as **mesmas definições sobre as quais os teoremas foram provados**. É o desenho do Cedar: o modelo executável **é** a especificação.

### 7.3 O que provar em Lean, checar em runtime e testar com PBT

| ID | Propriedade | Lean (formal/) | Runtime (certificado/checagem) | PBT (fast-check) |
|---|---|---|---|---|
| I1 | Ids únicos, referências existem, ids nunca reutilizados | — | zod + `checkRankCertificate` (R3) | gerador de patches com ids inválidos ⇒ rejeição |
| I2 | Grafo-união acíclico | **P0** `acyclic_of_ranking`, `checkTopo_sound`; P1 `exists_ranking_of_acyclic` (cslib-frontier) | PK + `checkTopoCertificate` a cada commit; testemunha de ciclo nas rejeições | PK × oráculo; certificado sempre válido; model-based (`fc.commands`) |
| I3 | Todo item tem rota (R1) e `Q` é viável | **P0** `feasible_items` | `checkRankCertificate` | — |
| I4 | `contains` é floresta; sem pré-requisito de ancestral para descendente | — | checagem O(V) | gerador de hierarquias |
| I5 | Learning space (∪-fechado, acessível, [L1], [L2]) | **P0** `feasible_union`, `accessible`, `learning_consistency`; P1 `learning_smoothness` | (consequência de I2 + I3) | **exaustivo** com n ≤ 9 (Teor. 8 local) |
| I6 | Estado do aluno viável após cada evento | P1 `addItem_preserves`, `addAlternative_preserves`, `refine_lift`, `refine_project` | `isFeasible` + lift/inferência/`interior` no commit | `fc.commands` com ops de expansão e domínio |
| I7 | Reparo correto: interior é viável e máximo | **P0** `interior_feasible`, `interior_maximal` | — | exaustivo em n ≤ 9 |
| I8 | Sem travamento e progresso dirigido a meta | **P0** `fringe_nonempty`, `plan_progress`; P1 `step_wf`, `progress_with_budget` | asserção: `K ≠ Q ⇒ fringe ≠ ∅` (alarme, nunca deveria disparar) | caminhadas aleatórias da política chegam a `Q` em `|Q∖K|` passos |
| I9 | Refinamento sem dependências espúrias | P1 `refine_ranked`, `refine_reach_iff` | inserir o bloco W antes de x; conferir certificado | alcançabilidade antes/depois entre nós antigos |
| I10 | Orçamentos (N_max, H_max, expansões/dia) e conservação de horas | P1 (lexicográfico) | checagem no commit | — |
| I11 | Crédito implícito: ≥ raw, mínimo, monótono, antítono | **P0** `implicitCredit_mono`; P1 `pass_isImplicitCredit` | — | monotonia, antitonia, idempotência (testado aqui) |
| I12 | BKT não degenerado ⇒ acerto não reduz P(L) | **P0** `bkt_postCorrect_ge` | clamp `G + S ≤ 1` no ajuste | — |
| I13 | Cotas de horas: LB sólida e antítona | **P0** `remaining_anti`; P1 `mandatory_subset` | — | `mandatory ⊆` todo estado com t (testado aqui) |
| I14 | Replay determinístico do ledger (mesmo grafo e hash de certificado) | — | teste de carga | gerar ledger aleatório, fazer replay e comparar |

**Não formalizar:**
- o interior do Pearce–Kelly, porque a saída é verificada (*certifying*);
- a qualidade pedagógica das arestas e a acurácia das estimativas de horas, que são empíricas (§9);
- o ajuste de parâmetros BKT/FSRS;
- a NP-dificuldade do plano ótimo (§3.6), que é argumento de projeto e não invariante;
- UI e prompts.

### 7.4 Esforço estimado

Estimativa minha, sem fonte: um engenheiro com experiência básica em Lean 4 e Mathlib.

- **P0:** os teoremas acima, `checkTopo_sound`, executável e CI. **~1–2 semanas.** A maior parte das provas já está esboçada; o trabalho é fazer compilar.
- **P1:** completude, [L1], refinamento, preservação por operador, `mandatory_subset` e variante com orçamento. **~2–4 semanas.**
- **P2** (opcional): ligar `Feasible` ao `Antimatroid` do linglib; Birkhoff/`LowerSet` no caso só-E; projeção para regiões e livros (Teor. 33).

LLMs atuais ajudam a preencher provas. Os **enunciados** devem ser escritos e revisados à mão, com `axiom-audit` e `leanchecker` na CI (§5.4).

---

## 8. Testes TS: fast-check espelhando os teoremas + DRT com Lean

O repo usa `node:test` via `tsx --test` (`package.json`). O fast-check funciona direto dentro de `test(...)`; `@fast-check/vitest` não é necessário. É preciso adicionar `fast-check@4.10.2` como devDependency.

**Atenção no Windows:** o script `"test": "NODE_ENV=test tsx --test …"` usa sintaxe POSIX e falha no PowerShell. Rode-o pelo Git Bash ou use `cross-env`.

```ts
// tests/curriculum-space.property.test.ts (esboço; não executado nesta sessão por não instalar fast-check)
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { IncrementalDag, checkTopoCertificate, checkCycleWitness } from "../src/core/curriculum/dag.ts";
import { isFeasible, outerFringe, innerFringe, interior, mandatory, checkRankCertificate, type ClauseSystem } from "../src/core/curriculum/space.ts";

// Sistema com rank embutido: cláusulas de q_i só citam q_k com k < i (garante R1–R3).
const rankedSystem = fc.integer({ min: 1, max: 9 }).chain((n) =>
	fc.array(fc.array(fc.uniqueArray(fc.nat(), { maxLength: 3 }), { minLength: 1, maxLength: 2 }), { minLength: n, maxLength: n })
		.map((raw) => {
			const ids = raw.map((_, i) => `q${i}`);
			const sys: ClauseSystem = new Map();
			raw.forEach((cls, i) => sys.set(ids[i], i === 0 ? [[]] : cls.map((c) => [...new Set(c.map((k) => ids[k % i]))])));
			return { ids, sys };
		}),
);
// Estado viável gerado por uma "learning word" (sempre escolhe da fronteira).
const withState = rankedSystem.chain(({ ids, sys }) =>
	fc.array(fc.nat(), { maxLength: 12 }).map((choices) => {
		const K = new Set<string>();
		for (const c of choices) { const F = outerFringe(sys, K); if (F.length === 0) break; K.add(F[c % F.length]); }
		return { ids, sys, K };
	}),
);

test("LS-rank: certificado, Q viável, fronteira não vazia e = aprendível (I3, I5, I8)", () => {
	fc.assert(fc.property(withState, ({ ids, sys, K }) => {
		assert.ok(checkRankCertificate(sys, ids).ok);
		assert.ok(isFeasible(sys, K) && isFeasible(sys, new Set(ids)));
		const F = outerFringe(sys, K);
		if (K.size < ids.length) assert.ok(F.length > 0);
		for (const q of ids) if (!K.has(q)) assert.equal(F.includes(q), isFeasible(sys, new Set([...K, q])));
		if (K.size > 0) assert.ok(innerFringe(sys, K).length > 0); // acessível
	}), { numRuns: 2000 });
});

test("interior: viável, ⊆ S e contém todo estado ⊆ S (I7)", () => {
	fc.assert(fc.property(withState, fc.array(fc.nat()), ({ ids, sys, K }, extra) => {
		const S = new Set([...K, ...extra.map((k) => ids[k % ids.length])]);
		const I = interior(sys, S);
		assert.ok(isFeasible(sys, I) && [...I].every((x) => S.has(x)));
		assert.ok([...K].every((x) => I.has(x)));          // K é estado ⊆ S ⇒ K ⊆ interior
	}));
});

test("mandatory ⊆ todo estado que contém t (I13)", () => {
	fc.assert(fc.property(withState, ({ ids, sys, K }) => {
		for (const t of K) assert.ok([...mandatory(sys, t)].every((x) => K.has(x)));
	}));
});

// Model-based: o modelo é o conjunto de arestas; o "real" é o IncrementalDag (I2).
type M = { edges: Set<string>; n: number };
class AddEdge implements fc.Command<M, IncrementalDag> {
	constructor(readonly a: number, readonly b: number) {}
	check = () => true;
	run(m: M, g: IncrementalDag) {
		const u = `n${this.a % m.n}`, v = `n${this.b % m.n}`;
		const r = g.addEdge(u, v);
		if (r.ok) m.edges.add(`${u}|${v}`);
		else assert.ok(checkCycleWitness((x, y) => m.edges.has(`${x}|${y}`) || (x === u && y === v), r.cycle).ok);
		const ids = Array.from({ length: m.n }, (_, i) => `n${i}`);
		assert.ok(checkTopoCertificate(ids, [...m.edges].map((e) => e.split("|") as [string, string]), g.order()).ok);
	}
	toString = () => `addEdge(${this.a},${this.b})`;
}
class RemoveEdge implements fc.Command<M, IncrementalDag> {
	constructor(readonly a: number, readonly b: number) {}
	check = () => true;
	run(m: M, g: IncrementalDag) { const u = `n${this.a % m.n}`, v = `n${this.b % m.n}`; g.removeEdge(u, v); m.edges.delete(`${u}|${v}`); }
	toString = () => `removeEdge(${this.a},${this.b})`;
}
test("IncrementalDag: model-based (I2)", () => {
	const cmds = [
		fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => new AddEdge(a, b)),
		fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => new RemoveEdge(a, b)),
	];
	fc.assert(fc.property(fc.integer({ min: 1, max: 25 }), fc.commands(cmds, { size: "+1" }), (n, cs) => {
		fc.modelRun(() => {
			const g = new IncrementalDag();
			for (let i = 0; i < n; i++) g.addNode(`n${i}`);
			return { model: { edges: new Set<string>(), n }, real: g };
		}, cs);
	}));
});
```

**DRT com Lean** (`tests/curriculum-drt.test.ts`): o teste roda **só** se `LH_LEAN_CHECK` apontar para `formal/.lake/build/bin/lh-check`.

1. O fast-check gera *N* instâncias: grafos, sistemas e estados.
2. As instâncias são gravadas em JSONL num diretório temporário.
3. `spawnSync` executa o binário **uma vez por lote**.
4. Compara-se: veredito de aciclicidade, `outerFringe` ordenada, `interior` e `mandatory(t)`.

Os contraexemplos minimizados vão para `tests/fixtures/curriculum-drt/*.json` como regressão, como o Cedar faz com o corpus.

**CI** (`.github/workflows/formal.yml`; o repo já tem `.github/workflows`):

```yaml
name: formal
on: [push, pull_request]
jobs:
  lean-and-drt:
    runs-on: ubuntu-latest
    env: { LEAN_NUM_THREADS: "2" }
    steps:
      - uses: actions/checkout@v4
      - uses: leanprover/lean-action@v1
        with:
          lake-package-directory: formal
          leanchecker: true
          axiom-audit: true
          axiom-audit-allow: "propext,Classical.choice,Quot.sound"
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: LH_LEAN_CHECK=formal/.lake/build/bin/lh-check npx tsx --test tests/curriculum-*.test.ts
```

A allowlist do `axiom-audit` barra `sorry` e `native_decide`. Enquanto houver `sorry` em P1, restrinja o `axiom-audit-root` a um namespace `LH.Verified` que só contém os teoremas fechados.

---

## 9. Limites: o que a formalização não resolve, e como mitigar

1. **Arestas erradas, mas acíclicas.** A estrutura fica perfeita e a pedagogia não. Mitigações:
   - **(a)** "Aresta = necessária, não suficiente; direta, não transitiva". É a regra do open-mastery (`ref-open-mastery.md` §2.4), validada pelo próprio LLM como checklist.
   - **(b)** Poda baseada em dados, na linha do **QUERY** da KST. Se muitos alunos dominam `v` sem `u`, a aresta `u → v` é suspeita. O Teorema 43 diz quando remover estados mantém o learning space. No ALEKS, o Bloco 2 do QUERY removeu **99%** dos estados falsos ([1511.06757](https://arxiv.org/abs/1511.06757) §11).
   - **(c)** A taxa de sucesso na fronteira é uma métrica de saúde do grafo. O ALEKS tem ≈ 0,93; muito abaixo disso indica pré-requisitos faltando.
2. **Horas são estimativas.** As cotas são sólidas *dadas* as estimativas. Recalibre com o tempo observado, por exemplo com shrinkage bayesiano por região.
3. **Escolha dentro da fronteira.** Os teoremas garantem que a política não trava, mas não que ela seja **ótima**: ordem, interleaving e revisão. Isso é otimização e heurística, não invariante.
4. **Antimatroides gerais.** A condição de rank (R2) é suficiente, não necessária. Se um dia for preciso aceitar learning spaces sem rank global, use o critério "sem hanging states" (Teor. 41) com checagem exaustiva local. Isso é inviável em escala, então não recomendo.
5. **Pesquisa incompleta.** O orçamento de buscas web desta sessão acabou antes de três reverificações:
   - o limiar exato de degenerescência de Baker et al. (2008);
   - os detalhes atuais do backend JS do Dafny;
   - o estado atual do `lasm` (Lean→WASM).

   Nenhum dos três muda as recomendações. Na revisão 2 a busca web também estava indisponível. As fontes novas foram conferidas direto no arXiv (consultas por campo), na API do GitHub (`gh api`), no registro npm e em PDFs lidos com `pdftotext`. O venue de Cui et al. (2609.05245) não foi confirmado e por isso foi removido.

---

## 10. Roteiro sugerido

| Fase | Entregáveis | Critério de pronto |
|---|---|---|
| 1 | `src/core/contracts/curriculum.ts`, `src/core/curriculum/{dag,space}.ts` (código de §6.2), `tests/curriculum-*.test.ts` com fast-check | PBT verde (≥ 2k runs/propriedade); bench de 10⁴ nós < 100 ms |
| 2 | `applyPatch` transacional + ledger `data/curricula/<domínio>/events.jsonl` + migração de estados + erros legíveis pelo agente + gatilhos com orçamento | `fc.commands` com ops de expansão e domínio mantém I1–I14 |
| 3 | `formal/` P0 + `lh-check` + workflow de CI com `leanchecker`/`axiom-audit` | CI verde sem `sorry` no namespace verificado |
| 4 | DRT (modo modelo do `lh-check`) + corpus de regressão | ≥ 10⁵ instâncias/dia sem divergência |
| 5 | `formal/` P1 (refinamento, [L1], completude, orçamento) | teoremas fechados; P2 opcional |

---

## 11. Adendo da revisão 2: sistemas E/OU sem rank, maestria multinível e núcleo TS denso

> Escrito numa segunda passada em 2026-11-18. **Generaliza** §3–§4 sem invalidar nada. O código TS desta seção foi executado com Node 24.12 e comparado com **força bruta**: enumeração por bitmask de todos os estados alcançáveis em 400 sistemas aleatórios com n ≤ 8, metade **com ciclos** entre alternativas, além de 600 grafos para o PK e o Kahn. Resultado: `ALL PROPERTIES PASSED`. Os trechos Lean continuam **não compilados**.

### 11.1 Estado = palavra de aprendizagem; plenitude; itens mortos

§3.1 define `Feasible K` **por fecho**: todo `q ∈ K` tem uma cláusula contida em `K`. Sem (R2), essa definição aceita *hanging states* (§3.2). A definição robusta é **por palavras**, como as *learning words* da KST e as *feasible words* dos antimatroides:

```
Reachable ∅
Reachable K  ∧  q ∉ K  ∧  ∃ C ∈ cl q, C ⊆ K   ⇒   Reachable (K ∪ {q})
```

Fatos (provas curtas abaixo; todos conferidos pelo autoteste):

1. **Toda** família `Reachable` de um sistema de cláusulas é um antimatroide, com ou sem rank.
   - Acessível por construção: tire o último item da palavra.
   - ∪-fechada: concatene a palavra de `K` com a de `L`, pulando os repetidos. Cada item de `L` continua habilitado, porque o conjunto anterior só cresceu.
2. **Com (R2), `Reachable K ⇔ Feasible K`**: a indução é a prova de §3.3(c). Logo §3 é o caso particular "com certificado de rank".
3. **Berendsohn (2025), *Optimal antimatroid sorting*, [arXiv 2507.13994](https://arxiv.org/abs/2507.13994)**:
   - define *monotone precedence systems* (MPS): cada item tem uma fórmula de precedência monótona (E/OU) sobre os demais, que pode estar em CNF ou DNF;
   - prova que os MPS caracterizam exatamente os **antimatroides plenos** (*full*: existe palavra básica com todos os itens);
   - dá uma estrutura de candidatos com tempo total linear.

   É a referência teórica do nosso "sistema de cláusulas" no caso geral. A forma DNF é a nossa lista de alternativas (*alternative precedence*, ou *rooted sets* na KST, Teor. 18–19 de [1511.06757](https://arxiv.org/abs/1511.06757)).
4. **Plenitude é a "ordem topológica E/OU".** O sistema é pleno sse `Reachable Q`.
   - O certificado é uma palavra `w` com todos os itens em que cada item tem uma cláusula contida no prefixo.
   - Checagem em O(n + Σ|C|) com `checkWordCertificate` (§11.5).
   - No caso só-E, palavra plena = ordem topológica.
5. **Itens mortos** (F2/F4): itens fora do maior estado alcançável `K_max`, que é a união de todos os estados.
   - `K_max` sai por **encadeamento para frente estilo Horn**: um contador `missing` por cláusula, uma fila e listas `watchers`. É `forwardChain`, em O(n + Σ|C|).
   - Certificado de "morto": a palavra de `K_max` mais a fronteira externa vazia em `K_max`. Ambos se conferem em tempo linear.
6. **Ciclo entre alternativas nem sempre mata.** Exemplo: `cl r = [∅]`, `cl a = [{b}, {r}]`, `cl b = [{a}]`. O grafo de dependência tem o ciclo `a ↔ b`, mas `r, a, b` é uma palavra plena. Daí os dois modos:
   - **Estrito (padrão recomendado).** Exige grafo de dependência acíclico, ≥ 1 cláusula por item, ids válidos e nenhuma auto-referência. *Teorema `full_of_acyclic`:* estrito ⇒ pleno e `Reachable = Feasible`, porque a ordem topológica é um rank. O modo mantém o certificado de rank e o PK.
   - **Relaxado (opcional).** Exige só plenitude. Aceita rotas circulares entre alternativas, desde que exista uma entrada. Perde o PK puro, porque o grafo pode ter ciclos, mas `validate` continua linear.
7. **Interior = `forwardChain` restrito a S.** `int(S)` é o maior estado alcançável contido em `S`: o encadeamento que só admite itens de `S`. É um **operador interior**: monótono (`S ⊆ T ⇒ int S ⊆ int T`), idempotente e deflacionário. Ele substitui o algoritmo "remover repetidamente" de §3.4, que **só é correto com (R2)**. Sem rank, a remoção pode parar num *hanging state*: com `S = {a, b}`, `cl a = [{b}]` e `cl b = [{a}]`, nada é removido e `{a, b}` não é alcançável.
8. **Fronteira.** Para `K` alcançável, `q ∈ fringe⁺(K) ⇔ Reachable (K ∪ {q})`. Vale também a **persistência**: se `K ⊆ L`, `q ∈ fringe⁺(K)` e `q ∉ L`, então `q ∈ fringe⁺(L)`, porque a habilitação é monótona. É [L2] sem rank. A fronteira só fica vazia antes de `K = Q` se houver itens mortos, e o modo estrito exclui isso.

**Lean (esboço, não compilado; usa `ClauseSys` de §7.2):**

```lean
namespace LH
variable {V : Type*} [DecidableEq V]

/-- Habilitado: alguma cláusula de `q` está contida em `K`. -/
def Enabled (S : ClauseSys V) (K : Finset V) (q : V) : Prop := ∃ C ∈ S.cl q, C ⊆ K

theorem Enabled.mono {S : ClauseSys V} {K L : Finset V} {q : V} (h : K ⊆ L) :
    Enabled S K q → Enabled S L q := fun ⟨C, hC, hCK⟩ => ⟨C, hC, hCK.trans h⟩

/-- Estados alcançáveis por palavras de aprendizagem (definição robusta, sem rank). -/
inductive Reachable (S : ClauseSys V) : Finset V → Prop
  | nil : Reachable S ∅
  | snoc {K : Finset V} {q : V} : Reachable S K → q ∈ S.items → q ∉ K → Enabled S K q →
      Reachable S (insert q K)

/-- ∪-fechamento por indução na palavra de `L`. -/
theorem Reachable.union {S : ClauseSys V} {K L : Finset V}
    (hK : Reachable S K) (hL : Reachable S L) : Reachable S (K ∪ L) := by
  induction hL with
  | nil => simpa using hK
  | @snoc L q _ hq _ hen ih =>
    rw [Finset.union_insert]                      -- conferir: s ∪ insert a t = insert a (s ∪ t)
    by_cases hqKL : q ∈ K ∪ L
    · simpa [Finset.insert_eq_of_mem hqKL] using ih
    · exact .snoc ih hq hqKL (hen.mono Finset.subset_union_right)

/-- Acessibilidade: o último item da palavra sai. -/
theorem Reachable.accessible {S : ClauseSys V} {K : Finset V}
    (h : Reachable S K) (hne : K.Nonempty) : ∃ q ∈ K, Reachable S (K.erase q) := by
  cases h with
  | nil => simp at hne
  | @snoc K q hK _ hqK _ =>
    exact ⟨q, Finset.mem_insert_self q K, by rwa [Finset.erase_insert hqK]⟩

/-- Checador executável: espelho de `checkWordCertificate` (TS). -/
def checkWordAux (S : ClauseSys V) [DecidablePred (· ∈ S.items)] : Finset V → List V → Bool
  | _, [] => true
  | K, q :: w =>
    decide (q ∈ S.items) && !decide (q ∈ K) && decide (∃ C ∈ S.cl q, C ⊆ K)
      && checkWordAux S (insert q K) w

theorem checkWordAux_sound (S : ClauseSys V) [DecidablePred (· ∈ S.items)] :
    ∀ (w : List V) {K : Finset V}, Reachable S K → checkWordAux S K w = true →
      Reachable S (K ∪ w.toFinset) := by
  sorry -- indução em `w`; cada passo é um `Reachable.snoc` seguido de reassociação do `∪`.

/-- Com rank (§3), as duas definições coincidem. -/
theorem reachable_iff_feasible {S : ClauseSys V} {r : V → ℕ} (hr : S.Ranked r) (K : Finset V) :
    Reachable S K ↔ S.Feasible K := by
  sorry -- (→) indução na palavra; (←) indução forte em |K| tirando o item de rank máximo.

/-- Modo estrito ⇒ pleno. -/
theorem full_of_ranked {S : ClauseSys V} {r : V → ℕ} (hr : S.Ranked r) : Reachable S S.items :=
  (reachable_iff_feasible hr _).2 (feasible_items hr)   -- `feasible_items` = LS-rank (a), §7.2
end LH
```

O nome `feasible_items` refere-se ao lema de §7.2 que prova LS-rank (a); ajuste ao nome usado lá. `Finset.union_insert`, `Finset.insert_eq_of_mem`, `Finset.subset_union_right` e `Finset.erase_insert` existem na Mathlib, mas a forma exata dos argumentos implícitos muda entre versões: confira com `#check`.

### 11.2 Maestria multinível: projeção por cortes

O app terá níveis de maestria `m : Q → {0..L}` (por exemplo "visto", "praticado", "fluente"). A evidência bruta pode violar a estrutura, por exemplo `m(v) = 3` com um pré-requisito em nível 1. Defina a **maestria confirmada**:

```
m̂(x) = max{ τ ∈ 1..L | x ∈ int({ y | m(y) ≥ τ }) }      (0 se nenhum)
```

Propriedades:

- **(i)** `m̂ ≤ m`: é deflacionária. *Testada.*
- **(ii)** Todo corte `{x | m̂(x) ≥ τ}` é um estado alcançável. Mais precisamente, ele é igual a `int({m ≥ τ})`, porque os cortes de `m` são encaixados e `int` é monótono. *Testada.*
- **(iii)** É idempotente. *Testada.*
- **(iv)** **Maximalidade**, provada no papel e ainda não incluída no autoteste. `m̂` é a **maior** função `g ≤ m` cujos cortes são todos alcançáveis. Prova: `{g ≥ τ}` é alcançável e está contido em `{m ≥ τ}`, logo está contido em `int({m ≥ τ}) = {m̂ ≥ τ}`.
- **(v)** É monótona em `m`, como corolário de (iv): se `m ≤ m'`, então `m̂ ≤ m ≤ m'` e `m̂` tem cortes alcançáveis, logo `m̂ ≤ m̂'`.

Uso:

- A UI mostra `m̂` como "confirmado".
- `m(x) > m̂(x)` sinaliza uma **lacuna de pré-requisito**, que vira candidata a sonda diagnóstica (gatilho 3 de §4.2).
- É a versão multinível do interior de §3.4 e convive com §3.5: aplica-se aos níveis *atingidos*, nunca à retenção FSRS.
- Custa `L` encadeamentos, ou seja O(L·(n + Σ|C|)).

**Pré-requisitos essenciais sem rank:** `Ess(x) = { y ≠ x | x ∉ int(Q∖{y}) }`, os itens por onde passa **toda** rota até `x`.

- Generaliza `mand(t)` de §3.6 para sistemas sem rank.
- Com rank, deve coincidir com a recursão de `mand`. Isso não foi testado: é uma propriedade candidata para o PBT.
- Custo O(n·(n + Σ|C|)) por domínio, aceitável para n ≤ 10⁴ só em lote noturno. Por alvo, basta rodar `int(Q∖{y})` para os `y` em `mand(t)` ∪ fronteira do plano.

**Prontidão graduada:** `ready(x) = max_{C ∈ cl x} min_{y ∈ C} m̂(y)`, com o `min` sobre `∅` igual a `L`.

- É monótona em `m̂`.
- `x` está "pronto no nível τ" sse `ready(x) ≥ τ`.
- A persistência da fronteira (§11.1, item 8) vale nível a nível.

### 11.3 Operadores: relaxar, acrescentar, apertar, substituir

Complementa a tabela de §4.

- **`relaxes_preserves`.** Diga que `S'` *relaxa* `S` se `items ⊆ items'` e, para todo `q` e toda `C ∈ cl q`, existe `C' ∈ cl' q` com `C' ⊆ C`. Então `Reachable S K ⇒ Reachable S' K`: **nenhum aluno perde progresso e não há migração**. A prova é por indução na palavra, trocando cada cláusula pela versão mais fraca. Cobre:
  - `addAlternative`;
  - remover um pré-requisito de uma cláusula;
  - promover um item a raiz;
  - `addItem` (o item novo não aparece nas cláusulas antigas).
- **`addItem_project` (extensão conservativa).** Acrescente itens novos `N` com cláusulas quaisquer, sem mudar as cláusulas dos itens antigos. Então:
  - `{K' ∩ Q | K' ∈ 𝒦'} = 𝒦` e `𝒦 ⊆ 𝒦'`;
  - painéis, XP e estatísticas da parte antiga não mudam.

  Prova: apague os itens de `N` da palavra de `K'`. Cada item antigo continua habilitado, porque suas cláusulas só citam itens antigos. É o espírito do Teorema 33 (projeção).
- **Apertar** (`addPrereq`, remover uma alternativa). `𝒦'` pode encolher, e a migração fica como em §3.4: inferência otimista marcada **ou** `int'(K)`. O teorema útil é `interior_greatest`: `int'(K)` é o maior estado novo contido em `K`, então nenhum progresso é descartado sem necessidade.
- **Refinamento por substituição.** É a alternativa ao refinamento-marco de §4.1.
  - O item `v` é **removido** e o bloco `W` entra no lugar.
  - As fontes de `W` herdam `cl v`, e cada dependente externo de `v` passa a exigir **todo** `W`, ou seja, `v` é trocado por `W` em cada cláusula.
  - Mapas: `lift K = (K∖{v}) ∪ W` se `v ∈ K`, senão `K`; `collapse K' = (K'∖W) ∪ {v}` se `W ⊆ K'`, senão `K'∖W`.
  - Teoremas: `lift` preserva `Reachable`; `collapse ∘ lift = id`; e a alcançabilidade entre itens antigos é preservada.
  - No caso só-E, o poset novo é a **soma lexicográfica** de `Q` com fibra `W` em `v` e singletons nas demais posições. Na Mathlib é `Σₗ` (`Mathlib/Order/Sigma.lean`), o que dá lemas prontos para as provas de ordem.
  - Desvantagem: o id `v` desaparece, e links, flashcards e histórico precisam ser remapeados. **Recomendo manter o marco de §4.1** e usar a substituição só se o produto exigir (pergunta em aberto Q4).

### 11.4 Horas no caso E/OU: cotas mais fortes

§3.6 já tem `LB` por `mand` e o argumento de NP-dificuldade. Acrescente a cota estilo *h_max*, da literatura de planejamento:

```
LB_K(x) = 0                                                se x ∈ K
LB_K(x) = lo(x) + min_{C ∈ cl x} max_{y ∈ C} LB_K(y)       caso contrário   (max sobre ∅ = 0)
```

- **Admissível.** Num estado alcançável `L ⊇ K` que contém `x`, existe uma palavra que começa pela de `K` (∪-fechamento). O prefixo antes de `x` é alcançável, contém alguma `C` inteira e não contém `x`. Por indução, o custo é `≥ lo(x) + LB_K(y)` para cada `y ∈ C`.
- **Por que somar.** Ela pega o que `mand` perde: com duas rotas disjuntas de 10 h, `mand(t) = {t}`, mas `LB_K(t) ≥ lo(t) + 10`. Reporte `LB = max(Σ_{mand(t)∖K} lo, LB_K(t))`.
- **Cálculo.** Com rank, numa passada em ordem topológica. Sem rank, por ponto fixo do tipo Knuth/Dijkstra generalizado: custos não negativos e `max` monótono.
- **Cota superior aditiva:** `UB_K(x) = hi(x) + min_C Σ_{y ∈ C} UB_K(y)`, com `UB_K(x) = 0` se `x ∈ K`. É válida porque a união dos planos escolhidos é um plano, e o custo de uma união é ≤ à soma (conta compartilhados em dobro).
- O intervalo `[LB, UB]` é o que a UI mostra como "faltam entre X e Y horas".

### 11.5 Núcleo TS com ids densos (testado)

É a segunda versão do núcleo, mais rápida que a de §6.2, com ids `0..n-1` e arrays tipados. O mapeamento `string ↔ número` fica numa tabela por domínio. Destino sugerido: `src/core/curriculum/core.ts`. Abaixo estão os trechos novos. `kahn`, que devolve ordem **ou** ciclo, `checkTopoCertificate`, `checkCycleCertificate` e `DynamicTopoOrder` (PK) seguem o desenho de §6.2.

```ts
export type Id = number;
export interface PrereqSystem {
	n: number;
	/** clauses[x][i]: ids que precisam ser TODOS conhecidos (E); x habilitado se ALGUMA cláusula vale (OU). Raiz: [[]]. */
	clauses: Id[][][];
}
export type Violation =
	| { kind: "bad-id"; item: Id; ref: Id }
	| { kind: "self-ref"; item: Id }
	| { kind: "no-clause"; item: Id }
	| { kind: "cycle"; cycle: Id[] }
	| { kind: "dead-items"; dead: Id[] };

/** Certificado de plenitude ("ordem topológica E/OU"). O(n + Σ|C|). Lean: checkWordAux_sound. */
export function checkWordCertificate(sys: PrereqSystem, word: readonly Id[], requireAll = true): boolean {
	if (requireAll && word.length !== sys.n) return false;
	const known = new Uint8Array(sys.n);
	for (const x of word) {
		if (!(x >= 0 && x < sys.n) || known[x]) return false;
		if (!sys.clauses[x]!.some((c) => c.every((y) => known[y] === 1))) return false;
		known[x] = 1;
	}
	return true;
}

/** Encadeamento para frente (Horn, contador por cláusula): maior estado alcançável + palavra.
 *  Com `allowed`, calcula o INTERIOR de S. O(n + Σ|C|). Lean: forwardChain_sound / _complete. */
export function forwardChain(sys: PrereqSystem, allowed?: (x: Id) => boolean): { word: Id[]; known: Uint8Array } {
	const n = sys.n, ok = (x: Id) => (allowed ? allowed(x) : true);
	const missing: Int32Array[] = [];
	const watchers: Array<Array<[Id, number]>> = Array.from({ length: n }, () => []);
	const known = new Uint8Array(n), queued = new Uint8Array(n), queue: Id[] = [];
	for (let x = 0; x < n; x++) {
		const cs = sys.clauses[x]!, m = new Int32Array(cs.length);
		cs.forEach((c, i) => {
			const uniq = [...new Set(c)];
			m[i] = uniq.length;
			for (const y of uniq) watchers[y]!.push([x, i]);
			if (uniq.length === 0 && ok(x) && !queued[x]) { queued[x] = 1; queue.push(x); }
		});
		missing.push(m);
	}
	const word: Id[] = [];
	for (let h = 0; h < queue.length; h++) {
		const y = queue[h]!;
		known[y] = 1; word.push(y);
		for (const [x, i] of watchers[y]!)
			if (--missing[x]![i]! === 0 && !queued[x] && ok(x)) { queued[x] = 1; queue.push(x); }
	}
	return { word, known };
}

/** Modo estrito: estrutura + grafo de dependência acíclico + nenhum item morto, com certificados. */
export function validate(sys: PrereqSystem):
	| { ok: true; topoOrder: Id[]; word: Id[] }
	| { ok: false; violations: Violation[] } {
	const v = structuralViolations(sys);          // no-clause, bad-id, self-ref
	if (v.length) return { ok: false, violations: v };
	const topo = kahn(sys.n, dependencyEdges(sys)); // y → x se y ∈ alguma cláusula de x
	const fc = forwardChain(sys);
	const violations: Violation[] = [];
	if (!topo.ok) violations.push({ kind: "cycle", cycle: topo.cycle });
	const dead = [...Array(sys.n).keys()].filter((x) => !fc.known[x]);
	if (dead.length) violations.push({ kind: "dead-items", dead });
	return topo.ok && !violations.length ? { ok: true, topoOrder: topo.order, word: fc.word } : { ok: false, violations };
}

/** Maestria confirmada (§11.2): cortes alcançáveis, m̂ ≤ m, idempotente, maior possível. */
export function projectMastery(sys: PrereqSystem, m: readonly number[], levels: number): number[] {
	const res = new Array<number>(sys.n).fill(0);
	for (let tau = 1; tau <= levels; tau++) {
		const { known } = forwardChain(sys, (x) => m[x]! >= tau);
		for (let x = 0; x < sys.n; x++) if (known[x]) res[x] = tau;
	}
	return res;
}
```

**Detalhe do `kahn` certificante.** Se sobram vértices, cada um tem um predecessor que também sobrou. Ande para trás por predecessores restantes até repetir um vértice e inverta o trecho: isso é um ciclo, em O(V + E). A mensagem para o agente segue o padrão `PlanTreeError` (§6.3).

**Para o modo relaxado:** troque, em `validate`, a exigência `topo.ok` por "nenhum item morto". Mantenha o `topoOrder` só quando existir.

### 11.6 Benchmarks da revisão 2

Ambiente: Node 24.12, esta máquina, `performance.now()`, uma execução por caso; os números são indicativos. Gerador "currículo profundo": cada item tem de 1 a 4 pré-requisitos entre os 60 anteriores numa ordem oculta, o que dá profundidade ~n/30.

| Caso | n = 1.500 (E = 3.654) | n = 5.000 (E = 12.173) | n = 20.000 (E = 48.674) |
|---|---|---|---|
| `validate` completo (estrutura + Kahn + `forwardChain`) | 5,5 ms | 14,5 ms | 33 ms |
| Conferir os certificados (topo + palavra) | 1,4 ms | 2,5 ms | 20,1 ms |
| PK: todas as arestas, em ordem aleatória, a partir de ordem inicial arbitrária | 36 ms | 442 ms | **9,6 s** (patológico) |
| PK semeado com a ordem do Kahn (carga em lote) | 1,1 ms | 3,3 ms | 8,4 ms |
| PK: 2.000 inserções locais após semear (ciclos rejeitados com testemunha) | ~2–3 µs cada | ~2–3 µs cada | ~2–3 µs cada |

Mil arestas "para trás" foram detectadas em ~0,5 ms no total.

**Conclusões:**

- **(1)** Revalidar o domínio inteiro a cada *patch* custa milissegundos. É o caminho mais simples e é o que eu recomendo para a fase 1.
- **(2)** O PK é otimização para edição interativa e precisa ser **semeado** com a ordem do Kahn na carga.
- **(3)** Os 57,7 ms de §6.2 vieram de outro gerador (DAG raso, com arestas globais). A diferença mostra que o custo do PK depende de quão longe a ordem corrente está da final, como prevê a cota Θ(|δ| log |δ| + ‖δ‖) de Pearce & Kelly.

### 11.7 fast-check: gerador, mapa propriedade ↔ teorema e testes por modelo

Gerador com ids densos que produz **também** sistemas cíclicos, mais um oráculo de força bruta:

```ts
// tests/curriculum-core.property.test.ts (esboço; exige devDependency fast-check@4.10.2)
import fc from "fast-check";
import type { PrereqSystem } from "../src/core/curriculum/core.ts";

export const arbSystem = (acyclic: boolean) =>
	fc.integer({ min: 1, max: 8 }).chain((n) =>
		fc.array(fc.array(fc.uniqueArray(fc.nat({ max: n - 1 }), { maxLength: 3 }), { minLength: 1, maxLength: 2 }),
			{ minLength: n, maxLength: n })
		.map((raw): PrereqSystem => ({
			n,
			clauses: raw.map((cs, x) => cs.map((c) => [...new Set(c.map((y) => (acyclic ? (x === 0 ? -1 : y % x) : y)))]
				.filter((y) => y >= 0 && y !== x))),
		})),
	);

/** Oráculo: BFS sobre bitmasks a partir de ∅ (definição de Reachable). n ≤ 8 ⇒ ≤ 256 estados. */
export function reachableFamily(sys: PrereqSystem): Set<number> {
	const fam = new Set([0]), q = [0];
	while (q.length) {
		const K = q.shift()!;
		for (let x = 0; x < sys.n; x++)
			if (!(K & (1 << x)) && sys.clauses[x]!.some((c) => c.every((y) => K & (1 << y)))) {
				const K2 = K | (1 << x);
				if (!fam.has(K2)) { fam.add(K2); q.push(K2); }
			}
	}
	return fam;
}
// fc.assert(fc.property(fc.boolean().chain(arbSystem), (sys) => { … }), { numRuns: 5000 })
```

**Mapa propriedade (TS) ↔ teorema (Lean) ↔ uso em runtime:**

| Propriedade fast-check | Teorema Lean | Runtime |
|---|---|---|
| a família é ∪-fechada | `Reachable.union` | justifica o interior e a concatenação de planos |
| todo estado ≠ ∅ tem um item removível | `Reachable.accessible` | desfazer o último passo |
| `forwardChain(sys).known` = união da família | `forwardChain_sound` / `forwardChain_complete` | itens mortos |
| `checkWordCertificate` aceita a palavra do `forwardChain` e rejeita palavras mutadas | `checkWordAux_sound` | certificado de plenitude gravado no ledger |
| `x ∈ outerFringe(K) ⇔ K ∪ {x}` na família | `mem_outerFringe_iff` | próximo passo |
| fronteira persiste para `K ⊆ L` | `fringe_persist` | gamificação sem "desbloquear e rebloquear" |
| `forwardChain(sys, ∈S)` = maior membro da família ⊆ S | `interior_greatest` | migração conservadora |
| `projectMastery`: `≤ m`, cortes na família, idempotente, maior | `proj_le`, `proj_cut`, `proj_idem`, `proj_greatest` | maestria confirmada |
| acíclico ⇒ `Q` na família; `validate.ok ⇔ acíclico ∧ pleno` | `full_of_ranked` | modo estrito |
| relaxar mantém todos os estados | `relaxes_preserves` | `addAlternative` sem migração |
| `addItem`: projeção da família nova = família antiga | `addItem_project` | estatísticas estáveis |
| PK: ordem válida após cada inserção; rejeição ⇔ `y ⇝ x`; testemunha é ciclo | `acyclic_addEdge_iff`, `acyclic_of_ranking` | `DynamicTopoOrder.addEdge` |

**Teste por modelo das operações de expansão** (`fc.commands`). O modelo é o sistema pequeno mais o estado do aluno em bitmask; o "real" é o `applyPatch` + migração de §6.3:

```ts
type Model = { sys: PrereqSystem; K: number };
class AddAlternativeCmd implements fc.Command<Model, DomainStore> {
	constructor(readonly x: number, readonly clause: number[]) {}
	check = (m: Readonly<Model>) => m.sys.n > 0;
	run(m: Model, real: DomainStore) {
		const x = this.x % m.sys.n;
		const clause = [...new Set(this.clause.map((y) => y % m.sys.n))].filter((y) => y !== x);
		const before = real.learnerState();
		const res = real.apply([{ op: "addAlternative", item: x, clause }]);
		if (!res.ok) { assert.deepEqual(real.learnerState(), before); return; } // rejeição não muda nada
		m.sys = real.snapshot();
		assert.deepEqual(real.learnerState(), before);                    // relaxes_preserves
		assert.ok(checkWordCertificate(m.sys, res.certificate.word));     // continua pleno
		assert.ok(reachableFamily(m.sys).has(real.learnerMask()));        // estado continua válido
	}
	toString = () => `addAlternative(${this.x}, [${this.clause}])`;
}
// Idem: AddItemCmd (projeção), AddPrereqCmd (estado migrado ∈ família e ⊆ antigo ∪ inferidos),
// RefineCmd (lift preserva; projeção em Q = família antiga), RetireCmd, LearnCmd (só itens da fronteira).
// fc.assert(fc.property(arbSystem(true), fc.commands([...], { size: "+1" }), (sys, cmds) =>
//   fc.modelRun(() => ({ model: { sys, K: 0 }, real: DomainStore.from(sys) }), cmds)));
```

Para reproduzir uma falha, o fast-check imprime `seed` e `path`. Grave-os em `tests/fixtures/curriculum-drt/` e passe-os de volta em `fc.assert(…, { seed, path })`. Junto com o DRT de §8, isso forma o corpus de regressão.

### 11.8 Ecossistema Lean: complementos da revisão 2

- **`lake comparator` / `lake check`** (core desde a v4.35.0). Ver §5.4. Só Linux, por causa do `landrun`. Use na CI Ubuntu como um passo além do `leanchecker`.
- **[Plausible](https://github.com/leanprover-community/plausible)** (Apache-2.0): testes de propriedade **dentro** do Lean. A tática `plausible` procura contraexemplos de um enunciado antes de se tentar a prova. Serve para pegar enunciados errados escritos à mão, como uma hipótese esquecida em `relaxes_preserves`, em instâncias pequenas `Fin n`. Enunciados sobre `Finset` podem precisar de instâncias `SampleableExt` próprias.
- **[Lean Beam](https://github.com/leanprover/lean-beam)** (Apache-2.0): CLI e **servidor MCP** que deixam um agente dirigir o servidor Lean, útil para preencher `sorry` com Claude Code.
  - O elan v4.4.0 instala os proxies `lean-beam` e `lean-beam-mcp`.
  - No Windows, registre `%USERPROFILE%\.elan\bin\lean-beam-mcp.exe` no cliente MCP.
  - O próprio projeto declara o suporte nativo a Windows x86_64 como **experimental**.
- **Guéneau et al. (ITP 2019), mais detalhes.**
  - Código em [gitlab.inria.fr/agueneau/incremental-cycles](https://gitlab.inria.fr/agueneau/incremental-cycles).
  - O BFGT verificado foi integrado ao **Dune** (PR #1955), com ganho de até 7× relatado.
  - Uma variante não verificada entrou no verificador de universos do Coq: a checagem da MathComp caiu de 25 para 18 minutos.

  Confirma que vale a pena ter um algoritmo incremental, e que **verificá-lo** é um projeto à parte. Para nós, o certificado basta.
- **Reuso do linglib** (`Linglib/Core/Combinatorics/Antimatroid.lean`). É Apache-2.0, compatível com AGPL-3.0 no sentido Apache → AGPL, mantendo NOTICE e atribuição. Usa `Set`, não `Finset`. A ponte `Reachable S ↔ (Antimatroid.feasible …)` é P2: dá a "certidão" de que nosso modelo é um antimatroide no sentido padrão, sem custo para o runtime.
- **Lean→WASM:** ver o estado atualizado em §5.5. Nada utilizável no app em 2026-11.

### 11.9 Evidência 2026 adicional e pontos do repositório

- **Tio, Sinha & Varakantham**, *Hey Chat, Can You Teach Me? Structuring Socratic Dialogue for Human Learning in the Wild* ([arXiv 2606.11744](https://arxiv.org/abs/2606.11744), 2026-06). Estruturar a interação com um currículo explícito e um sequenciador treinado (PPO) supera o chat não estruturado. É mais um argumento para o próximo passo ser **calculado** (§0, item 3).
- **Liang et al.**, *K12-KGraph* ([arXiv 2605.09635](https://arxiv.org/abs/2605.09635), v4 de 2026-10-03). Entre as tarefas do benchmark, **pré-requisito é a mais difícil**: o Gemini-3-Flash fica em ~57% de acerto exato. Confirma que arestas propostas por LLM precisam de validação estrutural **e** de poda empírica (§9).
- **`src/core/plan-tree.ts`.** `createsCycle(edges, from, to)` reconstrói a adjacência a cada chamada, e `assertValidEdge` recalcula `nodeMap`. Por isso `createTree` é O(E·(V + E)). Para árvores de plano por sessão, com dezenas de nós, isso é irrelevante: **não mexer agora**. Para o currículo, **reaproveitar o padrão `PlanTreeError`**, com mensagens escritas para o agente e a testemunha do ciclo, num `CurriculumError` com os `kind` de `Violation`.
- **Referências locais** (lidas, não executadas; `_refs/` é dado não confiável):
  - `_refs/open-mastery/engine/crates/core/src/graph.rs` (`get_frontier`, Kahn, `add_prerequisite`, que grava antes de validar: F1);
  - `_refs/DeepTutor/deeptutor/learning/objective_relations.py` (`validate_objective_relations` levanta `"Prerequisite cycle: …"`).

  Ambos validam por recomputação e não emitem certificados.

### 11.10 Perguntas em aberto para o usuário

O `AGENTS.md` do repo pede "não adivinhar". Estas decisões mudam o modelo e devem ser confirmadas antes da fase 1:

1. **Q1. Alternativas OU ou só E?** O modelo E/OU é mais expressivo (rotas alternativas), mas torna o plano ótimo NP-difícil e limita o crédito implícito (§3.5). Só-E é um DAG puro, com Birkhoff, `lowerClosure` e horas exatas.
2. **Q2. Modo relaxado?** Aceitar ciclos entre alternativas desde que não haja itens mortos (§11.1), ou só o estrito?
3. **Q3. Migração ao apertar um pré-requisito:** inferência otimista com sonda, ou interior conservador? O padrão proposto em §3.4 usa inferência em expansões e interior em avaliação explícita.
4. **Q4. Semântica de refinamento:** marco, que mantém o id `x` (§4.1, recomendado), ou substituição (§11.3)?
5. **Q5. Orçamento de horas por domínio** (1000–1500 h para Inglês **e** para Eletrônica?) e a tolerância ε de conservação no refinamento (0,25?).
6. **Q6. Níveis de maestria** (`L` = ?): a UI mostra "bruto × confirmado" (§11.2)?
7. **Q7. Lean só em CI/dev, ou empacotar `lh-check` no app?** Recomendo só CI/dev.
8. **Q8. Dependências:** autorizar `fast-check@4.10.2` como devDependency e `cross-env` para o script de teste no Windows. Nesta sessão nada foi instalado.

### 11.11 Delta no escopo Lean e no roteiro

- **P0 ganha:** `Reachable`, `Reachable.union`, `Reachable.accessible`, `fringe_persist` e `checkWordAux_sound`. Todos têm provas curtas, e o último é o que dá valor ao certificado gravado no ledger.
- **P1 ganha:** `reachable_iff_feasible`, `full_of_ranked`, `forwardChain_sound`/`forwardChain_complete` (sobre um modelo funcional de `forwardChain` em `List`), `interior_greatest`, `proj_*`, `relaxes_preserves` e `addItem_project`.
- **P2 ganha:** a ponte com o linglib e a admissibilidade de `LB_K` (§11.4).
- **Fase 1 do roteiro (§10):** usar o núcleo denso (§11.5) e o gerador `arbSystem` (§11.7) desde o início.
- **Fase 2:** os comandos `fc.commands` de expansão.

---

## 12. Referências

**KST e learning spaces**
- Doignon, J.-P. & Falmagne, J.-C. *Knowledge Spaces and Learning Spaces*. [arXiv 1511.06757](https://arxiv.org/abs/1511.06757). Definições, Teor. 7, 8, 10, 18, 19, 21, 33, 41, 43; ALEKS 0,93; QUERY 99%.
- Falmagne, J.-C. *Projections of a learning space*. [arXiv 0803.0575](https://arxiv.org/abs/0803.0575).
- Eppstein, D. *Learning Sequences*. [arXiv 0803.4030](https://arxiv.org/abs/0803.4030).
- Falmagne & Doignon, *Learning Spaces*, Springer 2011. Korte, Lovász & Schrader, *Greedoids*, Springer 1991. Cosyn & Uzun, *J. Math. Psych.* 53 (2009). Birkhoff, *Rings of sets*, Duke Math. J. 3 (1937). Todos citados via o capítulo acima.
- Sadallah, M. *Exploration Space Theory* (2026). [arXiv 2603.06624](https://arxiv.org/abs/2603.06624).
- Steiner & Hochweber, *Benchmarking LLM Next-Step Recommendations with KST* (2026). [arXiv 2611.13667](https://arxiv.org/abs/2611.13667).
- Cui, Do & Sachan, *Do LLMs Exhibit Coherent Knowledge Structures…?* (2026). [arXiv 2609.05245](https://arxiv.org/abs/2609.05245). Venue não confirmado.
- Liu et al., *PersonaPath* (2026). [arXiv 2609.18861](https://arxiv.org/abs/2609.18861).

**Algoritmos incrementais e certificados**
- Pearce & Kelly, ACM JEA 11 (2006/2007), DOI 10.1145/1187436.1210590. [Página do autor](https://whileydave.com/publications/pk07_jea/). [Código BSD-3](https://github.com/DavePearce/DynamicTopologicalSort).
- Smith, *Robust Topological Orderings for Directed Graphs*. [arXiv 2306.05475](https://arxiv.org/abs/2306.05475).
- Bender, Fineman, Gilbert & Tarjan. [arXiv 1112.0784](https://arxiv.org/abs/1112.0784).
- Bhattacharya & Kulkarni. [arXiv 1810.03491](https://arxiv.org/abs/1810.03491).
- Chen, Kyng, Liu, Meierhans & Probst Gutenberg, *Almost-Linear Time Algorithms for Incremental Graphs*. [arXiv 2311.18295](https://arxiv.org/abs/2311.18295).
- McCauley, Moseley, Niaparast & Singh, *Incremental Topological Ordering and Cycle Detection with Predictions*. [arXiv 2402.11028](https://arxiv.org/abs/2402.11028).
- Guéneau, Jourdan, Charguéraud & Pottier, *Formal Proof and Analysis of an Incremental Cycle Detection Algorithm*, ITP 2019. [DOI](https://doi.org/10.4230/LIPIcs.ITP.2019.18).
- Chen, Cohen, Lévy, Merz & Théry, *Formal Proofs of Tarjan's Algorithm in Why3, Coq, and Isabelle*. [arXiv 1810.11979](https://arxiv.org/abs/1810.11979).
- McConnell, Mehlhorn, Näher & Schweitzer, *Certifying algorithms*, Computer Science Review 5(2), 2011. Citado de memória; não reverificado.

**Lean 4, Mathlib e ecossistema**
- [Lean 4 releases](https://github.com/leanprover/lean4/releases): v4.36.0 em 2026-11-16.
- [Mathlib4](https://github.com/leanprover-community/mathlib4), tag v4.36.0. Arquivos citados: `Combinatorics/Digraph/Basic.lean`, `Order/UpperLower/Closure.lean`, `Order/Birkhoff.lean`, `Order/Extension/Linear.lean`, `Order/FixedPoints.lean`, `Combinatorics/Matroid/`.
- [CSLib](https://github.com/leanprover/cslib) e [cslib-frontier](https://github.com/cslib-community/cslib-frontier) (`CslibFrontier/Algorithms/Lean/DFS/TopologicalSort.lean`), ambos Apache-2.0.
- [atlas-lean](https://github.com/facebookresearch/atlas-lean) (`CSLibExt/Algorithms/Lean/Graph/TopologicalSort.lean`): Apache-2.0 com restrição de uso para ML.
- [linglib](https://github.com/linglib-community/linglib) (`Linglib/Core/Combinatorics/Antimatroid.lean`), Apache-2.0.
- [Lean reference — Validating Proofs](https://lean-lang.org/doc/reference/latest/ValidatingProofs/).
- [Instalação manual (Windows)](https://lean-lang.org/install/manual/).
- [lean-action](https://github.com/leanprover/lean-action), v1.7.1.
- Szeider, [PBLean, arXiv 2602.08692](https://arxiv.org/abs/2602.08692), e [lrat-catcher, arXiv 2607.00815](https://arxiv.org/abs/2607.00815).
- Lean→WASM comunitário: [xeus-lean](https://github.com/Verilean/xeus-lean), lasm e lean2wasm (não oficiais).

**Verification-guided development e testes**
- Disselkoen et al., *How We Built Cedar: A Verification-Guided Approach*, FSE Companion 2024. [arXiv 2407.01688](https://arxiv.org/abs/2407.01688). [cedar-spec](https://github.com/cedar-policy/cedar-spec), Apache-2.0.
- [fast-check: model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/). npm `fast-check@4.10.2` (MIT, 2026-09-19).
- Alternativas JS verificadas no npm: `graphology-dag@0.4.1` e `@dagrejs/graphlib@4.0.7`. Ambas fazem detecção de ciclo por recomputação, não incremental.

**BKT**
- Baker, Corbett & Aleven, *More Accurate Student Modeling Through Contextual Estimation of Slip and Guess Probabilities in BKT*, ITS 2008, LNCS 5091:406–415. [DOI](https://link.springer.com/doi/10.1007/978-3-540-69132-7_44).

**Documentos internos relacionados**
- `docs/research/ref-open-mastery.md`: bugs de validação, schema e `encompasses`.
- `docs/research/ref-bloomtutor-core.md`: schema `kn_*` com arestas tipadas e "candidatos numerados".
- `src/core/plan-tree.ts`: padrão de erros legíveis pelo agente; `createsCycle` ingênuo.
- `src/core/contracts/graph.ts` e `src/core/graph.ts`: ledgers JSONL append-only.

**Adicionadas na revisão 2**
- Berendsohn, B. A. *Optimal antimatroid sorting* (2025). [arXiv 2507.13994](https://arxiv.org/abs/2507.13994). MPS ⇔ antimatroides plenos; fórmulas de precedência; estrutura de candidatos linear.
- Streit & Garg, sistemas de pré-requisitos matroidais (2026). [arXiv 2607.08151](https://arxiv.org/abs/2607.08151). É o contraponto: estrutura de matroide, não de antimatroide.
- Tio, Sinha & Varakantham, *Hey Chat, Can You Teach Me? Structuring Socratic Dialogue for Human Learning in the Wild* (2026). [arXiv 2606.11744](https://arxiv.org/abs/2606.11744).
- Liang et al., *K12-KGraph: A Curriculum-Aligned Knowledge Graph for Benchmarking and Training Educational LLMs* (2026). [arXiv 2605.09635](https://arxiv.org/abs/2605.09635).
- Haeupler, Kavitha, Mathew, Sen & Tarjan, *Incremental cycle detection, topological ordering, and strong component maintenance*. [arXiv 1105.2397](https://arxiv.org/abs/1105.2397); ver também [arXiv 0803.0792](https://arxiv.org/abs/0803.0792). Cota O(m^{3/2}) e limite inferior Ω(n√m) para algoritmos locais.
- Cohen, Fiat, Kaplan & Roditty. [arXiv 1310.8381](https://arxiv.org/abs/1310.8381).
- Guéneau et al., código Coq/CFML: [gitlab.inria.fr/agueneau/incremental-cycles](https://gitlab.inria.fr/agueneau/incremental-cycles). Usado no Dune (PR #1955).
- Lean: [elan releases](https://github.com/leanprover/elan/releases) (v4.4.0, 2026-11-18); Lean `v4.37.0-rc1` (2026-11-18); [leanprover/comparator](https://github.com/leanprover/comparator) (descontinuado → `lake comparator`/`lake check`, v4.35.0); [landrun](https://github.com/Zouuup/landrun); [Plausible](https://github.com/leanprover-community/plausible); [Lean Beam](https://github.com/leanprover/lean-beam).
- Lean→WASM: [ranvier-labs/lean-wasm-examples](https://github.com/ranvier-labs/lean-wasm-examples), [kshitijl/lean-wasm](https://github.com/kshitijl/lean-wasm), [cronch-ai/lean-wasm](https://github.com/cronch-ai/lean-wasm).
- Mathlib, além dos citados: `Mathlib/Order/Sigma.lean` (`Σₗ`, soma lexicográfica), `Finite.wellFounded_of_trans_of_irrefl` (`Mathlib/Data/Fintype/Card.lean`), `Finset.card_lt_card` (`Mathlib/Data/Finset/Card.lean`).
- Implementações KST de referência (MIT): [gonzalezulises/kst-course-engine](https://github.com/gonzalezulises/kst-course-engine) e [vanderbilt-data-science/knowledge-spaces](https://github.com/vanderbilt-data-science/knowledge-spaces); pacote R `kst` (espelho [cran/kst](https://github.com/cran/kst)).
- Autoteste desta revisão, fora do repo e temporário: `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\ts\` (`curriculum-core.ts`, `selftest.ts`, `bench.ts`, `bench2.ts`).
