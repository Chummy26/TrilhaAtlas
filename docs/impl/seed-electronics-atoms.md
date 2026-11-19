# Seed de Eletrônica: etapa 2 (átomos)

Esta etapa materializa os átomos das duas áreas de entrada do domínio `electronics`: `ee.math` e `ee.physics`. Ela segue a SÍNTESE §2.4(e) e §2.7, que pede átomos só nas 2 primeiras áreas. Os dados ficam em `content/curricula/electronics/`. Mudaram `00-root.json`, `01-math.json`, `02-physics.json` e o `README.md`. A licença `content/curricula/LICENSE` já existia e não mudou.

## API pública (dados)

- **Átomos.** São 262 itens com `kind: "atom"`: 187 em `ee.math` e 75 em `ee.physics`.
  - O id segue o formato `ee.<área>.<unidade>.<tópico>.<átomo>`, e o `parentId` é o tópico.
  - Cada átomo traz:
    - `atomType` (`concept`, `procedure`, `lab` ou `checkpoint`);
    - `order`, `title {pt,en}` e `summary`;
    - 1–3 `objectives` avaliáveis, `bloom`, `assess` e `misconceptions`;
    - `level {scheme:"ee", band}`, igual à banda do tópico;
    - `clauses` e `encompasses`, só quando existem;
    - `hours` de 24 a 45 min, em múltiplos de 3 min;
    - `status: "stable"` e `tags`.
  - Os átomos não têm `anchors` nem `scope`. As âncoras continuam no tópico.
- **Tópicos materializados.** São os 53 tópicos das duas áreas.
  - Cada um virou um contêiner com status `stable` e de 4 a 6 átomos.
  - As horas do tópico são a soma das horas dos átomos.
  - As unidades, as áreas e a raiz também foram recalculadas pela soma.
- **Totais.**
  - São 972 nós: 1 domain, 16 areas, 127 units, 566 topics (53 contêineres e 513 stubs) e 262 atoms.
  - Horas por área:
    - `ee.math`: 97,25–132,95 h;
    - `ee.physics`: 38,25–53 h;
    - domínio: 1528,5–2089,95 h (1809,2 h no ponto médio);
    - núcleo: 1389,2 h no ponto médio.

## Decisões

- **Escolha das áreas.** `math` e `physics` são as únicas áreas sem pré-requisito em outras áreas. `ee.dc` exige física, por exemplo carga, campo e potencial.
  - A sugestão "ee.math e ee.dc" foi trocada por `physics` porque o critério da tarefa é estudar primeiro o que não depende de nada.
- **Pré-requisitos.**
  - Um átomo exige diretamente os irmãos de que precisa. Há 34 membros que apontam para outras unidades, num total de 253.
  - Os requisitos de entrada de 13 tópicos foram enxugados. O pré-requisito pesado desceu para os átomos que o usam. São eles:
    - `polar-euler`, `derivatives`, `eigen`, `second-order`, `systems-ode`, `laplace-def`, `fourier-series-math`, `random-variables`, `python-numpy` e `numerical-methods`;
    - `charge-coulomb`, `gauss-law` e `ampere-biot`.
  - O marco do tópico continua exigindo todos os átomos.
- **Rota de técnico.**
  - Os tópicos `ee.dc.basics/laws/methods` continuam sem cálculo no fecho de pré-requisitos.
  - O fecho de `ee.dc.methods.nodal` caiu de 50,5 h para 46,8 h.
  - `ee.math.complex.phasor-math` passou a exigir derivadas, por causa da regra d/dt ↔ jω. Os dois tópicos que o exigem já tinham cálculo antes: `ee.ac.phasors.phasor-domain` e `ee.rf.em.maxwell-differential`.
- **`encompasses`.** São 212 entradas, com pesos de 0,3 a 0,7, sempre para um pré-requisito efetivo. Assim o lint `encompasses-non-ancestor` fica quieto.
- **Horas.**
  - A primeira estimativa por átomo ficou, em média, em 0,84 da estimativa do tópico. Por isso todos os átomos ganharam +3 min, com teto de 45.
  - Hoje a razão entre a soma dos átomos e a estimativa original do tópico vai de 0,86 a 1,07, com mediana de 0,90. Isso fica dentro do ε de 0,25 do refinamento.
  - Os minutos são múltiplos de 3 para que as horas sejam frações exatas de 0,05.
- **Licenças e contratos.**
  - Todo o texto dos átomos é original.
  - Nenhuma fonte nova entrou, e as âncoras NC e proprietárias continuam com `embeddable: false`.
  - Nenhum contrato e nenhum código do repositório foram alterados.

## Como testar

1. Rode o comando do `README.md` do diretório. Ele executa `applySeedFiles` e `validateReport` em modo estrito, sem gravar nada, e o resultado atual é este:
   - 0 erros e 0 avisos;
   - 972 itens e 775 folhas.
2. Opcionalmente, rode os scripts que ficaram fora do repositório, no diretório de rascunho do agente:
   - O gerador `build-atoms.mjs` parte da cópia do esqueleto da etapa 1 e dos dados `atoms-*.mjs`. A opção `--dry` roda sem gravar.
   - O validador `validate-atoms.mjs` checa:
     - o JSON e os ids, com o pai como prefixo e o kind pela profundidade;
     - as referências de `clauses`, `softPrereqs` e `encompasses`;
     - que nenhuma cláusula cite um ancestral ou um descendente, e que haja no máximo 2 alternativas;
     - as horas: lo ≤ hi, átomos de 10–45 min e conservação de ±25 %;
     - os campos do átomo;
     - os ciclos no grafo efetivo: cláusulas, filho → marco e herança de entrada;
     - os mesmos lints do repositório.
   - O `mutation-test.mjs` aplica 13 mutações numa cópia em `os.tmpdir()`, e todas precisam ser rejeitadas.
