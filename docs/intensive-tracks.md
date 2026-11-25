# Trilha Intensiva (`Intensiva`) — Guia de Organização e Personalização

A seção **Intensiva** (`/intensiva`) do TrilhaAtlas oferece um painel completo para organizar jornadas aceleradas de estudo em qualquer área (Engenharia, Eletrônica, Programação, Idiomas, Certificações, Pesquisa, etc.), mantendo **sua trilha pessoal fora do Git** enquanto o repositório público entrega o layout, o motor de progresso, o player local com transcrição GPU e um template inicial pronto para adaptar.

---

## Como a arquitetura funciona

1. **Template público inicial (`src/core/intensive/catalog-template.ts`)**:
   - Quando não existe um catálogo pessoal em disco, o app exibe um modelo genérico demonstrando todos os recursos (Tiers 1–4, curso paralelo diário, certificações + anti-goals, projetos de portfólio sob a Regra dos 10 Segundos, kit prático, checklist eliminatório e ritmo *comprehension-first*).
2. **Sua trilha pessoal isolada por domínio e fora do Git (`domains/<dominio>/intensive/track.json`)**:
   - Cada domínio de estudo tem sua própria trilha intensiva, progresso, vídeos e materiais isolados — trocar de **Eletrônica** para **Inglês** (ou qualquer domínio criado por você) troca automaticamente o contexto da Intensiva:
     - **Por domínio no App Desktop (Windows):** `%APPDATA%\TrilhaAtlas\data\domains\<dominio>\intensive\track.json` (ex.: `domains\electronics\intensive\track.json`, `domains\english\intensive\track.json`)
     - **Por domínio em dev local (`npm run dev`):** `data/domains/<dominio>/intensive/track.json` (já ignorado pelo `.gitignore`)
     - **Modo Geral (sem domínio ativo):** `<LH_DATA_DIR>/intensive/track.json`
3. **Progresso, vídeos e materiais isolados**:
   - Seu progresso (`state.json`), vínculos de pastas locais (`sources.json`), transcrições (`media/<courseId>/transcripts/`) e materiais PDF/DOCX indexados (`materials/<courseId>/`) ficam todos dentro da pasta `intensive/` do respectivo domínio — completamente fora do Git.

---

## Como criar e organizar sua própria trilha

### Passo 1 — Copie o exemplo pronto

Comece copiando o exemplo válido de [`examples/intensive/sample-track.json`](../examples/intensive/sample-track.json) para o seu diretório de dados:

```powershell
# Desenvolvimento local (repo)
New-Item -ItemType Directory -Force -Path "data\intensive" | Out-Null
Copy-Item "examples\intensive\sample-track.json" "data\intensive\track.json"

# App Desktop instalado (Windows)
New-Item -ItemType Directory -Force -Path "$env:APPDATA\TrilhaAtlas\data\intensive" | Out-Null
Copy-Item "examples\intensive\sample-track.json" "$env:APPDATA\TrilhaAtlas\data\intensive\track.json"
```

### Passo 2 — Organize os 4 Tiers

A estrutura em 4 Tiers separa execução obrigatória de consulta sob demanda para evitar sobrecarga:

| Tier | Papel | Entra no Core %? | Exemplo de conteúdo |
| --- | --- | --- | --- |
| **Tier 1** | Base + 1º Portfólio | Sim (`core`) | Fundamentos, segurança, vocabulário técnico e primeiro projeto rápido |
| **Tier 2** | Ferramentas + Certificação | Sim (`core`) | Ferramentas de mercado, livro-texto aberto e preparo para exame âncora |
| **Tier 3** | Especialização & Escala | Sim (`core`) | Sistemas avançados, depuração profunda e projeto Capstone |
| **Tier 4** | Biblioteca Sob Demanda | **Não** (`on-demand`) | Cursos longos/acadêmicos de consulta cirúrgica — não penalizam o Core % |

### Passo 3 — Use `parallelCourseId` para cursos muito extensos

Se você tem um curso longo (100+ horas ou centenas de vídeos locais), defina o `id` dele em `parallelCourseId` e adicione `parallelCadence` no curso:

```json
"parallelCadence": {
  "recommendedDailyMinutesMin": 45,
  "recommendedDailyMinutesMax": 60,
  "label": "45–60 min/dia em paralelo",
  "rationale": "Avança todos os dias sem travar projetos nem certificações."
}
```

O planejador calcula automaticamente a previsão de conclusão em paralelo e oferece um atalho dedicado no topo da página (**Abrir bloco paralelo diário**).

### Passo 4 — Vincule pastas locais de vídeo e transcrição GPU

Para qualquer curso com `"deliveryMode": "local-video-pack"`:

1. Abra a seção **Intensiva** e clique em **Vincular pasta local**.
2. Aponte para o diretório com seus arquivos `.mp4` / `.mkv` / `.webm` numerados.
3. Opcionalmente ative a transcrição local com GPU (`scripts/intensive-transcribe.py`), que gera legendas `.vtt`, busca instantânea por timestamp na barra superior e contexto direto para o **Tutor IA** no minuto exato do vídeo.
4. Você também pode anexar PDFs, apostilas e folhas de exercícios diretamente na aba do curso (indexados por `scripts/intensive-index-materials.py`).

### Passo 5 — Defina Certificações, Portfólio e Ritmo

No mesmo `track.json`, preencha:

- **`certifications` e `certificationAntiGoals`**: fases, custos (com suporte a taxa de estudante), checkpoints clicáveis e armadilhas de compra a evitar.
- **`tenSecondRule`, `portfolioProjects`, `benchKit`, `benchInterviewChecklist`**: projetos reais (P1–Pn), lista de equipamentos/setup por fase e checklist eliminatório para simular entrevistas com o Tutor IA.
- **`pacingProfiles` e `pacingRules`**: dois perfis de rotina (`full-time-home` para dedicação integral e `with-clt` para conciliar com trabalho) e guardrails *comprehension-first* (teto de vídeo passivo e regra 50/50 teoria × prática).

---

## Campos obrigatórios do `track.json`

Para ser aceito automaticamente pelo servidor (`src/store/intensive-store.ts`), o JSON deve ser um objeto com:

- `id` (string não vazia) e `domainId` (ex.: `"general"`, `"electronics"`, etc.)
- `title`, `subtitle`, `tagline`, `verifiedAt` (`YYYY-MM-DD`), `revalidationNotice`
- `tiers` (array não vazio de `IntensiveTierSpec`)
- `courses` (array não vazio de `IntensiveCourseSpec`)
- `certifications`, `certificationAntiGoals`, `portfolioProjects`
- `tenSecondRule`, `benchKit`, `benchInterviewChecklist`, `careerGuidance`
- `pacingProfiles` (`full-time-home` e `with-clt`) e `pacingRules`

A tipagem completa de referência está em [`src/core/intensive/types.ts`](../src/core/intensive/types.ts).
