import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // 关键！改为相对路径，这样打包后的 html 才能直接双击运行
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    }
});
