import { exec } from 'child_process';

const shouldSkip =
  process.env.CI === 'true' || process.env.TRAINBOOK_SKIP_OPEN === 'true';

if (shouldSkip) {
  process.exit(0);
}

const port = process.env.VITE_PORT || '5173';
const url = `http://localhost:${port}`;

if (process.platform !== 'darwin' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  process.exit(0);
}

const runCommand = (command) =>
  new Promise((resolve) => {
    exec(command, (error) => {
      resolve(!error);
    });
  });

const commands = [];

if (process.platform === 'darwin') {
  commands.push(`open -a "Google Chrome" "${url}"`, `open -b "com.google.Chrome" "${url}"`);
} else if (process.platform === 'win32') {
  commands.push(`start "" "${url}"`);
} else {
  commands.push(`xdg-open "${url}"`);
}

if (commands.length === 0) {
  process.exit(0);
}

setTimeout(() => {
  Promise.resolve(
    (async () => {
      for (const command of commands) {
        if (await runCommand(command)) {
          break;
        }
      }
    })(),
  )
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}, 1200);
