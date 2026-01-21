import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// --- Electron / Node.js Modules Detection ---
let ipcRenderer = null;
let fs = null;
let path = null;
let Buffer = null;

if (typeof window !== 'undefined' && window.require) {
  try {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
    fs = window.require('fs');
    path = window.require('path');
    Buffer = window.require('buffer').Buffer;
  } catch (e) {
    console.log('Not running in Electron', e);
  }
}

// --- DOM Elements ---
const el = (id) => document.getElementById(id);
const fileInput = el('fileInput');
const videoPlayer = el('videoPlayer');
const startBtn = el('startBtn');
const btnProgress = el('btnProgress');
const downloadBtn = el('downloadBtn');
const clearBtn = el('clearBtn');
const targetCountInput = el('targetCount');
const btnInc = el('btnInc');
const btnDec = el('btnDec');
const galleryGrid = el('galleryGrid');
const resultBadge = el('resultBadge');
const processingOverlay = el('processingOverlay');
const dropHint = el('dropHint');
const controlBar = el('controlBar');
const videoWrapper = el('videoWrapper');

const cacheFolderBtn = el('cacheFolderBtn');
const cacheFolderText = el('cacheFolderText');

const playPauseBtn = el('playPauseBtn');
const playIcon = el('playIcon');
const pauseIcon = el('pauseIcon');
const videoSeekBar = el('videoSeekBar');
const currentTimeDisplay = el('currentTimeDisplay');
const totalTimeDisplay = el('totalTimeDisplay');
const rangeStart = el('rangeStart');
const rangeEnd = el('rangeEnd');
const rangeHighlight = el('rangeHighlight');
const rangeSelector = el('rangeSelector');
const screenshotToast = el('screenshotToast');

const startTimeInput = el('startTimeInput');
const endTimeInput = el('endTimeInput');
const setStartBtn = el('setStartBtn');
const setEndBtn = el('setEndBtn');

// Multiplier Feature
const multiplierInput = el('multiplierInput');
const multiplierPreview = el('multiplierPreview');

const lightbox = el('lightbox');
const lightboxImg = el('lightboxImg');
const lbCount = el('lbCount');
const btnPrev = el('btnPrev');
const btnNext = el('btnNext');
const btnClose = el('btnClose');

// About Modal
const versionTag = el('versionTag');
const aboutModal = el('aboutModal');
const aboutClose = el('aboutClose');
const authorLink = el('authorLink');

const BILIBILI_URL = 'https://space.bilibili.com/248612618';

function openAboutModal() {
  aboutModal?.classList.add('active');
}

function closeAboutModal() {
  aboutModal?.classList.remove('active');
}

// Click version tag to open about modal
versionTag?.addEventListener('click', openAboutModal);

// Close about modal
aboutClose?.addEventListener('click', closeAboutModal);
aboutModal?.addEventListener('click', (e) => {
  if (e.target === aboutModal) closeAboutModal();
});

// Author link click
authorLink?.addEventListener('click', (e) => {
  e.preventDefault();
  if (window.require) {
    window.require('electron').shell.openExternal(BILIBILI_URL);
  } else {
    window.open(BILIBILI_URL, '_blank');
  }
});

// ESC to close about modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && aboutModal?.classList.contains('active')) {
    closeAboutModal();
  }
});

// --- State ---
let capturedFrames = [];
let isProcessing = false;
let fileLoaded = false;
let currentLightBoxIndex = -1;
let currentVideoFile = null;
let cacheFolderPath = localStorage.getItem('video-extractor-cache-path') || null;
let videoDuration = 0;
let manualScreenshotCount = 0;
let rangeStartPct = 0;
let rangeEndPct = 100;
let isDraggingRange = null;

// --- Init ---
const savedCount = localStorage.getItem('video-extractor-target-count');
if (savedCount) targetCountInput.value = savedCount;

if (cacheFolderPath && fs && cacheFolderBtn) {
  cacheFolderBtn.classList.add('active');
  const folderName = cacheFolderPath.split(/[/\\]/).pop();
  cacheFolderText.textContent = `📂 ${folderName}`;
  cacheFolderBtn.title = cacheFolderPath;
} else if (!fs && cacheFolderBtn) {
  cacheFolderText.textContent = '📂 仅桌面版';
  cacheFolderBtn.disabled = true;
}

