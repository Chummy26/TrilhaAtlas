<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TrilhaAtlas

Tutor de estudos baseado no learnharness. Inglês e Eletrônica têm mapas, sessões, memória e progresso próprios. A jornada parte dos fundamentos e chega à prática de pesquisa, com conteúdo para mais de um ano de estudo a 2–4 horas por dia ou mais.

## Como trabalhar

- Converse em português do Brasil. Investigue, proponha um plano e obtenha aprovação antes de implementar. O usuário decide design e comportamento. Se algo estiver ambíguo, pergunte uma coisa por vez com a ferramenta de perguntas.
- Ao retomar o projeto, leia `docs/HANDOFF.md`, este arquivo, `docs/research/00-SINTESE.md` e `docs/impl/integration.md`, nessa ordem. Consulte o módulo e os testes para confirmar o estado atual.
- Use tabs e a extensão explícita nos imports relativos de TypeScript. Respeite as fronteiras do ESLint. Componentes acessam a lógica por `@/src/core`, rotas pelos barrels de core/server, e `src/core` permanece puro.
- Rode `npm run typecheck`, `npm run lint` e os testes da mudança. Use `LH_DATA_DIR` temporário em todo smoke e `LH_AUTH_FILE` temporário quando houver credenciais. Faça commits ou publicação quando autorizados.

## Decisões de produto

- **Currículo.** Cada domínio tem uma árvore completa com zoom, regiões, pré-requisitos e objetivos verificáveis. O aluno deve localizar onde parou, enxergar o que concluiu e explorar um tema avançado sabendo qual base ele exige. Preserve IDs, histórico e meta principal.
- **Aulas e materiais.** Ensine com exemplos e prática gradual. Vincule capítulos e trechos de vídeo à habilidade e à região em ordem didática. Um livro pode atravessar várias regiões. Identifique obra e seção, importe exemplares disponíveis para uso e inclua o trecho na aula. Priorize vídeos em português ou em inglês com legenda ou dublagem disponível.
- **Adaptação.** Use evidências e memória com fontes para identificar lacunas, retomar conceitos e escolher o próximo passo. O planejador personaliza caminhos existentes. A proposta de expansão prevê a IA sugerindo habilidades e domínios quando houver necessidade. Valide pré-requisitos, alcançabilidade e compatibilidade com o progresso salvo. Avalie provas formais ou Lean quando acrescentarem uma garantia útil.
- **Pesquisa e modelos.** Para decisões pedagógicas ou de memória, confronte papers, benchmarks atuais e implementações abertas com o caso real. Inspecione manualmente os repositórios, clone referências relevantes e reutilize código conforme a licença. Priorize login por assinatura quando o provedor permitir e descoberta de modelos que acompanhe o catálogo. [Learnharness](https://github.com/amosblomqvist/learnharness) · [Open Mastery](https://github.com/bxxd/open-mastery) · [BloomTutor](https://github.com/Li-Evan/BloomTutor) · [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) · [DeepTutor](https://github.com/HKUDS/DeepTutor)
- **Continuidade.** O perfil reúne XP, nível, horas por dia e tokens por modelo e no total. Calibre patamares e ganhos com simulação de Monte Carlo. A proposta de fechamento das sessões inclui revisão por cartões em Anki ou Obsidian.
- **Interface.** Preserve a legibilidade do learnharness, com cel shading, ícones e assets autorais desenhados à mão. Use interações visuais para ensinar ou orientar. Deixe detalhes sob demanda e mantenha a próxima ação de estudo evidente.

As integrações entregues e pendentes estão em [integração](docs/impl/integration.md). As decisões por habilidade estão na [auditoria de Eletrônica](docs/impl/auditoria-eletronica/README.md).
