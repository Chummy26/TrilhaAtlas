# repeat-space/anki-apkg-export: análise para a meta 4 (flashcards → Anki)

> Relatório de pesquisa, 2026-11-18. Fonte clonada (shallow) em
> `C:\Users\nicoolas\Pictures\learnharness\_refs\extra\repeat-space__anki-apkg-export`
> (commit `bae20d3e`, 2026-10-05, "docs: update release instructions for main").
> Análise **estática**: nenhum script, install, build ou teste do repositório foi executado.
> Todos os caminhos `src/...`, `test/...` etc. abaixo são relativos a essa pasta.

---

## 0. Resumo

- **O que é:** biblioteca TypeScript (≈845 linhas em `src/`) que monta um `.apkg` do Anki **em memória**:
  cria um SQLite (`collection.anki2`, schema legado v11) com **sql.js (WASM)**, insere `col`/`notes`/`cards`
  e empacota tudo com **JSZip**, junto com o manifesto `media`. Funciona igual em Node (≥22.12) e no browser.
- **Versão atual:** `anki-apkg-export@5.0.0`, publicada no npm em **2026-10-05** (a anterior, 4.0.3, é de 2020).
  A v5 é uma reescrita: factory assíncrona, IDs estáveis, `noteId` para re-exportar sem duplicar, modelos
  customizados, cloze aninhado, subdecks, lotes transacionais e validação rígida.
- **Validação real:** `test/anki_import.py` importa os pacotes gerados no **backend oficial do Anki 26.09.3**
  e confere: contagem de notas/cartões, ordinais de cloze, mídia byte a byte, **reimportação que atualiza o
  texto sem duplicar e preserva o histórico de revisão** (`reps = 7` continua 7).
- **Licença:** MIT (© ewnd9). Todas as dependências de runtime (sql.js MIT, jszip MIT/GPL-3.0 dual, he MIT,
  sha1 BSD-3-Clause) são **compatíveis com AGPL-3.0-only**. Basta manter os avisos de copyright.
- **Veredito:** é o caminho **offline** recomendado para a meta 4 ("cartões no Anki ao fim de cada sessão").
  Proposta: usar a dependência fixada (`5.0.0`) dentro de `plugins/flashcards` (empacotada pelo esbuild).
  Se precisarmos de 2 patches pequenos (`mod` controlado e, opcionalmente, exportar o agendamento), vale
  copiar os 5 arquivos de `src/`. Para sincronizar ao vivo e **ler as revisões de volta** (memória do aluno,
  XP), o complemento é o **AnkiConnect** (HTTP em `127.0.0.1:8765`), direto ou via **ankimcp**.
- **Atenção ao escopo:** o `docs/flashcards-vision.md` do learnharness original diz *"No Anki integration"*
  na v1. Seguir a meta 4 é uma **decisão do nosso fork**. O plano abaixo mantém o FSRS nativo como fonte de
  verdade e trata o Anki como destino de exportação ou sincronização, sem mexer no núcleo do plugin.

---

## 1. Identificação e estado atual

| Item | Valor |
|---|---|
| Repo | https://github.com/repeat-space/anki-apkg-export |
| Pacote npm | `anki-apkg-export`, dist-tag `latest` = **5.0.0** (publicada 2026-10-05T05:15Z) |
| Histórico | 1.0.0 (2016) … 4.0.3 (2020-03-28) → 5.0.0 (2026-10-05) |
| Licença | MIT, `LICENSE` ("Copyright (c) ewnd9"); README: "Originally ported from anki2 (albertzak/anki2)" |
| Runtime | Node `>=22.12.0` (`package.json#engines`) ou browser moderno (WASM) |
| Módulos | ESM + CJS (`tsdown`, `platform: 'neutral'`, `target: es2022`), `.d.ts`/`.d.cts` incluídos |
| Export extra | `anki-apkg-export/sql-wasm.wasm` → `dist/sql-wasm.wasm` (copiado de `sql.js/dist` por `scripts/copy-wasm.mjs`) |
| Deps runtime | `sql.js ^1.14.2` (atual 1.16.0, MIT), `jszip ^3.10.2` (`(MIT OR GPL-3.0-or-later)`), `he ^1.2.0` (MIT), `sha1 ^1.1.1` (BSD-3-Clause; puxa `crypt`/`charenc`), mais `@types/node` e `@types/sql.js` (tipos listados como deps de runtime, inofensivo) |
| CI | `.github/workflows/ci.yml`: Node 22/24/26 + Playwright (Chromium/Firefox) + import real no Anki 26.09.3 via `uv run --with anki==26.09.3` |
| Formato | **legado** `collection.anki2` (`col.ver = 11`), não `collection.anki21b` (zstd + protobuf) |

Nosso host: Electron **44.9.3** (`node_modules/electron`, que exige Node ≥22.12) e Next 16. A exigência
de Node da lib é atendida.

---

## 2. Licença e compatibilidade com AGPL-3.0

| Componente | Licença | Uso no nosso app | Compatível? | Obrigação |
|---|---|---|---|---|
| anki-apkg-export 5.0.0 | MIT | dependência empacotada ou código copiado | Sim | manter o aviso MIT (ex.: `plugins/flashcards/ANKI-APKG-EXPORT-LICENSE.txt`, como já é feito com `FSRS-LICENSE.txt`) |
| sql.js | MIT | WASM empacotado | Sim | aviso MIT |
| jszip | MIT **ou** GPL-3.0+ | empacotado | Sim (escolher MIT) | aviso MIT |
| he | MIT | empacotado | Sim | aviso MIT |
| sha1 (+crypt, charenc) | BSD-3-Clause | empacotado, ou trocar por `node:crypto` | Sim | aviso BSD |
| Anki (app desktop) | AGPL-3.0-or-later | só consome o arquivo | n/a | nenhuma (formato de dados) |
| AnkiConnect (add-on) | GPL-3.0 (não reconfirmado hoje: o sr.ht deu HTTP 502 em 2026-11-18) | chamado por HTTP local, outro programa | Sim (comunicação entre processos; GPL-3 e AGPL-3 também são compatíveis pela seção 13) | nenhuma |
| ankimcp `@ankimcp/anki-mcp-server` 0.27.1 | MIT (© 2026 Anatoly Tarnavsky) | opcional, servidor MCP | Sim | aviso MIT se empacotado |

