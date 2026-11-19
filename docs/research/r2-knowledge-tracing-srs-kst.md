# R2 — Modelagem do aluno e agendamento: estado da arte e proposta de *learner model* por nó do grafo

> Pesquisa `r-kt-srs` · data de referência: **2026-11-18** · escopo: FSRS/SM-2/HLR, knowledge tracing (BKT → LLM-KT), IRT/Elo, Knowledge Space Theory (ALEKS), propagação em grafos de pré-requisitos (FIRe/Math Academy), diagnóstico de pontos fracos (CDMs), seleção do próximo nó (fronteira, bandits, RL) e **proposta concreta em TypeScript, local e barata**.
>
> Convenção: "(proposta)" marca desenho nosso, que não vem da literatura. Tudo que não estiver marcado vem de fonte primária citada na seção 12. Números de benchmark vêm dos READMEs e papers lidos nesta pesquisa.

---

## 0. TL;DR: decisões recomendadas

1. **Memória por nó:** usar **FSRS** via `ts-fsrs` (MIT). A **v6.0.0** (2026-10-28) traz **FSRS-7** como default do `DefaultScheduler`: 34 pesos, dois traços de estabilidade (*slow/fast*) e **intervalos fracionários**, o que permite checagens no mesmo dia. A lib exige Node ≥ 24, e o Electron 44 do learnharness embute Node 24.22.x, então é compatível. O FSRS-7 com **parâmetros default** (0 treinados) tem log loss 0.3620 no srs-benchmark, praticamente igual ao FSRS-4.5 **otimizado** (0.3625). Isso o torna um bom *cold start* para um usuário único.
2. **Aquisição/maestria por nó:** usar um **BKT acoplado ao FSRS** (proposta). O latente "sabe agora" é $L \wedge M$, onde $L$ é "adquiriu" (BKT) e $M \mid L \sim \text{Bernoulli}(R_{FSRS}(t))$. As emissões são ordinais (nota 0–3 dada pelo LLM) e incluem o ruído do avaliador. É barato, interpretável e tem forma fechada.
3. **Estrutura:** tratar o DAG de pré-requisitos como uma **estrutura de conhecimento KST**. Os estados são *down-sets* (ideais de ordem), e a família de down-sets de uma ordem parcial é um *learning space* (antimatroide). A **fronteira externa** (*outer fringe*) é exatamente "o que o aluno está pronto para aprender". No ALEKS, a taxa de sucesso ao aprender um item escolhido da fronteira externa é **≈0.93**. A consistência probabilística é imposta por uma **projeção** sobre as restrições $P(L_b) \le P(L_a) + \varepsilon$ para cada aresta $a \to b$, que são limites de Fréchet.
4. **Propagação:** adotar o **FIRe** (*Fractional Implicit Repetition*, Math Academy/HSRS) em um **grafo de "englobamento"** (*encompassing*) separado do grafo de pré-requisitos. Sucesso em um nó avançado dá **crédito fracionário** às revisões dos nós englobados, implementado como **interpolação do estado FSRS** (proposta). Falha propaga **penalidade** para cima e **culpa** (*blame*) para baixo. O desconto de "revisão cedo demais" sai de graça do FSRS, porque o ganho de estabilidade tende a 0 quando $R \to 1$.
5. **Pontos fracos:** usar **atribuição de culpa estilo DINA** (*mean-field*) quando um item exige vários nós. Somar um **catálogo de misconceptions por nó** com posteriores Beta e um **acumulador de culpa** com decaimento. O LLM entra como **sensor** (nota por rubrica, nós envolvidos, misconception), nunca como preditor.
6. **LLM não deve ser o *knowledge tracer*.** No estudo da Eedi (2026), DKT/SAKT tiveram 71.8–72.7% de acurácia contra 58.6–66.5% de GPT-4o-mini, Gemini-2.5-flash-lite e Qwen2.5-7B. Vários LLMs ficaram abaixo do *baseline* trivial de viés do item (66.5%) e foram de 600 a 12.000× mais caros. No FoundationalASSIST (2026), os modelos testados mal superam o baseline trivial. O papel produtivo do LLM é anotar: matriz Q, dificuldade a priori, correção por rubrica e misconceptions.
7. **"O que estudar agora":** uma política gulosa com orçamento, em quatro camadas. (i) Revisões vencidas, priorizadas por $I_k(1-R_k)$ (inspirado no MEMORIZE), com **compressão de repetições** via nós-veículo que cobrem várias revisões. (ii) Nós novos da **fronteira externa**, ponderados por prontidão × valor de desbloqueio rumo à meta. (iii) Remediação de nós fracos. (iv) Sondas de nós "inferidos, não verificados". Um controlador limita os novos por dia pela carga projetada de revisões. **Bandit** (Thompson/ZPDES) entra só na escolha do *tipo de recurso* (aula IA, capítulo de livro, vídeo) e da dificuldade, não no currículo.
8. **Parâmetros:** começar com os defaults (tabela na §9.11), registrar cada predição antes de observar o resultado e calibrar mensalmente: EM para emissões/aprendizagem e o otimizador FSRS (`@open-spaced-repetition/binding`, WASM, beta) por domínio.

---

## 1. O nosso problema, sob a ótica de *learner modeling*

| Característica do app | Consequência para o modelo |
|---|---|
| **Um único aluno**, local, sem dados de população | Modelos que precisam de população (DKT/AKT/simpleKT/RWKV) **não se aplicam** sem pré-treino. Precisamos de modelos Bayesianos por nó com **priors** (FSRS default treinado em ~10k usuários do Anki, estrutura do grafo, dificuldade estimada pelo LLM). |
| Grafo **massivo** (~1000–1500 h por domínio, milhares de nós) e **expansão procedural** por LLM | Atualizações precisam ser **locais** (k-hop) e o estado precisa sobreviver à inserção de nós e arestas. É necessário um prior para nós novos derivado dos vizinhos. |
| Exercícios **gerados na hora** por LLM, de uso único | Calibração de dificuldade por item individual (Elo/IRT por item) não acumula dados. É preciso calibrar por **família de itens** (nó × nível) e tratar a dificuldade do LLM como prior fraco (r≈0.4, §3.3). |
| Respostas abertas avaliadas por LLM | A observação é **ruidosa** (QWK LLM–humano moderado; decoder-only fica em média 0.37 de QWK atrás de encoders, segundo Hardy 2026). A emissão precisa modelar o avaliador. |
| Didática não cansativa (sem despejar perguntas logo após a explicação) | **Checagens imediatas valem pouco como evidência** (fluência de curto prazo). Evidência forte vem de **recuperação atrasada**, o que encaixa no FSRS-7 com intervalos fracionários. |
| Sessões separadas por domínio | Um *learner model* **por domínio** (store isolado) mais um perfil global leve (velocidade, orçamento diário). |
| Fork do learnharness | Já existem `GraphNode`/`GraphEdge`/`GraphChain` (`src/core/contracts/graph.ts`), problemas de prática com `target: string[]` e `mode: recall|discrimination|composition` (`src/core/practice-problems.ts`, `src/agent/tools/practice.ts`, o "mastery-trace contract"). O plano de flashcards (`docs/flashcards-vision.md`) fixa **FSRS-6** portado de `ts-fsrs@5.2.3` por proposição. |

---

## 2. Repetição espaçada: SM-2 → HLR → FSRS-7

### 2.1 SM-2 (SuperMemo, 1987): referência histórica

Nota $q\in\{0..5\}$; *easiness factor* inicial $EF=2.5$:

$$EF' = \max\big(1.3,\; EF + 0.1 - (5-q)\,(0.08 + (5-q)\cdot 0.02)\big)$$

$$I(1)=1,\quad I(2)=6,\quad I(n)=I(n-1)\cdot EF;\quad q<3 \Rightarrow \text{recomeça as repetições}$$

O SM-2 não estima probabilidade de recordação, então não serve para alimentar um modelo probabilístico. Fica de fora.

### 2.2 HLR (Duolingo, Settles & Meeder, ACL 2016)

$$p = 2^{-\Delta/h},\qquad \hat h_\Theta = 2^{\Theta\cdot x}$$

$x$ = features (contagens de acertos/erros, lexema...). Treinado por regressão sobre $(p, h)$. No srs-benchmark atual o **HLR fica muito atrás** (log loss 0.4694 contra 0.3460 do FSRS-6 e 0.3370 do FSRS-7 com *recency*).

### 2.3 FSRS: modelo DSR (Difficulty, Stability, Retrievability)

Histórico, segundo o README do srs-benchmark: v1/v2 (experimentais), **v3** (primeira versão pública), **v4** (primeira integrada ao Anki), **4.5** (muda a forma da curva), **5** (usa revisões do mesmo dia no treino), **6** (fórmula melhor para o mesmo dia e decaimento **treinável**, 21 parâmetros) e **7** (dois traços de estabilidade, intervalos **fracionários**, 34 parâmetros, curva com 8 parâmetros otimizáveis).

#### FSRS-6 (fórmulas: docs do ts-fsrs e wiki *The Algorithm*)

Curva de esquecimento com decaimento treinável $d=w_{20}$, normalizada para $R(S,S)=0.9$:

$$F = 0.9^{-1/d}-1,\qquad R(t,S)=\left(1+F\frac{t}{S}\right)^{-d},\qquad I(r,S)=\frac{S}{F}\left(r^{-1/d}-1\right)$$

Inicialização: $S_0(G)=w_{G-1}$; $D_0(G)=w_4-e^{w_5(G-1)}+1$ (com clamp em $[1,10]$).

Dificuldade (com *linear damping* e reversão à média):

$$\Delta D=-w_6(G-3),\quad D^*=D+\Delta D\frac{10-D}{9},\quad D'=w_7D_0(4)+(1-w_7)D^*$$

Estabilidade após acerto ($G\in\{2,3,4\}$) e após lapso ($G=1$):

$$S_r=S\left[1+e^{w_8}(11-D)S^{-w_9}\left(e^{w_{10}(1-R)}-1\right)H_G E_G\right]$$

$$S_f=\min\left(w_{11}D^{-w_{12}}\left((S+1)^{w_{13}}-1\right)e^{w_{14}(1-R)},\;S\right)$$

($H_G=w_{15}$ se Hard, $E_G=w_{16}$ se Easy.) Revisão no mesmo dia: $S'=S\cdot e^{w_{17}(G-3+w_{18})}\cdot S^{-w_{19}}$, garantindo SInc ≥ 1 para $G\ge2$.

