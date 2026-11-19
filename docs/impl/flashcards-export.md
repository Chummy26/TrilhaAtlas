# Módulo `flashcards` — FSRS-7, espelho no Obsidian, AnkiConnect e `.apkg`

Implementa o passo 5 da SÍNTESE §2.4(d) e o marco M4 sobre o plugin `plugins/flashcards`, seguindo o r7 §6–8 e os relatórios de `ts-fsrs` (§8, §14.6) e `anki-apkg-export`. Os contratos `ExternalLink`, `RevlogEntry` e `SyncCursor` são os da §2.3, campo por campo. Tudo roda no **backend Node** do plugin; o frontend só chama operações.

## API pública

| Arquivo | Exporta | Papel |
|---|---|---|
| `src/sync-types.ts` | `ExternalLink`, `RevlogEntry`, `SyncCursor`, `SyncSettings`, `SyncState` (com `revlogBackfill: number[]`), `ReviewClient`, `ANKI_REVLOG_EVIDENCE_WEIGHT` (0,3), `parseSyncState`, `applySyncSettingsPatch`, `normalizeAnkiConnectUrl` | Contratos e validação do `sync-cursor.json`. A URL do AnkiConnect só aceita loopback. |
| `src/fsrs7.ts` | `createFsrs7Schedule`, `rateFsrs7`, `previewFsrs7`, `replayMemory`, `completeHistory`, `migrateLegacySchedule`, `migrateStoreSchedules`, `replayMergedSchedule(schedule, history, settings?)`, `isFsrs7Schedule` | FSRS-7 do `ts-fsrs@6.0.0` (34 pesos padrão, dias fracionários, sem fuzz) com o calendário antigo: intervalos de Review em dias inteiros, vencendo na virada do dia de estudo (`dayStart`, `dueDay`). |
| `src/scheduling.ts` | `createSchedule`, `rate`, `preview`, `isDue`, `studyDay`, `dayBounds`, `chooseCue` | Fachada usada pelo backend. Roteia pelo campo `model`: `"fsrs-7"` vai para o FSRS-7; agendas antigas sem histórico completo continuam no `scheduler.cjs` (FSRS-6). Agenda New antiga começa no FSRS-7. |
| `src/export-model.ts` | `collectExportCards`, `ExportCard`, `cardKind`, `hasClozeDeletion`, `MAX_CLOZE_NUMBER` (500), `cleanText`, `ankiNoteContent`, `markdownToAnkiHtml`, `NOTE_TYPES`, `ankiDeckName`, `domainTag` | Converte o store em cartões neutros: `LH_ID` = id da cue; região = 1º baralho da proposição; tipo `basic`/`reverse`/`cloze` (`cue.kind`, ou `{{cN::…}}` utilizável). Texto sem caracteres de controle. |
| `src/obsidian-export.ts` | `exportToObsidian`, `renderCard`, `escapeCardLine`, `srSeesInlineMarker`, `clozeToObsidian`, `upsertManagedBlock`, `noteDomain`, `planRegionFiles`, `anchorFor`, `BLOCK_BEGIN`/`BLOCK_END` | Espelho só de ida em `LearnHarness/<Domínio>/<Região>.md`, sintaxe do plugin Spaced Repetition (`?`, `??`, `:::`, `==x==`, `^[dica]`, `[^N]`), âncora `<!--lh:id=…-->`. |
| `src/anki-connect.ts` | `connectAnki`, `withV6Fallback`, `isV1ContractError`, `createV1Api`, `createV6Api`, `pushToAnki` (→ `AnkiPushResult` com `adoptedCardIds`), `importAnkiRevlog(api, links, cursor, profile, backfill?)`, `toRevlogEntry`, `MAX_REVIEW_DURATION_MS` (60 000), `AnkiUnavailableError`, `AnkiConnectError`, `fieldQuery` | Cliente v1 (JSON-RPC em `/api/v1`, lotes ≤ 100, `Bearer`, polling de `operations.get`) com fallback v6 (`/`, `multi`). |
| `src/apkg-export.ts` | `buildApkg`, `writeApkg`, `noteGuid`, `stableDeckId`, `APKG_MODEL_IDS` | `.apkg` com `anki-apkg-export@5.0.0`, mesmos tipos de nota do AnkiConnect, GUID estável. |
| `src/export-service.ts` | `createExportService`, `resolveDomain`, `domainDirectory`, `inferDomainId`, `appRevlog`, `mergedHistory` | Orquestra tudo, grava `<dados>/sync-cursor.json` e serializa as sincronizações. |
| `src/fs-durable.ts` | `writeFileAtomic`, `commitNew`, `commitReplace`, `renameWithRetry` | Escrita atômica: temp + fsync + rename, publicação sem substituir (hard link) e rename com retry no Windows. |

