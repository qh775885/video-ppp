# 技术要点与踩坑记录

## 技术栈
- React 19 + Electron + Tailwind CSS v4
- AI：TensorFlow.js + COCO-SSD（lite_mobilenet_v2），本地推理 ~50-100ms
- 视频：FFmpeg（ffmpeg-static），支持 MP4/MKV/TS/AVI/MOV

## 长按快进机制（v2.0.8 定稿）
- 采用「固定节拍 setInterval(100ms) + seeked 事件门控」
- 帧未解码完（seekReady=false）则跳过当次 tick，保证匀速且不卡顿
- **禁止改回盲目 setInterval 或链式 seek**，前者卡顿，后者变速

## AI 检测时机
- 播放中：在 `onTimeUpdate` 中运行，120ms 冷却
- Seek 时：在 `seeked` 事件回调中运行，帧解码就绪才检测
- 批量提取：用 `waitForSeeked()` + `requestAnimationFrame` 确保帧就绪
- **禁止在未解码帧上运行 AI 推理**

## 自适应惯性算法
- 公式：`inertia = max(0.15, 0.8 - delta * 0.65)`
- 小位移 → 高惯性（丝滑），大位移 → 低惯性（快速跟上）
- 替代了旧的固定 0.7/0.3 混合比