**Propriedade usada na nossa proposta (§9.6):** o termo $e^{w_{10}(1-R)}-1 \to 0$ quando $R\to1$. Revisar algo que ainda está fresco quase não aumenta $S$. Esse é o "desconto de repetição precoce" que o FIRe impõe manualmente.

Pesos default do FSRS-6 (wiki):
`[0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]`

#### FSRS-7 (fórmulas: `ts-fsrs/guide/model/fsrs-7`)

Estado: $(S_s, S_f, D)$, as estabilidades *slow* e *fast* em dias, $D\in[1,10]$, $t$ em dias **fracionários**.

- Inicial: $S_{s,0}=w_{G-1}$, $S_{f,0}=0.8\,S_{s,0}$; $D_0$ igual ao FSRS-6.
- Traço rápido: $d_f=-\mathrm{clamp}(w_{23}S_f^{\,w_{33}-0.3},0.01,0.95)$, $F_f=\exp(\min(\ln w_{25}/d_f,60))-1$, $R_f(t)=(1+F_f t/S_f)^{d_f}$.
- Traço lento: $d_s=-\mathrm{clamp}(w_{24},0.01,0.95)$, $F_s=(w_{26}^{1/d_s}-1)e^{(D-5)(w_{32}-0.3)}$, $R_s(t)=(1+F_s t/S_s)^{d_s}$.
- Mistura: $a_f=w_{27}S_f^{-w_{29}}$, $a_s=w_{28}S_s^{w_{30}}e^{(D-5)(w_{31}-0.5)}$.

$$R(t)=\frac{a_fR_f(t)+a_sR_s(t)}{a_f+a_s}(1-2\varepsilon)+\varepsilon,\quad \varepsilon=10^{-5}$$

- Atualização de cada traço (offset $k=7$ para o lento, usando o $R$ misto; $k=15$ para o rápido, usando $R_f$):
  $U_k(x,q,G)=x\left[1+e^{w_k-1.5}(11-D)x^{-w_{k+1}}(e^{(1-q)w_{k+2}}-1)H E\right]$, lapso $L_k(x,q)=\min\left(x,\,w_{k+3}((x+1)^{w_{k+4}}-1)e^{(1-q)w_{k+5}}\right)$, $T_k=L_k$ se Again, senão $\max(L_k,U_k)$. Em Again, $S'_f\le0.8\,\tilde S_s$.
- Dificuldade: $\Delta D=-w_6(G-3)\cdot(R+0.1 \text{ se } G=1)$, $D'=C_D(0.01D_0(4)+0.99(D+\frac{10-D}{9}\Delta D))$.
- Intervalo: resolve $R(I)=r$ numericamente (Newton em log-tempo com fallback de bissecção).

> ⚠️ Os pesos default do FSRS-7 **diferem** entre o README do srs-benchmark e a wiki (versões de treino diferentes). Use sempre a constante `FSRS7_DEFAULT_WEIGHTS` exportada por `ts-fsrs/models/fsrs-7`.

#### Benchmark atual (open-spaced-repetition/srs-benchmark, dataset `anki-revlogs-10k`: 9.999 coleções, ~350M revisões avaliadas, TimeSeriesSplit)

Linhas selecionadas da tabela "sem revisões do mesmo dia" (média ± IC99%):

| Algoritmo | Params | Log Loss ↓ | RMSE(bins) ↓ | AUC ↑ |
|---|---:|---:|---:|---:|
| RWKV-Instant (pré-treinado em 5k usuários, muitas features) | 2.76M | **0.2773** | 0.0250 | **0.8329** |
| GRU (Reptile) | 503 | 0.3328 | 0.0549 | 0.7324 |
| **FSRS-7 recency** | 34 | 0.3370 | 0.0593 | 0.7220 |
| Logistic Regression (34 features) | 34 | 0.3393 | 0.0604 | 0.7108 |
| FSRS-7 | 34 | 0.3401 | 0.0634 | 0.7167 |
| SBD (7 params, L-BFGS) | 7 | 0.3410 | 0.0602 | 0.7152 |
| FSRS-6 | 21 | 0.3460 | 0.0653 | 0.7034 |
| FSRS-5 | 19 | 0.3561 | 0.0742 | 0.7010 |
| **FSRS-7 default param.** | **0** | 0.3620 | 0.0910 | 0.7029 |
| FSRS-4.5 | 17 | 0.3625 | 0.0764 | 0.6891 |
| AVG (constante) | 0 | 0.3945 | 0.1034 | 0.4997 |
| HLR | 3 | 0.4694 | 0.1275 | 0.6369 |
| Ebisu v2 | 0 | 0.4989 | 0.1627 | 0.6051 |

Com revisões do mesmo dia **incluídas na avaliação**, o FSRS-7 (0.3206) é **muito** melhor que o FSRS-6 (0.3842, pior até que AVG 0.3816), porque o FSRS-6 não modela bem a recordação intradiária. Para nós, com checagens dentro da sessão, isso pesa a favor do FSRS-7.

O SM-2 **não aparece** mais na tabela atual. O RWKV lidera, mas exige pré-treino de população e muitas features (duração, cartas irmãs, hierarquia de decks), o que fica fora do escopo local.

#### Estado do ecossistema (verificado em 2026-11-18)

| Item | Estado |
|---|---|
| `ts-fsrs` (MIT, 879★) | **v6.0.0 em 2026-10-28**: `DefaultScheduler` assíncrono com default FSRS-7; modelos FSRS-3…7 em `ts-fsrs/models/fsrs-N`; middlewares (desired retention, fuzz, learning steps, *leech*, **Cost ADR**); `Reschedule.replay()` reconstrói memória a partir do histórico; **Node ≥ 24**; `Rating`/`State` viram objetos const. A v5.4.2 (2026-09-01) é a última da linha 5. |
| `@open-spaced-repetition/binding` | Otimizador (napi-rs no Node; WASI/wasm em Worker no browser), **beta**: `convertCsvToFsrsItems`, `computeParameters(items,{enableShortTerm, modelVersion})`, `evaluateWithTimeSeriesSplits`. |
| `fsrs-rs` | **v7.0.0 (2026-11-10)** com suporte a FSRS-7, ADR e otimização. |
| Anki | Estável 26.09.x; as notas da beta **26.11b1 (2026-11-12) não mencionam FSRS-7**, então o Anki continua no FSRS-6. Implicação: cartões exportados para o Anki serão agendados pelo FSRS-6 do Anki. |
| Electron do learnharness | `electron ^44.9.3`; o Electron 44.11.x embute **Node 24.22.x**, compatível com ts-fsrs v6. |
| Outras libs TS | `open-spaced-repetition/fsrs.js` (MIT, antiga); vários apps (Obsidian LearnKit, true-recall) usam FSRS-6. |

Uso mínimo da API v6 (docs oficiais):

```ts
import { DefaultScheduler, Rating } from 'ts-fsrs'
const scheduler = await DefaultScheduler({
  version: 'FSRS-7', desiredRetention: 0.9, enableShortTerm: true,
  learningSteps: ['1m', '10m'], relearningSteps: ['10m'], enableFuzz: false, maximumInterval: 36_500,
})
const card = scheduler.newCard({ cardId: 'node:elec.ohm', now })
const { card: next, revlog } = scheduler.review({ card, grade: Rating.Good, now })
// next.stability, next.stabilityFast, next.difficulty, next.dueAt, next.state, next.scheduleStatus
// scheduler.preview({card, now}) -> iterável {grade, card, revlog} para as 4 notas
```

### 2.4 Agendamento ótimo e escolha da retenção

- **MEMORIZE** (Tabibian et al., PNAS 2019): sob um modelo de esquecimento exponencial, a intensidade ótima de revisão é proporcional à probabilidade de esquecer, $u^*(t)=q^{-1/2}(1-m(t))$. Isso justifica uma prioridade $\propto (1-R)$.
- **SSP-MMC** (Ye, Su, Cao, KDD 2022): o agendamento é formulado como *stochastic shortest path* para minimizar o custo de memorização até atingir a meta. É a base dos simuladores do FSRS.
- **Desired retention / CMRR / Cost ADR:** no Anki, a retenção desejada é "o parâmetro mais importante". Acima de 90% a carga cresce muito rápido, e acima de 97% fica avassaladora (manual do Anki). O `ts-fsrs` v6 tem `schedulerCostAdrMiddleware`, que adapta a retenção ao estado de memória e ao custo de revisão.
- **Conteúdo importa:** o KARL (Shu et al., EMNLP 2024) usa embeddings BERT de cartões semanticamente próximos e superou modelos baseados só em histórico em AUC e calibração (123.143 logs; estudo online com 27 usuários). Para nós, a ideia equivalente é o **grafo** como fonte de similaridade, via englobamento e vizinhança.

### 2.5 Ordem de grandeza da carga (proposta: simulação própria)

Simulação Monte Carlo com o FSRS-6 de **pesos default de flashcard**, sempre "Good" quando recorda, sem crédito implícito, intervalos inteiros (`sim/fsrs6sim.py` no scratchpad desta pesquisa; não é número publicado):

| Retenção desejada | Revisões/ano por nó (excl. introdução) | Lapsos/ano por nó |
|---|---:|---:|
| 0.85 | 5.7 | 0.84 |
| 0.90 | 7.1 | 0.69 |
| 0.95 | 11.3 | 0.58 |

Introduzindo **3 nós novos/dia** com DR=0.90, a carga sobe de ~9 revisões/dia no 1º mês para ~22/dia no fim do ano. A ~3 min por revisão gerada, isso dá **~25–65 min/dia**, dentro de um orçamento de 2–4 h, **antes** da compressão via FIRe. Com 4 novos/dia e DR 0.90, chega a ~30/dia no fim do ano. Use esses números só para dimensionar o controlador da §9.9 e recalibre com dados reais.

---

## 3. Knowledge tracing (KT)

### 3.1 BKT (Corbett & Anderson, 1995)

Parâmetros por habilidade: $P(L_0)$, $T$ (aprender), $G$ (chute), $S$ (deslize); opcionalmente $F$ (esquecer).

$$P(L_t\mid c)=\frac{P(L_t)(1-S)}{P(L_t)(1-S)+(1-P(L_t))G},\qquad P(L_t\mid \bar c)=\frac{P(L_t)S}{P(L_t)S+(1-P(L_t))(1-G)}$$

$$P(L_{t+1})=P(L_t\mid obs)+(1-P(L_t\mid obs))\,T,\qquad P(c_t)=P(L_t)(1-S)+(1-P(L_t))G$$

