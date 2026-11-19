# Seed de Eletrônica: etapa 3 (revisão pedagógica)

Esta etapa revisa, de forma adversarial, todo o currículo `electronics` em `content/curricula/electronics/`. Ela compara o grafo com as referências de `docs/research/r3-geracao-curriculo-grafo.md` §3.1: MIT OCW, as 17 áreas do NCEES FE Electrical and Computer, os critérios da ABET para EE, o IEEE/ACM CE2016 e o ModEL. Os erros encontrados foram corrigidos direto nos JSON. Mudaram 16 dos 17 arquivos (`05-instruments.json` ficou igual) e o `README.md` do diretório. A licença `content/curricula/LICENSE` já existia e não mudou. O código e os contratos do repositório também não mudaram.

## API pública (dados)

- **Totais.** São 1010 nós: 1 domain, 16 areas, 131 units, 600 topics (53 contêineres e 547 stubs) e 262 atoms. As folhas são 809, e há 38 arestas não bloqueantes.
- **Itens novos.** São 4 unidades e 34 tópicos-stub, todos com `status` `stub` (tópicos) ou `provisional` (unidades), âncoras só de referência e horas de até 4 h por folha.
  - Conteúdo (23 tópicos): variáveis complexas, integrais múltiplas, matemática discreta (3), física moderna (3), sistema elétrico por unidade, PLL, conversores de dados (3), códigos de erro, transmissão em banda base, multiplexação, estruturas de dados em C, fundamentos de redes, máquinas elétricas (3), classe D e cascata/feedforward.
  - Fases de projeto (11 tópicos): os projetos integradores viraram fases de até 4 h. A última fase mantém o id antigo.
- **Ids.** Nenhum id existente mudou, e nenhum item foi removido. Os ids novos seguem `CURRICULUM_ID_PATTERN`, e o pai é sempre o prefixo.
- **Fontes novas** (todas `usage: "reference"`): OpenStax University Physics vol. 3 (CC BY 4.0, âncoras `embeddable: true`) e MIT OCW 18.04, 6.042J e 6.685 (CC BY-NC-SA, `embeddable: false`). `neets` passou a constar também em `11-power.json`.
- **Horas por área** (lo–hi):
  - `ee.math` 109,75–150,45; `ee.physics` 45,25–63; `ee.dc` 71–101; `ee.ac` 96–132;
  - `ee.instruments` 55–79; `ee.semi` 116–159; `ee.analog` 182–251; `ee.digital` 127–174;
  - `ee.signals` 123–166; `ee.embedded` 148–202; `ee.power` 118–160; `ee.control` 99–135;
  - `ee.rf` 108–146; `ee.pcb` 55–76; `ee.ic` 94–124; `ee.research` 71–96.
  - O domínio soma 1618–2214,45 h. O núcleo tem 1486,2 h e as especializações têm 430 h, ambos no ponto médio.

## Decisões

- **Stubs, não átomos.** Os tópicos novos de `ee.math` e `ee.physics` ficaram como stubs. Assim, as duas áreas deixam de estar 100 % materializadas até um patch de refinamento criar os átomos deles.
- **Rota de técnico.** `nodal` e `mesh` não exigem mais álgebra matricial (agora `softPrereqs`), e o fecho encolhe cerca de 6 h, ainda sem cálculo. As ferramentas novas de pós ou de graduação avançada entram como `softPrereqs` quando só ordenam. Exemplos: variáveis complexas antes de Nyquist e conversores antes do ADC do microcontrolador.
- **Redução transitiva.** As arestas novas são diretas. Duas antigas ficaram implicadas pela física moderna e saíram: `drift-diffusion` → `ee.math.calc.derivatives` e `pn-equilibrium` → `ee.physics.electrostatics.gauss-law`.
- **`quantum-basics` sem EDO.** Os níveis do poço infinito saem da condição de onda estacionária. Exigir EDO de 2ª ordem alongaria em cerca de 11 h o fecho de toda a física de semicondutores.
- **Projetos em fases.** Projetos de 3–4 h eram irreais. Cada fase tem até 4 h e exige a anterior, e a primeira herda os pré-requisitos do projeto original.
- **Títulos de unidades irmãs** quase iguais viraram I e II, com o conteúdo no título. Escopos sobrepostos foram separados.
- **Cardinalidade.** 39 contêineres continuam fora da faixa de filhos de r3 §4.1, o mesmo número de antes. Isso é achado do painel de saúde, não aviso do lint, e fica para uma reorganização futura.

## Como testar

1. Rode o comando do `README.md` do diretório, que usa `applySeedFiles` e `validateReport` em modo estrito. O resultado atual é 0 erros e 0 avisos, com 1010 itens e 809 folhas.
2. Opcionalmente, use os scripts que ficaram fora do repositório, no rascunho do agente (`ee-review3/`):
   - `apply-review.mjs` reaplica todas as mudanças a partir da cópia original (`orig/`) e é idempotente.
   - `validate.mjs` é o validador independente. Ele checa JSON, envelope, ids e padrão, pai como prefixo, kind pela profundidade, referências, ancestral e descendente, alternativas armazenadas e efetivas (≤ 2), horas (lo ≤ hi, átomos de 10–45 min e soma dos contêineres), ciclos no grafo efetivo e com `softPrereqs`, monotonicidade de banda e folhas acima de 4 h.
   - Uma mutação de teste (um ciclo e uma cláusula para um ancestral) foi rejeitada pelos dois validadores.
