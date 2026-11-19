# Currículo de Inglês: seed, etapas 1 a 3

Grafo de currículo do domínio `english` (prefixo de nó `en`). Vai do A1 ao C2 e é pensado para um falante nativo de português brasileiro. Inclui uma trilha de inglês acadêmico e técnico para ler e escrever papers de engenharia.

- **Etapa 1 (esqueleto).** Áreas, unidades e tópicos `stub` de 1 a 4 h, conforme `docs/research/00-SINTESE.md` §2.4(e) "Seed (fase 1)" e §2.7, e `docs/research/r3-geracao-curriculo-grafo.md` §3.2, §4 e §5.3.
- **Etapa 2 (átomos).** As duas áreas de entrada foram refinadas em átomos de 10–45 min:
  - `en.pron`: unidades `foundations`, `vowels`, `consonants` e `morphophonology` (A1–A2);
  - `en.grammar`: unidades `a1`, `a2` e `a2-plus`.
- **Etapa 3 (revisão pedagógica adversarial).** Revisão de todo o grafo contra ementas reais (CEFR-J GP/EGP, CEFR CV, Cambridge GLH, Swales & Feak/Academic Phrasebank) e contra os erros de transferência típicos do PT-BR. Foram acrescentados 16 tópicos `stub`, corrigidos pré-requisitos, níveis, títulos e resumos. Ver a seção "Etapa 3" abaixo.

O resto do grafo continua em `stub`. Ele será refinado pela expansão lazy (`refine`).

## Arquivos

Cada arquivo segue `CurriculumSeedFile` (`src/core/curriculum/types.ts`).

| Arquivo | Área | Conteúdo |
|---|---|---|
| `00-root.json` | `en` | Raiz (domain) e as 10 áreas |
| `01-pron.json` | `en.pron` | Pronúncia e fonologia para PT-BR: th, vogais curtas e longas, schwa, consoantes finais, -ed/-s, ritmo, fala conectada, entonação, sotaques. **Com átomos** nas 4 unidades de base |
| `02-grammar.json` | `en.grammar` | Gramática A1→C2 (CEFR-J GP / EGP por referência). **Com átomos** em A1, A2 e A2+ |
| `03-vocab.json` | `en.vocab` | Conjuntos lexicais por banda NGSL/CEFR-J, Octanove C1/C2, NAWL/AWL, colocações, phrasal verbs, falsos cognatos |
| `04-listening.json` | `en.listening` | Compreensão oral por escala do CEFR CV e estratégias |
| `05-reading.json` | `en.reading` | Leitura por escala do CEFR CV e estratégias |
| `06-speaking.json` | `en.speaking` | Produção e interação oral |
| `07-writing.json` | `en.writing` | Escrita geral e profissional |
| `08-pragmatics.json` | `en.pragmatics` | Registro, polidez, cultura e mediação (PT↔EN) |
| `09-academic.json` | `en.academic` | Vocabulário técnico de eletrônica, datasheets, papers (ler, criticar, escrever, responder a pareceristas), comunicação técnica e frentes de leitura pós-C1 |
| `10-fluency.json` | `en.fluency` | Regimes de prática (`practice`): leitura e escuta extensivas, shadowing, conversação, 4/3/2, escrita cronometrada |

## Números (após a etapa 3)

| Área | Unidades | Tópicos | Átomos | Horas estimadas (lo–hi, média) | Σ das folhas (lo–hi) |
|---|---:|---:|---:|---|---|
| en.pron | 8 | 51 | 122 | 94–145 (119,5) | 93,35–140,7 |
| en.grammar | 9 | 115 | 156 | 180,5–295,5 (238) | 182,38–288,5 |
| en.vocab | 8 | 78 | — | 185–257 (221) | 185–257 |
| en.listening | 6 | 42 | — | 106,5–148,5 (127,5) | 106,5–148,5 |
| en.reading | 6 | 38 | — | 91,5–129,5 (110,5) | 91,5–129,5 |
| en.speaking | 6 | 44 | — | 108,5–152,5 (130,5) | 108,5–152,5 |
| en.writing | 6 | 41 | — | 98–139 (118,5) | 98–139 |
| en.pragmatics | 5 | 28 | — | 40,5–68,5 (54,5) | 40,5–68,5 |
| en.academic | 9 | 55 | — | 131–182,5 (156,75) | 131–182,5 |
| en.fluency | 8 | 73 | — | 208,5–268 (238,25) | 208,5–268 |
| **Total** | **71** | **565** | **278** | **1.244–1.786 (1.515)** | **1.245,23–1.774,7 (1.509,96)** |

