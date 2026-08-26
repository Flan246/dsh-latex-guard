#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { execFile } from "node:child_process";
import { basename, join } from "node:path";

//#region src/core/bib-parse.ts
function parseBib(text) {
	const entries = [];
	let i = 0;
	while (i < text.length) {
		const at = text.indexOf("@", i);
		if (at === -1) break;
		const head = /^@([a-zA-Z]+)\s*\{/.exec(text.slice(at, at + 64));
		if (!head) {
			i = at + 1;
			continue;
		}
		const type = head[1].toLowerCase();
		const open = at + head[0].length - 1;
		const close = matchBrace(text, open);
		if (close === -1) break;
		const raw = text.slice(at, close + 1);
		const body = text.slice(open + 1, close);
		const comma = body.indexOf(",");
		const key = (comma === -1 ? body : body.slice(0, comma)).trim();
		entries.push({
			type,
			key,
			fields: parseFields(comma === -1 ? "" : body.slice(comma + 1)),
			raw
		});
		i = close + 1;
	}
	return entries;
}
function matchBrace(text, open) {
	let depth = 0;
	for (let i = open; i < text.length; i++) if (text[i] === "{") depth++;
	else if (text[i] === "}" && --depth === 0) return i;
	return -1;
}
function parseFields(body) {
	const fields = {};
	let i = 0;
	while (i < body.length) {
		const m = /^\s*([a-zA-Z]+)\s*=\s*/.exec(body.slice(i));
		if (!m) break;
		const name = m[1].toLowerCase();
		i += m[0].length;
		let value = "";
		if (body[i] === "{") {
			const close = matchBrace(body, i);
			if (close === -1) break;
			value = body.slice(i + 1, close);
			i = close + 1;
		} else if (body[i] === "\"") {
			const close = body.indexOf("\"", i + 1);
			value = body.slice(i + 1, close === -1 ? void 0 : close);
			i = close === -1 ? body.length : close + 1;
		} else {
			const m2 = /[^,]+/.exec(body.slice(i));
			value = (m2?.[0] ?? "").trim();
			i += m2?.[0].length ?? 0;
		}
		fields[name] = value;
		const next = body.indexOf(",", i);
		i = next === -1 ? body.length : next + 1;
	}
	return fields;
}
function formatBib(entries) {
	return entries.map((e) => {
		const lines = Object.entries(e.fields).map(([k, v]) => `  ${k} = {${v}}`);
		return `@${e.type}{${e.key},\n${lines.join(",\n")}\n}`;
	}).join("\n\n") + "\n";
}

//#endregion
//#region src/core/bib-lint.ts
const REQUIRED = {
	article: [
		"author",
		"title",
		"journal",
		"year"
	],
	book: [
		"title",
		"publisher",
		"year"
	],
	inproceedings: [
		"author",
		"title",
		"booktitle",
		"year"
	]
};
function requiredFields(e) {
	return REQUIRED[e.type] ?? [
		"author",
		"title",
		"year"
	];
}
function lintBib(text) {
	const entries = parseBib(text);
	const issues = [];
	const seen = /* @__PURE__ */ new Set();
	const kept = [];
	for (const e of entries) {
		if (seen.has(e.key)) {
			issues.push({
				kind: "duplicate-key",
				key: e.key,
				detail: `duplicate entry key '${e.key}', later copy dropped`
			});
			continue;
		}
		seen.add(e.key);
		kept.push(e);
		const missing = requiredFields(e).filter((f) => !e.fields[f]?.trim());
		if (e.type === "book" && !e.fields.author?.trim() && !e.fields.editor?.trim()) missing.push("author/editor");
		if (missing.length) issues.push({
			kind: "missing-field",
			key: e.key,
			detail: `missing: ${missing.join(", ")}`
		});
	}
	return {
		issues,
		fixed: formatBib(kept)
	};
}

//#endregion
//#region src/core/types.ts
function ok(data) {
	return {
		ok: true,
		data
	};
}
function err(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}

//#endregion
//#region src/core/http.ts
const UA = "dsh-latex-guard/0.1.0 (mailto:latex-guard@users.noreply.github.com)";
const TIMEOUT_MS = 1e4;
async function fetchJson(url) {
	let lastErr = null;
	for (let attempt = 0; attempt < 2; attempt++) try {
		const res = await fetch(url, {
			headers: {
				"User-Agent": UA,
				Accept: "application/json"
			},
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (res.status === 404) return err("NOT_FOUND", `404: ${url}`);
		if (res.status === 429) return err("RATE_LIMITED", `429: ${url}`);
		if (!res.ok) {
			lastErr = err("HTTP_" + res.status, `${res.status}: ${url}`);
			continue;
		}
		return ok(await res.json());
	} catch (e) {
		lastErr = err("NETWORK", e instanceof Error ? e.message : String(e));
	}
	return lastErr ?? err("NETWORK", "unreachable");
}

//#endregion
//#region src/core/bib-fill.ts
function fieldsFromWork(w) {
	const out = {};
	if (w.title?.[0]) out.title = String(w.title[0]);
	if (Array.isArray(w.author) && w.author.length) out.author = w.author.map((a) => [a.family, a.given].filter(Boolean).join(", ")).join(" and ");
	const venue = w["container-title"]?.[0];
	if (venue) out[w.type === "journal-article" ? "journal" : "booktitle"] = String(venue);
	const year = w.published?.["date-parts"]?.[0]?.[0];
	if (year) out.year = String(year);
	if (w.volume) out.volume = String(w.volume);
	if (w.issue) out.number = String(w.issue);
	if (w.page) out.pages = String(w.page);
	if (w.DOI) out.doi = String(w.DOI).toLowerCase();
	return out;
}
async function fillBib(text, deps = {}) {
	const fj = deps.fetchJson ?? fetchJson;
	const entries = parseBib(text);
	const filled = [];
	const missing = [];
	for (const e of entries) {
		let r = null;
		if (e.fields.doi) r = await fj(`https://api.crossref.org/works/${encodeURIComponent(e.fields.doi)}`);
		else if (e.fields.title) r = await fj(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(e.fields.title)}&rows=1`);
		if (!r) {
			missing.push(e.key);
			continue;
		}
		if (!r.ok) {
			missing.push(e.key);
			continue;
		}
		const data = r.data;
		const work = e.fields.doi ? data?.message : data?.message?.items?.[0];
		if (!work) {
			missing.push(e.key);
			continue;
		}
		let touched = false;
		for (const [k, v] of Object.entries(fieldsFromWork(work))) if (!e.fields[k]?.trim()) {
			e.fields[k] = v;
			touched = true;
		}
		if (touched) filled.push(e.key);
	}
	return ok({
		fixed: formatBib(entries),
		filled,
		missing
	});
}

//#endregion
//#region src/core/cite-audit.ts
const CITE_RE = /\\(?:cite|citep|citet|parencite|textcite)(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;
function citeAudit(texSources, bibText) {
	const cited = /* @__PURE__ */ new Set();
	for (const tex of texSources) for (const m of tex.matchAll(CITE_RE)) for (const k of m[1].split(",")) {
		const key = k.trim();
		if (key) cited.add(key);
	}
	const bibKeys = new Set(parseBib(bibText).map((e) => e.key));
	return {
		missingInBib: [...cited].filter((k) => !bibKeys.has(k)).sort(),
		uncited: [...bibKeys].filter((k) => !cited.has(k)).sort()
	};
}

//#endregion
//#region src/core/check.ts
function parseLog(log) {
	const errors = [];
	const warnings = [];
	const missing = /* @__PURE__ */ new Set();
	const lines = log.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (l.startsWith("! ")) {
			const at = lines.slice(i + 1).find((x) => x.startsWith("l."));
			errors.push({
				line: at ? Number(at.slice(2).split(" ")[0]) : null,
				message: l.slice(2).trim(),
				file: null
			});
		} else if (l.includes("LaTeX Warning:")) {
			warnings.push({
				line: null,
				message: l.trim(),
				file: null
			});
			const c = /Citation '([^']+)'/.exec(l);
			if (c) missing.add(c[1]);
		}
	}
	return {
		errors,
		warnings,
		missingCitations: [...missing].sort()
	};
}
const defaultWhich = (cmd) => new Promise((resolve) => {
	execFile(process.platform === "win32" ? "where" : "which", [cmd], (e) => resolve(!e));
});
const defaultRun = (cmd, args, cwd) => new Promise((resolve, reject) => {
	execFile(cmd, args, {
		cwd,
		timeout: 12e4,
		maxBuffer: 16 * 1024 * 1024
	}, (e, stdout, stderr) => {
		if (e && e.killed) return reject(/* @__PURE__ */ new Error("latexmk timed out"));
		resolve({
			code: typeof e?.code === "number" ? e.code : 1,
			log: stdout + stderr
		});
	});
});
async function checkLatex(projectDir, entry, deps = {}) {
	const which = deps.which ?? defaultWhich;
	const run = deps.run ?? defaultRun;
	const read = deps.readFile ?? ((p) => readFile(p, "utf8"));
	const entryPath = join(projectDir, entry);
	let tex;
	try {
		tex = await read(entryPath);
	} catch {
		return err("NOT_FOUND", `entry not found: ${entryPath}`);
	}
	if (!await which("latexmk")) {
		let missingCitations = [];
		try {
			const bib = await read(join(projectDir, basename(entry, ".tex") + ".bib"));
			missingCitations = citeAudit([tex], bib).missingInBib;
		} catch {}
		return ok({
			status: "skipped",
			errors: [],
			warnings: [],
			missingCitations,
			notice: "latexmk not found on PATH; compile check skipped. Only cite audit was performed."
		});
	}
	let code;
	let log;
	try {
		({code, log} = await run("latexmk", [
			"-interaction=nonstopmode",
			"-pdf",
			entry
		], projectDir));
	} catch (e) {
		return err("LATEXMK_FAILED", e instanceof Error ? e.message : String(e));
	}
	const parsed = parseLog(log);
	return ok({
		status: code === 0 && parsed.errors.length === 0 ? "passed" : "failed",
		...parsed,
		notice: null
	});
}

//#endregion
//#region src/cli.ts
function formatIssues(issues) {
	if (issues.length === 0) return "No issues found.";
	return issues.map((i) => `[${i.kind}] ${i.key}: ${i.detail}`).join("\n");
}
function formatReport(r) {
	const lines = [`status: ${r.status}`];
	if (r.notice) lines.push(`notice: ${r.notice}`);
	for (const e of r.errors) lines.push(`ERROR${e.line ? ` (line ${e.line})` : ""}: ${e.message}`);
	for (const w of r.warnings) lines.push(`warn: ${w.message}`);
	if (r.missingCitations.length) lines.push(`missing citations: ${r.missingCitations.join(", ")}`);
	return lines.join("\n");
}
function print(r, asJson, render) {
	if (!r.ok) {
		console.error(`error[${r.error.code}]: ${r.error.message}`);
		process.exitCode = 1;
		return;
	}
	console.log(asJson ? JSON.stringify(r.data, null, 2) : render(r.data));
}
const program = new Command();
program.name("dsh-latex-guard").description("LaTeX compile check and BibTeX lint/fill/audit tools").option("--json", "print machine-readable JSON", false);
program.command("check").argument("<dir>").argument("<entry>").action(async (dir, entry) => {
	print(await checkLatex(dir, entry), program.opts().json, formatReport);
});
program.command("bib-lint").argument("<bib>").option("--write", "write fixed bib back", false).action(async (bib, o) => {
	const { issues, fixed } = lintBib(await readFile(bib, "utf8"));
	if (o.write) await writeFile(bib, fixed);
	print({
		ok: true,
		data: {
			issues,
			fixed: o.write ? "(written back)" : fixed
		}
	}, program.opts().json, (d) => formatIssues(d.issues));
});
program.command("bib-fill").argument("<bib>").option("--write", "write fixed bib back", false).action(async (bib, o) => {
	const r = await fillBib(await readFile(bib, "utf8"));
	if (r.ok && o.write) await writeFile(bib, r.data.fixed);
	print(r, program.opts().json, (d) => `filled: ${d.filled.join(", ") || "-"}\nmissing: ${d.missing.join(", ") || "-"}`);
});
program.command("cite-audit").argument("<bib>").argument("<tex...>").action(async (bib, texs) => {
	const bibText = await readFile(bib, "utf8");
	print({
		ok: true,
		data: citeAudit(await Promise.all(texs.map((t) => readFile(t, "utf8"))), bibText)
	}, program.opts().json, (d) => `missing in bib: ${d.missingInBib.join(", ") || "-"}\nuncited entries: ${d.uncited.join(", ") || "-"}`);
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) program.parseAsync();

//#endregion
export { formatIssues, formatReport };