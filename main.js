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
// const uploadZone = el('uploadZone'); // Removed
const fileInput = el('fileInput');
const dashboard = el('dashboard');
const videoPlayer = el('videoPlayer');
const startBtn = el('startBtn');
const downloadBtn = el('downloadBtn');
const clearBtn = el('clearBtn');
const targetCountInput = el('targetCount');
const btnInc = el('btnInc');
const btnDec = el('btnDec');
const segmentCountDisplay = el('segmentCountDisplay');
const progressBar = el('progressBar');
const statusText = el('statusText');
const galleryGrid = el('galleryGrid');
const resultBadge = el('resultBadge');
const processingOverlay = el('processingOverlay');
// const miniUploadZone = el('miniUploadZone'); // Removed

const cacheFolderBtn = el('cacheFolderBtn');
const cacheFolderText = el('cacheFolderText');

const videoMeta = el('videoMeta');
const durationDisplay = el('durationDisplay');
const recommendBtn = el('recommendBtn');
const recommendCount = el('recommendCount');

// Lightbox Elements
const lightbox = el('lightbox');
const lightboxImg = el('lightboxImg');
const lbCount = el('lbCount');
const btnPrev = el('btnPrev');
const btnNext = el('btnNext');
const btnClose = el('btnClose');

// --- State ---
let capturedFrames = [];
let isProcessing = false;
let fileLoaded = false;
let currentLightBoxIndex = -1;
let currentVideoFile = null;
let cacheFolderPath = localStorage.getItem('video-extractor-cache-path') || null;

// --- Init & Events ---

// 1. Restore Settings
const savedCount = localStorage.getItem('video-extractor-target-count');
if (savedCount) {
  targetCountInput.value = savedCount;
  segmentCountDisplay.textContent = savedCount;
}

// Restore Cache Path UI
if (cacheFolderPath && fs) {
  if (cacheFolderBtn) {
    cacheFolderBtn.classList.add('active');
    cacheFolderText.textContent = `📂 缓存至: ${cacheFolderPath}`;
  }
} else if (!fs) {
  if (cacheFolderBtn) cacheFolderBtn.style.display = 'none';
}

// 2. Cache Folder Selection (Electron Only)
if (cacheFolderBtn) {
  cacheFolderBtn.addEventListener('click', async () => {
    if (!ipcRenderer) return alert('请使用桌面版软件以启用此功能');

    const selectedPath = await ipcRenderer.invoke('select-folder');
    if (selectedPath) {
      cacheFolderPath = selectedPath;
      localStorage.setItem('video-extractor-cache-path', selectedPath);
      cacheFolderBtn.classList.add('active');
      cacheFolderText.textContent = `📂 缓存至: ${selectedPath}`;
    }
  });
}

// Global Drag & Drop (Drop anywhere to load video)
document.ondragover = document.ondrop = (e) => {
  e.preventDefault();
}

document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]?.type.startsWith('video/')) handleFile(e.dataTransfer.files[0]);
});

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
});




fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  fileInput.value = '';
});

startBtn.addEventListener('click', runSmartExtraction);
downloadBtn.onclick = downloadAll;
clearBtn.addEventListener('click', () => resetGallery());

function resetGallery() {
  capturedFrames.forEach(f => URL.revokeObjectURL(f.url));
  capturedFrames = [];
  galleryGrid.innerHTML = '<div class="empty-state"><p>点击“开始智能提取”<br>AI 将自动为您挑选最佳镜头</p></div>';
  resultBadge.textContent = '0';
  downloadBtn.disabled = true;
  downloadBtn.classList.add('hidden');
  statusText.textContent = '就绪';
  progressBar.style.width = '0%';
}

// Stepper
btnInc.addEventListener('click', () => updateTarget(1));
btnDec.addEventListener('click', () => updateTarget(-1));
targetCountInput.addEventListener('input', () => updateTarget(0));

function updateTarget(delta) {
  let val = parseInt(targetCountInput.value) || 24;
  val = Math.max(1, Math.min(300, val + delta)); // Limit 300
  targetCountInput.value = val;
  segmentCountDisplay.textContent = val;
  localStorage.setItem('video-extractor-target-count', val);
}

