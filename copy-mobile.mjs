import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "mobile");
const dest = path.join(root, "dist", "mobile");

fs.cpSync(src, dest, { recursive: true });
console.log("Copied mobile/ to dist/mobile/");
