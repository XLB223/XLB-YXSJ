import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Read JSON store. Corrupt files throw instead of returning empty data
 * (avoids silently wiping production state on the next save).
 */
export function loadJsonStore(filePath, emptyValue) {
  if (!fs.existsSync(filePath)) {
    return typeof emptyValue === "function" ? emptyValue() : structuredClone(emptyValue);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!String(raw || "").trim()) {
    return typeof emptyValue === "function" ? emptyValue() : structuredClone(emptyValue);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(filePath, corruptPath);
    } catch {
      // best-effort backup
    }
    const err = new Error(`数据文件损坏，已备份为 ${path.basename(corruptPath)}，请联系管理员修复后再试`);
    err.status = 500;
    err.code = "STORE_CORRUPT";
    err.cause = error;
    throw err;
  }
}

/** Atomic write: temp file in same dir + rename. */
export function saveJsonStore(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, filePath);
}