function handleFile(file) {
  currentVideoFile = file;
  resetGallery();

  const url = URL.createObjectURL(file);
  videoPlayer.src = url;
  videoMeta.classList.add('hidden');

  videoPlayer.onloadedmetadata = () => {
    const sec = Math.floor(videoPlayer.duration);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    durationDisplay.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    // Rec: 1 frame/sec
    // Rec: Smart Duration Scaling
    // < 1min: 1 frame/sec (max 60)
    // 1-5min: 1 frame/3sec (approx 20-100)
    // 5-30min: 1 frame/10sec (approx 30-180)
    // > 30min: 1 frame/30sec (max out at 300)
    let rec = 24;
    if (sec < 60) {
      rec = sec;
    } else if (sec < 300) {
      rec = Math.floor(sec / 3);
    } else if (sec < 1800) {
      rec = Math.floor(sec / 10);
    } else {
      rec = Math.floor(sec / 30);
    }

    // Hard clamp: min 10, max 300
    rec = Math.max(10, Math.min(300, rec));

    recommendCount.textContent = rec;
    recommendBtn.onclick = () => {
      targetCountInput.value = rec;
      updateTarget(0);
      runSmartExtraction();
    };
    videoMeta.classList.remove('hidden');
  };

  // uploadZone.classList.add('hidden'); // Removed
  dashboard.classList.remove('hidden');
  fileLoaded = true;
  statusText.textContent = '视频已加载';
  startBtn.disabled = false;
}

// --- Lightbox ---
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
  const frame = capturedFrames[currentLightBoxIndex];
  lightboxImg.src = frame.url;
  lbCount.textContent = `${currentLightBoxIndex + 1} / ${capturedFrames.length}`;
}

function nextImage() {
  if (currentLightBoxIndex < capturedFrames.length - 1) {
    currentLightBoxIndex++;
    updateLightboxContent();
  }
}

function prevImage() {
  if (currentLightBoxIndex > 0) {
    currentLightBoxIndex--;
    updateLightboxContent();
  }
}

// Lightbox Events
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
lightbox.addEventListener('wheel', (e) => {
  e.preventDefault();
  (e.deltaY > 0) ? nextImage() : prevImage();
}, { passive: false });