O plugin `plugins/flashcards` já é `AGPL-3.0-only` (`plugins/flashcards/package.json`), e
`plugins/flashcards/scripts/build.mjs` já copia arquivos de licença para `dist/`. Basta acrescentar mais um.

---

## 3. Arquitetura

### 3.1 Mapa de arquivos (o que importa)

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/index.ts` | 38 | `AnkiExport extends Exporter` com `static async create()`: inicializa o sql.js uma vez (cache em `defaultSql`) e re-exporta tipos |
| `src/exporter.ts` | 403 | **Núcleo**: `Exporter` (decks, modelos, notas, cartões, cloze, mídia, transação, save/close), `stableId`, `assertId`, `assertField`, `stripHtml` |
| `src/template.ts` | 258 | `AnkiModel`/`AnkiDeck` (JSON legado), `defaultModel()` (basic/reversed/cloze), `createModel()` (validação + `req`), `createDeck()`, `collectionValues()` (linha `col` + preset de opções) |
| `src/schema.ts` | 77 | DDL do `collection.anki2` legado: `col`, `notes`, `cards`, `revlog`, `graves` + índices |
| `src/types.ts` | 69 | API pública: `ExportOptions`, `CardOptions`, `CardInput`, `NoteInput`, `ModelDefinition`, `CardTemplate`, `MediaData`, `SaveOutput` |
| `docs/api.md` | 118 | Referência da API (fiel ao código) |
| `docs/migration-v5.md` | 49 | Mudanças v4 → v5 (GUID novo, factory assíncrona, validações) |
| `test/exporter.test.js` | 144 | Vitest: zip, mídia, dedup, aspas em templates, `free()` de statements, rollback, validações |
| `test/models.test.js` | 118 | Vitest: deck aninhado, reversed, cloze (aninhado, multilinha, hints, limites), modelos customizados, rollback de metadados de deck |
| `test/anki_import.py` | 48 | **Integração com o Anki real 26.09.3** (import, mídia, reimport, histórico preservado) |
| `scripts/anki-fixtures.mjs` | 60 | Gera `first.apkg`/`updated.apkg` para o teste acima (manipula `Date.now` com offset de 10 s) |
| `scripts/benchmark.ts` | 34 | Benchmark de N cartões (não executado por mim, então não há números medidos) |
| `examples/browser/main.ts` | 116 | Demo Vite: `locateFile: () => wasmUrl`, `save({type:'blob'})`, `<a download>` |
| `examples/server/index.mjs` | 16 | Exemplo Node mínimo |
| `test/browser/export.e2e.ts` | 65 | Playwright: download, unicode, mídia `File`, ordinais de cloze, layout mobile |

### 3.2 Fluxo de dados

```
AnkiExport.create(deckName, opts)                      src/index.ts
  └─ sql = opts.sql ?? initSqlJs({locateFile}) (cache global defaultSql)
  └─ new Exporter(deckName, {...opts, sql})            src/exporter.ts
       ├─ topDeckId  = opts.deckId  ?? stableId('deck', deckName)
       ├─ definition = defaultModel(deckName, opts)    src/template.ts  (basic | reversed | cloze | opts.model)
       ├─ topModelId = opts.modelId ?? definition.id ?? stableId('model', [topDeckId, definition.name])
       ├─ db = new sql.Database(); db.run(schema)      src/schema.ts
       ├─ INSERT INTO col VALUES (collectionValues(createDeck(..), createModel(..)))
       └─ decks Map {'Default'→1, deckName→topDeckId}, models Map {topModelId→AnkiModel}, addDeck(deckName) (cria os pais de "A::B")

addCard / addCloze / addNote / addCards / addNotes
  └─ addNote(fields, {noteId, tags, deck, modelId})
       ├─ valida campos (sem \u0000 nem \u001f), noteId, tags
       ├─ ords = cardOrdinals(model, fields)    (req para basic; parser de {{cN::}} para cloze)
       ├─ guid = sha1(JSON([topDeckId, modelId, noteId ? ['id', noteId] : ['fields', fields]]))
       ├─ upsert em notes (reaproveita notes.id se o guid já existe no pacote)
       ├─ upsert em cards por (nid, ord) (reaproveita id/due), DELETE dos ords que não são mais gerados
addMedia(filename, data)  → Map em memória (sem I/O até save)
save(opts)
  ├─ UPDATE col SET decks, models, conf(nextPos), mod
  ├─ zip: 'collection.anki2' = db.export(); '0','1',…= mídia; 'media' = {"0":"photo.png",…}
  └─ zip.generateAsync({type: opts.type ?? 'uint8array', compression: 'DEFLATE'})
