# R1 — Pedagogia e ciência da aprendizagem para tutores com IA (2023–2026), com foco em didática NÃO cansativa

> Relatório de pesquisa `r-pedagogy` para o fork do learnharness (Next.js 16 + Electron + TS + pi-agent-core, AGPL-3.0).
> Data de referência: 2026-11-18. Idioma: PT-BR (termos técnicos em inglês quando consagrados).
> Escopo: evidência sobre tutoria com LLM, ciência da aprendizagem aplicável, metodologia Math Academy (grafo + FIRe),
> diagnóstico de "por que tutores de IA cansam", protocolo concreto de aula por nó, prompts de sistema, e especificidades
> para Inglês e Eletrônica.

**Legenda de evidência** usada ao longo do texto:
`[RCT]` ensaio randomizado · `[META]` meta-análise · `[LAB]` experimento de laboratório · `[OBS]` observacional/log ·
`[PRÁTICA]` documentação de produto/prompt de praticantes (não é evidência causal) · `[INFERÊNCIA]` conclusão minha a partir das fontes.

**Régua de tamanho de efeito em educação** (Kraft 2020, *Educational Researcher* 49(4)): em RCTs educacionais com
desfechos padronizados, < 0,05 DP é pequeno, 0,05–0,20 DP é médio, ≥ 0,20 DP é grande. Efeitos de 0,5–1,0 DP só costumam
aparecer em testes alinhados ao conteúdo ensinado e intervenções curtas — não confundir com ganho em prova ampla.

---

## 0. Sumário executivo (o que fazer, em 14 pontos)

1. **Tutor de IA bem desenhado funciona; tutor "ChatGPT cru" atrapalha.** Harvard (Kestin et al., *Sci Rep* 2025) obteve
   0,63 DP (regressão) / 0,73–1,3 DP (regressão quantílica) com um tutor GPT-4 *breve, reativo, um passo por vez, com
   soluções pré-escritas*. Bastani et al. (*PNAS* 2025): GPT-4 sem guardrails melhorou a prática em 48% mas **piorou a
   prova sem IA em 17%**; a versão "GPT Tutor" (com dicas e sem entregar respostas) melhorou a prática em 127% e
   neutralizou o dano.
2. **O maior RCT recente (Google/Eedi, out/2026, N = 1179, 10 semanas)** mostra: tutor Gemini ≈ tutor humano especialista
   em medidas próximas (correção de erro 56,9% vs 57,7%; transferência próxima 58,4% vs 59,1%; retenção > 7 dias ≈ 59–60%
   vs 47,6% no controle), **mas nenhum ganho em prova padronizada ampla** — tutoria longa reduziu a cobertura (99 vs 132
   unidades). E os tutores humanos que supervisionavam a IA **intervinham sobretudo no fim das conversas para deixar o aluno
   seguir em frente**, em vez de continuar a sequência de perguntas guiadas. 29,5% das conversas tinham pedido para sair cedo.
   Isso é a evidência mais direta de que *"perguntar demais" é o principal defeito do tutor de IA atual*.
3. **Personalização via "jogar histórico no prompt" não ajudou** no RCT Eedi 2026 (contexto personalizado ≈ só contexto da
   questão). Memória precisa virar **decisões operacionais** (qual item, qual dificuldade, qual pré-requisito remediar), não
   texto extra no prompt. `[INFERÊNCIA]`
4. **Estrutura deve ser imposta pela plataforma, não pelo prompt.** Kestin et al.: "a system prompt could not reliably
   provide enough structure to scaffold problems with multiple parts" — a plataforma sequenciava as partes. → Implementar a
   aula como **máquina de estados** que chama o LLM por fase.
5. **Dê ao LLM soluções verificadas** (Harvard: soluções passo a passo no prompt; Eedi: solução correta + misconception
   escrita por educador). Em Eletrônica, a verdade vem de um solver/simulador; em Inglês, de respostas de referência.
6. **Granularidade de checagem: "passo de problema", não "frase".** VanLehn (2011): tutoria humana d = 0,79; ITS por passo
   d = 0,76; ITS por *sub*passo d = 0,40 (não melhor). Checar cada micro-passo não rende mais e cansa. A regra atual do
   learnharness ("one check per reasoning step", `docs/teaching-methodology.md` §9 e `src/agent/prompts/teacher/20-teaching.md`)
   deve migrar para **checagem por knowledge point (KP)** com prática real.
7. **Perguntas devem ser "fazer", não "falar sobre".** Math Academy: cada KP = exemplo resolvido + 2–5 problemas parecidos;
   a esmagadora maioria do tempo é resolução ativa, e 95% dos alunos passam a lição na 1ª tentativa. Perguntas
   conversacionais ("faz sentido?", "o que eu acabei de dizer?") são o que cansa — proibir.
8. **Orçamento de perguntas por nó**: ≤ 1 pergunta por mensagem; ≤ 3 perguntas conversacionais por nó (1 previsão, 1
   autoexplicação, 1 fechamento opcional); 4–12 itens de prática adaptativos; no máximo 2 turnos seguidos terminando em
   pergunta; Socrático no máximo 2–3 rodadas antes de explicar.
9. **Mire ~80–85% de acerto na prática** (Math Academy calibra quizzes para ~80%; "regra dos 85%" de Wilson et al. 2019 é
   teórica). Abaixo disso, o aluno sente teste; acima, tédio.
10. **Nunca retenha informação improdutivamente**: escada de dicas (pista → princípio → próximo passo → solução) e entregar
    a resposta após 2 tentativas ou pedido explícito (Harvard permitia "UNLESS they demand"). O rubric do LearnLM tem item
    explícito: "doesn't ask the student too many questions, unproductively withholding information".
11. **Espaçamento + recuperação + intercalação** são os motores de retenção (meta-análises: testing g ≈ 0,61; self-explanation
    g = 0,55; interleaving g = 0,42 geral, 0,34 em matemática e **negativo (−0,39) para palavras**). Para um grafo de 1000–1500 h,
    use **FIRe** (Fractional Implicit Repetition): revisões de tópicos avançados dão crédito fracionário aos tópicos
    "englobados", reduzindo a ~1 revisão explícita por tópico em média (Math Academy).
12. **Narrativa, analogias e ganchos funcionam se forem relevantes** (narrativa > expositivo: g = 0,55; recordação g = 0,72),
    mas "detalhes sedutores" irrelevantes prejudicam, sobretudo novatos. Gancho = lacuna de informação que a aula resolve.
13. **Flashcards no fim do nó (ou fim do bloco), não no meio**: gerar 2–6 cartões por nó, incluir cartões de "erro
    capturado", aprovação em lote em ~60–90 s, agendar via FSRS + crédito implícito FIRe.
14. **Pausas e blocos**: sessões curtas e frequentes > longas e raras; < 20 min desperdiça em troca de contexto (Math
    Academy). Para 2–4 h/dia: blocos de 25–50 min alternando domínios (Inglês ↔ Eletrônica são dissimilares → não
    interferem), com sinais de fadiga (latência, erros em itens fáceis) disparando troca de formato ou pausa.

---

## 1. Método

- Fontes primárias lidas: PDF do relatório Google/Eedi de 29/10/2026; texto PMC + material suplementar (com o system prompt)
  de Kestin et al. 2025; abstract PNAS de Bastani et al. 2025 (via RePEc) e matéria Wharton; arXiv de LearnLM
  (2407.12687 — seções de rubric lidas seletivamente; 2412.16429 abstract); arXiv 2512.23633 (Eedi exploratório);
  arXiv 2410.03017 (Tutor CoPilot); EdWorkingPapers 26-1551 (Khanmigo) e 26-1598 (UMD); arXiv 2607.08849, 2604.23486,
  2607.05571, 2510.02663; *The Math Academy Way* (rascunho atualizado em 13/08/2026, capítulos 4, 13, 14, 17–22, 29, 31 e FAQ);
  mathacademy.com/how-our-ai-works e /pedagogy; post de Skycak sobre FIRe; README e `jsinterface.html` do circuitjs1.
- Meta-análises clássicas: números conferidos via abstracts/repos (indicado quando a fonte foi secundária).
- Repos de referência em `_refs/` foram **apenas lidos** (nenhum código executado).
- Limitação: algumas cifras (marcadas) vieram de resumos secundários; nesses casos o relatório diz isso.

---

## 2. O que os estudos de tutoria com LLM mostram (2023–2026)

### 2.1 Tabela-resumo

| Estudo | Desenho / N | Resultado principal | Traço de design relevante |
|---|---|---|---|
| **Kestin et al., *Sci Rep* 15:17458 (jun/2025)** — Harvard PS2 | `[RCT]` crossover, 194 alunos, 2 aulas (tensão superficial, escoamento) | Pós-teste mediano 4,5 vs 3,5; ganho > 2×; 0,63 DP (OLS) / 0,73–1,3 DP (quantílica); tempo mediano 49 min vs 60 em aula; engajamento 4,1 vs 3,6 | GPT-4-0613; prompt "BRIEF", "ONE STEP AT A TIME", reativo; soluções passo a passo no prompt; plataforma sequencia partes; vídeos curtos de introdução |
| **Bastani et al., *PNAS* 122(26) e2422633122 (2025)** — Turquia | `[RCT]` ~1000 alunos de ensino médio, matemática | Prática: +48% (GPT Base), +127% (GPT Tutor). Prova sem IA: −17% (GPT Base), ≈0 (GPT Tutor) | GPT Tutor: dicas desenhadas com professores, não dá resposta direta; alunos superestimam o próprio aprendizado |
| **LearnLM Team / Eedi, "AI tutoring can safely and effectively support students" (arXiv 2512.23633, dez/2025)** | `[RCT]` exploratório, 165 alunos, 5 escolas UK | IA supervisionada ≥ tutor humano; 66,2% vs 60,7% resolvendo problemas novos de tópicos seguintes; 76,4% dos rascunhos aprovados sem edição | LearnLM (Gemini ajustado para pedagogia) + humano no loop |
| **Google & Eedi, "Measuring the impact of AI tutoring, from near transfer to standardised tests" (PDF, 29/10/2026)** | `[RCT]` pré-registrado (AEARCTR-0018079), N = 1179, 10 escolas, 10 semanas, 4 braços | Ver §2.3 — IA ≈ humano em medidas próximas; sem efeito em Star Maths (−0,01 a +0,02 DP); tutoria reduziu cobertura | Gemini 3.1 Pro → 3 Flash → 3.5 Flash; prompt pede "concise, scaffolded questions, without giving away the correct answer"; plano de ensino privado antes do 1º turno |
| **Tutor CoPilot — Wang, Ribeiro, Robinson, Loeb, Demszky (arXiv 2410.03017)** | `[RCT]` 900 tutores, 1800 alunos K-12 | +4 p.p. em domínio de tópicos; +9 p.p. para tutores menos experientes; ~US$ 20/tutor/ano | IA sugere ao *tutor humano* estratégias (perguntas-guia, não entregar resposta) |
| **De Simone et al., Banco Mundial WP 11125 (2025)** — Nigéria | `[RCT]` 6 semanas, inglês (Copilot/GPT-4) | +0,31 DP (avaliação combinada), +0,23 DP em inglês; atrito alto (657→422 tratados) | Sessões guiadas por professor, prompts estruturados |
| **Oreopoulos & Low, "One Click Away" (EdWorkingPaper 26-1551, ago/2026)** — Khanmigo | `[RCT]` cluster, 2 anos, 18 escolas TN | +0,06–0,08 DP/ano (ITT); 0,14 DP implícito com uso ativo — similar a Khan sem IA | Uso baixo: aluno mediano usou em 1/3 dos dias e em só 17% das sessões com erro; mensagens majoritariamente respostas secas |
| **Liu et al. (UMD), EdWorkingPaper 26-1598 (out/2026)** | `[RCT]` 2379 graduandos, 30 instrutores | **−0,37 DP na nota final**; −0,90 DP em participação no LMS; perdas maiores para 1ª geração | Tutor "integrado ao curso" deslocou engajamento com atividades existentes |
| **Lehmann, Cornelius & Sting (arXiv 2409.09047)** | `[LAB]` 2 experimentos pré-registrados | Efeito nulo total; *substituir* (gerar soluções) ↑ volume, ↓ compreensão; *complementar* (pedir explicações) ↑ compreensão; percepção de benefício > benefício real | — |
| **Fan et al., *BJET* 56(2) (2025), "Beware of metacognitive laziness"** | `[RCT]` 117 universitários, redação | ChatGPT ↑ nota da redação, **sem** ganho de conhecimento/transferência; menos tempo avaliando o próprio texto | — |
| **Contractor & Reyes (arXiv 2607.08849, 2026)** | `[RCT]` presencial, redação + testes sem ajuda (imediato e 1 semana) | IA ↑ notas; ganho persiste em quem usou IA como **tutor** ("augmentation"), some em quem deixou a IA escrever ("automation") | — |
| **Kobler et al., ACL 2026 (arXiv 2604.23486)** | `[OBS]` 12.650 mensagens, 500 conversas, 4 cursos | "Misalignment": educadores desenham diálogo de aprendizagem; alunos usam para extrair respostas; contexto de implantação prediz uso mais que design | 6 métricas automáticas de alinhamento pedagógico turno a turno |
| **Google "Learn Your Way" (set/2025)** | `[RCT]` pequeno, 60 alunos, 1 capítulo | Retenção 3–5 dias: 78% vs 67% (+11 p.p.); imediato +9% | Múltiplas representações do mesmo conteúdo (texto, slides narrados, áudio, mapa mental, quizzes) |

### 2.2 Kestin et al. (Harvard) — o que exatamente foi feito

Fonte: PMC12179260 + suplemento (`41598_2025_97652_MOESM1_ESM.docx`, Springer). Pontos acionáveis:

- **Sete boas práticas** declaradas: aprendizagem ativa, gestão de carga cognitiva, growth mindset (via prompt);
  scaffolding (via **estrutura da plataforma**); informação/feedback correto (via **soluções pré-escritas**); feedback
  oportuno sob demanda; ritmo próprio.
- **Prompt "assignment persona"** (GPT-4-0613), resumido: tutor amigável; o aluno escreve no papel e pergunta quando quer;
  "You briefly answer questions the students ask - focusing specifically on the question they ask about"; pode CONFIRMAR
  se a resposta está certa, mas não dá a resposta "UNLESS they demand"; restrições: "Keep responses BRIEF (a few sentences
  or less)", "Only give away ONE STEP AT A TIME", "Assume the student is learning this topic for the first time".
- **Prompt por questão**: enunciado + resposta + passos (ex.: "Set the Reynolds numbers equal to each other..."),
  escritos por instrutores, paralelos à explicação dada em sala.
- Notas importantes: **o tutor era majoritariamente reativo** — não "interrogava" o aluno; o aluno trabalhava problemas
  sequenciados pela plataforma e puxava ajuda. Não havia correlação entre tempo e nota. Limitações: 2 aulas, 1 curso,
  sem medida de retenção, efeito teto.

`[INFERÊNCIA]` O tutor "vencedor" mais citado da literatura **não** é Socrático-interrogador: é um **assistente breve e
reativo acoplado a uma sequência bem desenhada de problemas**. Isso casa com Math Academy (instrução direta mínima →
prática) e com o achado do Eedi 2026 de que perguntas extras geram atrito.

### 2.3 Google/Eedi 2026 — o RCT mais informativo para "não cansar"

Fonte: `services.google.com/fh/files/misc/learnlm_oct26.pdf` (lido integralmente nas seções de resultados e discussão).

- Desenho: 4 braços após um erro em "diagnostic question" (MCQ cujos distratores mapeiam misconceptions): remediação padrão
  (vídeo + exercício + dica por misconception), tutor humano especialista, IA com contexto da questão, IA com contexto
  personalizado. 30–50 min/semana, 10 semanas. 58 tutores humanos supervisionando 94.385 rascunhos.
- Segurança: 94,7% dos rascunhos aprovados sem mudança (vs 74,4% em 2025); erros matemáticos < 3/1000; erro contextual
  0,24% (IA) vs 0,18% (humano).
- **Por que os humanos editaram** (5,3% dos rascunhos): estilo/tom 32,5%; scaffolding 28,6%; **gestão de engajamento
  22,9%** — e no fim das conversas a gestão de engajamento era 40% das revisões: "tutors interceded to allow students to
  move on, rather than continuing the line of guided questioning from Gemini".
- Comportamento pedagógico: IA reteve a resposta até tentativa em 98,8% das conversas (humanos 96,3%); IA fez pergunta de
  follow-up para checar entendimento em **91,3%** (humanos 60,0%). Discussão: "probing further after correct answers added
  friction for students who did not want to be in a chat in the first place".
- Aprendizagem: correção imediata 56,9% (IA) / 57,7% (humano) / 43,4% (padrão); transferência próxima 58,4% / 59,1% /
  50,5%; retorno > 7 dias 59,9% / 58,9% / 47,6%; quiz intermediário 62,1–63,5% / 61,8% / 59,6%.
- **Star Maths (prova ampla)**: IA −0,01 DP e +0,02 DP vs padrão (≈0); humano −0,09 DP. Explicação parcial: tutoria
  consome 4–7 min por conversa → **99 unidades (IA) e 77 (humano) vs 132 (padrão)**; cada +1 DP de unidades concluídas ≈
  +0,09 DP na prova.