**Nós.** São 925 no total: 1 domain, 10 areas, 71 units, 565 topics e 278 atoms. Desses, 771 são folhas (493 `stub`).

**Átomos por unidade:**

| Unidade | Tópicos | Refinados | Átomos |
|---|---:|---:|---:|
| `en.pron.foundations` | 7 | 7 | 28 |
| `en.pron.vowels` | 7 | 7 | 29 |
| `en.pron.consonants` | 12 | 12 | 48 |
| `en.pron.morphophonology` | 4 | 4 | 17 |
| `en.grammar.a1` | 21 | 21 | 76 |
| `en.grammar.a2` | 14 | 13 | 49 |
| `en.grammar.a2-plus` | 11 | 8 | 31 |

Os tópicos não refinados de `a2` e `a2-plus` são os stubs novos da etapa 3.

**Átomos por tipo:** 110 procedure, 73 concept, 41 lexical_set, 31 phoneme_contrast, 22 can_do e 1 checkpoint.

**Avaliação (`assess`) dos átomos:** mcq 138, short 120, speak 120, dictation 38, minimal_pair 37 e explain 12.

**Arestas e anotações no domínio inteiro:**

- 178 cláusulas `requires`;
- 182 `softPrereqs`;
- 87 `encompasses`, dos quais 69 estão em átomos;
- 70 arestas não bloqueantes: 56 `related` e 14 `confusable_with`;
- 81 nós com `practice`;
- 120 nós com `lexicalItems`, dos quais 41 são átomos;
- 236 nós com `misconceptions` (178 átomos).

**Horas por nível CEFR (Σ das folhas, acumulado).** A1 136–207 · A2 314–474 · B1 603–891 · B2 910–1.313 · C1 1.143–1.635 · C2 1.245–1.775. Ver "Horas" na etapa 3.

## Decisões

### Etapa 1 (esqueleto)

- **IDs.**
  - O formato é `en.<área>.<unidade>.<tópico>`, com slugs em inglês.
  - As unidades são por faixa CEFR/GSE: `a1`, `a2`, `a2-plus`, `b1`, `b1-plus`, `b2`, `b2-plus`, `c1`, `c2`.
  - Algumas áreas têm unidades temáticas, como `en.pron.vowels`, `en.academic.paper-reading` e `en.pragmatics.mediation`.
  - O id do pai é sempre prefixo do id do filho.
- **Arestas suaves por padrão** (r3 §11.4; SÍNTESE §2.7).
  - `requires` (`clauses`) aparece só onde a dependência bloqueia de verdade. Exemplos:
    - na gramática, *present perfect continuous* exige *present perfect for/since* e *present continuous*;
    - na consciência fonêmica, -ed/-s exigem vozeamento e consoantes finais.
  - Nunca há mais de uma alternativa por nó. O modo estrito permite até 2.
  - O resto é `softPrereqs` (builds_towards).
  - Algumas unidades de pronúncia têm cláusula de **entrada** (cláusula de container), herdada pelos tópicos-fonte. Exemplo: `en.pron.vowels` exige `en.pron.foundations.vowel-system`.
- **Níveis.**
  - `level` = `{scheme:"cefr", cefr, gse}`.
  - O `gse` é aproximado e serve só de referência, mas fica sempre dentro da faixa GSE do seu nível CEFR (A1 22–29, A2 30–42, B1 43–58, B2 59–75, C1 76–84, C2 85–90).
  - Áreas e raiz usam o menor nível dos filhos.
- **Horas.**
  - Cada tópico tem `lo = h − 0,5` e `hi = h + 0,5`, com limite de 1 a 4 h.
  - Unidades, áreas e raiz somam exatamente as horas dos filhos.
  - As estimativas incluem revisão espaçada:
    - +25% em gramática, vocabulário e pronúncia;
    - +15% nas habilidades;
    - +10% no acadêmico;
    - 0% nos blocos de prática, que já são orçados em horas.
  - A calibração usa as GLH da Cambridge: A1→C2 ≈ 1.030–1.450 h acumuladas.
  - Cerca de 16% das horas vão para regimes de prática explícitos (`en.fluency`).
- **Prática.**
  - Os regimes (`practice.targetHours` + `exitCriterion`) são blocos de ≤ 4 h com material distinto por nível.
  - Depois do C1, o crescimento acontece por **frentes de leitura** (`en.academic.research-fronts.*`).
- **Conjuntos lexicais nos tópicos.**
  - `lexicalItems` traz 5 a 10 lemas *representativos* por tópico. Não é a lista completa.
  - Ranks NGSL só aparecem como faixa na âncora da unidade. Nenhum rank é inventado por palavra.

