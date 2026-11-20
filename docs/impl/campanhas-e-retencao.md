# Campanhas, progressão e evidência de aprendizagem

## Percurso de qualquer domínio

Em **Hoje**, o aluno vê o capítulo atual, a próxima habilidade disponível e a missão final. Os marcos abrem habilidades da própria árvore. É possível visitar um capítulo posterior pelo mapa e retomar o percurso principal. As seis etapas de Inglês usam os marcos CEFR de autoria. Nos demais domínios, a campanha lê os níveis da árvore e usa as unidades como capítulos quando há um único nível.

Árvores antigas podem atribuir um nível básico a uma tarefa que exige uma unidade avançada. O planejador posiciona a tarefa na primeira etapa em que pelo menos um caminho completo de pré-requisitos pode ser satisfeito. Essa projeção usa os IDs originais e mantém o histórico do aluno. A aula de uma missão selecionada começa com o professor e seu objetivo. A sondagem inicial continua disponível nas conversas abertas.

No teste em Chrome, um aluno de Eletrônica recebeu inicialmente uma questão sobre como converter 0,00047 A antes da explicação. Após corrigir a abertura das missões, o GPT-6.2-sol apresentou primeiro o exemplo de 0,0047 A, relacionando milésimos de ampere ao expoente negativo. Para repetir a navegação em uma instância isolada, use `node scripts/smoke-study-campaigns.mjs http://127.0.0.1:PORTA dominio1 dominio2` com domínios instalados e um perfil inicial. Acrescente `--teach` para abrir uma aula com o modelo configurado no último domínio.

## Escolha de extensão

Na criação de um domínio, o aluno escolhe a dedicação que deseja planejar. A interface começa com a campanha extensa e informa a faixa de habilidades antes da geração.

| Opção | Calendário | Horas de referência | Regiões | Habilidades |
| --- | --- | ---: | ---: | ---: |
| Focada | 12 semanas, 3 dias de 60 min | 36 | 4–8 | 16–112 |
| Intermediária | 32 semanas, 4 dias de 90 min | 192 | 12–18 | 72–252 |
| Extensa | 60 semanas, 5 dias de 120 min | 600 | 24–32 | 216–448 |

Essas faixas são escolhas de produto. O gerador reparte a carga de referência entre regiões, aceita uma variação local de 25% e verifica a soma das aulas e da prática adicional. Uma habilidade recebe uma primeira atividade de 10–45 minutos. A prática distribuída precisa especificar quantas sessões, quantos minutos por sessão, o que varia e o critério de saída. A tela de conclusão mostra as horas efetivamente planejadas em cada categoria. Horas trabalhadas pelo aluno são medidas separadamente. A estimativa de dedicação, por si só, não permite prever o tempo individual até fluência.

## Quando uma campanha pode ser instalada

1. O modelo parte de um desempenho final observável. Cada região posterior identifica um desempenho de entrada da etapa anterior, diretamente ou por um ramo paralelo da própria etapa. Toda região participa de pelo menos uma saída da etapa final.
2. Cada região tem uma demonstração final. O validador percorre os pré-requisitos no sentido inverso e identifica pelo ID qualquer habilidade central que ficou de fora. Dois fundamentos podem ser estudados em paralelo e convergir em um projeto.
3. Nas três opções de dedicação, uma segunda chamada ao modelo escolhido examina, em contexto separado, os pré-requisitos declarados, os objetivos, as atividades, o critério de saída e as chaves das revisões. Um parecer com falha concreta identifica a habilidade e pede uma revisão regional. Se a falha persistir, o instalador recusa o conjunto antes de gravar o domínio. O revisor usa o mesmo modelo do autor e pode compartilhar seus erros.
4. O ledger valida as **rotas efetivas**, inclusive requisitos herdados. Em ordem topológica, um conjunto de requisitos simultâneos garante a maior etapa alcançada por seus membros. Entre rotas alternativas vale a menor garantia. Uma folha só pode avançar uma etapa além da entrada garantida. Há verificações separadas para inversões, cobertura do objetivo e saída regional única. O contrato acompanha as campanhas geradas e seus patches. Árvores autorais anteriores continuam sob seu contrato original.
5. Os objetivos finais ficam associados ao perfil. O planejador combina a campanha com revisão e reforço opcional. No mapa, o aluno pode abrir uma aula avulsa em uma região avançada e consultar a rota que o levaria até ela.

