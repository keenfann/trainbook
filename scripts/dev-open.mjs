import { exec } from 'child_process';

const shouldSkip =
  process.env.CI === 'true'
  || process.env.TRAINBOOK_SKIP_OPEN === 'true'
  || !process.stdout.isTTY;

if (shouldSkip) {
  process.exit(0);
}

const port = process.env.VITE_PORT || '5173';
const url = `http://localhost:${port}`;

if (process.platform !== 'darwin' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  process.exit(0);
}

const commands = [];

if (process.platform === 'darwin') {
  commands.push(`open -a "Google Chrome" ${url}`, `open ${url}`);
} else if (process.platform === 'win32') {
  commands.push(`start "" ${url}`);
} else {
  commands.push(`xdg-open ${url}`);
}

const command = commands.find(Boolean);

if (!command) {
  process.exit(0);
}

setTimeout(() => {
  const child = exec(command, () => {
    process.exit(0);
  });
  child.on('error', () => {
    process.exit(0);
  });
}, 1200);