O limiar clássico de maestria nos Cognitive Tutors é $P(L)\ge0.95$. Biblioteca de referência: `CAHLR/pyBKT` (MIT). Em grandes benchmarks, o BKT puro perde para LR e DKT (Gervet et al., 2020: "Markov process methods lag behind"). Já Khajah et al. (2016, "How deep is KT?") mostram que BKT com **esquecimento + individualização** se aproxima do DKT. **Para um usuário único**, o BKT é ideal: tem poucos parâmetros, priors interpretáveis, forma fechada e funciona com 1 observação.

### 3.2 Modelos logísticos: AFM, PFA, DAS3H

**PFA** (Pavlik, Cen & Koedinger, 2009), para KCs $j$ do item, com $s_{ij}$ sucessos e $f_{ij}$ falhas anteriores:

$$m=\sum_{j\in KC}\left(\beta_j+\gamma_j s_{ij}+\rho_j f_{ij}\right),\qquad p=\sigma(m)$$

**DAS3H** (Choffin et al., EDM 2019) soma ao IRT os KCs e o *espaçamento*: contagens por **janela de tempo** $w$ (ex.: 1h, 1d, 7d, 30d, ∞) de tentativas $a$ e acertos $c$:

$$P(Y_{s,j,t}=1)=\sigma\Big(\alpha_s-\delta_j+\sum_{k\in KC(j)}\beta_k+\sum_{k\in KC(j)}\sum_{w}\big[\theta_{k,2w+1}\log(1+c_{s,k,w})-\theta_{k,2w+2}\log(1+a_{s,k,w})\big]\Big)$$

O DAS3H é a ponte "KT + memória" para itens com **múltiplas habilidades**, que é exatamente o nosso caso. Ele precisa de dados de população para ajustar $\theta$, então serve como inspiração e não como motor do v1. Gervet et al. (2020): **LR com features bem escolhidas venceu em 4 de 9 datasets** (os de tamanho moderado ou com muitas interações por aluno); o DKT venceu em 5 (os grandes).

### 3.3 IRT e Elo (itens e alunos)

IRT 2PL: $P(Y=1)=\sigma(a(\theta-b))$, com informação de Fisher $a^2P(1-P)$, máxima em $P=0.5$. Esse é o critério de seleção do CAT: perguntar onde há mais informação.

**Elo educacional** (Pelánek, *Computers & Education* 2016), com $P=\sigma(\theta_s-d_i)$:

$$\theta_s\leftarrow\theta_s+K\,(y-P),\qquad d_i\leftarrow d_i+K\,(P-y),\qquad K=U(n)=\frac{a}{1+b\,n}\;\;(a=1,\;b=0.05)$$

($n$ = número de respostas anteriores; os valores $a=1$, $b=0.05$ foram ajustados por *grid search* e recomendados como ponto de partida.)

- **Multivariado:** $s_j\leftarrow s_j+c_{ij}K(y-P)$ propaga a atualização para habilidades correlacionadas.
- **PFAE:** usa $\gamma$/$\delta$ distintos para acerto e erro.
- Para MCQ com $k$ opções: $P=1/k+(1-1/k)\sigma(\theta-d)$.

**Dificuldade estimada por LLM é prior fraco.** No BEA 2024 (dificuldade 1PL, 201 itens), o melhor modelo citado tem Pearson **0.381** e RMSE 0.288, contra RMSE 0.31 de um regressor dummy (arXiv 2601.02580). Use a dificuldade do LLM só como **média a priori** com alta variância, corrigida por Elo por **família** (nó × nível).

### 3.4 Deep KT (DKT, SAKT, AKT, simpleKT) e o benchmark pyKT

- **DKT** (Piech et al., 2015): RNN/LSTM sobre one-hot (questão, acerto) → $\sigma(W h_t)$.
- **SAKT** (Pandey & Karypis, 2019): self-attention com a questão atual como *query* sobre interações passadas.
- **AKT** (Ghosh, Heffernan & Lan, KDD 2020): embeddings tipo Rasch ($x_t=c_{c_t}+\mu_{q_t}d_{c_t}$) e **atenção monotônica com decaimento exponencial** pela distância (modela esquecimento).
- **simpleKT** (Liu et al., ICLR 2023): embeddings Rasch e atenção de produto escalar comum, "simples mas difícil de bater".
- **pyKT** (`pykt-team/pykt-toolkit`, MIT, NeurIPS D&B 2022): padroniza dados, splits e 32+ modelos, incluindo modelos de 2025–2026 como MoCKT, DenoiseKT, UKT e RobustKT.

AUC no protocolo pyKT (tabela do paper simpleKT):

| Modelo | ASSIST2009 | Algebra2005 | Bridge2006 | NIPS34 |
|---|---:|---:|---:|---:|
| DKT | 0.7541 | 0.8149 | 0.8015 | 0.7689 |
| SAKT | 0.7246 | 0.7880 | 0.7740 | 0.7517 |
| AKT | 0.7853 | 0.8306 | 0.8208 | 0.8033 |
| simpleKT | 0.7744 | 0.8254 | 0.8160 | 0.8035 |
| IEKT | 0.7861 | 0.8416 | 0.8125 | 0.8045 |

**Leitura:** de DKT (2015) para o SOTA, o ganho é de ~0.01–0.03 de AUC, **com milhares de alunos**. Para um aluno, esses modelos não têm o que aprender.

### 3.5 KT com LLMs (2024–2026)

| Trabalho | Ideia | Relevância para nós |
|---|---|---|
| **Eedi: "Specialised KT Models Outperform LLMs"** (arXiv 2603.02830, 2026) | Acurácia: LLM-KT próprio 72.8%, SAKT 72.7%, DKT 71.8%, contra Gemini-2.5-flash-lite 66.5%, Qwen2.5-7B 64.6%, GPT-4o-mini 58.6% e Llama-1B LoRA 71.0%. Baseline de viés do item: 66.5%. Latência <0.25 s contra 3–3.299 s por aluno; custo **600–12.000×** maior. | **Não usar LLM como preditor.** O melhor modelo usa o LLM apenas para **embeddings de texto** (Qwen3 0.6B) dentro de um KT pequeno. |
| **FoundationalASSIST** (arXiv 2602.00070) | 1.7M interações com texto. LLMs de fronteira "mal atingem baseline trivial" em KT e ficam abaixo do acaso em discriminação de itens. | Idem. |
| **LLMKT em diálogos** (Scarlatos, Baker & Lan, LAK 2025, arXiv 2409.16490) | LLM anota KCs por turno e a correção de cada resposta; depois aplica KT. | **Exatamente o nosso fluxo** (tutor conversacional → evidência estruturada). |
| **KT difficulty-aware em diálogos** (arXiv 2605.01097, 2026) | LLM produz habilidade e dificuldade mapeadas para **IRT**. | Saídas do LLM mapeadas para parâmetros interpretáveis. |
| **KCQRL** (arXiv 2410.01727) | LLM anota KCs por passo da solução e gera embeddings contrastivos; melhora 15 modelos KT. | LLM gera a **matriz Q** dos itens. |
| **ConceptKT** (arXiv 2603.24073) | Prever **quais conceitos faltam** (deficiência), não só acerto/erro. | Base para "pontos fracos" (§6). |
| **RPKT** (arXiv 2508.11892) | LLM descobre pré-requisitos **recursivamente** até a fronteira de conhecimento do aluno, com avaliações binárias. | Expansão procedural do grafo e diagnóstico. |
| NTKT (2511.02599), LLM-KT (2502.02945), Thinking-KT (2601.01708), MERIT (2603.22289), LOKT (2410.12872) | KT como *next-token*, alinhamento por instrução, *test-time scaling*, memória recuperável. | Interessante para pesquisa; caro e instável para uso diário local. |
| LT-MKT (arXiv 2608.24005) | KT **multi-domínio** com carga cognitiva e transferência entre domínios. | Futuro: transferência Eletrônica↔Matemática. |

**Conclusão:** o LLM é um ótimo **anotador/sensor** (matriz Q, correção por rubrica, misconceptions, dificuldade a priori) e um preditor ruim. O preditor deve ser um modelo probabilístico pequeno.

---

## 4. Knowledge Space Theory (Doignon & Falmagne; ALEKS)

### 4.1 Definições essenciais (arXiv 1511.06757)

- **Estrutura de conhecimento** $(Q,\mathcal K)$: família de subconjuntos (estados) de $Q$ contendo $\emptyset$ e $Q$. **Espaço de conhecimento**: fechado sob união.
- **Learning space**: satisfaz
  - **[L1] Learning smoothness**: se $K\subset L$, existe uma cadeia $K=K_0\subset\dots\subset K_p=L$ com $|K_i\setminus K_{i-1}|=1$ (dá para aprender item a item);
  - **[L2] Learning consistency**: se $K\subset L$ e $K\cup\{q\}\in\mathcal K$, então $L\cup\{q\}\in\mathcal K$ (saber mais não impede aprender algo novo).
- Teorema (Cosyn & Uzun 2009): learning space ⇔ **antimatroide** ⇔ espaço de conhecimento *well-graded*.
- **Relação de *surmise***: uma quase-ordem $\preceq$ ("dominar $b$ implica dominar $a$"). Os estados de um **espaço quase-ordinal** são os **down-sets** (ideais de ordem), fechados sob ∪ e ∩. **Um DAG de pré-requisitos AND define exatamente isso**, e os down-sets de uma ordem parcial formam um learning space.
- **Pré-requisitos alternativos (OR)** exigem um **sistema de surmise**: cada item $q$ tem uma família de cláusulas $\sigma(q)$ ($q\in C$), e $K$ é estado se, para todo $q\in K$, existe $C\in\sigma(q)$ com $C\subseteq K$. Isso equivale a uma forma DNF: "$q$ requer $(A\wedge B)\vee(C\wedge D)$". Espaços (fechados por união) correspondem a sistemas de surmise.

### 4.2 Fringes: o que o aluno domina e o que está pronto para aprender

$$K^{I}=\{q\in K: K\setminus\{q\}\in\mathcal K\}\quad(\text{fronteira interna: os "pontos altos"})$$

$$K^{O}=\{q\in Q\setminus K: K\cup\{q\}\in\mathcal K\}\quad(\text{fronteira externa: pronto para aprender})$$

**Teorema 21 (Fringe Theorem):** em um learning space, todo estado é **determinado** pelo par (fronteira interna, fronteira externa). Na prática, o relatório do ALEKS é composto por duas listas curtas. A probabilidade de o aluno **aprender com sucesso um item escolhido na fronteira externa**, estimada em centenas de milhares de avaliações ALEKS, é **≈ 0.93**.

### 4.3 Avaliação adaptativa (ALEKS)

