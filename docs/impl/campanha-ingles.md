# Campanha de inglês

Em **Inglês → Hoje**, **Começar missão** abre a próxima habilidade. Cada capítulo tem um ponto de partida, três marcos de prática, habilidades complementares e uma missão final. Os botões A1–C2 abrem a região correspondente no mapa. **Explorar em aula avulsa** permite experimentar outro capítulo e retomar o percurso anterior.

| Capítulo | Habilidades | Primeira visita | Produção final |
| --- | ---: | ---: | --- |
| A1 · Primeiros encontros | 176 | 15 min | Apresentar-se a um clube de leitura e devolver uma pergunta |
| A2 · Histórias do cotidiano | 203 | 20 min | Relatar três acontecimentos e responder a uma pergunta imprevista |
| B1 · Sua voz na conversa | 132 | 20 min | Escrever uma opinião para um leitor que discorda |
| B2 · À mesa de negociação | 125 | 25 min | Chegar a um acordo entre equipes com exigências incompatíveis |
| C1 · Na banca de pesquisa | 95 | 30 min | Redigir e justificar um parecer sobre um resumo de pesquisa |
| C2 · Debate e edição | 40 | 30 min | Editar um argumento para outro público preservando a posição e a voz do autor |

As 771 habilidades fazem parte da árvore existente de 925 nós. A estimativa curricular soma 1.510 horas de aula e 276 horas adicionais de prática distribuída. A duração de uma visita, as estimativas dos nós e o tempo efetivamente estudado são medidas diferentes. O orçamento diário continua limitando o plano.

## Como o percurso avança

O planejador considera habilidades novas do primeiro capítulo incompleto e escolhe entre aquelas cujos pré-requisitos já estão satisfeitos. Prioriza os marcos, intercala os demais tópicos e deixa a missão final para o fim quando o grafo permite. Uma meta explícita pode orientar o plano para outra região. O nivelamento pode reconhecer habilidades anteriores. A barra do capítulo acompanha o progresso estrutural. O domínio demonstrado continua dependendo de evidências do aluno.

Cada abertura e cada missão final tem uma leitura e um vídeo vinculados à atividade. **Materiais da aula** dá acesso à seção ou ao vídeo durante o chat. Para outras habilidades, o aplicativo combina o catálogo da região, a biblioteca do aluno e a busca de sugestões. A curadoria das 12 missões foi conferida individualmente. A cobertura e a disponibilidade das buscas externas variam.