if (cacheFolderBtn) {
  cacheFolderBtn.addEventListener('click', async () => {
    if (!ipcRenderer) return alert('请使用桌面版软件以启用此功能');
    const selectedPath = await ipcRenderer.invoke('select-folder');
    if (selectedPath) {
      cacheFolderPath = selectedPath;
      localStorage.setItem('video-extractor-cache-path', selectedPath);
      cacheFolderBtn.classList.add('active');
      const folderName = selectedPath.split(/[/\\]/).pop();
      cacheFolderText.textContent = `📂 ${folderName}`;
      cacheFolderBtn.title = selectedPath;
    }
  });
}

// Drag & Drop
document.ondragover = document.ondrop = (e) => e.preventDefault();
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]?.type.startsWith('video/')) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  fileInput.value = '';
});

startBtn.addEventListener('click', runSmartExtraction);
downloadBtn.onclick = downloadAll;
clearBtn.addEventListener('click', resetGallery);

function resetGallery() {
  capturedFrames.forEach(f => URL.revokeObjectURL(f.url));
  capturedFrames = [];
  manualScreenshotCount = 0;
  galleryGrid.innerHTML = '<div class="empty-hint">右键截图<br>或点击提取</div>';
  resultBadge.textContent = '0';
  downloadBtn.disabled = true;
  downloadBtn.classList.add('hidden');
  btnProgress.style.width = '0%';
}

// Stepper
btnInc.addEventListener('click', () => updateTarget(1));
btnDec.addEventListener('click', () => updateTarget(-1));
targetCountInput.addEventListener('input', () => updateTarget(0));

function updateTarget(delta) {
  let val = parseInt(targetCountInput.value) || 24;
  val = Math.max(1, Math.min(300, val + delta));
  targetCountInput.value = val;
  localStorage.setItem('video-extractor-target-count', val);
  // 当手动修改张数时，反算倍数
  updateMultiplierFromCount();
}

// ========== Multiplier Feature Logic ==========
const savedMultiplier = localStorage.getItem('video-extractor-multiplier');
if (savedMultiplier) multiplierInput.value = savedMultiplier;

// 获取当前区间秒数
function getRangeDurationSeconds() {
  if (!videoDuration) return 0;
  const rangeStart = parseTimeInput(startTimeInput.value);
  let rangeEnd = parseTimeInput(endTimeInput.value);
  if (rangeEnd <= rangeStart || rangeEnd > videoDuration) rangeEnd = videoDuration;
  return Math.max(0, rangeEnd - rangeStart);
}

// 根据倍数更新张数
function updateCountFromMultiplier() {
  const duration = getRangeDurationSeconds();
  const multiplier = parseFloat(multiplierInput.value) || 1;
  if (duration > 0) {
    const calculatedCount = Math.max(1, Math.min(300, Math.round(duration * multiplier)));
    targetCountInput.value = calculatedCount;
    localStorage.setItem('video-extractor-target-count', calculatedCount);
  }
  updateMultiplierPreview();
}

// 根据张数反算倍数
function updateMultiplierFromCount() {
  const duration = getRangeDurationSeconds();
  const count = parseInt(targetCountInput.value) || 12;
  if (duration > 0) {
    const calculatedMultiplier = Math.round((count / duration) * 10) / 10; // 保留1位小数
    multiplierInput.value = Math.max(0.1, Math.min(30, calculatedMultiplier));
    localStorage.setItem('video-extractor-multiplier', multiplierInput.value);
  }
  updateMultiplierPreview();
}

// 更新预览显示
function updateMultiplierPreview() {
  const duration = getRangeDurationSeconds();
  const count = parseInt(targetCountInput.value) || 12;
  
  if (duration <= 0) {
    multiplierPreview.textContent = '--';
    multiplierPreview.classList.remove('warning');
    return;
  }
  
  // 显示 "区间时长s → 张数张"
  const durationDisplay = duration >= 60 
    ? `${Math.floor(duration / 60)}m${Math.round(duration % 60)}s` 
    : `${Math.round(duration)}s`;
  
  multiplierPreview.textContent = `${durationDisplay}→${count}张`;
  
  // 如果张数过多，显示警告色
  if (count > 100) {
    multiplierPreview.classList.add('warning');
  } else {
    multiplierPreview.classList.remove('warning');
  }
}

// 监听倍数输入变化
multiplierInput.addEventListener('input', () => {
  let val = parseFloat(multiplierInput.value);
  if (isNaN(val) || val < 0.1) val = 0.1;
  if (val > 30) val = 30;
  localStorage.setItem('video-extractor-multiplier', val);
  updateCountFromMultiplier();
});

