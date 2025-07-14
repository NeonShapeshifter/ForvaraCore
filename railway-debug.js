#!/usr/bin/env node

// Railway deployment debugging script
console.log('🚀 ================= RAILWAY DEBUG INFO =================');
console.log(`⏰ Debug Time: ${new Date().toISOString()}`);

// Environment Info
console.log('\n📋 ENVIRONMENT VARIABLES:');
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`PORT: ${process.env.PORT || 'undefined'}`);
console.log(`RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT || 'undefined'}`);
console.log(`RAILWAY_PROJECT_NAME: ${process.env.RAILWAY_PROJECT_NAME || 'undefined'}`);
console.log(`RAILWAY_SERVICE_NAME: ${process.env.RAILWAY_SERVICE_NAME || 'undefined'}`);
console.log(`RAILWAY_PUBLIC_DOMAIN: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'undefined'}`);

// Process Info
console.log('\n🔧 PROCESS INFO:');
console.log(`Node Version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log(`Memory Usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
console.log(`Current Working Directory: ${process.cwd()}`);

// Network Info
console.log('\n🌐 NETWORK INFO:');
const os = require('os');
const interfaces = os.networkInterfaces();
Object.keys(interfaces).forEach(name => {
  interfaces[name].forEach(iface => {
    if (iface.family === 'IPv4') {
      console.log(`${name}: ${iface.address} (internal: ${iface.internal})`);
    }
  });
});

// File System Info
console.log('\n📁 FILE SYSTEM:');
const fs = require('fs');
try {
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`Package Name: ${packageJson.name}`);
  console.log(`Package Version: ${packageJson.version}`);
  console.log(`Start Script: ${packageJson.scripts?.start || 'undefined'}`);
} catch (e) {
  console.log('Could not read package.json');
}

// Check if built files exist
console.log('\n🔍 BUILD FILES:');
const distExists = fs.existsSync('./dist');
console.log(`dist/ directory exists: ${distExists}`);
if (distExists) {
  const distFiles = fs.readdirSync('./dist');
  console.log(`dist/ files: ${distFiles.join(', ')}`);
}

// Test health endpoint availability
console.log('\n🩺 HEALTH ENDPOINT TEST:');
const http = require('http');
const port = process.env.PORT || 4000;

const testHealth = () => {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: '/api/health',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      console.log(`Health endpoint status: ${res.statusCode}`);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Health response: ${data.substring(0, 100)}...`);
        resolve(true);
      });
    });
    
    req.on('error', (err) => {
      console.log(`Health endpoint error: ${err.message}`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.log('Health endpoint timeout');
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
};

// Check if server is running
setTimeout(async () => {
  await testHealth();
  console.log('\n========================================================');
}, 2000);

console.log('\n========================================================');