**Operações do backend** (`ctx.handle`): `get-sync`, `save-sync-settings` (`obsidianVaultPath`, `reviewClient: "app" | "anki"`, `ankiConnectUrl`, `ankiApiKey`, `domainId`, `domainTitle`), `export-obsidian`, `anki-status`, `anki-push` e `export-anki` (`{ switchProfile?: boolean }`), `export-apkg` (todos os cartões), `anki-import-reviews`, `get-revlog` (`{ propositionId?, origin? }` → `RevlogEntry[]` + `evidenceWeight`). Com o Anki fechado, `export-anki` devolve `{ mode: "apkg", path, notes, bytes, alreadyInAnki, reason }` só com os cartões que o Anki ainda não tem (`path: null` quando não há nenhum). Com outro perfil do Anki aberto, push e importação devolvem `{ mode: "profile-mismatch", active, expected, message }` e não gravam nada.

**Configurações:** a seção "Exportação e sincronização" mostra o cofre, o modo de revisão, o endereço do AnkiConnect e os botões de exportar e importar.

## Decisões

- **Migração FSRS-6 → FSRS-7 sem perda.** Roda ao abrir o store (`store.cjs`, `migrateStoreSchedules`).
  - Uma agenda revisada é migrada só se o histórico estiver comprovadamente completo: o segmento desde a última revisão a partir do estado New tem `reps` itens encadeados (`before.reps` = 0, 1, 2…) e termina em `last_review`.
  - Nesse caso, `Reschedule.replay` recalcula **só a memória** (`stability`, `stabilityFast`, `difficulty`). `due`, `dueDay`, `state`, `reps`, `lapses` e os passos ficam iguais, e a memória FSRS-6 fica em `migratedFrom`.
  - Histórico incompleto mantém o FSRS-6 (`model` ausente), em vez de inventar `stabilityFast`.
  - Agendas New antigas não são reescritas ao abrir: viram FSRS-7 na 1ª nota.
  - As revisões nunca são alteradas.
- **Política do FSRS-7.** `allowModelOverride: false`, para os passos configurados continuarem valendo, e fuzz desligado (intervalos determinísticos).
  - Consequência: o primeiro Easy agenda cerca de 54 dias, contra cerca de 8 no FSRS-6.
  - Quatro testes antigos de `tests/backend.test.cjs` avançavam só 30 dias. Agora avançam 90 dias. A semântica testada não mudou.
- **Invariantes (property tests):** dar as notas uma a uma gera exatamente a mesma memória que `replayMemory`; o replay mesclado é igual a dar as notas do log mesclado em ordem e não muta a agenda de entrada.
- **Persistência separada.** Configurações de sync, cursor, links e revlog do Anki ficam em `sync-cursor.json` (SÍNTESE §2.2), não em `flashcards.json`. Assim, sincronizar não muda a `revision` do store de revisões e a chave do AnkiConnect nunca entra nos snapshots de review. `get-sync` devolve só `ankiApiKeySet`.
- **Domínio.** `settings.domainId`, ou o id inferido de `…/domains/<id>/plugins/flashcards` (com `path.dirname`, então letra de unidade e UNC ficam intactos; outro layout não infere nada), ou `"default"`. O título vem de `settings.domainTitle`, ou de `domain.json` (`title.pt`), ou do id. `reviewClient` começa com o valor de `domain.json`.
- **Obsidian.**
  - Os cartões ficam num bloco gerenciado (`<!-- lh:begin cards … -->` … `<!-- lh:end cards -->`). O texto fora dele nunca é reescrito. Um início sem fim, ou dois blocos na mesma nota, é recusado.
  - O conteúdo é neutralizado para não virar outro cartão:
    - linhas em branco são removidas, porque o SR fecha o cartão nelas;
    - linhas `?`/`??` são escapadas;
    - toda sequência de `:`/`=` é quebrada (`:::` → `:\:\:`, `===` → `=\=\=`); código inline só fica literal quando a regra do próprio SR (`srSeesInlineMarker`: 1ª ocorrência, crases ímpares dos dois lados) o trata como código;
    - o reverso de uma linha (`a:::b`) só é usado quando o SR vai dividir exatamente no nosso `:::`; senão vira `??` multilinha;
    - no cloze, um `=` encostado no `==` de uma lacuna vira `&#61;` (o `==…==` preguiçoso do SR mudaria a lacuna);
    - `<!--` vira `&lt;!--`, o que neutraliza qualquer `<!--SR:` vindo do conteúdo.
  - O exportador nunca cria `<!--SR:…-->`. Ele só preserva o comentário que o próprio plugin SR anexou a um cartão **inalterado**, para não apagar a agenda do usuário no Obsidian.
  - Notas mudadas passam por `<cofre>/.learnharness-staging/<uuid>/`. Nota nova é publicada com hard link (sem substituir). Nota existente usa rename atômico, depois de checar que não mudou desde a leitura.
  - Nota sem mudança não é tocada: o mtime fica igual.
  - Nota de região que sumiu é apagada só se estiver idêntica à última exportação. Se não, o bloco dela é esvaziado. Região renomeada só na caixa (mesmo arquivo no Windows/macOS, comparado por dev+ino) não conta como sumida.
  - Pastas só são criadas depois que o ancestral existente mais próximo resolve (realpath) dentro do cofre: link ou junção para fora é recusado sem criar nada.
  - Nota não rastreada com `lh_domain` de outro domínio (mesmo título no mesmo cofre) é recusada, em vez de mesclada ou esvaziada.