- Distribuição $L_n$ sobre os estados.
- **Regra de questionamento *half-split***: escolher $q$ que minimiza $|2L_n(\mathcal K_q)-1|$, onde $\mathcal K_q$ são os estados que contêm $q$ (a pergunta cuja chance de acerto está mais próxima de 0.5).
- **Atualização multiplicativa**: $L_{n+1}(K)\propto\zeta^{K}_{q,r}L_n(K)$ com $\zeta>1$ se $K$ é consistente com a resposta. É comutativa e essencialmente Bayesiana.
- Com ruído, usa-se o **BLIM**: $P(\text{acerto}\mid K)=1-\beta_q$ se $q\in K$ (*careless error*), senão $\eta_q$ (*lucky guess*).
- Na prática, a avaliação termina em **25–35 perguntas**.

### 4.4 CbKST e o elo com CDMs

A **KST baseada em competências** (Heller & Stefanutti, 2024) separa **itens** (exercícios) de **habilidades** (skills). No modelo **conjuntivo**, um item é resolvível se o aluno tem **todas** as habilidades exigidas. É exatamente o **DINA** dos modelos de diagnóstico cognitivo (§6), e nossa matriz Q (item → nós) é a "*skill function*" da CbKST.

### 4.5 LLM + KST: evidência de 2026

Steiner & Hochweber (PHSG, 2026, suplemento MIT/CC-BY) avaliaram **2.400 recomendações de "próximo passo"** de 6 LLMs (Claude Fable 5, Claude Sonnet 5, GPT-5.6 Sol/Terra, Gemini 3.1 Pro Preview, Gemini 3.7 Flash) em 4 domínios de funções lineares, comparando-as com a **fronteira externa** exata.

- A acurácia exata geral foi **79.7%** (F1 macro 0.90).
- Por condição de prompt, variou de **61–63%** nas duas condições mais fracas a **96–98%** nas duas mais fortes; o salto P2−P1 é de +33.5 pp.
- Por modelo, foi de 75.5% a 86%.

**Lição:** calcule a fronteira **deterministicamente** a partir do grafo e do estado, e use o LLM para explicar, não para decidir.

### 4.6 Implementações

R `kst`/`pks`/`kstMatrix` (CRAN), Python `milansegedinac/kst`, `vanderbilt-data-science/knowledge-spaces` (MIT; *skills* do Claude Code com pipeline KST completo). Nenhuma é TS, e a matemática que precisamos é pequena: down-closure, fringes e particle filter, o que justifica implementação própria (§9.7).

---

## 5. Propagação de maestria e esquecimento no grafo

### 5.1 FIRe / HSRS (Math Academy, Justin Skycak)

O artigo original é de 2023 e foi renomeado para *Hierarchical Spaced Repetition* (HSRS) em 2026. A implementação é proprietária; o artigo dá apenas o modelo conceitual.

- **Dois grafos.** O de **pré-requisitos** decide o que aprender. O de **englobamento** (*encompassing*) decide como trabalho avançado credita tópicos mais simples. Um pré-requisito **não** é automaticamente um englobamento: o peso pode ser 0 quando só é preciso "familiaridade conceitual".
- **Estado por (aluno, tópico):**

$$repNum\leftarrow\max(0,\;repNum+speed\cdot decay^{failed}\cdot rawDelta)$$

$$memory\leftarrow\max(0,\;memory+rawDelta)\cdot 0.5^{days/interval}$$

  O `rawDelta` tem sinal (+ passa, − falha) e é **descontado se a revisão é cedo** (memória alta). O `decay` cresce com o atraso.
- **Crédito positivo flui para baixo** ("como raios") pelos tópicos englobados, de forma **fracionária** pelo peso da aresta: pesos parciais transmitem menos, e o crédito "esmaece" ao longo dos ramos.
- **Penalidade flui para cima** ("como árvores crescendo"): falhar um tópico simples penaliza os avançados que o englobam.
- **Velocidade** = (aceleração por habilidade do aluno) ÷ (lentidão por dificuldade do tópico) e multiplica o $\Delta repNum$. **Se speed < 1, o crédito implícito é descartado e a revisão explícita é forçada** (alunos com dificuldade transferem mal).
- **Compressão de repetições:** escolher revisões ou aulas cujas repetições implícitas derrubam várias revisões vencidas "como dominós"; depois, avançar uniformemente no grafo.
- **Pré-requisito em risco:** se um pré-requisito de algo que será aprendido agora está prestes a ser esquecido, a revisão dele vence **agora**.
- **Remediação:** duas falhas seguidas sem progresso em uma aula disparam tarefas nos pré-requisitos.
- **Calibração dos pesos:** feita por especialistas. Só se anotam arestas não-triviais, não-inferíveis por transitividade e próximas no grafo de pré-requisitos, de modo que o número de pesos cresce **linearmente** com o número de tópicos.

### 5.2 Implementações abertas de referência

- **open-mastery** (`_refs/open-mastery`; engine MIT, grafo CC-BY-SA 4.0). Nós YAML com `prereqs`, `bloom` e `assess`. A tarefa `tasks/010-encompassing-relationships.md` especifica `encompasses: {node_id: weight 0–1}`, índice reverso `encompassed_by` e validação. O engine atual é só "ordenação topológica filtrada por maestria", sem SRS ainda.
- **Graspful** (docs públicas, código fechado): retenção $0.5^{days/interval}$; escada de intervalos 1, 3, 7, 14, 30, 60, 120, 240 dias. Crédito implícito = **produto dos pesos ao longo do caminho**, com **máximo** entre caminhos (não soma). Desconto por retenção do ancestral: >0.9 → ×0.25, 0.7–0.9 → ×0.5, <0.7 → ×1.0. O limiar de *needs_review* é 0.6.
- **DeepTutor** (`_refs/DeepTutor/deeptutor/learning/`, Apache-2.0). `mastery.py` usa média de acertos com pesos de recência (0.5, 0.7, 0.85, 0.95, 1.0) e teto de confiança (1 tentativa ≤ 0.5; 2 ≤ 0.8). `scheduler.py` usa estabilidade exponencial com sequências de intervalos por tipo de conhecimento. `semantic_assessment.py` usa veredito `correct|partial|incorrect|ungraded` com checagem de citação da fonte. É simples, mas o **contrato de veredito do LLM** é um bom padrão.

### 5.3 Restrições lógicas (KST probabilística)

Se $b$ exige $a$, então $P(L_b\wedge\neg L_a)\le\varepsilon$, o que implica (limite de Fréchet):

$$P(L_b)\le P(L_a)+\varepsilon$$

Sucesso em $b$ deve elevar $a$, e falha em $a$ deve rebaixar $b$. Isso é a versão probabilística de "estados são down-sets".

---

## 6. Diagnóstico de pontos fracos

### 6.1 Modelos de diagnóstico cognitivo (CDMs)

- **DINA** (*deterministic input, noisy AND*): $\eta_{ij}=\prod_k\alpha_{ik}^{q_{jk}}$ e $P(X_{ij}=1)=(1-s_j)^{\eta_{ij}}g_j^{1-\eta_{ij}}$. **DINO** (OR): $\eta=1-\prod_k(1-\alpha_k)^{q_k}$.
- **NeuralCD** (Wang et al., AAAI 2020): $x=Q_e\circ(h^s-h^{diff})\times h^{disc}$, seguido de um MLP com **pesos positivos**, o que garante monotonicidade (mais proficiência ⇒ maior P(acerto)).
- Sucessores (KaNCD, RCD…) e versões com LLM (KCD 2025; transferência *zero-shot* entre domínios) estão no *survey* arXiv 2407.05458. Bibliotecas: `bigdata-ustc/EduCDM` e `EduKTM` (Python).
- Para um aluno só, o que se aproveita é a **forma** do DINA (AND ruidoso + matriz Q), que dá atribuição de culpa exata sob independência (§9.5). A parte neural não se aplica.

### 6.2 Misconceptions

- A Eedi usa **misconceptions** e *constructs* como texto de entrada do KT (seu melhor modelo).
- O ConceptKT mostra que selecionar histórico por alinhamento conceitual melhora tanto a predição quanto a identificação de conceitos deficientes.
- O BKT/LLM agêntico de 2026 (arXiv 2606.25358) usa um classificador LLM com rubrica validada (Fleiss κ=0.624) para alimentar BKT por competência.

### 6.3 O avaliador LLM é ruidoso

A meta-análise de Hardy (arXiv 2603.04820, 2026, 890 resultados de QWK) mostra que decoder-only fica **0.37 de QWK atrás** de encoders em média, com sensibilidade a redação e viés. Portanto:

1. usar correção **determinística** sempre que possível (MCQ, numérico com tolerância, unidades);
2. rubrica explícita, saída JSON com `confidence`;
3. **auto-consistência** (2 amostras) só em decisões caras (promover a "dominado");
4. modelar a confusão do avaliador na emissão (§9.4).

---

## 7. Seleção do próximo nó / item

