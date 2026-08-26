#!/usr/bin/env node
//#region src/core/types.d.ts
type Result<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};
//#endregion
//#region src/core/check.d.ts
interface LogIssue {
  line: number | null;
  message: string;
  file: string | null;
}
interface CheckReport {
  status: 'passed' | 'failed' | 'skipped';
  engine: string;
  errors: LogIssue[];
  warnings: LogIssue[];
  missingCitations: string[];
  notice: string | null;
  logTail: string | null;
}
//#endregion
//#region src/core/bib-lint.d.ts
interface LintIssue {
  kind: 'duplicate-key' | 'missing-field';
  key: string;
  detail: string;
}
//#endregion
//#region src/core/format.d.ts
declare function formatIssues(issues: LintIssue[]): string;
declare function formatReport(r: CheckReport): string;
//#endregion
//#region src/cli.d.ts
declare function printCheck(r: Result<CheckReport>, asJson: boolean): void;
declare function guardedWriteBib(path: string, original: string, fixed: string): Promise<Result<null>>;
//#endregion
export { formatIssues, formatReport, guardedWriteBib, printCheck };