### Etapa 2 (átomos)

**Forma do átomo.** Cada tópico refinado vira um container de 3 a 8 átomos. Cada átomo tem:

- `kind:"atom"` e um `atomType`: `concept`, `procedure`, `lexical_set`, `phoneme_contrast`, `can_do` ou `checkpoint`;
- de 1 a 3 `objectives` avaliáveis, em PT-BR;
- `bloom`, com padrão por tipo:

  | Tipo | `bloom` |
  |---|---|
  | concept | understand |
  | procedure | apply |
  | lexical_set | remember |
  | phoneme_contrast | apply |
  | can_do | apply |
  | checkpoint | analyze |

- `assess`, que usa o vocabulário `PRACTICE_ITEM_KINDS` de `src/core/lesson/protocol.ts`: `mcq`, `short`, `speak`, `dictation`, `minimal_pair` e `explain`;
- `level` copiado do tópico;
- `status:"provisional"`. O tópico refinado também passa de `stub` para `provisional`.

**Horas.**

- Cada átomo tem 30 ou 35 min no ponto médio.
- `lo` e `hi` ficam a ±20% do médio e incluem a mesma sobrecarga de revisão espaçada das estimativas dos tópicos.
- O tópico refinado **mantém** as horas da etapa 1 como estimativa pré-refinamento.
- A conservação é medida como Σ átomos / estimativa do tópico:
  - nos 72 tópicos, a razão fica entre 0,902 e 1,000, com média 0,972;
  - a tolerância do `refine` é ±25% (`REFINE_EPSILON`).

**Ordem e dependências.**

- Dentro de um tópico, os átomos vão em geral de perceber/entender para produzir/usar. Para isso, são usadas `clauses` entre irmãos. Por exemplo, a produção de um contraste exige a percepção.
- Há só 5 cláusulas entre tópicos, todas em átomos que comparam ou combinam duas estruturas:
  - `present-simple-neg-q.be-vs-do` exige as perguntas com *be*;
  - `present-continuous.now-vs-routine` exige o *present simple*;
  - `wh-questions.word-order` exige as perguntas sim/não com *do*;
  - `past-simple-neg-q.was-vs-did` exige as perguntas com *was/were*;
  - `present-perfect-experience.vs-past` exige o *past simple* regular.
- As demais ligações entre tópicos e entre áreas são `softPrereqs`. Exemplos:
  - `-ed` (pronúncia) leva à forma `-ed` do *past simple* (gramática);
  - `-s` leva à terceira pessoa;
  - as contrações levam a *verb be*, *will* e *can/can't*.

**`encompasses`.** É usado quando um átomo pratica outro: o átomo de uso ou de produção engloba os átomos anteriores que ele exercita. São 69 ligações em átomos, com pesos de 0,3 a 0,5, e todo alvo é pré-requisito efetivo.

**Erros típicos de PT-BR (`misconceptions`).** Foram escritos para cada átomo em que o erro é previsível: vogal epentética (*big[i]*), `-ed` como sílaba extra, *th* trocado por /f/ ou /t/, vogal nasalizada no lugar de consoante nasal, *h* de cognato lido como mudo, *red* lido como "hed", acento do cognato português, *have* no lugar de *there is*, adjetivo depois do substantivo ou no plural, sujeito omitido, *I have 25 years*, presente contínuo para rotinas e com verbos de estado.

**Conjuntos lexicais nos átomos (`lexical_set`).** Cada um tem pelo menos 5 lemas `{lemma, pos}`, sem CEFR inventado por lema. Formas parecidas não entram no mesmo lote (r1 §8.2): *thought/bought/brought* ficam em lotes diferentes e depois vem um átomo `contrast-similar`.

**Pronúncia.** Os átomos `phoneme_contrast` seguem HVPT: várias vozes, pares mínimos, percepção antes de produção. `en.pron.foundations.consonant-system.consonant-diagnostic` é um `checkpoint` que mapeia os contrastes que o aluno já domina.

**Correções no esqueleto feitas na etapa 2.** Redução transitiva em `en.pron.morphophonology.s-endings`; tópico novo `en.grammar.a1.adjective-position`; `en.grammar.a1.dummy-subjects` retitulado para cobrir só o *it*.

### Etapa 3 (revisão pedagógica adversarial)

A revisão comparou o grafo com o inventário do CEFR-J Grammar Profile e do EGP (por referência), com as escalas do CEFR CV, com as GLH da Cambridge e com a estrutura de cursos de escrita acadêmica (seções de paper, resposta a pareceristas). O critério para acrescentar um tópico foi: estrutura ou habilidade presente nas ementas de referência **e** sem cobertura em nenhum tópico ou átomo existente, com prioridade para erros de transferência do PT-BR.