| Abordagem | Como funciona | Uso recomendado |
|---|---|---|
| **Fronteira externa (KST)** | Candidatos = nós com pré-requisitos dominados e o próprio não dominado | **Núcleo** da escolha de conteúdo novo |
| **Regras Math Academy** | Revisões em risco antes de conteúdo novo; compressão; subir o grafo de forma uniforme; remediação após 2 falhas | Núcleo da política de revisão |
| **ZPDES** (Clement et al., JEDM 2015) | Bandit sobre atividades na ZPD com recompensa = **progresso de aprendizagem** $r=\sum_{k=t-d/2}^{t}\frac{C_k}{d/2}-\sum_{k=t-d}^{t-d/2}\frac{C_k}{d/2}$; $w_a\leftarrow\beta w_a+\eta r$; $p_a=\tilde w_a(1-\gamma)+\gamma\,\xi_u$; a ZPD expande quando o sucesso passa de um limiar | Escolha de **tipo de recurso** e nível de dificuldade |
| **Dificuldade desejável** | Regra dos 85% (Wilson et al., *Nat. Commun.* 2019): taxa ótima de erro ≈15.87% para aprendizes por gradiente | Alvo de P(acerto) 0.70–0.85 na prática |
| **CAT / máxima informação** | Item com $P\approx0.5$ | **Sondas diagnósticas** apenas (não para treino) |
| **RL** (Doroudi, Aleven & Brunskill 2019, *Where's the reward?*) | Revisão: RL instrucional ajuda quando o modelo de aluno é bom e há dados; falha com modelo ruim | Fora do v1; usar o simulador (FSRS+BKT) só para **ajustar hiperparâmetros** |

---

## 8. Síntese: o que copiar de cada linha

| De | Pegamos | Deixamos |
|---|---|---|
| FSRS-7 (`ts-fsrs` v6) | Memória por nó, intervalos fracionários, otimizador | Learning steps de flashcard sem adaptação |
| BKT | Latente binário de aquisição, emissões, limiar 0.95 | Parâmetros fixos sem esquecimento |
| KST/ALEKS | Down-sets, fringes, half-split, BLIM | Enumeração explícita de estados (inviável com milhares de nós) |
| FIRe/HSRS | Grafo de englobamento, crédito fracionário, penalidades, compressão, regra speed<1, pré-requisito em risco | repNum/memory próprios (o FSRS faz melhor) |
| DINA/CbKST | AND ruidoso com matriz Q para culpa | Ajuste neural |
| Elo (Pelánek) | Calibração de famílias de itens e θ do domínio, $U(n)=1/(1+0.05n)$ | — |
| LLM-KT | LLM como anotador | LLM como preditor |
| ZPDES/Thompson | Escolha de recurso e dificuldade | RL de currículo |

---

## 9. PROPOSTA: *Learner Model* por nó, local, em TypeScript

### 9.1 Visão geral

```
                 ┌──────────────── LLM (sensor) ─────────────────┐
 resposta ──────►│ rubric grade 0–3 · confidence · Q-vector ·     │
 (prática/diálogo)│ attributions(node, blame, misconceptionId)   │
                 └──────────────────────┬─────────────────────────┘
                                        ▼  Evidence (append-only log por domínio)
 ┌────────────────────────── LearnerModel (puro, determinístico) ──────────────────────────┐
 │ 1. predict()  P(acerto) registrado ANTES (calibração)                                  │
 │ 2. local update  BKT×FSRS (§9.4) ou DINA mean-field (§9.5)                              │
 │ 3. FSRS review (ts-fsrs FSRS-7) no nó-alvo                                              │
 │ 4. propagate (§9.6): projeção de consistência · crédito implícito · penalidades · culpa │
 │ 5. fringes/status (§9.8) · misconceptions (§9.10)                                       │
 └───────────────┬──────────────────────────────────────────────┬──────────────────────────┘
                 ▼                                              ▼
        Planner (§9.9): plano diário e de sessão     Snapshot p/ memória do tutor (~300 tokens)
```

Princípios:

- **Event sourcing**: o estado é um *fold* puro do log de evidências. Isso permite replay (`Reschedule.replay()` do ts-fsrs), reajuste de parâmetros, auditoria e invariantes testáveis.
- **Localidade**: toda atualização é k-hop, com $h\le3$.
- **LLM fora do laço numérico**: o modelo é puro e determinístico.

### 9.2 Estado por nó

```ts
// src/core/learner/types.ts  (proposta)
export type NodeId = string
export type Grade = 0 | 1 | 2 | 3            // 0 errado · 1 parcial (núcleo errado) · 2 certo c/ ajuda/hesitação · 3 certo
export type ItemFormat = 'mcq' | 'numeric' | 'short' | 'derivation' | 'explain' | 'flashcard' | 'dialogue'
export type Level = 1 | 2 | 3 | 4 | 5        // ~Bloom: recall, understand, apply, analyze, transfer

export interface FsrsMemory {                // espelha o Card do ts-fsrs v6 (FSRS-7)
  cardId: string
  state: 0 | 1 | 2 | 3                       // New, Learning, Review, Relearning
  stability: number; stabilityFast: number; difficulty: number
  lastReviewAt?: string; dueAt: string
  reps: number; lapses: number; learningStep?: number; scheduleStatus: string
}

export interface MisconceptionBelief { a: number; b: number; lastSeenAt: string; text: string }

export interface NodeState {
  nodeId: NodeId
  pL: number                    // P(adquirido) — BKT
  nEff: number                  // evidência efetiva (peso na projeção de consistência)
  verified: boolean             // tem evidência direta (não só inferida)
  fsrs?: FsrsMemory             // criado na 1ª tentativa de recuperação
  desiredRetention: number      // 0.85–0.93 conforme papel na fronteira
  levelElo: number[]            // b por nível 1..5 (família de itens deste nó)
  blame: number                 // culpa acumulada com decaimento (meia-vida 14d)
  blameAt?: string
  misconceptions: Record<string, MisconceptionBelief>
  delayedSuccesses: number      // sucessos com recuperação atrasada (≥ 1 dia)
  lastEvidenceAt?: string
}

export interface Evidence {
  id: string; seq: number; at: string; domainId: string; sessionId: string
  itemId: string; itemFamily: string          // ex.: `${nodeId}#L3`
  nodes: { nodeId: NodeId; q: number; primary?: boolean }[]   // vetor Q (q∈(0,1])
  format: ItemFormat; level: Level
  grade: Grade; graderConfidence: number      // 0..1 (1 = determinístico)
  hints: number; latencyMs?: number; selfConfidence?: 1 | 2 | 3
  minutesSinceExposure: number                // desde a última exposição ao nó-alvo
  attributions?: { nodeId: NodeId; blame: number; misconceptionId?: string; newMisconception?: string }[]
  predicted?: number                          // P(acerto) gravado antes (calibração)
}

export interface DomainProfile {
  domainId: string
  theta: number; thetaN: number               // Elo global do domínio
  speed: number                               // velocidade de aprendizagem (≈1)
  dailyBudgetMin: number
  fsrsWeights?: number[]                      // após otimização
  emission: EmissionParams; params: ModelParams
}
```

Grafo (por domínio). Mapeia sobre `GraphNode`/`GraphEdge`/`GraphChain` do learnharness.

```ts
export interface PrereqEdge { from: NodeId; to: NodeId; rho: number }            // rho = força (1 = estrito)
export interface PrereqClause { node: NodeId; anyOf: NodeId[][] }                  // DNF opcional (OR de ANDs)
export interface EncompassEdge { from: NodeId /*avançado*/; to: NodeId /*englobado*/; w: number /*0..1*/ }
```

### 9.3 Observação: do LLM para `Evidence`

Saída exigida do avaliador (validar com `zod`, já dependência do projeto):

```json
{ "grade": 2, "confidence": 0.8,
  "rubric": [{"criterion":"aplica Ohm","met":true},{"criterion":"unidades","met":false}],
  "involvedNodes": [{"nodeId":"elec.ohm","q":1,"primary":true},{"nodeId":"math.units","q":0.6}],
  "attributions": [{"nodeId":"math.units","blame":0.7,"misconceptionId":"mc.units.mA-vs-A"}],
  "newMisconception": null }
