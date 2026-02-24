# 开发流程规则

## 提交规范
- 中文 commit message，简洁说明改了什么
- 格式：`类型: 描述`，类型可选 feat / fix / docs / refactor / rules

## 开发环境
- 启动：`pnpm dev`（执行 vite build && electron .）
- 修改代码后需重新 `pnpm dev`
- 如果 `pnpm dev` 已在运行，不要重复启动

## AI 自动运行开发命令
// turbo
- 代码修改完成后，AI 应自动执行 `pnpm dev` 进行验证
- 执行前先检查是否已有 `pnpm dev` 进程在运行，避免重复启动
- 如已在运行，先终止旧进程再重新启动

## AI 自主维护
- 以上规则 AI 必须自动遵守，无需用户反复提醒
- 发现规则缺失或过时时，主动更新对应规则文件
- 规则可按需拆分新文件，在 `README.md` 索引中登记

### 触发时机
- **完成功能 / 修复 bug 后**：更新 `开发进度.md`
- **踩到新坑 / 发现关键实现约束**：补充 `technical.md`
- **版本发布时**：更新 `CHANGELOG.md`、`迭代计划.md`
- **新增用户可感知功能后**：在 `README.md` 功能列表末尾追加