close() → db.close(), limpa Maps; idempotente
```

Todo o estado vive no heap WASM do sql.js e em `Map`s JS. Não há I/O de disco e nada é global além do
cache do módulo sql.js.

---

## 4. Formato `.apkg` gerado (o que o Anki recebe)

ZIP com:
- `collection.anki2`: SQLite com o schema de `src/schema.ts` (tabelas `col`, `notes`, `cards`, `revlog` vazia, `graves` vazia).
- `0`, `1`, …: bytes de cada mídia, na ordem de `addMedia`.
- `media`: JSON `{"0": "photo.png", "1": "audio.mp3"}`.

**`col` (1 linha, `src/template.ts:207` `collectionValues`)**: `[id=1, crt=segundos, mod=ms, scm=ms, ver=11, dty=0, usn=-1, ls=0, conf, models, decks, dconf, tags='{}']`.
- `conf`: `{nextPos, activeDecks:[deckId], curDeck, curModel, sortType:'noteFld', newSpread:0, collapseTime:1200, …}`. `save()` reescreve `nextPos`.
- `dconf`: um único preset `id: 1 "Default"` (new 20/dia, `delays [1,10]`, `initialFactor 2500`, rev 200/dia, `maxIvl 36500`, lapse `delays [10]`, `leechFails 8`). **Todos os decks usam `conf: 1`.**
- `decks`: `{1: Default, <id>: AnkiDeck}`. `AnkiDeck` = `{id, name, desc:'', mod, usn:-1, conf:1, dyn:0, collapsed:false, extendNew/Rev:0, newToday/revToday/lrnToday/timeToday:[0,0]}`.
- `models`: `{<id>: AnkiModel}` com `flds[]` (`font:'Arial'`, `size:20`), `tmpls[]` (`qfmt`, `afmt`, `bqfmt:''`, `bafmt:''`, `did:null`), `req: [ord,'all',[fieldIdx…]]`, `sortf`, `css`, `latexPre/latexPost`, `type: 0|1`, `did: topDeckId`.

**`notes`** (`src/exporter.ts:182`): `[id, guid, mid, mod(s), usn=-1, tags=' a b ', flds=campos.join('\x1f'), sfld=stripHtml(campo sortf), csum=int(sha1(stripHtml(campo0))[0:8],16), flags=0, data='']`.

**`cards`** (`src/exporter.ts:197`): `[id, nid, did, ord, mod(s), usn=-1, type=0, queue=0, due=posição sequencial, ivl=0, factor=2500, reps=0, lapses=0, left=0, odue=0, odid=0, flags=0, data='']`.
Todos os cartões saem **novos**: a lib não exporta progresso nem `revlog`.

---

## 5. API pública (v5)

```ts
import AnkiExport, { Exporter, type ModelDefinition, type NoteInput } from 'anki-apkg-export';

const apkg = await AnkiExport.create('Eletrônica', {
  kind?: 'basic' | 'reversed' | 'cloze',      // padrão 'basic'
  deckId?: number, modelId?: number,          // inteiros seguros > 1
  questionFormat?, answerFormat?, css?,       // sobrescrevem o template padrão
  model?: ModelDefinition,                    // modelo customizado vira o padrão
  sql?: SqlJsStatic,                          // sql.js já inicializado (ideal no backend)
  locateFile?: (file) => string,              // URL do sql-wasm.wasm (browser)
});
apkg.addDeck('Eletrônica::DC', { deckId? }): number;
apkg.addModel(def: ModelDefinition): number;          // retorna o modelId
apkg.addCard(front, back, { noteId?, tags?, deck?, modelId? });   // exige modelo Front/Back
apkg.addCloze(text, extra?, opts?);                   // cria o modelo cloze sob demanda num deck basic
apkg.addNote(fields: string[] | Record<string,string>, opts?);
apkg.addCards(iterable<CardInput>);  apkg.addNotes(iterable<NoteInput>);  // transacionais
apkg.addMedia('lh-3f2a.svg', bytes);  // Buffer | Uint8Array | ArrayBuffer | Blob | string | number[] | ReadableStream | Promise<…>
await apkg.save();                    // Uint8Array; {type:'blob'|'nodebuffer'|'base64'|…} via JSZip
apkg.close();                         // sempre em finally
```

Tipos-chave (`src/types.ts`):
```ts
interface CardTemplate { name: string; questionFormat: string; answerFormat: string; requiredFields?: readonly string[] }
interface ModelDefinition { name: string; fields: readonly string[]; templates: readonly CardTemplate[];
  id?: number; type?: 'basic' | 'cloze'; css?: string; sortField?: string }
interface CardOptions { noteId?: string | number; tags?: string | readonly string[]; deck?: string; modelId?: number }
```

Erros lançados (todos `TypeError` ou `Error` síncronos): deck vazio ou com segmento `::` vazio; ID inválido ou
repetido; campo com `\u0000`/`\u001f`; quantidade de campos diferente do modelo; nota que não gera cartão;
cloze > 500; nome de mídia com `/\:*?"<>|`, controle ou ponto inicial; mídia duplicada; qualquer método
chamado depois de `close()`.

`Exporter` (classe base) tem **construtor público síncrono**: `new Exporter(name, { sql, ...opts })`.
Os testes usam assim (`test/exporter.test.js:9`). É o jeito ideal no backend quando o sql.js já foi
inicializado uma vez.

---

## 6. Algoritmos-chave

### 6.1 IDs determinísticos (`src/exporter.ts:19`)
```ts
export function stableId(namespace: string, value: unknown): number {
  return parseInt(sha1(JSON.stringify([namespace, value])).slice(0, 12), 16) || 2;
}
```
Usa 48 bits do SHA-1, então cabe em `Number.MAX_SAFE_INTEGER`. Deck: `stableId('deck', nomeCompleto)`.
Modelo: `stableId('model', [topDeckId, nomeDoModelo])`. **Consequência:** renomear um deck ou modelo muda o
ID. Para evitar isso, passe `deckId` e `modelId` explícitos e persistidos.

### 6.2 GUID e upsert de nota (`src/exporter.ts:171-180`)
```ts
const guid = sha1(JSON.stringify([this.topDeckId, modelId,
  options.noteId === undefined ? ['fields', fields] : ['id', options.noteId]]));
const existing = this.query('SELECT id FROM notes WHERE guid = ?', [guid]);
const noteId = typeof existing.id === 'number' ? existing.id : this.nextId++;
```
- Com `noteId` (chave da nossa fonte), o GUID fica estável mesmo quando o texto muda. O Anki casa notas
  **pelo GUID** na importação e atualiza no lugar, preservando o agendamento (provado em `test/anki_import.py`).
