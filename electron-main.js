const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

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
