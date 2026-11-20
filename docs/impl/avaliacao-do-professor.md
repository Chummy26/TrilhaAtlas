# Aula, memória e continuidade do estudo

## O que chega ao professor

O início de uma aula já levava ao chat objetivos, dificuldades previstas, referências regionais e, quando disponível, um trecho do livro. O leitor fornece a página visual e a ferramenta de consulta. O catálogo já distinguia capítulos de sugestões e podia localizar capítulos do YouTube pelos timestamps publicados. A seleção para o professor agora reserva espaço ao primeiro livro e ao primeiro vídeo entre os materiais pertinentes. O trecho continua atribuído ao livro de origem. Um vídeo identificado apenas pelos metadados serve como indicação de estudo.

Para explicar, o professor recebe a orientação de acompanhar um exemplo desde a situação concreta até a consequência observável. Uma comparação breve ou uma pequena sequência cabe entre os parágrafos com `study_activity` em apresentação compacta. Uma simulação com vários parâmetros mantém o painel completo. O aluno pode compartilhar o estado que escolheu. O professor usa esse estado para explicar o resultado. A atividade por si só não estabelece domínio da habilidade.

Cada domínio já tinha seu SQLite, busca textual e vetorial, índice de nós, fatos com fonte e registro por sessão. O ranqueamento por afinidade com os nós ainda admitia material de qualquer região do domínio. Na preparação da aula, a sessão atual, a unidade selecionada e os pré-requisitos da rota escolhida delimitam a memória. Uma exploração de área abrange suas unidades. Uma conversa sem nó recupera falas da própria sessão. O perfil declarado continua disponível no domínio. A seleção da fronteira, dos pontos fracos, das revisões e do plano usa a mesma região da aula.

Ao abrir uma nova conversa de aula com “continua”, o professor pode receber até quatro falas da sessão mais recente sobre a habilidade. Se ainda não houver sessão da habilidade, a seleção procura uma sessão dentro da região e dos pré-requisitos permitidos. Um agradecimento simples dispensa a busca.

Os fatos novos herdam os nós da mensagem que sustenta a citação quando ela tem essa informação. Na leitura, a origem também é conferida para fatos antigos e para os fatos que sustentam uma observação. O diário geral e os resumos que misturam regiões ficam disponíveis nas consultas de domínio. O bloco da aula usa evidências localizadas e o registro da sessão. A consolidação distingue conjuntos de nós, escopos e sessões privadas ao comparar duplicatas ou revisões. As mensagens originais e os IDs persistidos continuam sendo as fontes.

O bloco de memória da aula cabe em até **2.400 tokens estimados**, incluindo perfil, estado, registro, evidência e trecho regional, dentro do espaço livre do modelo. A recuperação usa até 1.000 e a leitura até 700. São limites de engenharia. O estimador local mede texto, e a contabilidade de uso do provedor mede a chamada completa. Para consultas sem intervalo temporal explícito, uma evidência entre os três primeiros resultados tanto textuais quanto vetoriais conserva seu peso de relevância mesmo meses depois.

No teste de navegador, uma conversa sintética abriu a comparação entre dois usos de *since*. Em Chrome a 390 px e com movimento reduzido ativado, Tab passou do primeiro caso ao segundo, Enter mudou a explicação e o teclado abriu a fonte. O conteúdo ocupou os 318 px disponíveis no painel, sem rolagem horizontal interna.

## Pesquisa que orientou o desenho