// 监听张数输入变化（手动修改时反算倍数）
targetCountInput.addEventListener('input', () => {
  updateMultiplierFromCount();
});

// Video Controls
playPauseBtn.addEventListener('click', togglePlay);
videoPlayer.addEventListener('click', togglePlay);

function togglePlay() {
  if (!fileLoaded) return;
  videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
}

videoPlayer.addEventListener('play', () => {
  playIcon.style.display = 'none';
  pauseIcon.style.display = 'block';
});

videoPlayer.addEventListener('pause', () => {
  playIcon.style.display = 'block';
  pauseIcon.style.display = 'none';
});

// --- Seek Bar State ---
let isSeeking = false;
let wasPlayingBeforeSeek = false;

// 更新进度条填充色
// 更新进度条填充色
function updateSeekBarFill(percent) {
  // User requested no filled progress bar, just the thumb.
  videoSeekBar.style.background = 'transparent';
}

// 根据进度条位置更新视频
function seekToPercent(percent) {
  if (!videoDuration) return;

  const p = Math.max(0, Math.min(100, percent));
  const seekTime = (p / 100) * videoDuration;

  // 更新进度条
  videoSeekBar.value = p;
  updateSeekBarFill(p);
  currentTimeDisplay.textContent = formatTimeMMSS(seekTime);

  // 直接设置 currentTime 让视频跳转
  videoPlayer.currentTime = seekTime;
}

// 获取进度条上的位置百分比
function getSeekBarPercent(clientX) {
  const rect = videoSeekBar.getBoundingClientRect();
  const x = clientX - rect.left;
  const percent = (x / rect.width) * 100;
  return Math.max(0, Math.min(100, percent));
}

videoPlayer.addEventListener('timeupdate', () => {
  // 拖动时不更新进度条，避免冲突
  if (!videoDuration || isSeeking) return;
  const percent = (videoPlayer.currentTime / videoDuration) * 100;
  videoSeekBar.value = percent;
  updateSeekBarFill(percent);
  currentTimeDisplay.textContent = formatTimeMMSS(videoPlayer.currentTime);
});

// ========== 鼠标拖动 ==========
function handleMouseDown(e) {
  if (!fileLoaded) return;

  isSeeking = true;
  wasPlayingBeforeSeek = !videoPlayer.paused;

  // 暂停视频以便清晰显示帧
  if (wasPlayingBeforeSeek) {
    videoPlayer.pause();
  }

  // 点击位置立即跳转
  seekToPercent(getSeekBarPercent(e.clientX));

  // 添加 document 级别的事件监听
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
  if (!isSeeking) return;
  e.preventDefault();
  seekToPercent(getSeekBarPercent(e.clientX));
}

function handleMouseUp() {
  if (!isSeeking) return;
  isSeeking = false;

  // 移除 document 级别的事件监听
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);

  // 精确设置最终位置
  if (videoDuration) {
    const finalTime = (parseFloat(videoSeekBar.value) / 100) * videoDuration;
    videoPlayer.currentTime = finalTime;
  }

  // 恢复播放
  if (wasPlayingBeforeSeek) {
    videoPlayer.play();
    wasPlayingBeforeSeek = false;
  }
}

videoSeekBar.addEventListener('mousedown', handleMouseDown);

// ========== 触摸拖动 ==========
function handleTouchStart(e) {
  if (!fileLoaded) return;

  isSeeking = true;
  wasPlayingBeforeSeek = !videoPlayer.paused;

  if (wasPlayingBeforeSeek) {
    videoPlayer.pause();
  }

  const touch = e.touches[0];
  seekToPercent(getSeekBarPercent(touch.clientX));
}

function handleTouchMove(e) {
  if (!isSeeking) return;
  e.preventDefault();
  const touch = e.touches[0];
  seekToPercent(getSeekBarPercent(touch.clientX));
}

function handleTouchEnd() {
  if (!isSeeking) return;
  isSeeking = false;

  if (videoDuration) {
    const finalTime = (parseFloat(videoSeekBar.value) / 100) * videoDuration;
    videoPlayer.currentTime = finalTime;
  }

  if (wasPlayingBeforeSeek) {
    videoPlayer.play();
    wasPlayingBeforeSeek = false;
  }
}

videoSeekBar.addEventListener('touchstart', handleTouchStart, { passive: false });
videoSeekBar.addEventListener('touchmove', handleTouchMove, { passive: false });
videoSeekBar.addEventListener('touchend', handleTouchEnd);
videoSeekBar.addEventListener('touchcancel', handleTouchEnd);

