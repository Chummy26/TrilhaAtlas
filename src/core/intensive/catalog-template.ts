/**
 * Public generic template catalog for TrilhaAtlas INTENSIVA.
 *
 * Pure data module — ZERO Node builtins, ZERO filesystem/network I/O.
 * Users replace this starter template with their own personal study track by placing
 * a JSON file at `<LH_DATA_DIR>/intensive/track.json` (kept outside Git).
 * See `docs/intensive-tracks.md` and `examples/intensive/sample-track.json`.
 */

import type {
	CertificationAntiGoal,
	CertificationSpec,
	IntensiveCourseSpec,
	IntensiveTierSpec,
	IntensiveTrackSpec,
	PortfolioProjectSpec,
} from "./types.ts";

export const TEMPLATE_INTENSIVE_TRACK_ID = "intensive-template";
export const DEFAULT_INTENSIVE_TRACK_ID = TEMPLATE_INTENSIVE_TRACK_ID;

const TEMPLATE_TIERS: IntensiveTierSpec[] = [
	{
		tier: 1,
		id: "tier-1",
		title: "Tier 1 · Base, Segurança e 1º Projeto",
		subtitle: "Fundamentos essenciais, vocabulário técnico, prática guiada e trilha paralela contínua",
		timeframe: "Meses 0–3",
		completionScope: "core",
		priority: "essential-now",
		description:
			"Constrói a base indispensável do seu tema com cursos curtos de retorno rápido, inicia a prática mão na massa desde a primeira semana e abre uma trilha paralela diária (45–60 min/dia) para cursos longos sem travar entregas.",
	},
	{
		tier: 2,
		id: "tier-2",
		title: "Tier 2 · Aprofundamento, Ferramentas e Certificação",
		subtitle: "Domínio de ferramentas profissionais, livro-texto de referência e preparo para certificação",
		timeframe: "Meses 3–6",
		completionScope: "core",
		priority: "essential-next",
		description:
			"Consolida ferramentas do mercado, fecha lacunas teóricas com literatura aberta estruturada e prepara diretamente para a primeira certificação verificável e o segundo projeto de portfólio.",
	},
	{
		tier: 3,
		id: "tier-3",
		title: "Tier 3 · Especialização e Projetos de Escala",
		subtitle: "Arquitetura avançada, depuração real e entregas de nível profissional",
		timeframe: "Meses 6–12+",
		completionScope: "core",
		priority: "industry-advancement",
		description:
			"Eleva do nível fundamental para projetos complexos de ponta a ponta, análise de falhas e documentação técnica no padrão exigido por times de engenharia e pesquisa.",
	},
	{
		tier: 4,
		id: "tier-4",
		title: "Tier 4 · Biblioteca de Apoio Sob Demanda",
		subtitle: "Consulta cirúrgica para destravar tópicos — NÃO obrigatório",
		timeframe: "Sob demanda",
		completionScope: "on-demand",
		priority: "on-demand",
		description:
			"Materiais excelentes mas longos ou redundantes para execução linear. Abra apenas quando travar em um conceito específico dos Tiers 1–3, certificações ou projetos.",
		uiGuidance:
			"Cursos do Tier 4 são opcionais e NÃO penalizam o Progresso Core %. Ative um curso somente quando quiser acompanhá-lo como reforço pontual.",
	},
];

