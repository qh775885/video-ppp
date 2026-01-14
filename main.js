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

const cacheFolderBtn = el('cacheFolderBtn');
const cacheFolderText = el('cacheFolderText');

const playPauseBtn = el('playPauseBtn');
const playIcon = el('playIcon');
const pauseIcon = el('pauseIcon');
const videoSeekBar = el('videoSeekBar');
const currentTimeDisplay = el('currentTimeDisplay');
const totalTimeDisplay = el('totalTimeDisplay');
const screenshotBtn = el('screenshotBtn');
const screenshotToast = el('screenshotToast');

const startTimeInput = el('startTimeInput');
const endTimeInput = el('endTimeInput');
const setStartBtn = el('setStartBtn');
const setEndBtn = el('setEndBtn');

const lightbox = el('lightbox');
const lightboxImg = el('lightboxImg');
const lbCount = el('lbCount');
const btnPrev = el('btnPrev');
const btnNext = el('btnNext');
const btnClose = el('btnClose');

// Pick Mode Elements
const pickModeBtn = el('pickModeBtn');
const pickModeToast = el('pickModeToast');

// Version Tag
const versionTag = el('versionTag');
if (versionTag) {
  versionTag.addEventListener('click', () => {
    const url = 'https://space.bilibili.com/248612618';
    if (window.require) {
      window.require('electron').shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  });
}

// --- State ---
let capturedFrames = [];
let isProcessing = false;
let fileLoaded = false;
let currentLightBoxIndex = -1;
let currentVideoFile = null;
let cacheFolderPath = localStorage.getItem('video-extractor-cache-path') || null;
let videoDuration = 0;
let manualScreenshotCount = 0;

// Pick Mode State
let isPickMode = false;
let isDraggingSeekBar = false;

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
  galleryGrid.innerHTML = '<div class="empty-hint">按S截图<br>或点击提取</div>';
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
}

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

videoPlayer.addEventListener('timeupdate', () => {
  if (!videoDuration || isDraggingSeekBar) return;
  const percent = (videoPlayer.currentTime / videoDuration) * 100;
  videoSeekBar.value = percent;
  currentTimeDisplay.textContent = formatTimeMMSS(videoPlayer.currentTime);
});

// ========== SEEK BAR HANDLING (Normal + Pick Mode) ==========

// Track when user starts dragging the seek bar
videoSeekBar.addEventListener('mousedown', () => {
  isDraggingSeekBar = true;

  // In pick mode, pause video when starting to drag
  if (isPickMode && fileLoaded && !videoPlayer.paused) {
    videoPlayer.pause();
  }
});

// Update video position while dragging
videoSeekBar.addEventListener('input', () => {
  if (!videoDuration) return;
  videoPlayer.currentTime = (parseFloat(videoSeekBar.value) / 100) * videoDuration;
  currentTimeDisplay.textContent = formatTimeMMSS(videoPlayer.currentTime);
});

// Handle mouseup - this is where pick mode takes screenshot
document.addEventListener('mouseup', async () => {
  if (!isDraggingSeekBar) return;
  isDraggingSeekBar = false;

  // If in pick mode, take screenshot on release
  if (isPickMode && fileLoaded && !isProcessing) {
    // Small delay to ensure the frame is rendered
    await new Promise(r => setTimeout(r, 80));
    takeManualScreenshot();
  }
});

// ========== PICK MODE (拉片选图) ==========

// Toggle Pick Mode
pickModeBtn?.addEventListener('click', () => {
  if (!fileLoaded) {
    alert('请先载入视频文件');
    return;
  }

  isPickMode = !isPickMode;

  if (isPickMode) {
    // Enable pick mode
    pickModeBtn.classList.add('active');
    videoSeekBar.classList.add('pick-mode');

    // Pause video when entering pick mode
    if (!videoPlayer.paused) {
      videoPlayer.pause();
    }

    // Show toast
    showPickModeToast(true);
  } else {
    // Disable pick mode
    pickModeBtn.classList.remove('active');
    videoSeekBar.classList.remove('pick-mode');

    showPickModeToast(false);
  }
});

// Pick Mode Toast
function showPickModeToast(show) {
  if (show) {
    pickModeToast.classList.add('show');
    setTimeout(() => pickModeToast.classList.remove('show'), 2500);
  } else {
    pickModeToast.classList.remove('show');
  }
}

// ========== END PICK MODE ==========

