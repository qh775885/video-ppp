# 技术要点与踩坑记录

## 技术栈
- React 19 + Electron + Tailwind CSS v4
- AI：TensorFlow.js + COCO-SSD（lite_mobilenet_v2），本地推理 ~50-100ms
- 视频提取：FFmpeg（ffmpeg-static）批量解码，支持 MP4/MKV/TS/AVI/MOV

## FFmpeg 提取架构（v2.1.0）
- `electron-main.js` 的 `extract-frames` IPC：一次 FFmpeg 调用提取所有候选帧到临时目录
- 渲染进程通过 `ipcRenderer.invoke('extract-frames', ...)` 调用，返回帧文件路径数组
- 临时文件在 `finally` 块中自动清理，**禁止跳过清理逻辑**

## 提取算法：分段优选（v2.1.0）
- 视频等分 N 段（N=目标张数），每段过采样 4 帧
- 每段取 Laplacian 评分最高（最清晰）的帧作为输出
- **不再使用** dHash 去重、多样化补充等旧逻辑
- 设几张就出几张，天然均匀覆盖、天然不重复

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
