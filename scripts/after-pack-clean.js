const fs = require('fs');
const path = require('path');

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const unpackedNodeModules = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');

  const ffmpegBase = path.join(unpackedNodeModules, 'ffmpeg-static');
  safeRemove(path.join(ffmpegBase, 'example.js'));
  safeRemove(path.join(ffmpegBase, 'install.js'));
};
