const fs = require('fs');
const path = require('path');

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const unpackedNodeModules = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');

  const ffprobeBase = path.join(unpackedNodeModules, 'ffprobe-static', 'bin');
  safeRemove(path.join(ffprobeBase, 'darwin'));
  safeRemove(path.join(ffprobeBase, 'linux'));
  safeRemove(path.join(ffprobeBase, 'win32', 'ia32'));

  const ffmpegBase = path.join(unpackedNodeModules, 'ffmpeg-static');
  safeRemove(path.join(ffmpegBase, 'example.js'));
  safeRemove(path.join(ffmpegBase, 'install.js'));

  const ffprobeRoot = path.join(unpackedNodeModules, 'ffprobe-static');
  safeRemove(path.join(ffprobeRoot, 'README.md'));
  safeRemove(path.join(ffprobeRoot, 'tests'));
};
