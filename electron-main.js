const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);

// Handling dev vs packed paths for ffmpeg
const fixPath = (p) => p ? p.replace('app.asar', 'app.asar.unpacked') : '';
const resolvedFfmpegPath = fixPath(ffmpegPath);
ffmpeg.setFfmpegPath(resolvedFfmpegPath);

function parseFfmpegMetadata(stderr = '') {
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = durationMatch
        ? (parseInt(durationMatch[1], 10) * 3600) + (parseInt(durationMatch[2], 10) * 60) + parseFloat(durationMatch[3])
        : 0;

    const videoLine = stderr.split(/\r?\n/).find(line => /Stream #.*Video:/.test(line)) || '';
    const audioLine = stderr.split(/\r?\n/).find(line => /Stream #.*Audio:/.test(line)) || '';

    const videoCodecMatch = videoLine.match(/Video:\s*([^,\s]+)/);
    const audioCodecMatch = audioLine.match(/Audio:\s*([^,\s]+)/);
    const sizeMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
    const tbrMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*tbr/);

    return {
        duration,
        fps: fpsMatch ? parseFloat(fpsMatch[1]) : (tbrMatch ? parseFloat(tbrMatch[1]) : 30),
        width: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
        height: sizeMatch ? parseInt(sizeMatch[2], 10) : 0,
        videoCodec: videoCodecMatch ? videoCodecMatch[1].toLowerCase() : '',
        audioCodec: audioCodecMatch ? audioCodecMatch[1].toLowerCase() : '',
        hasAudio: Boolean(audioLine)
    };
}

function probeVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
        if (!filePath) return reject(new Error('No input specified'));

        execFile(resolvedFfmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true }, (error, stdout, stderr) => {
            const metadata = parseFfmpegMetadata(stderr || stdout || '');
            if (!metadata.width && !metadata.height && error) {
                return reject(error);
            }
            resolve(metadata);
        });
    });
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 960,
        minWidth: 1000,
        minHeight: 700,
        title: "视频截图神器",
        icon: path.join(__dirname, 'public/icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        show: false // start hidden to prevent white flash
    });

    // win.maximize(); // Removed forced maximization

    win.once('ready-to-show', () => {
        win.show();
    });

    if (isDev) {
        win.loadURL(devServerUrl);
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'));
    }

    // 方便调试：F12 打开/关闭 开发者工具
    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            win.webContents.toggleDevTools();
            event.preventDefault(); // 避免触发默认行为
        }
    });
}

// 监听渲染进程的“选文件夹”请求
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0]; // 返回真实的硬盘绝对路径
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    if (folderPath) {
        await shell.openPath(folderPath);
    }
});

ipcMain.handle('get-video-info', (event, filePath) => {
    return probeVideoInfo(filePath).then(metadata => ({
        duration: metadata.duration,
        fps: metadata.fps,
        width: metadata.width,
        height: metadata.height
    }));
});

ipcMain.handle('process-media', (event, filePath) => {
    return new Promise((resolve, reject) => {
        if (!filePath) {
            console.error("Empty filePath received in process-media");
            return reject(new Error("No path specified for media processing"));
        }

        probeVideoInfo(filePath).then(metadata => {
            const vCodec = metadata.videoCodec;
            const aCodec = metadata.audioCodec;

            const tempPath = path.join(os.tmpdir(), `vme_${Date.now()}.mp4`);
            const command = ffmpeg(filePath);

            // HEVC(H.265) and older formats need transcode on standard Chromium, otherwise remux is fast and lossless.
            const needsVideoTranscode = ['hevc', 'h265', 'mpeg4', 'mpeg2video', 'msmpeg4', 'divx', 'xvid'].includes(vCodec);

            if (needsVideoTranscode) {
                command.outputOptions(['-c:v libx264', '-preset ultrafast', '-crf 23']); // ultrafast encoding
            } else if (vCodec) {
                command.outputOptions(['-c:v copy']); // remuxing
            }

            if (aCodec === 'aac') {
                command.outputOptions(['-c:a copy']);
            } else if (metadata.hasAudio) {
                command.outputOptions(['-c:a aac', '-b:a 128k']);
            } else {
                command.outputOptions(['-an']);
            }

            command.outputOptions([
                '-map 0:v:0',          // ONLY grab the MAIN video track
                '-map 0:a:0?',         // ONLY grab the 1st audio track if exists
                '-ignore_unknown',     // Drops weird IDM/TS data streams that break MP4 muxer
                '-f mp4',
                '-movflags +faststart', // CRITICAL: Moves MOOV atom to beginning, completely fixes IDM drag-and-drop bug
                '-y'
            ])
                .on('end', () => resolve(tempPath))
                .on('error', (err, stdout, stderr) => {
                    console.error("FFMPEG PROCESS MEDIA ERROR:", stderr);
                    reject(new Error(`${err.message} | STDERR: ${stderr}`));
                })
                .save(tempPath);
        }).catch(err => {
            console.error("FFmpeg probe error:", err);
            reject(err);
        });
    });
});

