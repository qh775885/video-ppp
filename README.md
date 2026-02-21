# 视频截图神器
一款基于 React + Electron 的现代化视频截图与自动提取工具。

```
网盘下载地址
迅雷：https://pan.xunlei.com/s/VOiGf_rK0uVZCW5AfyBHI4_OA1?pwd=bcad
百度：https://pan.baidu.com/s/1X3PaoPJGoRZThQnqUood5g?pwd=kp49 (提取码: kp49)
```
<img width="1150" height="866" alt="QQ20260221-191718" src="https://github.com/user-attachments/assets/7f42c901-5630-4999-9598-299a2af6af62" />

## v2.0.6 新版特性 
- **无限制格式支持**：不仅支持 MP4，还能秒开 TS 和 MKV，告别格式转换带来的烦恼。
- **多比例竖屏与 AI 智能追踪**：支持 9:16、3:4、4:5 多比例竖图自由切换。开启 AI 追踪模式后，裁剪框将自动寻找主角并平滑跟随人脸/身体，免去手工调整（纯本地计算，安全免费无痕）。
- **极简极速操作**：HTML 层级拦截，实现零秒闪电启动无缝拖放，彻底拒绝界面冷加载白屏和“禁止拖入”红圈报错。
- **按键布局自适应**：全面翻新“智能追踪”、“区间提取”等操作项布局组件，窄屏不乱码不换行，视觉体验更佳。
- **逐帧精准快进**：自动匹配视频原始帧率，方向键可实现真正的“一帧一帧”精确移动，长按倍加丝滑。

## 核心功能
1. **智能提取**：支持基于算法的重复度去除，可按倍数或目标张数，自动均分截取高质量图片片段。
2. **极速预览**：基于 Electron + Chromium 内核，超大视频秒开无缓冲。
3. **快捷交互**：
    - `Space`：播放 / 暂停
    - `S` 键 或是 `视频上点击右键`：提取当前画面
    - `⬅️ / ➡️`：丝滑逐帧倒退 / 快进
    - `Esc`：关闭画廊
4. **画廊系统**：侧边栏无裁切完整展示多比例（9:16 / 16:9 等）缩略图，双击进入全屏图库画廊。

## 🛠️ 构建命令

为了方便版本管理，所有构建产物会自动输出到 `release/vX.X.X/` 目录下。

```bash
# 1. 安装依赖
npm install

# 2. 启动开发模式
npm run dev

# 3. 生产环境构建 (Build)
# 同时生成免安装版 (win-unpacked) 和安装包 (Setup.exe)
# 输出目录：release/vX.X.X/
npm run build
```

## 📦 技术栈
- **Core**: Electron 34
- **UI**: React 19 + Tailwind CSS v4
- **Build**: Electron Builder (NSIS)