- **Atrito diferencial**: meninos (mais confiantes na linha de base) mostraram menos conforto com erros quando forçados a
  um chat a cada erro; "Conversational tutoring may therefore not be a panacea for every error".
- **Personalização nula**: o plano de ensino citava proficiência prévia em 70% vs 3,3% das conversas, mas o efeito
  pedagógico não apareceu; a IA "only partially carried those plans through".
- Pedidos para sair cedo: 29,5–29,6% (IA), 32,6% (humano), caindo de 38,3% (semana 1) para 23,9% (semana 10).

**Lições de design** `[INFERÊNCIA]`:
1. Diálogo é caro em tempo — use **escalonamento**: erro simples → dica curta específica + item-variante; diálogo só para
   erro com alta confiança, repetido, ou pedido do aluno.
2. **Não faça pergunta de follow-up após acerto confiante.** Encerre e avance.
3. Respeite pedido de "seguir em frente" (registre como sinal, não como falha).
4. Meça cobertura (nós/semana) junto com retenção — trade-off profundidade × amplitude é real num grafo de 1 ano.

### 2.4 LearnLM / Gemini — o vocabulário de "boa pedagogia" em prompts

- **"Towards Responsible Development of Generative AI for Education: An Evaluation-Driven Approach"** (Jurenka et al.,
  arXiv 2407.12687, v4 dez/2025): 5 princípios priorizados — *encourage active learning*, *manage cognitive load*,
  *deepen metacognition*, *motivate and stimulate curiosity*, *adapt to learners' goals and needs*. Rubric de conversa
  (Tabela 10) inclui itens úteis como checklist para nosso juiz automático:
  - Cognitive load: "Manageable Chunks", "No Irrelevant Info", "Analogies" (narrativas, casos, analogias quando apropriado),
    "Info Order" (do intuitivo ao detalhado), "No Repetition".
  - Active learning: "Asks Questions … where appropriate", "Guides to Answer — does not give away answers too quickly",
    "Openings".
  - Adaptivity: "Leveling", "Unstuck", "Proactive" e **"Guides Appropriately — The tutor doesn't ask the student too many
    questions, unproductively withholding information"**.
  - Metacognition: "Communicates Aims" (dizer o plano da conversa), "Guide Mistake Discovery".
  - Achado do próprio paper: "most pedagogy is too nuanced to be" eliciado só por prompt; por isso fizeram fine-tuning.
- **"LearnLM: Improving Gemini for Learning"** (arXiv 2412.16429, v3 ago/2025): "pedagogical instruction following" —
  instruções de sistema descrevem o comportamento pedagógico desejado; preferência de especialistas +31% vs GPT-4o, +11% vs
  Claude 3.5 Sonnet, +13% vs Gemini 1.5 Pro. Implicação: **modelos atuais seguem instruções pedagógicas finas**; nosso
  trabalho é escrever as instruções certas por fase.

### 2.5 Modos "estudo" dos fornecedores (2025) — referência de produto `[PRÁTICA]`

- **ChatGPT Study Mode** (29/07/2025): instruções de sistema escritas com professores; extrato publicado por Simon Willison:
  descobrir objetivo/nível; conectar ao que o aluno sabe; guiar com perguntas, dicas e pequenos passos; checar retenção
  após material difícil; **variar formato** (explicações, perguntas, role-play, "teach it back"); não fazer a lição de casa;
  tom caloroso, emojis com parcimônia; **"keeps a clear next step in mind and ends or switches activities once they've
  served their purpose"**; respostas compactas. OpenAI admite comportamento inconsistente por ser só prompt.
- **Claude Learning Mode** (abr/2025 educação; ago/2025 todos; Claude Code "Explanatory"/"Learning"): Socrático. Crítica
  de review (Mashable via Yahoo): "overwhelmingly Socratic with no end in sight", ruim para quem se distrai com múltiplas
  perguntas.
- **Gemini Guided Learning** (ago/2025): LearnLM integrado.

### 2.6 Benchmarks de capacidade pedagógica (para avaliar nossos prompts)

- **MathTutorBench** (Macina et al., EMNLP 2025; github.com/eth-lre/mathtutorbench): expertise de domínio **não** se
  traduz em pedagogia; há trade-off; "tutoring appears to become more challenging in longer dialogs, where simpler
  questioning strategies begin to fail".
- **TutorBench** (Scale AI, arXiv 2510.02663; ICLR 2026): 1490 prompts (explicação adaptativa, feedback acionável, dicas);
  nenhum modelo de fronteira > 56% (topo set/2025: gemini-2.5-pro 55,65%, gpt-5 55,33%); fraqueza em adaptatividade.
- **CSTutorBench** (Lane & Kageler, AIED 2026 workshop, arXiv 2607.05571): modelos 4B–120B vão bem em vocabulário/tom,
  mal em **evitar vazamento de resposta** e em engajar com o histórico de depuração; família/ajuste de instrução prediz
  qualidade melhor que tamanho; revisão de prompt melhorou 10 de 11 modelos.
- **MRBench / "Unifying AI Tutor Evaluation"** (Maurya et al., NAACL 2025): taxonomia de 8 dimensões (identificação e
  localização do erro, revelação da resposta, orientação, acionabilidade, coerência, tom, "human-likeness") — boa base
  para rubric do juiz automático (§7.8).

### 2.7 Síntese: o que separa ajuda de dano

| Ajuda | Prejudica |
|---|---|
| Sequência estruturada de problemas + tutor breve/reativo (Harvard) | Chat aberto que entrega solução (Bastani GPT Base; Lehmann "substituir") |
| Soluções verificadas no contexto do modelo (Harvard, Eedi) | IA escrevendo pelo aluno (Contractor & Reyes "automation"; Fan "metacognitive laziness") |
| Gatilho no momento do erro, com misconception identificada (Eedi) | Tutor como canal paralelo que desloca atividades (UMD −0,37 DP) |
| Guardrails de "tentar antes" + dicas graduais (Bastani GPT Tutor; Tutor CoPilot) | Perguntas após acerto e loops Socráticos sem fim (Eedi 2026; reviews de learning modes) |
| Supervisão/estrutura que garante qualidade (Eedi) | Personalização só textual sem decisão operacional (Eedi 2026) |

Nota de cautela: o hype do "2-sigma" (ver §3.1) e meta-análises de "ChatGPT na educação" com efeitos ~0,8+ misturam
estudos fracos; os RCTs grandes e longos (Khanmigo 2026, Eedi 2026, UMD 2026) mostram efeitos **pequenos, nulos ou
negativos** em medidas amplas quando o design é fraco ou o uso é baixo.

---

## 3. Ciência da aprendizagem — fundamentos aplicáveis

Formato de cada item: **o que é → evidência → como aplicar no app → armadilha**.

### 3.1 Bloom 2-sigma e mastery learning

- Bloom (1984): tutoria individual + mastery learning → +2 DP. **Crítica**: von Hippel (*Education Next*, 2024) mostra que
  os estudos combinavam tutoria com mastery learning, mais tempo, testes frequentes e correção; metade do efeito vinha de
  mais quizzes; testes alinhados ao conteúdo. Meta-análises modernas: tutoria humana ≈ 0,79 DP (VanLehn 2011,
  *Educational Psychologist* 46(4)); Nickow, Oreopoulos & Quan (2020) ≈ 0,37 DP em 96 RCTs; mastery learning ≈ 0,5 DP
  (Kulik, Kulik & Bangert-Drowns 1990, *RER*).
- **Aplicar**: o valor está nos **componentes** — diagnóstico do que o aluno sabe, avanço só com domínio dos pré-requisitos
  (fronteira do conhecimento = ZPD), feedback corretivo, re-teste. Math Academy é a operacionalização mais completa (§4).
- **Armadilha**: prometer 2σ; gating rígido demais sem "adiar e voltar depois" frustra (Math Academy deixa o aluno fazer
  outros tópicos e retentar depois).

### 3.2 ICAP (Chi & Wylie 2014, *Educational Psychologist* 49(4):219–243)

- Interactive > Constructive > Active > Passive. Gerar (explicar, prever, resolver) > manipular > receber.
- **Aplicar**: cada nó precisa de ao menos uma atividade **construtiva** (autoexplicação, resolver problema novo, prever)
  e idealmente uma **interativa** (diálogo sobre o raciocínio do aluno, simulador). Ler a explicação é "passive" — limite
  a fração de tempo passivo.
- **Armadilha**: confundir "interativo" com "perguntar muito". Interação de qualidade é coconstrução sobre a produção do
  aluno, não um quiz falado.

### 3.3 Retrieval practice (testing effect)

- Adesope, Trevisan & Sundararajan (2017, *RER* 87(3)): prática de teste > reestudo; g ≈ 0,61 (efeito maior com atraso de
  1–6 dias, g ≈ 0,82 — cifras via resumo secundário). Dunlosky et al. (2013, *PSPI*): "high utility" para practice testing
  e distributed practice.
- **Aplicar**: (a) aquecimento de sessão com itens devidos; (b) prática após exemplo; (c) flashcards; (d) quizzes mistos
  periódicos sem andaime (Math Academy: rápidos, frequentes, cronometrados, cobrindo muitos tópicos antigos).
- **Armadilha**: recuperação **imediata** do que acabou de ser lido tem pouco valor de retenção (o conteúdo ainda está na
  memória de trabalho) — é o que gera a sensação de "interrogatório". A recuperação vale mais com intervalo e mistura.

### 3.4 Espaçamento

- Cepeda et al. (2008, *Psych Science* 19(11)), > 1350 participantes: o intervalo ótimo entre estudos cresce com o prazo
  de retenção; como fração do prazo, cai de ~20–40% (teste em 1 semana) para ~5–10% (teste em 1 ano). Kim & Webb (2022,
  *Language Learning* 72(1)): espaçamento em L2 com efeito médio-grande; espaçamentos longos vencem em pós-testes tardios;
  agendas iguais vs expansivas ≈ empate.
- **Aplicar**: agendador por item/nó (FSRS para cartões; FIRe para nós) com meta de retenção configurável; aceitar que
  reviews "difíceis" são desejáveis.
- **Armadilha**: avalanche de revisões num grafo grande → compressão via encompassings (§4.4).

### 3.5 Intercalação (interleaving)

- Brunmair & Richter (2019, *Psych Bulletin*), 59 estudos/238 efeitos: g = 0,42 geral; matemática g = 0,34; maior com
  categorias muito parecidas (estilos de pintura g = 0,67); **palavras/vocabulário: negativo (g ≈ −0,39)**; textos
  expositivos ambíguos.
- **Aplicar**: em Eletrônica, misturar tipos de problema na revisão (ex.: divisor de tensão vs ponte vs Thévenin) para
  treinar **discriminação de método**. Em Inglês, **não** intercalar listas de vocabulário semelhante na aprendizagem
  inicial; espaçar sim.
- Complemento Math Academy: *non-interference* — ensinar juntos tópicos **dissimilares**, espaçar tópicos parecidos
  (Underwood & Ekstrand 1967: separação de 3 dias reduziu interferência proativa). Intercalar só depois de uma "dose
  mínima efetiva" de aprendizagem bloqueada.

### 3.6 Dificuldades desejáveis e calibração de dificuldade

- Bjork & Bjork: espaçamento, intercalação, geração e teste tornam a prática mais difícil e a retenção melhor; a fluência
  durante o estudo engana ("illusion of comprehension" — Math Academy cap. 2).
- Wilson, Shenhav, Straccia & Cohen (2019, *Nat Commun* 10:4646): taxa de erro ótima ≈ 15,87% (≈ 85% de acerto) para
  aprendizes por gradiente em classificação binária — **teórico**, não um resultado em humanos para currículo.
  Math Academy calibra quizzes para ~80% (acima → variações mais difíceis; abaixo → mais fáceis).
- **Aplicar**: controlador de dificuldade que mantém a média móvel de acerto da prática em 75–90% (alvo 80–85%).
- **Armadilha**: dificuldade *indesejável* (falta de pré-requisito, enunciado ambíguo, item que exige o que não foi ensinado)
  não é "desejável" — é frustração. O learnharness já tem a regra certa: "Answerable by reasoning from the session"
  (`src/agent/prompts/teacher/30-question-principles.md`).

### 3.7 Teoria da carga cognitiva, exemplos resolvidos, fading, expertise reversal, subgoals

- Sweller (CLT): memória de trabalho limitada; reduzir carga extrínseca; gerir a intrínseca por segmentação.
- **Worked example effect** e **fading** (Renkl & Atkinson 2003): começar com exemplo completo, depois exemplo com último
  passo faltando, depois problema completo.
- **Expertise reversal** (Kalyuga et al. 2003): o que ajuda novatos atrapalha experts → remover andaimes nas revisões
  (Math Academy mistura problemas na revisão para que "não seja óbvio qual exemplo usar"; quizzes sem andaime).
- **Subgoal labeling** (Catrambone): agrupar passos em subobjetivos nomeados melhora transferência.
- **Micro-scaffolding** (Math Academy cap. 14): cálculo com ~1000 passos (300 tópicos × 3–4 KPs) vs ~100 de um livro
  (10×10) — "10x more finely scaffolded".
- **Aplicar**: cada KP = exemplo resolvido com rótulos de subobjetivo + 1 exemplo com lacuna + prática. Em revisões, sem
  exemplo. Em nós de nível pós-graduação, menos andaime e mais problemas abertos (expertise reversal).

### 3.8 Productive failure (PS-I: problema antes da instrução)

- Sinha & Kapur (2021, *RER*), 53 estudos/166 comparações: PS-I > I-PS em média; maior com alta fidelidade aos princípios
  de PF (g ≈ 0,37–0,58 em subconjuntos de alta fidelidade; ajuste de viés g = 0,87 — reportado via resumo); **inverte para
  crianças pequenas e para habilidades gerais**. Loibl, Roll & Rummel (2017): PS-I funciona quando a instrução posterior
  **constrói sobre as soluções dos alunos** e usa casos contrastantes.
- Math Academy discorda para novatos (expertise reversal, instrução direta; "struggle for long periods" não tem suporte).
- **Aplicar** `[INFERÊNCIA]`: usar PS-I **curto** (2–5 min, um problema de exploração com baixo risco, sem nota) em nós
  *conceituais* onde o aluno tem pré-requisitos sólidos (ex.: "como você mediria a corrente sem abrir o circuito?"), e
  sempre seguir com instrução que compara as tentativas dele com a solução canônica. Não usar em nós procedimentais
  iniciais nem em fadiga.

### 3.9 Autoexplicação e interrogação elaborativa

- Bisra et al. (2018, *Educ Psych Review*), 64 relatos/69 efeitos: g = 0,55; prompts interrogativos ≈ 0,56; prompts
  "pré-direcionados" ≈ 0,70 (via resumo secundário). Dunlosky (2013): self-explanation e elaborative interrogation =
  "moderate utility".
- **Aplicar**: **1 prompt de autoexplicação por nó**, no passo mais conceitual do exemplo ("por que dividimos pela soma das
  resistências aqui?"), com opção de resposta curta ou múltipla escolha de justificativas (prompt pré-direcionado reduz
  esforço de digitação e fadiga).

### 3.10 Dual coding, multimídia, detalhes sedutores

- Mayer (princípios multimídia: coerência, sinalização, contiguidade espacial/temporal, segmentação, pré-treino,
  modalidade, personalização). Math Academy usa diagramas e fluxogramas até álgebra abstrata.
- **Detalhes sedutores** (Sundararajan & Adesope 2020, *Educ Psych Review* 32(3)): material interessante mas irrelevante
  reduz aprendizagem; efeito maior para novatos e em lições curtas; pior quando colocado ao lado de diagramas relevantes.
- **Aplicar**: cada segmento de explicação com 0–1 visual SVG diretamente ligado à ideia; cor e rótulos coerentes com o
  texto; analogias/histórias **sobre o mecanismo**, não decoração. Segmentação controlada pelo aluno (botão "continuar").

### 3.11 Questionamento socrático e o que tutores humanos especialistas fazem

- Lepper & Woolverton (2002): modelo **INSPIRE** (Intelligent, Nurturant, Socratic, Progressive, Indirect, Reflective,
  Encouraging) — especialistas usam perguntas guia e dicas incrementais, feedback **indireto** para reduzir pressão
  avaliativa, e cuidam do estado motivacional; tutores menos eficazes usam elogio mais efusivo.
- Graesser, Person & Magliano (1995): "5-step tutoring frame" (pergunta → resposta → feedback curto → melhoria colaborativa
  → checagem). Tutores humanos frequentemente perguntam "você entendeu?", que é pouco confiável.
