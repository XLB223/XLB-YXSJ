import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

function copyDir(name) {
  const src = path.join(root, name);
  const dest = path.join(dist, name);
  if (!fs.existsSync(src)) {
    console.warn(`Skip missing folder: ${name}`);
    return;
  }
  fs.mkdirSync(dist, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Copied ${name}/ to dist/${name}/`);
}

copyDir("mobile");
copyDir("assets");
