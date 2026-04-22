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
- 当前问题：AI 加载慢、跟踪一般；项目体积偏大

## 结论
- 1min 视频理想范围约 `30-50` 张
- 5min / 60fps 视频理想范围约 `100-120` 张
- 8min 视频理想范围约 `100-200` 张
- 全段扫描边际成本低，进入扫描模式后适合多取帧
- 高帧率视频不适合低张数分段 seek
- 推荐公式参考：`round(duration^0.6 × 3.5)`
