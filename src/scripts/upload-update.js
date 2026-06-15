// scripts/upload-update.js
// Run: node scripts/upload-update.js
// Copy built electron files to backend/updates/ folder

const fs = require("fs");
const path = require("path");

// ── Change this to your electron project path ──
const ELECTRON_DIST = path.join(__dirname, "../../hrms-desktop-agent/dist");
const UPDATES_DIR = path.join(__dirname, "../updates");

const FILES_TO_COPY = [
    "latest.yml",
    // EXE name must match your productName in package.json
];

// Auto-find .exe and .blockmap files
const distFiles = fs.readdirSync(ELECTRON_DIST);
distFiles.forEach(file => {
    if (
        file.endsWith(".exe") ||
        file.endsWith(".blockmap") ||
        file === "latest.yml"
    ) {
        FILES_TO_COPY.push(file);
    }
});

// Ensure updates dir exists
if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
}

// Copy files
const uniqueFiles = [...new Set(FILES_TO_COPY)];
uniqueFiles.forEach(file => {
    const src = path.join(ELECTRON_DIST, file);
    const dest = path.join(UPDATES_DIR, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
        console.log(`✅ Copied: ${file} (${size} MB)`);
    } else {
        console.warn(`⚠️  Not found: ${file}`);
    }
});