- Sem `noteId`, o GUID depende dos campos: editar o texto gera nota nova (duplicata no Anki).
- **O GUID inclui `topDeckId` e `modelId`.** Trocar o nome do deck raiz ou do modelo sem fixar os IDs
  gera duplicatas em massa.
- `notes.id` e `cards.id` vêm de `nextId = Date.now()` incrementado. Mudam a cada exportação, o que não tem
  problema porque o Anki casa por GUID e, para cartões, por (nota, ord).

### 6.3 `sfld`/`csum` compatíveis com o Anki (`src/exporter.ts:34`)
```ts
function stripHtml(value: string): string {
  return he.decode(value
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, ' $1 ')
    .replace(/<!--[^]*?-->|<style\b[^]*?<\/style>|<script\b[^]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ''));
}
// csum = parseInt(sha1(stripHtml(fields[0])).slice(0, 8), 16)
```
Reproduz `anki.utils.field_checksum`, e o teste Python compara contra o Anki real. Isso importa para a
detecção de duplicatas pelo primeiro campo.

### 6.4 Geração de cartões (`cardOrdinals`, `src/exporter.ts:248`)
- **Modelos normais (`type 0`)**: para cada template, gera o cartão se **todos** os `requiredFields` não
  estiverem vazios (`trim()`). O `req` é montado em `createModel` com padrão no 1º campo. **Não** avalia
  `{{#Campo}}` nem o HTML do template.
- **Cloze (`type 1`)**: lê os `{{cloze:Campo}}` do `qfmt` do template 0 e, em cada campo referido, varre
  `{{cN::`. Um contador de profundidade casa `{{`/`}}` (suporta cloze aninhado e multilinha) e descarta a
  deleção vazia (`{{c1::}}` ou `{{c1::  ::dica}}`) ou não fechada. Gera `ord = N-1`, único, de 1 a 500.
  Exemplo do teste: `'{{c1::{{c3::Japan}}}} is Tokyo'` → ords `[0, 2]`.
- Ao reinserir uma nota com o mesmo GUID, os cartões de ords que deixaram de ser gerados são apagados
  **no pacote** (`DELETE FROM cards WHERE nid=? AND ord NOT IN (…)`). O Anki, na importação, **não apaga**
  cartões existentes (ver armadilhas).

### 6.5 Transações (`src/exporter.ts:228`)
`addCards`/`addNotes` fazem `BEGIN … COMMIT` e, em caso de erro, `ROLLBACK`. Também restauram o
snapshot de `nextId`, `nextDue` e dos `Map`s de decks e modelos. Um lote com um item inválido não deixa
nada para trás, nem deck novo. Além disso, o lote acelera a inserção (uma transação só).

### 6.6 Tags (`formatTags`, `src/exporter.ts:388`)
Uma string é quebrada por espaços. Num array, os espaços internos viram `_`. Remove duplicatas e grava
`' tag1 tag2 '` (espaços nas pontas, padrão do Anki). O `::` é preservado, então
**tags hierárquicas funcionam** (`lh::eletronica::dc`).

### 6.7 Mídia e save (`src/exporter.ts:337-370`)
Os nomes são validados como "nome simples". `save()` serializa os decks e modelos atuais em `col`, chama
`db.export()` e numera a mídia sequencialmente. Toda mídia adicionada entra no zip, mesmo sem referência
em campo.

---

## 7. Templates prontos (`src/template.ts:76-115`)

| kind | Campos | Templates |
|---|---|---|
| `basic` | `Front`, `Back` | `Forward`: Q `{{Front}}`, A `{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}`, required `['Front']` |
| `reversed` | `Front`, `Back` | `Forward` (acima) + `Reverse`: Q `{{Back}}`, A `{{FrontSide}}<hr id="answer">{{Front}}`, required `['Back']`. Um Back vazio remove o cartão reverso |
| `cloze` | `Text`, `Extra` | `Cloze`: Q `{{cloze:Text}}`, A `{{cloze:Text}}<br>{{Extra}}` (`type: 'cloze'`, 1 template) |

Os nomes dos modelos padrão são `"<deck> — Basic"`, `"<deck> — Reversed"` e `"<deck> — Cloze"` (com
travessão). CSS padrão: `.card { font-family: sans-serif; font-size: 20px; text-align: center; }`.
`latexPre`/`latexPost` vêm do preâmbulo padrão do Anki, mas o LaTeX exige TeX instalado no cliente.
Prefira MathJax (§9).

---

## 8. O que os testes garantem

- `exporter.test.js`: estrutura do zip (`['0','collection.anki2','media']`), `PRAGMA integrity_check = ok`,
  `flds` com `\x1f`, tags normalizadas (`' Japan two_words '`), dedup de nota idêntica (2 notas, 2 cartões),
  `ab|c` ≠ `a|bc`, templates com aspas gravados como dados (sem SQL injection), todo statement `free()`,
  `close()` idempotente, `mod` em segundos, `save({type:'nodebuffer'})` → `Buffer`, identidade estável com
  `noteId`, rollback em lote, mídia duplicada ou `../` rejeitada.
- `models.test.js`: pais de deck aninhado, reversed com remoção do reverso, cloze (únicos, multilinha, dica,
  aninhado, vazio, não fechado, >500), basic e cloze no mesmo pacote, modelo customizado (`sortField`,
  `requiredFields`, `addNotes` com objeto e array), rollback de metadados de deck.
- `anki_import.py` + `scripts/anki-fixtures.mjs`: 3 notas e 6 cartões (reversed 2 + cloze c1/c3 2 + modelo
  customizado 2); deck `Languages::Japanese::Cities`; mídia PNG e MP3 idêntica; **reimport** de
  `updated.apkg` atualiza `flds` (`'東京 (Tokyo)\x1fTokyo'`), mantém 3 e 6, e **preserva `reps = 7`** de um
  cartão "estudado". Importar 2× não duplica.
  O fixture gera `first` com `Date.now() - 10000` para garantir que o `updated` seja "mais novo".
