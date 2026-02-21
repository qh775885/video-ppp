import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, FolderOpen, Image as ImageIcon, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';

export function Sidebar({ frames, onClear, onDownload, cacheDir, onSelectCacheDir }) {
    const [previewIndex, setPreviewIndex] = useState(-1); // -1 means closed

    // --- Lightbox Logic ---
    const handleNext = useCallback(() => {
        setPreviewIndex(prev => (prev + 1) % frames.length);
    }, [frames.length]);

    const handlePrev = useCallback(() => {
        setPreviewIndex(prev => (prev - 1 + frames.length) % frames.length);
    }, [frames.length]);

    // Keyboard & Wheel Events for Lightbox
    useEffect(() => {
        if (previewIndex === -1) return;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();
            if (e.key === 'Escape') setPreviewIndex(-1);
        };

        const handleWheel = (e) => {
            if (e.deltaY > 0) handleNext();
            if (e.deltaY < 0) handlePrev();
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('wheel', handleWheel);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('wheel', handleWheel);
        };
    }, [previewIndex, handleNext, handlePrev]);

    const currentFrame = previewIndex >= 0 ? frames[previewIndex] : null;

    return (
        <div className="flex flex-col h-full bg-zinc-950/90 backdrop-blur-xl border-l border-white/10 w-[320px]">
            {/* Settings Segment */}
            <div className="p-5 flex flex-col gap-4 border-b border-white/5 shrink-0">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">存储设置</h3>
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-white/5 group hover:border-indigo-500/30 transition-colors">
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] text-zinc-500 font-bold mb-0.5">保存位置</span>
                        <span className="text-xs text-zinc-300 truncate" title={cacheDir || "未设置"}>
                            {cacheDir || "未设置 (仅内存预览)"}
                        </span>
                    </div>
                    <button
                        onClick={onSelectCacheDir}
                        className={`p-2 rounded-lg transition-all ${cacheDir ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
                        title="更改保存目录"
                    >
                        <FolderOpen size={14} />
                    </button>
                </div>
            </div>

            {/* Gallery Segment */}
            <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">图库</h3>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                            {frames.length}
                        </span>
                        {frames.length > 0 && (
                            <button
                                onClick={() => {
                                    if (window.confirm('确定清空所有截图吗？')) {
                                        onClear();
                                    }
                                    // Native confirm dialogs in Electron steal window focus.
                                    // Force focus back to the DOM so inputs remain interactive.
                                    setTimeout(() => document.body.focus(), 50);
                                }}
                                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                            >
                                <Trash2 size={12} />
                                清空
                            </button>
                        )}
                    </div>
                </div>

                {/* Scrollable Grid (2 Columns) */}
                <div className="flex-1 overflow-y-auto pr-2 -mr-2 no-scrollbar pb-20">
                    {frames.length === 0 ? (
                        <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-xl text-zinc-600 gap-2 mt-4">
                            <ImageIcon size={24} className="opacity-50" />
                            <span className="text-xs">暂无截图</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 items-start">
                            {frames.map((frame, index) => (
                                <div
                                    key={frame.id}
                                    className="group relative bg-zinc-900/50 rounded-lg border border-white/5 overflow-hidden hover:border-indigo-500/50 transition-all flex items-center justify-center cursor-zoom-in"
                                    style={{ aspectRatio: frame.isPortrait ? '9/16' : '16/9' }}
                                    onClick={() => setPreviewIndex(index)}
                                >
                                    {/* Thumbnail: Contain to show full image within the square/video aspect */}
                                    <img
                                        src={frame.url}
                                        className="w-full h-full object-contain bg-black/40"
                                        alt={`Frame ${index}`}
                                    />

                                    {/* Overlay Info */}
                                    <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[8px] font-mono font-bold text-white border border-white/10 opacity-60 group-hover:opacity-100 transition-opacity">
                                        {new Date(frame.time * 1000).toISOString().substr(14, 5)}
                                    </div>
                                    {frame.isPortrait && (
                                        <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-indigo-500/80 text-[8px] font-bold text-white">9:16</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-5 border-t border-white/5 bg-zinc-950/50 shrink-0">
                <button
                    onClick={onDownload}
                    disabled={frames.length === 0}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all active:scale-95 ${frames.length > 0
                        ? 'bg-zinc-800 hover:bg-zinc-700 border-white/10 text-white hover:border-white/20'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                >
                    <FolderOpen size={16} />
                    <span>打开保存文件夹</span>
                </button>
            </div>

            {/* Lightbox Modal (Full Screen with Nav) - Usage of Portal to break out of Sidebar container */}
            {previewIndex !== -1 && currentFrame && createPortal(
                <div
                    autoFocus
                    tabIndex={0}
                    className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-200 select-none outline-none"
                    onClick={() => {
                        setPreviewIndex(-1);
                        // Force window body to regain active focus after portal unmount in Electron
                        setTimeout(() => document.body.focus(), 10);
                    }}
                >
                    {/* Main Image */}
                    <div className="relative w-full h-full flex items-center justify-center p-8" onClick={e => e.stopPropagation()}>
                        <img
                            src={currentFrame.url}
                            className="max-w-full max-h-full object-contain shadow-2xl drop-shadow-[0_0_50px_rgba(0,0,0,0.5)]"
                            alt="Preview"
                        />

                        {/* Info Badge */}
                        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-900/80 backdrop-blur rounded-full border border-white/10 flex items-center gap-3 shadow-xl">
                            <span className="text-xs font-mono text-indigo-300 font-bold">#{previewIndex + 1} / {frames.length}</span>
                            <div className="w-px h-3 bg-white/20"></div>
                            <span className="text-xs font-mono text-zinc-300">{new Date(currentFrame.time * 1000).toISOString().substr(11, 8)}</span>
                        </div>

                        {/* Navigation Buttons */}
                        <button
                            className="absolute left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/20 text-white/50 hover:text-white transition-all hover:scale-110 active:scale-95 group"
                            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                        >
                            <ChevronLeft size={32} className="group-hover:-translate-x-1 transition-transform" />
                        </button>

                        <button
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/20 text-white/50 hover:text-white transition-all hover:scale-110 active:scale-95 group"
                            onClick={(e) => { e.stopPropagation(); handleNext(); }}
                        >
                            <ChevronRight size={32} className="group-hover:translate-x-1 transition-transform" />
                        </button>

                        {/* Close Button */}
                        <button
                            className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-red-500 text-white hover:rotate-90 transition-all duration-300 shadow-lg"
                            onClick={() => setPreviewIndex(-1)}
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
