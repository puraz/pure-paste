# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React renderer source (entry: `src/main.jsx`, main view: `src/App.jsx`).
- `src/assets/` and `public/`: static assets (the Vite public folder is served at `/`).
- `src-tauri/`: Rust backend and desktop packaging.
- `src-tauri/src/`: Rust entry points and commands.
- `src-tauri/tauri.conf.json` and `src-tauri/capabilities/`: app configuration and permissions.
- Generated/build outputs: `dist/` (Vite), `src-tauri/target/`, and `src-tauri/gen/` (do not hand-edit).

## Build, Test, and Development Commands
Use `pnpm` (lockfile present).
- `pnpm install`: install JS dependencies.
- `pnpm dev`: run the Vite dev server for the web UI.
- `pnpm build`: build the web UI to `dist/`.
- `pnpm preview`: preview the built UI locally.
- `pnpm tauri dev`: run the desktop app in dev mode.
- `pnpm tauri build`: build desktop bundles.

## Coding Style & Naming Conventions
- JavaScript/JSX uses 2-space indentation, semicolons, and double quotes (match existing style in `src/App.jsx`).
- Frontend UI uses Material UI (MUI); prefer MUI components and theming for new UI work.
- Rust uses standard `rustfmt` conventions (4-space indentation). Run `cargo fmt` in `src-tauri/` if you touch Rust code.
- File naming follows Vite defaults (`App.jsx`, `main.jsx`) and Rust module naming in `src-tauri/src/`.
- Code must include detailed Chinese comments explaining intent and behavior.

## Testing Guidelines
- No JS test runner is configured.
- For Rust, use `cargo test` from `src-tauri/` if you add backend tests.
- Name new tests descriptively and keep them near related modules.

## Commit & Pull Request Guidelines
- Git history is not available in this checkout, so no commit message convention is observable.
- Suggested pattern: short, imperative subject lines (e.g., "Add tray menu", "Fix paste hotkey").
- PRs should include: summary, testing steps, and screenshots for UI changes. Link related issues if applicable.

## Security & Configuration Notes
- Review changes to `src-tauri/tauri.conf.json` and `src-tauri/capabilities/` carefully; they control app permissions.
- Avoid editing generated files in `src-tauri/gen/` or build artifacts in `src-tauri/target/`.