- Cobertura que falta: AnkiDroid e AnkiMobile ("other clients are not yet covered", README), exportação de
  agendamento, coleções grandes (só existe o benchmark).

---

## 9. Armadilhas e cuidados (importantes para nós)

1. **Identidade = (deck raiz, modelo, noteId).** Persistir `deckId` e `modelId` por domínio na primeira
   exportação. Nunca derivar do nome exibido, que o usuário pode renomear.
2. **`mod` = hora da exportação.** O import do Anki moderno atualiza notas "se a do pacote for mais nova"
   (opção padrão do diálogo; confirmar no 26.x). Como cada exportação carimba `mod = agora`, ela
   **sobrescreve edições feitas no Anki** depois da última exportação. E duas exportações no mesmo segundo
   têm o mesmo `mod`, então a segunda pode não atualizar (o fixture usa um offset de 10 s por isso).
   Solução: patch P1 (§10.2), `mod` = `updatedAt` real do cue.
3. **A importação nunca apaga.** Cue apagado no app continua no Anki. Com a nota por proposição e slots
   (§11.3), esvaziar o campo deixa o cartão "vazio", e *Tools → Empty Cards* limpa. Com a nota por cue, é
   preciso AnkiConnect `deleteNotes` ou uma tag `lh::deleted` para o usuário filtrar.
4. **Cartões novos sempre.** O progresso FSRS do app não vai para o Anki (`type=queue=0`, `ivl=0`). Se o
   usuário estudar nos dois lugares, os agendamentos divergem. Definir um **"dono do agendamento" por
   domínio** (§11.6).
5. **Campos "vazios" para o Anki ≠ vazios para a lib.** A lib usa `trim()`, mas o Anki trata
   `<br>`/`&nbsp;` como vazio. Um campo com só `<br>` gera um cartão que o Anki considera vazio. Sanitizar o
   HTML antes.
6. **Strings como mídia viram texto UTF-8** (JSZip). Nunca passe base64 como `string`. Use `Uint8Array`.
7. **Nomes de mídia colidem com a coleção do usuário.** O Anki renomeia o arquivo que entra quando o
   conteúdo difere (comportamento do importador moderno; confirmar). Use nomes por hash de conteúdo
   (`lh-<sha256:12>.svg`). Assets de template (fontes, ícones SVG do tema cel-shading) devem começar com
   `_` (`_lh-font.woff2`, `_lh-icons.svg`). É a convenção do Anki para mídia referenciada só pelo
   CSS/template, que o *Check Media* não remove.
8. **Deck único por cartão no Anki.** Nossas proposições podem estar em vários decks ("shared memberships").
   Escolher **uma** associação primária. Se a mesma nota for adicionada duas vezes com `deck` diferente,
   vence a última (o `INSERT OR REPLACE` move os cartões).
9. **Mudança de estrutura do modelo** (adicionar ou remover campo ou template) depois que o usuário já
   importou: o Anki pode exigir "Merge note types" ou criar uma cópia do tipo de nota. Trate o modelo como
   **versionado** (`LearnHarness — Cue v1` com ID fixo; mudança estrutural = `v2` com ID novo e migração
   explícita). Mudanças só de CSS ou HTML de template propagam com "update note types if newer", porque o
   `model.mod` é o tempo da exportação.
10. **Tudo em memória.** DB + zip + mídia ficam na RAM (o `docs/api.md` avisa). Para nossos volumes
    (milhares de cartões por domínio, poucas mídias SVG) não é problema. Vídeo e áudio grandes não devem
    ir para o `.apkg`: use links.
11. **WASM em bundlers.** No browser é obrigatório `locateFile` (ou `sql`). No backend empacotado pelo
    esbuild, o `__dirname` do sql.js passa a ser `dist/`. A forma mais robusta é
    `initSqlJs({ wasmBinary: fs.readFileSync(<dir>/sql-wasm.wasm) })` e passar `{ sql }`.
12. **Ponte do plugin só aceita JSON** (`ctx.handle`/`ctx.call`, `docs/plugin-api/plugins.md:457,962`).
    Os bytes do `.apkg` precisam ir como base64 (`save({type:'base64'})`, cerca de +33%) ou o backend
    grava em disco e devolve o caminho.
13. **GUID v5 ≠ v4.** Irrelevante para nós (começamos na v5), mas não misture exportações de geradores
    diferentes no mesmo perfil.
14. **Determinismo em testes.** IDs e `mod` dependem de `Date.now()`. Para golden files, faça stub de
    `Date.now` (como `scripts/anki-fixtures.mjs`) ou use o patch P4.
15. **`he` + `sha1` síncronos.** Funcionam no browser. No backend Node, `sha1` pode ser trocado por
    `node:crypto` (`createHash('sha1')`) se copiarmos o código.
16. **Hierarquia `::` em nomes.** Um título de região com `::` ou só espaços quebra a hierarquia ou lança
    erro. Normalizar (`replace(/::/g, ' – ')`, `trim`).

---

## 10. O que copiar e adaptar

### 10.1 Opção A (recomendada para começar): dependência fixada
- `plugins/flashcards/package.json` → `"dependencies": { "anki-apkg-export": "5.0.0", "sql.js": "1.14.2" }`
  (versões **exatas**; `sql.js` declarado para podermos resolver o WASM explicitamente).
  O README do plugin diz *"No runtime npm dependencies"*, mas o `flashcards-vision.md` permite deps do
  próprio plugin **empacotadas**: o esbuild já faz `bundle: true`.
- `plugins/flashcards/scripts/build.mjs` → copiar o WASM e as licenças:
  ```js
  import { createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  await copyFile(require.resolve('anki-apkg-export/sql-wasm.wasm'), path.join(out, 'sql-wasm.wasm'));
  // + copiar node_modules/anki-apkg-export/LICENSE → ANKI-APKG-EXPORT-LICENSE.txt (e sql.js, jszip, he, sha1)
  ```