| Trabalho | Observação e aplicação |
| --- | --- |
| Tutor CoPilot | No ensaio de tutoria com assistência de IA aos tutores humanos, o grupo com acesso ao sistema teve ganho de quatro pontos percentuais no domínio dos tópicos. Aqui, o professor usa a tentativa do aluno para escolher a pista e só propõe outra pergunta quando isso muda a explicação. O resultado publicado pertence àquela intervenção humana. [Wang et al.](https://arxiv.org/abs/2410.03017) |
| Tutoria em física universitária | O ensaio de Kestin et al. encontrou melhor desempenho imediato com o tutor desenhado para aquelas aulas. O pós-teste motiva avaliar uma aplicação independente do conceito explicado. Uma maratona de software mede outra propriedade. [Scientific Reports](https://www.nature.com/articles/s41598-025-97652-6) |
| Exemplos resolvidos e retirada gradual de apoio | Nos experimentos de Atkinson, Renkl e Merrill, a combinação de exemplos com passos progressivamente omitidos e explicação do princípio favoreceu a transferência. A aula mantém um exemplo contínuo e cede um passo ao aluno quando ele tem base para realizá-lo. [Journal of Educational Psychology](https://doi.org/10.1037/0022-0663.95.4.774) |
| Exploração com simulações | As entrevistas de Podolefsky, Perkins e Adams mostram como os alunos exploram relações ao manipular uma simulação. O professor aponta a variável, a mudança e a observação relevante. A aplicação aos formatos de linguagem é uma hipótese de design. [Physical Review](https://journals.aps.org/prper/abstract/10.1103/PhysRevSTPER.6.020117) |
| Recuperação e retenção | Roediger e Karpicke distinguiram desempenho imediato e recordação após atraso. Uma avaliação com alunos precisa de aplicação posterior sem assistência. A simulação registra separadamente verificações pelo menos um dia depois da exposição. [Psychological Science](https://pubmed.ncbi.nlm.nih.gov/16507066/) |
| LongMemEval e LoCoMo | LongMemEval distingue recuperação entre sessões, atualização, temporalidade e abstenção. LoCoMo usa conversas extensas distribuídas por sessões. Daí os controles com informações concorrentes, uma correção posterior, ramos vazios e verificação da fonte. Há também uma avaliação anterior em histórias públicas. [LongMemEval](https://arxiv.org/abs/2410.10813) · [LoCoMo](https://aclanthology.org/2024.acl-long.747/) · [Avaliação pública do projeto](memory.md#retrieval-check-on-public-conversation-histories) |
| Lost in the Middle | A posição da evidência no contexto entregue pode mudar o desempenho do modelo. Nosso teste varia a idade da evidência no histórico indexado e o orçamento de recuperação. Isso mede o recuperador. O efeito da posição na janela do modelo requer geração de respostas. [Transactions of the ACL](https://aclanthology.org/2024.tacl-1.9/) |

Na implementação do DeepTutor, o teste de retomada inspeciona o bloco recebido no prompt. Aplicamos essa verificação na entrada do provedor do chat. O OpenMAIC documenta a diferença entre localizar um capítulo e ler seu conteúdo. Isso orienta o tratamento de sugestões, páginas e transcrições. [Teste do DeepTutor](https://github.com/HKUDS/DeepTutor/blob/4c1e000d8563c5ac3b231baaaf149dc4dc4d2406/tests/agents/chat/test_learning_journal_injection.py) · [Leitura no OpenMAIC](https://github.com/THU-MAIC/OpenMAIC/blob/cb225a52a181f4dbbca5526821238acbb93f3117/lib/server/agent-runtime/material-prompt.ts)

O LongMemEval-V2 entrega evidência compacta a um leitor posterior. O EvalMem distingue falhas de registro, recuperação e geração. Essa separação orienta as métricas abaixo. Presença do gabarito no texto, isolamento entre ramos e uso correto pelo modelo são três resultados distintos. A execução local mede os dois primeiros. [LongMemEval-V2](https://arxiv.org/abs/2605.12493) · [EvalMem](https://arxiv.org/abs/2609.22231)

## Recuperação sob estresse

`node --import tsx scripts/benchmark-lesson-memory.ts` cria bases SQLite temporárias com 768 ou 6.144 mensagens por histórico. Os dois tratamentos consultam a mesma base com a mesma pergunta, o mesmo orçamento e ordem alternada por sorteio. O controle usa a busca de domínio. O tratamento usa a política da aula. Ambos usam o embedder hash local. O relógio da consulta e a geração do corpus são controlados. Os IDs internos do banco e as durações variam entre execuções.

São 12 alvos por histórico, distribuídos no início, meio e fim. Nos três históricos de desenvolvimento, os assuntos rodam entre as três posições. Há medições provisórias na mesma unidade e calibrações com vocabulário praticamente idêntico em outras unidades. O gabarito é um identificador aleatório ausente da pergunta. O acerto exige sua presença no **texto final montado**. Cada consulta é repetida com 240, 600 e 1.000 tokens de recuperação. O quarto histórico usa outra semente e outra formulação da pergunta.

| Histórico e conjunto | Acertos no controle | Acertos na aula | Consultas com outra região, controle → aula | Tokens medianos, controle → aula |
| --- | ---: | ---: | ---: | ---: |
| 768 mensagens, desenvolvimento | 104/108 | 108/108 | 108 → 0 | 266 → 176 |
| 768 mensagens, formulação reservada | 5/36 | 36/36 | 36 → 0 | 596 → 175 |
| 6.144 mensagens, desenvolvimento | 36/108 | 108/108 | 90 → 0 | 227 → 132 |
| 6.144 mensagens, formulação reservada | 0/36 | 36/36 | 36 → 0 | 170 → 135 |

Na carga maior de desenvolvimento, montar o contexto levou 23,3 ms de mediana e 29,4 ms no p95 com a política da aula. O controle levou 11,8 e 14,2 ms. Valores desta máquina em 19/11/2026, com índice carregado, sem chamada de modelo e sem leitura regional. A seleção mais precisa custou tempo de busca. Os oito controles com ramo vazio produziram zero evidências. A bateria de integração cobre troca de domínio, ausência de nó, exclusão, atualização, escopo da citação original, erro corrigido e passagem de PDF na entrada efetiva de um provedor simulado.

As 36 observações reservadas por carga correspondem a 12 perguntas em três orçamentos correlacionados. As consultas são sintéticas, com vocabulário controlado e uma unidade conhecida. Esses resultados não estimam a taxa de acerto em conversas reais, com embeddings semânticos ou na resposta gerada. O teste falha se houver intrusão ou se a recuperação por posição cair abaixo do piso de regressão de 80%.

## Árvore e maratona de estudo

`node --import tsx scripts/benchmark-study-marathon.ts` carrega as sementes públicas e faz dois exercícios. No primeiro, um verificador enumera as folhas cujas cláusulas estão satisfeitas, atualiza os marcos pela hierarquia e compara o conjunto inteiro com a fronteira calculada pelo algoritmo de produção. Escolhe apenas uma folha aleatória por passo. Isso testa estados intermediários que uma travessia por camadas pularia. O verificador recebe as cláusulas efetivas da projeção. A certificação das sementes e os testes de patches cobrem a construção dessas cláusulas.

No segundo exercício, o planejador real recebe 365 dias de calendário, alternância entre domínios, pausas de uma semana por trimestre e orçamentos diários de duas, três ou quatro horas. Uma política sintética acerta ou erra com probabilidades fixadas por tipo de atividade. Os eventos passam pelo fold do aluno. A cada 30 sessões, a simulação serializa o histórico, refaz o estado desde o início e compara o resultado com o estado incremental. Em cada plano, verifica pré-requisitos das aulas novas, ausência de duplicatas e orçamento total.

| Domínio | Nós / folhas verificadas | Sessões de estudo | Eventos | Erros introduzidos | Verificações com atraso ≥ 1 dia | Retomadas intermediárias idênticas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Eletrônica | 1.010 / 809 | 169 | 3.691 | 523 | 2.805 | 5/5 |
| Inglês | 925 / 771 | 168 | 3.841 | 580 | 2.867 | 5/5 |

Os dois replays finais também coincidiram. A travessia completa e a maratona anual são experimentos diferentes. Na maratona o aluno sintético atingiu 266 habilidades em Eletrônica e 289 em Inglês. As probabilidades de resposta são entradas do experimento. Não são uma previsão de quanto um aluno aprende.

## Como medir a didática com alunos

Para comparar versões do professor, fixe modelo, configuração, tempo, material e histórico inicial. Sorteie a versão por aluno e contrabalanceie a ordem dos temas. Exemplos de tarefas são explicar por que dobrar a resistência reduz a corrente, distinguir dois sentidos de *since* e interpretar uma figura do livro antes de aplicar o princípio a outra figura. Inclua um caso em que a página ou o timestamp solicitado está ausente. O professor deve reconhecer o limite da fonte.

Use como desfecho primário a resolução individual de uma aplicação nova uma semana depois. Registre também o pré-teste, o pós-teste imediato, o tempo e as desistências. Dois avaliadores sem identificação da versão podem pontuar separadamente a correção, a explicação do passo causal, a resposta à dúvida, a relação entre texto e visual e a fidelidade da citação. Para cada dimensão, use 0 para ausente ou incorreta, 1 para parcial e 2 para correta e utilizável. Registre os desacordos antes do consenso. Analise por aluno, com intervalo de confiança que respeite a alocação. Esse protocolo com participantes permanece por executar.
