import { readFile } from "node:fs/promises";
import { ProxyAgent, fetch } from "undici";
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
function isFullyParsed(text) {
	return (text.match(/@[a-zA-Z]+\s*\{/g)?.length ?? 0) <= parseBib(text).length;
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
const UA = "dsh-latex-guard/0.1.3 (mailto:latex-guard@users.noreply.github.com)";
const TIMEOUT_MS = 1e4;
const CACHE_TTL_MS = 300 * 1e3;
const CACHE_MAX = 200;
const CACHE_EVICT_BATCH = 20;
const cache = /* @__PURE__ */ new Map();
let cachedProxy = null;
function resetProxyAgent() {
	if (cachedProxy) {
		cachedProxy.agent.close();
		cachedProxy = null;
	}
}
function proxyDispatcher() {
	const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
	if (!proxy) {
		resetProxyAgent();
		return;
	}
	if (cachedProxy?.url !== proxy) {
		resetProxyAgent();
		cachedProxy = {
			url: proxy,
			agent: new ProxyAgent(proxy)
		};
	}
	return cachedProxy.agent;
}
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function retryAfterMs(res) {
	const raw = res.headers.get("retry-after");
	const seconds = raw === null ? NaN : Number(raw);
	return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 1) * 1e3;
}
function cacheSet(url, data) {
	if (cache.size >= CACHE_MAX) {
		let removed = 0;
		for (const key of cache.keys()) {
			cache.delete(key);
			if (++removed >= CACHE_EVICT_BATCH) break;
		}
	}
	cache.set(url, {
		data,
		expiry: Date.now() + CACHE_TTL_MS
	});
}
async function request(url) {
	return fetch(url, {
		headers: {
			"User-Agent": UA,
			Accept: "application/json"
		},
		signal: AbortSignal.timeout(TIMEOUT_MS),
		dispatcher: proxyDispatcher()
	});
}
async function fetchJson(url) {
	const hit = cache.get(url);
	if (hit) {
		if (hit.expiry > Date.now()) return ok(hit.data);
		cache.delete(url);
	}
	let lastErr = null;
	for (let attempt = 0; attempt < 2; attempt++) try {
		let res = await request(url);
		if (res.status === 429) {
			try {
				await res.body?.cancel();
			} catch {}
			await sleep(retryAfterMs(res));
			res = await request(url);
			if (res.status === 429) return err("RATE_LIMITED", `429: ${url}`);
		}
		if (res.status === 404) return err("NOT_FOUND", `404: ${url}`);
		if (!res.ok) {
			lastErr = err("HTTP_" + res.status, `${res.status}: ${url}`);
			continue;
		}
		const data = await res.json();
		cacheSet(url, data);
		return ok(data);
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
	const failed = [];
	for (const e of entries) {
		let r = null;
		if (e.fields.doi) r = await fj(`https://api.crossref.org/works/${encodeURIComponent(e.fields.doi)}`);
		else if (e.fields.title) r = await fj(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(e.fields.title)}&rows=1`);
		if (!r) {
			missing.push(e.key);
			continue;
		}
		if (!r.ok) {
			if (r.error.code === "NOT_FOUND") missing.push(e.key);
			else failed.push(`${e.key} (${r.error.code})`);
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
		missing,
		failed
	});
}

//#endregion
//#region src/core/cite-audit.ts
const CITE_RE = /\\(?:cite|citep|citet|parencite|textcite|autocite|footcite|fullcite|nocite)(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;
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
function detectEngine(tex) {
	const magic = /^%+\s*!\s*TeX\s+program\s*=\s*(\S+)/im.exec(tex);
	if (magic) {
		const p = magic[1].toLowerCase();
		if (p.includes("xetex") || p.includes("xelatex")) return "xelatex";
		if (p.includes("luatex") || p.includes("lualatex")) return "lualatex";
	}
	if (/\\RequireXeTeX|xeCJK|\{ctex/.test(tex)) return "xelatex";
	if (/\\RequireLuaTeX/.test(tex)) return "lualatex";
	const body = tex.replace(/^\s*%.*$/gm, "");
	if (/[\u4e00-\u9fff]/.test(body)) return "xelatex";
	return "pdflatex";
}
const ENGINE_FLAG = {
	pdflatex: "-pdf",
	xelatex: "-xelatex",
	lualatex: "-lualatex"
};
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
		} else if (/^\s*\* /.test(l)) {
			const block = [];
			while (i < lines.length && /^\s*\* /.test(lines[i])) {
				block.push(lines[i].replace(/^\s*\* /, "").trim());
				i++;
			}
			const text = block.join(" ");
			if (/sorry!/i.test(text) || /required/i.test(text)) errors.push({
				line: null,
				message: text,
				file: null
			});
		}
	}
	return {
		errors,
		warnings,
		missingCitations: [...missing].sort()
	};
}
function logTailOf(log) {
	const tail = log.split("\n").slice(-30).map((l) => l.replace(/\r$/, "")).join("\n");
	return tail.length > 2e3 ? tail.slice(-2e3) : tail;
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
			code: e ? typeof e.code === "number" ? e.code : 1 : 0,
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
	let engine;
	if (deps.engine && deps.engine !== "auto") engine = deps.engine;
	else {
		engine = detectEngine(tex);
		if (engine === "pdflatex") {
			const cls = /\\documentclass(?:\[[^\]]*\])?\{([^}/.]+)\}/.exec(tex);
			if (cls) try {
				engine = detectEngine(await read(join(projectDir, `${cls[1]}.cls`)));
			} catch {}
		}
	}
	if (!await which("latexmk")) {
		let missingCitations$1 = [];
		try {
			const bib = await read(join(projectDir, basename(entry, ".tex") + ".bib"));
			missingCitations$1 = citeAudit([tex], bib).missingInBib;
		} catch {}
		return ok({
			status: "skipped",
			engine,
			errors: [],
			warnings: [],
			missingCitations: missingCitations$1,
			notice: "latexmk not found on PATH; compile check skipped. Only cite audit was performed.",
			logTail: null
		});
	}
	let code;
	let log;
	try {
		({code, log} = await run("latexmk", [
			"-interaction=nonstopmode",
			ENGINE_FLAG[engine],
			entry
		], projectDir));
	} catch (e) {
		return err("LATEXMK_FAILED", e instanceof Error ? e.message : String(e));
	}
	const parsed = parseLog(log);
	const status = code === 0 && parsed.errors.length === 0 ? "passed" : "failed";
	let missingCitations = parsed.missingCitations;
	if (status === "passed" && missingCitations.length > 0) try {
		const bib = await read(join(projectDir, basename(entry, ".tex") + ".bib"));
		const real = new Set(citeAudit([tex], bib).missingInBib);
		missingCitations = missingCitations.filter((k) => real.has(k));
	} catch {}
	return ok({
		status,
		engine,
		...parsed,
		missingCitations,
		notice: null,
		logTail: status === "failed" && parsed.errors.length === 0 ? logTailOf(log) : null
	});
}

//#endregion
//#region src/core/format.ts
function formatFill(d) {
	const lines = [`filled: ${d.filled.join(", ") || "-"}`, `missing: ${d.missing.join(", ") || "-"}`];
	if (d.failed?.length) lines.push(`failed: ${d.failed.join(", ")}`);
	return lines.join("\n");
}
function formatIssues(issues) {
	if (issues.length === 0) return "No issues found.";
	return issues.map((i) => `[${i.kind}] ${i.key}: ${i.detail}`).join("\n");
}
function formatReport(r) {
	const lines = [`status: ${r.status}`, `engine: ${r.engine}`];
	if (r.notice) lines.push(`notice: ${r.notice}`);
	for (const e of r.errors) lines.push(`ERROR${e.line ? ` (line ${e.line})` : ""}: ${e.message}`);
	for (const w of r.warnings) lines.push(`warn: ${w.message}`);
	if (r.missingCitations.length) lines.push(`missing citations: ${r.missingCitations.join(", ")}`);
	if (r.logTail) lines.push(`--- log tail ---\n${r.logTail}`);
	return lines.join("\n");
}

//#endregion
export { citeAudit as a, ok as c, checkLatex as i, lintBib as l, formatIssues as n, fillBib as o, formatReport as r, err as s, formatFill as t, isFullyParsed as u };