Os capítulos adotam objetivos observáveis, em linha com a abordagem orientada à ação do CEFR. O experimento de Roediger e Karpicke distingue desempenho imediato de retenção posterior. Butler testou transferência com perguntas novas. Usamos essas distinções para escolher tarefas de produção e revisões posteriores. O intervalo inicial de 24 horas e as durações das missões são escolhas do produto. [CEFR Companion Volume](https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2020/16809ea0d4) · [Roediger e Karpicke, 2006](https://pubmed.ncbi.nlm.nih.gov/16507066/) · [Butler, 2010](https://pubmed.ncbi.nlm.nih.gov/20804289/)

## Percurso observado no aplicativo

Em 19 de novembro de 2026, usamos Chrome, um perfil de estudo temporário e o modelo GPT-6.2-sol pela conexão ChatGPT. Antes da mudança, o aluno começava com consoantes e a primeira aula vinha sem leitura ou vídeo. Depois da mudança, o perfil recebeu uma apresentação por nome, um exemplo em inglês e uma tarefa de escuta com o material da VOA.

| Amostra | O que aconteceu |
| --- | --- |
| A1 | O aluno respondeu ao cumprimento de Emma como Lucas. O quiz registrou a resposta correta. Em seguida, o tutor avaliou uma apresentação escrita e mudou o cenário para uma aula de culinária. A próxima missão de Hoje foi escutar informações pessoais. |
| A2 e B2 | O aluno respondeu às sondagens sobre a sequência de um relato e sobre uma objeção ao trabalho híbrido. As duas respostas apareceram como corretas. Encontramos aqui a confirmação redundante do plano e ajustamos a passagem da sondagem para o professor. |
| B1 e C1 | No B1, o professor desenvolveu uma opinião sobre celulares em aula e indicou o vídeo do British Council. No C1, a discussão partiu de responder a uma pergunta da plateia quando o dado solicitado é desconhecido. |
| C2 | O aluno apresentou uma réplica sobre congestionamento. O professor identificou a premissa contestada e recomendou medir se trabalhadores conseguem chegar no horário. Na missão final, mostrou uma edição de editorial para o conselho escolar e ofereceu outro texto para o aluno editar. |
| Revisão | O caso reservado não apareceu logo após o quiz. Avançamos em 25 horas a idade dos eventos no perfil temporário. A revisão apareceu em Hoje, aceitou uma apresentação com “I am” e registrou a evidência uma vez. O contador de habilidades dominadas permaneceu em zero. |
| Navegação | A exploração C2 manteve a posição A1. Em 390 px, a campanha coube na tela e o teclado abriu a lista de missões e a estante de materiais. |

O verificador de estágios percorre os pré-requisitos de todas as habilidades e usa diagnósticos sintéticos para testar as seis transições de estado, inclusive a conclusão do C2. A maratona alterna os dois domínios, introduz erros e pausas e reconstrói o histórico. Na execução de Inglês, foram 365 dias de calendário, 168 sessões, 3.801 eventos e cinco reconstruções. Houve 2.777 verificações tardias simuladas e zero recomendações de habilidade nova fora do capítulo ou com pré-requisito pendente. Esse ensaio verifica o comportamento do software. A eficácia longitudinal da campanha requer acompanhamento de alunos.

O agente de pesquisa realizou três tentativas no perfil temporário. Duas retornaram erro do provedor. A terceira localizou o diálogo oficial da lição A1 na página física 5 do PDF. Conferimos o trecho na publicação e ligamos o cartão de leitura diretamente àquela página. O primeiro envio também retornou 503 em parte do percurso. Na instância isolada, os envios seguintes usaram a cadeia de confiança do sistema. [Caderno da VOA, página física 5](https://docs.voanews.eu/en-us-learn/2019/11/28/a6b53eb2-060b-404f-88d7-f1b5c350c90d.pdf#page=5)

**Validação do checkout.** Os 141 testes direcionados de campanha, memória, aulas, planejamento e catálogo passaram. O TypeScript passou e o ESLint apontou um aviso em `tests/source-name-ui.test.tsx`. A suíte completa no Windows executou 6.347 testes, com 6.305 aprovações, 35 falhas e sete testes pulados. Reexecutamos os arquivos que falharam após corrigir duas verificações dos prompts e o cenário de memória regional. Nessa rodada, houve 33 falhas, incluindo uma falha de autenticação que havia passado na primeira rodada. Das 33, reproduzimos 28 com os arquivos da revisão Git HEAD no mesmo computador. As cinco restantes envolvem notificações de conexão, contexto do CLI, texto de configuração de fonte, medidor de contexto e rotação de credencial.

## Reproduzir

O teste de integração cria seus próprios diretórios temporários. O benchmark usa os currículos públicos e uma semente fixa.

```sh
node scripts/run-tests.mjs tests/english-campaign.test.ts tests/campaign-review-flow.test.ts
node --import tsx scripts/benchmark-study-marathon.ts
```

Para o teste no Chrome, inicie uma instância do app com diretórios temporários de dados e autenticação, selecione Inglês e configure a conexão desejada pelo app. Passe a origem dessa instância. O smoke abre as seis regiões e inicia ou retoma a exploração C2, que pode consumir uma chamada real ao provedor. Com `LH_TEST_CHROME` é possível indicar o executável do navegador.

```sh
node scripts/smoke-english-campaign.mjs http://127.0.0.1:3059
```
