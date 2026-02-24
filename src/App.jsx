import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, FastForward, Image as ImageIcon, Zap, Scissors, Settings, FolderOpen, Loader2, ScanLine, Hash, X, BrainCircuit } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { VideoStage } from './components/VideoStage';

// Helper for time formatting
const formatTime = (seconds) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} `;
};

// ====== v2.0.9 智能推荐张数：平方根缩放 ======
const getRecommendedCount = (durationSec) => {
    if (!durationSec || durationSec <= 0) return 10;
    return Math.min(48, Math.max(6, Math.round(Math.sqrt(durationSec) * 3)));
};

// ====== 清晰度评分：Laplacian 方差（值越高越清晰） ======
const computeSharpness = (canvas) => {
    // 160px 宽度快速计算，清晰度过滤已证明有效，速度优先
    const scale = Math.min(1, 160 / canvas.width);
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    tmpCtx.drawImage(canvas, 0, 0, w, h);
    const imgData = tmpCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }
    let sum = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const lap = -4 * gray[y * w + x]
                + gray[(y - 1) * w + x]
                + gray[(y + 1) * w + x]
                + gray[y * w + (x - 1)]
                + gray[y * w + (x + 1)];
            sum += lap * lap;
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
};

// ====== 感知哈希 dHash：捕捉图像结构，不受位置平移影响 ======
const computeDHash = (canvas) => {
    const w = 17, h = 16; // 17宽取16个水平梯度差
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const hash = new Uint8Array(256); // 16×16 = 256 bits
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w - 1; x++) {
            const i1 = (y * w + x) * 4;
            const i2 = (y * w + x + 1) * 4;
            const g1 = data[i1] * 0.299 + data[i1 + 1] * 0.587 + data[i1 + 2] * 0.114;
            const g2 = data[i2] * 0.299 + data[i2 + 1] * 0.587 + data[i2 + 2] * 0.114;
            hash[y * 16 + x] = g1 > g2 ? 1 : 0;
        }
    }
    return hash;
};

// ====== Hamming 距离：两个哈希有多少位不同（越大越不同） ======
const hashDistance = (a, b) => {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) dist++;
    }
    return dist;
};

// ====== 从文件路径加载图片到 HTMLImageElement ======
const loadImageFromPath = (filePath) => {
    return new Promise((resolve, reject) => {
        const fs = window.require('fs');
        try {
            const buffer = fs.readFileSync(filePath);
            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load image: ${filePath}`));
            };
            img.src = url;
        } catch (err) {
            reject(new Error(`Failed to read image file: ${filePath} - ${err.message}`));
        }
    });
};

// Shell Layout
const TRACKABLE_CLASSES = [
    'person', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe',
    'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat'
];

