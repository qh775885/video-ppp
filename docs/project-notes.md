# 项目说明

## 规则
- `README.md` 只写已实现且用户可感知的功能
- `CHANGELOG.md` 只写已确认有效的用户可感知改动
- `开发进度.md` 记录当前状态、下一步和阶段路线
- `docs/ai-preferences.md` 记录长期协作偏好、UI 偏好和构建发布偏好
- `docs/current-focus.md` 记录当前阶段重点、暂缓项和已确认方向
- 发布流程：确认有效 -> 更新 `package.json` -> 更新 `CHANGELOG.md` -> 提交代码

## 现状
- 技术栈：React 19 + Electron + FFmpeg + TensorFlow.js / COCO-SSD
- 提取方式：`extract-frames` 全段扫描，`extract-frames-batch` 分段 seek
- 关键约束：临时文件必须清理；长按快进使用“固定节拍 + seeked 门控”；AI 检测必须等帧解码完成
- 当前问题：AI 能力仍在探索中；项目体积偏大；横转竖操作台仍需继续收紧布局

## 体积观察
- 当前目录绿色版体积已从约 1.03 GB 降到约 435 MB
- 安装版当前约 120 MB
- `resources/app.asar` 已从约 313 MB 降到约 13.6 MB
- 主要收益来自：前端依赖改为 `devDependencies`，不再作为运行时依赖打进包内
- `ffprobe-static` 仍是当前打包结果中的大项之一，但已只保留 `win32/x64`
- `ffmpeg-static` 约 79 MB，属于必要但较大的基础依赖

## 体积优化优先级
- 已完成：`ffprobe-static` 仅保留 Windows x64；前端依赖不再打入运行时包
- 下一步优先评估 `ffprobe-static` 是否可进一步替换为更轻的本地单文件方案
- 如后续重新强化 AI，再评估 TensorFlow.js / COCO-SSD 的引入方式，避免重新把体积拉回去
- Electron 本身体积较大，但短期内不是最容易动手的第一优化点

## 构建约定
- 对外主要命令只保留三条：`npm run dev`、`npm run build`、`npm run build:setup`
- `npm run verify`：内部验证命令，只做前端构建验证，不打包
- `npm run build`：构建带版本号的目录绿色版，便于本机直接使用和归档
- `npm run build:setup`：构建 NSIS 安装版，构建后 `release` 只保留安装包和现有目录绿色版

## 发布建议
- 自己使用优先目录绿色版（dir），便于按版本归档和回退
- 面向普通用户发布优先安装版（nsis），交付更完整
- 如需兼顾免安装用户，再补一个绿色版即可，通常不必单独发 zip

## 结论
- 1min 视频理想范围约 `30-50` 张
- 5min / 60fps 视频理想范围约 `100-120` 张
- 8min 视频理想范围约 `100-200` 张
- 全段扫描边际成本低，进入扫描模式后适合多取帧
- 高帧率视频不适合低张数分段 seek
- 推荐公式参考：`round(duration^0.6 × 3.5)`
