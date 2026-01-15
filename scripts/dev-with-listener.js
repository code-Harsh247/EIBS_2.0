/**
 * Development server startup script
 * Starts Next.js dev server and standalone event listener
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
require('dotenv').config(); // Load environment variables

console.log('🚀 Starting development environment...\n');

// Start Next.js dev server
console.log('📦 Starting Next.js dev server...');
const devServer = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true
});

// Start standalone event listener if enabled
let eventListener = null;
if (process.env.ENABLE_EVENT_LISTENER === 'true') {
  console.log('📡 Starting event listener...\n');
  eventListener = spawn('node', [path.join(__dirname, 'event-listener-standalone.js')], {
    stdio: 'inherit',
    shell: true,
    env: process.env
  });
}

// Wait for server to be ready
let serverPort = null;
let attempts = 0;
const maxAttempts = 30;

const checkServer = setInterval(() => {
  attempts++;
  
  const tryPort = (port) => {
    return new Promise((resolve) => {
      http.get(`http://localhost:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(port);
        } else {
          resolve(null);
        }
      }).on('error', () => {
        resolve(null);
      });
    });
  };

  // Try both common ports
  Promise.all([tryPort(3000), tryPort(3001)])
    .then(([port3000, port3001]) => {
      const detectedPort = port3000 || port3001;
      
      if (detectedPort) {
        clearInterval(checkServer);
        serverPort = detectedPort;
        console.log(`\n✅ Next.js server ready on port ${serverPort}!`);
        console.log('✨ Development environment is ready!\n');
      } else if (attempts >= maxAttempts) {
        clearInterval(checkServer);
        console.log('⚠️  Server did not start in time.');
      }
    });
}, 1000);

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  devServer.kill();
  if (eventListener) {
    eventListener.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  devServer.kill();
  if (eventListener) {
    eventListener.kill();
  }
  process.exit(0);
});