// 保留 input 事件作为备份（键盘操作等）
videoSeekBar.addEventListener('input', () => {
  if (isSeeking || !videoDuration) return;
  seekToPercent(parseFloat(videoSeekBar.value));
});

// ========== Range Selector Logic ==========
rangeStart.addEventListener('mousedown', (e) => startRangeDrag(e, 'start'));
rangeEnd.addEventListener('mousedown', (e) => startRangeDrag(e, 'end'));
rangeStart.addEventListener('touchstart', (e) => startRangeDrag(e, 'start'), { passive: false });
rangeEnd.addEventListener('touchstart', (e) => startRangeDrag(e, 'end'), { passive: false });

function startRangeDrag(e, type) {
  if (!fileLoaded) return;
  isDraggingRange = type;
  e.preventDefault();
  e.stopPropagation();

  if (e.type === 'mousedown') {
    document.addEventListener('mousemove', handleRangeDragMove);
    document.addEventListener('mouseup', endRangeDrag);
  } else {
    document.addEventListener('touchmove', handleRangeDragMove, { passive: false });
    document.addEventListener('touchend', endRangeDrag);
  }
}

function handleRangeDragMove(e) {
  if (!isDraggingRange) return;

  const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
  const rect = rangeSelector.getBoundingClientRect();
  const x = clientX - rect.left;
  let pct = (x / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));

  if (isDraggingRange === 'start') {
    rangeStartPct = Math.min(pct, rangeEndPct - 1); // Min 1% gap
  } else {
    rangeEndPct = Math.max(pct, rangeStartPct + 1);
  }

  updateRangeUI();
  updateTimeInputsFromRange();

  // Preview frame
  seekToPercent(isDraggingRange === 'start' ? rangeStartPct : rangeEndPct);
}

function endRangeDrag() {
  isDraggingRange = null;
  document.removeEventListener('mousemove', handleRangeDragMove);
  document.removeEventListener('mouseup', endRangeDrag);
  document.removeEventListener('touchmove', handleRangeDragMove);
  document.removeEventListener('touchend', endRangeDrag);
}

function updateRangeUI() {
  rangeStart.style.left = `${rangeStartPct}%`;
  rangeEnd.style.left = `${rangeEndPct}%`;
  rangeHighlight.style.left = `${rangeStartPct}%`;
  rangeHighlight.style.width = `${rangeEndPct - rangeStartPct}%`;
}

function updateTimeInputsFromRange() {
  if (!videoDuration) return;
  // 区间变化时，根据当前倍数重新计算张数
  updateCountFromMultiplier();
  const s = (rangeStartPct / 100) * videoDuration;
  const e = (rangeEndPct / 100) * videoDuration;
  startTimeInput.value = formatTimeMMSS(s);
  endTimeInput.value = formatTimeMMSS(e);
}

// ========== RIGHT-CLICK SCREENSHOT (右键截图) ==========

// Prevent default context menu on video area and control bar
videoWrapper.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (fileLoaded && !isProcessing) {
    // Pause video before screenshot
    const wasPlaying = !videoPlayer.paused;
    if (wasPlaying) videoPlayer.pause();

    await takeManualScreenshot();

    // Don't auto-resume, let user decide
  }
});

// Also allow right-click on seek bar area
controlBar.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (fileLoaded && !isProcessing) {
    const wasPlaying = !videoPlayer.paused;
    if (wasPlaying) videoPlayer.pause();

    await takeManualScreenshot();
  }
});

// ========== END RIGHT-CLICK SCREENSHOT ==========

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!fileLoaded || e.target.tagName === 'INPUT') return;
  if (lightbox.classList.contains('active')) return;

  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyS') { e.preventDefault(); takeManualScreenshot(); } // Keep S as backup
  if (e.code === 'ArrowLeft') { e.preventDefault(); videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5); }
  if (e.code === 'ArrowRight') { e.preventDefault(); videoPlayer.currentTime = Math.min(videoDuration, videoPlayer.currentTime + 5); }
});