// --- CORE ALGORITHM ---
async function runSmartExtraction() {
  if (isProcessing || !fileLoaded) return;

  isProcessing = true;
  startBtn.disabled = true;
  downloadBtn.disabled = true;
  processingOverlay.classList.add('active');
  progressBar.style.width = '0%';
  statusText.textContent = 'AI 扫描中...';

  if (capturedFrames.length > 0) resetGallery();
  galleryGrid.innerHTML = '';
  capturedFrames = [];

  // Prepare Save Folder
  let saveDir = null;
  if (fs && cacheFolderPath && currentVideoFile) {
    const videoName = currentVideoFile.name.replace(/\.[^/.]+$/, "");
    const safeName = videoName.replace(/[<>:"/\\|?*]/g, '_');
    saveDir = path.join(cacheFolderPath, safeName);

    try {
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      statusText.textContent = `保存到: ${safeName}`;
    } catch (e) {
      console.error('Create dir failed', e);
      saveDir = null;
    }
  }

  const targetCount = parseInt(targetCountInput.value) || 24;
  const duration = videoPlayer.duration;
  const segmentDuration = duration / targetCount;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d');

  if (!videoPlayer.videoWidth) await new Promise(r => videoPlayer.onloadedmetadata = r);

  canvas.width = 160;
  canvas.height = 90;
  outCanvas.width = videoPlayer.videoWidth;
  outCanvas.height = videoPlayer.videoHeight;

  try {
    for (let i = 0; i < targetCount; i++) {
      const segStart = i * segmentDuration;
      let bestFrame = { score: -1, time: 0 };
      const checkPoints = [
        segStart + segmentDuration * 0.1,
        segStart + segmentDuration * 0.5,
        segStart + segmentDuration * 0.8
      ];

      for (let t of checkPoints) {
        if (t >= duration) break;
        videoPlayer.currentTime = t;
        await new Promise(r => {
          const h = () => { videoPlayer.removeEventListener('seeked', h); r(); };
          videoPlayer.addEventListener('seeked', h);
        });
        ctx.drawImage(videoPlayer, 0, 0, 160, 90);
        const frameData = ctx.getImageData(0, 0, 160, 90);
        const score = calculateSharpness(frameData.data);
        if (score > bestFrame.score) bestFrame = { score, time: t };
      }

      if (bestFrame.time > 0) {
        videoPlayer.currentTime = bestFrame.time;
        await new Promise(r => {
          const h = () => { videoPlayer.removeEventListener('seeked', h); r(); };
          videoPlayer.addEventListener('seeked', h);
        });

        outCtx.drawImage(videoPlayer, 0, 0, outCanvas.width, outCanvas.height);
        const filename = `${(i + 1).toString().padStart(3, '0')}.jpg`;

        if (saveDir && fs) {
          // Node.js Direct Save
          const dataURL = outCanvas.toDataURL('image/jpeg', 0.9);
          const base64Data = dataURL.replace(/^data:image\/jpeg;base64,/, "");
          const fullPath = path.join(saveDir, filename);
          fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));

          // Gallery Display
          const blob = await new Promise(r => outCanvas.toBlob(r, 'image/jpeg', 0.9));
          const frameObj = { blob, url: URL.createObjectURL(blob), time: bestFrame.time, filename };
          capturedFrames.push(frameObj);
          addCard(frameObj, capturedFrames.length - 1);

        } else {
          // Browser Blob
          const blob = await new Promise(r => outCanvas.toBlob(r, 'image/jpeg', 0.9));
          const frameObj = { blob, url: URL.createObjectURL(blob), time: bestFrame.time, filename };
          capturedFrames.push(frameObj);
          addCard(frameObj, capturedFrames.length - 1);
        }
        resultBadge.textContent = capturedFrames.length;
      }
      const pct = ((i + 1) / targetCount) * 100;
      progressBar.style.width = `${pct}%`;
      statusText.textContent = `提取中... ${i + 1}/${targetCount}`;
      await new Promise(r => setTimeout(r, 0));
    }

    if (saveDir) {
      statusText.textContent = `已保存: ${saveDir}`;
      downloadBtn.textContent = '打开文件夹';
      downloadBtn.onclick = () => window.require('electron').shell.openPath(saveDir);
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('hidden');
    } else {
      statusText.textContent = `完成! 提取 ${capturedFrames.length} 张`;
      downloadBtn.textContent = '下载相册 ZIP';
      downloadBtn.onclick = downloadAll;
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('hidden');
    }

  } catch (e) {
    console.error(e);
    statusText.textContent = '出错: ' + e.message;
  } finally {
    isProcessing = false;
    startBtn.disabled = false;
    processingOverlay.classList.remove('active');
  }
}

// --- Helper Functions ---
function calculateSharpness(data) {
  let score = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    if (i > 4) {
      const prevR = data[i - 4];
      const prevG = data[i - 3];
      const prevB = data[i - 2];
      const prevGray = 0.299 * prevR + 0.587 * prevG + 0.114 * prevB;
      score += Math.abs(gray - prevGray);
    }
  }
  return score;
}

function addCard(frame, index) {
  const div = document.createElement('div');
  div.className = 'gallery-card';
  div.dataset.index = index; // Store index
  div.innerHTML = `
    <img src="${frame.url}" loading="lazy" />
    <div class="overlay">
       <span class="timestamp">${formatTime(frame.time)}</span>
       <button class="icon-btn">🔍</button>
    </div>
  `;
  galleryGrid.appendChild(div);
}

// Event Delegation for Gallery Clicks
galleryGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.gallery-card');
  if (card) {
    const idx = parseInt(card.dataset.index);
    if (!isNaN(idx)) openLightbox(idx);
  }
});

// window.preview = openLightbox; // Removed global

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

async function downloadAll() {
  const zip = new JSZip();
  capturedFrames.forEach((frame) => {
    zip.file(frame.filename, frame.blob);
  });
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `video_frames_${Date.now()}.zip`);
}