const TEMPLATE_COURSES: IntensiveCourseSpec[] = [
	// ─── TIER 1 (#1–#3) ──────────────────────────────────────────────────────
	{
		id: "template-foundations-core",
		rank: 1,
		tier: 1,
		timeframe: "Mês 1",
		title: "Fundamentos Essenciais & Vocabulário Técnico (Exemplo Online)",
		provider: "Curso Aberto / Institucional",
		origin: "Repo",
		language: "pt-BR / en",
		estimatedHours: 24,
		durationLabel: "~24h (3 módulos de entrada rápida)",
		priority: "essential-now",
		completionScope: "core",
		deliveryMode: "online-self-paced",
		localPackStatus: "not-applicable",
		officialUrls: [
			{
				label: "Documentação de organização da trilha",
				url: "https://github.com/Chummy26/TrilhaAtlas",
			},
		],
		nocCodesUnlocked: ["Base técnica de entrada", "Vocabulário padronizado"],
		europeGlobalAlignment: ["Fundamentos universais", "Portfólio inicial"],
		portfolioDeliverables: [
			"Checklist pessoal de fundamentos e boas práticas",
			"Primeiro experimento documentado com evidências reais",
		],
		linkedCertIds: ["cert-starter-badge"],
		whyThisPosition:
			"Exemplo de curso #1 de retorno rápido: estabelece vocabulário, segurança e rotina de estudo em poucos dias para desbloquear os primeiros exercícios práticos.",
		modules: [
			{
				id: "tpl-m1-setup",
				order: 1,
				title: "Mapa do Domínio, Boas Práticas e Setup de Trabalho",
				estimatedHours: 6,
				topics: [
					"Organizar sua pasta local e catálogo em data/intensive/track.json",
					"Definir metas observáveis para 3, 6 e 12 meses",
					"Montar ambiente mínimo de prática ativa",
				],
				benchExercise: "Criar o primeiro esboço da sua trilha pessoal no arquivo track.json.",
			},
			{
				id: "tpl-m2-core-concepts",
				order: 2,
				title: "Princípios Fundamentais e Medição de Base",
				estimatedHours: 10,
				topics: [
					"Conceitos-chave que sustentam os módulos avançados",
					"Análise de casos simples passo a passo",
					"Registro de erros frequentes em flashcards",
				],
				benchExercise: "Resolver 3 exercícios práticos sem consulta e registrar dúvidas no Tutor IA.",
			},
			{
				id: "tpl-m3-first-deliverable",
				order: 3,
				title: "Primeiro Entregável Verificável (Projeto P1)",
				estimatedHours: 8,
				topics: [
					"Documentação clara com evidências visuais e medições",
					"Revisão de qualidade pela Regra dos 10 Segundos",
				],
				benchExercise: "Publicar o repositório inicial do Projeto P1 com README objetivo.",
			},
		],
		tutorSyllabusContext:
			"Curso modelo de entrada da Trilha Intensiva. Ajude o aluno a dominar os fundamentos com prática ativa, perguntas socráticas e um passo prático verificável por sessão.",
	},
	{
		id: "template-parallel-deep-dive",
		rank: 2,
		tier: 1,
		timeframe: "Meses 1–6 (paralelo)",
		title: "Curso Longo de Aprofundamento — Pacote Local de Vídeos (Cadência Paralela)",
		provider: "Sua Pasta Local de Aulas (MP4/MKV + Transcrição GPU)",
		origin: "Custom",
		language: "pt-BR",
		estimatedHours: 80,
		durationLabel: "~80h (ex.: 100 aulas em vídeo local)",
		priority: "essential-now",
		completionScope: "core",
		deliveryMode: "local-video-pack",
		localPackStatus: "planned-download",
		expectedTotalVideos: 100,
		parallelCadence: {
			recommendedDailyMinutesMin: 45,
			recommendedDailyMinutesMax: 60,
			label: "45–60 min/dia em paralelo",
			rationale:
				"Cursos extensos rendem melhor em blocos diários fixos em paralelo aos cursos curtos e projetos, evitando travar o progresso geral.",
		},
		officialUrls: [],
		nocCodesUnlocked: ["Análise profunda", "Resolução sistemática de problemas"],
		europeGlobalAlignment: ["Domínio teórico-prático contínuo"],
		portfolioDeliverables: [
			"Caderno de anotações com timestamps buscáveis",
			"Resumos de casos resolvidos com o Tutor IA",
		],
		linkedCertIds: ["cert-core-exam"],
		whyThisPosition:
			"Demonstra como organizar um curso extenso em vídeo local: vincule sua pasta em 'Vincular pasta local', rode a transcrição GPU e busque qualquer conceito direto por timestamp.",
		modules: [
			{
				id: "tpl-par-m1",
				order: 1,
				title: "Bloco 1 · Fundamentos em Vídeo + Pausas Ativas",
				estimatedHours: 25,
				topics: [
					"Vincular pasta local com vídeos numerados",
					"Estudar a 1× pausando antes da solução do instrutor",
					"Marcar timestamps-chave e revisar com o Tutor IA",
				],
				benchExercise: "Vincular uma pasta local e testar busca nas transcrições.",
			},
			{
				id: "tpl-par-m2",
				order: 2,
				title: "Bloco 2 · Estudos de Caso e Diagnóstico",
				estimatedHours: 30,
				topics: [
					"Prever o comportamento antes de conferir a resposta",
					"Registrar hipóteses e testes no diário de aula",
				],
			},
			{
				id: "tpl-par-m3",
				order: 3,
				title: "Bloco 3 · Consolidação e Simulados",
				estimatedHours: 25,
				topics: [
					"Revisão espaçada dos pontos fracos",
					"Conexão direta com os projetos P2 e P3",
				],
			},
		],
		tutorSyllabusContext:
			"Curso paralelo contínuo em vídeo local. Incentive estudo ativo (sem maratonar em 2×): peça ao aluno para prever o resultado antes da explicação e conecte com os trechos transcritos.",
	},

	// ─── TIER 2 (#3–#4) ──────────────────────────────────────────────────────
	{
		id: "template-practical-toolchain",
		rank: 3,
		tier: 2,
		timeframe: "Meses 2–4",
		title: "Ferramentas Profissionais na Prática (Exemplo Playlist YouTube)",
		provider: "Documentação Oficial + Playlist Técnica",
		origin: "Referência",
		language: "en / pt-BR",
		estimatedHours: 32,
		durationLabel: "~32h (estudo guiado + projeto P2)",
		priority: "essential-next",
		completionScope: "core",
		deliveryMode: "youtube-playlist",
		localPackStatus: "not-applicable",
		officialUrls: [],
		nocCodesUnlocked: ["Fluxo de trabalho profissional", "Prototipagem e validação"],
		europeGlobalAlignment: ["Padrão de ferramentas de mercado"],
		portfolioDeliverables: [
			"Projeto P2 completo com arquivos-fonte e evidências de teste",
		],
		linkedCertIds: ["cert-core-exam"],
		whyThisPosition:
			"Exemplo de curso focado em ferramenta do mercado para destravar o segundo projeto de portfólio com documentação completa.",
		modules: [
			{
				id: "tpl-tool-m1",
				order: 1,
				title: "Fluxo Completo de Projeto",
				estimatedHours: 16,
				topics: [
					"Configuração limpa do ambiente e padrões de projeto",
					"Construção guiada de um protótipo funcional",
				],
				benchExercise: "Reproduzir o protótipo do zero com suas próprias escolhas de design.",
			},
			{
				id: "tpl-tool-m2",
				order: 2,
				title: "Verificação, Testes e Entrega",
				estimatedHours: 16,
				topics: [
					"Checklist de revisão antes da entrega final",
					"Documentação técnica clara para avaliadores",
				],
				benchExercise: "Validar todos os entregáveis do Projeto P2.",
			},
		],
		tutorSyllabusContext:
			"Curso prático de ferramentas do Tier 2. Priorize decisões de projeto, revisão de checklist e depuração real no projeto P2.",
	},
	{
		id: "template-open-textbook",
		rank: 4,
		tier: 2,
		timeframe: "Meses 3–6",
		title: "Livro-Texto Aberto & Preparatório para Certificação",
		provider: "Literatura Aberta / Syllabus Oficial",
		origin: "Referência",
		language: "en",
		estimatedHours: 40,
		durationLabel: "~40h (leitura dirigida + simulados)",
		priority: "essential-next",
		completionScope: "core",
		deliveryMode: "open-textbook",
		localPackStatus: "not-applicable",
		officialUrls: [],
		nocCodesUnlocked: ["Domínio teórico verificável", "Prontidão para exame"],
		europeGlobalAlignment: ["Syllabus internacional de referência"],
		portfolioDeliverables: [
			"Simulados acima da nota mínima de aprovação",
			"Banco pessoal de flashcards com erros corrigidos",
		],
		linkedCertIds: ["cert-core-exam"],
		whyThisPosition:
			"Fecha lacunas teóricas com leitura estruturada e prepara diretamente para os checkpoints da certificação principal.",
		modules: [
			{
				id: "tpl-book-m1",
				order: 1,
				title: "Capítulos Core & Problemas Resolvidos",
				estimatedHours: 24,
				topics: [
					"Leitura ativa com resumo próprio por seção",
					"Lista de exercícios comentados com o Tutor IA",
				],
			},
			{
				id: "tpl-book-m2",
				order: 2,
				title: "Simulados Cronometrados & Revisão de Lacunas",
				estimatedHours: 16,
				topics: [
					"Simulados completos no formato da prova",
					"Mapeamento de tópicos abaixo de 80% para revisão",
				],
			},
		],
		tutorSyllabusContext:
			"Preparação teórica e simulado orientado ao syllabus oficial. Aplique questões uma por vez e explore o porquê de cada erro.",
	},

	// ─── TIER 3 (#5) ─────────────────────────────────────────────────────────
	{
		id: "template-advanced-capstone",
		rank: 5,
		tier: 3,
		timeframe: "Meses 6–12",
		title: "Especialização Avançada & Projeto Capstone (P3)",
		provider: "Referência Avançada / Documentação de Indústria",
		origin: "Repo + Ref.",
		language: "en",
		estimatedHours: 60,
		durationLabel: "~60h (arquitetura + projeto de escala)",
		priority: "industry-advancement",
		completionScope: "core",
		deliveryMode: "online-self-paced",
		localPackStatus: "not-applicable",
		officialUrls: [],
		nocCodesUnlocked: ["Especialização técnica", "Arquitetura e diagnóstico avançado"],
		europeGlobalAlignment: ["Padrão sênior de portfólio e entrevistas técnicas"],
		portfolioDeliverables: [
			"Projeto Capstone P3 completo com testes, medições e post-mortem técnico",
		],
		linkedCertIds: [],
		whyThisPosition:
			"Consolida autonomia técnica através de um projeto autoral complexo com requisitos reais de confiabilidade e documentação.",
		modules: [
			{
				id: "tpl-adv-m1",
				order: 1,
				title: "Especificação, Trade-offs e Arquitetura",
				estimatedHours: 20,
				topics: [
					"Definir requisitos mensuráveis e critérios de aceite",
					"Justificar escolhas técnicas contra alternativas",
				],
			},
			{
				id: "tpl-adv-m2",
				order: 2,
				title: "Implementação, Testes de Estresse e Documentação",
				estimatedHours: 40,
				topics: [
					"Testar casos de borda e falhas reais",
					"Publicar estudo de caso completo no portfólio",
				],
			},
		],
		tutorSyllabusContext:
			"Módulo avançado do Tier 3. Atue como revisor técnico exigente: questione trade-offs, hipóteses de falha e qualidade das medições.",
	},

	// ─── TIER 4 (#6) — ON-DEMAND ─────────────────────────────────────────────
	{
		id: "template-reference-library",
		rank: 6,
		tier: 4,
		timeframe: "Sob demanda",
		title: "Biblioteca de Consulta Cirúrgica (Opcional — Não Entra no Core %)",
		provider: "Manuais, Aulas Universitárias e Referências Extras",
		origin: "Referência",
		language: "en / pt-BR",
		estimatedHours: 40,
		durationLabel: "Consulta pontual conforme necessidade",
		priority: "on-demand",
		completionScope: "on-demand",
		deliveryMode: "open-textbook",
		localPackStatus: "not-applicable",
		officialUrls: [],
		nocCodesUnlocked: ["Aprofundamento sob demanda"],
		europeGlobalAlignment: ["Referência acadêmica e técnica"],
		portfolioDeliverables: [],
		linkedCertIds: [],
		whyThisPosition:
			"Demonstra como manter materiais extensos no Tier 4: ficam sempre acessíveis para consulta pontual sem inflar ou penalizar o progresso Core.",
		modules: [
			{
				id: "tpl-ref-m1",
				order: 1,
				title: "Tópicos Avançados para Consulta Pontual",
				estimatedHours: 40,
				topics: [
					"Consultar capítulos específicos apenas quando travar nos Tiers 1–3",
					"Evitar estudo linear de material redundante",
				],
			},
		],
		tutorSyllabusContext:
			"Material de apoio sob demanda (Tier 4). Responda à dúvida cirúrgica do aluno com clareza e devolva-o rapidamente ao foco Core.",
	},
];

