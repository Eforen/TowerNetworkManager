# Tower Networking Manager

Client-side PWA for modeling and analyzing tower networks. Vue 3 + TypeScript + Pinia + d3-force.

## Status

Phase 0 scaffold. See [PLAN-PHASES.md](PLAN-PHASES.md) for the full roadmap and [docs/specs/](docs/specs/) for the authoritative specifications.

## Quickstart

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle into dist/
npm run preview    # serve the production bundle locally
npm test           # run Vitest suite (Vitest + happy-dom)
npm run lint       # ESLint over src + tests
```

## Layout

```
src/
  model/        graph data model (graphdata.md)
  format/       TNI v1 text file format (fileformat.md)
  store/        Pinia stores: project / graph / fsm / filter / history
  fsm/          app state machine (statemachine.md)
  commands/     command registry (commands.md)
  palette/      command palette UI (commandline.md)
  view/         d3-force graph view (visualization.md)
  filters/      filter panel (filters.md)
  inspector/    node inspector + entity editor
  analysis/     supply/demand, shortest-path, bottlenecks, resources
  specs/        Specs page (behaviors.md + programs.md)
  inspect/      inspection tools (inspect.md)
  styles/       variables.css, base.css
tests/          Vitest specs
docs/specs/     authoritative spec markdown
```

## Philosophy

Browser-only. No server. Projects persist to `localStorage` and export to the line-oriented `.tni` text format defined in [docs/specs/fileformat.md](docs/specs/fileformat.md).
