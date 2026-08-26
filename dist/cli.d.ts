#!/usr/bin/env node
//#region src/core/bib-lint.d.ts
interface LintIssue {
  kind: 'duplicate-key' | 'missing-field';
  key: string;
  detail: string;
}
//#endregion
//#region src/core/check.d.ts
interface LogIssue {
  line: number | null;
  message: string;
  file: string | null;
}
interface CheckReport {
  status: 'passed' | 'failed' | 'skipped';
  errors: LogIssue[];
  warnings: LogIssue[];
  missingCitations: string[];
  notice: string | null;
}
//#endregion
//#region src/core/format.d.ts
declare function formatIssues(issues: LintIssue[]): string;
declare function formatReport(r: CheckReport): string;
//#endregion
export { formatIssues, formatReport };