const TEMPLATE_CERTIFICATIONS: CertificationSpec[] = [
	{
		id: "cert-starter-badge",
		phase: "Mês 1",
		priorityTier: "core-free",
		title: "Credencial Verificável de Entrada (Exemplo Gratuito)",
		issuer: "Plataforma Oficial / Emissor Aberto",
		costUSD: 0,
		costBRL: 0,
		costDisplay: "US$ 0 (Gratuito)",
		examFormat: "Avaliação online com verificação pública de credencial",
		passingScore: "≥ 75%",
		officialUrl: "https://github.com/Chummy26/TrilhaAtlas",
		linkedCourseIds: ["template-foundations-core"],
		targetNOCs: ["Validação inicial de currículo"],
		globalWeight:
			"Serve como marco rápido no Mês 1 para validar constância e gerar a primeira evidência pública.",
		studyCheckpoints: [
			"Concluir os módulos fundamentais do Tier 1",
			"Completar uma revisão prática com o Tutor IA",
			"Publicar o link de verificação no perfil e currículo",
		],
		retakeAndDiscountNotes: "Substitua em data/intensive/track.json pelas certificações reais da sua área.",
		verifiedAt: "2026-11-24",
		defaultStatus: "preparing",
	},
	{
		id: "cert-core-exam",
		phase: "Meses 2–4",
		priorityTier: "core-paid",
		title: "Certificação Técnica Principal (Exemplo Core)",
		issuer: "Órgão Certificador da Área",
		costUSD: 120,
		costBRL: 650,
		studentCostUSD: 80,
		studentCostBRL: 430,
		costDisplay: "US$ 120",
		examFormat: "Exame teórico-prático cronometrado (90–120 min)",
		passingScore: "≥ 75% nos domínios principais",
		officialUrl: "https://github.com/Chummy26/TrilhaAtlas",
		linkedCourseIds: ["template-practical-toolchain", "template-open-textbook"],
		targetNOCs: ["Validação internacional da especialidade"],
		globalWeight:
			"Exemplo de certificação âncora que valida domínio técnico objetivo junto a recrutadores.",
		studyCheckpoints: [
			"Fechar os módulos do Tier 2 vinculados ao syllabus",
			"Atingir ≥ 82% em dois simulados completos com o Tutor IA",
			"Revisar todos os pontos abaixo de 75% antes de agendar a prova",
		],
		retakeAndDiscountNotes: "Verifique sempre descontos de estudante, vouchers acadêmicos e política de retake no portal oficial.",
		verifiedAt: "2026-11-24",
		defaultStatus: "locked",
	},
];

