# 项目说明

## 规则
- `README.md` 只写已实现且用户可感知的功能
- `CHANGELOG.md` 只写已确认有效的用户可感知改动
- `开发进度.md` 记录当前状态、下一步和阶段路线
- 发布流程：确认有效 -> 更新 `package.json` -> 更新 `CHANGELOG.md` -> 提交代码

## 现状
- 技术栈：React 19 + Electron + FFmpeg + TensorFlow.js / COCO-SSD
- 提取方式：`extract-frames` 全段扫描，`extract-frames-batch` 分段 seek
- 关键约束：临时文件必须清理；长按快进使用“固定节拍 + seeked 门控”；AI 检测必须等帧解码完成
- 当前问题：AI 能力仍在探索中；项目体积偏大；横转竖操作台仍需继续收紧布局

## 构建约定
- `npm run verify`：只做前端构建验证，不打包
- `npm run build`：构建带版本号的目录绿色版，便于本机直接使用和归档
- `npm run build:setup`：构建 NSIS 安装版，便于正式发布
- `npm run build:release`：当前等同于安装版发布构建

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
