const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const stageDir = path.join(rootDir, 'staging_zip', 'healthcare-appointment-manager');
const zipOutput = path.join(rootDir, 'healthcare-appointment-manager-source.zip');

// Clean previous staging and zip
if (fs.existsSync(path.join(rootDir, 'staging_zip'))) {
  fs.rmSync(path.join(rootDir, 'staging_zip'), { recursive: true, force: true });
}
if (fs.existsSync(zipOutput)) {
  fs.unlinkSync(zipOutput);
}

fs.mkdirSync(stageDir, { recursive: true });

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dev.db',
  'dev.db-journal',
  'dist',
  '.env',
  'staging_zip',
  'create_zip.js',
  'healthcare-appointment-manager-source.zip',
];

function copyFolderSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((element) => {
    if (IGNORE_PATTERNS.includes(element)) return;
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    const stat = fs.statSync(fromPath);
    if (stat.isFile()) {
      fs.copyFileSync(fromPath, toPath);
    } else if (stat.isDirectory()) {
      copyFolderSync(fromPath, toPath);
    }
  });
}

console.log('Staging clean project files...');
copyFolderSync(rootDir, stageDir);

console.log('Creating ZIP archive...');
const psCommand = `powershell -Command "Compress-Archive -Path '${path.join(rootDir, 'staging_zip', 'healthcare-appointment-manager')}' -DestinationPath '${zipOutput}' -Force"`;
execSync(psCommand, { stdio: 'inherit' });

// Clean staging directory
fs.rmSync(path.join(rootDir, 'staging_zip'), { recursive: true, force: true });

const stats = fs.statSync(zipOutput);
console.log(`\n🎉 ZIP Package created successfully!`);
console.log(`Path: ${zipOutput}`);
console.log(`Size: ${(stats.size / 1024).toFixed(2)} KB`);
