# Aulas interativas

As aulas de potências de dez, prefixos SI, Lei de Ohm e passado contínuo abrem a atividade no próprio histórico. No chat livre, a ferramenta `study_activity` do professor escolhe uma atividade quando ela ajuda a explicar a pergunta. O resultado da ferramenta fica no histórico. Ajustar controles é local. **Perguntar** envia a pergunta e os valores visíveis para o tutor pelo fluxo normal da conversa. A exploração por si só não concede XP.

| Parte | Como aplicar | Referência |
|---|---|---|
| Corrente no circuito | Para um resistor ideal em série, calcular a corrente a partir dos valores atuais. A chave aberta interrompe o percurso. | [OpenStax, College Physics 2e, §20.2](https://openstax.org/books/college-physics-2e/pages/20-2-ohms-law-resistance-and-simple-circuits) |
| Prefixos e potências | Manter a grandeza fixa ao alternar A, mA e a forma científica. | [BIPM, tabela de prefixos SI](https://www.bipm.org/en/measurement-units/si-prefixes) |
| Linha do tempo | Uma faixa representa a atividade em andamento. Um marcador representa o evento pontual. Comparar as frases ao mover o marcador. | [British Council, Past continuous and past simple](https://learnenglish.britishcouncil.org/free-resources/grammar/a1-a2/past-continuous-past-simple) |
| Movimento da corrente | Pontos no sentido da corrente convencional distinguem um caminho ativo. A velocidade é ilustrativa. O cálculo e o desenho têm implementações próprias. | [CircuitJS, cálculo no resistor](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/ResistorElm.java#L90), [desenho dos pontos](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/CircuitElm.java#L325) |
| Esquema e medição | Símbolos e valores permanecem juntos. Variar um componente e observar o resultado sugere a sequência de trabalho para aulas de simulação mais avançadas. | [KiCad, Schematic Editor, Simulator](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#simulator), [documentação do Qucs-S](https://qucs-s-help.readthedocs.io/en/latest/) |
| Montagem e protoboard | Duas vistas do mesmo estado. As colunas realçadas permitem seguir os contatos da montagem. | [SimulIDE, interação com o circuito](https://simulide.com/p/), [PICSimLab, capítulos Boards e Spare Parts](https://lcgamboa.github.io/picsimlab_docs/stable/) |
| Controles da atividade | Apresentar uma alteração que o aluno possa experimentar e dar retorno no desenho. A fonte fica disponível para consulta. | [Podolefsky, Perkins e Adams, Factors promoting engaged exploration with computer simulations](https://phet.colorado.edu/publications/prst-per-2010.pdf) |

## Autoria

Para diálogos, situações cotidianas, aulas de idiomas, histórias ou analogias iniciais, o tutor prioriza `kind: "comic"` (tirinha ilustrada em quadrinhos) com 2 a 6 quadros, cenários desenhados em cel shading (`reception`, `cafe`, `classroom`, `home`, `work`, `street`, `lab`, `park`), personagens expressivos com balões de fala e resposta, selo de pista-chave (`cue`), legenda narrativa, síntese de voz opcional por idioma (`language`) e navegação por clique ou teclado.

Para outros temas estruturados, o tutor informa `sequence`, `comparison` ou `diagram`, título, referência com seção e uma lista de etapas. Cada etapa tem um rótulo, uma explicação curta e um selo ilustrado correspondente ao tema. Uma comparação apresenta casos com o mesmo critério e pode incluir uma observação final. Em um diagrama, cada seta deve representar uma dependência ou consequência real. A interface renderiza texto e controles nativos. A ferramenta `demo` já existente atende simulações com outras dinâmicas.

O contrato e a associação às habilidades ficam em `src/core/lesson-activity.ts`. Os painéis compartilham as cores do tema e a preferência de movimento reduzido. A paleta de fábrica é Cel Noite, com grafite, carvão e marfim, tanto no navegador quanto no primeiro quadro do aplicativo desktop.


## Leitura dentro do app

No mapa, abra uma região ou habilidade e use **Livros da região** para anexar um PDF ou EPUB. **Ler no aplicativo** abre o exemplar local. O PDF mantém a diagramação da página original e permite selecionar texto quando o arquivo contém uma camada textual. O EPUB segue a ordem das seções.

O aluno pode escrever um pedido sobre a página, selecionar um trecho, arrastar uma área para recortar ou colar ou anexar um print. Ao selecionar texto, o tutor recebe também a imagem da página para interpretar figuras, legendas e fórmulas. Ao enviar um print, o recorte identifica o foco. O professor pode consultar outras páginas do mesmo exemplar com `read_book_page`. A atividade gerada com `study_activity` cita a obra e a localização.

## Referências de implementação

- A largura da coluna e o ritmo da leitura se inspiram na escala de prosa do [Tailwind Typography](https://github.com/tailwindlabs/tailwindcss-typography/blob/e3714a3fe55551ce9d51eec4721183ed6b1d5cd1/src/styles.js#L1409-L1417).
- A textura de pontos utiliza um SVG passivo nas bordas. Consulte o [Dot Pattern do Magic UI](https://github.com/magicuidesign/magicui/blob/b0b2e4974b1b68cd5278277c6837a27736e20c3a/apps/www/registry/magicui/dot-pattern.tsx#L156-L176).
- A resposta da interface acompanha o resultado da ação do aluno. A orientação para confirmar resultados significativos vem da [skill de design Impeccable](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/.agents/skills/impeccable/reference/delight.md#L7-L44).
- O leitor preserva a seleção para que o aluno possa acionar o tutor com mouse, toque ou teclado. O [seletor do Readest](https://github.com/readest/readest/blob/29eaf0a9fd82dbb1364aa133d985230bd5b5137a27736e20c3a/apps/readest-app/src/app/reader/hooks/useTextSelector.ts#L108-L125) serviu de referência de comportamento.
