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

// Portrait Mode Elements (整合到控制栏)
const portraitBtn = el('portraitBtn');
const portraitRatio = el('portraitRatio');
const portraitMenu = el('portraitMenu');
const posButtons = el('posButtons');
const cropOverlay = el('cropOverlay');
const cropBox = el('cropBox');

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

// Portrait Mode State
let isPortraitMode = false;
let currentRatio = '9:16';
let cropPositionPct = 50; // Center position (0-100)
let isDraggingCrop = false;

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
// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!fileLoaded || e.target.tagName === 'INPUT') return;
  if (lightbox.classList.contains('active')) return;

  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyS') { e.preventDefault(); takeManualScreenshot(); } // Keep S as backup

  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    const step = getSeekStep();
    videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - step);
  }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    const step = getSeekStep();
    videoPlayer.currentTime = Math.min(videoDuration, videoPlayer.currentTime + step);
  }
});

async function takeManualScreenshot() {
  if (!fileLoaded || isProcessing) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Check if portrait mode is active
  const cropCoords = getCropCoordinates();

  if (cropCoords) {
    // Portrait mode: use crop dimensions
    canvas.width = cropCoords.width;
    canvas.height = cropCoords.height;
    ctx.drawImage(
      videoPlayer,
      cropCoords.x, cropCoords.y, cropCoords.width, cropCoords.height,
      0, 0, canvas.width, canvas.height
    );
  } else {
    // Normal mode: full frame
    canvas.width = videoPlayer.videoWidth;
    canvas.height = videoPlayer.videoHeight;
    ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
  }

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

  // Check if portrait mode is active and get crop coordinates
  const cropCoords = getCropCoordinates();

  if (cropCoords) {
    // Portrait mode: use crop dimensions
    outCanvas.width = cropCoords.width;
    outCanvas.height = cropCoords.height;
  } else {
    // Normal mode: full frame
    outCanvas.width = videoPlayer.videoWidth;
    outCanvas.height = videoPlayer.videoHeight;
  }

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

      // 截图（支持竖图裁剪）
      if (cropCoords) {
        // Portrait mode: draw cropped region
        outCtx.drawImage(
          videoPlayer,
          cropCoords.x, cropCoords.y, cropCoords.width, cropCoords.height,
          0, 0, outCanvas.width, outCanvas.height
        );
      } else {
        // Normal mode: draw full frame
        outCtx.drawImage(videoPlayer, 0, 0, outCanvas.width, outCanvas.height);
      }

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

// ========== Portrait Mode Logic (新版整合交互) ==========

const RATIOS = {
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '4:5': 4 / 5,
  '1:1': 1
};

// --- 竖图模式逻辑 (现代化交互) ---

// 初始化：点击按钮主体开关，点击箭头（如果有分离区域）或整体逻辑
// 这里我们简化：点击按钮弹出菜单是不够便捷的。
// 新逻辑：点击按钮 -> 切换开关。Hover或点击旁边的箭头 -> 选比例。
// 目前 HTML 结构是整个按钮一体的。我们可以区分点击事件的目标，或者改逻辑。
// 让我们实现：点击按钮 = 开关；

portraitBtn.addEventListener('click', (e) => {
  e.stopPropagation();

  // 如果点击的是下拉箭头区域（虽然现在是一体的，但可以通过类名区分如果做了分离）
  // 或者我们简单点：：点击按钮本身就是开关。菜单通过 hover 或者长按？
  // 不，用户要求“点击开启关闭”。也就是按钮本身是 Switch。
  // 那比例怎么选？-> 只有点击箭头（.dropdown-arrow）才弹出菜单？

  if (e.target.classList.contains('dropdown-arrow') || e.target.closest('.dropdown-arrow')) {
    // 点击了箭头 -> 切换菜单显示
    const isOpen = portraitMenu.classList.contains('open');
    if (isOpen) {
      portraitMenu.classList.remove('open');
    } else {
      portraitMenu.classList.add('open');
    }
  } else {
    // 点击了按钮主体 -> 切换开关状态
    togglePortraitMode();
  }
});

// 点击外部关闭菜单
document.addEventListener('click', (e) => {
  if (!portraitDropdown.contains(e.target)) {
    portraitMenu.classList.remove('open');
  }
});

// 菜单选择比例
portraitMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.menu-item');
  if (!item) return;

  const ratio = item.dataset.ratio;
  if (ratio) { // 移除了 'off' 逻辑，因为菜单里没有关闭了
    currentRatio = ratio;
    if (!isPortraitMode) {
      togglePortraitMode(true); // 选比例自然要开启
    } else {
      updatePortraitUI(); // 仅更新比例
    }
    portraitMenu.classList.remove('open');
  }
});

function togglePortraitMode(forceState = null) {
  if (forceState !== null) {
    isPortraitMode = forceState;
  } else {
    isPortraitMode = !isPortraitMode;
  }

  updatePortraitUI();

  if (isPortraitMode) {
    // 开启时，如果还没选过比例，默认 9:16
    if (currentRatio === 'off') currentRatio = '9:16';
    updateCropBox();
  } else {
    cropOverlay.classList.remove('active');
  }
}

function updatePortraitUI() {
  if (isPortraitMode) {
    portraitBtn.classList.add('active');
    portraitRatio.textContent = currentRatio;
    posButtons.classList.add('visible');
    cropOverlay.classList.add('active');

    // Update menu active state
    document.querySelectorAll('.menu-item').forEach(item => {
      item.classList.toggle('active', item.dataset.ratio === currentRatio);
    });

    updateCropBox();
    updatePosButtonsState(); // Update position buttons
  } else {
    portraitBtn.classList.remove('active');
    portraitRatio.textContent = 'OFF';
    posButtons.classList.remove('visible');
    cropOverlay.classList.remove('active');

    document.querySelectorAll('.menu-item').forEach(item => {
      item.classList.remove('active');
    });
  }
}