async function takeManualScreenshot() {
  if (!fileLoaded || isProcessing) return;

  const canvas = document.createElement('canvas');
  canvas.width = videoPlayer.videoWidth;
  canvas.height = videoPlayer.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);

  manualScreenshotCount++;
  const filename = `manual_${manualScreenshotCount.toString().padStart(3, '0')}.jpg`;

  let saveDir = null;
  if (fs && cacheFolderPath && currentVideoFile) {
    const videoName = currentVideoFile.name.replace(/\.[^/.]+$/, "");
    const safeName = videoName.replace(/[<>:"/\\|?*]/g, '_').replace(/[.\s]+$/g, '').trim() || 'video_frames';
    saveDir = path.join(cacheFolderPath, safeName);
    try {
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      const dataURL = canvas.toDataURL('image/jpeg', 0.95);
      fs.writeFileSync(path.join(saveDir, filename), Buffer.from(dataURL.replace(/^data:image\/jpeg;base64,/, ""), 'base64'));
    } catch (e) { console.error('Save screenshot failed', e); }
  }

  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  const frameObj = { blob, url: URL.createObjectURL(blob), time: videoPlayer.currentTime, filename, isManual: true };
  capturedFrames.push(frameObj);
  addCard(frameObj, capturedFrames.length - 1);
  resultBadge.textContent = capturedFrames.length;

  if (saveDir) {
    downloadBtn.innerHTML = '📂 <span class="dl-text">打开文件夹</span>';
    downloadBtn.onclick = () => window.require('electron').shell.openPath(saveDir);
  } else {
    downloadBtn.innerHTML = '📥 <span class="dl-text">下载</span>';
    downloadBtn.onclick = downloadAll;
  }
  downloadBtn.disabled = false;
  downloadBtn.classList.remove('hidden');

  showToast();
}

function showToast() {
  screenshotToast.classList.add('show');
  setTimeout(() => screenshotToast.classList.remove('show'), 1500);
}

// Time Range
setStartBtn.addEventListener('click', () => startTimeInput.value = formatTimeMMSS(videoPlayer.currentTime));
setEndBtn.addEventListener('click', () => endTimeInput.value = formatTimeMMSS(videoPlayer.currentTime));

function parseTimeInput(str) {
  const parts = str.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatTimeMMSS(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// Handle File
function handleFile(file) {
  currentVideoFile = file;
  resetGallery();

  const url = URL.createObjectURL(file);
  videoPlayer.src = url;
  dropHint.classList.add('hidden');

  videoPlayer.onloadedmetadata = () => {
    videoDuration = videoPlayer.duration;
    totalTimeDisplay.textContent = formatTimeMMSS(videoDuration);
    startTimeInput.value = '00:00';
    endTimeInput.value = formatTimeMMSS(videoDuration);

    // Reset Range
    rangeStartPct = 0;
    rangeEndPct = 100;
    updateRangeUI();
    
    // 视频加载后更新倍数预览
    updateCountFromMultiplier();
  };

  fileLoaded = true;
  startBtn.disabled = false;
}

// Lightbox
function openLightbox(index) {
  if (index < 0 || index >= capturedFrames.length) return;
  currentLightBoxIndex = index;
  lightbox.classList.add('active');
  updateLightboxContent();
}

function closeLightbox() {
  lightbox.classList.remove('active');
  currentLightBoxIndex = -1;
}

function updateLightboxContent() {
  lightboxImg.src = capturedFrames[currentLightBoxIndex].url;
  lbCount.textContent = `${currentLightBoxIndex + 1} / ${capturedFrames.length}`;
}

function nextImage() { if (currentLightBoxIndex < capturedFrames.length - 1) { currentLightBoxIndex++; updateLightboxContent(); } }
function prevImage() { if (currentLightBoxIndex > 0) { currentLightBoxIndex--; updateLightboxContent(); } }

btnClose.addEventListener('click', closeLightbox);
btnNext.addEventListener('click', nextImage);
btnPrev.addEventListener('click', prevImage);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextImage();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevImage();
});

lightbox.addEventListener('wheel', (e) => { e.preventDefault(); e.deltaY > 0 ? nextImage() : prevImage(); }, { passive: false });

// Core Extraction
async function runSmartExtraction() {
  if (isProcessing || !fileLoaded) return;

  isProcessing = true;
  startBtn.disabled = true;
  startBtn.classList.add('processing');
  downloadBtn.disabled = true;
  processingOverlay.classList.add('active');
  btnProgress.style.width = '0%';

  const manualFrames = capturedFrames.filter(f => f.isManual);
  capturedFrames.forEach(f => { if (!f.isManual) URL.revokeObjectURL(f.url); });
  capturedFrames = [...manualFrames];
  galleryGrid.innerHTML = '';
  capturedFrames.forEach((f, i) => addCard(f, i));

  const rangeStart = parseTimeInput(startTimeInput.value);
  let rangeEnd = parseTimeInput(endTimeInput.value);
  if (rangeEnd <= rangeStart || rangeEnd > videoDuration) rangeEnd = videoDuration;
  const rangeDuration = rangeEnd - rangeStart;

  let saveDir = null;
  if (fs && cacheFolderPath && currentVideoFile) {
    const videoName = currentVideoFile.name.replace(/\.[^/.]+$/, "");
    const safeName = videoName.replace(/[<>:"/\\|?*]/g, '_').replace(/[.\s]+$/g, '').trim() || 'video_frames';
    saveDir = path.join(cacheFolderPath, safeName);
    try { if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true }); }
    catch (e) { console.error('Create dir failed', e); saveDir = null; }
  }

  const targetCount = parseInt(targetCountInput.value) || 24;
  const segmentDuration = rangeDuration / targetCount;

  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d');

  if (!videoPlayer.videoWidth) await new Promise(r => videoPlayer.onloadedmetadata = r);
  outCanvas.width = videoPlayer.videoWidth; outCanvas.height = videoPlayer.videoHeight;

  let autoCount = 0;

  try {
    for (let i = 0; i < targetCount; i++) {
      // 直接取每段中间位置，一次 seek 搞定
      const segStart = rangeStart + i * segmentDuration;
      const targetTime = segStart + segmentDuration * 0.5;

      if (targetTime >= rangeEnd) break;

      // seek 到目标位置
      videoPlayer.currentTime = targetTime;
      await new Promise(r => {
        const h = () => { videoPlayer.removeEventListener('seeked', h); r(); };
        videoPlayer.addEventListener('seeked', h);
      });

      // 直接截图
      outCtx.drawImage(videoPlayer, 0, 0, outCanvas.width, outCanvas.height);
      autoCount++;
      const filename = `${autoCount.toString().padStart(3, '0')}.jpg`;

      if (saveDir && fs) {
        const dataURL = outCanvas.toDataURL('image/jpeg', 0.9);
        fs.writeFileSync(path.join(saveDir, filename), Buffer.from(dataURL.replace(/^data:image\/jpeg;base64,/, ""), 'base64'));
      }

      const blob = await new Promise(r => outCanvas.toBlob(r, 'image/jpeg', 0.9));
      capturedFrames.push({ blob, url: URL.createObjectURL(blob), time: targetTime, filename, isManual: false });
      addCard(capturedFrames[capturedFrames.length - 1], capturedFrames.length - 1);
      resultBadge.textContent = capturedFrames.length;

      const pct = ((i + 1) / targetCount) * 100;
      btnProgress.style.width = `${pct}%`;
      startBtn.querySelector('.btn-text').textContent = `${Math.round(pct)}%`;
    }

    startBtn.querySelector('.btn-text').textContent = '⚡ 提取';

    if (saveDir) {
      downloadBtn.innerHTML = '📂 <span class="dl-text">打开文件夹</span>';
      downloadBtn.title = '打开文件夹';
      downloadBtn.onclick = () => window.require('electron').shell.openPath(saveDir);
    } else {
      downloadBtn.innerHTML = '📥 <span class="dl-text">下载</span>';
      downloadBtn.title = '下载所有图片';
      downloadBtn.onclick = downloadAll;
    }
    downloadBtn.disabled = false;
    downloadBtn.classList.remove('hidden');

  } catch (e) {
    console.error(e);
    startBtn.querySelector('.btn-text').textContent = '⚡ 提取';
  }
  finally {
    isProcessing = false;
    startBtn.disabled = false;
    startBtn.classList.remove('processing');
    processingOverlay.classList.remove('active');
  }
}

function calculateSharpness(data) {
  let score = 0;
  for (let i = 4; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const prevGray = 0.299 * data[i - 4] + 0.587 * data[i - 3] + 0.114 * data[i - 2];
    score += Math.abs(gray - prevGray);
  }
  return score;
}

function addCard(frame, index) {
  const empty = galleryGrid.querySelector('.empty-hint');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'gallery-card' + (frame.isManual ? ' manual-screenshot' : '');
  div.dataset.index = index;
  div.innerHTML = `<img src="${frame.url}" loading="lazy" /><span class="timestamp">${formatTimeMMSS(frame.time)}</span>`;
  galleryGrid.appendChild(div);
}

galleryGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.gallery-card');
  if (card) openLightbox(parseInt(card.dataset.index));
});

async function downloadAll() {
  const zip = new JSZip();
  capturedFrames.forEach((frame) => zip.file(frame.filename, frame.blob));
  saveAs(await zip.generateAsync({ type: 'blob' }), `video_frames_${Date.now()}.zip`);
}
