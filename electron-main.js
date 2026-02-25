const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const os = require('os');
const fs = require('fs');

// Handling dev vs packed paths for ffmpeg/ffprobe
const fixPath = (p) => p ? p.replace('app.asar', 'app.asar.unpacked') : '';
ffmpeg.setFfmpegPath(fixPath(ffmpegPath));
if (ffprobePath && ffprobePath.path) {
    ffmpeg.setFfprobePath(fixPath(ffprobePath.path));
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

    // Always load the built file since our 'dev' script is "vite build && electron ."
    // This allows us to see changes without running a separate dev server.
    win.loadFile(path.join(__dirname, 'dist/index.html'));

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
    return new Promise((resolve, reject) => {
        if (!filePath) return reject(new Error("No input specified"));
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            const stream = metadata.streams.find(s => s.codec_type === 'video');
            let fps = 30; // default
            if (stream && stream.r_frame_rate) {
                const parts = stream.r_frame_rate.split('/');
                if (parts.length === 2 && parts[1] !== '0') {
                    fps = parseInt(parts[0]) / parseInt(parts[1]);
                } else if (parts.length === 1) {
                    fps = parseFloat(parts[0]);
                }
            }
            resolve({
                duration: metadata.format.duration,
                fps,
                width: stream ? stream.width : 0,
                height: stream ? stream.height : 0
            });
        });
    });
});

ipcMain.handle('process-media', (event, filePath) => {
    return new Promise((resolve, reject) => {
        if (!filePath) {
            console.error("Empty filePath received in process-media");
            return reject(new Error("No path specified for media processing"));
        }

        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error("FFprobe Error:", err);
                return reject(err);
            }

            const vStream = metadata.streams.find(s => s.codec_type === 'video');
            const aStream = metadata.streams.find(s => s.codec_type === 'audio');
            const vCodec = vStream ? (vStream.codec_name || '').toLowerCase() : '';
            const aCodec = aStream ? (aStream.codec_name || '').toLowerCase() : '';

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
            } else if (aStream) {
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
