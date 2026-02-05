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
        if (!mult || isNaN(mult)) return; // Don't update if invalid
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

                setFrames(prev => [...prev, newFrame]);
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
        // Distribute frames evenly from Start to End (Inclusive)
        const interval = (targetCount > 1) ? activeDuration / (targetCount - 1) : 0;

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
                onSeek(val); // Sync video frame
            } else {
                const min = rangeStart + 0.5;
                const val = Math.max(min, Math.min(t, duration));
                onUpdateEnd(val);
                onSeek(val); // Sync video frame
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
                        {/* Progress Fill (White) - Now underneath Range */}
                        <div
                            className="absolute top-0 bottom-0 left-0 bg-white/30"
                            style={{ width: `${progressPct}%` }}
                        ></div>

                        {/* Buffered/Range Zone (Blue) - On Top & Opaque for Consistent Color */}
                        <div
                            className={`absolute top-0 bottom-0 bg-indigo-500 transition-opacity duration-300 ${isRangeMode ? 'opacity-100' : 'opacity-0'}`}
                            style={{ left: `${rStartPct}%`, width: `${rWidthPct}%` }}
                        ></div>
                    </div>

                    {/* Playhead (The "Hanging Pendant") - Refined & Textured */}
                    <div
                        className="absolute top-0 h-full z-40 cursor-grab active:cursor-grabbing transition-none will-change-left"
                        style={{ left: `${progressPct}%`, transform: 'translateX(-50%)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleSeekMouseDown(e); }}
                    >
                        {/* 1. Vertical Indicator Line (Glows on drag) */}
                        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[2px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.6)] transition-all duration-200 ${isDraggingSeek ? 'h-6 shadow-[0_0_12px_rgba(255,255,255,0.9)] bg-indigo-100' : 'h-5'
                            }`}></div>

                        {/* 2. The Textured Knob (Hanging Below) */}
                        <div className={`absolute top-2.5 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center transition-transform duration-200 ${isDraggingSeek ? 'scale-110' : 'group-hover:scale-105'
                            }`}>
                            {/* Main Body */}
                            <div className="w-3.5 h-4 bg-gradient-to-b from-zinc-100 to-zinc-400 rounded-b-md rounded-t-sm shadow-[0_4px_8px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.8)] border-[0.5px] border-white/60 flex flex-col items-center justify-center gap-[2px]">
                                {/* Texture Grips */}
                                <div className="w-2 h-[1px] bg-black/30 shadow-[0_1px_0_rgba(255,255,255,0.2)]"></div>
                                <div className="w-2 h-[1px] bg-black/30 shadow-[0_1px_0_rgba(255,255,255,0.2)]"></div>
                            </div>

                            {/* Tiny Triangle Pointer on Top (Optical connection) */}
                            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[3px] border-b-zinc-100 absolute -top-[2px]"></div>
                        </div>
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

                {/* Right: Extraction Panel - Compact 1:2:1 */}
                <div className="flex items-center h-[48px] px-1 rounded-xl bg-[#0a0a0b]/80 border border-white/10 shadow-2xl backdrop-blur-xl ring-1 ring-white/5 mx-0">

                    {/* 1. Left: Count (Ratio: ~1) */}
                    <div className="flex flex-col items-center justify-center w-[44px]">
                        <span className="text-[9px] text-zinc-500 font-medium select-none tracking-tight leading-none mb-0.5">张数</span>
                        <input
                            type="number"
                            value={targetCount}
                            onChange={(e) => onTargetCountChange(e.target.value === '' ? '' : parseInt(e.target.value))}
                            onBlur={() => { if (!targetCount) onTargetCountChange(1); }}
                            className="w-full bg-transparent text-center font-mono text-base font-bold text-zinc-200 focus:text-white focus:outline-none border-none p-0 leading-none"
                        />
                    </div>

                    {/* Divider */}
                    <div className="w-px h-5 bg-white/5"></div>

                    {/* 2. Center: Extract Button (Ratio: ~2) */}
                    <div className="flex items-center justify-center px-1.5 w-[100px]">
                        <button
                            onClick={onExtract}
                            disabled={isExtracting}
                            className={`group relative w-full h-8 rounded-lg font-bold transition-all duration-300 flex items-center justify-center gap-1 overflow-hidden ring-1 ring-inset ${isExtracting
                                ? 'bg-zinc-800 text-zinc-500 ring-white/5 cursor-not-allowed'
                                : 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-[0_2px_10px_rgba(79,70,229,0.3),inset_0_1px_1px_rgba(255,255,255,0.3)] ring-white/10 hover:shadow-[0_4px_15px_rgba(79,70,229,0.4),inset_0_1px_1px_rgba(255,255,255,0.4)] hover:scale-[1.02] active:scale-[0.98]'
                                }`}
                        >
                            {/* Inner Shine Effect */}
                            {!isExtracting && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>}

                            {isExtracting ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <>
                                    <Zap size={13} className="fill-current drop-shadow-sm" />
                                    <span className="text-xs tracking-wide drop-shadow-sm">提取</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-5 bg-white/5"></div>

                    {/* 3. Right: Meta Info (Ratio: ~1) */}
                    <div className="flex flex-col items-center justify-center w-[44px] gap-0.5">

                        {/* Duration */}
                        <div className="text-[10px] font-mono font-bold text-indigo-300 leading-none">
                            {Math.floor(extractDuration)}s
                        </div>

                        {/* Divider Line */}
                        <div className="w-5 h-px bg-white/10 my-0.5"></div>

                        {/* Multiplier */}
                        <div className="relative group/mult flex flex-col items-center w-full">
                            <div className="text-[9px] font-bold text-zinc-400 group-hover/mult:text-zinc-200 transition-colors cursor-pointer flex items-center justify-center gap-0.5 w-full">
                                <span className="opacity-50">×</span>
                                <span>{multiplier}</span>
                            </div>

                            {/* Dropdown Menu (Upwards) */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 invisible group-hover/mult:opacity-100 group-hover/mult:visible transition-all duration-200 z-50">
                                <div className="bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-xl p-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] grid grid-cols-3 gap-1 w-[90px]">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                                        <button
                                            key={num}
                                            onClick={(e) => { e.stopPropagation(); onMultiplierChange(num); }}
                                            className={`h-6 w-full rounded-md flex items-center justify-center text-[10px] font-bold font-mono transition-all ${multiplier === num
                                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                                : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
                                                }`}
                                        >
                                            {num}
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        className="col-span-3 h-5 bg-black/20 rounded-md text-center text-[9px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 mt-1 placeholder-zinc-600 border border-white/5 focus:border-indigo-500/30 transition-all"
                                        placeholder="自定义"
                                        value={multiplier}
                                        onChange={(e) => onMultiplierChange(parseFloat(e.target.value) || 1)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App;