- Nada de `npm install` do clone em `_refs`: instalar pelo registro npm, no nosso lockfile.

### 10.2 Opção B: código copiado com patches (se precisarmos de P1 ou P2)
Copiar exatamente estes arquivos (≈845 linhas) para `plugins/flashcards/src/vendor/anki-apkg-export/`
(o esbuild compila `.ts` sem configuração extra):

| Origem (`_refs/extra/repeat-space__anki-apkg-export/…`) | Destino sugerido | Adaptação |
|---|---|---|
| `src/exporter.ts` | `vendor/anki-apkg-export/exporter.ts` | patches P1–P4 abaixo; `sha1` → `node:crypto` (backend) |
| `src/template.ts` | `vendor/anki-apkg-export/template.ts` | `createDeck(name, id, desc?)` para descrição do deck (região do grafo) |
| `src/schema.ts` | `vendor/anki-apkg-export/schema.ts` | sem mudança |
| `src/types.ts` | `vendor/anki-apkg-export/types.ts` | novos campos opcionais em `CardOptions` |
| `src/index.ts` | `vendor/anki-apkg-export/index.ts` | opcional (usamos `Exporter` direto com `sql`) |
| `LICENSE` | `plugins/flashcards/ANKI-APKG-EXPORT-LICENSE.txt` | obrigatório (MIT) |
| `test/exporter.test.js`, `test/models.test.js` | `plugins/flashcards/tests/anki-export.test.cjs` | portar para `node --test`, o runner do plugin |

Patches propostos (cada um pequeno e local):
- **P1 `mod` controlado:** `CardOptions.mod?: number` (segundos), usado em `notes.mod` e `cards.mod` no
  lugar de `Math.floor(Date.now()/1000)`. Resolve a armadilha 2.
- **P2 agendamento opcional (fase 4):** `CardOptions.schedule?: Record<ord, {type, queue, due, ivl, factor,
  reps, lapses, data?}>`. O `cards.data` pode carregar o estado de memória FSRS (`{"s":…, "d":…}`, formato
  usado pelo Anki com FSRS; validar contra o Anki 26.x). O usuário precisa marcar "Import any learning
  progress" na importação.
- **P3 `revlog` opcional:** inserir revisões para que o histórico e as estatísticas apareçam no Anki.
- **P4 determinismo:** `ExportOptions.now?: () => number` injetável.

### 10.3 Para referência (não copiar)
- `examples/browser/main.ts`: padrão de download com `Blob`/`URL.createObjectURL` e sanitização do nome.
- `test/anki_import.py`: modelo de teste de integração com o `anki` do PyPI (nosso equivalente roda
  **fora do CI padrão**, opcional).

---

## 11. Plano de integração no nosso app

Contexto do fork: já existe `plugins/flashcards` (Core plugin). Store JSON versionado em
`<dataDirectory>/flashcards.json` (`src/store.cjs`), modelo **Deck → Proposição → Cue**, FSRS-6 nativo
(`src/scheduler.cjs`), escolha ponderada de cue, backend `src/backend.cjs` registrando operações com
`register(name, handler)` sobre `ctx.handle`. A exportação para o Anki entra como **módulo novo e isolado**,
sem tocar no agendamento nativo.

### 11.1 Fase 0: decisões
- Registrar em `docs/` do fork que a meta 4 **revoga** o *"No Anki integration in v1"* do
  `flashcards-vision.md`, só para exportação e sincronização (o app continua nativo-first).
- Dono do agendamento por domínio: `app` (padrão; o Anki só recebe cartões) ou `anki` (o usuário revisa no
  Anki e o app lê as revisões via AnkiConnect, fase 3).

### 11.2 Fase 1: exportar `.apkg` (offline, sem add-on)
Arquivos novos em `plugins/flashcards/src/anki/`:
- `model.ts`: modelos com **ID fixo** (nunca derivado do nome).
- `render.ts`: Markdown → HTML compatível com o Anki.
- `export.ts`: monta o pacote a partir do snapshot do store.
- Operação de backend `anki-export` em `src/backend.cjs` e botão na UI (`src/main.js`/`library-tree.js`:
  ação no menu de engrenagem do deck e na barra "Review selected"), mais um prompt ao **encerrar a sessão**.

Modelo (nota por proposição, cues como cartões irmãos; ver §11.3):
```ts
// plugins/flashcards/src/anki/model.ts
import type { ModelDefinition } from 'anki-apkg-export';
export const SLOTS = 8;
export const LH_PROP_MODEL_ID = 1_763_424_000_001;     // FIXO. Mudança estrutural => v2 + novo ID
export const lhPropositionModel: ModelDefinition = {
  id: LH_PROP_MODEL_ID,
  name: 'LearnHarness — Proposição v1',
  fields: ['Proposition', 'Context', 'LH_ID',
           ...Array.from({ length: SLOTS }, (_, i) => [`Q${i + 1}`, `A${i + 1}`]).flat()],
  sortField: 'Proposition',
  css: LH_CEL_CSS,                                     // tema cel-shading + .nightMode
  templates: Array.from({ length: SLOTS }, (_, i) => ({
    name: `Cue ${i + 1}`,
    questionFormat: `<div class="lh-q">{{Q${i + 1}}}</div>`,
    answerFormat: `{{FrontSide}}<hr id="answer"><div class="lh-a">{{A${i + 1}}}</div>` +
                  `<div class="lh-prop">{{Proposition}}</div>`,
    requiredFields: [`Q${i + 1}`],                     // slot vazio => sem cartão
  })),
};
```
Atenção: o 1º campo (`Proposition`) é usado no `csum` e na checagem de duplicata do Anki. O `LH_ID`
permite `findNotes "LH_ID:<id>"` via AnkiConnect depois.

