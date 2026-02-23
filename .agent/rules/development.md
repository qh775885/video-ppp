# 开发流程规则

## 提交规范
- 中文 commit message，简洁说明改了什么
- 格式：`类型: 描述`，类型可选 feat / fix / docs / refactor / rules

## 开发环境
- 启动：`pnpm dev`（执行 vite build && electron .）
- 修改代码后需重新 `pnpm dev`
- 如果 `pnpm dev` 已在运行，不要重复启动

## AI 自主维护
- 以上规则 AI 必须自动遵守，无需用户反复提醒
- 发现规则缺失或过时时，主动更新对应规则文件
- 规则可按需拆分新文件，在 `README.md` 索引中登记
