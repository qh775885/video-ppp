import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, FastForward, Image as ImageIcon, Zap, Scissors, Settings, FolderOpen, Loader2 } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { VideoStage } from './components/VideoStage';

// Helper for time formatting
const formatTime = (seconds) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} `;
};

// Shell Layout
function App() {
    // --- Core Video State ---
    const [videoFile, setVideoFile] = useState(null);
    const [videoRefVal, setVideoRefVal] = useState(null); // Ref from child
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // --- Tool State ---
    const [frames, setFrames] = useState([]);
    const [seekStep, setSeekStep] = useState(5);
    const [cacheDir, setCacheDir] = useState("");
    const [portraitRatio, setPortraitRatio] = useState(null); // null = off, "9:16" = on
    const [cropOffset, setCropOffset] = useState(0); // Horizontal offset ratio (-0.5 to 0.5 relative to diff)
    const [targetCount, setTargetCount] = useState(12); // Default count
    const [isExtracting, setIsExtracting] = useState(false);

    const handleClear = () => setFrames([]);
    const handleDownload = () => console.log("Open folder");
    const handleSelectCache = () => console.log("Select cache");

    // Toggle Portrait Mode (Reset offset when toggling)
    const togglePortrait = () => {
        setPortraitRatio(prev => prev ? null : "9:16");
        setCropOffset(0);
    };

    // --- Handlers ---
    const togglePlay = () => {
        if (!videoRefVal) return;
        if (isPlaying) {
            videoRefVal.pause();
        } else {
            videoRefVal.play();
        }
        setIsPlaying(!isPlaying);
    };

    const onTimeUpdate = (e) => {
        setCurrentTime(e.target.currentTime);
    };

    const onDurationChange = (e) => {
        setDuration(e.target.duration);
    };

    const onEnded = () => {
        setIsPlaying(false);
    };

    const handleSeek = (time) => {
        if (videoRefVal) {
            videoRefVal.currentTime = time;
            setCurrentTime(time);
        }
    };

    // --- Capture Logic (Smart Crop with Offset) ---
    // Ensure captureFrame returns a Promise
    const captureFrame = async () => {
        if (!videoRefVal || !videoRefVal.videoWidth) return;

        const vWidth = videoRefVal.videoWidth;
        const vHeight = videoRefVal.videoHeight;
        let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

        // 如果开启了竖图模式，计算裁剪区域 (默认居中裁剪)
        if (portraitRatio === "9:16") {
            // 目标比例 9/16 = 0.5625
            const targetAspect = 9 / 16;
            // 假设以高度为基准 (通常是将横屏视频切成竖屏，所以高度占满)
            const targetWidth = vHeight * targetAspect;

            if (targetWidth <= vWidth) {
                sWidth = targetWidth;
                // 默认居中是 (vWidth - sWidth) / 2
                // 偏移量：cropOffset * (vWidth - sWidth)
                // cropOffset 范围建议 -0.5 到 0.5 ?
                // 不，我们定义 cropOffset 为：从中心点偏移的像素百分比?
                // 让我们简化：cropOffset 是一个 0~1 的值？
                // 最佳方案：cropOffset 是 source image 上的像素偏移。
                // 但那样不好拖动。
                // 我们用 ratio: offset = 0 (Center), -1 (Left Aligned), 1 (Right Aligned)

                const maxOffset = (vWidth - sWidth) / 2;
                const currentOffsetPx = cropOffset * maxOffset; // cropOffset is -1 to 1

                sx = (vWidth - sWidth) / 2 + currentOffsetPx;
            } else {
                // 极端情况：视频比 9:16 还窄？(几乎不可能，除非本来就是竖屏且更细)
                sHeight = vWidth / targetAspect;
                sy = (vHeight - sHeight) / 2;
            }
        }

        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext('2d');

            // Draw video frame with crop
            // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
            ctx.drawImage(videoRefVal, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

            canvas.toBlob((blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const newFrame = {
                    id: Date.now() + Math.random(),
                    url: url,
                    time: videoRefVal.currentTime,
                    blob: blob,
                    isPortrait: !!portraitRatio // 标记是否为竖图
                };
                setFrames(prev => [newFrame, ...prev]);
                resolve();
            }, 'image/jpeg', 0.95);
        });
    };

    // --- Batch Extraction (Smart Distributed) ---
    const handleSmartExtract = async () => {
        if (!videoRefVal || isExtracting) return;
        setIsExtracting(true);

        const startT = videoRefVal.currentTime;
        const remainingDur = duration - startT;

        // 如果剩余时间太短，就不执行了
        if (remainingDur <= 0.5) {
            setIsExtracting(false);
            return;
        }

        // 计算智能步长 (均分模式)
        // 例如：剩余 10s，要 5 张 -> 步长 2s
        const interval = remainingDur / targetCount;

        // We will capture targetCount frames
        for (let i = 0; i < targetCount; i++) {
            // Calculate exact time for this frame
            // i=0 -> startT
            // i=1 -> startT + interval
            const timeToCapture = startT + (i * interval);

            // 1. Seek to target time
            videoRefVal.currentTime = timeToCapture;
            setCurrentTime(timeToCapture);

            // 2. Wait for frame update (crucial!)
            // using 450ms to be safe for seek latency
            await new Promise(r => setTimeout(r, 450));

            // 3. Capture
            await captureFrame();
        }

        // Finish
        setIsExtracting(false);
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'KeyS':             // <--- 新增截图快捷键
                    e.preventDefault();
                    captureFrame();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    handleSeek(Math.max(0, currentTime - seekStep));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    handleSeek(Math.min(duration, currentTime + seekStep));
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [videoRefVal, isPlaying, currentTime, duration, seekStep, captureFrame]);

    return (
        <div className="flex h-screen w-screen bg-black overflow-hidden font-sans text-sm select-none">

            {/* Zone A: The Stage */}
            <div className="relative flex-1 flex flex-col items-center justify-center bg-black group w-full h-full">
                <VideoStage
                    videoFile={videoFile}
                    onFileLoaded={setVideoFile}
                    setVideoRef={setVideoRefVal}
                    onTimeUpdate={onTimeUpdate}
                    onDurationChange={onDurationChange}
                    onEnded={onEnded}
                    onCapture={captureFrame} // <--- 传递截图函数
                    portraitRatio={portraitRatio} // <--- 传递竖图状态给 Stage 显示遮罩
                    cropOffset={cropOffset}    // <--- Pass State
                    onCropMove={setCropOffset} // <--- Pass Setter
                />

                {/* Zone B: The Cockpit */}
                {videoFile && (
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 transform">
                        <FloatingCockpit
                            seekStep={seekStep}
                            onSeekStepChange={setSeekStep}
                            isPlaying={isPlaying}
                            onTogglePlay={togglePlay}
                            currentTime={currentTime}
                            duration={duration}
                            onSeek={handleSeek}

                            portraitRatio={portraitRatio} // <--- 传递给 Controlbar
                            onTogglePortrait={togglePortrait} // <--- 传递切换函数

                            targetCount={targetCount} // Pass props
                            onTargetCountChange={setTargetCount}
                            isExtracting={isExtracting}
                            onExtract={handleSmartExtract}
                        />
                    </div>
                )}
            </div>

            {/* Zone C: The Archives */}
            <Sidebar
                frames={frames}
                onClear={handleClear}
                onDownload={handleDownload}
                cacheDir={cacheDir}
                onSelectCacheDir={handleSelectCache}
            />

        </div>
    );
}

// Sub-components
function FloatingCockpit({
    seekStep, onSeekStepChange,
    isPlaying, onTogglePlay,
    currentTime, duration, onSeek,
    portraitRatio, onTogglePortrait,
    targetCount, onTargetCountChange,
    isExtracting, onExtract
}) {
    // Seek Bar Logic
    const progressBarRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const wasPlayingRef = useRef(false);

    const calculateTime = (e) => {
        if (!progressBarRef.current || !duration) return 0;
        const rect = progressBarRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const pct = x / rect.width;
        return pct * duration;
    };

    const handleMouseDown = (e) => {
        setIsDragging(true);
        wasPlayingRef.current = isPlaying;
        if (isPlaying && onTogglePlay) onTogglePlay();
        onSeek(calculateTime(e));
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        onSeek(calculateTime(e));
    };

    const handleMouseUp = (e) => {
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const progressPct = duration ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex flex-col gap-3 min-w-[640px] p-4 rounded-3xl bg-zinc-900/80 backdrop-blur-2xl border border-white/10 shadow-2xl ring-1 ring-black/20 hover:bg-zinc-900/90 hover:-translate-y-1 transition-all duration-300">
            {/* Upper: Progress */}
            <div className="flex items-center gap-3 w-full px-2 select-none">
                <span className="font-mono text-xs text-zinc-400 min-w-[40px] text-right">{formatTime(currentTime)}</span>
                <div
                    ref={progressBarRef}
                    className="flex-1 h-8 bg-white/5 rounded-lg border border-white/5 relative group cursor-pointer overflow-hidden"
                    onMouseDown={handleMouseDown}
                >
                    <div
                        className={`absolute top-0 bottom-0 left-0 bg-indigo-500/50 rounded-l-lg ${isDragging ? '' : 'transition-all duration-100 ease-linear'}`}
                        style={{ width: `${progressPct}%` }}
                    ></div>
                    <div
                        className={`absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] ${isDragging ? '' : 'transition-all duration-100 ease-linear'}`}
                        style={{ left: `${progressPct}%` }}
                    ></div>
                </div>
                <span className="font-mono text-xs text-zinc-400 min-w-[40px]">{formatTime(duration)}</span>
            </div>

            {/* Lower: Controls */}
            <div className="flex items-center justify-center gap-6 pt-1 relative">

                {/* Left: Playback Controls */}
                <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center gap-0.5 group">
                        <span className="text-[10px] text-zinc-500 font-bold tracking-wider group-hover:text-zinc-400 transition-colors">快进</span>
                        <div className="flex items-center gap-1 bg-black/20 rounded px-1.5 py-0.5 border border-white/5 hover:border-white/10">
                            <input
                                type="number"
                                className="w-8 bg-transparent text-center font-mono text-xs font-bold focus:outline-none text-zinc-300 no-scrollbar"
                                value={seekStep}
                                onChange={(e) => onSeekStepChange(Number(e.target.value))}
                                min={1}
                                max={60}
                            />
                            <span className="text-[10px] text-zinc-500">秒</span>
                        </div>
                    </div>

                    <button
                        onClick={onTogglePlay}
                        className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 hover:bg-indigo-600 hover:text-white text-zinc-200 transition-all shadow-lg shadow-black/20 active:scale-95"
                    >
                        {isPlaying ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current ml-1" />}
                    </button>
                </div>

                <div className="w-px h-8 bg-white/10 mx-2"></div>

                {/* Center: Portrait Mode */}
                <button
                    onClick={onTogglePortrait}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium transition-colors active:scale-95 ${portraitRatio
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-white/5 hover:bg-white/10 border-white/5 text-zinc-300 hover:text-white'
                        }`}
                >
                    <Scissors size={16} />
                    <span>{portraitRatio || "竖图"}</span>
                    <span className="text-zinc-500 ml-1">▼</span>
                </button>

                <div className="w-px h-8 bg-white/10 mx-2"></div>

                {/* Right: Smart Extract */}
                <div className="flex items-center gap-3 bg-zinc-800/50 p-1 pr-1.5 rounded-xl border border-white/5">
                    <div className="flex flex-col px-3 border-r border-white/10">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">目标张数</span>
                        {/* Input for Target Count */}
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={targetCount}
                            onChange={(e) => onTargetCountChange && onTargetCountChange(parseInt(e.target.value) || 1)}
                            className="bg-transparent text-white font-mono text-xs font-bold w-10 focus:outline-none focus:text-indigo-400 appearance-none text-center no-scrollbar"
                        />
                    </div>

                    <button
                        onClick={onExtract}
                        disabled={isExtracting}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-95 ${isExtracting
                            ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                    >
                        {isExtracting ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Zap size={16} className="fill-current" />
                        )}
                        <span>{isExtracting ? "提取中..." : "提取"}</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

export default App;
