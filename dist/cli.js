#!/usr/bin/env node
import { a as fillBib, i as citeAudit, n as formatReport, o as err, r as checkLatex, s as lintBib, t as formatIssues } from "./format-DkT8wG58.js";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

//#region src/cli.ts
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
	let text;
	try {
		text = await readFile(bib, "utf8");
	} catch {
		print(err("NOT_FOUND", `file not found: ${bib}`), program.opts().json, () => "");
		return;
	}
	const { issues, fixed } = lintBib(text);
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
	let text;
	try {
		text = await readFile(bib, "utf8");
	} catch {
		print(err("NOT_FOUND", `file not found: ${bib}`), program.opts().json, () => "");
		return;
	}
	const r = await fillBib(text);
	if (r.ok && o.write) await writeFile(bib, r.data.fixed);
	print(r, program.opts().json, (d) => `filled: ${d.filled.join(", ") || "-"}\nmissing: ${d.missing.join(", ") || "-"}`);
});
program.command("cite-audit").argument("<bib>").argument("<tex...>").action(async (bib, texs) => {
	let bibText;
	let sources;
	try {
		bibText = await readFile(bib, "utf8");
		sources = await Promise.all(texs.map((t) => readFile(t, "utf8")));
	} catch {
		print(err("NOT_FOUND", `file not found: ${bib} or one of the tex sources`), program.opts().json, () => "");
		return;
	}
	print({
		ok: true,
		data: citeAudit(sources, bibText)
	}, program.opts().json, (d) => `missing in bib: ${d.missingInBib.join(", ") || "-"}\nuncited entries: ${d.uncited.join(", ") || "-"}`);
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) program.parseAsync();

//#endregion
export { formatIssues, formatReport };