Um arco pedagogicamente errado pode formar um grafo perfeitamente consistente. Em um estudo sobre o conceito matemático de função, os pesquisadores contrastaram a ordem hipotética de competências com respostas dos alunos. Falmagne e colaboradores avaliaram se o estado inferido previa o desempenho em problemas reservados. Essas abordagens motivam o uso de tarefas independentes e a distinção entre validação estrutural e validação com alunos. [Estudo de progressão em funções](https://onlinelibrary.wiley.com/doi/10.1002/ets2.12257) · [Estudo com 210.102 avaliações](https://www.aleks.com/paper_psych/Validity_in_L_Spaces.pdf)

## Como o professor acompanha o aluno

O mapa mostra quantas habilidades o aluno alcançou no percurso. Ao concluir uma etapa, o planejador continua agendando revisões das anteriores. A escolha de pedir uma resposta sem consulta em outra sessão se apoia em um experimento com vocabulário de língua estrangeira que encontrou melhor recordação tardia após prática de recuperação. O benchmark do app verifica o agendamento e a continuidade do percurso. Medir o ganho do aluno exige observar respostas em sessões posteriores. [Karpicke e Roediger, 2008](https://doi.org/10.1126/science.1152408)

Em uma saída de região, a aula recebe o critério de avaliação e o plano de prática. O professor pode oferecer uma leitura, um trecho de vídeo ou um exemplo resolvido, retirar uma etapa da solução e pedir uma aplicação nova. O aluno pode seguir direto. Essa gradação tem apoio experimental em tarefas de resolução de problemas. A vantagem medida depende da tarefa e do tipo de transferência. [Renkl e colaboradores](https://www.tandfonline.com/doi/abs/10.1080/00220970209599510)

Cada região gerada com dedicação definida reserva dois casos curtos. Em uma aula de domínio preexistente, o professor pode chamar `prepare_review`. Um autor separado recebe a competência e o critério de saída, usa o orçamento configurado e pode indicar que a tarefa exige avaliação por desempenho. O professor recebe uma confirmação. A pergunta aparece em **Hoje** após pelo menos 24 horas desde a exposição e a última evidência relevante. Cada caso só admite uma tentativa pontuada. O gabarito fica no servidor e a resolução aparece depois da resposta.

A autoavaliação continua informando o planejamento. Para o selo de domínio, o histórico precisa satisfazer o limiar de proficiência, conter pelo menos duas famílias de acertos objetivos e incluir produção independente posterior, com nota máxima, sem pista e confiança do avaliador superior a 0,5. O mapa mostra quando houve essa recuperação. O recálculo pode reclassificar selos antigos sustentados por autoavaliação ou reconhecimento. IDs de nós, respostas gravadas e XP são preservados. O intervalo de 24 horas é um parâmetro da aplicação. Para escrita, conversação, projeto ou investigação, o tutor também pede a produção real e discute os critérios. O corretor de respostas curtas aceita apenas as grafias previstas, com normalização de espaços e Unicode.

Soderstrom e Bjork descrevem por que a melhora durante uma sessão pode divergir da retenção. Nos experimentos de Butler, a avaliação incluiu questões inferenciais novas depois de um intervalo. Esses trabalhos sustentam a escolha dos desfechos, mas não calibram os limiares numéricos do aplicativo. [Learning Versus Performance](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/11/soderstorm_ra_learningvsperformance.pdf) · [Experimentos de transferência](https://andymatuschak.org/files/Butler%20-%202010%20-%20Repeated%20Testing%20Produces%20Superior%20Transfer%20of%20Learning%20Relative%20to%20Repeated.pdf)

## Laboratório e pesquisa

O professor usa `study_activity` para abrir um divisor resistivo sem carga, parametrizar tensão e resistores, obter a saída e a corrente e discutir a medição escolhida pelo aluno. O painel exporta o circuito editável para Falstad e um arquivo de ponto de operação `.cir` para LTspice. Também abre três experimentos do CircuitJS com controles próprios de frequência, amortecimento e ondulação. Em um estudo de laboratório de corrente contínua, Finkelstein e colaboradores avaliaram simulação e equipamento físico com tarefas posteriores. A integração oferece a sequência prever, variar e medir. [Estudo experimental](https://journals.aps.org/prper/abstract/10.1103/PhysRevSTPER.1.010103) · [Interface de medição CircuitJS](https://www.falstad.com/circuit/doc/js-interface.html)

A ferramenta `research` já encaminhava perguntas para um pesquisador separado, com busca configurável e leitura de páginas e PDFs. O professor deve aguardar a fonte para usar a afirmação pesquisada. Sem motor de busca configurado, a leitura de uma URL conhecida continua disponível. No smoke, a própria ferramenta `web_fetch` recuperou a documentação pública de medição do CircuitJS. O teste não usou credenciais pessoais para realizar busca aberta. As implementações locais consultadas foram o grafo do [Open Mastery](https://github.com/bxxd/open-mastery/blob/2b6c156dbc9c96d6c95d6771ab88408ef15b1035/engine/crates/core/src/graph.rs) e o [leitor de circuitos do CircuitJS](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/CirSim.java).

## Benchmarks reproduzíveis

Execute `node --import tsx scripts/benchmark-campaign.ts` e `node --import tsx scripts/benchmark-study-marathon.ts` com `LH_DATA_DIR` e `LH_AUTH_FILE` temporários. Os ensaios usam dados públicos ou sintéticos. O gerador, o ledger, o algoritmo de progresso e o planejador são os da aplicação. As respostas do autor e do revisor no benchmark são roteirizadas.

| Campanha sintética | Regiões | Habilidades | Horas planejadas | Casos reservados | Rotas alternativas válidas aceitas | Mutações detectadas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Focada | 8 | 32 | 34,7 | 16 | 6/6 | 20/20 |
| Intermediária | 16 | 128 | 194,7 | 32 | 12/12 | 40/40 |
| Extensa | 32 | 448 | 597,3 | 64 | 28/28 | 88/88 |

O controle estrutural manteve os validadores anteriores ativos e retirou apenas o contrato de campanha. Ele aceitou as 148 mutações acíclicas. Em 56 casos, uma habilidade deixou de contribuir para a saída. Outros 56 introduziram uma rota local que dispensava um fundamento, apesar de ele continuar ligado ao projeto por outra rota. Os 36 restantes pularam uma etapa inteira. As três árvores originais e as 46 alternativas legítimas passaram com o contrato ativo. O ensaio mede essas famílias específicas de defeitos.

Em 144 históricos pareados, cada aluno sintético acertou seis vezes. A condição positiva variou datas, usou duas famílias e exigiu produção espaçada. Os 24 históricos positivos alcançaram domínio. Nas cinco condições de controle, treino concentrado, pistas, reconhecimento, autoavaliação ou uma família única, nenhum dos 120 alcançou o selo.

Para avaliar a próxima hipótese, de que a revisão semântica melhora árvores reais, congele um conjunto de temas, modelos e orçamentos antes de gerar as árvores. Compare, por tema, versões com e sem a segunda leitura. Dois professores que desconheçam a versão podem tentar cada atividade usando apenas o conhecimento disponível na sua rota, anotar a primeira operação sem fundamentação e marcar requisitos dispensáveis. Conte bloqueios por 100 habilidades, registre divergências, tempo e custo de geração. Para medir aprendizagem, contrabalanceie as condições, aplique um pré-teste e avalie uma situação nova após uma semana por rubrica. Agregue por aluno e por tema, preservando as tentativas incompletas. Esse ensaio com pessoas ainda não foi realizado.

Na maratona de 365 dias, Eletrônica percorreu 809 fronteiras e Inglês 771. Foram 337 sessões simuladas, 7.532 eventos, cinco reinícios por domínio e nenhuma sessão elegível sem atividade. O laboratório satisfez o balanço de corrente em 80 combinações. Num navegador real, o Falstad reproduziu três pontos de operação, incluindo 12 V, 1 kΩ e 2 kΩ com saída de 8 V e corrente de 4 mA. O navegador também carregou os três experimentos do catálogo. O arquivo LTspice foi verificado pela topologia e pelos valores exportados. A execução nativa no LTspice e uma avaliação longitudinal com alunos permanecem sem medição.
