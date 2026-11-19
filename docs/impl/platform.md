# Módulo `platform`: domínios, stats, registro de modelos, credenciais

Implementa SÍNTESE §2.2 (layout), §2.3 (contratos), §2.9 (papéis/catálogo), §2.10 (stats) e o marco M1.
Núcleo puro em `src/core/{domains,stats,models}/**`; I/O em `src/store/{domains,stats,credential}-store.ts`.

## API pública

### `src/core/domains` (puro, browser-safe)
- `paths.ts`: layout canônico como funções de `root` (= `LH_DATA_DIR`): `profileDir`, `statsDir`, `credentialsFile`,
  `activeDomainFile`, `usageLogFile(root, "YYYY-MM")`, `activityLogFile`, `libraryDir`, `libraryItemDir`, `domainsDir`,
  `domainsTrashDir`, `domainDir(root, id)`, `chatsDir`, `jobsDir`, `graphDir`, `curriculumDir`, `learnerDir`, `memoryDir`,
  `memoryDbFile`, `resourcesDir`, `progressDir`, `pluginsDir`, `flashcardsDir`, `promptsDir`, `domainPath`, `domainTree`,
  `workspaceTree`, `isWindowsDeviceName`, `isUsableDomainId`. Ids e segmentos que poderiam sair de `domains/<id>/` lançam
  `DomainPathError`, assim como nomes que o Windows não aceita (ids `con`/`nul`/`com1`…, `:`, `<>"|?*`, ponto/espaço final).
- `manifest-schema.ts`: `domainManifestSchema`, `domainProfileSchema`, `roleSpecSchema` (zod 4, `satisfies` os tipos),
  `parseDomainManifest`, `parseDomainProfile`, `checkDomainManifest`, `DomainManifestError` (lista todos os problemas).
- `defaults.ts`: `englishManifest`, `electronicsManifest`, `customManifest`, `builtinManifest(s)`, `defaultDomainProfile`.

### `src/core/stats` (puro)
- `types.ts`: `UsageEvent`, `ActivityEvent` (§2.3; adições opcionais `cacheWriteTokens`, `cacheWrite1hTokens`,
  `usageIncomplete`), `HEARTBEAT_WINDOW_SEC = 30`,
  `IDLE_TIMEOUT_SEC = 120`, `WORKSPACE_SCOPE`.
- `events.ts`: `usageEventFromCall(CallUsage, ctx)` (o hook único do provider), `activeSecondsInWindow`, `heartbeatEvent`.
- `aggregate.ts`: `aggregateUsage(events, {filter, pricing})` → linhas dia × domínio × op × modelo + `byModel`, `byDay`,
  `byDomain`, `byOp`, `total`; US$ só para `billing="api"`, créditos estimados só para `"subscription"`, via
  `pricingFromRates` ou `usdFromCallPricer(CallPricer)` (reaproveita `src/core/prices.ts`). `aggregateActivity` (horas/dia
  por união de heartbeats, corte exato na meia-noite local, sessões), `activityHeatmap(daily, {endDay, weeks})`.
- `schema.ts` (validação), `dates.ts` (`dayKey` com fuso, `monthKeyUtc`, `monthsInRange`).

### `src/core/models` (puro, sem IDs literais)
- `registry-types.ts`: `EntitlementEntry` (+ `billing`), `ModelMetadata`, `MetadataSource`, `ResolvedModelMetadata`, `CatalogModel`, `EntitlementSource`.
- `merge.ts`: `mergeMetadata`, `mergeLayers`, `buildCatalog`, `metadataIndex` (cascata nativo → models.dev → litellm → openrouter → pi → estimado).
- `resolve.ts`: `resolveRole(spec, entries, metadata, {lineRank, fallback, role})`, `rankForPreference`,
  `effectiveRoleSpec(role, {domain, global})`, `presetFallback`, `ModelResolveError` (`no-entitlements` | `pinned-unavailable` | `no-match`).

### Stores (`src/store`)
- `createStatsStore(root)`: `appendUsage`, `appendActivity`, `readUsage(range, {domain})`, `readActivity`, `listMonths`.
- `createDomainsStore(root, {now})`: `ensureWorkspace`, `ensureDomain`, `seedBuiltinDomains`, `hasDomain`, `read/write/updateManifest`,
  `read/write/updateProfile`, `listDomains`, `scanDomains`, `getActiveDomain`, `setActiveDomain`, `removeDomain`.
- `createCredentialStore({file, cipher, now})`: `get`, `has`, `keys`, `updatedAt`, `set`, `delete`, `clear`, `isAvailable`;
  `CredentialCipher` injetável; `createTestCipher` (AES-256-GCM, chave em memória).

