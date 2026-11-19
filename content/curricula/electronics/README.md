# Currículo de Eletrônica (`electronics`)

Currículo de Eletrônica do learnharness, dos princípios até o nível de doutorado, com textos em pt-BR e identificadores em inglês. A etapa 1 montou o esqueleto, a etapa 2 materializou os átomos das duas áreas de entrada (`ee.math` e `ee.physics`) e a etapa 3 fez uma revisão pedagógica adversarial de todo o grafo (ver [Revisão pedagógica](#revisão-pedagógica-etapa-3)). São 1010 nós: 1 domínio, 16 áreas, 131 unidades, 600 tópicos e 262 átomos. Dos tópicos, 53 já são contêineres de átomos e 547 ainda são stubs, que serão refinados em átomos de 10 a 45 min por patches de expansão.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `00-root.json` | raiz `ee` (kind `domain`) e as 16 áreas |
| `NN-<area>.json` | unidades, tópicos e átomos de uma área, arestas não bloqueantes da área e as fontes citadas nas âncoras |

Cada arquivo segue `CurriculumSeedFile` (`src/core/curriculum/types.ts`) com `schemaVersion: 1`, `domainId: "electronics"`, `areaId`, `items`, `edges` e `sources`. Os itens usam só os campos de `SeedItem`. Em `01-math.json` e `02-physics.json`, cada átomo vem logo depois do seu tópico.

## Áreas

| # | id | Área | Unidades | Tópicos | Átomos | Horas (lo–hi) | Núcleo (mid) | Especialização (mid) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 | `ee.math` | Ferramentas matemáticas | 10 | 42 | 187 | 109,75–150,45 | 130,1 | 0 |
| 02 | `ee.physics` | Física essencial: eletromagnetismo e física moderna | 5 | 19 | 75 | 45,25–63 | 54,1 | 0 |
| 03 | `ee.dc` | Circuitos de corrente contínua | 7 | 30 | 0 | 71–101 | 86 | 0 |
| 04 | `ee.ac` | Transientes e corrente alternada | 8 | 36 | 0 | 96–132 | 114 | 0 |
| 05 | `ee.instruments` | Laboratório, medição e simulação | 5 | 24 | 0 | 55–79 | 67 | 0 |
| 06 | `ee.semi` | Física de semicondutores e dispositivos | 10 | 43 | 0 | 116–159 | 102,5 | 35 |
| 07 | `ee.analog` | Eletrônica analógica | 14 | 69 | 0 | 182–251 | 216,5 | 0 |
| 08 | `ee.digital` | Sistemas digitais e arquitetura de computadores | 9 | 46 | 0 | 127–174 | 112,5 | 38 |
| 09 | `ee.signals` | Sinais e sistemas | 10 | 43 | 0 | 123–166 | 106 | 38,5 |
| 10 | `ee.embedded` | Sistemas embarcados | 9 | 53 | 0 | 148–202 | 140,5 | 34,5 |
| 11 | `ee.power` | Eletrônica de potência | 10 | 43 | 0 | 118–160 | 100,5 | 38,5 |
| 12 | `ee.control` | Sistemas de controle | 9 | 36 | 0 | 99–135 | 82 | 35 |
| 13 | `ee.rf` | Eletromagnetismo aplicado, RF e micro-ondas | 7 | 38 | 0 | 108–146 | 78 | 49 |
| 14 | `ee.pcb` | PCB, integridade de sinal e EMC | 5 | 22 | 0 | 55–76 | 65,5 | 0 |
| 15 | `ee.ic` | Projeto de circuitos integrados analógicos e mistos | 8 | 31 | 0 | 94–124 | 0 | 109 |
| 16 | `ee.research` | Prática profissional e pesquisa | 5 | 25 | 0 | 71–96 | 31 | 52,5 |
| | | **Total** | **131** | **600** | **262** | **1618–2214,45** | **1486,2** | **430** |

O núcleo, formado pelos itens sem tag `spec:*`, soma 1250–1722,45 h (1486,2 h no ponto médio). As especializações (`spec:analog-ic`, `spec:rf`, `spec:power`, `spec:embedded`, `spec:dsp`, `spec:control`, `spec:devices`, `spec:digital-ic` e `spec:research`) somam 430 h no ponto médio. As horas estimam estudo e exercícios:

- um tópico-stub fica entre 1 e 4 h;
- um átomo fica entre 24 e 45 min (média de 36,8 min no ponto médio);
- um contêiner soma os filhos. Por isso um tópico materializado vale a soma dos seus átomos (1,9–4,3 h).

## Átomos (etapa 2)

As áreas materializadas são `ee.math` e `ee.physics`. Elas são as únicas que não dependem de nenhuma outra área, e o aluno as estuda primeiro. A rota do esqueleto vai de matemática a física e depois a CC, e `ee.dc` já exige física (carga, campo e potencial). A etapa 3 acrescentou a essas duas áreas 8 tópicos-stub (variáveis complexas, integrais múltiplas, matemática discreta e física moderna), que ainda serão refinados em átomos; os números abaixo valem para os 53 tópicos da etapa 2.

- **Tópico materializado.** Cada um dos 53 tópicos das duas áreas virou um contêiner com status `stable`.
  - Tem de 4 a 6 átomos: 42 tópicos têm 5, 7 têm 4 e 4 têm 6.
  - As horas são a soma dos átomos. A razão entre essa soma e a estimativa original do tópico fica entre 0,86 e 1,07, com mediana de 0,90, dentro dos ±25 % de conservação do refinamento.
  - As horas das unidades, das áreas e da raiz foram recalculadas pela soma.
- **Id do átomo:** `ee.<área>.<unidade>.<tópico>.<átomo>`, por exemplo `ee.math.calc.integrals.ftc`.
- **Campos do átomo:**
  - `atomType` vale `concept`, `procedure`, `lab` ou `checkpoint`. Há 147 de procedimento, 101 de conceito, 8 de laboratório e 6 de checkpoint.
  - Tem de 1 a 3 `objectives` avaliáveis, `assess`, `misconceptions` e `bloom`.
  - `level` usa a banda do tópico.
  - `hours` usa múltiplos de 3 min, ou seja, 0,05 h exatos.
  - As `tags` são as do tópico, mais `lab`, `computing` ou `safety` quando cabem.
  - As âncoras ficam no tópico. O átomo não grava `anchors` nem `scope`, e o carregador usa o `summary` como escopo.
- **Pré-requisitos dos átomos.**
  - Um átomo exige diretamente os irmãos de que precisa, sem impor uma fila única.
  - 34 membros apontam para átomos ou tópicos de outras unidades, por exemplo `ee.math.complex.phasor-math.phasor-derivative` → `ee.math.calc.derivatives.trig-exp-derivatives`.
  - No total são 253 membros de cláusula.
- **`encompasses`.** São 212 entradas, com pesos de 0,3 a 0,7. Cada uma aponta para um pré-requisito efetivo que o átomo pratica de novo, dando crédito implícito de repetição.
- **Requisitos de entrada enxugados.**
  - O requisito pesado que só alguns átomos usam desceu do tópico para esses átomos.
  - Por exemplo, `ee.math.calc.derivatives` exige só `limits-continuity`, e `ee.math.numerical.python-numpy` não exige nada.
  - Assim, o aluno começa o tópico mais cedo, e o marco continua exigindo tudo.
- **Rota de técnico preservada.** Os tópicos `ee.dc.basics.*`, `ee.dc.laws.*` e `ee.dc.methods.*` continuam sem cálculo no fecho de pré-requisitos.
  - O fecho até `ee.dc.basics.ohms-law` caiu de 33,5 h para 30,5 h.
  - O fecho até `ee.dc.methods.nodal` caiu de 50,5 h para 46,8 h.
  - O marco `ee.math.complex.phasor-math` agora inclui cálculo, por causa da regra d/dt ↔ jω. Os dois tópicos que o exigem já exigiam cálculo antes: `ee.ac.phasors.phasor-domain` e `ee.rf.em.maxwell-differential`.

## Revisão pedagógica (etapa 3)

A etapa 3 revisou o grafo inteiro como um professor de engenharia elétrica faria, procurando lacunas, pré-requisitos errados, ordem ilógica, horas irreais, granularidade desigual, títulos imprecisos e erros técnicos. As referências foram as de `docs/research/r3-geracao-curriculo-grafo.md` §3.1: os cursos do MIT OCW (6.002, 6.012, 6.003, 6.004, 6.013, 6.776 e outros), as 17 áreas do NCEES FE Electrical and Computer, os critérios de programa da ABET para EE (EDOs, álgebra linear, variáveis complexas e matemática discreta), o IEEE/ACM CE2016 e o ModEL. Nenhum id existente mudou e nenhum item foi removido.

**Lacunas.** Entraram 34 tópicos (23 de conteúdo e 11 fases de projeto) e 4 unidades, todos como stubs:

| Área | Itens novos | Motivo |
| --- | --- | --- |
| `ee.math` | `transforms.complex-analysis`, `calc.multiple-integrals` e a unidade `discrete` (lógica e indução, aritmética modular e GF(2), grafos) | Variáveis complexas e matemática discreta são exigidas pela ABET. Fluxo e lei de Gauss usavam integrais duplas que nunca eram ensinadas. |
| `ee.physics` | unidade `modern` (fótons e níveis de energia, dualidade e tunelamento, kT e Boltzmann) | Bandas de energia e estatística de Fermi não tinham base física. |
| `ee.ac` | `threephase.power-grid-basics` | Faltavam o sistema por unidade e a estrutura de transmissão e distribuição (NCEES FE §10). |
| `ee.analog` | `oscillators.pll-basics` e a unidade `converters` (DAC, arquiteturas de ADC, erros e especificações) | PLLs e conversores de dados só apareciam na banda 4 (RF CMOS e CI). |
| `ee.digital` | `numbers.error-codes` (paridade, CRC e Hamming) | CRC e Hamming eram usados por bootloader e codificação de canal sem serem ensinados. |
| `ee.signals` | `comms.baseband-pulses` (PCM, códigos de linha, ISI) e `comms.multiplexing` | Faltavam a transmissão em banda base e a multiplexação (NCEES FE §13). |
| `ee.embedded` | `c.data-structures` e `comms.network-fundamentals` | Estruturas de dados (FE §17) e redes (FE §14) estavam ausentes ou espremidas em um tópico de MQTT. |
| `ee.power` | unidade `machines` (indução, síncrona e PMSM, vetores espaciais) e `acdc.class-d` | O controle vetorial exigia só a visão geral de motores, e classe D não aparecia em nenhuma área. |
| `ee.control` | `pid.feedforward-cascade` | Cascata e pré-alimentação são a base de acionamentos e de conversores. |

**Pré-requisitos.**

- `ee.dc.methods.nodal` e `ee.dc.methods.mesh` exigiam `ee.math.linalg.linear-systems`. Para 2 ou 3 incógnitas basta resolver o sistema à mão, e `ee.math.algebra.linear-equations` já está no fecho. Matrizes viraram `softPrereqs`, e o fecho de `nodal` encolheu cerca de 6 h, ainda sem cálculo. Quem passa a exigir `linear-systems` é a formulação matricial (`matrix-formulation`).
- `ee.semi.materials.crystal-bands` e `fermi-statistics` passam a exigir a física moderna. Duas arestas que ficaram transitivas saíram: `drift-diffusion` → derivadas e `pn-equilibrium` → lei de Gauss.
- `ee.embedded.comms.usb` exigia DMA, que um dispositivo USB não precisa, e agora exige interrupções. `networking-iot` deixou de exigir rádio, que virou `softPrereqs`.
- `bootloader-ota` e `channel-coding` exigem `error-codes`. `motor-drives` exige `space-vectors`. `pll-synth` e `cp-pll` exigem `pll-basics`. `converter-specs` (CI) exige `converter-errors`. `distributed-control` exige grafos.
- Os `softPrereqs` novos ordenam sem bloquear: variáveis complexas antes de Nyquist e da transformada Z, estruturas de dados antes da UART e erros de conversores antes do ADC do microcontrolador.

**Ordem.** Em `ee.analog`, os op-amps passaram da 6ª para a 2ª unidade, porque só exigem fontes dependentes, como em Sedra/Smith e no MIT 6.002. Os conversores entram depois dos reguladores, e ruído e projeto ficam no fim. Em `ee.math.calc`, integrais múltiplas vêm antes de cálculo vetorial.

**Horas irreais.** Cada projeto integrador tinha 3–4 h e virou fases de até 4 h. A última fase mantém o id original.

- O amplificador de áudio, o front-end de sensor, o registrador de dados e o nó IoT têm 2 fases cada.
- O buck síncrono e a placa de sinal misto têm 3 fases cada.
- O projeto de CI tem 4 fases.
- A tese passa a dizer que as horas cobrem as habilidades de pesquisa (pergunta, proposta e escrita), não a execução. O primeiro artigo cai de 4–4 h para 3–4 h.

**Títulos, resumos e erros técnicos.**

- Unidades irmãs com títulos quase iguais viraram I e II, com o conteúdo no título: `ee.digital.vlsi` e `vlsi-adv`, `ee.embedded.advanced` e `systems-adv`, `ee.control.advanced` e `advanced-2`, `ee.power.advanced` e `systems-adv`. `ee.digital.boolean.boolean-algebra` repetia o título da unidade.
- O escopo de `ee.signals.random.lti-random` estava truncado ("Dentro: S_y =. Fora: H.").
- A concepção equivocada de `ee.semi.pn.pn-iv` estava errada. Em silício, a corrente reversa cresce com a tensão reversa mesmo abaixo da ruptura, por causa da geração na região de depleção.
- Os resumos de `ee.math.linalg.matrices` e `linear-systems` não batiam com os átomos: determinante, inversa e Cramer ficam em `matrices`.
- Sobreposições removidas: ataques físicos só em `hardware-security`, drivers de kernel só em `linux-drivers`, e DNL, INL e ENOB no núcleo, com teste e figuras de mérito no CI.

**Pendente.** O painel de saúde (não o lint) ainda aponta 39 contêineres fora da faixa de filhos de r3 §4.1, o mesmo número de antes. São sobretudo unidades de 2 ou 3 tópicos, que pedem uma reorganização própria.

## Convenções

- **Ids:** `ee.<area>.<unidade>.<tópico>[.<átomo>]`, com segmentos em inglês e em kebab-case, seguindo `CURRICULUM_ID_PATTERN`. O `parentId` é sempre o id sem o último segmento. O kind segue a profundidade: domain, area, unit, topic e atom.
- **Níveis:** `level: {scheme: "ee", band}`, com 0 para fundamentos, 1 para técnico, 2 para graduação, 3 para graduação avançada e 4 para pós-graduação e doutorado. Um pré-requisito nunca tem banda maior que a do item que o exige.
- **Status:**
  - Os tópicos ainda não refinados são `stub`.
  - Os tópicos materializados e os átomos são `stable`.
  - Domínio, áreas e unidades são `provisional`.
- **Bloom:** vem do verbo de maior nível entre os objetivos.
  - Nos átomos, o padrão é `understand` para conceito, `apply` para procedimento e `analyze` para laboratório e checkpoint.
- **Tags:** `core`, `spec:<trilha>`, `lab`, `design-project`, `computing` e `safety`.
- **Projetos:** um projeto integrador é dividido em fases de até 4 h, com títulos `…, fase N: …`, cada fase exigindo a anterior. A última fase mantém o id do projeto, por exemplo `ee.power.project.buck-project`.

## Pré-requisitos

- As `clauses` são um OU de Es com no máximo 2 alternativas (modo estrito). Cada membro é **necessário, não suficiente** e **direto, não transitivo**. A redução transitiva foi verificada, e nenhuma aresta implicada fica armazenada.
- As cláusulas nunca citam um ancestral nem um descendente.
- Uma cláusula de contêiner é um requisito de **entrada**, herdado pelos filhos-fonte. Hoje há 52 contêineres assim:
  - os 50 tópicos materializados que têm cláusulas;
  - `ee.dc.laws`, que exige `ee.dc.basics.ohms-law` e `ee.dc.basics.schematics`;
  - `ee.research.fronts`, que exige `ee.research.method.literature-review`.
- Um contêiner é um marco, concluído quando todos os filhos estão concluídos. Quem exige `ee.math.calc.integrals` exige, portanto, todos os seus átomos.
- A rota de técnico e a de engenharia convivem. Os tópicos de banda 1 exigem a visão qualitativa (`ee.semi.intro.*`), e o tratamento físico da banda 2 entra como `softPrereqs`, que ordena sem bloquear.
- As arestas `related`, `also_in` e `confusable_with` ligam tópicos próximos de áreas diferentes e não bloqueiam nada.

## Âncoras e licenças

Os títulos, resumos, escopos, objetivos e concepções equivocadas são texto original, incluindo o dos átomos. Nenhum trecho das fontes foi copiado. Cada âncora (`anchors`) é só uma **referência**: o número de seção da especificação NCEES FE Electrical and Computer, o nome de um módulo do ModEL, o tema do sumário de um livro ou o curso do MIT OCW. O array `sources` de cada arquivo traz título, URL e nota de licença de cada fonte usada.

- `embeddable: true` só aparece em fontes cuja licença permite a incorporação com atribuição: ModEL (CC BY 4.0), NEETS (domínio público), OpenStax CC BY (incluindo University Physics vol. 3, nova na etapa 3), Ellingson (CC BY-SA 4.0), manual RISC-V (CC BY 4.0), documentação do KiCad e PDK SKY130 (Apache-2.0).
- `embeddable: false` vale para NCEES, ABET, IEEE/ACM CE2016, normas ABNT e NR, GUM, MIT OCW (CC BY-NC-SA, incluindo 18.04, 6.042J e 6.685, novos na etapa 3), OpenStax Calculus (CC BY-NC-SA), livros comerciais e artigos IEEE. Lessons in Electric Circuits também é tratado como só referência, porque a licença varia entre as edições.
- Nenhuma fonte tem `usage: "embedded"`.

Os dados deste diretório seguem a licença de `content/curricula/LICENSE` (CC BY-SA 4.0), separada do código AGPL-3.0.

## Validação

Os JSON são a fonte da verdade. Depois de editá-los, rode o pipeline do próprio repositório: parse zod, montagem do patch de seed e invariantes em modo estrito. Ele cobre ids, hierarquia, referências, alternativas efetivas, ciclos no grafo efetivo com as arestas suaves e as rotas. Os avisos cobrem granularidade (átomos fora de 10–45 min), arestas transitivas, monotonicidade de nível e `encompasses`.

```sh
node --input-type=module -e '
import fs from "node:fs";
import { applySeedFiles, validateReport } from "./src/core/curriculum/index.ts";
const dir = "content/curricula/electronics";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
const res = applySeedFiles(files, { createdAt: "2026-01-01T00:00:00.000Z" });
if (!res.ok) { console.error(res.errors); process.exit(1); }
const rep = validateReport(res.snapshot, { edgeMode: "strict" });
console.log({ errors: rep.errors.length, warnings: rep.warnings.length, stats: rep.stats });
process.exit(rep.errors.length ? 1 : 0);
'
```

Esse comando roda no Node 24 ou mais recente, que remove os tipos do TypeScript sozinho, e não grava nada. O estado atual passa com 0 erros e 0 avisos: são 1010 itens e 809 folhas (547 stubs e 262 átomos).