- **Anki.**
  - Tipos de nota próprios (`LearnHarness Basic/Reverse/Cloze v1`) com `LH_ID` como 1º campo: a API v1 não expõe GUID, e o teste de duplicata do Anki usa o 1º campo.
  - As notas são buscadas por tipo de nota e indexadas por `LH_ID`, então um link perdido é redescoberto. A criação usa `duplicates.allow = false`.
  - O conteúdo do app sobrescreve os campos. Tags do usuário fora de `lh::` são mantidas.
  - Notas cuja cue sumiu são só contadas (`orphans`), nunca apagadas.
  - Os cartões só são movidos de baralho quando a região mudou ou o link é novo.
  - Nota que já existia e é ligada agora (`.apkg` importado, link perdido) entra em `adoptedCardIds`. Com cursor em vigor, esses cartões vão para `revlogBackfill`, e a próxima importação lê o histórico deles desde o início, uma vez.
  - Anki fechado: o `.apkg` de fallback leva só cartões sem link Anki. Notas criadas pelo AnkiConnect têm GUID aleatório do Anki, e reempacotá-las duplicaria tudo no import. O `export-apkg` explícito continua levando todos os cartões.
  - Fallback v6 em dois níveis. Sem JSON-RPC em `/api/v1` (add-on antigo), `connectAnki` já devolve o cliente v6.
  - Os formatos de parâmetro da v1 seguem a lista de métodos do r7 §6.2; o schema completo não foi vendorizado. Por isso, se a v1 recusar o **contrato** de uma chamada, `withV6Fallback` refaz a tarefa inteira na v6 do mesmo add-on.
  - Contam como recusa de contrato: `-32601`, `-32602`, `unsupportedCapability` (1006) e `compatibilityError` (1016). Refazer é seguro porque push e importação são idempotentes por `LH_ID` e pelo id do revlog.
  - Perfil (r7 §8.3): links e cursor pertencem ao perfil gravado no `SyncCursor`. Com outro perfil aberto, push e importação param e devolvem `profile-mismatch`.
  - A troca só acontece num push com `switchProfile: true`, que a UI pede num diálogo de confirmação. Na troca, os links Anki antigos são descartados e o cursor do revlog volta a 0.
- **Revlog.** Entradas `manual`, `rescheduled`, `filtered` e sem nota são puladas. Nota e tipo aceitam nome ou número (ease 1–4, `type` 0–5); sem `answeredAt`, vale o id (epoch ms). `durationMs` é limitado a 60 s (r7 §8.4).
  - O cursor (`ankiLatestRevlogId`) é por perfil: o cursor de outro perfil não é confiado.
  - Com `reviewClient = "anki"`, a fila do app e a contagem de vencidos dos baralhos pulam as proposições com cue ligada ao Anki. Depois de importar, a agenda FSRS-7 inteira (memória, `state`, `reps`, `due`) é refeita dando as notas do log mesclado (app + Anki; r7 §8.4) em ordem, com as configurações do store. Agendas FSRS-6 New também. Agenda FSRS-6 revisada sem histórico migrável fica como está.
