<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TrilhaAtlas

Tutor de estudos para temas definidos pelo aluno. Cada domínio tem mapa, sessões, memória e progresso próprios. Inglês e Eletrônica são exemplos públicos. A jornada parte dos fundamentos e chega à prática de pesquisa, com conteúdo para mais de um ano de estudo a 2–4 horas por dia ou mais.

## Como trabalhar

- Converse em português do Brasil. Investigue, implemente e valide de forma autônoma. Se uma decisão depender de uma preferência do usuário que altere o resultado, pergunte uma coisa por vez.
- Ao retomar o projeto, leia `docs/HANDOFF.md`, este arquivo, `docs/research/00-SINTESE.md` e `docs/impl/integration.md`, nessa ordem. Consulte o módulo e os testes para confirmar o estado atual.
- Use tabs e a extensão explícita nos imports relativos de TypeScript. Respeite as fronteiras do ESLint. Componentes acessam a lógica por `@/src/core`, rotas pelos barrels de core/server, e `src/core` permanece puro.
- Rode `npm run typecheck`, `npm run lint` e os testes da mudança. Use `LH_DATA_DIR` temporário em todo smoke e `LH_AUTH_FILE` temporário quando houver credenciais. Faça commits ou publicação quando autorizados.

## Criar nós para um tema novo

1. Defina uma competência final observável. Trabalhe de trás para a frente até o que um iniciante já consegue fazer. Organize domínio → área → unidade (região) → tópico ou habilidade e atribua IDs permanentes.
2. Para cada habilidade, escreva um objetivo avaliável, uma atividade, o conhecimento de entrada e uma estimativa de tempo. Acrescente um pré-requisito obrigatório apenas se o aluno realmente precisar dele para a atividade. Uma lista interna de `clauses` reúne requisitos simultâneos. Listas alternativas representam caminhos diferentes. Use relações suaves para afinidades.
3. Em paralelo à sequência, selecione materiais opcionais. Vincule o capítulo, seção ou trecho do YouTube à unidade ou habilidade que ele ensina. Verifique idioma, URL, disponibilidade e termos. Uma obra pode servir a várias regiões. O título, o trecho e a fonte devem acompanhar a aula.
4. Use o [guia de autoria](docs/authoring-domains.md) e o [exemplo importável](examples/study-domain/map-reading/00-map.json). Teste em diretório temporário a primeira aula, um bloqueio, o desbloqueio após evidência e os materiais. Para um currículo já instalado, aplique um patch versionado ao ledger. Preserve IDs, pré-requisitos já satisfeitos, XP e histórico.
5. Publique somente definições destinadas ao compartilhamento e exemplos fictícios. Conversas, eventos do aluno, memória, credenciais, PDFs pessoais e dados de sessão ficam fora do Git.

## Decisões de produto

- **Currículo.** Cada domínio tem uma árvore completa com zoom, regiões, pré-requisitos e objetivos verificáveis. O aluno deve localizar onde parou, enxergar o que concluiu e explorar um tema avançado sabendo qual base ele exige. Preserve IDs, histórico e meta principal.
- **Aulas e materiais.** Ensine com exemplos e prática gradual. Vincule capítulos e trechos de vídeo à habilidade e à região em ordem didática. Um livro pode atravessar várias regiões. Identifique obra e seção, importe exemplares disponíveis para uso e inclua o trecho na aula. Priorize vídeos em português ou em inglês com legenda ou dublagem disponível.
- **Adaptação.** Use evidências e memória com fontes para identificar lacunas, retomar conceitos e escolher o próximo passo. O planejador personaliza caminhos existentes. Erros repetidos em quizzes podem gerar um reforço opcional na região da habilidade. Domínios novos podem ser importados de arquivos de autoria. A geração de um domínio inteiro pela IA ainda é uma proposta. Valide pré-requisitos, alcançabilidade e compatibilidade com o progresso salvo. Avalie provas formais ou Lean quando acrescentarem uma garantia útil.
- **Pesquisa e modelos.** Para decisões pedagógicas ou de memória, confronte papers, benchmarks atuais e implementações abertas com o caso real. Inspecione manualmente os repositórios, clone referências relevantes e reutilize código conforme a licença. Priorize login por assinatura quando o provedor permitir e descoberta de modelos que acompanhe o catálogo. [Learnharness](https://github.com/amosblomqvist/learnharness) · [Open Mastery](https://github.com/bxxd/open-mastery) · [BloomTutor](https://github.com/Li-Evan/BloomTutor) · [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) · [DeepTutor](https://github.com/HKUDS/DeepTutor)
- **Continuidade.** O perfil reúne XP, nível, horas por dia e tokens por modelo e no total. Calibre patamares e ganhos com simulação de Monte Carlo. A proposta de fechamento das sessões inclui revisão por cartões em Anki ou Obsidian.
- **Interface.** Preserve a legibilidade do learnharness, com cel shading, ícones e assets autorais desenhados à mão. Use interações visuais para ensinar ou orientar. Deixe detalhes sob demanda e mantenha a próxima ação de estudo evidente.

As integrações entregues e pendentes estão em [integração](docs/impl/integration.md). As decisões por habilidade estão na [auditoria de Eletrônica](docs/impl/auditoria-eletronica/README.md).
