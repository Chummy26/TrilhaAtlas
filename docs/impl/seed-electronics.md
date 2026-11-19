# Seed de Eletrônica: etapa 1 (esqueleto)

Este seed implementa o "seed fase 1" do domínio `electronics` (prefixo `ee`), conforme a SÍNTESE §2.4(e) e §2.7 e o r3 §4. Os dados ficam em `content/curricula/electronics/`: são 17 arquivos JSON e um `README.md`. A licença é a de `content/curricula/LICENSE` (CC BY-SA 4.0), que já existia e não foi alterada.

## API pública (dados)

- **`00-root.json`** (`areaId: "ee"`): a raiz `ee` (kind `domain`) e as 16 áreas:
  - `math`, `physics`, `dc`, `ac`, `instruments`, `semi`, `analog`, `digital`;
  - `signals`, `embedded`, `power`, `control`, `rf`, `pcb`, `ic`, `research`.
- **`NN-<area>.json`**: as unidades e os tópicos `stub` de 1–4 h.
  - Ids no formato `ee.<área>.<unidade>.<tópico>`, com segmentos em inglês.
  - Cada arquivo também traz as arestas não bloqueantes da área e a lista `sources` das fontes citadas.
- **Totais:** 710 nós (1 domain, 16 areas, 127 units, 566 topics).
  - Horas: 1544–2108 h (ponto médio 1826 h).
  - Núcleo, sem tag `spec:*`: 1184–1628 h (ponto médio 1406 h).
  - Especializações: 420 h no ponto médio. São elas `analog-ic`, `rf`, `power`, `embedded`, `dsp`, `control`, `devices`, `digital-ic` e `research`.
- **Campos usados:** `title {pt,en}`, `summary`, `scope` ("Dentro: … Fora: …"), `objectives`, `bloom`, `assess`, `misconceptions` (72 tópicos), `level {scheme:"ee", band 0–4}`, `clauses`, `softPrereqs` (9 itens), `encompasses` (4 itens), `hours`, `anchors`, `status` e `tags`.

## Decisões

- **Pré-requisitos.**
  - São diretos e necessários. A redução transitiva foi verificada: nenhum membro de cláusula é implicado por outro.
  - Há no máximo 2 alternativas, também depois da herança, e 10 itens usam OU.
  - Dois contêineres têm requisito de entrada: `ee.dc.laws` e `ee.research.fronts`.
- **Rota de técnico e rota de engenharia.**
  - Os tópicos de banda 1 que usam dispositivos exigem a visão qualitativa (`ee.semi.intro.*`), e a física de banda 2 entra como `softPrereqs`. Assim o I6 (monotonicidade de nível) vale sem aviso.
- **Direção global das dependências.**
  - A ordem segue matemática, física, CC, CA, instrumentação, semicondutores, analógica, digital, sinais, embarcados, controle, potência, RF, PCB, CI e pesquisa.
  - Os laços entre áreas (por exemplo, potência ↔ PCB) são unidirecionais por tópico.
- **Horas.**
  - As horas dos tópicos estimam estudo com exercícios, e cada contêiner soma exatamente os filhos.
  - O total com especializações passa do `targetHours` padrão do manifesto (1000–1500 h), mas o núcleo fica dentro da meta de 1300–1600 h no ponto médio.
- **Licenças.**
  - Todo o texto é original.
  - NCEES, ABET, CE2016, ABNT e NR, GUM, MIT OCW (NC), livros e IEEE entram só como referência, com `embeddable: false`.
  - `embeddable: true` só aparece para ModEL, NEETS, OpenStax CC BY, Ellingson, RISC-V, KiCad e SKY130.
  - Todas as fontes têm `usage: "reference"`.
- **Contratos.** Nenhum contrato compartilhado foi alterado. O código do repositório não foi tocado, e nada mais fora de `content/curricula/electronics/` mudou.

## Como testar

O README do diretório traz um comando que carrega os seeds com o pipeline do próprio repositório. Ele roda `applySeedFiles` e depois `validateReport` em modo estrito, sem gravar nada. O resultado atual é 0 erros e 0 avisos.

O validador independente (`validate-ee.mjs`), o gerador e o teste de mutação ficaram fora do repositório, no diretório de rascunho do agente. O validador verifica:

- o JSON e as chaves estritas de `SeedItem` e `CurriculumSeedFile`;
- os ids, a hierarquia e o kind por profundidade;
- as referências;
- que nenhuma cláusula cite um ancestral ou um descendente;
- no máximo 2 alternativas, armazenadas e efetivas;
- as horas: lo ≤ hi, tópicos de 1 a 4 h e conservação nos contêineres;
- os ciclos, por Kahn sobre o grafo efetivo (cláusulas, filho → marco e herança de entrada recursiva), com e sem as arestas suaves;
- as rotas (R1);
- a licença das âncoras;
- os mesmos lints do repositório.

O teste de mutação confirma que o validador rejeita ciclos diretos, ciclos via marco e via herança de entrada, cláusulas que citam um ancestral, 3 alternativas, ids inexistentes, horas não conservadas, chaves extras e pais que não são o prefixo do id.
