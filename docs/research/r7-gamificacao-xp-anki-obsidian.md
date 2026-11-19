# R7: gamificação que ajuda a aprender (XP, níveis, tiers, streaks) + flashcards com Anki/Obsidian

> Relatório de pesquisa de 2026-11-18 para o fork do learnharness em `C:\Users\nicoolas\Pictures\learnharness`.
> Escopo: **(A)** evidência sobre gamificação em educação e o projeto de um sistema de XP, níveis e tiers calibrado por Monte Carlo; **(B)** integração de flashcards com Anki e Obsidian.
> Método: li as fontes primárias (abstracts e PDFs open access via DOI, READMEs e código no GitHub, `proto`/`rs` do Anki, schema da API v1 do AnkiConnect, docs dos plugins Obsidian e estatísticas oficiais de downloads). Também rodei uma **simulação Monte Carlo própria** em Node (código no Apêndice A).
> Limitação: o orçamento de WebSearch da sessão acabou logo no início. Por isso tudo foi verificado por URLs/DOIs conhecidos, `gh api`, registries (npm) e APIs bibliográficas por DOI (OpenAlex/Semantic Scholar). Itens que não consegui verificar estão marcados como **(não verificado)**.
> Nada de `_refs/` foi executado. Só li `_refs/extra/repeat-space__anki-apkg-export` e `_refs/extra/open-spaced-repetition__ts-fsrs`.

---

## 0. TL;DR: decisões recomendadas

1. **Gamificação funciona, com efeito pequeno a médio e frágil.** As estimativas meta-analíticas para desempenho cognitivo ficam em g ≈ 0,49–0,78 (Sailer & Homner 2020; Bai et al. 2020; Zeng et al. 2024). Para motivação intrínseca, o efeito é **pequeno** (g = 0,26; Li, Ma & Shi 2024) e quase não melhora a percepção de **competência**. Nenhum estudo das meta-análises cobre mais de 6 meses, e o nosso horizonte é de mais de 1 ano. **Consequência:** a progressão de longo prazo tem de vir da **maestria real** (o grafo e o learner model). XP e enfeites servem de feedback informativo, não de pagamento.
2. **Separar "esforço" de "maestria".** São quatro camadas:
   - **XP**: esforço produtivo verificado, com âncora de **1 XP ≈ 1 min focado**, como no Math Academy.
   - **Nível**: curva polinomial sobre o XP.
   - **Badges de região**: maestria local, derivada do learner model.
   - **Tier do domínio** (Bronze → Prata → Ouro → Platina → Diamante → Mestre → Doutor): **maestria retida** dos núcleos canônicos de cada estágio do grafo.

   O XP nunca diminui. O tier mostra o pico alcançado e tem um indicador separado de "forma" (retenção atual), sem rebaixamento.
3. **XP compatível com o nível atual:** XP = tempo efetivo × multiplicador de dificuldade relativa, derivado do **expected score do Elo**, $E = 1/(1+10^{(b-\theta)/400})$, com $M = \mathrm{clamp}((1-E)/(1-0{,}8),\ 0{,}3,\ 1{,}5)$. Nas revisões espaçadas, o multiplicador vem da **retrievability do FSRS**: $g(R)=\mathrm{clamp}((1-R)/(1-DR),\ 0{,}1,\ 1{,}5)$. Revisar cedo demais ou estudar conteúdo muito abaixo do nível rende pouco. O XP **nunca** depende da autoavaliação Again/Hard/Good/Easy, porque isso criaria incentivo para mentir e corromperia o FSRS.
4. **Curva de nível polinomial** $XP_{total}(L)=20{,}1\cdot L^{1{,}696}$. A curva foi ajustada por Monte Carlo para que o aluno de referência (3 h/dia) chegue a L10 na 1ª semana e a L100 em 1 ano. Uma curva exponencial (estilo RuneScape) faria os níveis finais levarem meses. Nesta curva, subir de nível custa 45 XP em L1, 175 em L10, 522 em L50 e 843 em L100.
5. **Tiers calibrados por Monte Carlo** (1.110 nós no núcleo, 7 estágios, FSRS-6, DR 0,9; resultados na §5). Mediana para chegar a **Doutor**:
   - 4 h/dia: **12,6 meses** (p10–p90: 9,9–17,0);
   - 3 h/dia: **18,2 meses**;
   - 2 h/dia: **27,1 meses**.

   Isso equivale a **~1.260–1.350 h** de estudo efetivo e cumpre a meta de "+1 ano a 2–4 h/dia, ~1.000–1.500 h". Com as regras propostas, *farmers* rendem **30–40% menos XP/h** que o aluno honesto. Com a regra ingênua (+50 XP por aula, +10 por revisão), eles ganhariam **+33% a +48%** a mais.
6. **Streak saudável:**
   - meta **semanal** (ex.: 5 de 7 dias), e não diária;
   - "dia válido" = 10 min ou fila de revisões zerada;
   - até 2 *freezes* acumuláveis, ganhos por consistência e nunca comprados;
   - reparo em 48 h;
   - nada de mensagens de culpa.

   A evidência para cada ponto: separar o streak da meta diária deu +3,3% de retenção D14 no Duolingo; *freezes* deram +0,38% de DAU; e Silverman & Barasch 2023 mostram que quebrar o streak derruba o engajamento, e que **poder reparar** atenua esse efeito.
7. **Ligas e rankings sociais ficam desligados por padrão.** Se ligados, são contra o **próprio histórico** ou contra uma **coorte simulada rotulada como tal**. Rankings sociais prejudicam quem está embaixo (Christy & Fox 2014; Hanus & Fox 2015). O MC também gera percentis honestos, do tipo "seu ritmo está no p70 dos alunos simulados de 3 h/dia".
8. **Flashcards: o FSRS interno do app é a fonte da verdade.** O plugin `plugins/flashcards` já tem FSRS-6 por proposição, com log de revisões *append-only*.
   - **Obsidian** é espelho legível e unidirecional: nota de sessão com os cartões em sintaxe compatível com o plugin *Spaced Repetition*, sem gravar comentários `<!--SR:…-->`.
   - **Anki** é cliente de revisão opcional: conteúdo vai por *push* idempotente via **AnkiConnect** e as revisões voltam por *pull*. O estado FSRS é recalculado por **replay** do log mesclado (`Reschedule.replay` do `ts-fsrs` 6).
   - O fallback offline é `.apkg` via **`anki-apkg-export` v5** (MIT, revivido em 2026-10, testado contra Anki 26.09.3) ou TSV com cabeçalhos `#…`.
9. **Estado atual verificado (2026-11-18):**
   - **AnkiConnect 26.11.15.0** traz uma nova **API v1 JSON-RPC 2.0** em `POST http://127.0.0.1:8765/api/v1`, com 96 métodos, batches atômicos, operações assíncronas e `Authorization: Bearer`. A API "version 6" continua em `/` como *legacy*.
   - O repositório migrou do GitHub (arquivado) para `git.sr.ht/~foosoft/anki-connect`.
   - **Anki 26.09** removeu os módulos Python legados `anki.importing`/`anki.exporting`.
   - O plugin Obsidian **Spaced Repetition** ganhou **FSRS** na v1.14.2 (2026-05), apesar de a documentação ainda dizer "planned".
   - O **Obsidian_to_Anki** está parado desde 2024 e não aparece mais no `community-plugins.json`.
10. **Qual é mais *high-tech*/robusto?** Para **revisar**, o ecossistema Anki: FSRS-6 nativo com otimizador e simulador, apps móveis, AnkiWeb e a API v1. Para **ler e conectar conhecimento**, o Obsidian (Markdown, wikilinks, Canvas). Recomendo **ambos**, com o app como fonte da verdade.

---

## 1. Evidência sobre gamificação (A)

### 1.1 Meta-análises principais