// FFmpeg 全段扫描提取：一次 FFmpeg 调用解码整段视频，适合高张数场景
ipcMain.handle('extract-frames', (event, { filePath, startTime, duration, fps: targetFps, outputDir }) => {
    return new Promise((resolve, reject) => {
        if (!filePath) return reject(new Error('extract-frames: no input file'));

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPattern = path.join(outputDir, 'frame_%04d.jpg');

        ffmpeg(filePath)
            .seekInput(startTime)
            .duration(duration)
            .videoFilter(`fps=${targetFps}`)
            .outputOptions([
                '-q:v 2',
                '-an'
            ])
            .output(outputPattern)
            .on('end', () => {
                try {
                    const files = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
                        .sort()
                        .map(f => path.join(outputDir, f));
                    resolve(files);
                } catch (readErr) {
                    reject(new Error(`Failed to read extracted frames: ${readErr.message}`));
                }
            })
            .on('error', (err, stdout, stderr) => {
                reject(new Error(`FFmpeg extract-frames failed: ${err.message} | ${stderr || ''}`));
            })
            .run();
    });
});

// FFmpeg 稳定优选候选：统一抽样后先做底层去重，减少重复帧
ipcMain.handle('extract-frames-smart', (event, { filePath, startTime, duration, fps: targetFps, outputDir }) => {
    return new Promise((resolve, reject) => {
        if (!filePath) return reject(new Error('extract-frames-smart: no input file'));

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPattern = path.join(outputDir, 'smart_%04d.jpg');

        ffmpeg(filePath)
            .seekInput(startTime)
            .duration(duration)
            .videoFilters([
                `fps=${targetFps}`,
                'mpdecimate'
            ])
            .outputOptions([
                '-vsync vfr',
                '-q:v 2',
                '-an'
            ])
            .output(outputPattern)
            .on('end', () => {
                try {
                    const files = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith('smart_') && f.endsWith('.jpg'))
                        .sort()
                        .map(f => path.join(outputDir, f));
                    resolve(files);
                } catch (readErr) {
                    reject(new Error(`Failed to read smart frames: ${readErr.message}`));
                }
            })
            .on('error', (err, stdout, stderr) => {
                reject(new Error(`FFmpeg extract-frames-smart failed: ${err.message} | ${stderr || ''}`));
            })
            .run();
    });
});

// FFmpeg 分段精准 seek 提取：每段独立 seek 取少量帧，跳过无用区间
// segments: [{ seekTime, framesNeeded }] — 每个段的起始时间和需要的帧数
ipcMain.handle('extract-frames-batch', (event, { filePath, segments, outputDir }) => {
    return new Promise(async (resolve, reject) => {
        if (!filePath) return reject(new Error('extract-frames-batch: no input file'));

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const allFiles = [];

        const extractSegment = (seg, segIndex) => {
            return new Promise((res, rej) => {
                const prefix = `seg${String(segIndex).padStart(4, '0')}`;
                const outputPattern = path.join(outputDir, `${prefix}_frame_%02d.jpg`);

                ffmpeg(filePath)
                    .seekInput(seg.seekTime)
                    .outputOptions([
                        `-vframes ${seg.framesNeeded}`,
                        '-q:v 2',
                        '-an'
                    ])
                    .output(outputPattern)
                    .on('end', () => {
                        try {
                            const files = fs.readdirSync(outputDir)
                                .filter(f => f.startsWith(prefix) && f.endsWith('.jpg'))
                                .sort()
                                .map(f => path.join(outputDir, f));
                            res(files);
                        } catch (readErr) {
                            rej(new Error(`Failed to read segment ${segIndex} frames: ${readErr.message}`));
                        }
                    })
                    .on('error', (err, stdout, stderr) => {
                        // 单段失败不中断整体，返回空数组
                        console.error(`Segment ${segIndex} extract failed: ${err.message}`);
                        res([]);
                    })
                    .run();
            });
        };

        try {
            for (let i = 0; i < segments.length; i++) {
                const files = await extractSegment(segments[i], i);
                allFiles.push(...files);
            }
            resolve(allFiles);
        } catch (err) {
            reject(new Error(`extract-frames-batch failed: ${err.message}`));
        }
    });
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