const TEMPLATE_ANTI_GOALS: CertificationAntiGoal[] = [
	{
		id: "anti-goal-expensive-premature",
		title: "Certificações caras antes da base prática",
		costOrRisk: "US$ 500–2.000+ sem retorno imediato",
		reason:
			"Investir em provas de nicho ou alto custo antes de dominar os fundamentos e publicar projetos reais raramente acelera a contratação.",
		alternative:
			"Priorize projetos documentados (P1–P3), certificações acessíveis de alto reconhecimento e validação prática primeiro.",
		severity: "avoid",
	},
	{
		id: "anti-goal-certificate-hoarding",
		title: "Colecionar certificados de participação sem projeto",
		costOrRisk: "Alto tempo investido, baixo sinal técnico",
		reason:
			"Gerentes técnicos avaliam muito mais um projeto real com medições, decisões e código/esquemas claros do que dezenas de PDFs de cursos assistidos.",
		alternative:
			"Vincule cada bloco de estudo a um entregável observável no seu portfólio.",
		severity: "reject",
	},
];

const TEMPLATE_PORTFOLIO_PROJECTS: PortfolioProjectSpec[] = [
	{
		id: "project-p1",
		code: "P1",
		monthTarget: "Mês 1",
		title: "Projeto de Entrada — Fundamentos Validados",
		budgetBRLMin: 0,
		budgetBRLMax: 150,
		budgetDisplay: "Baixo custo / R$ 0–150",
		summary:
			"Primeiro projeto compacto e completo para quebrar a inércia: problema claro, solução funcional, testes registrados e README escaneável em 10 segundos.",
		deliverables: [
			{ id: "p1-d1", label: "Especificação curta do problema e critérios de sucesso", required: true },
			{ id: "p1-d2", label: "Implementação funcional com evidências visuais / medições", required: true },
			{ id: "p1-d3", label: "README objetivo seguindo a Regra dos 10 Segundos", required: true },
		],
		unlocks: ["Primeira prova concreta de execução no portfólio"],
		linkedCourseIds: ["template-foundations-core"],
		linkedCertIds: ["cert-starter-badge"],
	},
	{
		id: "project-p2",
		code: "P2",
		monthTarget: "Meses 2–4",
		title: "Projeto Core — Fluxo Profissional de Ponta a Ponta",
		budgetBRLMin: 100,
		budgetBRLMax: 400,
		budgetDisplay: "Moderado / R$ 100–400",
		summary:
			"Projeto intermediário usando ferramentas reais do mercado, incluindo logs de depuração, decisões de arquitetura e validação de casos de erro.",
		deliverables: [
			{ id: "p2-d1", label: "Arquitetura/esquema revisado antes da execução", required: true },
			{ id: "p2-d2", label: "Log de bring-up / depuração com falhas encontradas e corrigidas", required: true },
			{ id: "p2-d3", label: "Demonstração curta em vídeo ou capturas reais de validação", required: true },
		],
		unlocks: ["Evidência sólida para entrevistas técnicas"],
		linkedCourseIds: ["template-practical-toolchain", "template-open-textbook"],
		linkedCertIds: ["cert-core-exam"],
	},
	{
		id: "project-p3",
		code: "P3",
		monthTarget: "Meses 6–9",
		title: "Projeto Capstone — Problema Complexo & Escala",
		budgetBRLMin: 200,
		budgetBRLMax: 800,
		budgetDisplay: "Sob medida",
		summary:
			"Projeto autoral principal da trilha integrando múltiplas habilidades, testes de estresse e análise de trade-offs técnicos.",
		deliverables: [
			{ id: "p3-d1", label: "Documento de trade-offs e requisitos quantitativos", required: true },
			{ id: "p3-d2", label: "Validação quantitativa sob carga / casos extremos", required: true },
			{ id: "p3-d3", label: "Repositório reproduzível e estudo de caso publicado", required: true },
		],
		unlocks: ["Diferencial competitivo para vagas e freelas especializados"],
		linkedCourseIds: ["template-advanced-capstone"],
		linkedCertIds: [],
	},
];