- **`.apkg`.** O GUID do `anki-apkg-export` é `sha1([topDeckId, modelId, ["id", noteId]])`. Por isso: `noteId` = `LH_ID`, `topDeckId` derivado do id do domínio e ids de modelo fixos.
  - O `anki-apkg-export` lança erro para o pacote inteiro com cloze vazio ou aberto, número > 500, ou `\u0000`/`\u001f` num campo. Por isso cloze sem lacuna utilizável vira `basic` e todo texto passa por `cleanText`.
  - O WASM precisa vir do **sql.js instalado** (`sql.js/dist/sql-wasm.wasm`). O WASM embutido no `anki-apkg-export@5.0.0` é do sql.js 1.14 e quebra com a cola JS 1.16 (`la is not a function`).
  - O build copia o WASM certo para `dist/sql-wasm.wasm` e grava `dist/THIRD-PARTY-LICENSES.txt` com a licença de todo pacote empacotado.

## Como testar

```bash
node scripts/run-tests.mjs "tests/flashcards-export-*.test.ts"   # 46 testes; diretórios temporários apagados ao fim
cd plugins/flashcards && node --test tests/*.test.cjs             # testes do plugin (206)
cd plugins/flashcards && npm run build                            # bundle + sql-wasm.wasm + licenças
```

No Windows, 2 dos 206 testes do plugin falham também no código original (`HEAD`): eles conferem o modo POSIX `0600` de arquivos, que o Windows não aplica. Os outros 204 passam.

Arquivos de teste:

- `flashcards-export-fsrs7`: store FSRS-6 real migrado, histórico incompleto, calendário e propriedades fast-check (inclusive replay mesclado = notas em ordem, sem mutar a entrada).
- `flashcards-export-obsidian`: cofre temporário. Cobre idempotência (mtime igual, âncora única), ausência de `<!--SR:`, texto do usuário preservado e órfãs. Tem propriedades checadas contra uma reimplementação independente da regra do SR (separadores e lacunas de cloze), além de renomeação só na caixa, bloco duplicado, junção para fora do cofre e nota de outro domínio.
- `flashcards-export-anki-connect`: servidor HTTP falso com v1 (JSON-RPC, lotes ≤ 100, Bearer, operações) e v6 (`multi`, `/api/v1` antigo). Cobre push idempotente, update e move; revlog com cursor (notas numéricas, limite de 60 s, backfill de nota adotada); recusa de contrato da v1 refeita na v6 sem duplicar; troca de perfil só com confirmação; o modo de revisão `anki` ponta a ponta (cartão revisado só no Anki sai de New e não conta como vencido no baralho); e o `.apkg` de fallback sem cartões que o Anki já tem.
- `flashcards-export-apkg`: `.apkg` aberto com JSZip + sql.js. Mesmo GUID e `LH_ID` em duas exportações; cloze malformado e caracteres de controle não derrubam o pacote.
- `flashcards-export-backend`: operações, validação de configurações, fallback para `.apkg` com o Anki fechado, ativação sobre store FSRS-6, layout `domains/<id>/plugins/flashcards` (UNC no Windows) e `revlogBackfill` no `sync-cursor.json`.

## Revisão adversarial: bugs corrigidos

1. O escape do Obsidian deixava separadores do SR: `:::` → `:\::`, `===` → `=\==`, crases desbalanceadas. O reverso `x:` + `:::` dividia no lugar errado.
2. Um `=` encostado numa lacuna (`x={{c1::y}}`) mudava a lacuna lida pelo SR.
3. Região renomeada só na caixa (Windows/macOS): a nota viva era apagada como sumida.
4. Bloco gerenciado duplicado mantinha cartões velhos e âncoras repetidas.
5. O `mkdir` rodava antes da checagem de link/junção e criava pastas fora do cofre.
6. Dois domínios com o mesmo título no mesmo cofre mesclavam ou esvaziavam as notas um do outro.
7. Cloze vazio, aberto ou > 500 era classificado como `cloze`: o `.apkg` inteiro falhava e o AnkiConnect recusava a nota.
8. Caracteres de controle (`\u001f`, `\u0000`) derrubavam o `.apkg` ou corrompiam campos.
9. O `.apkg` de fallback reempacotava notas criadas pelo AnkiConnect, que duplicavam no import.
10. O replay mesclado deixava em New um cartão revisado só no Anki (memória nova sem `state`/`reps`/`due`) e ignorava agendas FSRS-6 New.
11. O cursor do revlog descartava para sempre as revisões antigas de notas adotadas depois dele.
12. `durationMs` era limitado a 1 h, contra os 60 s do r7 §8.4.
13. Revisões v1 com nota ou tipo numéricos, ou sem `answeredAt`, eram descartadas.
14. O caminho do `domain.json`, remontado com split/join, quebrava em UNC.
15. A contagem de vencidos do baralho incluía proposições agendadas pelo Anki no modo `anki`.
16. `anchorFor` deixava `:` na âncora (podia formar `::`).