// Screenshot
screenshotBtn.addEventListener('click', takeManualScreenshot);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!fileLoaded || e.target.tagName === 'INPUT') return;
  if (lightbox.classList.contains('active')) return;

  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyS') { e.preventDefault(); takeManualScreenshot(); }
  if (e.code === 'KeyP') { e.preventDefault(); pickModeBtn?.click(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5); }
  if (e.code === 'ArrowRight') { e.preventDefault(); videoPlayer.currentTime = Math.min(videoDuration, videoPlayer.currentTime + 5); }
});

async function takeManualScreenshot() {
  if (!fileLoaded || isProcessing) return;

  const wasPlaying = !videoPlayer.paused;
  if (wasPlaying) videoPlayer.pause();

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
    downloadBtn.textContent = '打开文件夹';
    downloadBtn.onclick = () => window.require('electron').shell.openPath(saveDir);
  } else {
    downloadBtn.textContent = '下载';
    downloadBtn.onclick = downloadAll;
  }
  downloadBtn.disabled = false;
  downloadBtn.classList.remove('hidden');

  showToast();

  // In pick mode, don't resume playback
  if (wasPlaying && !isPickMode) videoPlayer.play();
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
  };

  fileLoaded = true;
  startBtn.disabled = false;

  // Reset pick mode when loading new video
  if (isPickMode) {
    isPickMode = false;
    pickModeBtn?.classList.remove('active');
    videoSeekBar?.classList.remove('pick-mode');
  }
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

  // Disable pick mode during extraction
  if (isPickMode) {
    isPickMode = false;
    pickModeBtn?.classList.remove('active');
    videoSeekBar?.classList.remove('pick-mode');
  }

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

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d');

  if (!videoPlayer.videoWidth) await new Promise(r => videoPlayer.onloadedmetadata = r);
  canvas.width = 160; canvas.height = 90;
  outCanvas.width = videoPlayer.videoWidth; outCanvas.height = videoPlayer.videoHeight;

  let autoCount = 0;

  try {
    for (let i = 0; i < targetCount; i++) {
      const segStart = rangeStart + i * segmentDuration;
      let bestFrame = { score: -1, time: 0 };
      const checkPoints = [segStart + segmentDuration * 0.1, segStart + segmentDuration * 0.5, segStart + segmentDuration * 0.8];

      for (let t of checkPoints) {
        if (t >= rangeEnd) break;
        videoPlayer.currentTime = t;
        await new Promise(r => { const h = () => { videoPlayer.removeEventListener('seeked', h); r(); }; videoPlayer.addEventListener('seeked', h); });
        ctx.drawImage(videoPlayer, 0, 0, 160, 90);
        const score = calculateSharpness(ctx.getImageData(0, 0, 160, 90).data);
        if (score > bestFrame.score) bestFrame = { score, time: t };
      }

      if (bestFrame.time > 0) {
        videoPlayer.currentTime = bestFrame.time;
        await new Promise(r => { const h = () => { videoPlayer.removeEventListener('seeked', h); r(); }; videoPlayer.addEventListener('seeked', h); });
        outCtx.drawImage(videoPlayer, 0, 0, outCanvas.width, outCanvas.height);
        autoCount++;
        const filename = `${autoCount.toString().padStart(3, '0')}.jpg`;

        if (saveDir && fs) {
          const dataURL = outCanvas.toDataURL('image/jpeg', 0.9);
          fs.writeFileSync(path.join(saveDir, filename), Buffer.from(dataURL.replace(/^data:image\/jpeg;base64,/, ""), 'base64'));
        }

        const blob = await new Promise(r => outCanvas.toBlob(r, 'image/jpeg', 0.9));
        capturedFrames.push({ blob, url: URL.createObjectURL(blob), time: bestFrame.time, filename, isManual: false });
        addCard(capturedFrames[capturedFrames.length - 1], capturedFrames.length - 1);
        resultBadge.textContent = capturedFrames.length;
      }

      const pct = ((i + 1) / targetCount) * 100;
      btnProgress.style.width = `${pct}%`;
      startBtn.querySelector('.btn-text').textContent = `${Math.round(pct)}%`;
      await new Promise(r => setTimeout(r, 0));
    }

    startBtn.querySelector('.btn-text').textContent = '⚡ 提取';

    if (saveDir) {
      downloadBtn.innerHTML = '📂'; // Icon for Open Folder
      downloadBtn.title = '打开文件夹';
      downloadBtn.onclick = () => window.require('electron').shell.openPath(saveDir);
    } else {
      downloadBtn.innerHTML = '📥'; // Icon for Download
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