```

- O **vetor Q** e as **misconceptions-alvo dos distratores** devem vir **no mesmo call que gera o item** (custo zero extra), não no de correção.
- **Mapeamento a partir do learnharness:** `problem.target` vira `nodes`; `mode` dá o nível. `recall` → 1–2, `discrimination` → 2–3, `composition` → 3–4, este último multi-nó, e as `GraphChain` premissas→conclusão são candidatas naturais a englobamento.
- **Flashcards** (plugin FSRS-6 por proposição) viram `format:'flashcard'`, `level:1`, com peso 0.3 no nó-tópico (o cartão é mais estreito que o nó).

### 9.4 Atualização local: BKT × FSRS (nó único)

**Modelo (proposta).** $L\in\{0,1\}$ é "adquirido". $M\in\{0,1\}$ é "disponível agora", com $P(M=1\mid L=1)=R(t)$ (FSRS-7, calculado **antes** da revisão) e $P(M=1\mid L=0)=0$. "Sabe agora" é $K=L\wedge M$, logo $P(K)=p\,R$ com $p=P(L)$. Sem cartão FSRS ainda, use $R=1$.

**Emissão ordinal** $e_1(y)=P(y\mid K=1)$, $e_0(y)=P(y\mid K=0)$. Defaults (resposta aberta, recuperação **atrasada**):

| y | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| $e_1$ (sabe) | 0.07 | 0.08 | 0.20 | 0.65 |
| $e_0$ (não sabe) | 0.55 | 0.25 | 0.12 | 0.08 |
| $e_0^{imediato}$ (≤ 20 min após a exposição) | 0.35 | 0.20 | 0.20 | 0.25 |
| MCQ k opções: $e_1$ / $e_0$ | 0.08 / $1-\frac1k$ | – | – | 0.92 / $\frac1k$ |

A linha "imediato" implementa a regra didática: **checagem logo após explicar quase não conta** (razão de verossimilhança para y=3 de 2.6 contra 8.1 na recuperação atrasada).

**Ruído do avaliador:** com $\kappa=0.6+0.35\cdot conf$ (ou $\kappa=1$ se a correção é determinística), confusão $C(\hat y\mid y)=\kappa$ na diagonal e $(1-\kappa)$ dividido entre os vizinhos (renormalizado nas bordas):

$$\tilde e_k(\hat y)=\sum_y e_k(y)\,C(\hat y\mid y)$$

**Posterior:**

$$P(\hat y)=pR\,\tilde e_1+(1-pR)\,\tilde e_0,\qquad P(L{=}1\mid\hat y)=\frac{p\,[R\,\tilde e_1+(1-R)\,\tilde e_0]}{P(\hat y)}$$

**Transição de aprendizagem** (houve feedback/correção após a tentativa):

$$p'=P(L\mid\hat y)+\big(1-P(L\mid\hat y)\big)\,T,\qquad T=\mathrm{clamp}(T_0(\text{fmt},\ell)\cdot speed,\,0,\,0.6)$$

Uma **aula** (explicação, vídeo ou capítulo) sem tentativa aplica só a transição, com $T_{lesson}$ (default 0.25).

**FSRS:** se a tentativa é uma recuperação do nó-alvo, cria o cartão se não existir (`scheduler.newCard`) e chama `scheduler.review({card, grade: rating, now})` com:

| Condição | Rating |
|---|---|
| ŷ ∈ {0,1} | Again |
| ŷ = 2 (certo com dica, hesitação ou baixa autoconfiança) | Hard (Hard **é aprovação**; não usar para "esqueci", conforme o manual do Anki) |
| ŷ = 3 | Good |
| ŷ = 3, nível ≥ 4, latência < mediana e autoconfiança 3 | Easy (raro) |

**Exemplo numérico.** Após a aula, $p=0.30$. Uma recuperação atrasada com ŷ=3 (κ≈1) leva $P(L\mid y)=\frac{0.3\cdot0.65}{0.3\cdot0.65+0.7\cdot0.08}=0.777$, e a transição ($T=0.15$) dá $0.81$. Uma segunda recuperação atrasada com ŷ=3 leva a $0.972\to0.976\ge0.95$, e o nó é **dominado** com 2 sucessos atrasados.

**Critério de "dominado"** (proposta): $p\ge0.95$ **e** pelo menos 2 itens independentes **e** pelo menos 1 sucesso com recuperação atrasada (≥ 1 dia) ou de nível ≥ 4.

```ts
// src/core/learner/bkt-fsrs.ts  (esboço)
export function localUpdate(s: NodeState, R: number, e1: number[], e0: number[], yhat: Grade, T: number) {
  const pK = s.pL * R
  const py = pK * e1[yhat] + (1 - pK) * e0[yhat]
  const postL = (s.pL * (R * e1[yhat] + (1 - R) * e0[yhat])) / py
  const pL = postL + (1 - postL) * T
  return { pL: clamp01(pL), likelihoodRatio: e1[yhat] / e0[yhat], py }
}
```

### 9.5 Itens multi-nó: atribuição de culpa DINA *mean-field* (proposta, exata sob independência)

Item com vetor Q $\{(k,q_k)\}$, onde $q_k$ é a probabilidade de que $k$ seja realmente necessário. O requisito de $k$ está satisfeito com probabilidade $\pi_k=q_k\,p_kR_k+(1-q_k)$, e $\eta=\prod_k\pi_k$. Para cada $k$, com $\eta_{-k}=\prod_{j\ne k}\pi_j$:

$$P(\hat y\mid K_k{=}1)=\eta_{-k}\tilde e_1+(1-\eta_{-k})\tilde e_0$$

$$P(\hat y\mid K_k{=}0)=(1-q_k)\big[\eta_{-k}\tilde e_1+(1-\eta_{-k})\tilde e_0\big]+q_k\,\tilde e_0$$

$$P(L_k{=}1\mid\hat y)=\frac{p_k\big[R_k\,P(\hat y\mid K_k{=}1)+(1-R_k)\,P(\hat y\mid K_k{=}0)\big]}{p_kR_k\,P(\hat y\mid K_k{=}1)+(1-p_kR_k)\,P(\hat y\mid K_k{=}0)}$$

- A **culpa** é $b_k=\max(0,\,P(K_k{=}0\mid\hat y)-P(K_k{=}0))$. O elo mais fraco recebe mais culpa, sem precisar do LLM.
- A **atribuição do LLM** entra como evidência extra: multiplica a verossimilhança de $K_k=0$ por $1+\lambda\,c$, com $\lambda=1.5$ (razão de verossimilhança ≤ 2.5, porque o LLM é ruidoso).
- Revisão FSRS **real** apenas no nó `primary`. Os demais recebem crédito implícito com peso $q_k$ em caso de sucesso, ou antecipação de *due* proporcional a $b_k$ em caso de falha (§9.6).

### 9.6 Propagação no DAG

**(a) Projeção de consistência (KST probabilística).** Para cada aresta $a\to b$ com força $\rho_{ab}$: $\varepsilon_{ab}=\varepsilon+(1-\rho_{ab})(1-\varepsilon)$, com $\varepsilon=0.05$. Se $v=p_b-p_a-\varepsilon_{ab}>0$, aplica-se a projeção L2 ponderada pela evidência ($n=nEff+1$):

$$p_a\leftarrow p_a+v\frac{n_b}{n_a+n_b},\qquad p_b\leftarrow p_b-v\frac{n_a}{n_a+n_b}$$

Isso resolve exatamente $\min\,n_a(x_a-p_a)^2+n_b(x_b-p_b)^2$ s.a. $x_b-x_a=\varepsilon_{ab}$. Varra as arestas a até 3 hops do nó atualizado, em 2–3 passadas (projeções alternadas sobre semiespaços convexos), mais um passe global noturno. O efeito: sucesso em $b$ eleva os pré-requisitos e falha em $a$ rebaixa os dependentes, com o nó de mais evidência movendo-se menos.

Com cláusulas OR (DNF), aplique a restrição contra o **máximo** entre cláusulas do produto dos $p$ dos membros (aproximação conservadora).

**(b) Crédito implícito fracionário (FIRe → FSRS; proposta).** Depois de sucesso (ŷ ≥ 2) com revisão real no nó $n$, para cada $k$ englobado com peso efetivo:

$$w^*_{nk}=\max_{\text{caminhos } n\leadsto k}\;\prod_{e\in\text{caminho}}w_e\quad(\le3\text{ hops},\;w^*\ge0.1)$$

O crédito só se aplica se: $k$ tem cartão em Review, $p_k\ge0.9$, $speed_k\ge1$ (regra FIRe; *proxy*: $D_k\le7$ e $lapses_k\le2$) e $p_n\ge0.9$.

Calcule $S^{good}_k$ e $S^{good}_{f,k}$ via `scheduler.preview({card_k, now})` (entrada Good). Depois interpole:

$$S'_k=S_k+w^*\,(S^{good}_k-S_k),\quad S'_{f,k}=S_{f,k}+w^*\,(S^{good}_{f,k}-S_{f,k}),\quad t'_{last}=t_{last}+w^*\,(t_{now}-t_{last})$$

$D_k$ fica inalterado e $dueAt$ é recalculado por `scheduler.nextInterval` com a $r_k$ do nó. Propriedades:

- $w^*=0$ deixa o estado intacto; $w^*=1$ equivale a uma revisão Good (menos o update de $D$);
- $R_k(t)$ é monotonicamente não-decrescente em $w^*$ para todo $t\ge t_{now}$, porque $S^{good}\ge S$ no FSRS e o tempo decorrido encolhe;
- o **desconto de revisão precoce é automático**: $S^{good}-S\to0$ quando $R_k\to1$.

Persista o crédito como evento derivado `implicit-credit` (com $w^*$) para que o replay seja determinístico.

**(c) Penalidades.**

- *Para cima* (falha em $k$ englobado por $n$ com peso $w$): $due_n\leftarrow now+(1-w\,b_k)(due_n-now)$. Não se altera $S_n$, porque não houve lapso observado em $n$; a projeção (a) cuida de $p_n$.
- *Para baixo* (falha em $n$): culpa $b_k$ para os requisitos, via §9.5 ou a atribuição do LLM. Se $b_k>0.3$, agenda uma **sonda** em $k$ (remediação ao estilo Math Academy).
- **Duas falhas seguidas** no mesmo nó novo mudam o modo para "remediar pré-requisitos" e trocam o tipo de recurso.

**(d) Expansão procedural (nó novo $x$ inserido por LLM).**

1. Validar aciclicidade antes de aceitar a aresta (ordenação topológica incremental, ex. Pearce–Kelly) e validar pesos em [0,1].
2. **Prior por limites de Fréchet:** $\underline p=\max_{c\in\text{filhos}}(p_c-\varepsilon_{xc})$, $\overline p=\min_{a\in\text{pais}}(p_a+\varepsilon_{ax})$; $p_x=\mathrm{clamp}(p_0,\underline p,\overline p)$ com $p_0=0.15$, `verified=false`, $nEff=0.5$.
3. Se $p_x\ge0.8$ (implícito por filhos dominados), agendar sonda leve; o cartão FSRS só é criado na 1ª evidência real.
4. Nunca apagar nós com evidência. Fusões preservam evidência via `aliases` (o `GraphNode` já tem `aliases`).

### 9.7 Diagnóstico inicial: KST com filtro de partículas (proposta)

Enumerar estados é inviável; amostrar estados é barato.

1. **Esqueleto:** 100–300 nós representativos (tópicos de nível médio) por domínio.
2. **Partículas:** $M=2000$ estados, cada um um **down-set completo** do DAG, guardado como bitset `Uint32Array` (3000 nós × 2000 partículas ≈ 750 KB). Geração: $\theta\sim N(0,1)$, limiar por nó $\theta+\epsilon_q>b_q$ com $b_q$ de profundidade/dificuldade do LLM, e depois **interior por down-closure** (manter $q$ só se todos os ancestrais também passam).
3. **Pergunta (half-split):** escolher $q$ no esqueleto que minimiza $|2\hat P(q\in K)-1|$, com $\hat P$ = fração ponderada de partículas que contêm $q$. Alternativa: maior redução esperada de entropia.
4. **Atualização (BLIM):** peso $\times(1-\beta_q)$ ou $\times\beta_q$ se $q\in K$; $\times\eta_q$ ou $\times(1-\eta_q)$ caso contrário. Defaults: $\beta=0.1$ (descuido); $\eta=0.05$ aberto, $1/k$ MCQ.
5. **Reamostragem** quando ESS < M/2, com movimentos MCMC locais (adicionar um item da fronteira externa ou remover um da interna, mantendo o down-set).
6. **Parada:** 15–25 perguntas (ALEKS usa 25–35; diluir nas primeiras sessões) ou quando todo $\hat P$ do esqueleto está fora de [0.2, 0.8].
7. **Saída:** $p_q=\hat P(q\in K)$ para **todos** os nós (as partículas cobrem o grafo inteiro), com `verified=false` para os não perguntados.

### 9.8 Fronteiras e status por nó

Defina o **estado nítido** $K^*$ = maior down-set contido em $\{k: p_k\ge0.95\}$ (o interior garante as axiomáticas). Então:

- **Fronteira externa** (pronto para aprender): $\{j\notin K^*: \forall a\in pre(j),\;p_aR_a\ge0.85\}$, com cláusulas OR: alguma cláusula inteira satisfeita.
- **Fronteira interna** ("o que você domina, no topo"): $\{k\in K^*: K^*\setminus\{k\}$ ainda é down-set$\}$, isto é, nenhum filho em $K^*$.
- **Status:** `locked`, `fringe`, `learning` (0.3 ≤ p < 0.95), `mastered`, `review_due` (mastered e $R<r$), `weak` (mastered ou learning com culpa alta ou misconception ativa) e `inferred` (verified=false).

A UI mostra **duas listas curtas** (Teorema 21): "você domina (topo)" e "pronto para aprender", mais "pontos fracos".

### 9.9 Política "o que estudar agora"

**Importância:** $I_k=1+\alpha\,goal_k+\beta\log(1+|desc(k)|)$, com $\alpha=1$, $\beta=0.5$.

**Valor de desbloqueio** (DP reversa topológica; $\gamma=0.6$):

$$U_j=\sum_{c\in filhos(j)}\gamma\,\frac{goal_c+U_c}{indeg(c)}$$

**Candidatos e valores** ($c_x$ = custo esperado em minutos):

| Tipo | Valor $V_x$ |
|---|---|
| Revisão $k$ (vencida: $R_k\le r_k$, ou pré-requisito em risco de um nó novo de hoje: $R_k<r_k+0.03$) | $V=I_k(1-R_k)/c_k$, inspirado no MEMORIZE |
| Veículo de compressão $n$ (dominado) | $V=\big[\sum_{k\in Due}w^*_{nk}I_k(1-R_k)+[n\in Due]\,I_n(1-R_n)\big]/c_n$ |
| Novo $j$ na fronteira externa | $V=I_j\cdot Ready_j\cdot(1+U_j)/c_j$, com $Ready_j=\prod_{a\in pre(j)}p_aR_a$ |
| Fraco $w$ | $V=I_w(1-p_w)\,B_w\,(1+|desc_{bloq}(w)|)/c_w$, com $B_w$ = culpa com meia-vida de 14 d mais massa de misconceptions ativas |
| Sonda $k$ (inferido) | $V=H_2(p_k)\,(1+|desc(k)|)/c_{probe}$, com $H_2$ = entropia binária |

**Retenção desejada por papel** (estilo Cost ADR): $r_k=0.93$ se $k$ é pré-requisito de um nó da fronteira atual, $0.90$ por padrão e $0.85$ para folhas distantes da fronteira e fora das metas.

**Algoritmo diário** (orçamento $B$ = 120–240 min):

1. **Obrigatórias:** revisões com $R_k<r_k-0.10$ e pré-requisitos em risco dos nós novos planejados.
2. **Compressão gulosa:** enquanto houver Due e o tempo de revisão for ≤ $\rho_{rev}B$ ($\rho_{rev}=0.5$), escolher o maior $V$ entre revisões avulsas e veículos, simular o crédito implícito esperado e recalcular Due. É cobertura de conjunto submodular, e o guloso tem garantia $(1-1/e)$ sob submodularidade. O excedente vai para os próximos dias por prioridade (*load balancing*).
3. **Novos:** $n_{new}=\min\big(n_{max},\lfloor B_{new}/\bar c_{new}\rfloor\big)$, **suspenso** se a carga projetada de 30 dias $\hat L(t,30)>\rho_{rev}B$. $\hat L$ vem de um simulador FSRS que usa $R$ para sortear acertos (o mesmo simulador que pode calibrar XP/rankings por Monte Carlo em outro módulo). Defaults para 3 h/dia: $n_{max}=4$, $\bar c_{new}\approx30$ min. Pela simulação da §2.5, isso cabe com folga.
4. **Restante:** fracos e sondas, intercalados.

**Composição de uma sessão (60–90 min; didática "não cansativa"):**

1. **Aquecimento** (5–10 min): 2–4 revisões intercaladas de subdomínios diferentes.
2. **Nó novo** (25–40 min): explicação em blocos, exemplo resolvido e no máximo **1 pergunta leve de elaboração**, que conta como evidência "imediata" de baixo peso. Recurso escolhido por **Thompson sampling** por (domínio, tipo de recurso), com Beta sobre "passou na checagem atrasada"; o usuário pode sempre trocar.
3. **Mistura** (10–15 min): revisões e veículos de compressão.
4. **Checagem atrasada do nó novo** (≥ 15–20 min depois): 1–2 itens. O FSRS-7 trata bem esse intervalo fracionário.
5. **Fechamento:** 2–3 flashcards propostos (exportáveis para Anki/Obsidian) e uma frase sobre pontos fracos.

**Dificuldade do item:** escolher o nível $\ell$ tal que $P(acerto\mid\ell)=pR(1-s_\ell)+(1-pR)g_\ell\approx0.75$ na prática (faixa 0.70–0.85) e ≈ 0.5 nas sondas. Default $s_\ell$ = 0.05, 0.10, 0.15, 0.25, 0.35, ajustado pelo Elo da família: $s_{k,\ell}\leftarrow\sigma(\mathrm{logit}(s_\ell)+b_{k,\ell}-\theta)$, atualizado com $U(n)=1/(1+0.05n)$.

### 9.10 Pontos fracos e misconceptions

- **Catálogo por nó:** o LLM propõe 3–8 misconceptions ao criar o nó, e elas também aparecem como distratores dos MCQs.
- **Posterior:** Beta(1, 4) por (nó, misconception). Erro marcado com a misconception: $a\mathrel{+}=c$. Acerto em item **diagnóstico** para ela (distrator que a revelaria): $b\mathrel{+}=1$. **Ativa** se $\frac{a}{a+b}\ge0.5$; **resolvida** se < 0.2 após remediação. `newMisconception` do LLM cria uma entrada com prior Beta(1, 4), sujeita a deduplicação semântica.
- **Weak score:** $W_k=(1-p_kR_k)\,I_k\,(1+|desc_{bloq}(k)|)+\sum_m \mathbb{1}[ativa]\cdot\frac{a_m}{a_m+b_m}$. O top-3 vai para o perfil e para o snapshot de memória, em texto curto ("confunde mA com A ao aplicar Ohm").

### 9.11 Parâmetros default

| Parâmetro | Default | Fonte/nota |
|---|---|---|
| Modelo de memória | FSRS-7, `ts-fsrs@6.0.0` (versão exata) | ts-fsrs v6 |
| Pesos FSRS | `FSRS7_DEFAULT_WEIGHTS` até otimizar | srs-benchmark: default ≈ FSRS-4.5 otimizado |
| `desiredRetention` | 0.90 (0.93 pré-requisito da fronteira; 0.85 folhas) | Manual do Anki / Cost ADR |
| `learningSteps` / `relearningSteps` | `['20m']` / `['20m']` (checagem atrasada na sessão) | proposta (o default de flashcard é 1m/10m) |
| `enableFuzz` / `maximumInterval` | true / 1095 d | proposta |
| $T_{lesson}$, $T_0$ prática | 0.25, 0.15 | faixa típica de BKT; ajustar por EM |
| Limiar de maestria | 0.95 + 2 itens + 1 atrasado | Cognitive Tutors (0.95) + proposta |
| Limiar de desbloqueio | $p_aR_a\ge0.85$ ∀ pré-requisito | proposta (ALEKS: fronteira ≈ 0.93 de sucesso) |
| $\varepsilon$ consistência | 0.05 | proposta |
| Emissões | tabela da §9.4 | proposta; ajustar por EM |
| $\kappa$ avaliador | $0.6+0.35\cdot conf$ (1 se determinístico) | proposta, motivada por Hardy 2026 |
| $\lambda$ atribuição LLM | 1.5 | proposta |
| Englobamento | ≤ 3 hops, produto no caminho, máximo entre caminhos, $w^*\ge0.1$, regra speed<1 | FIRe / Graspful |
| Elo | $U(n)=1/(1+0.05n)$ | Pelánek 2016 |
| BLIM | $\beta=0.1$; $\eta=0.05$ aberto, $1/k$ MCQ | KST |
| Planner | $\rho_{rev}=0.5$, $n_{max}=4$/dia (3 h), $\gamma=0.6$, meia-vida de culpa 14 d | proposta |

### 9.12 Calibração e aprendizagem de parâmetros

- **Antes** de cada observação, gravar `predicted = P(ŷ ≥ 2)`. Semanalmente, calcular **log loss, AUC e RMSE(bins)** (métricas do srs-benchmark) com split temporal e comparar com AVG e MOVING-AVG. Mostrar no perfil (stats leves).
- **EM** (estilo pyBKT) para $T$ e emissões por formato quando houver ≥ 300 observações. É pequeno o bastante para TS em um Worker.
- **Otimizador FSRS:** `computeParameters` (binding, WASM em Worker; beta) **por domínio**, cerca de 1×/mês e com ≥ algumas centenas de revisões. Segundo o manual do Anki, "menos que algumas centenas" é dado insuficiente; presets separados para conteúdos de dificuldade muito diferente, aqui Inglês e Eletrônica. Usar `evaluateWithTimeSeriesSplits` e aceitar os novos pesos só se o log loss melhorar.
- **Pesos de englobamento propostos pelo LLM** são o maior risco de erro sistemático. Use teto de 0.7 até validar. Quando um nó englobado é sondado explicitamente, compare o $R$ previsto com o observado e ajuste $w\leftarrow w\cdot\exp(\eta(y-\hat R))$.

### 9.13 Invariantes formais e verificação

Testes de propriedade (`fast-check`, ou o `tsx --test` já usado em `tests/*.test.ts`) no núcleo puro:

1. **Grafo:** pré-requisitos e englobamento acíclicos; referências válidas; $w,\rho\in[0,1]$.
2. **Limites:** $p\in[0,1]$; estado FSRS dentro dos limites ($S\in[10^{-4},36500]$, $D\in[1,10]$).
3. **Monotonicidade da evidência:** se $\tilde e_1(\hat y)\ge\tilde e_0(\hat y)$, então $P(L\mid\hat y)\ge p$, e vice-versa.
4. **Consistência:** após o passe global, $\max_{a\to b}(p_b-p_a-\varepsilon_{ab})\le10^{-6}$.
5. **KST:** $K^*$ é down-set; a fronteira externa satisfaz a definição; reconstruir $K^*$ a partir de (interna, externa) recupera $K^*$ (Teorema 21 para down-sets).
6. **Crédito implícito:** identidade em $w=0$; igual a Good em $w=1$ (exceto $D$); $R(t)$ monótono em $w$.
7. **Determinismo:** `replay(log) === state`; o resultado não depende da ordem de eventos com o mesmo `(at, seq)`.

**Lean 4 (opcional, fora do runtime).** O mathlib tem `LowerSet` com estrutura de reticulado completo (`Mathlib/Order/UpperLower/Basic.lean`, `.../CompleteLattice.lean`), o que dá ∪ e ∩ de down-sets. A prova a fazer é *learning smoothness* para down-sets de uma ordem parcial **finita**: se $K\subset L$, tome $x$ minimal em $L\setminus K$; então $K\cup\{x\}$ é down-set; induza em $|L\setminus K|$. *Learning consistency* segue de down-sets serem fechados sob união. Não encontrei antimatroides no mathlib (busca de código sem resultado). A recomendação é provar os invariantes **estruturais** em Lean e testar os **numéricos** por propriedade em TS.

### 9.14 Integração com o learnharness (proposta de arquivos)

```
src/core/learner/                 ← puro, browser-safe, sem I/O
  types.ts          (§9.2)        params.ts      (§9.11)
  emission.ts       (§9.4 tabelas + confusão do avaliador)
  bkt-fsrs.ts       (§9.4)        dina.ts        (§9.5)
  propagate.ts      (§9.6 a–d)    kst.ts         (§9.7–9.8: down-closure, fringes, partículas)
  planner.ts        (§9.9)        misconceptions.ts (§9.10)
  calibration.ts    (§9.12)       fold.ts        (replay do log → estado)
src/server/learner-store.ts       ← 1 snapshot JSON versionado + log por domínio em ctx.dataDirectory,
                                    escrita atômica (mesmo padrão de docs/flashcards-implementation-plan.md)
tests/learner-*.test.ts           ← propriedades da §9.13
```

- **Entrada:** `conclude` do practice tool (problema + resposta + `target` + `mode`) dispara a correção LLM (JSON zod), cria `Evidence`, chama `fold`/`update` e grava.
- **Flashcards:** o plugin mantém o FSRS-6 por proposição, coerente com o Anki, que ainda está no FSRS-6. Suas revisões entram como evidência `flashcard` com peso 0.3 nos nós-tópico que contêm a proposição. Para estado de memória no nível de nó, o learner model usa FSRS-7, porque precisa de intervalos fracionários na sessão.
- **Isolamento:** um store e um `DomainProfile` por domínio. O perfil global guarda só orçamento e preferências.
- **Saída para a memória de contexto:** `snapshot(domain)` gera ~300 tokens com fronteira externa (top 5), topo dominado (top 5), top-3 fracos com misconception em texto, número de revisões vencidas e plano de hoje. Assim o tutor sabe **onde o aluno está, para onde vai e onde tropeça**.

### 9.15 Custo e desempenho

- **Atualização:** O(grau^h) com h ≤ 3, microssegundos a milissegundos. **Planner diário:** O(N log N) sobre ≤ 10⁴ nós. **Partículas:** ~750 KB e milissegundos por pergunta.
- **LLM:** 1 chamada pequena de correção por resposta aberta (MCQ e numérico são determinísticos). A matriz Q, a dificuldade e os distratores com misconception vêm no mesmo call da geração do item. Não há chamada de LLM para predizer desempenho.

---

## 10. Riscos e questões em aberto

1. **FSRS em nós conceituais.** O FSRS foi treinado em flashcards; revisar um nó com **itens variados** muda a dinâmica (o próprio `docs/flashcards-vision.md` alerta para isso no caso proposição×cue). Mitigar com calibração contínua (§9.12) e otimização por domínio.
2. **ts-fsrs v6 é recente** (3 semanas) e o otimizador é beta. Fixar a versão exata e manter o fallback `version: 'FSRS-6'` (mesma API). Se preferir zero dependência, portar o FSRS-7 como o plano de flashcards fez com o FSRS-6, com testes de referência contra a lib.
3. **Pesos de englobamento gerados por LLM** podem inflar crédito implícito e criar ilusão de retenção. Usar teto, regra speed<1, sondas e ajuste por dados.
4. **Viés e ruído do avaliador LLM** em decisões de maestria. Exigir auto-consistência e permitir que o aluno "conteste".
5. **Churn do grafo:** IDs estáveis, aliases, e nunca apagar evidência.
6. **Transferência entre domínios** (matemática dentro de Eletrônica): v1 mantém subdomínios dentro do domínio. LT-MKT (2026) indica caminho futuro.
7. **Validação externa:** não há dataset público com o nosso formato (diálogo + grafo + LLM grading). O próprio log do usuário vira o benchmark; vale considerar opt-in anônimo no futuro.

---

## 11. Checklist de implementação (ordem sugerida)

1. `types.ts`, `params.ts`, `emission.ts`, `bkt-fsrs.ts` com testes 2–3 (§9.13).
2. `fold.ts` com event log por domínio e store atômico.
3. `kst.ts`: down-closure, fringes, status; testes 4–5.
4. `propagate.ts`: consistência, crédito implícito (via `scheduler.preview`) e penalidades; testes 4 e 6.
5. Avaliador LLM (zod) e mapeamento do practice tool para `Evidence`.
6. `planner.ts`: plano diário e de sessão; simulador FSRS para $\hat L$.
7. `dina.ts`, `misconceptions.ts`, snapshot para a memória.
8. Diagnóstico inicial por partículas.
9. `calibration.ts`, EM e integração do otimizador FSRS (Worker).

---

## 12. Referências (fontes primárias consultadas)

**FSRS / SRS**
- srs-benchmark (README, tabelas, defaults FSRS-7): https://github.com/open-spaced-repetition/srs-benchmark
- Dataset: https://huggingface.co/datasets/open-spaced-repetition/anki-revlogs-10k
- Wiki "The Algorithm" (FSRS-7/6/5…): https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- ts-fsrs (MIT) e release v6.0.0: https://github.com/open-spaced-repetition/ts-fsrs/releases · docs: https://open-spaced-repetition.github.io/ts-fsrs/llms.txt · FSRS-7: https://open-spaced-repetition.github.io/ts-fsrs/guide/model/fsrs-7.md · FSRS-6: https://open-spaced-repetition.github.io/ts-fsrs/guide/model/fsrs-6.md · Scheduler API: https://open-spaced-repetition.github.io/ts-fsrs/api/ts-fsrs/scheduler.md · Otimizador: https://open-spaced-repetition.github.io/ts-fsrs/guide/optimizer/index.md · Middlewares (Cost ADR): https://open-spaced-repetition.github.io/ts-fsrs/guide/middleware/built-in.md
- fsrs-rs v7.0.0: https://github.com/open-spaced-repetition/fsrs-rs/releases
- Anki releases (26.11b1): https://github.com/ankitects/anki/releases · Manual (desired retention, otimização): https://github.com/ankitects/anki-manual/blob/main/src/deck-options.md · Fórum FSRS-7: https://forums.ankiweb.net/t/when-will-anki-integrate-fsrs-7/69997
- Electron releases (Node 24.22 no Electron 44): https://github.com/electron/electron/releases
- SM-2: https://super-memory.com/english/ol/sm2.htm
- HLR (Settles & Meeder 2016): https://github.com/duolingo/halflife-regression
- KARL (Shu et al., EMNLP 2024): https://arxiv.org/abs/2402.12291
- MEMORIZE (Tabibian et al., PNAS 2019): https://doi.org/10.1073/pnas.1815156116
- SSP-MMC (Ye, Su & Cao, KDD 2022): https://doi.org/10.1145/3534678.3539081
- SBD: https://doi.org/10.5281/zenodo.22727105

**Knowledge tracing / IRT / Elo**
- pyKT (MIT): https://github.com/pykt-team/pykt-toolkit · paper: https://arxiv.org/abs/2206.11460 · site: https://pykt.org/
- simpleKT (ICLR 2023): https://arxiv.org/abs/2302.06881
- DKT: https://arxiv.org/abs/1506.05908 · SAKT: https://arxiv.org/abs/1907.06837 · AKT: https://arxiv.org/abs/2007.12324
- pyBKT (MIT): https://github.com/CAHLR/pyBKT
- Khajah, Lindsey & Mozer 2016, *How deep is knowledge tracing?*: https://arxiv.org/abs/1604.02416
- Gervet et al. 2020 (JEDM): https://jedm.educationaldatamining.org/index.php/JEDM/article/view/451
- DAS3H (EDM 2019): https://arxiv.org/abs/1905.06873
- Pelánek 2016, Elo em sistemas adaptativos (manuscrito): https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
- Dificuldade por LLM (BEA 2024; ICC): https://arxiv.org/abs/2601.02580 · https://aclanthology.org/2024.bea-1.49.pdf
- Eedi, *Specialised KT Models Outperform LLMs*: https://arxiv.org/abs/2603.02830
- FoundationalASSIST: https://arxiv.org/abs/2602.00070
- LLMKT em diálogos (LAK 2025): https://arxiv.org/abs/2409.16490 · KT difficulty-aware em diálogos: https://arxiv.org/abs/2605.01097
- KCQRL: https://arxiv.org/abs/2410.01727 · ConceptKT: https://arxiv.org/abs/2603.24073 · RPKT: https://arxiv.org/abs/2508.11892
- NTKT: https://arxiv.org/abs/2511.02599 · LLM-KT: https://arxiv.org/abs/2502.02945 · Thinking-KT: https://arxiv.org/abs/2601.01708 · MERIT: https://arxiv.org/abs/2603.22289 · LOKT: https://arxiv.org/abs/2410.12872 · LT-MKT: https://arxiv.org/abs/2608.24005 · Agentic BKT: https://arxiv.org/abs/2606.25358 · Responsible-DKT: https://arxiv.org/abs/2604.08263

**KST / ALEKS**
- Doignon & Falmagne, *Knowledge Spaces and Learning Spaces*: https://arxiv.org/abs/1511.06757
- ALEKS, *Assessing learning space*: https://www.mheducation.com/content/dam/mhe/research/prek-12/essa-tier-4/aleks-assessing-learning-space.pdf
- Steiner & Hochweber 2026, benchmark LLM × KST: https://github.com/pstnr/Benchmarking-LLM-Next-Step-Recommendations-with-Knowledge-Space-Theory
- knowledge-spaces (MIT): https://github.com/vanderbilt-data-science/knowledge-spaces · kst (Python): https://github.com/milansegedinac/kst · kst (R): https://github.com/cran/kst
- mathlib `LowerSet`: https://github.com/leanprover-community/mathlib4/tree/master/Mathlib/Order/UpperLower

**Grafos / FIRe**
- Skycak, HSRS/FIRe: https://justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/
- Graspful (docs): https://graspful.vercel.app/docs/concepts/spaced-repetition
- open-mastery (local): `_refs/open-mastery/engine/README.md`, `_refs/open-mastery/docs/GRAPH_FORMAT.md`, `_refs/open-mastery/tasks/010-encompassing-relationships.md`
- DeepTutor (local, Apache-2.0): `_refs/DeepTutor/deeptutor/learning/{mastery.py,scheduler.py,semantic_assessment.py,grading.py}`

**Diagnóstico / avaliação**
- Survey CDM: https://arxiv.org/abs/2407.05458 · NeuralCD: https://arxiv.org/abs/1908.08733
- Hardy 2026, meta-análise de autoscoring: https://arxiv.org/abs/2603.04820

**Seleção / política**
- ZPDES/RiARiT (JEDM 2015): https://arxiv.org/abs/1310.3174
- Wilson et al. 2019, *The Eighty Five Percent Rule*: https://doi.org/10.1038/s41467-019-12552-4
- Doroudi, Aleven & Brunskill 2019, *Where's the reward?*: https://doi.org/10.1007/s40593-019-00187-x

**learnharness (contexto local)**
- `src/core/contracts/graph.ts` (GraphNode/GraphEdge/GraphChain), `src/core/practice-problems.ts`, `src/agent/tools/practice.ts`, `docs/flashcards-vision.md`, `docs/flashcards-implementation-plan.md`, `package.json` (electron ^44.9.3, zod ^4.4.3)