- VanLehn (2011): "interaction plateau" — granularidade por passo ≈ humano; mais fino não ajuda.
- Práticos recentes convergem num **teto de 2–3 rodadas Socráticas** antes de explicar (BloomTutor `skills/bloom-tutor/SKILL.md`
  regra 7: "每次最多 2 轮… 每轮只问 1-2 个问题"; OpenMAIC `lib/pbl/v2/prompts/instructor-base-rules.md`: "Use the
  Socratic method sparingly. Mix questioning with explanation… Alternate" e "Over-questioning is the failure mode users
  complain about most").
- **Aplicar**: Socrático é uma ferramenta para **passos deriváveis** pelo aluno com o que ele já tem; caso contrário,
  expositivo (o learnharness já distingue "Socratic or expository — per step"). Limitar a 2 rodadas, depois revelar.

### 3.12 Metacognição e calibração de confiança

- Ilusão de competência: alunos com IA superestimam o aprendizado (Bastani; Lehmann). **Hypercorrection effect**
  (Butterfield & Metcalfe 2001): erros cometidos com alta confiança, quando corrigidos, são mais bem lembrados.
- **Aplicar**: confiança em 1 toque em itens de prática (o learnharness já tem `shared/25-confidence.md` — manter);
  priorizar feedback elaborado e um cartão de flashcard para **erro + alta confiança**; mostrar ao aluno sua curva de
  calibração (Brier score) no perfil — metacognição sem texto excessivo.

### 3.13 Motivação: SDT, flow, gamificação, elogio

- **Self-Determination Theory** (Ryan & Deci 2000): autonomia, competência, pertencimento. **Flow** (Csikszentmihalyi):
  metas claras, feedback imediato, desafio ≈ habilidade. A fronteira do grafo é, literalmente, o "canal de flow" (open-mastery
  README).
- **Gamificação** (Sailer & Homner 2020, *Educ Psych Review* 32): g = 0,49 cognitivo (estável em estudos rigorosos), 0,36
  motivacional, 0,25 comportamental (menos estáveis); ficção de jogo e interação social moderam efeitos comportamentais.
- **Elogio** (Henderlong & Lepper 2002, citado na Math Academy Way): elogio funciona se sincero, atribui a causas
  controláveis, promove autonomia, informa padrões; elogio efusivo/genérico soa insincero. O "Voice" do learnharness
  (`shared/10-voice.md`) já proíbe elogio performático — manter, mas permitir **reconhecimento específico** ("isso: você
  usou a lei dos nós no nó certo").
- **XP Math Academy**: 1 XP ≈ 1 minuto de trabalho focado de um aluno sério; bônus por desempenho perfeito, XP cheio
  para quase perfeito, parcial, zero, e **penalidade por "blow off"**; ligas semanais opcionais com promoção/rebaixamento
  entre alunos de habilidade competitiva similar. Penalidades levaram "XP hackers" de < 50% para > 90% de aprovação.
  (Detalhes para o módulo de XP/Monte Carlo do app em outro relatório.)

### 3.14 Narrativa, analogias, curiosidade

- **Narrativa** (Mar, Li, Nguyen & Ta 2021, *Psychon Bull Rev* 28(3)), 150 efeitos/> 33 mil participantes: textos
  narrativos mais compreendidos (g = 0,48) e lembrados (g = 0,72) que expositivos; global g = 0,55; robusto (mas viés de
  publicação em memória). Willingham: histórias são "psychologically privileged" (causalidade, conflito, complicações,
  personagem).
- **Analogias/comparação de casos** (Alfieri, Nokes-Malach & Schunn 2013, *Educational Psychologist* 48(2)): comparar
  casos ≈ d = 0,50. Richland, Zur & Holyoak (2007, *Science*): analogias funcionam com suportes — fonte familiar, mapeamento
  explícito, visual lado a lado, apontar onde a analogia **quebra**.
- **Curiosidade** (Loewenstein 1994: teoria da lacuna de informação; Gruber, Gelman & Ranganath 2014, *Neuron*: estados de
  curiosidade melhoram memória inclusive de informação incidental).
- **Aplicar**: gancho = pergunta/fenômeno que cria lacuna que o nó fecha; narrativa de descoberta ("como alguém poderia ter
  descoberto isto?" — já é o Principle ii do learnharness, `teacher/05-method.md`); analogias com tabela de mapeamento e
  "limite da analogia".

### 3.15 Prever-explicar (predict–observe–explain) e pré-teste

- Brod, Hasselhorn & Bunge (2018, *Learning and Instruction* 55): gerar previsão antes de ver o resultado melhora
  aprendizagem; surpresa (resposta pupilar) só ocorre se houve previsão; previsões **erradas** puxam o benefício.
  Crianças precisam de controle inibitório para aprender com previsão errada (Brod et al. 2020).
- Pan & Carpenter (2023, *Educ Psych Review*): pré-perguntas/pré-testes "often enhance learning", inclusive com vídeo e
  texto, mesmo com muitos erros iniciais; magnitude varia. Carpenter & Toftness (2017): pré-perguntas melhoram
  aprendizagem de vídeos.
- POE (White & Gunstone 1992) é o formato clássico em física — **perfeito para Eletrônica com simulador** (§9).
- **Aplicar**: 1 previsão por nó **quando houver resultado surpreendente/contraintuitivo**, nunca pontuada, sempre
  resolvida explicitamente na explicação. Antes de vídeo/capítulo: 1–2 pré-perguntas de foco.
- **Armadilha**: o learnharness hoje faz "predict → teach → check… One question per turn, every turn"
  (`teacher/28-predictions.md`). Previsão em todo passo vira ritual e fadiga.

### 3.16 Tabela de efeitos (para referência rápida)

| Técnica | Efeito (fonte) | Prioridade no app |
|---|---|---|
| Tutoria humana | d ≈ 0,79 (VanLehn 2011); 0,37 DP (Nickow 2020) | referência |
| ITS por passo | d ≈ 0,76 (VanLehn) | alta — granularidade-alvo |
| Prática de recuperação | g ≈ 0,61 (Adesope 2017) | alta |
| Espaçamento | "high utility" (Dunlosky); L2 médio-grande (Kim & Webb 2022) | alta |
| Autoexplicação | g = 0,55 (Bisra 2018) | média-alta (1×/nó) |
| Intercalação | g = 0,42; mat. 0,34; palavras −0,39 (Brunmair & Richter 2019) | média (só revisões/discriminação) |
| PS-I / productive failure | positivo com alta fidelidade; inverte p/ novatos jovens (Sinha & Kapur 2021) | seletiva |
| Narrativa vs expositivo | g = 0,55 (Mar 2021) | média |
| Comparação de casos | d ≈ 0,50 (Alfieri 2013) | média |
| Gamificação | g = 0,49 cognitivo (Sailer & Homner 2020) | média |
| Detalhes sedutores | negativo, pequeno (Sundararajan & Adesope 2020) | evitar |
| Mastery learning | ≈ 0,5 (Kulik et al. 1990) | alta (gating) |

---

## 4. Metodologia Math Academy (MA) — e como transpor para um grafo de 1000–1500 h

Fontes: *The Math Academy Way* (Skycak, advised by J. Roberts; working draft atualizado 13/08/2026,
https://www.justinmath.com/files/the-math-academy-way.pdf), https://mathacademy.com/how-our-ai-works,
https://mathacademy.com/pedagogy, https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures.
MA **não usa LLM** para ensinar; é conteúdo curado + algoritmo. O que interessa é a arquitetura de grafo/agendamento.

### 4.1 Grafo de conhecimento

- "Multiple thousands" de tópicos do 4º ano à universidade; um curso ≈ 300 tópicos. Arestas: **pré-requisito** (direto e
  "key prerequisite" — o que remediar quando o aluno trava) e **encompassing** (grafo separado: tópico avançado exercita
  implicitamente o mais simples). "Encompassed topics are usually prerequisites, but prerequisites are often not fully
  encompassed."
- **Fronteira do conhecimento** = tópicos cujos pré-requisitos estão dominados; MA cita Zou et al. (2019): aluno 3–4× mais
  propenso a dominar tópico na fronteira do que além dela.
- Escala de esforço: AP Calculus BC ≈ 300+ tópicos ≈ 6000 min ≈ **20 min por tópico, incluindo revisões e quizzes**.

`[INFERÊNCIA]` **Dimensionamento do nosso grafo**: 1000–1500 h ≈ 60.000–90.000 min → na granularidade MA, **~3000–4500
nós-lição no total** (somando domínios). Se Eletrônica ficar com ~60% do tempo, ~1800–2700 nós — e isso **inclui a
matemática de suporte** (cálculo, álgebra linear, EDOs, complexos, Laplace/Fourier, probabilidade), que é pré-requisito real
para nível de pós-graduação. O gerador procedural deve produzir nós nessa granularidade (≈ 15–25 min cada), não
"capítulos".

### 4.2 Estrutura da lição e mastery

- Lição = slides de texto instrucional intercalados com resolução ativa: **introdução → exemplo resolvido → 2–5 questões
  do mesmo tipo** = 1 *knowledge point* (KP); lição típica tem **3–4 KPs** de dificuldade crescente.
- Nº de questões por KP adapta-se ao desempenho; se o aluno não demonstra domínio em 2–5 questões, a lição "falha" →
  faz outras lições → retenta depois (questões diferentes, após um atraso). 2 falhas sem progresso → ritmo mais lento +
  **revisões remediais nos key prerequisites**. 95% passam na 1ª tentativa, 99% em até duas.
- Ordem importa: 3 acertos e 2 erros em ordem ✗✗✓✓✓ (aprendeu) ≠ ✓✓✗✗✓ (não pegou).
- Revisões têm várias questões: intercalar KPs do tópico, medir domínio ("consistently, not just once"), robustez a chute.
- FAQ "explicar de outro jeito?": se precisa de mil explicações, ou a explicação é ruim ou falta pré-requisito (e a
  explicação "que clicou" contornou o pré-requisito → currículo aguado). Normalmente "a bit of rest and a fresh pair of
  eyes" resolve. `[INFERÊNCIA]` Para nós (conteúdo gerado por LLM, não testado em milhares de alunos), **re-explicar de
  outro jeito é necessário às vezes**, mas a primeira hipótese diante de falha deve ser **pré-requisito fraco** (verificar
  no grafo e remediar), não "variar a analogia".
- FAQ "resolver problemas quebra meu flow": a fluência ao ler é artificial; "switch over to active problem-solving
  immediately after consuming a minimum effective dose of information".

### 4.3 FIRe — Fractional Implicit Repetition (modelo publicado)

Estado por (aluno, tópico):

- `repNum` — rodadas bem-sucedidas de repetição espaçada.
- `memory` — retenção esperada agora; decai; o tópico fica *due* quando `memory` está baixa o bastante.
- `interval` — nº ideal de dias entre a repetição `repNum` e `repNum+1`.
- `days` — dias desde a última repetição.
- `speed` — velocidade aluno-tópico = (aceleração pela habilidade do aluno) / (lentidão pela dificuldade do tópico).
  Ex.: speed 2× → uma revisão vale 2 repetições; 0,5× → vale 0,5.
- `failed` ∈ {0,1}; `decay` ≥ 1 cresce quando a revisão está muito atrasada (modelar "summer slide").
- `rawDelta` — crédito bruto (positivo se passou, negativo se falhou; magnitude cresce com a qualidade do trabalho;
  **descontado se a repetição foi cedo**, i.e., `memory` ainda alta).

Atualizações publicadas (post de Skycak):

```
repNum ← max(0, repNum + speed · decay^failed · rawDelta)
memory ← max(0, memory + rawDelta) · 0.5^(days / interval)
```

Fluxo de crédito:

- **Acertos descem** (de avançado para englobados), múltiplas camadas ("como raios"); **falhas sobem** (de simples para
  os que o englobam — "se não sabe somar, não sabe multiplicar 2 dígitos").
- Encompassing **total** passa crédito cheio ("tronco"); **parcial** passa fração `w` (interpretação: probabilidade de um
  problema aleatório do avançado englobar um problema aleatório do simples) e "esmaece" nos ramos.
- Crédito implícito que chega cedo demais é descontado.
- **Se `speed < 1` no tópico, desliga todo crédito implícito entrante** e força revisões explícitas ("weaker students often
  have trouble absorbing implicit repetitions on difficult topics").
- Só encompassings propagam crédito; pré-requisitos não.
- Pesos explícitos só onde: valor não trivial, não inferível pelo fluxo, e tópicos próximos no grafo de pré-requisitos —
  na prática ao longo de arestas diretas/key (escala linear no nº de tópicos). Pré-requisito direto pode ter peso 0
  (familiaridade conceitual sem exigir execução). Há também *non-ancestor encompassings* (tópicos equivalentes em cursos
  diferentes) e *mastery floors*.
- Não publicados: fórmula de `speed`, função de `decay`, forma de `rawDelta`, regra exata de propagação entre camadas,
  limiar de *due*, tabela de intervalos, algoritmo de compressão. **Teremos de calibrar os nossos.**

Medição de habilidade/dificuldade: acurácia por tópico com mais peso no recente, propagando acertos para baixo e erros para
cima; valor inicial predito pela vizinhança (pré-requisitos diretos/key, encompassings, mesmo módulo); dificuldade do tópico
= acurácia agregada de alunos sérios — também atua como fator de correção.

### 4.4 Spaced Repetition Compression e eficiência

- Quando há revisões devidas, escolher um **pequeno conjunto de revisões e lições novas cujas repetições implícitas
  cubram as devidas** (set cover ponderado); sem devidas, escolher tarefas que **adiem revisões futuras** e "subam o grafo
  por igual" para manter opções.
- Eficiência máxima teórica: numa cadeia totalmente englobada, nunca se revisa explicitamente. Empiricamente, cursos de MA
  exigem **~1 revisão explícita por tópico em média**. Mínimo teórico = flashcards independentes (cada revisão é
  explícita) — "other spaced repetition systems … implement theoretical minimum learning efficiency".
- Tabela de eficiência (cap. 31): eficiência 1,00 → 1× o trabalho; 0,80 → 1,25×; 0,67 → 1,5×; 0,50 → 2×; 0,25 → 4×.
- Regra dura: lições ≥ ~25% do tempo em média (para o progresso não parar sob o peso das revisões). Progresso (% de
  tópicos) ≠ XP; progresso desacelera ao fim do curso.
- Micro-intercalação: MA aceita "perder um pouco" de intercalação dentro do tópico em troca de compressão — revisões são
  escolhidas para cobrir muitos subcomponentes, então a intercalação vem "comprimida" de qualquer forma.

### 4.5 Diagnóstico, quizzes, remediação, rotina

- Diagnóstico adaptativo: escolhe o tópico mais informativo; acerto conta a favor do tópico e pré-requisitos; erro conta
  contra o tópico e pós-requisitos; acerto lento conta menos; "conditionally completed" para inferências de baixa
  confiança (se o aluno tropeçar, recua). Cobre 500–1000 tópicos com ordens de grandeza menos perguntas.
- Quizzes: tópicos aleatórios já aprendidos, prioridade para o curso atual, menos peso para recém-quizzados/englobados;
  erro → revisão remedial imediata; **alvo ~80%**; cronometrado, sem consulta.
- Rotina: sessões curtas e frequentes (ex.: 30 min × 6 dias > 90 min × 2); < 20 min → custo de troca de contexto domina;
  ritmo "sério" ≈ 40 min na maioria dos dias; sem limite rígido diário — parar quando houver erros bobos, divagação, ou
  quando a sessão longa faz pular os dias seguintes.

### 4.6 Limites e críticas

- Forte viés para instrução direta e contra descoberta; foco em automatismo — adequado a matemática/eletrônica
  procedimental, menos óbvio para fluência comunicativa em idiomas (§8).
- FIRe parcialmente proprietário; os números "4×" e aceleração são medidos em conclusão de currículo, não em transferência
  ampla (crítica em `_refs/open-mastery/docs/LANDSCAPE_ANALYSIS.md`).
- Conteúdo de MA é refinado com dados de muitos alunos; o nosso será gerado na hora → precisamos de **verificação
  automática** (solver, juiz LLM, testes de item) para chegar perto da taxa de aprovação de 95%.

### 4.7 Transposição para o app (esboço implementável)

Tipos (TypeScript) para o motor de agendamento hierárquico:

```ts
// src/learning/hsrs/types.ts  (proposta)
export type NodeId = string;

export interface EncompassEdge {
  from: NodeId;          // tópico avançado
  to: NodeId;            // tópico englobado (mais simples)
  weight: number;        // 0..1 (1 = encompassing total)
  source: 'llm' | 'expert' | 'inferred';
  confidence: number;    // 0..1 — pesos propostos por LLM entram com confiança baixa
}

export interface RepState {
  nodeId: NodeId;
  repNum: number;        // >= 0
  memory: number;        // 0..1, retenção esperada
  lastRepAt: number;     // epoch ms
  intervalDays: number;  // intervalo ideal até a próxima repetição
  speed: number;         // ratio habilidade/dificuldade; < 1 => desliga crédito implícito
  decay: number;         // >= 1
}

export interface RepetitionEvent {
  nodeId: NodeId;
  passed: boolean;
  quality: number;       // 0..1 (ex.: acerto ponderado, ordem dos acertos, uso de dicas)
  at: number;
  explicit: boolean;     // revisão explícita vs crédito implícito
}
```

Algoritmo "FIRe-lite" (proposta minha, calibrável; **não** é o algoritmo proprietário da MA):

```ts
// Propagação após um evento explícito no nó n
function propagate(ev: RepetitionEvent, g: Graph, st: Map<NodeId, RepState>) {
  const raw = rawDelta(ev, st.get(ev.nodeId)!);           // + se passou, - se falhou; desconto se cedo
  apply(ev.nodeId, raw, /*explicit*/ true);
  if (ev.passed) {
    // crédito desce pelos encompassings, multiplicando pesos, com poda quando < 0.05
    for (const [m, w] of downstreamProducts(g, ev.nodeId, 0.05)) {
      const s = st.get(m)!;
      if (s.speed < 1) continue;                           // regra MA: tópico difícil p/ o aluno exige revisão explícita
      apply(m, raw * w * earlyDiscount(s), false);
    }
  } else {
    // penalidade sobe para quem engloba o nó que falhou
    for (const [m, w] of upstreamProducts(g, ev.nodeId, 0.05)) apply(m, raw * w, false);
  }
}

function rawDelta(ev: RepetitionEvent, s: RepState): number {
  const sign = ev.passed ? 1 : -1;
  const mag = ev.passed ? 0.5 + 0.5 * ev.quality : 0.5 + 0.5 * (1 - ev.quality);
  const early = ev.passed ? earlyDiscount(s) : 1;          // repetição cedo vale menos
  return sign * mag * early;
}
function earlyDiscount(s: RepState): number {               // ~0 se memory ~1, ~1 se memory <= alvo
  const target = 0.85;                                      // retenção-alvo (configurável)
  return Math.min(1, Math.max(0, (1 - s.memory) / (1 - target)));
}
```

Compressão (escolha da próxima tarefa): set cover guloso ponderado — para cada candidato `t` (revisão ou lição nova da
fronteira), `score(t) = Σ_{d ∈ due} coverage(t, d) − λ·custoTempo(t) + μ·novidade(t)`; escolher o maior; repetir até
cobrir as devidas ou estourar o orçamento do bloco; garantir lições ≥ 25% do tempo.

Pesos de encompassing gerados pelo LLM: pedir na expansão do grafo, para cada nó novo, a lista de subhabilidades
**executadas** ao resolver um problema típico (não apenas "conceitos relacionados"), com peso = fração estimada de
problemas que exercitam aquela subhabilidade; validar com (a) consistência no grafo (sem ciclos, peso ≤ 1, `to` é
ancestral ou equivalente), (b) dados: se aluno passa no avançado e falha no englobado com frequência, reduzir o peso
(aprendizado online do peso). Em `_refs/open-mastery/docs/GRAPH_FORMAT.md` há um formato YAML `encompasses: {id: peso}`
já previsto (grafo CC-BY-SA 4.0; engine MIT).

Idioma: vocabulário é quase "flashcards independentes" (eficiência mínima), mas há encompassing real em **gramática e
habilidades** (ex.: "relative clauses" engloba "subject–verb agreement"); e `[INFERÊNCIA]` exposição em input compreensível
pode dar **crédito implícito receptivo** (peso baixo, < 0,3) a palavras encontradas em contexto — nunca crédito produtivo.

---

## 5. Por que tutores de IA ficam cansativos — diagnóstico

O padrão reclamado ("explica rápido e despeja perguntas") é a soma de defeitos distintos. Cada um tem evidência ou sinal
de prática:

| # | Defeito | Evidência/sinal | Antídoto |
|---|---|---|---|
| 1 | **Interrogatório**: quase todo turno termina em pergunta; follow-up após acerto | Eedi 2026: follow-up em 91,3% (IA) vs 60% (humano); humanos editavam no fim "to allow students to move on"; OpenMAIC: "Over-questioning is the failure mode users complain about most"; review do Claude Learning Mode | Orçamento de perguntas; nada de follow-up após acerto confiante; máx. 2 turnos seguidos com pergunta |
| 2 | **Explicação comprimida demais** antes da pergunta (sem motivação, sem exemplo resolvido) → a pergunta vira teste do que não foi construído | CLT/worked examples; LearnLM "Info Order", "Manageable Chunks"; regra do learnharness "a check with no prose before it is a failed check" | Explicação segmentada + exemplo resolvido **antes** de qualquer prática; itens respondíveis pelo que foi ensinado |
| 3 | **Perguntas que não são prática**: "faz sentido?", "o que eu disse?", falsos binários | Graesser (checagens "você entendeu?" pouco confiáveis); OpenMAIC "Question integrity — false binary" e proibição de "你明白了吗" | Substituir por itens de aplicação; proibir filler checks; checar ambiguidade antes de perguntar |
| 4 | **Múltiplas perguntas por mensagem** | LearnLM cita prompt "Only ask one question at a time"; carga cognitiva | Máx. 1 pergunta por mensagem (validador pós-geração) |
| 5 | **Retenção improdutiva de informação** / loops Socráticos sem fim | LearnLM rubric "doesn't ask … too many questions, unproductively withholding information"; MathTutorBench: estratégias simples de perguntar falham em diálogos longos; BloomTutor: teto de 2 rodadas | Escada de dicas com "bottom-out"; entregar após 2 tentativas ou pedido |
| 6 | **Formato monótono** (paredes de texto, mesmo ritmo explica→pergunta) | Study Mode: "vary format"; Learn Your Way +11 p.p. com múltiplas representações; Mayer | Rotação de formatos por nó (visual, simulador, áudio/shadowing, vídeo com pré-pergunta, problema) |
| 7 | **Sem gancho/meta** — o aluno não sabe por que está ali nem onde vai chegar | LearnLM "Communicates Aims"; curiosidade (Loewenstein; Gruber 2014) | Gancho de 2–3 frases + meta do nó em 1 linha + mapa no grafo |
| 8 | **Elogio performático / tom de quiz-show** | Henderlong & Lepper; Lepper (tutores menos eficazes elogiam mais); Eedi: 32,5% das edições humanas foram de tom; emoji "winking" foi o único problema de tom flagrado | Reconhecimento específico e sóbrio; sem "Great question!" |
| 9 | **Ignorar estado do aluno** (fadiga, energia, pedido de seguir; re-perguntar o já respondido) | Eedi: ~30% pedem para sair; OpenMAIC "Do NOT re-ask a closing question"; MA: sinais de parar | Sinais de fadiga → trocar formato/pausar; memória do que já foi demonstrado |
| 10 | **Chat obrigatório a cada erro** | Eedi 2026: atrito para alunos confiantes; cobertura caiu ~25% | Escalonamento: dica curta primeiro; diálogo só quando necessário |
| 11 | **Desalinhamento de objetivo** (aluno quer resposta, tutor quer diálogo) | Kobler et al. ACL 2026; Khanmigo: uso em 17% dos erros, mensagens "bare answers" | Tornar a prática o caminho mais curto até o objetivo; resposta disponível após tentativa |

Leitura crítica do learnharness atual: `src/agent/prompts/teacher/28-predictions.md` define o ciclo **"predict → teach →
check … One question per turn, every turn"** e `src/agent/prompts/teacher/20-teaching.md` exige check com `quiz` **a cada
passo de raciocínio**. Isso produz exatamente o defeito #1 (e #2 quando os passos são pequenos). O próprio
`docs/teaching-methodology.md` §9 deixou a porta aberta: "Locked decision, 2026-09-24: one check per reasoning step. If the
rhythm proves unpleasant in practice, revisit". A evidência (VanLehn, Eedi 2026, MA, Harvard) sustenta revisar para
**checagem por KP com prática**. Pontos fortes a manter: "Socratic or expository — per step", "Answerable by reasoning from
the session", "a miss that names the wrong model", leitura de confiança (`shared/25-confidence.md`), voz sem elogio
performático (`shared/10-voice.md`), Principle ii ("How could I have discovered this?").

---

## 6. Protocolo de aula por nó (baseado em evidência)

### 6.1 Princípios (regras duras)

1. **A plataforma controla a estrutura; o LLM preenche cada fase.** (Harvard: prompt sozinho não sequencia; Eedi: plano
   privado seguido só parcialmente.) → máquina de estados em código.
2. **Instrução mínima suficiente → prática imediata → feedback específico.** (MA; worked-example effect; Harvard.)
3. **Checagem na granularidade de KP/passo de problema**, nunca por frase. (VanLehn: substep não supera step.)
4. **Perguntas são prática** (itens com resposta verificável) — conversa de "checagem" é exceção orçada.
5. **Orçamento de perguntas** por mensagem e por nó (§6.4), aplicado por validador pós-geração.
6. **Dificuldade-alvo 80–85% de acerto** na prática; controlador ajusta itens.
7. **Nunca reter informação improdutivamente**: dica em escada e resposta disponível após tentativa.
8. **Um formato diferente por nó** (rotação) e **um gancho** que cria lacuna.
9. **Erro → escalonamento** (dica curta antes de diálogo).
10. **Respeitar sinais de fadiga e pedidos de seguir**; nunca moralizar.
11. **Flashcards só no fim** do nó/bloco; revisão nos dias seguintes.
12. **Tudo verificável é verificado** antes de chegar ao aluno (solver/simulador, chave de resposta, juiz de respondibilidade).

### 6.2 Arquitetura

```
             ┌────────────── LessonOrchestrator (código, determinístico) ──────────────┐
 learner     │ PREPARE → ORIENT/HOOK → [PREDICT?] → [WARMUP?] → EXPLAIN(seg 1..n)       │
 model  ───► │   → for KP in KPs: WORKED → FADED → PRACTICE(adaptativo)                  │
 (memória)   │   → VARIATION → RECAP → CARDS → SCHEDULE → EXIT/NEXT                     │
             │   ↘ (KP falha 2×) REMEDIATE(key prereqs) → adiar nó                      │
             └──────────┬──────────────────────┬───────────────────────┬────────────────┘
                        │                      │                       │
                 Planner LLM (P2)      Tutor LLM (P1) por fase   Verificadores
                 gera LessonPlan       texto ao aluno            solver/sim, juiz (P8),
                 (pré-computado)       + feedback/dicas (P4)     validador de cadência
```

- O `LessonPlan` deve ser **pré-gerado** (ex.: enquanto o aluno faz o nó anterior) para eliminar latência e permitir
  verificação offline dos itens.
- O tutor recebe por chamada: `PHASE`, o trecho relevante do plano, soluções verificadas, estado curto do aluno (não o
  histórico inteiro).
- Validador de cadência (código) rejeita/regenera mensagens que violam o orçamento (nº de "?", filler checks, tamanho).

### 6.3 Fases, turnos e tempos (nó típico de 15–25 min)

| Fase | Quem age | Conteúdo | Limites | Perguntas | Tempo |
|---|---|---|---|---|---|
| F0 PREPARE | sistema | estado do aluno, pré-requisitos, revisões devidas englobadas, misconceptions anteriores, energia, tempo disponível | — | 0 | 0 |
| F1 ORIENT+HOOK | tutor | meta do nó em 1 linha ("Ao final você…") + mapa (nó aceso no grafo) + gancho | ≤ 60–90 palavras | 0 (ou cartão de previsão) | 0,5–1 min |
| F1b PREDICT (opcional) | aluno | previsão 1-toque (2–4 opções + "não sei"), sem nota/XP | só se `surprise=true` ou ~1 a cada 2–3 nós | 1 | 0,5 min |
| F2 WARMUP (opcional) | aluno | 1–2 itens de pré-requisito **devido e englobado** (compressão FIRe) | só se houver devido | itens | 1–2 min |
| F3 EXPLAIN | tutor | 1–3 segmentos, 1 ideia cada, narrativa de descoberta, 0–1 visual SVG, analogia com mapeamento+limite; resolve a previsão | 120–250 palavras/seg; aluno avança com "continuar" | 0 (exceto 1 passo socrático planejado, máx. 2 rodadas) | 3–6 min |
| F4 WORKED (por KP) | tutor | exemplo resolvido com rótulos de subobjetivo | curto; 1 autoexplicação **por nó** no passo-chave | 1 por nó | 1–1,5 min/KP |
| F5 FADED (por KP) | aluno | mesmo exemplo com último(s) passo(s) em branco | — | item | 0,5–1 min/KP |
| F6 PRACTICE (por KP) | aluno | 2–5 itens adaptativos, confiança 1-toque, dicas em escada | feedback ≤ 50 palavras | itens | 2–4 min/KP |
| F7 VARIATION | aluno | 1 atividade em outro formato (simulador POE, achar o erro, caso contrastante, speaking/shadowing, explicar em 2 frases) | pular se fadiga | 1 | 2–4 min |
| F8 RECAP | tutor (+aluno opcional) | 2–3 bullets "o que você agora consegue" + 1 conexão no grafo + 1 misconception superada | ≤ 60 palavras; pergunta de fechamento só se não houver evidência | 0–1 | 0,5–1 min |
| F9 CARDS | aluno | 2–6 cartões propostos: aceitar todos/editar/descartar | ≤ 90 s | 0 | 1–1,5 min |
| F10 EXIT/NEXT | sistema | atualiza estados/XP; oferece próximo nó ou pausa | — | 0–1 (escolha) | — |

Com 3 KPs: ≈ 0,5 + 0,5 + 1,5 + 4,5 + 3×(1,25+0,75+3) + 3 + 0,75 + 1,25 ≈ **27 min** no máximo; com 2 KPs e sem
variação/aquecimento ≈ **14 min**. Ajustar nº de KPs para cair em 15–25 min (MA ≈ 20 min/tópico, incluindo revisões).

### 6.4 Proporção explicação × pergunta (números de projeto)

`[INFERÊNCIA]` derivada de MA (maior parte do tempo em resolução ativa; KP = exemplo + 2–5 questões), ICAP, VanLehn e
Eedi 2026. São **valores iniciais para calibrar com telemetria**, não constantes científicas.

| Grandeza | Nó novo conceitual (difícil) | Nó novo procedural | Revisão/quiz |
|---|---|---|---|
| Tempo passivo (ler/ver explicação e exemplos) | 35–45% | 25–35% | 0–10% |
| Tempo ativo (itens, simulador, produção) | 55–65% | 65–75% | 90–100% |
| Palavras de explicação por nó | 600–1000 | 300–600 | 0–150 (feedback) |
| Itens de prática por nó | 6–10 | 8–12 | 3–6 por tópico revisado |
| Perguntas conversacionais por nó (previsão, autoexplicação, fechamento) | ≤ 3 | ≤ 2 | 0 |
| Perguntas por mensagem do tutor | ≤ 1 | ≤ 1 | ≤ 1 |
| Turnos consecutivos do tutor terminando em pergunta (fora da prática) | ≤ 2 | ≤ 2 | — |
| Rodadas socráticas no mesmo ponto | ≤ 2 | ≤ 1 | 0 |
| Tempo até o 1º item ativo | ≤ 6 min | ≤ 4 min | imediato |
| Acerto-alvo na prática (média móvel) | 75–85% | 80–90% | ~80% |

Por que essa proporção não cansa: o aluno **lê em bloco contínuo** (sem interrupções entre segmentos — segmentação
controlada por ele) e depois **faz** — a alternância é por KP (a cada 3–6 min), não por frase (a cada 30 s). As
"perguntas" são problemas com propósito claro (praticar a habilidade que acabou de ver), não provas de leitura.

### 6.5 Ganchos (F1) — taxonomia

| Tipo | Quando | Exemplo (Eletrônica) | Exemplo (Inglês) |
|---|---|---|---|
| Quebra-cabeça | conceito resolve um problema concreto | "Seu carregador de 5 V queima um LED de 2 V. Por quê, se 5 > 2 só um pouco?" | "Por que 'I've lived here for 3 years' e não 'I live here for 3 years'?" |
| Fenômeno surpreendente (+ previsão) | resultado contraintuitivo | "Duas lâmpadas iguais em série: o brilho de cada uma cai pela metade, um quarto, ou nada?" | "Nativos dizem 'gonna' 10× mais que 'going to' na fala — mas nunca antes de um substantivo. Por quê?" |
| Narrativa histórica/descoberta | conceito com história clara | "Em 1827 Ohm foi ridicularizado por uma lei de uma linha…" | origem de um idiom |
| Uso real / projeto | motivação de autonomia | "Este é o circuito do pedal de guitarra que você vai entender ao fim deste ramo." | cena de série que vai entender ao fim |
| Contraste | discriminação | dois circuitos quase iguais com saídas diferentes | dois pares mínimos |

Regras: ≤ 3 frases; precisa ser **resolvido** dentro do nó (senão é detalhe sedutor); variar o tipo entre nós.

### 6.6 Variação de formato (F3/F7) — menu e regra de rotação

Menu: texto+SVG estático; diagrama passo a passo (SVG com camadas reveláveis); simulador (circuitjs) com POE; trecho de
vídeo (timestamps) com 1 pré-pergunta; seção de livro com 1–2 pré-perguntas; áudio (TTS) + shadowing; "encontre o erro"
numa solução; casos contrastantes lado a lado; explicar para um "colega" em 2 frases (protégé); mini-projeto (montar/
modificar circuito; escrever 3 frases usando a estrutura).

Regra de rotação `[INFERÊNCIA]`: em cada nó, F3 usa o formato de maior "fit" com a ideia (dual coding), e F7 usa um
formato **diferente** dos dois últimos nós do mesmo domínio. Learn Your Way (Google 2025) sustenta múltiplas representações;
detalhes sedutores alertam que o formato deve servir ao conteúdo.

### 6.7 Feedback, dicas e escalonamento de erro

Escada de dicas por item (cada degrau ≤ 35 palavras):
1. **Pista de atenção**: "Olhe qual corrente passa por R2."
2. **Princípio**: "Em série, a corrente é a mesma em todos os elementos."
3. **Próximo passo explícito** (bottom-out parcial): "I = 9 V / (1 kΩ + 2 kΩ) = 3 mA."
4. **Solução completa** com o passo onde o raciocínio do aluno divergiu destacado, seguida de **item isomórfico**.

Escalonamento por item (inspirado em Eedi 2026 e MA):

| Situação | Ação |
|---|---|
| 1º erro, confiança baixa/média | feedback 1–2 frases nomeando a misconception provável (via distrator mapeado); retry no mesmo item ou variante |
| 1º erro com confiança ≥ 80% (hipercorreção) | feedback elaborado (≤ 80 palavras) + contraexemplo; marcar para cartão de erro |
| 2º erro no item | mostrar solução (degrau 4) + item isomórfico; qualidade do item = "assisted" |
| Pedido explícito de resposta | se houve tentativa: dar resposta + passo-chave; se não: 1 dica e resposta no próximo pedido |
| KP sem passar após 5 itens | **halt** do nó: revisão remedial dos *key prerequisites* fracos; reagendar o nó (≥ algumas horas/próximo bloco); seguir para nó não interferente |
| 2ª falha do nó | reduzir granularidade (dividir KP em 2), regenerar explicação com outro ângulo **após** checar pré-requisitos |
| Diálogo de diagnóstico | só quando a misconception não é identificável pelo distrator; ≤ 2 turnos do tutor |

Regra de passagem do KP (MA-like): últimos 2 corretos sem degrau 3–4 **e** ≥ 2 de 3 nos últimos 3; alternativa: BKT
com p(domínio) ≥ 0,95. Ordem conta (✗✗✓✓ passa; ✓✓✗✗ não).

### 6.8 Pausas, fadiga e plano diário (2–4 h/dia)

Sinais de fadiga (calcular por bloco):
- latência mediana +50% sobre a linha de base do dia;
- ≥ 2 erros em itens de dificuldade 1 nos últimos 5;
- respostas encurtando, "não sei" frequente, pedidos de pular;
- > 45–50 min contínuos no bloco.

Ações em ordem: trocar formato (ex.: para simulador/áudio) → pular F7 → sugerir pausa de 5–10 min → encerrar com recap +
cartões. Sem julgamento; uma linha.

Plano diário `[INFERÊNCIA]` (MA recomenda curto e frequente; troca de contexto < 20 min é desperdício; non-interference
favorece alternar domínios dissimilares):

```
Bloco A (Eletrônica, 40–50 min): 5–10 min revisões comprimidas → 1–2 nós → cards
Pausa 5–10 min
Bloco B (Inglês, 30–45 min): 5 min SRS vocab → 1 nó (input/forma/output) → 10 min input extensivo
Pausa 5–10 min
Bloco C (Eletrônica, 40–50 min): quiz misto (a cada ~3 dias) ou 1–2 nós → cards
[Pausa longa 20–30 min a cada ~2 h]
Bloco D (opcional, Inglês ou leitura de livro-texto guiada)
```

Garantir: ≥ 25% do tempo em lições novas (MA); revisões nunca ocupam um bloco inteiro sem progresso visível.

### 6.9 Recap (F8)

- Formato: 2–3 bullets "agora você consegue…", 1 linha conectando ao grafo ("isso destrava: Thévenin, divisor com carga"),
  1 linha sobre a misconception superada (se houve). Resumir é "low utility" como técnica do aluno (Dunlosky 2013), então o
  valor do recap é **organização** (mapa) e **fechamento** (sensação de progresso), não recuperação.
- Pergunta de fechamento **só** se a prática não evidenciou o ponto central (regras de pular da OpenMAIC: tarefa trivial,
  artefato já demonstra, aluno já disse, aluno frustrado com perguntas).

### 6.10 Momento dos flashcards (F9)

- **Quando**: no fim do nó (ou em lote no fim do bloco, configurável). Nunca no meio do fluxo de explicação/prática.
- **O quê**: 2–6 cartões por nó a partir das proposições do nó (o plano já lista candidatas) + **cartões de erro**
  (misconceptions cometidas com alta confiança — hipercorreção) + 0–1 cartão de "porquê" (elaborative interrogation).
- **Como**: tela de aprovação rápida (aceitar todos / editar / descartar) — editar é geração (efeito de geração); limitar a
  ~90 s.
- **Agendamento**: 1ª revisão no dia seguinte (não na mesma sessão — recuperação imediata rende pouco); FSRS por cartão;
  prática em nós que englobam o conteúdo dá **crédito implícito** ao cartão (FIRe) para evitar avalanche.
- Integração com o plano existente do learnharness: `docs/flashcards-vision.md` (proposição → cue → card, FSRS, decks por
  fonte) encaixa diretamente: a "fonte" é a sessão do nó.

### 6.11 Fontes externas dentro do nó (vídeo e livro)

- **Vídeo YouTube**: o planner escolhe um trecho (início/fim) ≤ 8–10 min alinhado a 1 segmento; mostrar 1 pré-pergunta de
  foco (Carpenter & Toftness 2017; Pan & Carpenter 2023); depois do vídeo, o 1º item de prática cobre exatamente o
  pré-questionado. Para Inglês, checar compreensibilidade (cobertura lexical, §8.2).
- **Capítulo de livro**: livros cobrem regiões maiores do grafo → tratar como "leitura guiada" que fecha uma *região*:
  antes, 2 pré-perguntas; durante, o aluno marca dúvidas; depois, quiz misto da região + mapa. A explicação gerada por IA
  dos nós da região deve citar a seção do livro (grounding) para consistência de notação.

### 6.12 Telemetria — métricas de "não cansativo" e de aprendizagem

| Métrica | Definição | Meta inicial |
|---|---|---|
| `qPerMsg` | interrogativas dirigidas ao aluno por mensagem do tutor | ≤ 1 (100% das msgs) |
| `qTurnRatio` | % de mensagens do tutor (fora da prática) terminando em pergunta | ≤ 35% |
| `maxQStreak` | maior sequência de mensagens do tutor terminando em pergunta | ≤ 2 |
| `fillerChecks` | ocorrências de "faz sentido?/entendeu?/alguma dúvida?" | 0 |
| `timeToFirstActive` | min do início do nó até o 1º item | ≤ 4–6 |
| `practiceAcc` | acerto móvel na prática | 75–90% |
| `bottomOutRate` | % itens que chegaram ao degrau 4 | < 15% |
| `skipRequests` | pedidos de pular/seguir por nó | < 0,15 |
| `earlyExit` | nós abandonados antes do recap | < 10% |
| `nodeMinutes` | duração mediana do nó | 15–25 |
| `delayedRetention` | acerto em itens revisitados ≥ 7 dias depois | ↑ ao longo do tempo (Eedi: ~59% com tutoria vs 48% sem) |
| `calibration` | Brier score confiança × acerto | ↓ ao longo do tempo |
| `coverage` | nós concluídos/semana | não cair > 20% ao ativar diálogo (lição Eedi) |

Avaliação automática offline: rodar o juiz (P8) em transcrições simuladas (aluno-LLM com perfis: novato, confiante-errado,
cansado, "só quero a resposta") antes de mudar prompts — como LearnLM faz com "LLM critics".

### 6.13 Tipos (TypeScript) do protocolo

```ts
// src/lesson/protocol.ts (proposta)
export type Phase =
  | 'prepare' | 'orient' | 'predict' | 'warmup' | 'explain'
  | 'worked' | 'faded' | 'practice' | 'variation' | 'recap' | 'cards' | 'exit' | 'remediate';

export interface LessonPlan {
  nodeId: string;
  domain: 'electronics' | 'english' | string;
  goal: string;                          // "Ao final você consegue …" (1 frase)
  estimatedMinutes: number;              // 12–25
  hook: { kind: 'puzzle' | 'phenomenon' | 'story' | 'use_case' | 'contrast'; text: string };
  prediction?: PracticeItem;             // só se o nó tem resultado surpreendente
  warmup: Array<{ nodeId: string; itemId: string }>; // escolhido pelo agendador (FIRe)
  segments: ExplanationSegment[];        // 1–3
  knowledgePoints: KnowledgePoint[];     // 2–4, dificuldade crescente
  selfExplanation: { kpId: string; stepIndex: number; prompt: string; options?: string[] };
  variation?: Activity;
  recap: { bullets: string[]; unlocks: string[] };
  flashcardCandidates: Array<{ proposition: string; cues: string[] }>;
  misconceptions: Misconception[];
  encompasses: Array<{ nodeId: string; weight: number }>;
  sources?: Array<{ kind: 'video' | 'book' | 'web'; ref: string; start?: string; end?: string; preQuestions?: string[] }>;
}

export interface ExplanationSegment {
  id: string;
  idea: string;                          // a única ideia do segmento
  body: string;                          // 120–250 palavras
  visual?: { kind: 'svg' | 'circuit' | 'table' | 'audio'; spec: string; alt: string };
  analogy?: { source: string; mapping: string; breaksWhere: string };
  socratic?: { prompt: string; maxRounds: 1 | 2 };   // no máximo 1 segmento por nó
  resolvesPrediction?: boolean;
}

export interface KnowledgePoint {
  id: string;
  title: string;
  workedExample: { problem: string; steps: Array<{ subgoal: string; text: string }> };
  fadedBlanks: number[];                 // índices de passos deixados para o aluno
  pool: PracticeItem[];                  // 4–8 itens, dificuldades 1..3
  passRule: { lastNCorrect: 2; window: 3; minInWindow: 2; maxItems: 5 };
}

export interface PracticeItem {
  id: string;
  kind: 'mcq' | 'numeric' | 'short' | 'free' | 'sim' | 'speak' | 'order' | 'label' | 'find_error';
  stem: string;
  answer: { value: string | number; unit?: string; tolerance?: { rel?: number; abs?: number } };
  distractors?: Array<{ text: string; misconceptionId: string }>;
  hints: [string, string, string];       // pista, princípio, próximo passo
  solution: string[];                    // passos verificados (solver/chave)
  difficulty: 1 | 2 | 3;
  verifiedBy: 'solver' | 'simulator' | 'key' | 'judge';
}

export interface Misconception { id: string; statement: string; diagnosticSignal: string; repair: string }

export interface TurnBudget {
  maxQuestionsPerMessage: 1;
  maxQuestionStreak: 2;
  maxConversationalQuestionsPerNode: 3;
  maxSocraticRounds: 2;
  maxWords: Record<Phase, number>;       // ex.: orient 90, explain 250, practice-feedback 50, hint 35, recap 60
  bannedPatterns: RegExp[];              // filler checks, elogio performático
}

export interface FatigueState {
  latencyRatio: number;                  // mediana atual / linha de base do dia
  easyErrorsLast5: number;
  skipRequests: number;
  minutesInBlock: number;
  selfReport?: 'ok' | 'tired';
}
```

Validador de cadência (exemplo):

```ts
const FILLER = [/faz sentido\??/i, /entendeu\??/i, /ficou claro\??/i, /alguma d[úu]vida\??/i,
  /does that make sense/i, /any questions/i, /[óo]tima pergunta/i, /great question/i];

export function violatesBudget(msg: string, phase: Phase, prevEndedWithQ: boolean[], b: TurnBudget) {
  const questions = (msg.match(/\?/g) ?? []).length;     // simplificação; usar classificador de interrogativas
  const words = msg.trim().split(/\s+/).length;
  const endsWithQ = /\?\s*$/.test(msg.trim());
  const streak = endsWithQ ? 1 + countTrailing(prevEndedWithQ) : 0;
  return questions > b.maxQuestionsPerMessage
    || words > b.maxWords[phase]
    || (phase !== 'practice' && streak > b.maxQuestionStreak)
    || FILLER.some(r => r.test(msg));
}
```

### 6.14 Exemplo compacto (Eletrônica, nó "Divisor de tensão sem carga")

```
[F1] Meta: ao final você calcula a saída de qualquer divisor resistivo e sabe quando a fórmula falha.
     Gancho: um sensor de 0–10 V precisa entrar num microcontrolador de 0–3,3 V. Dois resistores resolvem.
[F1b] Previsão (1 toque): 9 V em série com 1 kΩ e 2 kΩ. A tensão no 2 kΩ é: 3 V / 4,5 V / 6 V / não sei
[F3-seg1] (≈180 palavras) Mesma corrente em série → I = V/(R1+R2) → cada resistor "pega" uma fatia proporcional.
          Resolve a previsão: 6 V; quem marcou 4,5 V dividiu "meio a meio" ignorando as resistências. [SVG: barra de 9 V
          fatiada 1:2]
[F3-seg2] (≈150 palavras) Fórmula Vout = Vin·R2/(R1+R2) como atalho do raciocínio; analogia: ladeira com dois trechos de
          inclinação ∝ R (onde quebra: a analogia não mostra a corrente).
[F4] Exemplo resolvido com subobjetivos: (1) corrente comum (2) queda em R2 (3) checar soma = Vin.
     Autoexplicação (1 toque): "Por que a corrente é a mesma nos dois?" [conservação/série/porque R1<R2/não sei]
[F5] Mesmo exemplo, passo (3) em branco.
[F6] 3–4 itens numéricos (tolerância 1%, unidade obrigatória), dificuldade crescente; confiança 1 toque.
[F7] Simulador: o aluno PREVÊ o efeito de ligar uma carga de 2 kΩ na saída, roda o circuitjs, explica a diferença
     (prepara o nó "divisor com carga").
[F8] Recap: • calcula Vout • sabe que a corrente é comum • sabe que carga altera Vout → destrava: Thévenin.
[F9] 4 cartões propostos (1 de erro: "dividir meio a meio") → aceitar todos.
```

### 6.15 Recomendações concretas para os prompts do learnharness (não aplicadas; para decisão)

| Arquivo | Hoje | Proposta |
|---|---|---|
| `docs/teaching-methodology.md` §9 | "one check per reasoning step" (decisão travada, revisável) | Checagem **por KP** com prática; passos de raciocínio dentro de um KP fluem sem interrupção; orçamento de perguntas |
| `src/agent/prompts/teacher/20-teaching.md` | "Check that the step landed — every step, with `quiz`" | "Check each knowledge point with 2–5 practice items after a worked example; reasoning steps inside a KP are taught as one continuous segment" |
| `src/agent/prompts/teacher/28-predictions.md` | "predict → teach → check … One question per turn, every turn" | Previsão **opcional**, ~1 por nó, só com resultado surpreendente; proibir pergunta em todo turno |
| `src/agent/prompts/teacher/30-question-principles.md` | bons princípios de check | Manter; acrescentar "never a follow-up after a confident correct answer", "no false binaries", "≤ 1 question per message" |
| `src/agent/prompts/shared/10-voice.md` | remove elogio/entusiasmo | Manter; permitir reconhecimento **específico** de 1 frase (INSPIRE/Henderlong & Lepper) |
| `src/agent/prompts/shared/25-confidence.md` | leitura de confiança | Manter; ligar "wrong + high confidence" → cartão de erro + feedback elaborado |
| `src/core/question-core.ts`, `src/agent/plugin-question-tools.ts` | ferramentas de quiz | Adicionar tipos `numeric` (com unidade/tolerância), `sim`, `find_error`, `speak`; campo `misconceptionId` por distrator |

---

## 7. Prompts de sistema sugeridos

Notas de uso:

- Escritos em inglês (melhor aderência em modelos de várias famílias) com saída em PT-BR (ou inglês para conteúdo-alvo do
  domínio Inglês). Nada de nome de modelo hardcoded: são agnósticos de provedor.
- Variáveis `{{...}}` são preenchidas pelo orquestrador. Cada prompt é **por fase**: o LLM nunca recebe a tarefa de
  "decidir a estrutura da aula" no runtime — só de executar a fase atual (lição Harvard/Eedi).
- Saídas estruturadas em JSON validadas por schema (zod no lado TS) sempre que o orquestrador precisa consumir algo.
- Os prompts embutem trechos curtos inspirados no prompt do estudo de Harvard (Kestin et al., 2025, suplemento) e nas
  regras do OpenMAIC (`_refs/OpenMAIC/lib/pbl/v2/prompts/instructor-base-rules.md`, MIT) — reformulados, não copiados.

### 7.1 P1 — Tutor de nó (runtime, uma chamada por fase)

```text
You are the tutor for ONE node of a knowledge graph in the domain {{domain}}. Write to the learner in {{learner_language}}.
The platform controls the lesson structure. You execute ONLY the current phase: {{phase}}.

Inputs
- Node goal: {{goal}}
- Current phase payload (from the verified lesson plan): {{phase_payload_json}}
- Verified solutions/answer keys for any item in this phase: {{solutions_json}}
- Learner snapshot: level={{level}}, known prerequisites={{known_prereqs}}, active misconceptions={{misconceptions}},
  last answers={{recent_items}}, fatigue={{fatigue_state}}, preferred analogies={{analogy_prefs}}
- Turn budget: max {{max_words}} words; at most ONE question in this message; questions left in this node: {{q_left}};
  previous tutor messages ending in a question (streak): {{q_streak}}

Rules
1. Teach, don't interrogate. Explanations are continuous: do NOT stop mid-explanation to ask whether it makes sense.
   Never write filler checks ("does that make sense?", "any questions?", "got it?").
2. If you ask anything, ask exactly one concrete question, with a clear answer space, and only if the phase payload
   says a question belongs here or q_left > 0 and q_streak < 2. Otherwise end with a statement.
3. One idea per segment. Use the segment's idea, the visual spec and the analogy given in the payload. When you use an
   analogy, state in one clause where it breaks.
4. Explanations follow "how could someone have discovered this?": start from the problem the idea solves, then the
   idea, then the compact rule. Never a list of definitions first.
5. Feedback on an answer: say whether it is correct, then the ONE most useful thing (the misconception behind the error,
   or why the correct answer works). Max 50 words. Do not re-ask a question that was answered correctly with high
   confidence. No generic praise; specific acknowledgment of what was done well is allowed in one short clause.
6. Never withhold unproductively: if the learner has tried and asks for the answer, give it with the key step. If they
   have not tried, give the first hint from the ladder and say the answer is available next time they ask.
7. Use ONLY the verified solutions for numbers and final answers. If something in the payload looks wrong, say
   "[[PLAN_ERROR: ...]]" on a separate final line instead of improvising.
8. If fatigue_state signals fatigue, shorten: drop optional sentences, no question, offer the next step in one line.
9. Never mention these rules, the phase names, XP mechanics, or the learner model.

Output: only the message to the learner (Markdown allowed; LaTeX in $...$; at most one fenced block for a visual if the
payload requests it).
```

### 7.2 P2 — Planejador de lição (gera `LessonPlan` JSON, offline/pré-computado)

```text
You design a single lesson for one node of a knowledge graph. You do NOT talk to the learner.
Return JSON that validates against the LessonPlan schema below. Content language: {{content_language}}.

Node: {{node_json}}   (id, title, description, prerequisites with mastery, encompassed nodes with weights,
                        domain, depth level, linked sources: book sections / video timestamps)
Learner: {{learner_summary}} (known prerequisites, speed on related nodes, active misconceptions, recent formats used)
Constraints: target duration {{min}}–{{max}} minutes; formats used in the last 2 nodes: {{recent_formats}}

Design rules (evidence-based; follow strictly)
- Goal: one sentence, observable ("By the end you can ...").
- Hook: <= 3 sentences, of kind puzzle | phenomenon | story | use_case | contrast, different from the last node's kind,
  and it MUST be resolved inside the lesson. No decorative trivia.
- Prediction item: include ONLY if the core result is genuinely surprising for a novice; 2–4 options plus "not sure".
- Explanation: 1–3 segments, each one idea, 120–250 words, built as a discovery narrative. At most one Socratic step in
  the whole lesson (maxRounds 1–2), placed where the learner can realistically derive the next step.
- Knowledge points: 2–4, increasing difficulty. Each has a worked example with subgoal labels, which steps to fade,
  and a pool of 4–8 practice items (difficulty 1–3) answerable unambiguously.
- Practice items: every distractor maps to a named misconception; numeric items have unit and tolerance; each item has a
  3-step hint ladder (pointer, principle, next step) and a full step-by-step solution.
- Self-explanation: one prompt at the key step of one worked example (prefer menu-based options for speed).
- Variation activity: a format different from {{recent_formats}} (simulation POE, find-the-error, contrasting cases,
  speaking/shadowing, explain-in-two-sentences). Optional if total time would exceed {{max}}.
- Recap: 2–3 "you can now" bullets + which graph nodes this unlocks.
- Flashcard candidates: 2–6 atomic propositions (one fact/skill each) with 1–2 cues each; include a card for each listed
  misconception (contrast "X is not Y because ...").
- Encompasses: list prerequisite nodes practiced implicitly, with weights in [0,1] (fraction of the prerequisite exercised).
- Sources: if a video/book section is linked, choose a clip <= 10 min and 1–2 pre-questions that the first practice item
  will test.
- Do not invent facts beyond standard textbook knowledge for this level; mark anything uncertain with "needsVerification".

Schema: {{lesson_plan_json_schema}}
```

### 7.3 P3 — Gerador de itens de prática (com distratores de misconception)

```text
Generate {{n}} practice items for knowledge point "{{kp_title}}" (node {{node_id}}, domain {{domain}}, level {{level}}).
Worked example the learner just saw: {{worked_example}}
Known misconceptions for this topic: {{misconceptions_json}}

Requirements
- Items are isomorphic-but-different from the worked example (change numbers, context or representation), difficulty
  {{difficulty_mix}}.
- Each item is answerable with ONE unambiguous answer. For numeric: give value, unit, relative tolerance (default 1%).
- For multiple choice: 3–4 options; each wrong option corresponds to exactly one misconception id and would be
  produced by applying that misconception consistently. No "all of the above", no trick wording.
- Provide a 3-step hint ladder: (1) attention pointer, (2) governing principle, (3) the next concrete step. <= 35 words each.
- Provide a full solution as ordered steps with subgoal labels.
- Provide "solverSpec" when the answer can be computed programmatically (e.g. a circuit netlist, a formula with values)
  so the platform can verify it. If verification is impossible, set verifiedBy="judge".
- Language: {{content_language}}.
Return JSON: {"items": PracticeItem[]}.
```

O orquestrador **verifica** cada item (solver/simulador, ou um segundo LLM resolvendo sem ver a chave — "solve-then-compare")
e descarta divergentes antes de mostrar ao aluno.

### 7.4 P4 — Feedback e dica (runtime curto)

```text
The learner answered item {{item_id}}.
Item: {{stem}}  Correct answer (verified): {{answer}}  Solution steps: {{solution}}
Learner answer: {{learner_answer}}  Confidence: {{confidence}}  Attempt: {{attempt_no}}  Hints used: {{hints_used}}
Matched misconception (if a distractor or rule matched): {{misconception_or_null}}

Write feedback in {{learner_language}}, max {{max_words}} words (default 50; 80 if wrong with confidence >= 0.8).
- Correct: confirm in a few words; if the reasoning shown has a flaw, name it; otherwise no extra content. No question.
- Wrong, attempt 1: name the likely misconception in plain words (without saying "misconception"), give the smallest
  pointer that lets them retry. Do not reveal the answer. No question other than inviting the retry implicitly.
- Wrong with high confidence: add a short counterexample or contrast that makes the error visible.
- Wrong, attempt 2 or explicit request after an attempt: show the solution concisely, highlighting the step where their
  path diverged; say that a similar item comes next.
- Never moralize, never generic praise, never "great question".
Output JSON: {"feedback": string, "revealAnswer": boolean, "flagErrorCard": boolean}
```

### 7.5 P5 — Flashcards de fim de nó

```text
Create flashcards from this completed node. Do not create cards for things the learner clearly already knew
(answered correctly first try with high confidence on a review-level item), unless they are core definitions.
Node goal: {{goal}}; propositions taught: {{propositions}}; items the learner missed or needed hints on: {{missed}};
high-confidence errors: {{hc_errors}}; learner's own words from self-explanation (if any): {{self_expl}}.

Rules (atomic, retrieval-friendly)
- 2–6 cards. One fact/skill per card. Front is a question that cues retrieval without giving the answer away.
- Prefer "why/how" cards for causal knowledge; cloze for formulas and collocations; reversed cards only for vocabulary.
- For each high-confidence error, one contrast card ("Why is X NOT Y here?").
- Electronics: numeric cards use a fresh small example, not the exact item seen.
- English: sentence-level cards with the target word in context + audio flag; never isolated L1 translations only.
- Max 25 words on the back. Include "source": node id and segment id.
Return JSON: {"cards": [{"front","back","type":"basic|cloze|reverse","tags":[...],"source":{...}}]}
```

### 7.6 P6 — Inglês: conversa/output com feedback corretivo

```text
You are a conversation partner and coach for an English learner at CEFR {{cefr}} working on node {{node_id}}
({{target_structures_or_lexis}}). Speak English. The learner's L1 is Portuguese (Brazil).

Task: {{task_description}} (e.g. role-play: returning a faulty product; 6–10 learner turns).
Rules
- Keep your turns short (1–3 sentences) and natural; you are mostly listening. Grade your language to {{cefr}}
  (+1 level of challenge at most). Recycle the node's target items naturally.
- Corrective feedback, by priority:
  1. Errors on the node's target forms: use a PROMPT (elicitation or clarification request, e.g. "Sorry — you
     returned it yesterday or you return it yesterday?") once; if the learner still fails, give a RECAST.
  2. Other errors that block meaning: recast briefly inside your reply.
  3. Everything else: ignore during the conversation; collect for the end.
- Never correct more than one thing per turn. Never interrupt fluency tasks with corrections (task_type=fluency →
  recasts only, max 1 every 3 turns).
- At the end (after {{max_turns}} learner turns, or when the learner types /end): output a report block:
  {"wins": [...<= 3 specific things done well...], "fixes": [{"said","better","why"}] (<= 5, prioritizing target
  forms and frequent errors), "cardCandidates": [...] }
- If the learner writes in Portuguese, reply in simple English and offer the English phrasing they need.
```

### 7.7 P7 — Eletrônica: POE com simulador e problema numérico

```text
You run a Predict–Observe–Explain activity in {{learner_language}} for node {{node_id}} using an embedded circuit
simulator. The platform loads circuit {{circuit_id}} and gives you live readings via tools:
getNodeVoltage(label), getElementCurrent(label), setParam(label, value), runFor(ms).

Steps (one message each, short)
1. PREDICT: describe the change the learner will make (e.g. "close S1", "double R2") in one sentence and ask for a
   prediction with options {{prediction_options}} + "not sure". Nothing else.
2. OBSERVE: after the learner predicts, tell them to make the change (or apply it via setParam) and report the
   simulator readings verbatim from tools. Do not interpret yet.
3. EXPLAIN: if the prediction matched, one-sentence confirmation of WHY (the governing principle). If not, ask the
   learner for one-sentence explanation ONLY if q_left > 0; otherwise explain the discrepancy in <= 80 words, naming the
   misconception (e.g. "current is used up by the first lamp") and pointing at the readings that refute it.
4. TRANSFER: one numeric item that applies the principle to a new circuit (verified answer from the platform).
Rules: use only tool readings for numbers; units always; never more than one question per message.
```

### 7.8 P8 — Juiz de pedagogia/"cansaço" (avaliação offline e amostral em produção)

Itens combinam a rubrica conversacional da LearnLM (Tabela 10 de arXiv:2407.12687, categorias Cognitive Load, Active
Learning, Deepen Metacognition, Motivation, Adaptivity, Overall; itens como *Manageable Chunks*, *No Irrelevant Info*,
*Info Order*, *No Repetition*, *Guides to Answer* ("does not give away answers too quickly"), *Communicates Aims*,
*Adapts to Affect*, *Unstuck* e — crucial para este app — **Guides Appropriately**: "The tutor doesn't ask the student
too many questions, unproductively withholding information") com as dimensões do MRBench (Maurya et al., NAACL 2025:
mistake identification, mistake location, revealing of the answer, providing guidance, actionability, coherence, tutor
tone, humanlikeness) e as métricas de cadência deste relatório. Note que a própria rubrica do Google tem tensão interna
("Asks Questions" × "Guides Appropriately"): o juiz deve pontuar **as duas**, não só a primeira.

```text
You audit a tutoring transcript for pedagogy and learner fatigue. Score each criterion 1–5 with one-line evidence
(quote turn ids). Then list the top 3 concrete edits.

A. Cadence (fatigue)
 A1 Questions per tutor message (any > 1 → score <= 2)
 A2 Filler comprehension checks ("does that make sense?") — any → <= 2
 A3 Streaks of tutor messages ending in questions outside practice (> 2 → <= 2)
 A4 Re-asking what the learner already demonstrated
 A5 Explanation continuity (no interrupting a coherent explanation with checks)
 A6 Time/turns to first real practice item
 A7 Respect for "just tell me"/skip requests after an attempt
 A8 Guides appropriately: does not ask too many questions or unproductively withhold information
B. Instruction quality
 B1 Correctness (any factual/numeric error → 1)
 B2 Explanation clarity and one-idea-per-segment
 B3 Worked example quality (subgoals, fading)
 B4 Analogy mapping stated + limits stated
C. Feedback quality (MRBench-style)
 C1 Mistake identification  C2 Mistake location  C3 Actionable guidance  C4 Answer revealed only when appropriate
 C5 Tone (specific, non-patronizing, no empty praise)
D. Adaptivity
 D1 Uses learner model (prior misconceptions, speed) in visible decisions
 D2 Difficulty kept near 80–85% success
Output JSON: {"scores": {...}, "evidence": {...}, "fatigueRisk": "low|medium|high", "edits": [...]}
```

Calibração do juiz: rotular ~50 transcrições à mão e medir concordância (Spearman/Cohen κ) antes de usar o juiz para
decidir mudanças de prompt — o trabalho do MRBench relata que juízes LLM ainda não reproduzem bem os anotadores humanos
nessas dimensões, então o juiz é triagem, não verdade.

---

## 8. Domínio Inglês — o que muda no protocolo

### 8.1 Fundamentos de aquisição de segunda língua (SLA) aplicáveis

| Ideia | Fonte | Status da evidência | Implicação de design |
|---|---|---|---|
| Input compreensível é o combustível principal | Krashen (1982) | Influente, pouco testável como teoria; sustentada indiretamente por estudos de cobertura lexical e leitura/escuta extensiva | Grande volume de input **no nível certo** (≥ 95–98% de palavras conhecidas) |
| Output força o aluno a perceber lacunas | Swain (1985, "output hypothesis") | `[LAB]` consistente, efeitos moderados | Tarefas de fala/escrita com propósito, não só exercícios de compreensão |
| Interação e negociação de sentido | Long (1996) | `[META]` interação → ganhos em vocabulário/gramática | Conversa com LLM com tarefa (role-play), não papo livre |
| Noticing | Schmidt (1990) | `[LAB]` | Realce de forma (input enhancement), comparar o que disse × forma-alvo |
| Quatro vertentes equilibradas | Nation (2007), Nation & Newton | `[PRÁTICA]` baseada em pesquisa | ~25% cada: input focado em sentido, output focado em sentido, estudo de forma, fluência |
| Feedback corretivo funciona | Lyster & Saito 2010 (*SSLA*, 15 estudos, N = 827); Li 2010 (*Language Learning*) | `[META]` prompts: efeito grande; recasts: médio; efeito mantido no pós-teste tardio; aprendizes mais jovens se beneficiam mais | Preferir **prompts** (elicitação) para a forma-alvo; recasts em tarefas de fluência |
| Sistemas de diálogo/chatbots ajudam | Bibauw et al. 2022 (*Language Learning & Technology*, 17 estudos, d = 0,58); Hou & Min (*ReCALL*, 16 estudos, 89 efeitos, g = 0,61 para fala) | `[META]` estudos pequenos, heterogêneos | Prática de fala com LLM é defensável, mas com tarefa e feedback estruturados |
| IA + professor em inglês | De Simone et al. (Banco Mundial 2025) | `[RCT]` +0,23 DP em inglês, 6 semanas | Sessões guiadas com prompts estruturados > chat livre |

### 8.2 Vocabulário: cobertura, SRS e o que NÃO fazer

- **Cobertura lexical**: Nation (2006, *Canadian Modern Language Review* 63(1)) — 98% de cobertura exige ~8–9 mil
  famílias de palavras para texto escrito e ~6–7 mil para fala. van Zeeland & Schmitt (2012, *Applied Linguistics*) — para
  escuta, ~95% de cobertura (≈ 2–3 mil famílias) já dá compreensão adequada para muitos ouvintes. → O grafo de Inglês
  precisa de uma espinha dorsal de **bandas de frequência** (1k, 2k, … 9k famílias) + listas especializadas (acadêmica,
  e técnica de eletrônica — ponte com o outro domínio: datasheets, application notes).
- **Espaçamento em L2**: Kim & Webb (2022, *Language Learning*; 98 efeitos, 48 experimentos, N = 3411) — efeito
  médio-grande do espaçamento; intervalos **mais longos** são melhores no pós-teste tardio; intervalos iguais ≈ expansivos.
  → FSRS com retenção-alvo ~0,85–0,90 é adequado; não precisa de esquema expansivo artesanal.
- **Não intercalar palavras parecidas**: Brunmair & Richter (2019) acharam efeito **negativo** de interleaving para
  palavras (g ≈ −0,39), e há o achado clássico de interferência ao ensinar juntas palavras do mesmo campo semântico
  (ex.: todas as cores, ou *affect/effect*) `[LAB, via literatura secundária]`. → O agendador **não** deve apresentar
  pela primeira vez, no mesmo nó, itens novos semanticamente/formalmente próximos; contrastá-los só depois que um deles
  estiver estável.
- **Cartões em contexto**: palavra/chunk dentro de uma frase, com áudio, colocações e 1 exemplo pessoal opcional
  (geração). Evitar só tradução L1 isolada (P5 já impõe).
- **Crédito implícito (FIRe receptivo)**: encontrar uma palavra em input e acertar o item de compreensão que depende dela
  dá crédito pequeno ao cartão (ex.: peso 0,1–0,3) — evita revisão explícita de palavras que o aluno está vendo
  naturalmente. `[INFERÊNCIA]` adaptação de MA.

**Algoritmo de compreensibilidade para vídeos/textos** (usado para linkar YouTube/livros ao nó certo):

```ts
// src/english/coverage.ts (proposta)
export interface CoverageReport { tokens: number; knownRatio: number; unknownTypes: string[]; band: 'extensive' | 'intensive' | 'too_hard' }

export function coverage(transcript: string, known: Set<string>, lemmatize: (w: string) => string,
                         isProperNoun: (w: string) => boolean): CoverageReport {
  const words = transcript.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  let k = 0; const unknown = new Map<string, number>();
  for (const w of words) {
    const l = lemmatize(w);
    if (known.has(l) || isProperNoun(w)) k++;
    else unknown.set(l, (unknown.get(l) ?? 0) + 1);
  }
  const ratio = words.length ? k / words.length : 0;
  const band = ratio >= 0.98 ? 'extensive' : ratio >= 0.95 ? 'intensive' : 'too_hard';
  const unknownTypes = [...unknown.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return { tokens: words.length, knownRatio: ratio, unknownTypes, band };
}
```

- `extensive` (≥ 98%): escuta/leitura de fluência, sem pausa.
- `intensive` (95–98%): pré-ensinar as 5–10 palavras desconhecidas mais frequentes do trecho (viram cartões), legenda
  opcional.
- `too_hard` (< 95%): não usar como input principal; só como "desafio" com transcrição e glossário.
- `known` vem do SRS + nós de vocabulário dominados + teste de nivelamento inicial (ex.: um teste de tamanho de
  vocabulário por bandas de frequência). Lematizador e listas de frequência: ver §11 (`wordfreq` tem dados CC-BY-SA 4.0).

### 8.3 Escuta, pronúncia e shadowing

- **HVPT (High Variability Phonetic Training)**: meta-análise de Uchihara, Karas & Thomson (2025, *SSLA*, 79 estudos) —
  treinar percepção de contrastes com muitas vozes/contextos melhora a percepção e, em menor grau, a produção. → Nós de
  fonologia para falantes de PT-BR (ex.: /ɪ/–/iː/, /æ/–/ɛ/, /θ/–/ð/, consoantes finais, redução vocálica/schwa, *-ed*
  final) como **itens de discriminação** curtos (ouvir 2 → escolher), com múltiplas vozes TTS/gravações.
- **Shadowing**: estudos individuais positivos para compreensão auditiva e prosódia (ex.: Hamada 2019, *RELC Journal*,
  DOI 10.1177/0033688218771380), mas **não encontrei meta-análise** de shadowing. → Usar como atividade de variação/fluência
  (1–3 min, primeiro com transcrição, depois sem), não como método central.
- Reconhecimento de fala para feedback de pronúncia deve ser agnóstico de provedor (STT do provedor de IA do usuário ou
  modelo local); limitar o feedback a 1–2 contrastes-alvo do nó (sotaque não é erro).

### 8.4 Tipos de nó para Inglês (adaptação do protocolo §6 às quatro vertentes)

| Tipo de nó | Fluxo (substitui F3–F7) | Duração |
|---|---|---|
| **Input** (meaning-focused input) | 1 pré-pergunta → trecho de áudio/vídeo/texto `intensive` → 3–5 itens de compreensão → 3–5 chunks destacados (noticing) → cartões | 15–20 min |
| **Forma** (language-focused) | gancho de contraste ("por que X e não Y?") → explicação curta com 2–3 pares contrastivos → exemplo resolvido (transformação) → 6–10 itens controlados (lacuna, transformação, ordenar, achar o erro) → 1 trecho autêntico onde a forma aparece | 12–20 min |
| **Output** (meaning-focused output) | tarefa (role-play/escrita curta) via P6 com feedback corretivo priorizado → relatório final ≤ 5 correções → **repetir a tarefa** uma vez (repetição de tarefa melhora fluência/precisão — `[LAB]` literatura de TBLT) | 15–25 min |
| **Fluência** | material `extensive` (≥ 98%), pressão de tempo leve: leitura repetida, 4/3/2 (falar o mesmo conteúdo em 4, 3 e 2 min; Nation) | 10–15 min |
| **Fonologia** | discriminação HVPT (10–20 itens rápidos) → 1 shadowing curto | 8–12 min |
| **Vocabulário** (banda de frequência) | lote de 8–15 itens novos *não similares entre si* em frases → recuperação imediata leve → SRS | 8–12 min |

Equilíbrio diário `[PRÁTICA, Nation]`: ao longo da semana, ~¼ do tempo em cada vertente; o agendador escolhe o
próximo nó de Inglês olhando o déficit de vertente.

### 8.5 CEFR e horas — mapeamento para o grafo

- **CEFR Companion Volume (Conselho da Europa, 2020)**: descritores "can do" por habilidade e nível (Pre-A1 → C2),
  incluindo mediação. → Cada descritor relevante vira um nó de **habilidade** (topo) que **engloba** nós de vocabulário,
  gramática e fonologia (pesos), o que dá ao FIRe o caminho para crédito implícito.
- **Horas guiadas (Cambridge English, orientação, não regra)**, cumulativas: A1 ≈ 90–100 h; A2 ≈ 180–200; B1 ≈ 350–400;
  B2 ≈ 500–600; C1 ≈ 700–800; C2 ≈ 1000–1200 h. O suporte da Cambridge também fala em ~200 h guiadas por nível e ressalta
  que é apenas uma diretriz. Para 1000–1500 h de estudo próprio (mais input extensivo fora do app), C1 é realista;
  C2 depende muito de input extensivo adicional.
- Camadas do grafo: (1) léxico por bandas + listas especializadas; (2) construções gramaticais; (3) fonologia contrastiva
  PT-BR → EN; (4) funções/habilidades CEFR; (5) pragmática/discurso (registro, hedging, e-mails técnicos); (6) inglês
  técnico de eletrônica (ponte entre domínios).
- Diagnóstico inicial: teste de tamanho de vocabulário por bandas + 1 tarefa de escrita + 1 de fala curta avaliadas com
  rubrica CEFR → marca nós como conhecidos (com "conditional completion" à la MA: concluir nós englobados quando um nó
  avançado é demonstrado).

---

## 9. Domínio Eletrônica — o que muda no protocolo

### 9.1 Concepções alternativas (misconceptions) que o tutor deve caçar

Base: McDermott & Shaffer (1992, *American Journal of Physics* 60(11)) e o teste DIRECT de Engelhardt & Beichner (2004,
*AJP* 72(1):98–115; 29 itens) — as concepções persistem **mesmo após instrução** tradicional. Lista inicial para o
`Misconception[]` do grafo:

| id | Concepção | Sinal diagnóstico (distrator/erro) |
|---|---|---|
| `current_consumed` | corrente "é gasta" ao passar pelos componentes | prevê menos corrente depois da 1ª lâmpada |
| `battery_constant_current` | bateria fornece corrente fixa | ignora que a corrente depende da carga |
| `sequential_reasoning` | mudança só afeta o que vem "depois" | prevê que mudar R2 não afeta antes dele |
| `local_reasoning` | analisa só o nó/componente próximo | erra em divisores com carga |
| `voltage_at_point` | tensão como propriedade de um ponto, não diferença | confunde potencial com queda |
| `parallel_adds_resistance` | mais resistores em paralelo → maior R | soma em vez de recíproco |
| `short_no_effect` | curto não muda o resto do circuito | prevê lâmpada acesa em curto |
| `cap_stores_charge_net` | capacitor carregado tem carga líquida | — |
| `diode_fixed_drop_always` | 0,7 V sempre, independente da corrente | erra em modelos exponenciais/temperatura |
| `amplifier_creates_energy` | amplificador "cria" energia | ignora a fonte de alimentação |
| `prefix_error` | erro de prefixo SI (k, m, µ) | resposta 10³ ou 10⁻³ do correto |

Diagnóstico automático por **regras com bug** (*buggy rules*, na linha de Brown & Burton/BUGGY e da Eedi): cada KP numérico
tem funções que computam a resposta **que cada misconception produziria**; se a resposta do aluno bate com uma delas (dentro
da tolerância), o feedback (P4) recebe `misconceptionId` sem precisar de diálogo diagnóstico.

```ts
// src/electronics/items.ts (proposta)
type Params = Record<string, number>;
export interface NumericTemplate {
  id: string; kpId: string;
  sample: () => Params;                          // valores E12/E24 realistas
  stem: (p: Params) => string;
  solve: (p: Params) => { value: number; unit: string };   // verdade (MNA próprio ou simulador)
  buggy: Array<{ misconceptionId: string; solve: (p: Params) => number }>;
  tolerance: { rel: number };                    // 0.01–0.02
}

export function classify(t: NumericTemplate, p: Params, answer: number) {
  const ok = (x: number, y: number) => Math.abs(x - y) <= t.tolerance.rel * Math.abs(y);
  const truth = t.solve(p).value;
  if (ok(answer, truth)) return { correct: true as const };
  if (ok(answer, truth * 1e3) || ok(answer, truth / 1e3)) return { correct: false as const, misconceptionId: 'prefix_error' };
  const hit = t.buggy.find(b => ok(answer, b.solve(p)));
  return { correct: false as const, misconceptionId: hit?.misconceptionId };
}

// Exemplo: dois resistores em paralelo
export const parallelR: NumericTemplate = {
  id: 'par2', kpId: 'kp_parallel_equivalent',
  sample: () => ({ r1: pickE12(1e2, 1e4), r2: pickE12(1e2, 1e4) }),
  stem: p => `R1 = ${fmt(p.r1)}Ω e R2 = ${fmt(p.r2)}Ω em paralelo. Qual a resistência equivalente?`,
  solve: p => ({ value: (p.r1 * p.r2) / (p.r1 + p.r2), unit: 'Ω' }),
  buggy: [{ misconceptionId: 'parallel_adds_resistance', solve: p => p.r1 + p.r2 }],
  tolerance: { rel: 0.02 },
};
declare function pickE12(min: number, max: number): number;
declare function fmt(x: number): string;
```

Parser de unidades: aceitar `4.7k`, `4,7 kΩ`, `4700`, `4k7` (notação RKM), `µ`/`u`; exigir unidade quando o item pede.

### 9.2 Simulação e laboratório virtual

- **Evidência**: Finkelstein et al. (2005, *Phys. Rev. ST Phys. Educ. Res.* 1, 010103) — alunos que usaram o
  simulador Circuit Construction Kit (PhET) superaram os que usaram equipamento real em questões conceituais **e** na
  montagem de circuitos reais. → Simulação não é "prêmio de consolação"; é ferramenta primária para conceitos de circuito.
- **circuitjs1** (Falstad; fork ativo `pfalstad/circuitjs1`, GPL-2.0-or-later, push em 2026-11-18; o antigo
  `sharpie7/circuitjs1` está parado desde 2024-01): roda no navegador, aceita circuito por URL/arquivo e tem **API JS**
  (precisa **mesma origem** → no Electron, empacotar o build localmente e servir pelo mesmo protocolo/origem do app).

```ts
// src/electronics/circuitjs-bridge.ts (proposta) — iframe same-origin com build próprio do circuitjs1
export function attachCircuit(iframe: HTMLIFrameElement, circuitText: string) {
  return new Promise<CircuitApi>(resolve => {
    (iframe.contentWindow as any).oncircuitjsloaded = () => {
      const sim = (iframe.contentWindow as any).CircuitJS1;
      sim.importCircuit(circuitText, false);
      resolve({
        voltage: (label: string) => sim.getNodeVoltage(label),          // nós rotulados no circuito
        elements: () => sim.getElements().map((e: any) => ({
          type: e.getType(), label: e.getLabelName?.(), v: e.getVoltageDiff(), i: e.getCurrent() })),
        setExt: (name: string, v: number) => sim.setExtVoltage(name, v), // exige elemento "External Voltage" nomeado
        run: (on: boolean) => sim.setSimRunning(on),
        time: () => sim.getTime(),
        export: () => sim.exportCircuit(),
        svg: () => sim.getCircuitAsSVG(),
        onUpdate: (cb: () => void) => { sim.onupdate = cb; },
      });
    };
    iframe.src = 'circuitjs/circuitjs.html?hideSidebar=true&hideMenu=true&running=true&whiteBackground=true';
  });
}
export interface CircuitApi { voltage(l: string): number; elements(): any[]; setExt(n: string, v: number): void;
  run(on: boolean): void; time(): number; export(): string; svg(): string; onUpdate(cb: () => void): void }
```

  Parâmetros úteis de URL: `cct`/`ctz` (circuito embutido/comprimido), `startCircuit`, `running`, `hideSidebar`,
  `hideMenu`, `editable`, `whiteBackground`, `conventionalCurrent`, `euroResistors`/`usResistors`, `IECGates`,
  `hideInfoBox`, `mouseWheelEdit`. Licença: GPL-2.0-or-later pode ser usada sob GPLv3, compatível com AGPL-3.0 do app;
  ao distribuir o build, incluir fonte/aviso de licença. As ferramentas do P7 (`getNodeVoltage`, `getElementCurrent`,
  `setParam`, `runFor`) são finas camadas sobre essa API.
- **PhET CCK** (HTML5, repositórios `phetsims/circuit-construction-kit-*`, ativos em 2026-10): bom para nós
  introdutórios muito visuais; **licença a verificar** antes de embutir (a API do GitHub não declara licença nos repos e
  não consegui confirmar a página de licenciamento nesta sessão).
- **Verdade numérica**: para DC/AC linear, um solver MNA próprio em TS (~200–300 linhas, determinístico, testável) é
  suficiente e evita dependência; para transitórios/não-linear, usar o próprio circuitjs (headless no iframe) ou ngspice
  (verificar licença/empacotamento); para derivações simbólicas offline (gerar soluções passo a passo), `lcapy` (Python,
  LGPL-2.1, ativo em 2026-08) — rodar só no pipeline de geração, nunca código de terceiros não verificado em runtime.

### 9.3 Protocolo POE (prever–observar–explicar) em Eletrônica

1. **Prever** (1 toque + "não sei"), sem nota/XP — o erro de previsão é valioso (hipercorreção, curiosidade).
2. **Observar** no simulador (o aluno faz a mudança; leituras reais exibidas; "multímetro virtual").
3. **Explicar**: se errou, o tutor nomeia a concepção e aponta as leituras que a refutam (≤ 80 palavras); pedir a
   explicação ao aluno **só** se ainda há orçamento de perguntas.
4. **Transferir**: 1 item numérico/conceitual novo com o mesmo princípio.
Frequência `[INFERÊNCIA]`: POE em ~1 de cada 2–3 nós conceituais de circuitos (não em todo nó, para não virar ritual).

### 9.4 Progressão até nível de pós-graduação e redução de andaime

| Faixa | Conteúdo (exemplos de regiões do grafo) | Formato dominante |
|---|---|---|
| Fundamentos matemáticos | álgebra, trigonometria, números complexos, cálculo, EDOs, álgebra linear, Laplace/Fourier, probabilidade | worked example + fading + muita prática (estilo MA) |
| Circuitos DC/AC | leis de Kirchhoff, Thévenin/Norton, fasores, filtros, ressonância | worked example + POE + numéricos com buggy rules |
| Dispositivos e analógica | diodos, BJT/MOSFET, op-amps, realimentação, estabilidade | problemas primeiro com dicas (expertise crescente), simulação de projeto |
| Digital e sistemas embarcados | lógica, máquinas de estado, microcontroladores, ADC/DAC | mini-projetos, achar o erro, simulação |
| Sinais, controle, potência, RF/EM, mixed-signal | | problemas abertos com especificação + verificação em simulador |
| Pesquisa (nível PhD) | leitura de artigos, replicar uma figura em simulação, propor variação | nós de "leitura guiada" (pré-perguntas, explicar com as próprias palavras, replicar) |

Regra de andaime `[META: expertise reversal; PF]`: quanto mais pré-requisitos dominados na região (e maior a velocidade
do aluno), menos exemplos resolvidos e mais **problema primeiro** (productive failure só quando há conhecimento prévio
suficiente para gerar soluções parciais). O planner (P2) recebe `expertiseInRegion ∈ [0,1]` e escolhe: `< 0,4` →
worked-first; `0,4–0,7` → faded/hint-first; `> 0,7` → problem-first/design. Marcos opcionais com kit físico
(protoboard, multímetro) ao fim de regiões — Finkelstein mostra transferência de simulação para montagem real.

---

## 10. Implicações para memória e modelo do aluno

Lição central (Eedi 2026): **contexto personalizado colado no prompt não melhorou nada**. A memória vale quando muda
**decisões** do orquestrador. O que guardar e para que serve:

| Dado | Granularidade | Decisão que ele dirige |
|---|---|---|
| Estado de domínio + `repNum`, `memory`, último contato | nó | agendamento FIRe, revisões comprimidas, aquecimento (F2) |
| Velocidade aluno-tópico (`speed`) | nó/região | nº de KPs por nó, dificuldade inicial, peso do crédito implícito, estimativa de minutos/XP |
| Tentativas, dicas usadas, itens assistidos | KP | regra de passagem, remediação, qualidade do crédito |
| Misconceptions (id, evidências, confiança no erro, última vez, resolvida?) | aluno × misconception | distratores do próximo item, feedback P4, cartões de erro, gancho de contraste; "resolvida" após 2 acertos de transferência em ≥ 2 sessões |
| Proposições já demonstradas | proposição | **não perguntar de novo** (métrica A4 do juiz) e não gerar cartão redundante |
| Calibração (confiança × acerto, Brier) | domínio | super-confiante → mais recuperação e feedback elaborado; sub-confiante → mostrar evidência de progresso |
| Perfil de fadiga (latência por hora do dia, minutos até queda de acerto) | aluno | tamanho dos blocos, horário sugerido, quando oferecer pausa |
| Histórico de formatos e ganchos | nó (últimos N) | regra de rotação (§6.6) |
| Preferências declaradas (analogias de interesse, densidade) | aluno | só ajustes leves no texto — efeito esperado pequeno |

Snapshot para o prompt (≤ ~150 tokens): nível, pré-requisitos relevantes dominados, 1–3 misconceptions ativas
relevantes ao nó, estado de fadiga, orçamento de perguntas restante. **Nada** de histórico de chat inteiro.

```ts
// src/learner/model.ts (proposta)
export interface NodeState { nodeId: string; status: 'unseen' | 'learning' | 'mastered' | 'review_due' | 'deferred';
  repNum: number; memory: number; speed: number; lastSeen?: string; failures: number }
export interface MisconceptionRecord { id: string; nodeIds: string[]; hits: number; highConfidenceHits: number;
  lastSeen: string; resolved: boolean }
export interface LearnerModel {
  nodes: Record<string, NodeState>;
  misconceptions: Record<string, MisconceptionRecord>;
  demonstrated: Set<string>;                 // proposition ids
  calibration: Record<string, { brier: number; n: number }>; // por domínio
  fatigue: { baselineLatencyMs: Record<string, number>; bestHours: number[]; minutesToDrop: number };
  formatHistory: Array<{ nodeId: string; hook: string; variation?: string }>;
}
```

XP `[PRÁTICA MA]`: 1 XP ≈ 1 minuto de trabalho focado *esperado* (não tempo de relógio), calculado por nó a partir da
estimativa de minutos (calibrável por Monte Carlo sobre a distribuição de `speed`); bônus por desempenho alto, redução por
chute/abandono. Como é um único usuário, **ligas não fazem sentido** — usar recordes pessoais e metas semanais (SDT:
competência e autonomia) e evitar recompensas que substituam o interesse (efeito de sobrejustificação).

---

## 11. Recursos reutilizáveis (com licença)

| O quê | Onde | Licença | Como usar |
|---|---|---|---|
| Regras de cadência de instrutor ("Socratic sparingly", "one idea per turn", "short turns 1–3 sentences", quando NÃO perguntar) | `_refs/OpenMAIC/lib/pbl/v2/prompts/instructor-base-rules.md` | MIT | Inspirar P1/P4 e o validador de cadência (reformular, manter aviso de licença se copiar trechos) |
| Limite de rodadas socráticas (máx. 2, 1–2 perguntas cada) | `_refs/BloomTutor/skills/bloom-tutor/SKILL.md` | MIT | `TurnBudget.maxSocraticRounds` |
| Agendador/presets de revisão (`preset-daily-long-term`, `preset-exam-cramming`, `preset-language`, `preset-science`) e loop de maestria | `_refs/DeepTutor/deeptutor/learning/{scheduler.py,review_strategy.py,policy.py}`, `deeptutor/capabilities/mastery/prompts/en/mastery_loop.yaml` | Apache-2.0 | Ideias de presets por domínio (Inglês vs Eletrônica); portar lógica para TS, não executar |
| Formato de grafo com `encompasses` e pesos | `_refs/open-mastery/docs/GRAPH_FORMAT.md` | Motor MIT; dados do grafo CC-BY-SA 4.0 | Esquema de arestas de englobamento do nosso grafo (§4.7) |
| Simulador de circuitos com API JS | github.com/pfalstad/circuitjs1 (ativo); falstad.com/circuit | GPL-2.0-or-later | Laboratório virtual/POE (§9.2); build próprio, mesma origem |
| FSRS em TypeScript | github.com/open-spaced-repetition/ts-fsrs (879★, push 2026-11-17) | MIT | Agendador de cartões (já previsto em `docs/flashcards-vision.md`) |
| Frequências de palavras | github.com/rspeer/wordfreq (último push 2025-01) | Código Apache-2.0; dados CC-BY-SA 4.0 | Bandas de frequência e `known`/cobertura (§8.2) — exportar listas offline; atribuição |
| Análise simbólica de circuitos | github.com/mph-/lcapy (push 2026-08) | LGPL-2.1 | Só no pipeline offline de geração/verificação de soluções |
| Prompt do tutor de Harvard | Material suplementar de Kestin et al. 2025 (*Sci Rep*, acesso aberto) | Artigo CC-BY 4.0 | Padrões "BRIEF", "ONE STEP AT A TIME", soluções no prompt |
| Rubrica pedagógica conversacional | LearnLM, arXiv 2407.12687, Tabela 10 | Artigo arXiv (citar) | Critérios do juiz P8 |
| MathTutorBench | github.com/eth-lre/mathtutorbench; EMNLP 2025 (arXiv 2502.18940) | Licença não declarada na API do GitHub — verificar | Avaliar prompts de tutor em diálogos simulados |
| MRBench / taxonomia de avaliação de tutores | github.com/kaushal0494/UnifyingAITutorEvaluation; aclanthology.org/2025.naacl-long.57 | Licença não declarada — verificar | 8 dimensões de feedback no juiz P8 |
| TutorBench | arXiv 2510.02663 | ver repositório/dados | Benchmark de explicação adaptativa/feedback/dicas |
| *The Math Academy Way* | justinmath.com/files/the-math-academy-way.pdf | Direitos do autor (leitura) | Fonte de desenho (FIRe, compressão, regras de lição); nada de copiar texto |
| PhET Circuit Construction Kit | github.com/phetsims/circuit-construction-kit-dc (e `-common`) | **Verificar** (não declarada na API) | Alternativa visual para nós introdutórios |
| Plano de flashcards nativo | `docs/flashcards-vision.md` (learnharness) | AGPL-3.0 (do app) | Integrar F9 (proposição → cue → card, FSRS) |

---

## 12. Perguntas em aberto e riscos

1. **Transferência da evidência**: quase todos os RCTs são K-12 ou graduação, com currículos curtos. Não há RCT de tutor de
   IA para **adulto autodidata ao longo de 1000+ h**. Os números de §6.4 são inferências de desenho, não constantes.
2. **n = 1**: com um único usuário não há A/B entre pessoas. Usar alternância intra-sujeito (ABAB entre nós comparáveis:
   ex. cadência "orçada" vs "socrática") medindo `delayedRetention`, `skipRequests` e duração, por semanas.
3. **Qualidade do grafo gerado por LLM** (pré-requisitos e pesos de englobamento errados quebram o FIRe e a remediação):
   precisa de validação (checagem de ciclos, juiz, amostragem manual, ajuste por dados de desempenho).
4. **Itens de Inglês com respostas abertas**: correção por LLM pode dar falso negativo e frustrar; aceitar variantes,
   mostrar "por que aceitei/recusei", permitir contestação de 1 toque.
5. **Latência**: na Eedi a espera mediana por resposta foi 16–24 s — inaceitável para o ritmo proposto. Pré-gerar plano e
   itens; streaming; feedback de item por regra (buggy rules) sem LLM quando possível.
6. **Custo por assinatura**: chamadas por fase multiplicam requisições; usar modelo menor/configurável para P4 e
   validação, cache de planos, e geração em lote fora da sessão. Nenhum modelo fixo no código.
7. **Limiares de fadiga** (§6.8) não validados; começar conservador e oferecer, nunca impor.
8. **Escolha PF vs exemplo resolvido** em regiões avançadas é regra de bolso (`expertiseInRegion`); calibrar.
9. **Direitos autorais**: livros e vídeos só por referência (capítulo/seção, timestamps), sem reproduzir texto; o tutor
   pode parafrasear e citar curto.
10. **Licenças**: GPL do circuitjs1 ao distribuir o build; PhET, MathTutorBench e MRBench sem licença declarada na API
    do GitHub — verificar antes de reutilizar código/dados. Nesta sessão o orçamento de buscas web acabou antes de
    confirmar a licença do PhET.
11. **Preferência do usuário**: alguns aprendizes gostam de mais diálogo socrático. Expor 2–3 presets de cadência
    ("direto", "equilibrado", "socrático") dentro dos limites duros (≤ 1 pergunta/mensagem sempre).
12. **Cifras de fonte secundária** (marcadas em §3) devem ser reconferidas antes de virar texto voltado ao usuário.

---

## 13. Referências

### Tutoria com LLM e avaliação

- Kestin, G. et al. (2025). AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based
  design in an authentic educational setting. *Scientific Reports* 15:17458. https://www.nature.com/articles/s41598-025-97652-6
  (suplemento com o prompt: https://static-content.springer.com/esm/art%3A10.1038%2Fs41598-025-97652-6/MediaObjects/41598_2025_97652_MOESM1_ESM.docx)
- Bastani, H. et al. (2025). Generative AI without guardrails can harm learning. *PNAS* 122(26) e2422633122.
  https://doi.org/10.1073/pnas.2422633122
- LearnLM Team (2024). Towards Responsible Development of Generative AI for Education: An Evaluation-Driven Approach.
  https://arxiv.org/abs/2407.12687 ; LearnLM: Improving Gemini for Learning. https://arxiv.org/abs/2412.16429
- LearnLM Team / Eedi (2025). AI tutoring can safely and effectively support students (RCT exploratório).
  https://arxiv.org/abs/2512.23633
- Google & Eedi (29/10/2026). Measuring the impact of AI tutoring, from near transfer to standardised tests.
  https://services.google.com/fh/files/misc/learnlm_oct26.pdf
- Wang, R. E., Ribeiro, A. T., Robinson, C. D., Loeb, S., Demszky, D. Tutor CoPilot. https://arxiv.org/abs/2410.03017
- De Simone, M. et al. (2025). From chalkboards to chatbots (Nigéria). World Bank Policy Research Working Paper 11125.
- Oreopoulos & Low (2026). One Click Away (Khanmigo). EdWorkingPaper 26-1551. https://edworkingpapers.com
- Liu et al. (2026). EdWorkingPaper 26-1598 (tutor de IA integrado ao curso, UMD). https://edworkingpapers.com
- Lehmann, M., Cornelius, P. B., Sting, F. J. AI meets the classroom. https://arxiv.org/abs/2409.09047
- Fan, Y. et al. (2025). Beware of metacognitive laziness. *British Journal of Educational Technology* 56(2).
- Contractor & Reyes (2026). https://arxiv.org/abs/2607.08849
- Kobler et al. (ACL 2026). https://arxiv.org/abs/2604.23486
- Macina, J. et al. (EMNLP 2025). MathTutorBench. https://arxiv.org/abs/2502.18940 ; https://github.com/eth-lre/mathtutorbench
- Maurya, K. K. et al. (NAACL 2025). Unifying AI Tutor Evaluation. https://aclanthology.org/2025.naacl-long.57/
- TutorBench (Scale AI). https://arxiv.org/abs/2510.02663
- Lane & Kageler (AIED 2026 workshop). CSTutorBench. https://arxiv.org/abs/2607.05571
- Kosmyna, N. et al. (2025). Your Brain on ChatGPT (preprint, n = 54). https://arxiv.org/abs/2506.08872
- VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring
  systems. *Educational Psychologist* 46(4):197–221. https://doi.org/10.1080/00461520.2011.611369
- Kraft, M. A. (2020). Interpreting effect sizes of education interventions. *Educational Researcher* 49(4).
  https://doi.org/10.3102/0013189X20912798

### Ciência da aprendizagem

- Bloom, B. S. (1984). The 2 Sigma Problem. *Educational Researcher* 13(6):4–16.
- Chi, M. T. H. & Wylie, R. (2014). The ICAP framework. *Educational Psychologist* 49(4):219–243.
  https://doi.org/10.1080/00461520.2014.965823
- Dunlosky, J. et al. (2013). Improving students' learning with effective learning techniques. *PSPI* 14(1).
  https://doi.org/10.1177/1529100612453266
- Adesope, O. O. et al. (2017). Rethinking the use of tests: a meta-analysis of practice testing. *RER* 87(3).
  https://doi.org/10.3102/0034654316689306
- Cepeda, N. J. et al. (2008). Spacing effects in learning: a temporal ridgeline of optimal retention. *Psychological
  Science* 19(11). https://doi.org/10.1111/j.1467-9280.2008.02209.x
- Brunmair, M. & Richter, T. (2019). Similarity matters: a meta-analysis of interleaved learning. *Psychological
  Bulletin* 145(11). https://doi.org/10.1037/bul0000209
- Wilson, R. C. et al. (2019). The Eighty Five Percent Rule for optimal learning. *Nature Communications* 10:4646.
  https://doi.org/10.1038/s41467-019-12552-4
- Sweller, J., van Merriënboer, J., Paas, F. (2019). Cognitive architecture and instructional design: 20 years later.
  *Educational Psychology Review* 31.
- Sinha, T. & Kapur, M. (2021). When problem solving followed by instruction works. *RER* 91(5).
  https://doi.org/10.3102/00346543211019105
- Bisra, K. et al. (2018). Inducing self-explanation: a meta-analysis. *Educational Psychology Review* 30.
- Mayer, R. E. (2021). *Multimedia Learning* (3ª ed.). Cambridge University Press.
- Lepper, M. R., Woolverton, M. et al. — INSPIRE (estudos de tutores especialistas).
- Ryan, R. M. & Deci, E. L. (2000). Self-determination theory. *American Psychologist* 55(1).
- Carpenter, S. K. & Toftness, A. R. (2017). The effect of prequestions on learning from video presentations.
  *Journal of Applied Research in Memory and Cognition* 6(1).
- Wilson, K. & Korn, J. H. (2007). Attention during lectures: beyond ten minutes. *Teaching of Psychology* 34(2).
- Anthropic (2025). Education Report: How university students use Claude.
  https://www.anthropic.com/news/anthropic-education-report-how-university-students-use-claude

### Math Academy

- Skycak, J. *The Math Academy Way* (rascunho 13/08/2026). https://www.justinmath.com/files/the-math-academy-way.pdf
- Skycak, J. Individualized Spaced Repetition in Hierarchical Knowledge Structures (FIRe).
  https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/
- Math Academy. How our AI works: https://mathacademy.com/how-our-ai-works ; Pedagogy: https://mathacademy.com/pedagogy

### Inglês (SLA)

- Krashen, S. (1982). *Principles and Practice in Second Language Acquisition*. Pergamon.
- Swain, M. (1985). Communicative competence: some roles of comprehensible input and comprehensible output.
- Long, M. (1996). The role of the linguistic environment in second language acquisition.
- Schmidt, R. (1990). The role of consciousness in second language learning. *Applied Linguistics* 11(2).
- Nation, I. S. P. (2006). How large a vocabulary is needed for reading and listening? *Canadian Modern Language
  Review* 63(1). https://doi.org/10.3138/cmlr.63.1.59
- Nation, I. S. P. (2007). The four strands. *Innovation in Language Learning and Teaching* 1(1).
- van Zeeland, H. & Schmitt, N. (2012). Lexical coverage in L1 and L2 listening comprehension. *Applied Linguistics*.
- Kim, S. K. & Webb, S. (2022). The effects of spaced practice on second language learning: a meta-analysis.
  *Language Learning*.
- Lyster, R. & Saito, K. (2010). Oral feedback in classroom SLA: a meta-analysis. *SSLA* 32(2).
- Li, S. (2010). The effectiveness of corrective feedback in SLA: a meta-analysis. *Language Learning* 60(2).
- Bibauw, S., Van den Noortgate, W., François, T., Desmet, P. (2022). Dialogue systems for language learning: a
  meta-analysis. *Language Learning & Technology* 26(1).
- Hou & Min — meta-análise de chatbots e fala em L2. *ReCALL* (Cambridge University Press).
- Uchihara, T., Karas, M., Thomson, R. I. (2025). Meta-análise de HVPT. *Studies in Second Language Acquisition*.
- Hamada, Y. (2019). Estudo sobre shadowing e compreensão auditiva. *RELC Journal*. https://doi.org/10.1177/0033688218771380
- Council of Europe (2020). CEFR Companion Volume. https://www.coe.int/en/web/common-european-framework-reference-languages
- Cambridge English Support — Guided learning hours (orientação). https://support.cambridgeenglish.org

### Eletrônica / ensino de física

- McDermott, L. C. & Shaffer, P. S. (1992). Research as a guide for curriculum development: an example from introductory
  electricity. Part I. *American Journal of Physics* 60(11).
- Engelhardt, P. V. & Beichner, R. J. (2004). Students' understanding of direct current resistive electrical circuits.
  *American Journal of Physics* 72(1):98–115. https://doi.org/10.1119/1.1614813
- Finkelstein, N. D. et al. (2005). When learning about the real world is better done virtually. *Phys. Rev. ST Phys.
  Educ. Res.* 1, 010103. https://doi.org/10.1103/PhysRevSTPER.1.010103
- circuitjs1: https://github.com/pfalstad/circuitjs1 ; https://www.falstad.com/circuit/
- PhET CCK: https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc

### Repositórios de referência locais (somente leitura)

- `_refs/OpenMAIC` (MIT), `_refs/BloomTutor` (MIT), `_refs/DeepTutor` (Apache-2.0), `_refs/open-mastery` (MIT + CC-BY-SA 4.0).
