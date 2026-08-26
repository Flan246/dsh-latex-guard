# AGENTS.md

## 环境限制

本机 pnpm 存在预检 bug，`pnpm test` / `pnpm build` 等脚本命令不可用。请直接使用本地二进制：

- 测试：`./node_modules/.bin/vitest run`（可加测试文件路径过滤）
- 构建：`./node_modules/.bin/tsdown`

## 项目结构

- `src/core/` 纯 TS 业务逻辑（零 dsh 依赖）
- `tests/` vitest 测试
