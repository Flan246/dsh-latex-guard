# dsh-eval 报告

- 开始时间：2026-09-08T07:36:07.371Z
- 通过：4/4

| 场景 | 状态 | 耗时 | 断言通过 |
|---|---|---|---|
| bib 缺失字段补全 | passed | 32s | 3/3 |
| 引用完整性对账 | passed | 25s | 2/2 |
| bib 静态检查 | passed | 20s | 2/2 |
| 编译验证 | passed | 72s | 2/2 |

## bib 缺失字段补全

| 断言 | 结果 | 证据 |
|---|---|---|
| {"kind":"tool_called","tool":"bib_fill"} | ✓ | called with {"path": "D:\\Temp\\dsh-eval-MwV0YH\\refs.bib", "write": false} |
| {"kind":"file_contains","path":"refs.bib","substr":"year = {2015}"} | ✓ | contains "year = {2015}" |
| {"kind":"file_contains","path":"refs.bib","substr":"LeCun, Yann"} | ✓ | contains "LeCun, Yann" |

## 引用完整性对账

| 断言 | 结果 | 证据 |
|---|---|---|
| {"kind":"tool_called","tool":"cite_audit"} | ✓ | called with {"bib": "D:\\Temp\\dsh-eval-8lUUrf\\refs.bib", "tex": ["D:\\Temp\\dsh-eval-8lUUrf\\main.tex"]} |
| {"kind":"output_matches","pattern":"ghost2024moe"} | ✓ | matched /ghost2024moe/ |

## bib 静态检查

| 断言 | 结果 | 证据 |
|---|---|---|
| {"kind":"tool_called","tool":"bib_lint"} | ✓ | called with {"path": "D:\\Temp\\dsh-eval-Y3tTz4\\refs.bib"} |
| {"kind":"output_matches","pattern":"duplicate|missing|重复|缺"} | ✓ | matched /duplicate|missing|重复|缺/ |

## 编译验证

| 断言 | 结果 | 证据 |
|---|---|---|
| {"kind":"tool_called","tool":"latex_check"} | ✓ | called with {"dir": "D:\\Temp\\dsh-eval-yFrmJv", "entry": "main.tex", "engine": "xelatex"} |
| {"kind":"output_matches","pattern":"[Pp]ass(ed)?|通过|成功"} | ✓ | matched /[Pp]ass(ed)?|通过|成功/ |