## Decisões
- **Caminhos puros**: strings montadas sem `node:path`; o separador segue a raiz (`\` no Windows). `DomainProfile` fica em
  `domains/<id>/profile.json` (o `learner/profile.json` continua reservado ao learner model).
- **Domínios**: escrita só dentro do domínio pedido; leitura cruzada apenas no nível do workspace (listagem e checagem de
  `nodePrefix` único). `removeDomain` move para `domains/.trash/<id>-<stamp>` (recuperável) e recusa o domínio ativo.
- **Stats**: arquivos por mês UTC de `at`; append = ler + anexar + `writeFileAtomicSync` (sem fallback in-place: perder um
  heartbeat é melhor que arriscar o mês); lote validado inteiro antes de gravar; linhas inválidas são puladas e contadas.
  Horas = união dos intervalos `[at − min(activeSec, 30 s), at]` (duplicatas nunca contam duas vezes); sessão = gap ≤ 120 s.
  Heatmap: níveis por limiares em minutos 1/30/90/180 (180 = orçamento diário padrão).
- **Papéis**: `strongest` em dois estágios (r5 §5.3 princípio 3): dentro de cada conexão manda a ordem do provedor
  (`lineRank` editável → recência na linha → `order`), entre conexões só metadados (reasoning → preço de saída como proxy
  de tier, preço desconhecido por último → recência → contexto). `cheapest` = menor input+output; `fastest` = maior
  throughput; `balanced` = mediana superior da força por metadados entre os modelos com preço. `connection`/`avoidConnection`
  são preferências (nunca esvaziam o conjunto); `require` é filtro duro com erro que lista cada eliminação. Depreciados vão
  para o fim; ocultos, `supportedInApi:false` e aposentados nunca são escolhidos. Desempate final por conexão/provedor/id:
  resultado independe da ordem de entrada. Pin desaparecido migra por `upgradeTo`, depois pela mesma `line`, depois pelo
  `fallback` (preset do papel).
- **Cascata**: o primeiro valor VÁLIDO vence por campo; `cost` é atômico (uma fonte só); estimado = menor contexto conhecido
  da família ?? 128 000, saída 8 192, preço nunca estimado.
- **Credenciais**: o mapa inteiro (inclusive nomes das chaves) é cifrado num blob só; antes de gravar exige cifra disponível,
  ida e volta e ausência, no texto cifrado, do cofre serializado e de cada chave/segredo (cru e escapado em JSON, UTF-8 e
  UTF-16LE): cifra identidade é rejeitada com `plaintext-leak` mesmo para registros de token em JSON e segredos curtos. Cofre
  ilegível (outra chave/cifra/corrompido) lança erro em vez de ser sobrescrito; `clear()` é o reset explícito. Modo `0o600`.
- **Uso incompleto**: contadores de entrada/saída não informados viram 0 mas marcam `usageIncomplete`; o evento nunca é
  precificado (US$ ou créditos) a partir desses zeros e conta como `unpricedCalls`/`uncreditedCalls`. O recorte
  `cacheWrite1hTokens` é preservado para o `CallPricer` do servidor (sem ele, toda chamada com escrita de cache em provedor
  cujas retenções custam diferente ficaria sem preço).

## Como testar
```
node scripts/run-tests.mjs "tests/platform-*.test.ts"
```
`platform-domains` (layout, isolamento byte a byte entre dois domínios, ativo, prefixo, lixeira), `platform-stats` (hook,
totais por modelo, US$/créditos, heartbeats 30 s/120 s, meia-noite com fuso, propriedades fast-check, JSONL em diretório
temporário), `platform-models` (cascata, todas as preferências com metadados sintéticos, permutações, lint anti-ID),
`platform-credentials` (token nunca em claro, cifras inválidas recusadas, cofre ilegível preservado). Tudo em `os.tmpdir()`.

## Revisão adversarial (bugs corrigidos)
1. Cofre aceitava cifra identidade para registros de token em JSON (aspas escapadas) e segredos < 8 bytes → token em claro.
2. `resolveRole` não determinístico com metadados/ordem não finitos (NaN quebrava o comparador).
3. `cacheWrite1hTokens` descartado no hook → `usdFromCallPricer` sem preço para chamadas com escrita de cache.
4. Contadores ausentes viravam 0 e eram precificados (US$ 0 silencioso).
5. `denseDailySeries` entrava em laço infinito com dia final malformado.
6. `ensureDomain` gravava manifest/pastas antes de validar o perfil → domínio meio criado.
7. JSON com BOM (Bloco de Notas do Windows) tornava o domínio/ponteiro ativo ilegível.
8. Ids de dispositivo do Windows (`con`, `nul`…) e segmentos com `:`/ponto final aceitos nos caminhos.
9. Migração de pin: só 1 salto de `upgradeTo` e podia cair em modelo `deprecated` da mesma linha (r5 pede `active`).
10. `balanced` podia escolher mediana depreciada havendo modelo ativo.
11. Presets entregues por referência (mutar o retorno alterava `DEFAULT_ROLE_SPECS`).
12. Listagem de domínios ordenava `createdAt` como texto (offsets diferentes fora de ordem).
13. Teste de "sem temporários" listava o diretório corrente (`path.dirname` do CONTEÚDO do arquivo) e passava por acaso.

## Integração pendente (fora deste módulo)
- `src/core/index.ts`: reexportar `./domains/index.ts`, `./stats/index.ts`, `./models/index.ts` para `components/**`.
- `src/server/{domains,stats}.ts`: compor os stores com a raiz de `config.ts`, rotas `GET /api/stats`, `POST /api/stats/activity`.
- Hook do provider: chamar `usageEventFromCall` + `appendUsage` onde `CallUsage` é registrado.
- Electron main: adapter `CredentialCipher` com `safeStorage` (exemplo no cabeçalho de `credential-store.ts`) e migração dos JSON em claro.