**Tópicos novos (16 stubs).**

| Id | Nível | Por quê |
|---|---|---|
| `en.grammar.a2.prepositions-movement` | A2 | into/out of/across/through não existiam; *enter in the room*, *ran in the house* |
| `en.grammar.a2-plus.might-may-possibility` | A2 | possibilidade com *might/may* só aparecia como dedução (B1+); *I maybe go* |
| `en.grammar.a2-plus.purpose-infinitive` | A2 | *to/in order to* de finalidade; *I went there for buy* |
| `en.grammar.a2-plus.reflexive-pronouns` | A2 | reflexivos e *each other*; verbos pronominais do PT (*I feel myself*, *they love themselves* = se amam) |
| `en.grammar.b1.so-neither-agreement` | B1 | *So do I / Neither do I* só existia em B2+ (elipse); *Me too* para negativa |
| `en.grammar.b1.two-object-verbs` | B1 | *explain me*, *said me*, *give to me the book* |
| `en.grammar.b1.make-let-help` | B1 | *made me to cry*, *let me to explain*; *be allowed to* como passiva de *let* |
| `en.grammar.b1.advice-expectation-modals` | B1 | *had better*, *ought to*, *be supposed to* não existiam |
| `en.grammar.b1.dependent-prepositions` | B1 | *depend of*, *married with*, *dream with*, *interested on* |
| `en.grammar.b1-plus.comparison-advanced` | B1 | *much/far + comparativo*, *twice as … as*, *the more…, the more…* |
| `en.vocab.a1.countries-nationalities` | A1 | campo lexical A1 central que faltava; maiúscula em nacionalidades |
| `en.speaking.a1.spelling-aloud` | A1 | só havia a escuta do alfabeto; nomes das letras (*e/i*, *g/j*) e ditar e-mail |
| `en.writing.b1.sentence-boundaries` | B1 | comma splices, run-ons e fragmentos ao transpor frases longas do PT |
| `en.academic.academic-writing.discussion-conclusion` | C1 | a escrita do paper tinha abstract, introdução, métodos e resultados, mas não discussão/conclusão |
| `en.academic.academic-writing.reviewer-response` | C1 | carta de resposta a pareceristas, fecho do ciclo de publicação |
| `en.academic.research-fronts.front-digital-ic` | C1 | faltava a frente de digital/VLSI/CI, que corresponde às áreas `digital` e `ic` do domínio de eletrônica |

**Pré-requisitos.**

- Cláusulas novas, todas de formas sem as quais a estrutura não se produz:
  - `en.grammar.b1.second-conditional` passou a exigir também `en.grammar.a2.past-simple-irregular` (*If I had…*);
  - `en.grammar.b2.future-continuous-perfect` exige `en.grammar.a2.past-participles` e `en.grammar.a1.present-continuous`;
  - `en.grammar.b2.past-modals-regret` exige `en.grammar.a2.past-participles`, como já faziam passiva, causativo e dedução no passado.
- **Tarefas de habilidade antes da forma.** 18 tópicos de fala, escrita e prática englobavam (`encompasses`) uma estrutura ou um conjunto lexical sem nenhuma ligação de ordem com ele. Por exemplo, `en.speaking.a2.past-events` praticava `en.grammar.a2.past-simple-irregular`. Cada alvo de `encompasses` virou também `softPrereq` do nó, para o planner estudar a forma antes da tarefa sem gating duro. O aviso canônico `encompasses-non-ancestor` continua, porque só cláusulas contam como pré-requisito, e é intencional (FIRe, r1 §8.5).
- `en.grammar.b2-plus.ellipsis-substitution` ganhou `softPrereq` do novo tópico de *so/neither*, e seu resumo deixou de repetir esse conteúdo.

**Níveis (GSE fora da faixa CEFR, 72 nós corrigidos).**

- Os `gse` interpolados por unidade estouravam a faixa do nível declarado em `pron` (IPA e ortografia com GSE < 22; vogais "A1" com GSE 31–34; consoantes "A2" com GSE 26–29; tópicos B1 e C1 com GSE de B2 e C2), `vocab.strategies`, `vocab.academic`, `pragmatics.mediation`, `academic.*` e `fluency.a1`. Os átomos herdaram o novo `gse` do tópico.
- Alguns rótulos CEFR também mudaram: em `vocab.strategies`, *dictionary-skills*, *guessing-from-context* e *word-families* passaram a A2; em `pragmatics.mediation`, *explain-data*, *facilitate-collaboration* e *explain-to-non-experts* passaram a B2 (escalas de mediação do CEFR CV).