// --- 快进/快退逻辑更新 ---
const seekStepInput = document.getElementById('seekStepInput');

function getSeekStep() {
  const val = parseFloat(seekStepInput.value);
  return isNaN(val) || val <= 0 ? 5 : val;
}

// Position Buttons
posButtons?.addEventListener('click', (e) => {
  const btn = e.target.closest('.pos-btn');
  if (!btn) return;

  const pos = btn.dataset.pos;
  switch (pos) {
    case 'left': cropPositionPct = 0; break;
    case 'center': cropPositionPct = 50; break;
    case 'right': cropPositionPct = 100; break;
  }

  updateCropBox();
  updatePosButtonsState();
});

function updatePosButtonsState() {
  document.querySelectorAll('.pos-btn').forEach(btn => {
    const pos = btn.dataset.pos;
    let isActive = false;
    if (pos === 'left' && cropPositionPct === 0) isActive = true;
    if (pos === 'center' && Math.abs(cropPositionPct - 50) < 1) isActive = true;
    if (pos === 'right' && cropPositionPct === 100) isActive = true;

    btn.classList.toggle('active', isActive);
  });
}

// Calculate crop box dimensions based on video and ratio
function getCropDimensions() {
  if (!videoPlayer.videoWidth || !videoPlayer.videoHeight) return null;

  const videoRect = videoPlayer.getBoundingClientRect();
  const videoAspect = videoPlayer.videoWidth / videoPlayer.videoHeight;

  // Calculate displayed video dimensions (accounting for object-fit: contain)
  let displayWidth, displayHeight;
  const containerAspect = videoRect.width / videoRect.height;

  if (videoAspect > containerAspect) {
    displayWidth = videoRect.width;
    displayHeight = videoRect.width / videoAspect;
  } else {
    displayHeight = videoRect.height;
    displayWidth = videoRect.height * videoAspect;
  }

  // Calculate crop box dimensions
  const targetRatio = RATIOS[currentRatio];
  let cropWidth, cropHeight;

  cropHeight = displayHeight;
  cropWidth = cropHeight * targetRatio;

  if (cropWidth > displayWidth) {
    cropWidth = displayWidth;
    cropHeight = cropWidth / targetRatio;
  }

  const offsetX = (videoRect.width - displayWidth) / 2;
  const offsetY = (videoRect.height - displayHeight) / 2;
  const maxLeft = displayWidth - cropWidth;
  const cropLeft = offsetX + (cropPositionPct / 100) * maxLeft;

  return {
    width: cropWidth,
    height: cropHeight,
    left: cropLeft,
    top: offsetY,
    displayWidth,
    displayHeight,
    offsetX,
    offsetY,
    maxLeft
  };
}

function updateCropBox() {
  if (!isPortraitMode || !fileLoaded) return;

  const dims = getCropDimensions();
  if (!dims) return;

  cropBox.style.width = `${dims.width}px`;
  cropBox.style.height = `${dims.height}px`;
  cropBox.style.left = `${dims.left}px`;
  cropBox.style.top = `${dims.top}px`;
  cropBox.style.transform = 'none';
}

// Update crop box on video load and resize
videoPlayer.addEventListener('loadedmetadata', updateCropBox);
window.addEventListener('resize', updateCropBox);

// Drag Crop Box
cropBox?.addEventListener('mousedown', startCropDrag);
cropBox?.addEventListener('touchstart', startCropDrag, { passive: false });

function startCropDrag(e) {
  if (!isPortraitMode) return;
  e.preventDefault();
  isDraggingCrop = true;

  const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
  const startLeft = parseFloat(cropBox.style.left) || 0;

  function onMove(e) {
    if (!isDraggingCrop) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const deltaX = clientX - startX;

    const dims = getCropDimensions();
    if (!dims) return;

    let newLeft = startLeft + deltaX;
    newLeft = Math.max(dims.offsetX, Math.min(dims.offsetX + dims.maxLeft, newLeft));

    cropBox.style.left = `${newLeft}px`;

    cropPositionPct = dims.maxLeft > 0 ? ((newLeft - dims.offsetX) / dims.maxLeft) * 100 : 50;
    cropPositionPct = Math.max(0, Math.min(100, cropPositionPct));

    updatePosButtonsState();
  }

  function onEnd() {
    isDraggingCrop = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

// Get crop coordinates for actual video pixels
function getCropCoordinates() {
  if (!isPortraitMode || !videoPlayer.videoWidth) return null;

  const targetRatio = RATIOS[currentRatio];
  const videoWidth = videoPlayer.videoWidth;
  const videoHeight = videoPlayer.videoHeight;

  let cropWidth, cropHeight;

  cropHeight = videoHeight;
  cropWidth = cropHeight * targetRatio;

  if (cropWidth > videoWidth) {
    cropWidth = videoWidth;
    cropHeight = cropWidth / targetRatio;
  }

  const maxX = videoWidth - cropWidth;
  const cropX = (cropPositionPct / 100) * maxX;
  const cropY = (videoHeight - cropHeight) / 2;

  return {
    x: Math.round(cropX),
    y: Math.round(cropY),
    width: Math.round(cropWidth),
    height: Math.round(cropHeight)
  };
}

// Export for use in extraction
window.getCropCoordinates = getCropCoordinates;
window.isPortraitMode = () => isPortraitMode;

