---
name: dsh-latex-guard
description: Check LaTeX projects and clean BibTeX files. Use when the user edits a LaTeX paper and wants compile errors explained, .bib entries deduplicated/filled from Crossref, or \cite keys audited against the bib.
---

# LaTeX Guard

If the host already has latex/bib plugin tools registered (latex_check/bib_lint/bib_fill/cite_audit), prefer calling those tools directly instead of the CLI.

Run the bundled CLI (installed as `dsh-latex-guard`, or `npx dsh-latex-guard`):

- `dsh-latex-guard check <dir> <entry.tex> [--json]` — latexmk compile + structured error report (skips gracefully if no LaTeX installed)
- `dsh-latex-guard bib-lint <file.bib> [--write]` — dedupe keys, check required fields, canonicalize
- `dsh-latex-guard bib-fill <file.bib> [--write]` — fill missing fields from Crossref (never overwrites)
- `dsh-latex-guard cite-audit <file.bib> <tex...>` — cited-but-missing and uncited entries

Default output is human-readable; pass `--json` when chaining into files.
`--write` modifies the bib in place — confirm with the user before using it.