Exportador (backend Node; sql.js inicializado uma vez):
```ts
// plugins/flashcards/src/anki/export.ts
import fs from 'node:fs'; import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Exporter } from 'anki-apkg-export';
let sqlP: Promise<SqlJsStatic> | undefined;
const sql = (dir: string) => (sqlP ??= initSqlJs({ wasmBinary: fs.readFileSync(path.join(dir, 'sql-wasm.wasm')) }));

export async function exportDomain(ctx, state, domain /* {name, ankiDeckId} */, deckIds?: string[]) {
  const top = `LearnHarness::${clean(domain.name)}`;
  const ex = new Exporter(top, { sql: await sql(ctx.directory), deckId: domain.ankiDeckId, model: lhPropositionModel });
  try {
    const notes = [], media = new Map<string, Uint8Array>();
    for (const p of primaryPropositions(state, deckIds)) {          // 1 deck primário por proposição
      const slots = slotMap(state, p);                               // cueId -> slot persistido (0..SLOTS-1)
      const f: Record<string, string> = { Proposition: html(p.statement || p.name, media),
        Context: '', LH_ID: p.id };
      for (let i = 0; i < SLOTS; i++) { f[`Q${i + 1}`] = ''; f[`A${i + 1}`] = ''; }
      for (const c of p.cues) { const s = slots[c.id]; f[`Q${s + 1}`] = html(c.question, media); f[`A${s + 1}`] = html(c.answer, media); }
      notes.push({ fields: f, noteId: p.id, deck: `${top}::${clean(p.primaryDeckName)}`,
                   tags: ['lh', `lh::${slug(domain.name)}`, ...regionTags(p)] });
    }
    ex.addNotes(notes);                                              // transacional
    for (const [name, bytes] of media) ex.addMedia(name, bytes);
    for (const a of themeAssets()) ex.addMedia(a.name /* "_lh-…" */, a.bytes);
    return await ex.save({ type: 'base64' });                        // ponte JSON
  } finally { ex.close(); }
}
```
- `domain.ankiDeckId`: gerado uma vez (`stableId` ou `Date.now()`) e **persistido** no store
  (`state.anki = { version: 1, domains: { [domainId]: { deckId, slotMaps, lastExportAt } } }`), com a
  migração em `src/store.cjs#migrate` (adicionar a chave é retrocompatível).
- `render.ts` (Markdown → HTML): usar `micromark` + `micromark-extension-math` (já no projeto) ou `marked`,
  empacotado no plugin. Converter `$…$`/`$$…$$` para `\(…\)`/`\[…\]` (MathJax nativo do Anki, sem
  depender de KaTeX nem de LaTeX instalado). Mermaid vira SVG (o host já tem `mermaid` e
  `@resvg/resvg-js`), entra como mídia com nome por hash e é referenciado com `<img src="lh-ab12cd34ef56.svg">`.
  Sanitizar: tirar `<script>` e handlers, e trocar campo vazio, `<br>` ou `&nbsp;` por `''` (armadilha 5).
- Tags: `lh`, `lh::<domínio>`, `lh::reg::<caminho::da::região>` (tags hierárquicas = regiões do grafo,
  meta 1) e `lh::origin::graph|file|manual`.
- Deck no Anki: `LearnHarness::<Domínio>::<NN Região ou deck primário>`, com prefixo numérico da ordem
  curricular para o Anki ordenar como o grafo.
- Entrega ao usuário: no frontend, `const b64 = await ctx.call('anki-export', {...})` → `Uint8Array` →
  `Blob` → `<a download="Eletrônica.apkg">`. O Electron mostra o diálogo de salvar por padrão; não há
  `will-download` em `electron/*.cjs`, mas confirmar na UI real. Alternativa: o backend grava
  `<dataDirectory>/exports/<domínio>-<yyyy-mm-dd>.apkg` e a UI mostra o caminho.
- "Fim de sessão": o host não tem evento `session-ended` (só `turn-settled`, `sources-changed`… em
  `docs/plugin-api/events.md`). Precisamos de uma ação explícita "Encerrar sessão" na UI do fork que
  dispare: geração de cues (pipeline existente) → `anki-export` (se ligado nas configurações do domínio).

### 11.3 Por que nota por proposição (e não por cue)
- O vision do app agenda **por proposição** e alterna cues. No Anki, cada cartão tem agenda própria. Se
  cada cue virasse uma nota, a carga de revisões se multiplicaria. Com cues como **cartões irmãos da mesma
  nota**, as opções de deck *bury new/review siblings* do Anki aproximam "um cue por proposição por dia".
- Apagar um cue = esvaziar o slot → cartão vazio no Anki → *Empty Cards* limpa (armadilha 3).
- Requisito: o **mapa cue → slot é persistido e estável**. Nunca recompactar, ou os ords mudam e o Anki vê
  cartões diferentes. Limite de `SLOTS` (8). Acima disso, uma nota de continuação
  (`noteId = p.id + '#2'`) ou corte por relevância.
- Alternativa mais simples (aceitável no MVP): modelo `Q/A/Proposition/LH_ID`, uma nota por cue
  (`noteId = cue.id`). Mais fácil, porém com as limitações acima.

### 11.4 Fase 2: auto-import via AnkiConnect (opcional, zero cliques)
Se o Anki estiver aberto com o AnkiConnect (porta `8765`):
1. `POST http://127.0.0.1:8765 {"action":"version","version":6}` detecta o add-on.
2. Gravar o `.apkg` em `<dataDirectory>/exports/…` e chamar `{"action":"importPackage","version":6,"params":{"path":"<abs>"}}`.
   A documentação diz que o caminho é relativo à pasta `collection.media`. Caminho absoluto deve funcionar
   (`os.path.join` do Python descarta a base), mas **testar**.
3. Opcional: `{"action":"sync"}` para o AnkiWeb.

As chamadas ficam no **backend** do plugin (Node, sem CORS). Suportar a `apiKey` do AnkiConnect nas
configurações. Nunca expor a porta a outros hosts.