| Estudo | Amostra | Resultado principal | Observações úteis para nós |
|---|---|---|---|
| **Sailer & Homner (2020)**, *Educational Psychology Review* 32:77–112, DOI [10.1007/s10648-019-09498-w](https://doi.org/10.1007/s10648-019-09498-w) (OA) | cognitivo k=19 (N=1.686); motivacional k=16 (N=2.246); comportamental k=9 (N=951) | **Cognitivo g=0,49** [0,30; 0,69]; **motivacional g=0,36** [0,18; 0,54]; **comportamental g=0,25** [0,04; 0,46] | O efeito cognitivo se manteve no subconjunto metodologicamente rigoroso; os motivacional e comportamental, não. Moderadores: *game fiction* e interação social moderam o comportamental. Competição + colaboração teve g=0,63 [0,06; 1,20] (k=5, cognitivo); competição pura, g=0,50 (k=9). **Não houve estudos com mais de meio ano**: o moderador "duração" não pôde ser estimado para essa faixa (Tabela 2 do PDF). Os efeitos cognitivos não variaram com a duração (Q(2)=0,17, p=0,92). |
| **Bai, Hew & Huang (2020)**, *Educational Research Review* 30:100322, DOI [10.1016/j.edurev.2020.100322](https://doi.org/10.1016/j.edurev.2020.100322) | 30 intervenções, 24 estudos, 3.202 participantes | Desempenho acadêmico **g=0,504** [0,284; 0,723] | Inclui síntese qualitativa: o debate "exploitationware" é citado como motivação do estudo. |
| **Zeng et al. (2024)**, *BJET* 55, DOI [10.1111/bjet.13471](https://doi.org/10.1111/bjet.13471) | 22 estudos experimentais, 2008–2023 | Desempenho acadêmico **g=0,782** | Efeito positivo em todos os moderadores (região, nível, ambiente, disciplina e elemento de jogo). Os autores pedem mais estudos sobre *feedback* como elemento. |
| **Li, Ma & Shi (2024)**, *ETR&D*, DOI [10.1007/s11423-023-10337-7](https://doi.org/10.1007/s11423-023-10337-7) (OA) | 35 intervenções, ~2.500 participantes, 2011–2022 | **Motivação intrínseca g=0,257** [0,043; 0,471]; autonomia g=0,638; relacionamento g=1,776; **competência g=0,277** [0,001; 0,553] | A revisão sistemática (31 estudos) aponta a **falta de competência percebida e de autonomia** como as barreiras da gamificação para a motivação intrínseca. |
| Huang et al. (2020), *ETR&D*, DOI [10.1007/s11423-020-09807-z](https://doi.org/10.1007/s11423-020-09807-z) | (não verificado) | g ≈ 0,46 **(não verificado)** | Mapeia quais elementos de design foram usados e em que circunstâncias funcionam. |
| **Hamari, Koivisto & Sarsa (2014)**, HICSS, DOI [10.1109/HICSS.2014.377](https://doi.org/10.1109/HICSS.2014.377) | revisão | Efeitos em geral positivos, mas dependentes do contexto e do usuário, com indícios de **efeito novidade** | Base histórica do argumento "o efeito decai". |
| **Dichev & Dicheva (2017)**, *IJETHE* 14:9, DOI [10.1186/s41239-017-0042-5](https://doi.org/10.1186/s41239-017-0042-5) (OA) | revisão crítica | **Evidência insuficiente de benefícios de longo prazo**; a prática superou a compreensão dos mecanismos | Também é a nossa situação: não temos dados de mais de 1 ano. |

**Leitura crítica.**
- O efeito cognitivo é real, mas a heterogeneidade é alta (I² de 70–85% em vários subgrupos de Sailer & Homner).
- O g=0,78 de Zeng 2024 vem de só 22 estudos e provavelmente sofre de viés de publicação e de comparações contra "aula expositiva".
- O que mais importa para nós: **não há evidência para horizontes acima de 6 meses**. Isso empurra o design para mecanismos que continuam fazendo sentido no mês 14: progresso em maestria real e feedback de competência. Pontos, que perdem graça com o tempo, ficam em segundo plano.

### 1.2 Efeitos por elemento e o mecanismo psicológico (SDT)

- **Sailer, Hense, Mayr & Mandl (2017)**, *Computers in Human Behavior* 69:371–380, DOI [10.1016/j.chb.2016.12.033](https://doi.org/10.1016/j.chb.2016.12.033), RCT em simulação:
  - **badges, leaderboards e gráficos de desempenho** aumentam a satisfação da necessidade de **competência** e o **significado percebido da tarefa**;
  - **avatares, história e colegas de equipe** aumentam o **relacionamento**;
  - a **autonomia** (liberdade de decisão) **não** foi afetada.

  Para nós: gráficos de desempenho e badges de maestria valem mais que pontos crus. A autonomia precisa vir de escolhas reais de caminho no grafo, não de enfeites.
- **Mekler, Brühlmann, Tuch & Opwis (2017)**, *CHB* 71:525–534, DOI [10.1016/j.chb.2015.08.048](https://doi.org/10.1016/j.chb.2015.08.048): pontos, níveis e leaderboards funcionaram como **incentivos extrínsecos que aumentam só a quantidade** de desempenho, sem melhorar a qualidade nem a motivação intrínseca. Para nós: XP precisa recompensar trabalho **verificado** (check de aula, revisão no tempo certo), e não volume.
- **Landers, Bauer & Callan (2017)**, *CHB* 71:508–515, DOI [10.1016/j.chb.2015.08.008](https://doi.org/10.1016/j.chb.2015.08.008): leaderboards funcionam como **definição de metas** (goal-setting theory). Para nós: metas pessoais semanais dão o mesmo efeito, sem comparação social.
- **Christy & Fox (2014)**, *Computers & Education* 78:66–77, DOI [10.1016/j.compedu.2014.05.005](https://doi.org/10.1016/j.compedu.2014.05.005): um leaderboard dominado por homens prejudicou o desempenho de mulheres em matemática (ameaça do estereótipo e comparação social). Para nós: comparação social tem custos assimétricos.
- **Hanus & Fox (2015)**, *Computers & Education* 80:152–161, DOI [10.1016/j.compedu.2014.08.019](https://doi.org/10.1016/j.compedu.2014.08.019), estudo longitudinal de um semestre: o curso com **badges + leaderboard + moedas** gerou **menos** motivação intrínseca, satisfação e *empowerment* ao longo do tempo, e notas finais menores. É o contraexemplo clássico.
- **Toda, Valle & Isotani (2018)**, "The Dark Side of Gamification", CCIS 832, DOI [10.1007/978-3-319-97934-2_9](https://doi.org/10.1007/978-3-319-97934-2_9): cataloga quatro efeitos negativos recorrentes: perda de desempenho, comportamento indesejado (trapaça/*gaming the system*), indiferença e declínio do efeito.

### 1.3 Overjustification: quando recompensa atrapalha

**Deci, Koestner & Ryan (1999)**, *Psychological Bulletin* 125(6):627–668, DOI [10.1037/0033-2909.125.6.627](https://doi.org/10.1037/0033-2909.125.6.627), meta-análise de 128 experimentos.

Recompensas que **minaram** a motivação intrínseca (medida por escolha livre):

| Tipo de recompensa | d |
|---|---|
| contingente ao engajamento | −0,40 |
| contingente à conclusão | −0,36 |
| contingente ao desempenho | −0,28 |

Recompensas tangíveis e esperadas também minaram. Já o **feedback positivo** (verbal/informativo) **aumentou** tanto a escolha livre (d=+0,33) quanto o interesse (d=+0,31).

Tradução para o design (Cognitive Evaluation Theory):
- **XP como espelho, não como salário.** Não anunciar "faça X e ganhe Y XP" antes da tarefa (isso é recompensa esperada e contingente). Mostrar o XP **depois**, discreto, junto com feedback de **competência** ("agora você resolve divisores de tensão com carga").
- **Celebrar de forma inesperada e informativa:** badges de maestria aparecem quando o learner model confirma a maestria, sem contrato prévio.
- **Autonomia:** tudo que é competitivo é *opt-in*; o aluno escolhe a meta semanal e o caminho no grafo.
- **Nada de recompensas tangíveis** (moedas, loja). Se algum dia existirem, devem ser cosméticas e não condicionadas a volume.

### 1.4 Streaks: o que os dados dizem

**Duolingo (posts oficiais com A/B tests; números autodeclarados, sem IC):**
- [improving-the-streak](https://blog.duolingo.com/improving-the-streak/): o streak passou a estender com **1 lição/dia**, desacoplado da meta diária. Resultados:
  - retenção D14 +3,3%;
  - DAU +1%;
  - aprendizes diários com streak +10,5% em 20 dias (+19% entre novos);
  - aprendizes com streak de 7+ dias +40%.
- [how-duolingo-streak-builds-habit](https://blog.duolingo.com/how-duolingo-streak-builds-habit/):
  - animações de marco deram +1,7% de retenção D7 em novos aprendizes;
  - poder equipar até **2 Streak Freezes** deu +0,38% de DAU **sem** aumentar os dias de folga;
  - quem atinge 7 dias de streak tem 3,6× mais chance de concluir o curso (correlacional).
- [how-streaks-keep-duolingo-learners-committed…](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/):
  - *Streak Wager* deu +14% de retenção D7;
  - *Weekend Amulet* deu +4% de retorno uma semana depois e −5% de perda de streak;
  - o DAU cai 5–10% nos fins de semana.
- **Silverman & Barasch (2023)**, *Journal of Consumer Research* 49(6):1095–1117, DOI [10.1093/jcr/ucac029](https://doi.org/10.1093/jcr/ucac029), sete estudos:
  - streaks **intactos** exibidos no log aumentam o engajamento posterior em comparação com streaks **quebrados**;
  - o que importa é a **representação** no log, e não o comportamento real;
  - o efeito é mais forte quando a pessoa atribui a quebra a si mesma;
  - o efeito é **mais fraco quando o streak pode ser reparado**.

**Implicações:**
1. Um streak diário rígido gera aversão à perda e abandono após a quebra.
2. Flexibilidade (freezes e meta semanal) e **reparo** reduzem o dano.
3. A barra do "dia válido" deve ser baixa (mínimo viável), com a meta de volume separada.
4. O streak é ferramenta de **hábito**, não de aprendizado. Por isso ele não dá XP diretamente.

### 1.5 Ligas e ranking (Duolingo) e XP (Math Academy)

- **Duolingo Leagues** ([duolingo-leagues-leaderboards](https://blog.duolingo.com/duolingo-leagues-leaderboards/)):
  - hoje são **10 ligas**, com **Diamond** no topo (antes eram 5);
  - ligas semanais começam no domingo, no fuso do usuário;
  - o pareamento junta pessoas com **hábitos de estudo semelhantes** e fuso parecido;
  - existe remoção por XP ilegítimo;
  - o top 10 do Diamond entra num torneio;
  - dá para sair do leaderboard tornando o perfil privado.
  - O tamanho da coorte (popularmente ~30) e as cotas de promoção **não são informados** no post **(não verificado)**.
  - Lição para nós: **pareamento por hábito** é o que torna a competição justa. Num app de um usuário, o equivalente honesto é competir contra o **próprio histórico** ou contra uma **coorte simulada** do mesmo orçamento diário.
- **Math Academy** ([FAQ](https://www.mathacademy.com/faq)):
  - **1 XP ≈ 1 minuto de esforço focado** (em média);
  - XP só por respostas corretas, com crédito parcial;
  - **XP negativo** (raro) para pressa/chute;
  - lição interrompida por dificuldade não dá XP;
  - ritmo recomendado de 20–40 XP/dia, 3–5 dias/semana;
  - quizzes a cada ~150 XP;
  - **o XP nunca é perdido** em pausas.

  É a âncora mais próxima do nosso caso: **XP = tempo produtivo verificado**.

### 1.6 Dificuldade ótima, progresso e recomeços

- **Wilson, Shenhav, Straccia & Cohen (2019)**, "The Eighty Five Percent Rule for optimal learning", *Nature Communications* 10:4646, DOI [10.1038/s41467-019-12552-4](https://doi.org/10.1038/s41467-019-12552-4): para aprendizes por gradiente estocástico em classificação binária, a taxa de erro ótima de treino é ≈15,87%, ou seja, **~85% de acerto**. Usamos $E^*=0{,}80$–$0{,}85$ como alvo de dificuldade no multiplicador de XP e na seleção de itens.
- **Goal-gradient** (Kivetz, Urminsky & Zheng 2006, *JMR* 43(1):39–58, DOI [10.1509/jmkr.43.1.39](https://doi.org/10.1509/jmkr.43.1.39)): as pessoas aceleram perto da meta. Use barras de progresso **de curto alcance**: próximo nível, próxima divisão do tier, região quase dominada.
- **Endowed progress** (Nunes & Drèze 2006, *JCR* 32(4):504–512, DOI [10.1086/500480](https://doi.org/10.1086/500480)): progresso inicial concedido aumenta a conclusão. O diagnóstico inicial é trabalho real e já conta XP; a barra não começa em zero.
- **Fresh start effect** (Dai, Milkman & Riis 2014, *Management Science* 60(10), DOI [10.1287/mnsc.2014.1901](https://doi.org/10.1287/mnsc.2014.1901)): marcos temporais motivam recomeços. Proposta: **temporadas trimestrais por domínio**, com resumo da temporada e novas metas, sem resetar nada.

### 1.7 Princípios de design derivados (checklist)

| # | Princípio | Origem |
|---|---|---|
| P1 | XP mede **esforço produtivo verificado** (1 XP ≈ 1 min); a maestria fica no tier/badges | Math Academy; Mekler 2017 |
| P2 | XP **não depende de autoavaliação** (Again/Hard/Good/Easy) | Integridade do FSRS; Toda 2018 ("gaming the system") |
| P3 | Recompensa **relativa ao nível** (Elo expected score) e à **retrievability** (FSRS) | Pelánek 2016; r2 §2 |
| P4 | Feedback **informativo e pós-tarefa**; nada de "contratos" de XP | Deci et al. 1999 |
| P5 | Competição **opt-in**, contra si ou contra coorte simulada rotulada | Christy & Fox 2014; Hanus & Fox 2015; Duolingo (pareamento por hábito) |
| P6 | Streak flexível: semanal, freezes, reparo, barra baixa | Duolingo; Silverman & Barasch 2023 |
| P7 | Soft cap diário: estimula espaçar em vez de fazer maratonas | Prática distribuída; saúde |
| P8 | Nada é perdido: XP e nível nunca caem; tier é pico + indicador de "forma" | Math Academy (XP nunca perdido); aversão à perda |
| P9 | Curto alcance visível (próximo nível/divisão/região) | Goal-gradient |
| P10 | Renovação periódica (temporadas) em vez de recompensas crescentes | Fresh start; efeito novidade (Hamari 2014; Sailer & Homner: sem dados > 6 meses) |
| P11 | UI mínima: um toast discreto e um card de resumo no fim da sessão, nunca interrompendo uma explicação | Meta 9 do usuário (didática não cansativa) |

---

## 2. Ratings: Elo e Glicko-2 para "XP compatível com o nível"

### 2.1 Elo para aluno × item (Pelánek 2016)

**Pelánek (2016)**, "Applications of the Elo rating system in adaptive educational systems", *Computers & Education* 98:169–179, DOI [10.1016/j.compedu.2016.03.017](https://doi.org/10.1016/j.compedu.2016.03.017). Preprint lido: [fi.muni.cz/~xpelanek/publications/CAE-elo.pdf](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf).

- Escala logit: $P(\text{acerto}) = \sigma(\theta - b) = 1/(1+e^{-(\theta-b)})$.
- Múltipla escolha com k opções: $P = 1/k + (1-1/k)\,\sigma(\theta-b)$.
- Atualização: $\theta \leftarrow \theta + K\,(y - P)$ e $b \leftarrow b - K\,(y - P)$.
- K constante de 0,4 nos trabalhos anteriores. É melhor usar uma **função de incerteza** $U(n)=a/(1+b\,n)$, onde n é o número de respostas do aluno (ou do item). Ponto de partida recomendado: **a=1, b=0,05** (ajustáveis por grid search).
- **Tempo de resposta** (Klinkenberg, Straatemeier & van der Maas 2011, *Computers & Education* 57(2):1813–1824, DOI [10.1016/j.compedu.2011.02.003](https://doi.org/10.1016/j.compedu.2011.02.003), Math Garden): a regra "high speed, high stakes" pontua $S=(2y-1)(a\,d - a\,t)$, com d = limite de tempo e a = discriminação. Só faz sentido quando a UI mostra o tempo. Para nós (sem cronômetro visível), use o tempo apenas para **detectar chute/pressa**.

**Nossa escala (estilo xadrez, mais legível):** $E = 1/(1+10^{(b-\theta)/400})$. Converte-se do logit com $\theta_{400} = \theta_{logit}\cdot 400/\ln 10 \approx 173{,}7\,\theta_{logit}$. Portanto $K_{400}(n) \approx 173{,}7/(1+0{,}05n)$.

**Priors do item.** O LLM classifica o estágio do nó (1..7), e $b_0 = 1000 + 200\,(s-1) + 60\,z$, onde $z\in[-1,1]$ é a dificuldade relativa dentro do estágio, sugerida pelo LLM. O Elo refina b com o uso.

**Prior do aluno.** Vem do diagnóstico inicial (KST/r2 §9.7): θ₀ = o b médio da fronteira externa estimada.

### 2.2 Glicko-2 para o rating de domínio exibido

[Glickman, *Example of the Glicko-2 system*](http://www.glicko.net/glicko/glicko2.pdf), lido:
- aluno novo: r=1500, RD=350, σ=0,06;
- τ entre 0,3 e 1,2 (o exemplo usa 0,5);
- escala interna: μ=(r−1500)/173,7178 e φ=RD/173,7178;
- funciona melhor com 10–15+ "jogos" por período de rating.

**Uso proposto.** O "Rating" do domínio (opcional na UI) usa **período = semana**. Cada item avaliado é um "jogo" contra um oponente de rating b e RD_item. Enquanto RD > 110, a UI mostra "provisório (?)". O Glicko-2 é o lugar certo para essa **incerteza**; o Elo simples fica para a seleção de itens, onde é barato e estável.

### 2.3 Como o Elo entra no XP

- **Item avaliado** (exercício, pergunta do professor, *check* de aula):

  $M_{dif} = \mathrm{clamp}\!\left(\frac{1-E}{1-E^*},\ 0{,}3,\ 1{,}5\right)$, com $E^*=0{,}80$.

  | E (item vs. nível) | $M_{dif}$ |
  |---|---|
  | 0,95 (muito fácil para o nível) | 0,3 |
  | 0,80 (zona-alvo) | 1,0 |
  | ≤ 0,70 (desafio) | 1,5 (teto) |

  O aluno de nível Doutor que refaz exercícios de Bronze ganha 30% do XP por minuto. O iniciante ganha 100% no mesmo exercício. É isso que torna o XP "compatível com o nível atual".
- **Revisão espaçada:** o expected score natural é a própria retrievability R do FSRS no momento da revisão:

  $g(R)=\mathrm{clamp}\!\left(\frac{1-R}{1-DR},\ 0{,}1,\ 1{,}5\right)$.

  | R na revisão | g(R) |
  |---|---|
  | 0,90 (no tempo, DR=0,9) | 1,0 |
  | 0,98 (cedo demais) | 0,2 |
  | ≤ 0,85 (atrasada) | 1,5 (teto) |

  O teto de 1,5 não premia deixar acumular: o backlog custa tempo e lapsos, e a simulação mostra que a regra não cria incentivo perverso. Esse g também é coerente com o FSRS: o ganho de estabilidade **tende a zero quando R → 1** (r2 §0.4).

---

## 3. Curvas de nível: polinomial vs exponencial

| Família | Fórmula | Comportamento | Exemplo |
|---|---|---|---|
| Exponencial | $XP(L) \approx \tfrac14\sum_{l<L}\lfloor l + 300\cdot 2^{l/7}\rfloor$ | O XP por nível dobra a cada ~7 níveis; o nível 92 é ~metade do XP do 99 (6.517.253 vs. 13.034.431) | RuneScape |
| Cúbica | $n^3$ ("Medium Fast"), $1{,}25n^3$ ("Slow") | XP por nível ∝ L² | Pokémon |
| **Potência $aL^p$, $1<p<2$** | $XP(L)=a\,L^p$ | XP por nível ∝ $L^{p-1}$; com XP ∝ tempo, o **tempo por nível cresce devagar** | **Proposta** |
| Linear | $aL$ | Nível ∝ tempo; sem marcos iniciais rápidos | — |

Com XP ≈ minutos, o **tempo entre níveis** é $\Delta t(L) \approx a\,p\,L^{p-1}/\text{(XP/dia)}$. A exponencial torna os níveis finais inalcançáveis num horizonte de 1–2 anos, e o aluno sente estagnação justamente quando o conteúdo fica mais difícil. A potência com p≈1,7 dá **níveis rápidos no início** (onboarding, *endowed progress*) e **cadência quase semanal no fim**.

**Ajuste por Monte Carlo (§5).** Restrições: o aluno de referência de 3 h/dia está em L=10 no dia 7 e em L=100 no dia 365. O ajuste dá:

$$XP_{total}(L) = 20{,}10 \cdot L^{1{,}696}, \qquad L(XP) = \left\lfloor (XP/20{,}10)^{1/1{,}696} \right\rfloor$$

| Subida | L1→2 | L10→11 | L50→51 | L100→101 | L150→151 |
|---|---|---|---|---|---|
| XP (≈ min) | 45 | 175 | 522 | 843 | 1.116 |

O nível **não tem teto**. Depois de L100 vêm "prestígios" estéticos (anel no avatar), sem reset. A mesma curva serve para o **nível de domínio** (XP só do domínio) e para o **nível de conta** (soma de todos os domínios).

---

## 4. Projeto: progressão "em várias partes"

### 4.1 Camadas

| Camada | O que mede | Fonte | Pode cair? | UI |
|---|---|---|---|---|
| **XP de conta** + **Nível de conta** | Esforço total verificado | Ledger de eventos de XP (todos os domínios) | Não | Número pequeno no avatar |
| **XP de domínio** + **Nível de domínio** | Esforço no domínio | Ledger filtrado | Não | "Eletrônica · Nv 37" |
| **Maestria de região** (badges) | Domínio local de uma região do grafo | Learner model (r2 §9): $m_n = P(L_n)\cdot R_n(t)$ | Badge permanece; estado "enferrujado" se a retenção cai | Selo no mapa do grafo |
| **Tier do domínio** (Bronze…Doutor, divisões III/II/I) | Maestria **retida** do núcleo canônico por estágio | Learner model + núcleo congelado | **Não** (título de pico) | Emblema cel-shaded |
| **Forma do domínio** | Saúde atual da retenção (% do núcleo alcançado com R ≥ 0,7) | FSRS por nó | Sim (é um termômetro) | Anel de cor no emblema |
| **Rating (Glicko-2)** | Habilidade estimada (θ, RD) | Itens avaliados | Sim | Opcional, "avançado" |
| **Streak semanal** | Hábito | Dias válidos | Zera com reparo/freezes | Chama discreta |
| **Liga** (opt-in) | Ritmo vs. si mesmo ou coorte simulada | XP semanal | Promove/rebaixa | Desligada por padrão |

### 4.2 Estágios, núcleo canônico e tiers

O grafo do domínio (relatório r3) recebe um atributo `stage ∈ {1..7}` por nó:

| Estágio | Tier | Faixa de conteúdo |
|---|---|---|
| 1 | Bronze | Fundamentos e pré-requisitos |
| 2 | Prata | Básico/técnico (≈ ensino médio/técnico) |
| 3 | Ouro | Graduação I |
| 4 | Platina | Graduação II |
| 5 | Diamante | Graduação avançada/especialização |
| 6 | Mestre | Mestrado |
| 7 | Doutor | Doutorado/fronteira |

Para cada estágio existe um **núcleo canônico congelado** `core[s]`: o conjunto de IDs que define o tier. A expansão procedural do grafo cria nós "extras" que contam para XP, regiões e badges, mas **não entram no núcleo automaticamente**. Só uma "revisão de núcleo" explícita (versionada) muda o núcleo, e quem já conquistou o tier mantém o título. Sem isso, cada expansão do grafo **rebaixaria** silenciosamente todo mundo.

**Critério (estrutural):**
- nó **retido** = aprendido ∧ $R_n(t) \ge 0{,}70$;
- estágio s **concluído** ⇔ fração retida de `core[s]` ≥ q (q=0,8) **e** todos os estágios < s concluídos;
- **tier** = maior estágio concluído (0 = "Novato");
- **divisão** dentro do tier: III/II/I conforme a fração retida do estágio **seguinte** cruza 1/3 e 2/3;
- **exame de qualificação** (opcional, recomendado a partir de Ouro): 20–30 itens mistos do núcleo do estágio, escolhidos por Elo para E≈0,7–0,8, aplicados ≥ 3 dias após o último nó novo do estágio (teste espaçado). Promove se θ̂ ≥ b̄_estágio e RD ≤ 110. É o "certificado honesto" do tier e custa ~1 sessão por tier, o que não muda a calibração da §5.

**Critério alternativo (contínuo, PM = Pontos de Maestria):**

$$PM = \sum_{s=1}^{7} s \cdot \frac{|\{n \in core[s] : \text{retido}\}|}{|core[s]|}, \qquad PM_{max}=28$$

Os limiares de cada tier são escolhidos por **quantis do MC** (§5.4). É útil quando se quer uma barra contínua e um número.

### 4.3 Eventos e fórmulas de XP

**Unidade:** 1 XP ≈ 1 minuto de esforço focado e produtivo.

**Tempo efetivo:**

$$T_{ef} = \min(T_{ativo},\ 1{,}5\cdot T_{esperado})$$

$T_{ativo}$ exclui períodos ociosos: sem input por mais de 90 s, janela sem foco, ou vídeo pausado. $T_{esperado}$ vem do nó/recurso (estimativa do LLM, refinada pela mediana pessoal).

| Evento | Fórmula de XP | Liberação | Anti-farming embutido |
|---|---|---|---|
| **Aula IA** (segmento de um nó) | $T_{ef}\cdot q$ | No *check* de compreensão do nó: q=1 se passou, **0,25** se não passou (crédito de esforço) | Pular a aula não passa no check; o teto de $1{,}5\,T_{esperado}$ impede "deixar aberto" |
| **Capítulo de livro / vídeo** | $0{,}8\cdot\min(T_{mídia}, T_{ativo})\cdot q$ | Após 2–3 perguntas de recuperação (q como acima) | Consumo passivo vale menos; sem check, 0,25 |
| **Exercício/problema avaliado** | $T_{ef}\cdot M_{dif}(E)\cdot c\cdot h$ | Na correção | c=1 (certo), 0,5 (errado com tentativa genuína), 0 (chute: tempo < 20% da mediana **e** errado); $h=\max(0{,}4,\ 1-0{,}2\cdot\text{dicas})$ |
| **Revisão (flashcard ou nó)** | $\min(T_{ef},\,2\text{ min/cartão})\cdot g(R)$; lapso ×0,8 | Na revisão | **Independe da nota escolhida**; revisão antecipada → g≈0,1–0,3 |
| **Revisão feita no Anki** (importada) | mesma fórmula, com `time` do revlog limitado a 60 s/cartão e R obtido por *replay* | No *pull* | Idempotente por `revlogId` |
| **Diagnóstico inicial** | $T_{ef}$ | Ao concluir | *Endowed progress* honesto |
| **Criar/editar cartões** | 0 | — | Evita spam de cartões |
| **Badge/tier conquistado** | 0 XP (celebração visual) | — | Maestria não vira moeda |

**Soft cap diário (por conta):** os minutos de XP após 240 min/dia valem ×0,5, e após 360 min/dia valem ×0,25. Isso estimula a prática distribuída e protege a saúde. É aplicado no momento do crédito, em ordem cronológica.

**Negativos:** não há XP negativo (diferente do Math Academy). Pressa/chute detectados dão 0 XP e um *nudge* de uma linha ("vamos com calma: tente explicar o passo").

**Determinismo e auditoria:**
- cada evento tem `eventId` (UUID/ULID) e `rulesVersion`;
- o XP concedido é **gravado** no ledger;
- mudanças de regra só afetam eventos futuros, então o nível exibido nunca cai.

### 4.4 Streak saudável

- **Dia válido:** ≥ 10 min de $T_{ativo}$ produtivo **ou** fila de revisões vencidas zerada (o que vier primeiro). Isso segue a lição do Duolingo de separar o streak da meta de volume.
- **Meta semanal:** o aluno escolhe de 3 a 7 dias/semana (padrão 5). O streak conta **semanas cumpridas**, e o contador diário é só informativo.
- **Freezes:** ganha-se 1 a cada 2 semanas cumpridas; no máximo 2 equipados (Duolingo); consumidos automaticamente; nunca comprados.
- **Reparo:** quebrou? Em até 48 h, uma sessão de 2× o mínimo restaura (Silverman & Barasch: o reparo atenua a desmotivação).
- **Folgas planejadas:** "modo viagem" pausa o streak por até 14 dias/ano sem consumir freezes.
- **Notificações:** no máximo 1/dia, numa janela escolhida pelo aluno, sem culpa nem urgência artificial. Silêncio noturno.

### 4.5 Badges de maestria por região

Os estados seguem a família "tentado / familiar / proficiente / dominado" popularizada pela Khan Academy (os limiares abaixo são nossos):

| Estado | Critério sobre os nós da região (ponderados por $w_n$) |
|---|---|
| Explorada | ≥ 1 nó aprendido |
| Familiar | ≥ 50% aprendidos |
| Proficiente | ≥ 80% retidos ($R\ge 0{,}7$) |
| **Dominada** | ≥ 90% retidos **e** "chefe" da região aprovado (5–8 itens integradores, espaçados ≥ 7 dias após o último nó novo) |
| Enferrujada (sobreposto) | Já foi Proficiente/Dominada, mas a fração retida caiu < 70% → botão "Restaurar" abre uma sessão de revisão da região |

### 4.6 Liga opcional (opt-in)

- **Modo "Eu vs. Eu"** (padrão quando a liga está ligada): compara o XP da semana com a mediana das últimas 4 semanas, num placar de 5 "fantasmas" que são as suas semanas anteriores.
- **Modo "Coorte simulada"**: 29 rivais **explicitamente rotulados como simulados**, amostrados do MC com o mesmo orçamento diário declarado pelo aluno (o equivalente ao "pareamento por hábito" do Duolingo).
  - Promoção: top 7 sobe.
  - Rebaixamento: os 5 últimos descem, **exceto** se o aluno cumpriu a meta semanal (isso evita punir quem é consistente).
  - Em nenhum momento o app finge que são pessoas.

### 4.7 Tipos TypeScript (proposta)

```ts
// src/core/progress/types.ts (proposta)
export type DomainId = string; export type NodeId = string; export type RegionId = string;

export type ProgressEvent =
  | { kind: 'lesson'; eventId: string; at: number; domainId: DomainId; nodeId: NodeId;
      activeMs: number; expectedMs: number; checkPassed: boolean }
  | { kind: 'media'; eventId: string; at: number; domainId: DomainId; nodeIds: NodeId[];
      activeMs: number; mediaMs: number; checkPassed: boolean; source: 'book' | 'video' }
  | { kind: 'item'; eventId: string; at: number; domainId: DomainId; nodeIds: NodeId[];
      activeMs: number; itemB: number; thetaBefore: number; outcome: 'correct' | 'wrong' | 'guess';
      hints: number }
  | { kind: 'review'; eventId: string; at: number; domainId: DomainId; unitId: string;
      activeMs: number; retrievability: number; lapse: boolean; origin: 'app' | 'anki' | 'obsidian' }
  | { kind: 'diagnostic'; eventId: string; at: number; domainId: DomainId; activeMs: number };

export interface XpLedgerEntry {
  eventId: string; at: number; domainId: DomainId; kind: ProgressEvent['kind'];
  minutesCredited: number; multiplier: number; softCapFactor: number;
  xp: number; rulesVersion: string;
}

export interface LevelCurve { a: number; p: number }            // XP_total(L) = a·L^p
export interface TierDef { stage: number; name: string; coreNodeIds: NodeId[]; coreVersion: string }
export interface DomainProgress {
  domainId: DomainId; xp: number; level: number;
  tierPeak: number; division: 0 | 1 | 2 | 3; form: number; // form ∈ [0,1]
  pm: number; rating?: { r: number; rd: number; sigma: number };
}
export interface StreakState {
  weeklyTarget: number; currentWeekValidDays: number; weeksStreak: number;
  freezes: number; repairDeadline?: number; travelDaysLeft: number;
}
```

```ts
// src/core/progress/xp.ts (proposta: funções puras)
export const RULES = { version: '2026-11-r1', Estar: 0.80, DR: 0.90, softCap1: 240, softCap2: 360,
  lessonFailCredit: 0.25, mediaFactor: 0.8, reviewMaxMin: 2, ankiReviewMaxSec: 60 } as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const expectedScore = (theta: number, b: number) => 1 / (1 + 10 ** ((b - theta) / 400));
export const mDif = (E: number) => clamp((1 - E) / (1 - RULES.Estar), 0.3, 1.5);
export const gReview = (R: number, dr = RULES.DR) => clamp((1 - R) / (1 - dr), 0.1, 1.5);

/** minutos creditáveis e multiplicador; o soft cap é aplicado depois, em ordem cronológica */
export function rawXp(ev: ProgressEvent): { minutes: number; mult: number } {
  const min = (ms: number) => ms / 60000;
  switch (ev.kind) {
    case 'lesson': return { minutes: Math.min(min(ev.activeMs), 1.5 * min(ev.expectedMs)),
                            mult: ev.checkPassed ? 1 : RULES.lessonFailCredit };
    case 'media':  return { minutes: Math.min(min(ev.activeMs), min(ev.mediaMs)),
                            mult: RULES.mediaFactor * (ev.checkPassed ? 1 : RULES.lessonFailCredit) };
    case 'item': {
      const E = expectedScore(ev.thetaBefore, ev.itemB);
      const c = ev.outcome === 'correct' ? 1 : ev.outcome === 'wrong' ? 0.5 : 0;
      return { minutes: min(ev.activeMs), mult: mDif(E) * c * Math.max(0.4, 1 - 0.2 * ev.hints) };
    }
    case 'review': {
      const cap = ev.origin === 'anki' ? RULES.ankiReviewMaxSec / 60 : RULES.reviewMaxMin;
      return { minutes: Math.min(min(ev.activeMs), cap), mult: gReview(ev.retrievability) * (ev.lapse ? 0.8 : 1) };
    }
    case 'diagnostic': return { minutes: min(ev.activeMs), mult: 1 };
  }
}

/** aplica o soft cap diário: minutesAlreadyToday = minutos creditados antes deste evento no dia de estudo */
export function softCapped(minutes: number, mult: number, minutesAlreadyToday: number): number {
  let xp = 0, m = minutesAlreadyToday, left = minutes;
  const seg = (lim: number, f: number) => { const take = Math.max(0, Math.min(left, lim - m)); xp += take * mult * f; m += take; left -= take; };
  seg(RULES.softCap1, 1); seg(RULES.softCap2, 0.5); seg(Infinity, 0.25);
  return Math.round(xp * 10) / 10;
}

export const levelFromXp = (xp: number, c: LevelCurve = { a: 20.10, p: 1.696 }) =>
  Math.max(1, Math.floor((Math.max(0, xp) / c.a) ** (1 / c.p)));
export const xpForLevel = (L: number, c: LevelCurve = { a: 20.10, p: 1.696 }) => c.a * L ** c.p;
```

```ts
// src/core/progress/elo.ts (proposta)
export function eloUpdate(theta: number, b: number, y: 0 | 1, nStudent: number, nItem: number) {
  const E = 1 / (1 + 10 ** ((b - theta) / 400));
  const Ks = 173.7 / (1 + 0.05 * nStudent), Ki = 173.7 / (1 + 0.05 * nItem);   // Pelánek a=1,b=0,05
  return { theta: theta + Ks * (y - E), b: b - Ki * (y - E), E };
}
```

```ts
// src/core/progress/tiers.ts (proposta)
export function domainStanding(tiers: TierDef[], isLearned: (n: NodeId) => boolean,
                               isRetained: (n: NodeId) => boolean, q = 0.8) {
  const frac = tiers.map(t => t.coreNodeIds.filter(isRetained).length / Math.max(1, t.coreNodeIds.length));
  let tier = 0; while (tier < tiers.length && frac[tier] >= q) tier++;
  const next = frac[tier] ?? 1;
  const division = (tier >= tiers.length ? 0 : next >= 2 / 3 ? 1 : next >= 1 / 3 ? 2 : 3) as 0 | 1 | 2 | 3;
  const pm = frac.reduce((acc, f, i) => acc + (i + 1) * f, 0);
  const learned = tiers.flatMap(t => t.coreNodeIds).filter(isLearned);
  const form = learned.length ? learned.filter(isRetained).length / learned.length : 1; // saúde da retenção
  return { tierNow: tier, division, pm, frac, form };
}
// tierPeak = max(tierPeak, tierNow), persistido; o tier exibido é tierPeak, e form colore o anel do emblema
```

**Invariantes** (testáveis com *property-based testing*; candidatas a prova em Lean, conforme o relatório r10):
- (I1) XP ≥ 0 por evento.
- (I2) O XP acumulado é monotônico e idempotente por `eventId`.
- (I3) `levelFromXp` é monotônica.
- (I4) `tierPeak` é monotônico.
- (I5) XP/h ≤ 90 para qualquer sequência de eventos: o multiplicador máximo é 1,5 e o soft cap só reduz.
- (I6) Para revisões, $\partial XP/\partial R \le 0$ (revisar mais cedo nunca rende mais).
- (I7) O XP independe da nota de autoavaliação.

### 4.8 Arquivos propostos no fork

| Caminho (proposta) | Conteúdo |
|---|---|
| `src/core/progress/{types,xp,levels,elo,glicko2,tiers,streak}.ts` | Funções puras acima |
| `src/server/progress-store.ts` | Ledger *append-only* `data/domains/<id>/progress/xp.jsonl` + snapshot `progress.json` (escrita atômica, como `plugins/flashcards/src/store.cjs`) |
| `src/core/plugin-progress.ts` + `ctx.progress.record(ev)` | Nova capacidade de plugin. O relatório `lh-plugins-infra.md` §0 mostra que um plugin não lê a store de outro; o Flashcards precisa **emitir** eventos de revisão para o core |
| `scripts/calibrate-progression.ts` | Porte TS do MC do Apêndice A (PRNG semeável), que gera `config/progression.json` com `{a, p, tiers, pmThresholds, rulesVersion}` |
| `tests/progress-*.test.ts` | Invariantes I1–I7, soft cap, idempotência, curva |
| `components/progress/*` | Emblema de tier, barra de nível, card de fim de sessão (SVG desenhados à mão, cel shading; ver `lh-ui-theme.md`) |

---

## 5. Simulação Monte Carlo para calibrar níveis e tiers

### 5.1 Modelo (resumo)

**Domínio:** 7 estágios com núcleo de **1.110 nós**:

| Estágio | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Nós | 40 | 90 | 150 | 200 | 230 | 210 | 190 |
| Aula por nó (min, média) | 20,5 | 28,7 | 36,9 | 45,1 | 53,3 | 61,5 | 69,7 |

Isso soma **940 h de aula**, sem contar revisões. O estágio s+1 é liberado quando 70% do estágio s foi aprendido. É uma simplificação da fronteira KST do r2.

**Aluno sintético:**
- minutos/dia = $H\cdot 60\cdot \mathrm{LogN}(\text{média }1,\ \sigma=0{,}3)$;
- dia pulado com probabilidade $p_{skip}\sim U(0{,}05;\,0{,}25)$;
- 14 dias de férias por ano;
- velocidade $\kappa\sim \mathrm{LogN}(1,\ 0{,}25)$;
- tempo do nó $\times\,\mathrm{LogN}(1,\ 0{,}4)$;
- check de aula: passa com p=0,9; se falha, refaz +30% do tempo.

**Memória:** FSRS-6 com os **pesos default** (os mesmos de `plugins/flashcards/src/scheduler.cjs`) e DR=0,9, em granularidade diária.
- Revisão de nó = 3 min; lapso = +6 min.
- Recall ~ Bernoulli(R).
- Nota ao lembrar: ~80% Good, ~10% Easy, ~10% Hard.
- Revisões vencidas vêm primeiro; o restante do tempo vai para nós novos.

**XP:** regras da §4.3, incluindo o soft cap. O tier é avaliado semanalmente pelo critério estrutural (q=0,8; retido = R ≥ 0,7). O PM também é calculado.

**Farmers** (3 h/dia, 180 dias):
- (i) gasta 50% do tempo em **revisões antecipadas** de itens já fáceis;
- (ii) **skimmer**: faz as aulas em 40% do tempo e passa no check com p=0,35.

Comparação: regras propostas vs. **regra ingênua** (+50 XP por aula "concluída", +10 por revisão).

Execução: `node sim.mjs 400 1000 7 0.82` → N=400 alunos por perfil, 1.000 dias, seed 7. Roda em ~5 s.

### 5.2 Resultados: quando cada tier é atingido

Mediana [p10–p90] e, no fim, a fração que chega em 1.000 dias. A granularidade é semanal (6d = 1ª avaliação).

| Tier | 1 h/dia | 2 h/dia | 3 h/dia | 4 h/dia |
|---|---|---|---|---|
| Bronze | 20d (0,7m) [13–27] 100% | 13d [6–13] 100% | 6d [6–13] 100% | 6d [6–6] 100% |
| Prata | 83d (2,7m) [62–118] 100% | 41d (1,3m) [27–55] 100% | 27d (0,9m) [20–41] 100% | 20d (0,7m) [13–27] 100% |
| Ouro | 251d (8,2m) [188–322] 100% | 111d (3,6m) [83–153] 100% | 76d (2,5m) [55–97] 100% | 55d (1,8m) [41–76] 100% |
| Platina | 552d (18,1m) [425–700] 100% | 244d (8,0m) [188–321] 100% | 160d (5,3m) [118–216] 100% | 111d (3,6m) [83–153] 100% |
| Diamante | 860d (28,3m) 52% | 426d (14,0m) [328–573] 100% | 279d (9,2m) [202–371] 100% | 195d (6,4m) [146–265] 100% |
| Mestre | — (1%) | 636d (20,9m) [489–811] 97% | 412d (13,5m) [307–559] 100% | 293d (9,6m) [223–391] 100% |
| **Doutor** | — (0%) | **825d (27,1m)** [650–964] 76% | **556d (18,2m)** [412–735] 100% | **384d (12,6m)** [300–517] 100% |

**Horas de estudo até Doutor (p50):** 2 h/dia → 1.333 h; 3 h/dia → 1.347 h; 4 h/dia → 1.264 h (p10–p90 ≈ 1.000–1.750 h). As revisões ocupam **~32–35%** do tempo. Isso é com revisões no nível do nó e **sem** a compressão FIRe do r2 §5.1. Com FIRe, a fração deve cair, e o calendário deve ser recalibrado.

**Leitura:**
- O alvo "**+1 ano a 2–4 h/dia, 1.000–1.500 h**" é atingido.
- Os tiers iniciais são rápidos (Bronze na 1ª semana, Prata em ~1 mês a 3 h/dia). Os finais são espaçados (Mestre→Doutor leva ~4–5 meses a 3 h/dia).
- A 1 h/dia, Doutor fica fora do horizonte de ~2,7 anos. Isso é honesto: o app deve mostrar a **previsão** para o ritmo do aluno, e não prometer.

### 5.3 XP e nível ao longo do tempo (medianas)

| Perfil | d1 | d7 | d30 | d90 | d180 | d365 | d540 | d730 |
|---|---|---|---|---|---|---|---|---|
| XP 1 h/dia | 40 | 329 | 1.417 | 4.257 | 8.436 | 17.108 | 25.411 | 34.218 |
| XP 2 h/dia | 86 | 660 | 2.866 | 8.416 | 16.701 | 33.719 | 49.764 | 66.908 |
| XP 3 h/dia | 140 | 998 | 4.242 | 12.356 | 24.445 | 49.535 | 70.639 | 83.879 |
| XP 4 h/dia | 197 | 1.261 | 5.317 | 15.744 | 30.951 | 61.369 | 75.544 | 81.137* |
| **Nível** 1 h | 1 | 5 | 12 | 23 | 35 | 53 | 67 | 80 |
| **Nível** 2 h | 2 | 7 | 18 | 35 | 52 | 79 | 100 | 119 |
| **Nível** 3 h | 3 | 9 | 23 | 44 | 65 | 99 | 123 | 136 |
| **Nível** 4 h | 3 | 11 | 26 | 50 | 75 | 113 | 128 | 133* |

\* No perfil de 4 h/dia o núcleo simulado **acaba**, e daí em diante só restam revisões. No app real, o grafo se expande.

O XP/h mediano fica em **54–57**, coerente com 1 XP ≈ 1 min. Fica abaixo de 60 por causa dos checks falhos (0,25) e das revisões com g<1.

### 5.4 Limiares contínuos (PM) por quantis

Os tempos-alvo foram definidos para o aluno de referência (3 h/dia), e o limiar de cada tier é a **mediana do PM simulado** na semana-alvo (PM máx. = 28):

| Tier | Semana-alvo | PM ≥ |
|---|---|---|
| Bronze | 2 | 1,71 |
| Prata | 6 | 3,71 |
| Ouro | 13 | 6,32 |
| Platina | 24 | 9,69 |
| Diamante | 37 | 13,37 |
| Mestre | 52 | 17,69 |
| Doutor | 70 | 23,49 |

**Receita geral de calibração** (para qualquer métrica de progresso $M(t)$):
1. Escolha os tempos-alvo $T_k$ para o aluno de referência.
2. Simule N ≥ 2.000 alunos.
3. Defina o limiar $\tau_k = \mathrm{mediana}\{M_i(T_k)\}$.
4. Verifique as restrições: monotonia; Doutor a 4 h/dia ≥ 12 meses; farmers ≤ 0,75× o XP/h honesto; intervalo entre níveis ≤ 7 dias até L100 a 2 h/dia.
5. Ajuste os parâmetros estruturais (tamanho do núcleo, q, DR) se alguma falhar.

### 5.5 Anti-farming (3 h/dia, 180 dias, medianas)

| Estratégia | XP/h (regras propostas) | XP/h (regra ingênua) | PM @180d | Tiers @180d |
|---|---|---|---|---|
| Honesto | **56,0** | 106,5 | **9,96** | 4 |
| Revisões antecipadas (50% do tempo) | 34,3 (−39%) | 142,1 (**+33%**) | 6,84 | 3 |
| Skimmer (aula a 40%, check 35%) | 40,7 (−27%) | 157,7 (**+48%**) | 8,72 | 3 |

A regra ingênua **paga mais** para quem trapaceia. As regras propostas invertem isso, e o progresso em maestria (PM/tier) também é menor para os farmers. Ou seja, as duas camadas apontam na mesma direção.

### 5.6 Sensibilidade (N=200/perfil)

| Variante | Doutor a 3 h/dia (p50) | Doutor a 4 h/dia (p50) | Horas até Doutor (3 h) | Fração do tempo em revisões |
|---|---|---|---|---|
| DR 0,85, q 0,8 | 517d (17,0m) | 370d (12,2m) | 1.274 h | 27,7% |
| **DR 0,90, q 0,8 (base)** | 556d (18,2m) | 384d (12,6m) | 1.347 h | 34,1% |
| DR 0,95, q 0,8 | 643d (21,1m) | 465d (15,3m) | 1.571 h | 45,4% |
| DR 0,90, q 0,7 | 549d (18,0m) | 384d (12,6m) | 1.315 h | 33,7% |
| DR 0,90, q 0,9 | 580d (19,1m) | 402d (13,2m) | 1.386 h | 33,7% |

A **retenção desejada** é o parâmetro mais sensível. A 0,95, quase metade do tempo vai para revisões, o que confirma a orientação do manual do Anki citada no r2. O q tem efeito pequeno porque, com DR 0,9, quase todo nó aprendido continua retido.

### 5.7 Limitações e recalibração com dados reais

**Limitações do modelo:**
- não há compressão FIRe nem crédito implícito;
- nós independentes, em ordem fixa;
- sem *dropout* nem dinâmica de motivação;
- revisões de nó com custo fixo;
- pesos FSRS de *flashcard* aplicados a nós conceituais;
- avaliação semanal;
- grafo estático.

**Recalibração:**
- **Mensal**, com dados do próprio aluno: substitua as distribuições por posteriores pessoais (minutos/dia observados, $p_{skip}$, κ pela razão tempo real/estimado, pesos FSRS otimizados por domínio).
- Re-rode o MC com o grafo atual e mostre **previsões** ("Doutor em ~14 meses no seu ritmo, faixa 11–18").
- **Nunca** mude limiares já conquistados: grandfathering por `coreVersion`/`rulesVersion`.

---

## 6. Flashcards (B): Anki

### 6.1 Anki hoje (verificado)

- **Releases:**
  - **26.09** (2026-09-14, estável);
  - **26.09.4** (2026-11-04);
  - **26.11b1** (beta, 2026-11-12).

  As notas da 26.09 dizem que os módulos legados **`anki.importing` e `anki.exporting` foram removidos**. Wrappers de compatibilidade foram adicionados e testados apenas com o AnkiConnect, e serão removidos no futuro. A 26.09 também atualizou o FSRS para o `fsrs-rs` 6.6.2. Fonte: [releases](https://github.com/ankitects/anki/releases).
- **Licença:** AGPL-3.0+ (com partes BSD-3). Compatível com o nosso fork AGPL.
- **Formato `.apkg`** ([`rslib/src/import_export/package/meta.rs`](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs)):

  | Versão | Arquivo | Schema | Observações |
  |---|---|---|---|
  | `Legacy1` | `collection.anki2` | V11 | Sem arquivo `meta`; mapa `media` em **JSON** `{"0":"img.png"}` |
  | `Legacy2` | `collection.anki21` | V11 | — |
  | `Latest` | `collection.anki21b` | V18 | **zstd**; `meta` em protobuf; mapa de mídia em protobuf |

  O importador detecta a versão pelo `meta` (ou pela ausência dele). Pacotes legados **continuam importáveis**.
- **Opções de importação** ([`proto/anki/import_export.proto`](https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto)): `merge_notetypes`, `update_notes` e `update_notetypes` (`IF_NEWER`=padrão, `ALWAYS`, `NEVER`), `with_scheduling`, `with_deck_configs`.
  - As notas são casadas por **GUID** e atualizadas se o `mtime` recebido for maior ([`apkg/import/notes.rs`](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/apkg/import/notes.rs)).
  - Consequência: **GUID estável + mtime crescente = reexportação idempotente que preserva o agendamento.**
- **Importação de texto** (Anki ≥ 2.1.54, [manual](https://github.com/ankitects/anki-manual/blob/main/src/importing/text-files.md)):
  - cabeçalhos `#separator:Tab`, `#html:true`, `#tags:…`, `#columns:…`, `#notetype:…`, `#deck:…`, `#notetype column:N`, `#deck column:N`, `#tags column:N`, `#guid column:N`;
  - por padrão, a duplicidade é decidida pelo **1º campo** (que é atualizado);
  - o manual **recomenda colocar IDs próprios no 1º campo**, em vez de forjar GUIDs.
- **Recursos de template úteis:**
  - **TTS nativo** `{{tts en_US:Front}}`, com `voices=…`, `speed=0.8` e `cloze-only` ([manual](https://github.com/ankitects/anki-manual/blob/main/src/templates/fields.md)). Ideal para Inglês, sem gerar áudio.
  - Cloze `{{c1::texto::dica}}`.
  - MathJax `\(…\)` / `\[…\]`.
  - `[sound:arquivo.mp3]`.
  - Note type *Image Occlusion* nativo desde 23.10, útil para esquemas de circuitos (a criação via API ainda não foi avaliada).

### 6.2 AnkiConnect: estado atual e as duas APIs

**Histórico do repositório:** GitHub `FooSoft/anki-connect` (**arquivado**) → `git.foosoft.net/alex/anki-connect` (README de 2023-12) → **`git.sr.ht/~foosoft/anki-connect`** (README de 2025-11). O sr.ht tem proteção anti-bot, então não acessei. Li o código **26.11.15.0** a partir da cópia incluída nas *fixtures* de teste do `yanki-connect`: [`test/fixtures/anki-data-folder-26.11.15.0/addons21/2055492159/`](https://github.com/kitschpatrol/yanki-connect/tree/main/test/fixtures). Licença: **GPL-3.0**. Chamá-lo por HTTP não impõe obrigações ao nosso código.

- **Add-on:** código `2055492159`. Requer o **Anki desktop aberto**.
- **Config padrão** (`config.json`):

  ```json
  {"apiKey": null, "apiLogPath": null, "webBindAddress": "127.0.0.1",
   "webBindPort": 8765, "webCorsOriginList": ["http://localhost"], "ignoreOriginList": []}
  ```

  O `config.md` da 26.11.15.0 diz:
  - aplicações novas usam `POST http://127.0.0.1:8765/api/v1` com **JSON-RPC 2.0**;
  - as existentes continuam no endpoint legado `/` com `"version": 6`;
  - `apiKey` na v1 vai em `Authorization: Bearer <key>`; no legado, no campo `key` do corpo.
- **API v1** (schema `api-v1.schema.json` embutido em `contract.py`, decodificado e lido): **96 métodos**, entre eles:
  - descoberta e acesso: `api.describe`, `access.requestPermission`;
  - `profiles.*`;
  - `collection.sync` (assíncrono via `operations.get`), `collection.undo`;
  - `notes.get|getMany|search|validate|validateMany|create|createMany|update|delete`;
  - `tags.*`;
  - `cards.get|search|render|move|setSuspended|setFlags`;
  - `scheduling.get|getQueue|predict|getDue|answer|answerMany|setDueDate|reset`;
  - `decks.*`, `deckPresets.*`;
  - `noteTypes.create|update|editStructure|…`;
  - `media.store|get|list|delete`;
  - `reviews.list|getLatestId`;
  - `statistics.*`;
  - `packages.import|export`;
  - `advanced.cards.update`, `advanced.reviews.import`;
  - `api.execute` (lote de comandos), `operations.get|cancel`.

  | Limite | Valor |
  |---|---|
  | `maxRequestBytes` | 16 MiB |
  | `maxBatchItems` | **100** |
  | `maxPageSize` | 1.000 |
  | `maxMediaBytes` | 64 MiB |
  | Retenção de operações | 3.600 s |

  **Erros:** os códigos JSON-RPC padrão, mais `notFound` 1001, `validationFailed` 1002, `editorConflict` 1003, `collectionUnavailable` 1004, `staleSession` 1005, `unsupportedCapability` 1006, `cancelled` 1007, `conflict` 1008, `invalidState` 1009, `busy` 1010, `authenticationRequired` 1011, `ioError` 1012, `invalidSearch` 1013, `staleCursor` 1014, `vetoed` 1015 e `compatibilityError` 1016.

  **Semântica relevante:**
  - `notes.createMany` com `atomic:true` valida tudo (inclusive duplicatas internas) e usa `Collection.add_notes`. Se algo falhar, não altera nada.
  - `NoteInput` = `{noteType, deck, fields, tags, duplicates, rejectEmptyQuestions}`. **Não aceita GUID**, então a idempotência tem de vir de um **campo próprio** (`LH_ID`).
  - `advanced.reviews.import` importa revlog histórico sem mexer no agendamento.
  - `collection.sync` é uma operação: escolhas de *full sync* ficam em `waitingForUser`, e nunca dispare um segundo sync.
- **API legada v6** (README de 2023-10, [commit 1f7fc80](https://github.com/FooSoft/anki-connect/blob/1f7fc80b7e/README.md)):
  - `addNote`/`addNotes` (com `audio|video|picture` por `url|path|data`, `options.duplicateScope`), `canAddNotes`, `updateNoteFields`, `findNotes`, `notesInfo`;
  - `storeMediaFile` (prefixo `_` protege da limpeza), `createModel`, `createDeck`, `changeDeck`, `sync`;
  - `cardReviews`/`getReviewsOfCards`/`getLatestReviewID`, `insertReviews` (tuplas de 9 campos);
  - `exportPackage`/`importPackage` (dependem dos wrappers legados, frágeis desde o Anki 26.09);
  - `multi`, `requestPermission`.

  Origens fora de `webCorsOriginList` disparam um popup de permissão no Anki.
- **Cliente TS pronto:** [`yanki-connect`](https://github.com/kitschpatrol/yanki-connect) 5.3.1 (2026-11-17, MIT, sem dependências pesadas). Tipagem completa das **122 ações legadas** com tabela de compatibilidade por versão, além de `AnkiConnectUnreachableError` e auto-launch (só macOS). Ele **ainda não** suporta a API v1. Os testes rodam contra as fixtures do AnkiConnect 25.11.9.0, 26.10.14.0 e 26.11.15.0, no Anki 25.9.2, 26.8 e 26.9.4 (Linux, macOS e Windows).

**No Electron:** chame o AnkiConnect **do backend Node**. Assim não há CORS nem header `Origin`, então não é preciso mexer em `webCorsOriginList`. É o que o `lh-plugins-infra.md` §5.3 recomenda e o que o plugin *Flashcards* v2 do Obsidian faz desde a 2.0.1.

### 6.3 Gerar `.apkg` em JS/TS

| Biblioteca | Versão/data | Licença | Formato | Destaques | Contras |
|---|---|---|---|---|---|
| **`anki-apkg-export`** ([repo](https://github.com/repeat-space/anki-apkg-export); cópia em `_refs/extra/repeat-space__anki-apkg-export`) | **5.0.0 (2026-10-05)** | MIT | Legado `collection.anki2` (V11) | TS, Node ≥ 22.12, `sql.js` 1.14 + `jszip`. `basic`/`reversed`/`cloze`, *custom models* (`requiredFields`), subdecks `A::B`, mídia, **GUID estável via `noteId`**, batches transacionais, IDs de deck/modelo derivados do nome. **Importação testada contra Anki 26.09.3** | Sem agendamento/revlog; o GUID v5 difere do v4; tudo em memória |
| `ankipack` ([repo](https://github.com/ImGajeed76/ankipack)) | 0.3.1 (2026-09-08) | MIT | V18 (`anki21b`, zstd) | "todas as opções FSRS de deck" | 5 estrelas; projeto jovem |
| `genanki-js` ([repo](https://github.com/krmanik/genanki-js)) | 2.0.0 (2022) | AGPL-3.0+ | Legado | Porta do genanki | Parado desde 2023 |
| `genanki` (Python) ([repo](https://github.com/kerrickstaley/genanki)) | 2024-12 | MIT | Legado | Referência madura (2,8k ⭐) | Python |
| `sql.js` | 1.16.0 (2026-11-10) | MIT | — | SQLite WASM | Precisa servir `sql-wasm.wasm` |

Exemplo (anki-apkg-export v5):

```ts
import AnkiExport from 'anki-apkg-export';
const apkg = await AnkiExport.create('LearnHarness::Eletrônica', { locateFile: () => wasmPath });
try {
  const basic = apkg.addModel({ id: 1_700_000_001, name: 'LearnHarness Basic',
    fields: ['LH_ID', 'Front', 'Back', 'Source'], sortField: 'Front',
    templates: [{ name: 'Card 1', questionFormat: '{{Front}}',
      answerFormat: '{{FrontSide}}<hr id="answer">{{Back}}<div class="src">{{Source}}</div>',
      requiredFields: ['Front'] }] });
  apkg.addNotes(cards.map(c => ({
    fields: { LH_ID: c.id, Front: md2anki(c.front), Back: md2anki(c.back), Source: c.deepLink },
    modelId: basic, noteId: c.id, deck: `LearnHarness::${c.domainName}::${c.regionName}`,
    tags: [`lh::dom::${c.domainId}`, `lh::stage::${c.stage}`, `lh::node::${c.nodeId}`] })));
  for (const m of media) apkg.addMedia(m.filename, m.bytes);
  await writeFile(outPath, await apkg.save());
} finally { apkg.close(); }
```

### 6.4 Note types recomendados

| Note type | Campos | Template | Uso |
|---|---|---|---|
| `LearnHarness Basic` | `LH_ID` (1º campo = chave de duplicidade/idempotência, conforme recomendado pelo manual), `Front`, `Back`, `Source`, `Extra` | Front → Back; `Source` = deep link `learnharness://node/<id>` (ou `obsidian://`) | Padrão |
| `LearnHarness Cloze` | `LH_ID`, `Text` (`{{c1::…::dica}}`), `Extra`, `Source` | `{{cloze:Text}}` (modelo `type: cloze`) | Fórmulas e definições (Eletrônica) |
| `LearnHarness Reverse` | como Basic + template 2 | Back → Front | Vocabulário EN↔PT |
| `LearnHarness Type` | como Basic | `{{type:Back}}` | Ortografia (Inglês) |
| `LearnHarness EN Audio` | `LH_ID`, `Word`, `IPA`, `Meaning`, `Example`, `Source` | `{{Word}} {{tts en_US:Word}}` → `{{Meaning}}<br>{{Example}} {{tts en_US:Example}}` | Pronúncia sem arquivos de áudio |

**Conversão Markdown → HTML do Anki:**
- `markdown-it` ou `unified`/`remark`/`rehype`, como faz o `yanki`;
- `$…$` → `\(…\)` e `$$…$$` → `\[…\]`;
- código com highlight inline (Shiki gera HTML com estilos inline);
- Mermaid → SVG/PNG via mídia (o host ainda não expõe renderização Mermaid ao plugin, cf. `lh-plugins-infra.md` §5.3);
- imagens → `media.store` com nome = `sha1(conteúdo).ext`, o que dá deduplicação automática.

---

## 7. Flashcards (B): Obsidian

### 7.1 Panorama (downloads oficiais em [`community-plugin-stats.json`](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json), 2026-11-18)

| Plugin | Downloads | Última atualização | Licença | Modelo |
|---|---|---|---|---|
| **Spaced Repetition** (st3v3nmw) | **635.531** | 2026-06-14 (1.15.4) | MIT | Revisão **dentro** do Obsidian; SM-2-OSR **ou FSRS** (desde 1.14.2) |
| **Flashcards** (reuseman) | 79.489 | 2026-09-16 (2.2.0) | MIT | Obsidian → Anki (AnkiConnect); "Obsidian é dono do conteúdo, Anki do agendamento" |
| LearnKit | 29.838 | 2026-10-16 | MIT | FSRS-6 (`ts-fsrs`) + import/export Anki com `sql.js` WASM embutido |
| Yanki (kitschpatrol) | 16.109 | 2026-11-15 | MIT | 1 nota Obsidian = 1 nota Anki; pasta = deck; tipo inferido pela estrutura do Markdown |
| True Recall | 15.927 | 2026-11-14 | MIT | FSRS v6, **SQLite no vault**, mescla revisões concorrentes por **replay do log no FSRS**; `.apkg` in/out |
| Anki Sync (debanjandhar12) | 12.438 | **2021-11** | — | Abandonado |
| Decks (dscherdi) | 12.395 | 2026-11-12 | AGPL-3.0 | FSRS-6 + otimizador, importa `.apkg` **com histórico** |
| **Obsidian_to_Anki** | — | release 3.6.0 de **2024-01-24**; último push 2024-06 | GPL-3.0 | **Não aparece** no `community-plugins.json` atual |

### 7.2 Spaced Repetition (st3v3nmw): sintaxe e armazenamento

Docs em [`docs/docs/en/`](https://github.com/st3v3nmw/obsidian-spaced-repetition/tree/main/docs/docs/en).

**Cartões:**
- linha única `pergunta::resposta`;
- bidirecional `a:::b`;
- multilinha: pergunta / linha `?` / resposta; `??` para bidirecional.

**Cloze:**
- `==destaque==` (padrão);
- com dica: `==texto==^[dica]`;
- "clássico" numerado: `==x==[^1]`;
- opcionalmente `**negrito**` ou `{{chaves}}`.

**Decks:**
- tag `#flashcards` (padrão) e subtags `#flashcards/a/b`;
- uma tag vale para os cartões seguintes até a próxima tag;
- várias tags na mesma linha colocam o cartão em vários decks;
- também é possível usar pastas.

**Limitação importante:** por padrão, uma **linha em branco encerra** o cartão multilinha e o cloze. Para tabelas e matemática em bloco, é preciso configurar um marcador de fim (ex.: `+++`), e linhas em branco só são suportadas no **verso**.

**Agendamento gravado no próprio Markdown** (comentário HTML após o cartão):
- SM-2-OSR: `<!--SR:!2024-08-16,51,230-->` (vencimento, intervalo, ease);
- **FSRS** (PR [#1425](https://github.com/st3v3nmw/obsidian-spaced-repetition/pull/1425), merge em 2026-05-04, release 1.14.2 em 2026-05-13, usando `ts-fsrs` 5.4.2). Formato em `src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs.ts`:

  ```
  <!--SR:!fsrs,<dueISO>,<interval>,<stability>,<difficulty>,<state>,<reps>,<lapses>,<learningSteps>,<lastReviewISO|->-->
  ```

  A doc `algorithms.md` **ainda diz "FSRS: Planned"**, e o changelog confirma que a doc está desatualizada.
- Revisão de notas inteiras: frontmatter `sr-due`, `sr-interval`, `sr-ease`.
- Não há arquivo único de agendamento (issue #162).

**Avaliação:** é o padrão de fato no Obsidian (635k downloads) e tem FSRS. Mas guarda o estado no texto, sem revlog. Não é um bom lugar para a fonte da verdade.

### 7.3 Obsidian_to_Anki (para referência)

Sintaxe ([wiki](https://github.com/ObsidianToAnki/Obsidian_to_Anki/wiki)):
- blocos `START` / `<Note Type>` / campos (`Back: …`) / `Tags: …` / `END`;
- inline `STARTI [Basic] pergunta Back: resposta ENDI`;
- deck por arquivo `TARGET DECK: Matemática`;
- `FILE TAGS: …`;
- apagar com `DELETE` + `ID: 123…`;
- "CurlyCloze" `{c1:x}` → `{{c1::x}}`;
- grava `<!--ID: 1566052191670-->` de volta no Markdown.

**Status:** parado desde 2024 e exige configurar `webCorsOriginList` com `app://obsidian.md`. **Não recomendado.**

---

## 8. Recomendação de arquitetura (Anki + Obsidian + FSRS interno)

### 8.1 Princípios

1. **Fonte da verdade = o app.** Conteúdo (proposição → cues), estado FSRS e **revlog append-only** ficam no plugin `flashcards`, hoje `flashcards.json` com escrita atômica. O estado FSRS é **função do log**: $state = \mathrm{replay}(\text{revlog})$. É isso que permite mesclar revisões de várias origens. True Recall e Decks usam a mesma ideia.
2. **Conteúdo flui para fora; revisões fluem para dentro.** Edições feitas no Anki/Obsidian **não** voltam (unidirecional, como o *Flashcards* v2 do Obsidian). Revisões feitas no Anki **voltam** via revlog.
3. **Um único cliente de revisão por domínio.** Configuração `reviewClient: 'app' | 'anki'`:
   - com `'anki'`, a fila interna esconde os cartões exportados e mostra "revisados no Anki";
   - com `'app'`, a exportação ao Anki é opcional e pode criar os cartões **suspensos** (só consulta).

   Isso evita a dupla revisão citada em `lh-plugins-infra.md` §5.2.
4. **Obsidian = espelho legível** (nota de sessão + cartões), regenerável, **sem** comentários `<!--SR:…-->`. Assim nenhum outro plugin assume o agendamento por acidente. Quem quiser revisar no Obsidian pode habilitar uma opção explícita "permitir que o Spaced Repetition agende" (os dados dele não voltam).

### 8.2 Modelo de dados (extensão do plugin `flashcards`)

```ts
// plugins/flashcards/src/sync-types.ts (proposta)
interface ExternalLink {
  cueId: string; propositionId: string; domainId: string;
  anki?: { noteId: string; cardIds: string[]; noteType: string; deck: string;
           contentHash: string; pushedAt: number; mtime: number };
  obsidian?: { path: string; anchor: string; contentHash: string; writtenAt: number };
}
interface RevlogEntry {                 // append-only; também alimenta o learner model (r2 §9.3, peso 0,3)
  id: string;                           // 'app:<uuid>' | 'anki:<revlogId>'
  propositionId: string; cueId: string; at: number; rating: 1 | 2 | 3 | 4;
  durationMs: number; origin: 'app' | 'anki';
}
interface SyncCursor { ankiLatestRevlogId?: string; ankiProfile?: string; apiFlavor?: 'v1' | 'v6' }
```

### 8.3 Push para o Anki (idempotente, v1 com fallback v6)

```ts
// plugins/flashcards/src/export/anki-connect.cjs (proposta)
async function detectApi(base = 'http://127.0.0.1:8765', key?: string) {
  try {
    const r = await rpc(base, 'api.describe', {}, key);               // v1
    if (r.ok) return { flavor: 'v1' as const, methods: r.result.methods };
  } catch (e) { if (isUnreachable(e)) throw new AnkiUnreachable(); }
  const v = await legacy(base, 'version', {}, key);                   // legado
  if (v.result >= 6) return { flavor: 'v6' as const };
  throw new Error('AnkiConnect sem API compatível');
}

async function pushCues(cues: Cue[], api) {
  await ensureNoteTypes(api);                    // noteTypes.list/create ou modelNames/createModel
  for (const chunk of chunks(cues, 100)) {       // maxBatchItems = 100
    const existing = await findByLhId(api, chunk.map(c => c.id));   // notes.search 'LH_ID:"<id>"' (v1) | findNotes (v6)
    const toCreate = chunk.filter(c => !existing.has(c.id));
    const toUpdate = chunk.filter(c => existing.has(c.id) && hash(c) !== link(c).anki?.contentHash);
    if (toCreate.length) await createMany(api, toCreate, { atomic: true });   // v1: notes.createMany | v6: addNotes
    for (const c of toUpdate) await updateNote(api, existing.get(c.id)!, c); // v1: notes.update | v6: updateNoteFields
    await storeMedia(api, mediaOf(chunk));       // media.store | storeMediaFile, nome = sha1.ext
  }
  if (settings.ankiAutoSync) await startSync(api);  // collection.sync + operations.get | sync
}
```

**Detalhes que importam:**
- **Deck:** `LearnHarness::<Domínio>::<Região>`. Tags hierárquicas `lh::dom::<id>`, `lh::stage::<s>`, `lh::node::<id>`, `lh::session::<data>`.
- **Proposição em vários decks do app:** no Anki o cartão fica num **deck primário** (o deck de origem, conforme `flashcards-vision.md`). As demais filiações viram **tags** `lh::deck::<id>`.
- **Proposição com vários cues:** cada cue vira uma nota no Anki. Ao importar revisões, o revlog do cue alimenta o **FSRS da proposição** (o modelo do plugin).
- **Anki fechado:** fila de pendências com retry; botão "Abrir Anki" (Windows: `%LOCALAPPDATA%\Programs\Anki\anki.exe`, o mesmo caminho usado pelo *Flashcards* v2); timeout de 60 s.
- **Perfil do Anki:** gravar `ankiProfile` no cursor e recusar *push* se o perfil ativo for outro (`profiles.getActive`).
- **Segurança:** só `127.0.0.1`; se o usuário configurar `apiKey`, guardar no cofre de segredos do app e enviar como `Authorization: Bearer` (v1).

### 8.4 Pull de revisões do Anki → replay FSRS

```ts
async function pullAnkiReviews(api, cursor: SyncCursor) {
  const linkedCardIds = allLinks().flatMap(l => l.anki?.cardIds ?? []);
  const reviews = api.flavor === 'v1'
    ? await pagedReviewsList(api, { cardIds: linkedCardIds, afterId: cursor.ankiLatestRevlogId })  // reviews.list
    : await legacyGetReviewsOfCards(api, linkedCardIds, cursor.ankiLatestRevlogId);                // getReviewsOfCards
  const fresh = reviews.filter(r => !revlogHas(`anki:${r.id}`) && r.type !== 'manual');
  appendRevlog(fresh.map(r => ({ id: `anki:${r.id}`, at: r.id /* ms epoch */, rating: r.ease,
    durationMs: Math.min(r.time, 60_000), origin: 'anki', ...mapCardToCue(r.cardId) })));
  for (const pid of affectedPropositions(fresh)) {
    const history = revlogFor(pid).sort(byTime).map(e => ({ rating: e.rating, reviewTime: new Date(e.at) }));
    const { memoryState } = reschedule.replay({ history });   // ts-fsrs 6: Reschedule.replay
    setPropositionState(pid, memoryState);                    // + emite ProgressEvent 'review' (origin 'anki')
  }
  cursor.ankiLatestRevlogId = maxId(reviews);
}
```

- Hoje o `plugins/flashcards` porta o FSRS-6 do `ts-fsrs@5.2.3`, sem dependência de runtime. O replay pode ser feito com o próprio `rate()` do `scheduler.cjs`, aplicado em ordem ao histórico. O `ts-fsrs` 6 é a alternativa com o `Reschedule` pronto (MIT; exige Node ≥ 24; o Electron 44 traz Node 24).
- O Anki agenda com **FSRS-6 por cartão**; o app agenda **por proposição**. As datas de vencimento **vão divergir**, e isso é aceitável quando só um cliente revisa (§8.1 item 3).
- Com `reviewClient='anki'`, o vencimento exibido no app vem do Anki (`scheduling.get` na v1, `cardsInfo` na v6) e serve só para estatística. A memória do learner model vem do replay.

### 8.5 Escrita no vault Obsidian

**Arquivo por sessão:** `<vault>/<pasta>/<Domínio>/<AAAA-MM-DD> <título da sessão>.md`. Escrita atômica, merge por âncora `lh:` (nunca sobrescrever trechos editados pelo usuário fora dos blocos gerenciados).

```markdown
---
lh_session: 2026-11-18T14:03:00-03:00
lh_domain: eletronica
lh_nodes: [lei-de-ohm, kvl]
tags: [flashcards/eletronica/circuitos-dc]
---
# Leis de Kirchhoff

Resumo de 3–5 linhas da sessão (gerado), com links [[Lei de Ohm]] para notas de nó.

## Cartões
<!-- lh:begin cards (gerado pelo LearnHarness; edições aqui serão substituídas) -->
Qual é a soma das tensões ao longo de uma malha fechada?
?
Zero: $\sum_k v_k = 0$ (KVL).
<!--lh:id=prop_8f2c/cue_1-->

Em um nó, a soma das correntes que ==entram== é igual à soma das que ==saem==.
<!--lh:id=prop_91aa/cue_2-->
<!-- lh:end cards -->
```

**Regras de serialização:**
- sempre o formato **multilinha** com `?`, porque `::` quebra com C++ `std::` e com URLs;
- **sem linhas em branco** dentro de um cartão (tabelas e blocos `$$` viram uma única linha, ou vão como imagem);
- o ID vai em comentário HTML, invisível no modo leitura;
- cloze só com `==…==`;
- nada de `<!--SR:…-->`.

**Notas de nó** (opcional): `<vault>/<Domínio>/Nós/<nome>.md`, com frontmatter `lh_node`, `stage`, `region`, links para pré-requisitos e o histórico de sessões. Isso dá ao Obsidian um "segundo cérebro" navegável pelo Graph/Canvas.

### 8.6 Fluxo de fim de sessão (meta 4)

1. O professor encerra a sessão.
2. O backend espera a extração do grafo concluir. `turn-settled` ≠ extração concluída (ver `lh-plugins-infra.md` §5.6).
3. Seleciona as proposições com `provenance.chatId === sessão` e reusa `pack()`/`start-generation` do plugin para gerar **cues que faltam** (geração aditiva, conforme `flashcards-vision.md`).
4. Mostra o **card de fim de sessão**, no máximo 4 linhas, sem texto explicativo:
   - "+86 XP · 52 min";
   - "6 cartões novos" (botões *Ver* / *Desfazer*);
   - "Próxima revisão: amanhã, 12 itens";
   - selo de região, se houver.
5. Exportações assíncronas e silenciosas:
   - Obsidian: escreve na hora;
   - Anki: *push* se acessível, senão fica na fila.

   Erros aparecem como um ponto discreto no ícone de sincronização.

> Isso muda a decisão do v1 ("no automatic generation", "No Anki integration", em `docs/flashcards-vision.md`). Como o fork é nosso e a meta 4 pede cartões ao fim de cada sessão, é uma **decisão de produto a registrar**. Mantenha um toggle por domínio, "gerar cartões ao fim da sessão", ligado por padrão.

### 8.7 Comparação final: Anki vs Obsidian para o nosso caso

| Critério | Anki (+AnkiConnect) | Obsidian (+Spaced Repetition) |
|---|---|---|
| Algoritmo | FSRS-6 nativo (`fsrs-rs` 6.6.2), otimizador e simulador | FSRS via `ts-fsrs` desde 2026-05 (novo), ou SM-2-OSR |
| Revlog | Sim (tabela `revlog`; `reviews.list`) | **Não** (só o estado no comentário) |
| Mobile | AnkiDroid (grátis) / AnkiMobile + AnkiWeb | Depende de sincronizar o vault |
| API | **API v1 JSON-RPC** com lote atômico, operações e `api.describe` | Nenhuma; manipulação de arquivo |
| Riqueza do cartão | HTML/CSS, TTS, cloze, Image Occlusion, `type:` | Markdown nativo, wikilinks, Mermaid, Canvas |
| Robustez da integração | Exige o Anki desktop aberto + add-on de terceiro (GPL, mantido; repo migrou duas vezes) | Só escrever arquivo; não depende de processo |
| Papel recomendado | **Cliente de revisão opcional** (bidirecional para revisões) | **Espelho legível** + notas de sessão/nó |

**Veredito:** o "mais high-tech e robusto" para revisar é o **Anki**, por causa do revlog, do FSRS oficial, do mobile e da API v1. O **Obsidian** é o melhor lugar para o conhecimento ficar **legível e conectado**. Faça **ambos**, com o FSRS interno como fonte da verdade, nesta ordem: (1) Obsidian (barato, sem dependência); (2) AnkiConnect v1/v6; (3) `.apkg`/TSV como fallback de arquivo.

---

## 9. Plano de implementação sugerido

| Fase | Entregas | Testes |
|---|---|---|
| **F1: núcleo de progresso** | `src/core/progress/*` (XP, níveis, Elo, tiers, streak) + ledger JSONL + `ctx.progress.record` | Invariantes I1–I7 (property-based, `fast-check` ou `node:test` com PRNG); soft cap; idempotência |
| **F2: calibração** | `scripts/calibrate-progression.ts` (porte do Apêndice A, seed fixa) → `config/progression.json`; job mensal de recalibração pessoal | Snapshot dos quantis com seed fixa; restrições da §5.4 como asserts |
| **F3: UI mínima** | Emblema de tier (SVG cel-shaded), barra de nível, card de fim de sessão, chama do streak semanal, badges no mapa do grafo | Testes de render (`linkedom`), cópia ≤ 1 linha por elemento |
| **F4: Obsidian** | `plugins/flashcards/src/export/obsidian.cjs` (nota de sessão + cartões, merge por âncora) | Vault temporário; round-trip; `::` em código; sem linhas em branco |
| **F5: Anki push** | `export/anki-connect.cjs` (detectApi v1→v6, note types, createMany em lotes de 100, mídia, sync opcional) | Servidor HTTP falso em loopback emulando v1 e v6 (erros 1004/1010/1011) |
| **F6: Anki pull** | `import/anki-reviews.cjs` + replay FSRS + `ProgressEvent` de revisão | Replay determinístico (golden); idempotência por `revlogId` |
| **F7: `.apkg`/TSV** | `export/apkg.cjs` com `anki-apkg-export@5` (dependência **do plugin**, bundlada; WASM em `dist/assets`) + TSV com `#guid column`/`#notetype` | Importar num perfil Anki descartável (manual/CI opcional, como o `test:anki` do próprio anki-apkg-export) |
| **F8: liga opt-in** | "Eu vs. Eu" + "Coorte simulada" (amostrada do MC) | Distribuição dos rivais = quantis do MC |

---

## 10. Riscos e questões em aberto

1. **Horizonte sem evidência.** Nenhuma meta-análise cobre mais de 6 meses. Instrumente desde o dia 1: XP/h, sessões por semana, retenção, uso de badges/ligas. Use **temporadas** como teste A/B pessoal (ex.: liga ligada vs. desligada por temporada).
2. **Medição de tempo ativo** é o ponto fraco do "XP = tempo". O detector de ociosidade precisa ser robusto: foco da janela, input, vídeo tocando, aula IA em streaming. Os limites de $1{,}5\,T_{esperado}$ protegem contra fraude, mas também podem sub-creditar alunos lentos. Calibre $T_{esperado}$ pela mediana **pessoal**.
3. **Núcleo canônico vs. expansão procedural.** O núcleo precisa ser definido **antes** (r3) e versionado. Sem isso, os tiers ficam instáveis.
4. **Peso FSRS de flashcard aplicado a nós conceituais** (simulação e learner model): recalibrar com o otimizador por domínio (r2 §9.12).
5. **AnkiConnect:** o repositório migrou duas vezes; a API v1 é nova (26.x) e o próprio schema diz que a verificação de GUI e sync está incompleta. Mantenha o fallback v6 e o `.apkg`. O `importPackage` legado depende de wrappers marcados para remoção desde o Anki 26.09; prefira `packages.import` (v1).
6. **Dupla revisão** se o usuário revisar no app **e** no Anki apesar do `reviewClient`. O replay do log mescla corretamente a memória, mas as datas de vencimento podem confundir. A UI precisa deixar claro quem é o cliente de revisão.
7. **Obsidian Spaced Repetition** grava o estado no texto. Se o usuário habilitar agendamento no Obsidian, cartões editados pelo app podem perder o comentário SR (por isso a regra "não escrever SR" + opção explícita).
8. **Liga com coorte simulada** pode parecer artificial. Mantenha o rótulo explícito e desligado por padrão.
9. **Decisão de produto do v1** (sem Anki, sem geração automática) precisa ser formalmente revista com o humano. Este relatório recomenda mudar.

---

## Apêndice A. Código da simulação (resumo do `sim.mjs`)

Script completo: `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\r7\scripts\sim.mjs` (Node, sem dependências; `node sim.mjs <N> <dias> <seed> <escala>`; env `DR`, `Q`). Núcleo, para portar para `scripts/calibrate-progression.ts`:

```js
// FSRS-6 (pesos default, mesmos de plugins/flashcards/src/scheduler.cjs)
const W=[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542];
const DECAY=-W[20], FACTOR=0.9**(1/DECAY)-1;
const R=(t,S)=>(1+FACTOR*t/S)**DECAY;
const D0=g=>clamp(W[4]-Math.exp(W[5]*(g-1))+1,1,10);
const nextD=(D,g)=>{const d1=D+(-W[6]*(g-3))*(10-D)/9; return clamp(W[7]*D0(4)+(1-W[7])*d1,1,10);};
const sRecall=(D,S,r,g)=>S*(1+Math.exp(W[8])*(11-D)*S**(-W[9])*(Math.exp(W[10]*(1-r))-1)*(g===2?W[15]:1)*(g===4?W[16]:1));
const sForget=(D,S,r)=>Math.min(S,W[11]*D**(-W[12])*((S+1)**W[13]-1)*Math.exp(W[14]*(1-r)));
const interval=(S,dr=0.9)=>Math.max(1,Math.round(S/FACTOR*(dr**(1/DECAY)-1)));

// Um aluno, um dia (esqueleto)
budget = vacation||rnd()<pSkip ? 0 : H*60*lognMean1(0.3);
for (id of dueToday ∪ backlog) {                      // 1) revisões vencidas
  if (budget < 3) { keep in backlog; continue; }
  r = R(day-last[id], S[id]); ok = rnd() < r; cost = 3 + (ok?0:6);
  xp += softCap(cost, gReview(r)*(ok?1:0.8)); budget -= cost;
  g = ok ? sample({3:.8,4:.1,2:.1}) : 1;
  S[id] = ok ? sRecall(D[id],S[id],r,g) : sForget(D[id],S[id],r); D[id] = nextD(D[id],g);
  last[id] = day; schedule(id, day + interval(S[id], DR));
}
while (budget > 0 && frontierAvailable()) {           // 2) nós novos (fronteira)
  progress current node; when done: pass = rnd() < 0.9;
  xp += softCap(nodeTime, pass ? 1 : 0.25);
  if (pass) { learn(id); S=W[2]; D=D0(3); schedule(id, day+interval(S)); } else retry with +30% time;
}
if (day % 7 === 6) evaluateTiers();                     // 3) retido = R>=0.7; estágio ok se ≥ q do núcleo
```

Saída de referência: `...\scratchpad\r7\data\sim_final.txt` (N=400/perfil, 1.000 dias, seed 7, escala 0,82). As tabelas da §5 vêm desse arquivo e das execuções de sensibilidade com N=200.

---

## Referências (fontes lidas)

**Gamificação e motivação**
- Sailer & Homner 2020: https://doi.org/10.1007/s10648-019-09498-w (PDF: https://link.springer.com/content/pdf/10.1007/s10648-019-09498-w.pdf)
- Bai, Hew & Huang 2020: https://doi.org/10.1016/j.edurev.2020.100322
- Zeng et al. 2024: https://doi.org/10.1111/bjet.13471
- Li, Ma & Shi 2024: https://doi.org/10.1007/s11423-023-10337-7
- Huang et al. 2020: https://doi.org/10.1007/s11423-020-09807-z
- Hamari, Koivisto & Sarsa 2014: https://doi.org/10.1109/HICSS.2014.377
- Dichev & Dicheva 2017: https://doi.org/10.1186/s41239-017-0042-5
- Sailer, Hense, Mayr & Mandl 2017: https://doi.org/10.1016/j.chb.2016.12.033
- Mekler et al. 2017: https://doi.org/10.1016/j.chb.2015.08.048
- Landers, Bauer & Callan 2017: https://doi.org/10.1016/j.chb.2015.08.008
- Christy & Fox 2014: https://doi.org/10.1016/j.compedu.2014.05.005
- Hanus & Fox 2015: https://doi.org/10.1016/j.compedu.2014.08.019
- Toda, Valle & Isotani 2018: https://doi.org/10.1007/978-3-319-97934-2_9
- Deci, Koestner & Ryan 1999: https://doi.org/10.1037/0033-2909.125.6.627
- Silverman & Barasch 2023: https://doi.org/10.1093/jcr/ucac029
- Wilson et al. 2019 (85% rule): https://doi.org/10.1038/s41467-019-12552-4
- Kivetz, Urminsky & Zheng 2006: https://doi.org/10.1509/jmkr.43.1.39
- Nunes & Drèze 2006: https://doi.org/10.1086/500480
- Dai, Milkman & Riis 2014: https://doi.org/10.1287/mnsc.2014.1901
- Duolingo:
  - https://blog.duolingo.com/improving-the-streak/
  - https://blog.duolingo.com/how-duolingo-streak-builds-habit/
  - https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/
  - https://blog.duolingo.com/duolingo-leagues-leaderboards/
- Math Academy FAQ: https://www.mathacademy.com/faq

**Ratings**
- Pelánek 2016: https://doi.org/10.1016/j.compedu.2016.03.017 (preprint: https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf)
- Klinkenberg et al. 2011: https://doi.org/10.1016/j.compedu.2011.02.003
- Glicko-2: http://www.glicko.net/glicko/glicko2.pdf

**Anki**
- Releases: https://github.com/ankitects/anki/releases
- `meta.rs`: https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs
- `import_export.proto`: https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto
- `notes.rs`: https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/apkg/import/notes.rs
- Manual: https://github.com/ankitects/anki-manual (`src/importing/text-files.md`, `src/templates/fields.md`, `src/importing/packaged-decks.md`)
- AnkiConnect:
  - https://git.sr.ht/~foosoft/anki-connect (atual)
  - https://github.com/FooSoft/anki-connect (arquivado; README v6 no commit `1f7fc80`)
  - código 26.11.15.0 lido em https://github.com/kitschpatrol/yanki-connect/tree/main/test/fixtures
  - add-on https://ankiweb.net/shared/info/2055492159
- `yanki-connect`: https://github.com/kitschpatrol/yanki-connect · `yanki`: https://github.com/kitschpatrol/yanki
- `anki-apkg-export` v5: https://github.com/repeat-space/anki-apkg-export · npm https://www.npmjs.com/package/anki-apkg-export
- `ankipack`: https://github.com/ImGajeed76/ankipack · `genanki-js`: https://github.com/krmanik/genanki-js · `genanki`: https://github.com/kerrickstaley/genanki
- `ts-fsrs` 6 (Reschedule/replay): https://github.com/open-spaced-repetition/ts-fsrs (cópia em `_refs/extra/open-spaced-repetition__ts-fsrs`, `docs/src/snippets/run-code/api/ts-fsrs/reschedule.ts`)

**Obsidian**
- Estatísticas:
  - https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json
  - https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json
- Spaced Repetition:
  - repo: https://github.com/st3v3nmw/obsidian-spaced-repetition
  - PR FSRS: https://github.com/st3v3nmw/obsidian-spaced-repetition/pull/1425
- Obsidian_to_Anki: https://github.com/ObsidianToAnki/Obsidian_to_Anki (wiki: https://github.com/ObsidianToAnki/Obsidian_to_Anki/wiki)
- Flashcards (reuseman): https://github.com/reuseman/flashcards-obsidian · Yanki: https://github.com/kitschpatrol/yanki-obsidian
- LearnKit: https://github.com/ctrlaltwill/learnkit · Decks: https://github.com/dscherdi/decks · True Recall: https://github.com/pieralukasz/true-recall

**Contexto interno**
- `docs/flashcards-vision.md`
- `docs/flashcards-implementation-plan.md`
- `plugins/flashcards/src/{store,scheduler,backend}.cjs`
- `docs/research/r2-knowledge-tracing-srs-kst.md`
- `docs/research/lh-plugins-infra.md` (§0, §5)
