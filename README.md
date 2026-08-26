# dsh-latex-guard

LaTeX compile check and BibTeX lint/fill/audit tools for DeepSeek Harness and any agent.

## Features

- **check** — compile a LaTeX project with `latexmk` and return a structured report of errors, warnings and undefined citations
- **bib-lint** — dedupe entry keys, check required fields per entry type, canonicalize formatting
- **bib-fill** — fill missing entry fields from Crossref by DOI or title (never overwrites existing values)
- **cite-audit** — compare `\cite` keys in `.tex` files against a `.bib` file: cited-but-missing and never-cited entries

All commands return human-readable output by default and structured JSON with `--json`. Exit codes: 0 success, 1 business error, 2 usage error. A `check` that compiles but reports `status: "failed"` also exits 1; a `skipped` check (latexmk unavailable) exits 0, since graceful degradation is not an error.

## Usage

### 1. As a dsh plugin

```bash
dsh plugin add dsh-latex-guard
```

Registers four agent tools: `latex_check`, `bib_lint`, `bib_fill`, `cite_audit`.

### 2. As a standalone CLI

```bash
npx dsh-latex-guard check <dir> <entry.tex> [--json]
npx dsh-latex-guard bib-lint <file.bib> [--write]
npx dsh-latex-guard bib-fill <file.bib> [--write]
npx dsh-latex-guard cite-audit <file.bib> <tex...>
```

`--write` modifies the bib in place — confirm before using it. As a safety net, both write paths refuse to write when the bib cannot be fully parsed (e.g. an entry missing its closing brace), instead of silently dropping the unparseable tail.

## Known limitations

- `cite-audit` counts `\cite` keys inside commented-out (`% ...`) lines as real citations.
- A `passed` check report may still carry citation warnings emitted by latexmk's intermediate passes; only the final pass reflects the true citation state.

### 3. As an agent skill

The `skill/SKILL.md` bundled in this package teaches any SKILL.md-compatible agent how to drive the CLI.

## latexmk dependency

`check` requires a TeX installation providing `latexmk` on `PATH` (e.g. TeX Live or MiKTeX). When `latexmk` is not found, `check` degrades gracefully: it returns a report with `skipped: true` instead of failing, so the other three commands (pure BibTeX/text processing, no TeX needed) remain fully usable.

`bib-fill` is the only command that needs network access (Crossref API, 10s timeout, one retry).

## License

MIT
