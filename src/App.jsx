import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, FastForward, Image as ImageIcon, Zap, Scissors, Settings, FolderOpen, Loader2, ScanLine, Hash, X } from 'lucide-react';
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
    const [portraitRatio, setPortraitRatio] = useState(null);
    const [cropOffset, setCropOffset] = useState(0);

    // Extraction Range & Density
    const [rangeStart, setRangeStart] = useState(0);
    const [rangeEnd, setRangeEnd] = useState(0); // If 0/null, use duration
    const [multiplier, setMultiplier] = useState(1); // Density: frames per second
    const [targetCount, setTargetCount] = useState(12);
    const [isExtracting, setIsExtracting] = useState(false);

    // Sync end range when duration loads
    useEffect(() => {
        if (duration > 0 && rangeEnd === 0) {
            setRangeEnd(duration);
            // Auto calc count based on initial multiplier 1
            setTargetCount(Math.max(1, Math.round(duration * 1)));
        }
    }, [duration]);

    // Handlers for Range
    const handleSetStart = () => {
        const t = videoRefVal ? videoRefVal.currentTime : 0;
        setRangeStart(Math.min(t, rangeEnd));
        updateCountFromMultiplier(multiplier, Math.min(t, rangeEnd), rangeEnd);
    };
    const handleSetEnd = () => {
        const t = videoRefVal ? videoRefVal.currentTime : duration;
        setRangeEnd(Math.max(t, rangeStart));
        updateCountFromMultiplier(multiplier, rangeStart, Math.max(t, rangeStart));
    };
    const handleResetRange = () => {
        setRangeStart(0);
        setRangeEnd(duration);
        updateCountFromMultiplier(multiplier, 0, duration);
    };

    // Handler for Multiplier Change -> Auto set Count
    const handleMultiplierChange = (val) => {
        setMultiplier(val);
        updateCountFromMultiplier(val, rangeStart, rangeEnd);
    };

    const updateCountFromMultiplier = (mult, start, end) => {
        const dur = end - start;
        if (dur > 0) {
            setTargetCount(Math.max(1, Math.round(dur * mult)));
        }
    };

    // Handler for Count Change -> Update Multiplier display? (Optional, maybe just let them diverge)
    const handleTargetCountChange = (val) => {
        setTargetCount(val);
        // Reverse calc multiplier for display? nah, keep it simple.
    };

    const handleClear = () => setFrames([]);
    // --- Persistence ---
    useEffect(() => {
        const saved = localStorage.getItem('video-ppp-cache-dir');
        if (saved) setCacheDir(saved);
    }, []);

    const handleSelectCache = async () => {
        try {
            const { ipcRenderer } = window.require('electron');
            const path = await ipcRenderer.invoke('select-folder');
            if (path) {
                setCacheDir(path);
                localStorage.setItem('video-ppp-cache-dir', path);
            }
        } catch (e) {
            console.error("Select folder failed:", e);
        }
    };

    const handleDownload = async () => {
        if (!cacheDir) return;
        try {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-folder', cacheDir);
        } catch (e) {
            console.error("Open folder failed:", e);
        }
    };


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

    const [isVerticalContent, setIsVerticalContent] = useState(false); // Detect if loaded video is vertical

    const onDurationChange = (e) => {
        setDuration(e.target.duration);
        setIsVerticalContent(e.target.videoHeight > e.target.videoWidth);
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

        // Smart Crop Logic
        if (portraitRatio === "9:16") {
            const targetAspect = 9 / 16;
            const targetWidth = vHeight * targetAspect;
            if (targetWidth <= vWidth) {
                sWidth = targetWidth;
                const maxOffset = (vWidth - sWidth) / 2;
                const currentOffsetPx = cropOffset * maxOffset;
                sx = (vWidth - sWidth) / 2 + currentOffsetPx;
            } else {
                sHeight = vWidth / targetAspect;
                sy = (vHeight - sHeight) / 2;
            }
        }

        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(videoRefVal, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

            canvas.toBlob(async (blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const time = videoRefVal.currentTime;

                // Construct Frame Object
                const newFrame = {
                    id: Date.now() + Math.random(),
                    url: url,
                    time: time,
                    blob: blob,
                    isPortrait: !!portraitRatio,
                    filePath: null
                };

                // Auto-Save if directory is set
                if (cacheDir && videoFile) {
                    try {
                        const fs = window.require('fs');
                        const path = window.require('path');

                        // Helper to sanitize folder name (remove illegal chars and trailing dots/spaces)
                        const sanitize = (name) => {
                            // Remove extension first
                            const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                            return nameNoExt
                                .replace(/[<>:"/\\|?*]/g, '') // Remove illegal chars
                                .replace(/[\s.]+$/g, '')      // Remove trailing spaces/dots (Win issue)
                                .trim();
                        };

                        const subDirName = sanitize(videoFile.name);
                        const targetDir = path.join(cacheDir, subDirName);

                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }

                        const buffer = Buffer.from(await blob.arrayBuffer());
                        // Filename: frame_MMSS_ms.jpg
                        const m = Math.floor(time / 60).toString().padStart(2, '0');
                        const s = Math.floor(time % 60).toString().padStart(2, '0');
                        const ms = Math.floor((time % 1) * 1000).toString().padStart(3, '0');
                        const filename = `frame_${m}${s}_${ms}.jpg`;
                        const fullPath = path.join(targetDir, filename);

                        fs.writeFileSync(fullPath, buffer);
                        newFrame.filePath = fullPath;
                    } catch (err) {
                        console.error("Auto-save failed:", err);
                    }
                }

                setFrames(prev => [newFrame, ...prev]);
                resolve();
            }, 'image/jpeg', 0.95);
        });
    };

    // --- Batch Extraction (Smart Distributed with Range) ---
    const handleSmartExtract = async () => {
        if (!videoRefVal || isExtracting) return;
        setIsExtracting(true);

        // Use Range instead of full duration
        const effectiveStart = rangeStart;
        const effectiveEnd = (rangeEnd > 0) ? rangeEnd : duration;
        const activeDuration = effectiveEnd - effectiveStart;

        if (activeDuration <= 0.5) {
            setIsExtracting(false);
            return;
        }

        // Interval
        const interval = activeDuration / targetCount;

        for (let i = 0; i < targetCount; i++) {
            const timeToCapture = effectiveStart + (i * interval);
            if (timeToCapture > effectiveEnd) break;

            videoRefVal.currentTime = timeToCapture;
            setCurrentTime(timeToCapture);
            await new Promise(r => setTimeout(r, 450));
            await captureFrame();
        }

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
                // Add shortcuts for In/Out points? Maybe I and O?
                case 'KeyI': handleSetStart(); break;
                case 'KeyO': handleSetEnd(); break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [videoRefVal, isPlaying, currentTime, duration, seekStep, captureFrame, rangeStart, rangeEnd]);

    return (
        <div className="flex h-screen w-screen bg-black overflow-hidden font-sans text-sm select-none">

            {/* Zone A: The Stage */}
            <div className={`relative flex-1 flex flex-col items-center justify-center bg-black group w-full h-full transition-[padding] duration-300 ${isVerticalContent ? 'pb-40' : ''}`}>
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

                            // Range Props
                            rangeStart={rangeStart}
                            rangeEnd={rangeEnd}
                            onUpdateStart={(val) => {
                                setRangeStart(val);
                                updateCountFromMultiplier(multiplier, val, rangeEnd);
                            }}
                            onUpdateEnd={(val) => {
                                setRangeEnd(val);
                                updateCountFromMultiplier(multiplier, rangeStart, val);
                            }}
                            onResetRange={handleResetRange}

                            portraitRatio={portraitRatio}
                            onTogglePortrait={togglePortrait}

                            // Extract Props
                            targetCount={targetCount}
                            onTargetCountChange={handleTargetCountChange}
                            multiplier={multiplier}
                            onMultiplierChange={handleMultiplierChange}
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
    rangeStart, rangeEnd, onUpdateStart, onUpdateEnd, onResetRange,
    portraitRatio, onTogglePortrait,
    targetCount, onTargetCountChange,
    multiplier, onMultiplierChange,
    isExtracting, onExtract
}) {
    // Local State for Range Mode Toggle
    // We lift this up if App needs to know, but for UI visibility, local is fine.
    // However, extraction logic needs to know if we are using range or full.
    // Local State
    const [isRangeMode, setIsRangeMode] = useState(false);

    // Refs & Drag State
    const progressBarRef = useRef(null);
    const [isDraggingSeek, setIsDraggingSeek] = useState(false);
    const [draggingHandle, setDraggingHandle] = useState(null);

    // Helper: Calculate Time from MouseX
    const calculateTime = (e) => {
        if (!progressBarRef.current || !duration) return 0;
        const rect = progressBarRef.current.getBoundingClientRect();
        // Use logic to clamp within [0, rect.width]
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        return (x / rect.width) * duration;
    };

    // --- Interaction Handlers ---

    // 1. Seek / Scrubber
    const handleSeekMouseDown = (e) => {
        // Prevent conflict if clicking handles
        if (e.target.closest('.range-handle')) return;

        setIsDraggingSeek(true);
        const t = calculateTime(e);
        onSeek(t); // Jump immediately

        const move = (ev) => onSeek(calculateTime(ev));
        const up = () => {
            setIsDraggingSeek(false);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // 2. Range Handles
    const handleHandleMouseDown = (e, type) => {
        e.stopPropagation();
        setDraggingHandle(type);

        const move = (ev) => {
            const t = calculateTime(ev);
            if (type === 'start') {
                const max = (rangeEnd > 0 ? rangeEnd : duration) - 0.5;
                const val = Math.max(0, Math.min(t, max));
                onUpdateStart(val);
            } else {
                const min = rangeStart + 0.5;
                const val = Math.max(min, Math.min(t, duration));
                onUpdateEnd(val);
            }
        };

        const up = () => {
            setDraggingHandle(null);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // 3. Toggle Logic
    const toggleRangeMode = () => {
        const newMode = !isRangeMode;
        setIsRangeMode(newMode);
        if (!newMode) onResetRange(); // Reset when closing
    };

    // --- Render Helpers ---
    const progressPct = duration ? (currentTime / duration) * 100 : 0;
    const effectiveEnd = (rangeEnd > 0) ? rangeEnd : duration;

    // Viz Percentages
    const rStartPct = duration ? (rangeStart / duration) * 100 : 0;
    const rEndPct = duration ? (effectiveEnd / duration) * 100 : 100;
    const rWidthPct = rEndPct - rStartPct;

    const extractDuration = isRangeMode ? (effectiveEnd - rangeStart) : duration;

    // Common Button Styles
    const btnBase = "h-9 flex items-center justify-center rounded-xl transition-all border outline-none select-none";
    const btnGlass = `${btnBase} bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95`;
    const btnActive = `${btnBase} bg-indigo-500/20 border-indigo-500/50 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]`;


    return (
        <div className="flex flex-col gap-4 min-w-[760px] p-5 rounded-[24px] bg-[#121214]/90 backdrop-blur-2xl border border-white/10 shadow-2xl ring-1 ring-black/40 hover:-translate-y-1 transition-all duration-300">

            {/* 1. Progress Section */}
            <div className={`flex items-center gap-4 w-full px-1 relative ${isRangeMode ? 'pt-3' : ''} transition-all duration-300`}>
                <span className="font-mono text-xs text-zinc-500 min-w-[44px] text-right font-medium">{formatTime(currentTime)}</span>

                {/* Track Container */}
                <div
                    ref={progressBarRef}
                    className="flex-1 h-2 relative group cursor-pointer touch-none"
                    style={{ marginTop: isRangeMode ? '4px' : '0', marginBottom: isRangeMode ? '4px' : '0' }}
                    onMouseDown={handleSeekMouseDown}
                >
                    {/* Track Background */}
                    <div className="absolute top-0 bottom-0 left-0 right-0 bg-white/10 rounded-full overflow-hidden">
                        {/* Buffered/Range Zone (Blue) */}
                        <div
                            className={`absolute top-0 bottom-0 bg-indigo-500/30 transition-opacity duration-300 ${isRangeMode ? 'opacity-100' : 'opacity-0'}`}
                            style={{ left: `${rStartPct}%`, width: `${rWidthPct}%` }}
                        ></div>
                        {/* Progress Fill (White) */}
                        <div
                            className="absolute top-0 bottom-0 left-0 bg-white/30"
                            style={{ width: `${progressPct}%` }}
                        ></div>
                    </div>

                    {/* Playhead (The "White Dot") - High Quality */}
                    <div
                        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.5)] z-20 pointer-events-none transition-transform duration-150 ease-out group-hover:scale-125 ${isDraggingSeek ? 'scale-125 shadow-[0_0_20px_rgba(255,255,255,0.8)]' : ''}`}
                        style={{ left: `${progressPct}%` }}
                    >
                        {/* Inner Dot for detail */}
                        <div className="absolute inset-[3px] bg-indigo-50 inset rounded-full opacity-0 group-hover:opacity-20 transition-opacity"></div>
                    </div>

                    {/* Range Handles (Only in Range Mode) */}
                    {isRangeMode && (
                        <>
                            {/* Start Handle */}
                            <div
                                className={`range-handle absolute -top-3 w-4 -ml-2 h-8 cursor-ew-resize z-30 flex flex-col items-center justify-start group/handle`}
                                style={{ left: `${rStartPct}%` }}
                                onMouseDown={(e) => handleHandleMouseDown(e, 'start')}
                            >
                                <div className={`w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-indigo-400 drop-shadow-lg transition-all group-hover/handle:border-t-white ${draggingHandle === 'start' ? 'border-t-white scale-125' : ''}`}></div>
                                <div className={`w-px h-3 bg-indigo-400/50 group-hover/handle:bg-white/50 ${draggingHandle === 'start' ? 'bg-white' : ''}`}></div>
                                {/* Tooltip */}
                                <div className="absolute -top-7 px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10 text-[10px] font-mono text-zinc-300 opacity-0 group-hover/handle:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    {formatTime(rangeStart)}
                                </div>
                            </div>

                            {/* End Handle */}
                            <div
                                className={`range-handle absolute -top-3 w-4 -ml-2 h-8 cursor-ew-resize z-30 flex flex-col items-center justify-start group/handle`}
                                style={{ left: `${rEndPct}%` }}
                                onMouseDown={(e) => handleHandleMouseDown(e, 'end')}
                            >
                                <div className={`w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-indigo-400 drop-shadow-lg transition-all group-hover/handle:border-t-white ${draggingHandle === 'end' ? 'border-t-white scale-125' : ''}`}></div>
                                <div className={`w-px h-3 bg-indigo-400/50 group-hover/handle:bg-white/50 ${draggingHandle === 'end' ? 'bg-white' : ''}`}></div>
                                {/* Tooltip */}
                                <div className="absolute -top-7 px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10 text-[10px] font-mono text-zinc-300 opacity-0 group-hover/handle:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    {formatTime(effectiveEnd)}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <span className="font-mono text-xs text-zinc-500 min-w-[44px] font-medium">{formatTime(duration)}</span>
            </div>

            {/* 2. Control Bar (Grid Layout for logical grouping) */}
            <div className="grid grid-cols-[auto_1fr_auto] gap-4 items-center">

                {/* Left: Transport Controls */}
                <div className="flex items-center gap-2">
                    <button onClick={onTogglePlay} className={`${btnGlass} w-10`} title={isPlaying ? "暂停 Space" : "播放 Space"}>
                        {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                    </button>

                    {/* Seek Step */}
                    <div className="h-9 px-3 flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 text-xs text-zinc-400 group focus-within:border-white/20 transition-colors">
                        <FastForward size={14} />
                        <span className="text-[10px] font-bold">快进</span>
                        <input
                            type="number"
                            className="w-6 bg-transparent text-center font-mono font-bold focus:outline-none text-zinc-200"
                            value={seekStep}
                            onChange={(e) => onSeekStepChange(Number(e.target.value))}
                        />
                        <span className="text-[10px]">s</span>
                    </div>
                </div>

                {/* Center: Modes (Centered in the 1fr space) */}
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={toggleRangeMode}
                        className={`h-9 px-4 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border ${isRangeMode ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                    >
                        <ScanLine size={16} />
                        <span>区间</span>
                    </button>

                    <div className="w-px h-4 bg-white/10"></div>

                    <button
                        onClick={onTogglePortrait}
                        className={`h-9 px-4 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border ${portraitRatio ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                    >
                        <Scissors size={16} />
                        <span>竖图</span>
                    </button>
                </div>

                {/* Right: Extraction Panel */}
                <div className="flex items-center gap-2 bg-black/30 p-1 pl-3 rounded-xl border border-white/5">

                    {/* Inputs */}
                    <div className="flex items-center gap-4 border-r border-white/10 pr-3 mr-1">
                        <div className="flex items-center gap-1.5" title="目标数量">
                            <Hash size={13} className="text-zinc-500" />
                            <input
                                type="number"
                                value={targetCount}
                                onChange={(e) => onTargetCountChange(parseInt(e.target.value) || 1)}
                                className="w-7 bg-transparent text-center font-mono text-sm font-bold text-white focus:outline-none placeholder-zinc-700"
                            />
                        </div>
                        <div className="flex items-center gap-1.5" title="密度倍数">
                            <X size={13} className="text-zinc-500" />
                            <input
                                type="number"
                                step="0.1"
                                value={multiplier}
                                onChange={(e) => onMultiplierChange(parseFloat(e.target.value) || 1)}
                                className="w-8 bg-transparent text-center font-mono text-sm font-bold text-indigo-400 focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* Action Button */}
                    <button
                        onClick={onExtract}
                        disabled={isExtracting}
                        className={`h-8 pl-3 pr-4 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${isExtracting
                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:scale-95'
                            }`}
                    >
                        {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} className="fill-current" />}
                        <div className="flex flex-col items-start leading-tight">
                            <span>提取</span>
                            <span className="text-[8px] font-mono opacity-60 normal-case tracking-wide">
                                {extractDuration.toFixed(1)}s
                            </span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    )
}

export default App;