### 11.5 Fase 3: sync ao vivo e leitura de revisões (meta 2, memória do aluno; meta 5, XP)
- Escrita incremental (sem `.apkg`): `createDeck`, `createModel` (só uma vez), `addNotes`,
  `updateNoteFields`, `deleteNotes`, `storeMediaFile`, com a tabela `lhId → ankiNoteId` no store
  (encontrada via `findNotes "LH_ID:<id>"`).
- Leitura: `cardReviews(deck, startID)` / `getReviewsOfCards` / `cardsInfo` → importar as revisões do Anki
  para o modelo de aluno (pontos fracos por região, XP calibrado). Fazer isso só quando o dono do
  agendamento for `anki`, para não contar duas vezes.
- O **ankimcp** (`@ankimcp/anki-mcp-server` 0.27.1, MIT, Node ≥22.12, usa o AnkiConnect, 53 tools:
  `addNotes`, `findNotes`, `updateNoteFields`, `get_due_cards`, `rate_card`, `review_stats`, `sync`…) serve
  para expor o Anki ao **agente** via MCP (o host já usa `@modelcontextprotocol/sdk`). O próprio projeto se
  descreve como "active beta". Para a lógica determinística de sincronização, prefira chamadas HTTP diretas
  ao AnkiConnect.

### 11.6 Fase 4 (opcional): exportar o progresso
Com os patches P2/P3, mapear o estado FSRS nativo (`schedule` em `src/scheduler.cjs`) para
`cards.type/queue/due/ivl` e `cards.data` (estabilidade e dificuldade) mais o `revlog`. Só faz sentido na
migração "app → Anki" (o usuário quer passar a revisar no Anki). Exige "Import any learning progress"
marcado e testes no Anki 26.x real.

### 11.7 Testes (no nosso repo)
- `plugins/flashcards/tests/anki-export.test.cjs` (`node --test`): exportar um snapshot fixo → abrir o zip
  com JSZip e o `collection.anki2` com sql.js → `PRAGMA integrity_check`, contagem de notas e cartões por
  slot, tags, decks hierárquicos, `media` JSON. Reexportar com texto alterado → mesmo GUID. Esvaziar um
  slot → o cartão sai do pacote.
- Golden: `Date.now` em stub (padrão de `scripts/anki-fixtures.mjs`).
- Manual e opcional: importar num **perfil descartável** do Anki 26.x, reimportar após editar e verificar
  que nada duplica e que a agenda é preservada (o script Python do repo é o modelo, mas escrevemos o
  nosso; não executar o do clone).

---

## 12. Comparação rápida com alternativas

| Caminho | Prós | Contras |
|---|---|---|
| **anki-apkg-export 5 (este)** | offline, sem add-on, Node e browser, IDs estáveis, testado contra o Anki 26.09.3, MIT, ~845 LOC | formato legado `anki2`; sem progresso/revlog; tudo em memória; WASM extra do sql.js (ordem de 1 MB; não medido aqui) |
| AnkiConnect (HTTP) | sync bidirecional, lê revisões, edições incrementais, `importPackage` | exige Anki aberto mais o add-on (GPL-3.0); sr.ht fora do ar na checagem de 2026-11-18 |
| ankimcp (MCP sobre AnkiConnect) | agente opera o Anki por linguagem natural, 53 tools | beta; mesma dependência do AnkiConnect |
| Escrever o SQLite nós mesmos (`node:sqlite`) | sem WASM | refazer csum/req/cloze/zip, sem a bateria de testes contra o Anki; não recomendado |
| Obsidian (Markdown com sintaxe de cartões de plugins como *Spaced Repetition*) | trivial de gerar (só Markdown) | agendamento fraco e fora do nosso controle; não verificado o estado atual dos plugins (busca indisponível nesta sessão). Pode ser um exportador secundário barato |

---

## 13. Checklist de implementação (resumo executável)

1. `plugins/flashcards/package.json`: `anki-apkg-export@5.0.0` e `sql.js@1.14.2` exatos (ou a Opção B com
   código copiado).
2. `scripts/build.mjs`: copiar `sql-wasm.wasm` e os arquivos de licença para `dist/`.
3. `src/anki/model.ts` (ID fixo, `SLOTS = 8`, CSS cel-shading, `.nightMode`, assets `_lh-*`).
4. `src/anki/render.ts` (MD → HTML, `$` → `\(`, Mermaid → SVG por hash, sanitização).
5. `src/anki/export.ts` (`new Exporter(top, {sql, deckId, model})`, `addNotes`, `addMedia`,
   `save({type:'base64'})`, `close()` em `finally`).
6. Store: `state.anki.domains[domainId] = { deckId, slotMaps, lastExportAt }` mais a migração.
7. Backend: `register('anki-export', …)` (e depois `anki-connect-status`, `anki-import-via-connect`).
8. UI: "Exportar para Anki" no deck e na seleção, e no fluxo "Encerrar sessão".
9. Testes `node --test` (§11.7). Validação manual num perfil Anki descartável.
10. Fases 2 e 3 (AnkiConnect) e fase 4 (progresso) atrás de flags.

---

## 14. Questões em aberto

- O comportamento exato do importador do Anki 26.x com nota existente cujo **deck** mudou (move o cartão
  ou mantém?) e com modelo de mesmo ID mas `mod` mais novo (atualiza templates e CSS automaticamente?).
  Testar em perfil descartável.
- O formato de `cards.data` para o estado FSRS e as opções de importação de progresso no Anki 26.x
  (necessário só para P2).
- O AnkiConnect atual: versão, licença e semântica de caminho do `importPackage`. O sr.ht respondeu HTTP 502
  em 2026-11-18 e o espelho do GitHub só indica que o repo mudou para o sr.ht. A cota de busca web desta
  sessão acabou, então não deu para checar por outras fontes.
- AnkiDroid e AnkiMobile: importam o `anki2` legado gerado? (Não coberto pelos testes upstream.)
- Precisamos de mais de 8 cues por proposição? (Define `SLOTS` e a estratégia de nota de continuação.)
