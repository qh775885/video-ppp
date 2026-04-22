# 项目协作规则

本文件是项目唯一的 AI/协作主规则入口。

## 目标
- 优先轻量、稳定、实用
- 能小改解决的问题，不做大重构
- 不为低收益能力引入大体积依赖

## 开发与验证
- 使用 `npm run dev`
- 修改后优先做最小验证，需要构建时用 `npm run build` 或 `npx vite build`
- 同类开发进程已在运行时，不重复启动

## 提交
- commit message 使用中文
- 格式：`类型: 描述`
- 类型：`feat`、`fix`、`docs`、`refactor`、`rules`

## 版本与文档
- 版本号只在 `package.json` 维护，UI 版本号必须从中读取
- 只有在用户确认功能或修复有效后，才更新版本号
- 完成功能或修复后更新 `开发进度.md`
- 发布前更新 `CHANGELOG.md`
- 项目说明、维护规则、技术记录统一放在 `docs/project-notes.md`

## 技术约束
- FFmpeg 临时文件必须清理
- 长按快进/快退继续使用“固定节拍 + seeked 门控”机制
- 未解码完成的帧上禁止运行 AI 推理

## 参考文档
- `docs/project-notes.md`
