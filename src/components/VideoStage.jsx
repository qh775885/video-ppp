import React, { useRef, useEffect, useState } from 'react';
import { Video } from 'lucide-react';

export function VideoStage({
    videoFile,
    onFileLoaded,
    setVideoRef,
    onTimeUpdate,
    onDurationChange,
    onEnded,
    onCapture,
    portraitRatio,
    cropOffset = 0, // -1 to 1
    onCropMove
}) {
    const videoRef = useRef(null);
    const fileInputRef = useRef(null);
    const [dragActive, setDragActive] = useState(false);
    const [objectUrl, setObjectUrl] = useState(null);
    const [maskDims, setMaskDims] = useState({ w: 0, h: 0, maxOffset: 0 }); // w/h of mask, maxOffset in px

    // 暴露 ref 给父组件
    useEffect(() => {
        if (setVideoRef && videoRef.current) {
            setVideoRef(videoRef.current);
        }
    }, [setVideoRef, objectUrl]);

    // 处理文件变化
    useEffect(() => {
        if (videoFile) {
            let url;
            if (videoFile.loadedPath && videoFile.loadedPath !== videoFile.path) {
                // Was converted to mp4! Load it directly from local filesystem temp path
                const safePath = videoFile.loadedPath.replace(/\\/g, '/');
                url = `file:///${safePath}`;
            } else {
                url = URL.createObjectURL(videoFile);
            }
            setObjectUrl(url);
            return () => {
                if (url && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            };
        }
    }, [videoFile]);

    // 计算视频的实际显示区域
    const updateMaskDimensions = () => {
        const video = videoRef.current;
        if (!video) return;
        const container = video.parentElement;
        if (!container) return;

        const vRatio = video.videoWidth / video.videoHeight;
        const cRatio = container.clientWidth / container.clientHeight;

        let dWidth, dHeight; // Displayed Video Dimensions

        if (cRatio > vRatio) {
            dHeight = container.clientHeight;
            dWidth = dHeight * vRatio;
        } else {
            dWidth = container.clientWidth;
            dHeight = dWidth / vRatio;
        }

        const maskHeight = dHeight;

        let targetAspect = 9 / 16;
        if (portraitRatio) {
            const ratioParts = portraitRatio.split(':');
            targetAspect = parseInt(ratioParts[0]) / parseInt(ratioParts[1]);
        }

        const maskWidth = dHeight * targetAspect;

        // 单侧最大可移动距离 (像素)
        const maxOffset = Math.max(0, (dWidth - maskWidth) / 2);

        setMaskDims({
            w: maskWidth,
            h: maskHeight,
            maxOffset: maxOffset
        });
    };

    const containerRef = useRef(null);

    // 监听 resize (Container Size Changes)
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver(() => {
            updateMaskDimensions();
        });

        // Attach observer to container
        observer.observe(containerRef.current);

        // Immediate force update on mount or ratio change
        updateMaskDimensions();

        return () => observer.disconnect();
    }, [videoFile, portraitRatio]); // Re-attach if critical dependencies change

    // --- Mask Drag Logic ---
    const isMaskDragging = useRef(false);
    const startX = useRef(0);
    const startOffsetRatio = useRef(0);

    const handleMaskMouseDown = (e) => {
        if (!onCropMove || maskDims.maxOffset <= 0) return;
        e.preventDefault();
        e.stopPropagation(); // Stop bubbling to stage drag/click

        isMaskDragging.current = true;
        startX.current = e.clientX;
        startOffsetRatio.current = cropOffset;

        window.addEventListener('mousemove', handleMaskMouseMove);
        window.addEventListener('mouseup', handleMaskMouseUp);
    };

    const handleMaskMouseMove = (e) => {
        if (!isMaskDragging.current) return;

        const deltaX = e.clientX - startX.current;
        // Calculate delta ratio
        // deltaRatio = deltaX / maxOffset
        const deltaRatio = deltaX / maskDims.maxOffset;

        const newRatio = Math.max(-1, Math.min(1, startOffsetRatio.current + deltaRatio));
        onCropMove(newRatio);
    };

    const handleMaskMouseUp = () => {
        isMaskDragging.current = false;
        window.removeEventListener('mousemove', handleMaskMouseMove);
        window.removeEventListener('mouseup', handleMaskMouseUp);
    };

    // Clean up
    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleMaskMouseMove);
            window.removeEventListener('mouseup', handleMaskMouseUp);
        };
    }, []);

    // 拖拽事件处理
    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            const name = file.name.toLowerCase();
            const validExts = ['.mp4', '.mkv', '.avi', '.mov', '.ts', '.flv', '.webm', '.wmv'];
            if (file.type.startsWith('video/') || validExts.some(ext => name.endsWith(ext))) {
                onFileLoaded(file);
            }
        }
    };

    const handleRightClick = (e) => {
        if (!videoFile) return;
        e.preventDefault();
        e.stopPropagation();
        if (onCapture) onCapture();
    };

    const handleUploadClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            onFileLoaded(e.target.files[0]);
        }
    };

    // Calculate visual transform based on current offset
    const currentTranslateX = cropOffset * maskDims.maxOffset;

    return (
        <div
            ref={containerRef}
            className={`relative flex-1 flex items-center justify-center bg-black group w-full h-full overflow-hidden ${dragActive ? 'bg-zinc-900/50' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onContextMenu={handleRightClick}
        >
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="video/*"
            />

            {videoFile && objectUrl ? (
                <>
                    <video
                        ref={videoRef}
                        className="max-h-full max-w-full object-contain pointer-events-none"
                        src={objectUrl}
                        playsInline
                        controls={false}
                        onTimeUpdate={onTimeUpdate}
                        onLoadedMetadata={(e) => {
                            onDurationChange(e);
                            updateMaskDimensions(); // Video ready -> calc mask
                        }}
                        onEnded={onEnded}
                    />

                    {/* Portrait Overlay */}
                    {portraitRatio && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                            <div
                                style={{
                                    width: `${maskDims.w}px`,
                                    height: `${maskDims.h}px`,
                                    transform: `translateX(${currentTranslateX}px)`,
                                    cursor: maskDims.maxOffset > 0 ? 'grab' : 'default'
                                }}
                                className="relative shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] border-2 border-indigo-500/80 rounded-sm pointer-events-auto active:cursor-grabbing transition-transform duration-75 ease-out"
                                onMouseDown={handleMaskMouseDown}
                            >
                                {/* Grid lines */}
                                <div className="absolute inset-0 opacity-20 pointer-events-none">
                                    <div className="absolute top-1/3 left-0 w-full h-px bg-white"></div>
                                    <div className="absolute top-2/3 left-0 w-full h-px bg-white"></div>
                                    <div className="absolute left-1/3 top-0 h-full w-px bg-white"></div>
                                    <div className="absolute left-2/3 top-0 h-full w-px bg-white"></div>
                                </div>
                                {/* Label */}
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-indigo-400 text-[10px] font-bold bg-black/80 px-2 py-0.5 rounded tracking-wider border border-white/10 select-none">
                                    {portraitRatio} 竖图模式
                                </div>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div
                    className="flex flex-col items-center justify-center text-zinc-500 gap-4 select-none cursor-pointer hover:text-zinc-300 transition-colors"
                    onClick={handleUploadClick}
                >
                    <div className={`p-4 rounded-2xl border transition-all duration-300 ${dragActive ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-zinc-900 border-zinc-800'}`}>
                        <Video size={48} />
                    </div>
                    <p className={dragActive ? 'text-indigo-400' : ''}>
                        {dragActive ? '松开鼠标加载视频' : '点击或拖入视频文件'}
                    </p>
                </div>
            )}

            {dragActive && <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm pointer-events-none" />}
        </div>
    );
}

