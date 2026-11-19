# TrilhaAtlas

Build a skill map for a subject you want to learn. TrilhaAtlas pairs each skill with a tutor, optional readings and videos, and a record of what you have practiced. Your next lesson can build on work from last week or take a detour into something that caught your interest.

![Electronics skill map with completed skills and a selected lesson](docs/assets/trilhaatlas-map.png)

*An example curriculum shown with simulated progress.*

## Start with your own subject

Open the domain menu on the home screen and select **Criar domínio de estudo**. Describe what you want to be able to do, choose a model, and create your tree. For example, “I want to learn astronomy from scratch and interpret telescope observations.” The tutor first outlines the regions, then writes skills, exercises and prerequisites for each one. You can follow progress, leave the page and return, or cancel before the new domain is installed.

To use your ChatGPT subscription, sign in during setup or open **Settings → Providers**. Choose your teaching model from the connected catalog. During setup you can apply a compatible ChatGPT model to the remaining roles too. Enable background access for that connection if you want it to consolidate memories and generate reinforcement between lessons. The creation form has its own model picker, and you can change the lesson model in the chat. Model availability and usage limits follow the connected account. [OpenAI sign-in guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

Every generated region gets a book search and a video search. When a catalog returns a relevant result, its title and link appear on the regional shelf. A matching table of contents or timestamp takes you to the specific chapter. One book may serve several regions. You can study immediately, explore the shelf or look for another source. Attach a text-readable PDF to a region and the tutor can retrieve a passage with its physical page when answering questions.

For hand-authored maps, copy the small map-reading example and import it locally. Electronics and English are larger public examples. [Domain authoring guide](docs/authoring-domains.md) · [Starter curriculum](examples/study-domain/map-reading/00-map.json)

Zoom out to see the whole subject. Zoom in to follow a prerequisite, open a specific chapter, or try a lesson before you commit to that path. Completed skills take on color. Each subject keeps its own conversations, evidence and tutor memory on your machine.

## When a lesson gets difficult

Suppose two different quiz questions reveal the same difficulty reading a contour interval. If the prerequisites are in place, the tutor can propose a short lesson on the missing step. The app checks the proposal and places the new skill beside the original. You can open it from the map or the daily study card. Your completed skills, main goal and core progress carry forward.

Reinforcement uses your configured background model and the domain’s token budget. The model can skip a proposal when the evidence is unclear or an existing skill already covers the gap.

## Run it locally

With Node.js 26 and npm installed, run

```sh
git clone https://github.com/Chummy26/TrilhaAtlas.git
cd TrilhaAtlas
npm ci
npm run plugins:setup
npm run dev
```

Open **http://localhost:3000** and choose a study domain. You can browse the map before connecting a model. To start an AI lesson, open **Settings → Providers**, connect a provider, then select your models. The study interface and lesson guidance are currently in Brazilian Portuguese.

Study records live on your machine. AI calls send the relevant lesson context to the provider you select. The profile shows study time and token usage by model. [Development guide](docs/development.md) · [Integration details](docs/impl/integration.md)

## Research behind the design

- **Estimating understanding over time.** Corbett and Anderson modeled how a learner’s knowledge changes with practice. TrilhaAtlas uses knowledge tracing and graded answers to update its estimate for each skill. [Knowledge Tracing](https://doi.org/10.1007/BF01099821)
- **Remembering beyond today’s lesson.** Roediger and Karpicke found that practicing retrieval improved delayed recall of prose passages in their experiments. The app uses short checks and schedules later reviews. [Test-Enhanced Learning](https://pubmed.ncbi.nlm.nih.gov/16507066/)
- **Remembering earlier conversations.** Hindsight separates source experiences from derived observations. Its design informed how the tutor retrieves evidence from earlier conversations in the same domain. [Hindsight, ACL 2026](https://aclanthology.org/2026.acl-demo.27/)

## Contribute

A concrete curriculum correction is a good first contribution. If a lesson assumes a skill you have not reached, open an issue with the domain, the two skill names and an example of the missing step. Reports about a misplaced chapter, an inaccessible video or a confusing map connection are also welcome. [Open an issue](https://github.com/Chummy26/TrilhaAtlas/issues) · [Contributing guide](CONTRIBUTING.md)

TrilhaAtlas builds on Amos Blomqvist’s learnharness. The application is licensed under AGPL-3.0 and the bundled curriculum data under CC BY-SA 4.0. [Upstream project](https://github.com/amosblomqvist/learnharness) · [Application license](LICENSE) · [Curriculum license](content/curricula/LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
