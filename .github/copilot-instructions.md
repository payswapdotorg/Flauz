# Flauz Repository Control-Plane Rule

Before changing or reviewing Flauz, read `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`, then `ARCHITECTURE-LOCK.md`, `WORK-REGISTRY.md`, `CURRENT-STATE.md`, and the owning TL handoff. The repository's integrated `main` tree and CI evidence outrank chat history, stale status snapshots, external lab repositories, and model-generated assumptions.

Do not create a second control plane. New material state must be reflected in the canonical program docs in the same merge wave as the implementation.

# VS Code Copilot Instructions

Visual Studio Code is built with a layered architecture using TypeScript, web APIs and Electron, combining web technologies with native app capabilities. The codebase is organized into key architectural layers:

## Root Folders
- `src/`: Main TypeScript source code with unit tests in `src/vs/*/test/` folders
- `build/`: Build scripts and CI/CD tools
- `extensions/`: Built-in extensions that ship with VS Code
- `test/`: Integration tests and test infrastructure
- `scripts/`: Development and build scripts
- `resources/`: Static resources (icons, themes, etc.)
- `out/`: Compiled JavaScript output (generated during build)

## Core Architecture (`src/` folder)
- `src/vs/base/` - Foundation utilities and cross-platform abstractions
- `src/vs/platform/` - Platform services and dependency injection infrastructure
- `src/vs/editor/` - Text editor implementation with language services, syntax highlighting, and editing features
- `src/vs/workbench/` - Main application workbench for web and desktop
  - `workbench/browser/` - Core workbench UI components (parts, layout, actions)
  - `workbench/services/` - Service implementations
  - `workbench/contrib/` - Feature contributions (git, debug, search, terminal, etc.)
  - `workbench/api/` - Extension host and VS Code API implementation
- `src/vs/code/` - Electron main process specific implementation
- `src/vs/server/` - Server specific implementation
- `src/vs/sessions/` - Agent sessions window, a dedicated workbench layer for agentic workflows (sits alongside `vs/workbench`, may import from it but not vice versa)

The core architecture follows these principles:
- **Layered architecture** - from `base`, `platform`, `editor`, to `workbench`
- **Dependency injection** - Services are injected through constructor parameters
- **Contribution model** - Features contribute to registries and extension points
- **Cross-platform compatibility** - Abstractions separate platform-specific code

## Validating TypeScript changes

Choose validation based on scope and risk. Prefer existing targeted diagnostics and tests over broad builds. Do not run a broad type check or build as a completion ritual.

Use targeted tests/builds when the change is broad, cross-cutting, affects build/type configuration, or another validation step reports compilation problems. Use the repository's existing CI gates for cross-TL verification.

## Coding Guidelines

- Use tabs, not spaces.
- Follow existing TypeScript naming and import conventions.
- Do not introduce `any` or `unknown` without a documented need.
- Reuse existing helpers and patterns rather than duplicating code.
- Register disposables immediately after creation.
- Keep user-facing messages localized.
- Use title-style capitalization for UI commands, buttons and menu items.
- Do not bypass service/API boundaries by reaching into another component's internals.
- Clean temporary iteration files.
- Preserve Microsoft copyright headers and existing project conventions.

## Flauz-specific design law

- Preserve the three-pillar architecture in `ARCHITECTURE-LOCK.md`.
- Prefer stable Code OSS APIs → built-in extensions → Flauz services → additive `src/vs/workbench/contrib/flauz` only when explicitly justified → core patches only with architecture-lock approval.
- Keep fork-critical changes at zero unless explicitly approved.
- Browser policy is fail-closed.
- Human authorization boundaries are first-class.
- External agent UI frameworks are downstream integrations, not alternate Flauz runtimes; CopilotKit/OpenMuse must not become runtime dependencies.
- Fixture evidence, simulated-provider evidence, and real-runtime evidence must remain explicitly distinguished.
