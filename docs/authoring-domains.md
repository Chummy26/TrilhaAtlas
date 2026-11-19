# Author a study domain

Start with a task the learner wants to perform. In the map-reading example, the learner compares two slopes on a topographic map. That requires understanding elevation along a contour line. Those two skills form a short route you can teach and test. [Complete example](../examples/study-domain/map-reading/00-map.json)

## Build and import a map

1. Copy the example folder outside the checkout. Choose a unique lowercase `domainId` and a two- to four-letter lowercase root ID. Replace every node ID, parent and prerequisite consistently. The root title becomes the domain name in the app.
2. Divide the subject into areas and units. A unit is a region on the map. Give each teachable leaf a short title, scope, an observable objective, a way to check it and an estimated duration in hours. Use `level.scheme = "generic"` and a numeric band for a subject without a specialized scale.
3. Connect each skill to the knowledge its activity uses. For example, `[["mp.terrain.contours.height"]]` requires the contour-height skill. Two IDs inside one list are both required. Two inner lists offer alternative routes. Use `softPrereqs` for a helpful connection that should not block a lesson.
4. With dependencies installed, import the folder from the repository root. The command reads its JSON seed files in filename order and validates their combined graph. It installs a new local domain and refuses an existing name or prefix. Refresh the app and select the new subject in the domain menu.

```sh
npm run domain:import -- examples/study-domain/map-reading
```

The graph, source catalog and replayable curriculum ledger are stored under the configured local data directory. Personal workspaces can live outside the repository. For authoring tests, set `LH_DATA_DIR` to a temporary directory. The English and electronics examples use the same seed format. [Seed schema](../src/core/curriculum/schema.ts)

## Add optional books and videos

Register each reading section or video segment in `sources` with a unique ID, title, language, HTTPS URL, usage and license information. Mark it as `"kind": "book"` or `"kind": "video"`. Link a skill or unit through an `anchors` entry containing that source ID and a readable section or segment name in `ref`. Omit the anchors if the lesson can stand on its own.

Use a publisher chapter link or a verified YouTube timestamp when available. Give different chapters or segments distinct source IDs. Reuse an ID wherever the same segment helps. A unit anchor appears among the region’s materials. A skill anchor also goes into that lesson. Imported links remain references. Keep private PDFs and downloaded material in the local library.

The example links a USGS field guide to two skills and an introductory lecture to the whole region. [USGS field guide](https://pubs.usgs.gov/gip/TopographicMapSymbols/topomapsymbols.pdf) · [USGS lecture](https://www.youtube.com/watch?v=TC7JpjL_Fok)

## Verify the learning path

Open the first skill as a beginner. Check that its example can be solved with the stated prerequisites, that the dependent skill names what is missing, and that the expected route opens after evidence of learning. Open a reading and a video from the region and check the actual section. Explore an advanced skill and return to the main route.

After installation, keep published IDs stable and apply curriculum changes through the versioned ledger. Repeated, distinct quiz mistakes can produce an optional practice skill beside its source. This preserves the completion rules of the original unit. To share a curriculum, publish the authored JSON and openly shareable references. Session logs and learner records belong to the learner.