export const TEMPLATE_INTENSIVE_TRACK: IntensiveTrackSpec = {
	id: TEMPLATE_INTENSIVE_TRACK_ID,
	domainId: "general",
	title: "Intensiva · Trilha Personalizada",
	subtitle: "Estrutura de Estudo Intensivo por Tiers, Portfólio, Certificações e Ritmo",
	tagline:
		"Modelo genérico pronto para personalizar em data/intensive/track.json — organize cursos, vídeos locais com transcrição GPU, projetos e ritmo sustentável.",
	verifiedAt: "2026-11-24",
	revalidationNotice:
		"Este é o catálogo modelo público da seção Intensiva. Para usar sua própria trilha pessoal (fora do Git), crie o arquivo intensive/track.json na sua pasta de dados (veja docs/intensive-tracks.md).",
	parallelCourseId: "template-parallel-deep-dive",
	tiers: TEMPLATE_TIERS,
	courses: TEMPLATE_COURSES,
	certifications: TEMPLATE_CERTIFICATIONS,
	certificationAntiGoals: TEMPLATE_ANTI_GOALS,
	tenSecondRule: {
		ignoredByManagers: [
			"Repositórios sem imagem/demo no topo do README",
			"Projetos copiados de tutorial sem modificação própria nem medições",
			"Listas longas de certificados sem evidência de prática real",
		],
		criteria: [
			{
				id: "r10-1",
				order: 1,
				title: "Prova visual imediata acima da dobra",
				description: "Foto real, diagrama limpo ou captura de medição logo nos primeiros segundos do README.",
			},
			{
				id: "r10-2",
				order: 2,
				title: "Problema, restrições e resultado mensurável",
				description: "Explique em 3 linhas qual problema foi resolvido, sob quais limites e como você mediu o resultado.",
			},
			{
				id: "r10-3",
				order: 3,
				title: "Decisões de engenharia e trade-offs",
				description: "Mostre por que escolheu a arquitetura A em vez da B — isso diferencia execução real de cópia.",
			},
			{
				id: "r10-4",
				order: 4,
				title: "Diário de depuração (Bring-Up / Post-Mortem)",
				description: "Documente 1 ou 2 falhas reais encontradas durante a construção e como você diagnosticou e corrigiu.",
			},
		],
	},
	portfolioProjects: TEMPLATE_PORTFOLIO_PROJECTS,
	benchKit: {
		legalNote: "Adapte este roadmap de kit prático aos equipamentos, licenças ou ferramentas reais da sua área de estudo.",
		enxutoSummary: "Fase 1 (Kit Enxuto): apenas o mínimo indispensável para praticar desde o Dia 1 sem gastar demais.",
		upgradeSummary: "Fase 2 (Upgrade): invista em ferramentas melhores somente depois de validar constância nos projetos P1–P2.",
		paybackNote: "Mantenha um registro claro do que você já possui para evitar compras duplicadas ou impulsivas.",
		items: [
			{
				id: "kit-starter-core",
				phase: "kit-enxuto",
				name: "Ferramenta/Setup mínimo de prática (Fase 1)",
				costDisplay: "Baixo custo",
				notes: "Equipamento ou ambiente básico para executar os exercícios do Tier 1 e Projeto P1.",
			},
			{
				id: "kit-upgrade-pro",
				phase: "upgrade-lab",
				name: "Upgrade de medição / produtividade (Fase 2)",
				costDisplay: "Opcional no Mês 2–3",
				notes: "Adquira apenas quando os projetos P2–P3 exigirem maior precisão ou velocidade.",
			},
			{
				id: "kit-antigoal-impulse",
				phase: "anti-goal",
				name: "Equipamento caro ou subdimensionado comprado por impulso",
				costDisplay: "Evitar",
				notes: "Liste aqui armadilhas comuns de compra da sua área para não desperdiçar orçamento.",
			},
		],
	},
	benchInterviewChecklist: [
		{
			id: "bench-1",
			order: 1,
			title: "Segurança e boas práticas fundamentais",
			requirement: "Executar os procedimentos básicos de segurança e higiene técnica da área sem hesitar.",
			eliminatory: true,
		},
		{
			id: "bench-2",
			order: 2,
			title: "Leitura e interpretação de documentação técnica",
			requirement: "Localizar especificações, limites e diagramas em manuais oficiais em poucos minutos.",
			eliminatory: true,
		},
		{
			id: "bench-3",
			order: 3,
			title: "Diagnóstico em voz alta passo a passo",
			requirement: "Formular hipóteses ordenadas, isolar variáveis e explicar o raciocínio durante um teste prático.",
			eliminatory: true,
		},
		{
			id: "bench-4",
			order: 4,
			title: "Apresentação objetiva do Projeto P1/P2",
			requirement: "Defender decisões técnicas, medições e lições aprendidas em 3 minutos claros.",
			eliminatory: false,
		},
	],
	careerGuidance: {
		cboToNocAvoid:
			"Evite vagas ou rotinas repetitivas sem evolução técnica que não geram evidência de projeto nem aprofundamento na área-alvo.",
		cboToNocTarget:
			"Mire desde o início em funções com prática real de diagnóstico, criação, documentação e crescimento mensurável.",
		formalWindows: [
			{
				id: "win-example-1",
				dateLabel: "Semestral / Anual",
				title: "Janelas de inscrição, exames e bolsas",
				details:
					"Use esta seção no seu track.json para registrar prazos importantes (provas, programas técnicos, laboratórios abertos ou editais).",
				verifiedAt: "2026-11-24",
			},
		],
		targetCompanies: [
			"Adicione em track.json suas empresas-alvo",
			"Times de engenharia / pesquisa",
			"Laboratórios e projetos open-source",
		],
		internationalCvOrder: [
			"1. Resumo técnico objetivo + link para portfólio verificado",
			"2. Projetos reais (P1–P3) com métricas, evidências e decisões",
			"3. Certificações verificáveis e credenciais",
			"4. Experiência prática, educação e idiomas",
		],
	},
	pacingProfiles: {
		"full-time-home": {
			mode: "full-time-home",
			label: "Dedicação Integral",
			dailyDomainMinutesMin: 180,
			dailyDomainMinutesMax: 300,
			defaultDailyDomainMinutes: 240,
			dailyLanguageMinutesMin: 45,
			dailyLanguageMinutesMax: 90,
			defaultDailyLanguageMinutes: 60,
			dailyParallelCourseMinutesMin: 45,
			dailyParallelCourseMinutesMax: 60,
			defaultDailyParallelCourseMinutes: 50,
			passiveVideoCapMinutesMin: 90,
			passiveVideoCapMinutesMax: 120,
			defaultPassiveVideoCapMinutes: 105,
			theoryToPracticeRatio: "50% teoria / análise ativa × 50% prática mão na massa e projetos",
			summary:
				"3h–5h/dia no domínio principal (incluindo 45–60 min fixos na trilha paralela) + bloco diário de idioma técnico, mantendo 1 dia livre por semana.",
		},
		"with-clt": {
			mode: "with-clt",
			label: "Conciliando com Trabalho",
			dailyDomainMinutesMin: 90,
			dailyDomainMinutesMax: 150,
			defaultDailyDomainMinutes: 120,
			dailyLanguageMinutesMin: 30,
			dailyLanguageMinutesMax: 60,
			defaultDailyLanguageMinutes: 45,
			dailyParallelCourseMinutesMin: 30,
			dailyParallelCourseMinutesMax: 45,
			defaultDailyParallelCourseMinutes: 40,
			passiveVideoCapMinutesMin: 60,
			passiveVideoCapMinutesMax: 90,
			defaultPassiveVideoCapMinutes: 75,
			theoryToPracticeRatio: "50% estudo ativo × 50% projeto do portfólio e revisão",
			summary:
				"1h30–2h30/dia sustentáveis em paralelo ao trabalho, priorizando consistência semanal, sono e avanço contínuo nos projetos.",
		},
	},
	pacingRules: [
		{
			id: "pacing-r1-sustainable-load",
			order: 1,
			title: "Carga Diária Sustentável",
			summary:
				"Calibre as horas ao seu momento de vida real para manter constância por meses sem fadiga cognitiva.",
			guardrails: [
				"Dedicação integral: 3h–5h/dia de foco real + 1 idioma técnico.",
				"Conciliando com trabalho: 1h30–2h30/dia focados em progresso mensurável.",
			],
		},
		{
			id: "pacing-r2-parallel-cadence",
			order: 2,
			title: "Cadência Paralela para Cursos Extensos",
			summary:
				"Estude cursos muito longos em blocos diários fixos de 45–60 min sem bloquear projetos práticos ou certificações.",
			guardrails: [
				"Nunca trave o Tier 1/2 ou o primeiro projeto esperando concluir um curso de 100+ horas.",
			],
		},
		{
			id: "pacing-r3-comprehension-first",
			order: 3,
			title: "Regra 50/50 Teoria × Prática Ativa (Comprehension-First)",
			summary:
				"Compreensão real vence horas assistidas: limite vídeo passivo e pause antes da resposta para testar sua própria hipótese.",
			guardrails: [
				"Teto de vídeo passivo: no máximo 90–120 min contínuos por dia.",
				"Evite velocidade 2× em análise técnica: pause, preveja o resultado e valide com o Tutor IA.",
			],
		},
		{
			id: "pacing-r4-tier4-surgical",
			order: 4,
			title: "Regra Cirúrgica do Tier 4",
			summary:
				"Use o Tier 4 apenas para destravar uma dúvida pontual e retorne imediatamente ao fluxo Core.",
			guardrails: [
				"O Tier 4 nunca penaliza o Progresso Core %.",
			],
		},
		{
			id: "pacing-r5-antiburnout",
			order: 5,
			title: "Anti-Burnout & Revisão Semanal",
			summary:
				"Reserve 1 dia semanal de descanso real e uma revisão curta de 60 min para atualizar portfólio, flashcards e metas.",
			guardrails: [
				"Projeções de prazo usam 6 dias ativos por semana para preservar consolidação de memória.",
			],
		},
	],
};

export const INTENSIVE_TRACKS: Record<string, IntensiveTrackSpec> = {
	[TEMPLATE_INTENSIVE_TRACK.id]: TEMPLATE_INTENSIVE_TRACK,
};

export function getIntensiveTrack(trackId: string): IntensiveTrackSpec | null {
	return INTENSIVE_TRACKS[trackId] ?? null;
}

export function listIntensiveTracks(): IntensiveTrackSpec[] {
	return Object.values(INTENSIVE_TRACKS);
}