**Títulos, resumos e erros técnicos.**

- `en.grammar.b2.modals-ability-permission-past`: o id prometia permissão, mas o conteúdo era só habilidade. Agora inclui *was allowed to*.
- `en.grammar.b1.question-tags`: inclui perguntas negativas e como respondê-las (2–3 h).
- `en.grammar.b1-plus.determiners`: inclui *all/most/none of* (2–3 h).
- `en.grammar.b1.gerunds-infinitives`: inclui *-ing* depois de preposição (*before leaving*).
- `en.pron.vowels.trap-dress`: o título usa /e/, como o quadro vocálico e os átomos do tópico.
- `en.pron.consonants.final-z-s.noun-verb`: *close* é adjetivo, não substantivo; resumo corrigido.
- `en.pron.consonants.aspiration.after-s`: o objetivo é de produção, por isso o tipo passou de `concept` para `procedure`.
- `en.pron.morphophonology.stress-shift.families`: o conjunto tem cinco famílias, não quatro.
- `en.vocab.a2.false-friends-1`: *exquisite* (C2) saiu do lote A2. Entrou *notice* (≠ notícia).
- `en.academic.technical-vocab.math-aloud`: inclui o ponto decimal, com o erro *two comma five* e a leitura de potências negativas.
- `en.academic.research-fronts.front-rf`: "rf" passou a "RF".

**Horas.**

- As horas das áreas subiram de 1.220,5–1.747 h para 1.244–1.786 h, por causa dos 16 tópicos novos e de dois tópicos ampliados. Unidades, áreas e raiz continuam com a soma exata dos filhos.
- A distribuição por nível fica acima das GLH até o B2 (Σ acumulado das folhas até B2: 910–1.313 h, contra 530–750 GLH). A diferença tem três causas, todas intencionais:
  - a sobrecarga de revisão espaçada;
  - os blocos de prática extensiva;
  - a pronúncia dedicada ao PT-BR.
- O C2 recebe só 102–140 h, contra 300–400 GLH de C1→C2. Isso é deliberado: a meta do domínio é **C1 sólido com C2 parcial** (r3 §5.1 e §5.3). Depois do C1, o crescimento vem das frentes de leitura e da expansão lazy, e não de horas pré-orçadas.

### Licenças

- Todo o texto foi escrito do zero.
- As âncoras de fontes proprietárias ou NC são só referências, com `embeddable:false`: descritores CEFR CV (nome da escala + nível), EGP/EVP, GSE (faixa), Academic Phrasebank e IEEE.
- NGSL, NAWL, Octanove e CEFR-J estão marcados `embeddable:true`, porque a licença permite.
- Ver `../LICENSE` (CC BY-SA 4.0).

## Validação

1. **Pipeline canônico.** `node scripts/run-tests.mjs "tests/curriculum-seeds.test.ts"`. Ele roda `applySeedFiles` → `validateReport` (`src/core/curriculum/ledger.ts`, `invariants.ts`).
   - Carrega o seed em modo estrito, confere o certificado e o replay do ledger e percorre todas as folhas pela fronteira externa.
   - Resultado: passa, com 0 erros.
   - Ficam 18 avisos `encompasses-non-ancestor`, todos de habilidade → gramática/vocabulário. São intencionais (ver "Pré-requisitos" acima).
2. **Validador externo da etapa 3.** É um script descartável, fora do repositório. Ele verifica:
   - JSON válido, `schemaVersion`, `domainId` e `sources` declaradas para toda âncora;
   - ids únicos e no padrão, pai existente e prefixo imediato, e `kind` coerente com a profundidade e com o `kind` do pai;
   - toda referência em `clauses`, `softPrereqs`, `encompasses` e `edges` existente;
   - cláusulas sem ligar ancestral e descendente, com ≤ 2 alternativas por nó e sem subir de nível CEFR;
   - `gse` dentro da faixa do nível CEFR;
   - `lo ≤ hi`;
   - átomos de 10–45 min, com 1–3 objetivos, `atomType` e `assess`;
   - `lexical_set` com ≥ 5 lemas;
   - conservação de ±25% nos tópicos refinados e soma exata nos demais containers;
   - `order` 0..n−1 entre irmãos;
   - ausência de ciclos no grafo efetivo e no grafo conjunto:
     - p → q por cláusula;
     - filho → container;
     - cláusulas de container → filhos-fonte (recursivo);
     - no grafo conjunto, também `softPrereqs` e `encompasses`;
   - redundância transitiva nas cláusulas.

   Resultado: 0 erros e 0 avisos.
