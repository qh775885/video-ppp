# AI Development Rules

## 1. 提交规范
- 中文 commit message，简洁说明改了什么

## 2. 版本号控制
- AI 根据 SemVer 自主递增 `package.json` 版本号
- 仅在**重要功能完成或关键 Bug 修复**后递增，日常小修不动版本号
- UI 中的版本号从 `package.json` 动态导入（`Sidebar.jsx`），**禁止硬编码版本号**

## 3. README.md 维护规则 ⚠️ 关键
- **网盘链接和截图区域禁止改动**（从 ` ``` 网盘下载地址` 到 `<img ... />` 这一段）
- README 只简洁列出**已实现功能**，不写版本号、不写花哨描述
- 新增功能时，在「功能」列表末尾追加一行即可
- 不删除、不重写已有功能条目，除非功能被移除
- 构建命令区域保持现状，无需改动

## 4. CHANGELOG.md 维护
- 每次版本号递增时，在顶部追加该版本的变更记录
- 格式：`## vX.X.X` + 日期 + 变更条目

## 5. 迭代计划
- 基于实际可落地原则，不堆虚无缥缈的需求
- 完成后划掉已完成条目，推演下一步

## 6. 开发环境
- 启动命令 `pnpm dev`（vite build && electron .）
- 修改代码后需重新 `pnpm dev` 才能看到效果
- 如果 `pnpm dev` 已在运行，不要重复启动

## 7. 项目技术要点
- 框架：React 19 + Electron + Tailwind CSS v4
- AI 跟踪：TensorFlow.js + COCO-SSD（lite_mobilenet_v2）
- 视频处理：FFmpeg（ffmpeg-static）
- 长按快进采用「固定节拍 + seeked 事件门控」，不要改回 setInterval 盲跳
- AI 检测必须在帧解码就绪（seeked 事件后）才运行，不要在未解码帧上检测

## 8. AI 自主维护
- 以上规则 AI 必须自动遵守，无需用户反复提醒
- 如果发现规则缺失或过时，主动更新此文件
