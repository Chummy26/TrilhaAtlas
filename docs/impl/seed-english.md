# Seed de Inglês: etapas 1 e 2

Este seed implementa o "seed fase 1" para o domínio `english`, conforme a SÍNTESE §2.4(e) e §2.7, o r3 §3.2, §4 e §5.3 e o r1 §8. A etapa 2 refina as duas áreas de entrada em átomos.

Os dados estão em `content/curricula/english/`, em 11 arquivos JSON. Eles seguem `CurriculumSeedFile` (`src/core/curriculum/types.ts`). A licença é CC BY-SA 4.0 (`content/curricula/LICENSE`). Os números completos e as decisões detalhadas estão em `content/curricula/english/README.md`.

## API pública (dados)

- **`00-root.json`** (`areaId: "en"`): a raiz `en` (kind `domain`) e as 10 áreas: `pron`, `grammar`, `vocab`, `listening`, `reading`, `speaking`, `writing`, `pragmatics`, `academic` e `fluency`.
- **`NN-<area>.json`**: unidades e tópicos de 1–4 h, com id `en.<área>.<unidade>.<tópico>`.
- **Átomos (etapa 2)**: id `en.<área>.<unidade>.<tópico>.<átomo>`.
  - `en.pron` tem 122 átomos nas unidades `foundations`, `vowels`, `consonants` e `morphophonology`.
  - `en.grammar` tem 156 átomos nas unidades `a1`, `a2` e `a2-plus`.
  - No total, são 72 tópicos refinados, agora `provisional`.
- **Totais**:
  - nós: 1 domain, 10 areas, 71 units, 549 topics e 278 atoms (909 nós, 755 folhas);
  - horas estimadas: 1.220,5–1.747 h;
  - Σ das folhas: 1.221,73–1.735,7 h.
- **Campos do átomo**:
  - `atomType`, `objectives` (1–3) e `bloom`;
  - `assess`, no vocabulário `PRACTICE_ITEM_KINDS`;
  - `misconceptions` PT-BR;
  - `clauses`, `softPrereqs` e `encompasses`;
  - `hours`, de 30 ou 35 min ±20%;
  - `lexicalItems` `{lemma,pos}` nos `lexical_set`;
  - `level` herdado do tópico, `status:"provisional"` e `tags`.

## Decisões

- **Arestas.**
  - `requires` só onde a dependência bloqueia. Entre átomos, isso significa a ordem perceber/entender → produzir/usar dentro do tópico, mais 5 cláusulas entre tópicos em átomos que comparam ou combinam duas estruturas.
  - O resto é `softPrereqs`, inclusive as ligações pronúncia ↔ gramática.
- **Horas.**
  - O tópico refinado mantém a estimativa da etapa 1.
  - Σ átomos / estimativa fica entre 0,902 e 1,000, contra a tolerância do `refine` de ±25%.
  - Os containers somam exatamente os filhos.
- **Pedagogia.**
  - Contrastes fonêmicos seguem HVPT.
  - Verbos irregulares parecidos ficam em lotes diferentes, e um átomo de contraste vem depois.
  - Não há CEFR inventado por lema.
- **Correções no esqueleto.**
  - Redução transitiva em `en.pron.morphophonology.s-endings`.
  - Novo tópico `en.grammar.a1.adjective-position`, que é `softPrereq` de `en.grammar.b1.adjective-order`.
  - `en.grammar.a1.dummy-subjects` foi retitulado para cobrir só o *it*.
- **Contratos.** Nenhum contrato compartilhado foi alterado.

## Como testar

- **Teste do repositório:** `node scripts/run-tests.mjs tests/curriculum-seeds.test.ts`.
  - Carrega em modo estrito, confere o certificado e o replay, e percorre todas as folhas pela fronteira.
  - O `validateReport` dá 0 erros e 18 avisos `encompasses-non-ancestor`, todos da etapa 1, em speaking, writing e fluency.
- **Validador externo da etapa 2:** fica no diretório de rascunho do agente, como script descartável.
  - Verifica schema, ids e hierarquia, referências, ancestral/descendente, ≤ 2 alternativas, horas e faixa de 10–45 min dos átomos, conservação, `assess` e `atomType`, monotonicidade de nível e ciclos no grafo efetivo, com e sem arestas suaves.
  - Resultado: 0 erros.
