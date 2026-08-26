import { a as fillBib, c as lintBib, i as citeAudit, l as isFullyParsed, n as formatReport, r as checkLatex, t as formatIssues } from "./format-BjpiKbQa.js";
import { readFile, writeFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/plugin.ts
const name = "dsh-latex-guard";
const inject = ["tools"];
const asValue = (r) => r.ok ? r.data : { error: r.error };
async function readOrError(path) {
	try {
		return {
			ok: true,
			data: await readFile(path, "utf8")
		};
	} catch {
		return {
			ok: false,
			error: {
				code: "NOT_FOUND",
				message: `file not found: ${path}`
			}
		};
	}
}
async function writeOrError(path, content) {
	try {
		await writeFile(path, content, "utf8");
		return {
			ok: true,
			data: null
		};
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "WRITE_FAILED",
				message: `write failed: ${path}: ${e.message}`
			}
		};
	}
}
function parseIncompleteError(path) {
	return {
		code: "PARSE_INCOMPLETE",
		message: `refusing to write ${path}: the bib is not fully parseable (an entry is probably missing its closing brace); writing back would drop content. Fix the entry first.`
	};
}
function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "latex_check",
		description: "Compile a LaTeX project with latexmk and return structured errors, warnings and undefined citations. Skips gracefully when latexmk is unavailable.",
		parameters: {
			dir: {
				type: "string",
				required: true,
				description: "Absolute path of the LaTeX project directory"
			},
			entry: {
				type: "string",
				required: true,
				description: "Entry .tex filename relative to dir, e.g. main.tex"
			},
			engine: {
				type: "string",
				description: "latexmk engine: auto (default, detects XeTeX/LuaTeX markers), pdflatex, xelatex or lualatex"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, v) => [{
				type: "text",
				text: v?.error ? `Check failed: ${v.error.message}` : formatReport(v)
			}]
		},
		async execute(args) {
			const ENGINES = [
				"auto",
				"pdflatex",
				"xelatex",
				"lualatex"
			];
			if (args.engine !== void 0 && !ENGINES.includes(args.engine)) return { error: {
				code: "INVALID_ENGINE",
				message: `engine must be one of ${ENGINES.join(", ")} (got "${args.engine}")`
			} };
			return asValue(await checkLatex(args.dir, args.entry, args.engine ? { engine: args.engine } : {}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "bib_lint",
		description: "Lint a .bib file: duplicate keys, missing required fields, canonical formatting. Optionally writes the fixed content back.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute path of the .bib file"
			},
			write: {
				type: "boolean",
				description: "Write the fixed bib back to the file (default false)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, v) => [{
				type: "text",
				text: v?.error ? `Lint failed: ${v.error.message}` : formatIssues(v.issues)
			}]
		},
		async execute(args) {
			const r = await readOrError(args.path);
			if (!r.ok) return { error: r.error };
			const { issues, fixed } = lintBib(r.data);
			if (args.write) {
				if (!isFullyParsed(r.data)) return { error: parseIncompleteError(args.path) };
				const w = await writeOrError(args.path, fixed);
				if (!w.ok) return { error: w.error };
			}
			return {
				issues,
				fixed: args.write ? "(written back)" : fixed
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "bib_fill",
		description: "Fill missing .bib entry fields from Crossref by DOI or title. Never overwrites existing values.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute path of the .bib file"
			},
			write: {
				type: "boolean",
				description: "Write the filled bib back to the file (default false)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, v) => [{
				type: "text",
				text: v?.error ? `Fill failed: ${v.error.message}` : `filled: ${v.filled.join(", ") || "-"}; missing: ${v.missing.join(", ") || "-"}`
			}]
		},
		async execute(args) {
			const r = await readOrError(args.path);
			if (!r.ok) return { error: r.error };
			const filled = await fillBib(r.data);
			if (!filled.ok) return { error: filled.error };
			if (args.write) {
				if (!isFullyParsed(r.data)) return { error: parseIncompleteError(args.path) };
				const w = await writeOrError(args.path, filled.data.fixed);
				if (!w.ok) return { error: w.error };
			}
			return filled.data;
		}
	}));
	ctx.tools.register(defineTool({
		name: "cite_audit",
		description: "Compare \\cite keys in .tex files against a .bib file. Reports cited keys missing from the bib and bib entries never cited.",
		parameters: {
			bib: {
				type: "string",
				required: true,
				description: "Absolute path of the .bib file"
			},
			tex: {
				type: "array",
				required: true,
				description: "Absolute paths of .tex files"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, v) => [{
				type: "text",
				text: v?.error ? `Audit failed: ${v.error.message}` : `missing in bib: ${v.missingInBib.join(", ") || "-"}; uncited: ${v.uncited.join(", ") || "-"}`
			}]
		},
		async execute(args) {
			const bib = await readOrError(args.bib);
			if (!bib.ok) return { error: bib.error };
			const sources = [];
			for (const t of args.tex) {
				const r = await readOrError(t);
				if (!r.ok) return { error: r.error };
				sources.push(r.data);
			}
			return citeAudit(sources, bib.data);
		}
	}));
}

//#endregion
export { apply, inject, name };