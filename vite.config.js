import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    base: './', // 关键！改为相对路径，这样打包后的 html 才能直接双击运行
    server: {
        host: '127.0.0.1',
        port: 5173
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    }
});