function App() {
    // --- Core Video State ---
    const [videoFile, setVideoFile] = useState(null);
    const [videoRefVal, setVideoRefVal] = useState(null); // Ref from child
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Global drag prevention is now fully handled in index.html to guarantee 0-ms startup

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
    const [extractElapsed, setExtractElapsed] = useState(0); // 提取用时（秒）
    const [extractStatus, setExtractStatus] = useState(''); // 提取阶段文字
    const extractTimerRef = useRef(null);

    // --- New AI / Advanced State ---
    const [isVideoLoading, setIsVideoLoading] = useState(false);
    const [fps, setFps] = useState(30);
    const [autoTrack, setAutoTrack] = useState(false);
    const [aiModel, setAiModel] = useState(null);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const isDetectingRef = useRef(false);
    const lastTrackedOffsetRef = useRef(0);
    const manualLockTargetRef = useRef(null); // Used for "Mode B: Manual Overridden Lock"

    // Load AI Model ON-DEMAND, completely eliminating any startup CPU spike or drag freezes
    const loadAiModel = () => {
        if (!aiModel && !isAiLoading) {
            setIsAiLoading(true);
            import('@tensorflow/tfjs').then(() => {
                import('@tensorflow-models/coco-ssd').then(cocoSsd => {
                    cocoSsd.load({ base: 'lite_mobilenet_v2' }).then(model => {
                        setAiModel(model);
                        setIsAiLoading(false);
                    });
                });
            });
        }
    };

    // Toggle logic now intercepts and loads model
    const handleToggleAutoTrack = () => {
        if (!autoTrack && !aiModel) {
            loadAiModel();
        }
        if (autoTrack) {
            // Un-toggling tracking completely resets any manual lock!
            manualLockTargetRef.current = null;
        }
        setAutoTrack(!autoTrack);
    };

    // Sync end range when duration loads — 使用智能推荐张数
    useEffect(() => {
        if (duration > 0 && rangeEnd === 0) {
            setRangeEnd(duration);
            const recommended = getRecommendedCount(duration);
            setTargetCount(recommended);
            setMultiplier(parseFloat((recommended / duration).toFixed(1)) || 1);
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

    const handleClear = (deleteLocal = false) => {
        if (deleteLocal && cacheDir && videoFile) {
            try {
                const fs = window.require('fs');
                const path = window.require('path');
                const sanitize = (name) => {
                    const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                    return nameNoExt.replace(/[<>:"/\\|?*]/g, '').replace(/[\s.]+$/g, '').trim();
                };
                const targetDir = path.join(cacheDir, sanitize(videoFile.name));
                if (fs.existsSync(targetDir)) {
                    fs.rmSync(targetDir, { recursive: true, force: true });
                }
            } catch (err) {
                console.error('Delete local folder failed:', err);
            }
        }
        setFrames([]);
    };
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


    // Direct Setter for Portrait Mode
    const setPortraitMode = (mode) => {
        if (portraitRatio === mode) {
            setPortraitRatio(null); // click active again turns it off
        } else {
            setPortraitRatio(mode);
        }
        setCropOffset(0);
        manualLockTargetRef.current = null; // Clear lock across ratio swaps
    };

    // Manual Object Priority Lock Hook
    const handleManualCropMove = (offset) => {
        setCropOffset(offset);
        if (autoTrack) {
            manualLockTargetRef.current = offset; // Force override to 'Target Lock Mode'
        }
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

    // ====== 通用 AI 检测核心逻辑（复用于 onTimeUpdate 和批量提取） ======
    const runAiDetection = async (video, model, ratio, lockRef, lastOffRef) => {
        const threshold = lockRef.current !== null ? 0.05 : 0.45;
        const predictions = await model.detect(video, 30, threshold);

        let bestTarget = null;
        const vWidth = video.videoWidth || video.naturalWidth || video.width || 1920;
        const vHeight = video.videoHeight || video.naturalHeight || video.height || 1080;
        const ratioParts = ratio.split(':');
        const targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
        const targetWidth = vHeight * targetAspect;
        const maxOffset = (vWidth - targetWidth) / 2;

        const validClassesPrefix = ['person', 'dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'car', 'truck', 'bus', 'train', 'motorcycle', 'airplane', 'bicycle', 'boat', 'chair', 'couch', 'bed'];

        if (lockRef.current !== null) {
            const targets = predictions.filter(p => validClassesPrefix.includes(p.class) || p.score > 0.05);
            if (targets.length > 0) {
                const expectedCenterPx = lockRef.current * maxOffset + vWidth / 2;
                bestTarget = targets.sort((a, b) => {
                    const distA = Math.abs((a.bbox[0] + a.bbox[2] / 2) - expectedCenterPx);
                    const distB = Math.abs((b.bbox[0] + b.bbox[2] / 2) - expectedCenterPx);
                    return distA - distB;
                })[0];
                if (bestTarget) {
                    const cxBest = bestTarget.bbox[0] + bestTarget.bbox[2] / 2;
                    if (Math.abs(cxBest - expectedCenterPx) > 300) {
                        bestTarget = null;
                    }
                }
            }
        } else {
            const persons = predictions.filter(p => p.class === 'person');
            if (persons.length > 0) {
                bestTarget = persons.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]))[0];
            }
        }

        if (bestTarget) {
            const cx = bestTarget.bbox[0] + bestTarget.bbox[2] / 2;
            let normOffset = 0;
            if (maxOffset > 0) normOffset = (cx - vWidth / 2) / maxOffset;
            let rawOffset = Math.max(-1, Math.min(1, normOffset));

            // ====== 自适应惯性：位移越大 → 新值权重越高，跟踪越快 ======
            const prevOffset = lockRef.current !== null ? lockRef.current : (lastOffRef.current ?? 0);
            const delta = Math.abs(rawOffset - prevOffset);
            // delta=0 → inertia=0.8（丝滑），delta=1 → inertia=0.2（快速跟上）
            const inertia = Math.max(0.15, 0.8 - delta * 0.65);
            let safeOffset = prevOffset * inertia + rawOffset * (1 - inertia);
            safeOffset = Math.max(-1, Math.min(1, safeOffset));

            if (lockRef.current !== null) {
                lockRef.current = safeOffset;
            }
            lastOffRef.current = safeOffset;
            return safeOffset;
        }
        return null; // 未检测到目标
    };

    // ====== 等待视频帧解码就绪的工具函数 ======
    const waitForSeeked = (video, timeoutMs = 800) => {
        return new Promise(resolve => {
            // 如果 video.readyState >= 2 且 currentTime 已经在目标时间附近，直接 resolve
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };
            video.addEventListener('seeked', done, { once: true });
            setTimeout(done, timeoutMs); // 超时兜底
        });
    };

    const onTimeUpdate = async (e) => {
        const time = e.target.currentTime;
        setCurrentTime(time);

        // AI Person Tracking or Manual Object Tracking
        if (autoTrack && aiModel && portraitRatio && videoRefVal && !isDetectingRef.current) {
            isDetectingRef.current = true;
            try {
                const result = await runAiDetection(videoRefVal, aiModel, portraitRatio, manualLockTargetRef, lastTrackedOffsetRef);
                if (result !== null) {
                    setCropOffset(result);
                }
            } catch (err) {
                console.error("AI tracking err:", err);
            }
            // 冷却时间：播放中 120ms（减少无效检测），seek中 40ms（保持响应）
            const cooldown = isPlaying ? 120 : 40;
            setTimeout(() => { isDetectingRef.current = false; }, cooldown);
        }
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

    // ====== 链式 Seek：等帧解码完毕后再触发 AI 检测 + 跳下一帧 ======
    useEffect(() => {
        if (!videoRefVal) return;
        const onSeeked = async () => {
            // 在 seek 完成后运行 AI 检测（帧此时已解码就绪）
            if (autoTrack && aiModel && portraitRatio && !isDetectingRef.current) {
                isDetectingRef.current = true;
                try {
                    const result = await runAiDetection(videoRefVal, aiModel, portraitRatio, manualLockTargetRef, lastTrackedOffsetRef);
                    if (result !== null) {
                        setCropOffset(result);
                    }
                } catch (err) {
                    console.error("AI seek-detect err:", err);
                }
                isDetectingRef.current = false;
            }
        };
        videoRefVal.addEventListener('seeked', onSeeked);
        return () => videoRefVal.removeEventListener('seeked', onSeeked);
    }, [videoRefVal, autoTrack, aiModel, portraitRatio]);


    const handleFileLoaded = async (file) => {
        setIsVideoLoading(true);
        const { ipcRenderer, webUtils } = window.require('electron');
        try {
            // Electron 30+ 隐藏了 file.path，需要用 webUtils 提权获取真实路径
            let loadedPath = file.path;

            // Try fallback reading from file object exactly
            if (!loadedPath && file.webkitRelativePath && file.webkitRelativePath.includes(':')) {
                loadedPath = file.webkitRelativePath;
            }

            if (!loadedPath && webUtils) {
                try {
                    loadedPath = webUtils.getPathForFile(file);
                } catch (err) {
                    console.error("webUtils error:", err);
                }
            }

            if (!loadedPath) {
                alert(`未能提取真实路径！
请检查：
1. 请勿直接从网页、压缩包或者非原生文件管理工具内直接拖出。
2. Windows 下请从「资源管理器(例如 D盘)」内直接拖动文件。
调试信息: File[${file.name}], type[${file.type}], Utils[${!!webUtils}]`);
                setIsVideoLoading(false);
                return;
            }

            // 1. Run through FFmpeg Media Engine to normalize format, fix IDM errors, and ensure compatibility
            loadedPath = await ipcRenderer.invoke('process-media', loadedPath);

            // 2. Extract accurate FPS via ffprobe
            const info = await ipcRenderer.invoke('get-video-info', loadedPath);
            setFps(info.fps > 0 ? info.fps : 30);

            // 3. Keep original name, but substitute the path
            file.loadedPath = loadedPath;
            setVideoFile(file);
        } catch (e) {
            console.error("Video parse err:", e);
            alert("底层解析失败：" + e.message);
            setVideoFile(file); // Fallback to raw file if err
        } finally {
            setIsVideoLoading(false);
        }
    };


    // --- Capture Logic (Smart Crop with Offset) ---
    const captureFrame = async (overrideOffset = null) => {
        if (!videoRefVal || !videoRefVal.videoWidth) return;

        const vWidth = videoRefVal.videoWidth;
        const vHeight = videoRefVal.videoHeight;
        let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

        const actualCropOffset = overrideOffset !== null ? overrideOffset : cropOffset;

        // Smart Crop Logic
        if (portraitRatio) {
            const ratioParts = portraitRatio.split(':');
            const targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
            const targetWidth = vHeight * targetAspect;
            if (targetWidth <= vWidth) {
                sWidth = targetWidth;
                const maxOffset = (vWidth - sWidth) / 2;
                const currentOffsetPx = actualCropOffset * maxOffset;
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
                    ratio: portraitRatio || "16:9",
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

    // ====== v2.0.9 直接复用 Canvas 保存帧（跳过 re-seek） ======
    const saveCanvasAsFrame = async (canvas, time) => {
        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const newFrame = {
                    id: Date.now() + Math.random(),
                    url, time, blob,
                    isPortrait: !!portraitRatio,
                    ratio: portraitRatio || "16:9",
                    filePath: null
                };
                if (cacheDir && videoFile) {
                    try {
                        const fs = window.require('fs');
                        const path = window.require('path');
                        const sanitize = (name) => {
                            const nameNoExt = name.substring(0, name.lastIndexOf('.')) || name;
                            return nameNoExt.replace(/[<>:"/\\|?*]/g, '').replace(/[\s.]+$/g, '').trim();
                        };
                        const targetDir = path.join(cacheDir, sanitize(videoFile.name));
                        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                        const buffer = Buffer.from(await blob.arrayBuffer());
                        const m = Math.floor(time / 60).toString().padStart(2, '0');
                        const s = Math.floor(time % 60).toString().padStart(2, '0');
                        const ms = Math.floor((time % 1) * 1000).toString().padStart(3, '0');
                        const fullPath = path.join(targetDir, `frame_${m}${s}_${ms}.jpg`);
                        fs.writeFileSync(fullPath, buffer);
                        newFrame.filePath = fullPath;
                    } catch (err) { console.error("Auto-save failed:", err); }
                }
                setFrames(prev => [...prev, newFrame]);
                resolve();
            }, 'image/jpeg', 0.95);
        });
    };

    // ====== v2.0.9 智能提取：极致速度版 ======
    const handleSmartExtract = async () => {
        if (!videoRefVal || isExtracting) return;
        setIsExtracting(true);
        setExtractElapsed(0);
        setExtractStatus('FFmpeg 解码中...');
        const extractStartTime = Date.now();
        extractTimerRef.current = setInterval(() => {
            setExtractElapsed(Math.round((Date.now() - extractStartTime) / 1000));
        }, 500);

        const effectiveStart = rangeStart;
        const effectiveEnd = (rangeEnd > 0) ? rangeEnd : duration;
        const activeDuration = effectiveEnd - effectiveStart;

        if (activeDuration <= 0.5) {
            if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
            setIsExtracting(false);
            return;
        }

        // ====== 分段优选算法 ======
        // 将视频等分为 N 段（N=目标张数），每段过采样 K 帧，取最清晰的 1 帧
        const OVERSAMPLE = 4; // 每段采样 4 帧候选
        const totalCandidates = Math.min(targetCount * OVERSAMPLE, 600); // 候选总数上限 600
        const candidatesPerSegment = Math.max(2, Math.floor(totalCandidates / targetCount));
        const actualCandidates = targetCount * candidatesPerSegment;
        let trackingOffset = lastTrackedOffsetRef.current !== undefined ? lastTrackedOffsetRef.current : cropOffset;

        const { ipcRenderer } = window.require('electron');
        const fsNode = window.require('fs');
        const pathNode = window.require('path');
        const osNode = window.require('os');
        const tempDir = pathNode.join(osNode.tmpdir(), `vme_extract_${Date.now()}`);

        try {
            const videoPath = videoFile.loadedPath || videoFile.path;
            if (!videoPath) throw new Error('No video file path available');

            const framePaths = await ipcRenderer.invoke('extract-frames', {
                filePath: videoPath,
                startTime: effectiveStart,
                duration: activeDuration,
                fps: actualCandidates / activeDuration,
                outputDir: tempDir
            });

            if (!framePaths || framePaths.length === 0) {
                throw new Error('FFmpeg extracted 0 frames');
            }

            // ====== 加载所有候选帧并评分 ======
            setExtractStatus('加载分析中...');
            const sampleInterval = activeDuration / framePaths.length;
            const candidates = [];
            for (let i = 0; i < framePaths.length; i++) {
                const timeToCapture = effectiveStart + i * sampleInterval;
                if (timeToCapture > effectiveEnd) break;
                setExtractStatus(`分析帧 ${i + 1}/${framePaths.length}`);

                const img = await loadImageFromPath(framePaths[i]);

                // AI 检测偏移（对图片做推理，确保裁切准确）
                let frameOffset = autoTrack ? trackingOffset : cropOffset;
                if (autoTrack && aiModel && portraitRatio) {
                    try {
                        const result = await runAiDetection(img, aiModel, portraitRatio, manualLockTargetRef, lastTrackedOffsetRef);
                        if (result !== null) {
                            trackingOffset = result;
                            frameOffset = result;
                        }
                    } catch (err) {
                        console.error('Smart extract AI detect failed:', err);
                    }
                }

                // 截取候选帧到 Canvas
                const vWidth = img.naturalWidth || img.width;
                const vHeight = img.naturalHeight || img.height;
                let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

                if (portraitRatio) {
                    const ratioParts = portraitRatio.split(':');
                    const targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
                    const targetWidth = vHeight * targetAspect;
                    if (targetWidth <= vWidth) {
                        sWidth = targetWidth;
                        const maxOff = (vWidth - sWidth) / 2;
                        sx = (vWidth - sWidth) / 2 + frameOffset * maxOff;
                    } else {
                        sHeight = vWidth / targetAspect;
                        sy = (vHeight - sHeight) / 2;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = sWidth;
                canvas.height = sHeight;
                canvas.getContext('2d').drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

                const sharpness = computeSharpness(canvas);
                candidates.push({ time: timeToCapture, canvas, sharpness, offset: frameOffset });
            }

            if (candidates.length === 0) {
                if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
                setExtractStatus('');
                setIsExtracting(false);
                return;
            }

            // ====== 分段优选：每段取最清晰帧 ======
            setExtractStatus('优选中...');
            const segmentDuration = activeDuration / targetCount;
            const finalFrames = [];

            for (let seg = 0; seg < targetCount; seg++) {
                const segStart = effectiveStart + seg * segmentDuration;
                const segEnd = segStart + segmentDuration;
                const segFrames = candidates.filter(c => c.time >= segStart && c.time < segEnd);
                if (segFrames.length > 0) {
                    segFrames.sort((a, b) => b.sharpness - a.sharpness);
                    finalFrames.push(segFrames[0]);
                }
            }

            // ====== 输出 ======
            setExtractStatus('保存中...');
            finalFrames.sort((a, b) => a.time - b.time);

            for (const frame of finalFrames) {
                await saveCanvasAsFrame(frame.canvas, frame.time);
            }

        } catch (err) {
            console.error('FFmpeg extraction failed:', err);
        } finally {
            // 清理临时目录
            try {
                if (fsNode.existsSync(tempDir)) {
                    fsNode.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupErr) {
                console.error('Temp directory cleanup failed:', cleanupErr);
            }
        }

        if (extractTimerRef.current) { clearInterval(extractTimerRef.current); extractTimerRef.current = null; }
        setExtractElapsed(Math.round((Date.now() - extractStartTime) / 1000));
        setExtractStatus('');
        setIsExtracting(false);
    };

    // 使用 stateRef 持久化最新状态，彻底避免 React 渲染销毁事件监听引起的“长按断触”问题
    const stateRef = useRef({ videoRefVal, duration, fps, seekStep, togglePlay, captureFrame, handleSetStart, handleSetEnd, handleSeek });
    useEffect(() => {
        stateRef.current = { videoRefVal, duration, fps, seekStep, togglePlay, captureFrame, handleSetStart, handleSetEnd, handleSeek };
    });

    useEffect(() => {
        // ====== 固定节拍 Seek：匀速 + 帧就绪门控 ======
        // 固定间隔定时器保证匀速，seekReady 标志位保证只有前一帧解码完才跳下一帧
        let seekActive = false;
        let seekDirection = 0;
        let seekIntervalId = null;
        let seekReady = true; // 门控：上一帧是否已解码完毕

        const processSeekTick = () => {
            if (!seekActive || !seekReady) return; // 帧未就绪则跳过本次 tick
            const { videoRefVal, duration, fps, seekStep, handleSeek } = stateRef.current;
            if (!videoRefVal) { seekActive = false; return; }

            let newTime = videoRefVal.currentTime + seekDirection * seekStep * (1 / fps);
            newTime = Math.max(0, Math.min(duration, newTime));

            // 到达边界就停止
            if ((seekDirection > 0 && newTime >= duration) || (seekDirection < 0 && newTime <= 0)) {
                handleSeek(newTime);
                stopSeek();
                return;
            }

            seekReady = false; // 锁定，等帧渲染完
            handleSeek(newTime);

            // 纯 seeked 事件门控：帧解码完毕自动放行，不强制超时解锁
            videoRefVal.addEventListener('seeked', () => { seekReady = true; }, { once: true });
        };

        const startSeek = (direction) => {
            if (seekActive) return;
            seekActive = true;
            seekDirection = direction;
            seekReady = true;
            processSeekTick(); // 立即第一跳
            // 固定 100ms 间隔 = 匀速 10 次/秒
            seekIntervalId = setInterval(processSeekTick, 100);
        };

        const stopSeek = () => {
            seekActive = false;
            seekDirection = 0;
            seekReady = true;
            if (seekIntervalId) {
                clearInterval(seekIntervalId);
                seekIntervalId = null;
            }
        };

        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            const { togglePlay, captureFrame, handleSetStart, handleSetEnd } = stateRef.current;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (e.repeat) return; // ignore hold space
                    togglePlay();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    if (e.repeat) return; // ignore hold S
                    captureFrame();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (!e.repeat) startSeek(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (!e.repeat) startSeek(1);
                    break;
                case 'KeyI': handleSetStart(); break;
                case 'KeyO': handleSetEnd(); break;
            }
        };

        const handleKeyUp = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                stopSeek();
            }
        };

        const handleMouseDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.button === 3 || e.button === 4) {
                e.preventDefault();
                startSeek(e.button === 4 ? 1 : -1);
            }
        };

        const handleMouseUpExtra = (e) => {
            if (e.button === 3 || e.button === 4) {
                e.preventDefault();
                stopSeek();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUpExtra);

        return () => {
            stopSeek();
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUpExtra);
        };
    }, []); // <-- 依赖数组为空！初始化执行一次，靠 stateRef 穿透状态

    return (
        <div className="flex h-screen w-screen bg-black overflow-hidden font-sans text-sm select-none">

            {isVideoLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 text-white">
                        <Loader2 className="animate-spin text-indigo-500" size={48} />
                        <div className="font-bold tracking-widest text-lg">FFmpeg 底层媒体引擎处理中...</div>
                        <div className="text-zinc-400 text-sm">正在修复视频封装与编码兼容性</div>
                    </div>
                </div>
            )}

            {isExtracting && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-5 text-white">
                        <div className="relative">
                            <Loader2 className="animate-spin text-indigo-500" size={56} />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs font-mono font-bold text-indigo-300">{extractElapsed}s</span>
                            </div>
                        </div>
                        <div className="font-bold tracking-widest text-lg">{extractStatus || '提取中...'}</div>
                        <div className="text-zinc-500 text-xs">提取完成前请勿操作</div>
                    </div>
                </div>
            )}

            {/* Zone A: The Stage */}
            <div className={`relative flex-1 flex flex-col items-center justify-center bg-black group w-full h-full transition-[padding] duration-300 ${isVerticalContent ? 'pb-40' : ''}`}>
                <VideoStage
                    videoFile={videoFile}
                    onFileLoaded={handleFileLoaded}
                    setVideoRef={setVideoRefVal}
                    onTimeUpdate={onTimeUpdate}
                    onDurationChange={onDurationChange}
                    onEnded={onEnded}
                    onCapture={captureFrame} // <--- 传递截图函数
                    portraitRatio={portraitRatio} // <--- 传递竖图状态给 Stage 显示遮罩
                    cropOffset={cropOffset}    // <--- Pass State
                    onCropMove={handleManualCropMove} // <--- 绑定到含有智能锁定接管逻辑的句柄上
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
                            onSetPortraitMode={setPortraitMode}

                            autoTrack={autoTrack}
                            onToggleAutoTrack={handleToggleAutoTrack}
                            aiModelReady={!!aiModel}
                            isAiLoading={isAiLoading}

                            // Extract Props
                            targetCount={targetCount}
                            onTargetCountChange={handleTargetCountChange}
                            multiplier={multiplier}
                            onMultiplierChange={handleMultiplierChange}
                            isExtracting={isExtracting}
                            extractElapsed={extractElapsed}
                            extractStatus={extractStatus}
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
    portraitRatio, onSetPortraitMode,
    autoTrack, onToggleAutoTrack, aiModelReady, isAiLoading,
    targetCount, onTargetCountChange,
    multiplier, onMultiplierChange,
    isExtracting, extractElapsed, extractStatus, onExtract
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

            {/* 2. Control Bar (Flex Layout to prevent crowding) */}
            <div className="flex items-center justify-between gap-4">

                {/* Left: Transport Controls */}
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={onTogglePlay} className={`${btnGlass} w-10 shrink-0`} title={isPlaying ? "暂停 Space" : "播放 Space"}>
                        {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                    </button>

                    {/* Seek Step */}
                    <div className="h-9 px-3 flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 text-xs text-zinc-400 group focus-within:border-white/20 transition-colors">
                        <FastForward size={14} />
                        <span className="text-[10px] font-bold">步进</span>
                        <input
                            type="number"
                            className="w-8 bg-transparent text-center font-mono font-bold focus:outline-none text-zinc-200"
                            value={seekStep}
                            onChange={(e) => onSeekStepChange(Number(e.target.value))}
                        />
                        <span className="text-[10px]">帧</span>
                    </div>
                </div>

                {/* Center: Modes */}
                <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar mask-edges shrink-0">
                    <button
                        onClick={toggleRangeMode}
                        className={`h-9 px-4 rounded-xl flex items-center gap-2 text-xs font-bold transition-all border whitespace-nowrap shrink-0 ${isRangeMode ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                    >
                        <ScanLine size={16} />
                        <span>区间</span>
                    </button>

                    <div className="w-px h-4 bg-white/10 mx-1"></div>

                    <div className="flex bg-black/40 rounded-xl border border-white/5 p-0.5 overflow-hidden">
                        {/* Quick Switch Toggles for Crop Ratios */}
                        <div className="flex items-center gap-0.5">
                            {['9:16', '3:4', '4:5'].map(ratio => (
                                <button
                                    key={ratio}
                                    onClick={() => onSetPortraitMode(ratio)}
                                    className={`h-8 px-2.5 rounded-lg flex items-center justify-center text-xs font-bold font-mono transition-all ${portraitRatio === ratio
                                        ? 'bg-purple-500/30 text-purple-300 shadow-md ring-1 ring-purple-500/50'
                                        : 'bg-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                                        }`}
                                >
                                    {portraitRatio === ratio && <Scissors size={12} className="mr-1" />}
                                    {ratio}
                                </button>
                            ))}
                        </div>

                        {/* Auto Track sub-button */}
                        {portraitRatio && (
                            <button
                                onClick={onToggleAutoTrack}
                                disabled={isAiLoading}
                                className={`h-8 px-3 ml-0.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap shrink-0 transition-all ${autoTrack ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]'
                                    : 'bg-white/5 text-indigo-300/80 hover:text-indigo-200 hover:bg-white/10'
                                    }`}
                            >
                                {isAiLoading ? (
                                    <>
                                        <Loader2 size={12} className="animate-spin opacity-80" />
                                        <span className="opacity-80 text-[11px] font-mono tracking-widest">框架加载中...</span>
                                    </>
                                ) : (
                                    <span className={!aiModelReady ? "opacity-70" : ""}>
                                        {autoTrack ? 'AI 锁定已开' : '开启 AI 锁定'}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Right: Extraction Panel */}
                <div className="flex items-center h-[48px] px-1 rounded-xl bg-[#0a0a0b]/80 border border-white/10 shadow-2xl backdrop-blur-xl ring-1 ring-white/5 mx-0">

                    {/* 1. Left: Max Count (Upper Limit) */}
                    <div className="flex flex-col items-center justify-center w-[44px]">
                        <span className="text-[9px] text-zinc-500 font-medium select-none tracking-tight leading-none mb-0.5">≤上限</span>
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

                    {/* 3. Right: Duration / Elapsed Timer */}
                    <div className="flex items-center justify-center w-[40px]">
                        <div className={`text-[10px] font-mono font-bold leading-none transition-colors ${isExtracting ? 'text-amber-400 animate-pulse' : extractElapsed > 0 ? 'text-emerald-400' : 'text-indigo-300'}`}>
                            {isExtracting ? `${extractElapsed}s` : extractElapsed > 0 ? `${extractElapsed}s` : `${Math.floor(extractDuration)}s`}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App;
