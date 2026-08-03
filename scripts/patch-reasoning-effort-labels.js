#!/usr/bin/env node
/**
 * 为简体中文推理强度名称补充实际协议参数，并明确 Ultra 的特殊语义。
 *
 * 上游语言包由构建产物生成，文件名包含哈希，直接修改会在下次同步时丢失。
 * 本补丁按稳定的 i18n 消息 ID 定位文本，因此可在每次同步后重复执行。
 *
 * Usage:
 *   node scripts/patch-reasoning-effort-labels.js [platform]
 *   node scripts/patch-reasoning-effort-labels.js --check
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const PLATFORMS = ["mac-arm64", "mac-x64", "win"];

const TRANSLATIONS = Object.freeze({
  "composer.mode.local.reasoning.none.label": "无（none）",
  "composer.mode.local.reasoning.minimal.label": "极低（minimal）",
  "composer.mode.local.reasoning.low.label": "轻度（low）",
  "composer.mode.local.reasoning.medium.label": "中（medium）",
  "composer.mode.local.reasoning.high.label": "高（high）",
  "composer.mode.local.reasoning.xhigh.label": "极高（xhigh）",
  "composer.mode.local.reasoning.max.label": "最高（max）",
  "composer.mode.local.reasoning.ultra.label": "Ultra（ultra）",
  "composer.modelPicker.power.ultraUsageWarning":
    "自动任务委派，更快消耗使用额度",
});

function escapeTemplateLiteral(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function findTemplateLiteralEnd(source, start) {
  for (let index = start; index < source.length; index++) {
    if (source[index] !== "`") continue;

    let backslashes = 0;
    for (let cursor = index - 1; cursor >= start && source[cursor] === "\\"; cursor--) {
      backslashes++;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function findOccurrences(source, marker) {
  const indexes = [];
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    indexes.push(offset);
    offset += marker.length;
  }
  return indexes;
}

function patchSource(source) {
  const patches = [];
  const invalidEntries = [];

  for (const [messageId, translation] of Object.entries(TRANSLATIONS)) {
    const marker = `"${messageId}":\``;
    const occurrences = findOccurrences(source, marker);
    if (occurrences.length !== 1) {
      invalidEntries.push({ messageId, count: occurrences.length });
      continue;
    }

    const start = occurrences[0] + marker.length;
    const end = findTemplateLiteralEnd(source, start);
    if (end === -1) {
      invalidEntries.push({ messageId, count: 0, unterminated: true });
      continue;
    }

    const replacement = escapeTemplateLiteral(translation);
    const original = source.slice(start, end);
    if (original !== replacement) {
      patches.push({ messageId, start, end, original, replacement });
    }
  }

  if (invalidEntries.length > 0) {
    return {
      status: "unexpected-entry-count",
      invalidEntries,
      source,
    };
  }

  if (patches.length === 0) {
    return { status: "already-patched", patches, source };
  }

  let nextSource = source;
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    nextSource =
      nextSource.slice(0, patch.start) +
      patch.replacement +
      nextSource.slice(patch.end);
  }

  try {
    parse(nextSource, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    return { status: "parse-failed", error, patches, source };
  }

  return { status: "patched", patches, source: nextSource };
}

function getPlatforms(platform) {
  if (platform) return [platform];
  return PLATFORMS.filter((item) =>
    fs.existsSync(path.join(SRC_DIR, item, "_asar", "webview", "assets")),
  );
}

function findTargets(platform) {
  const targets = [];
  const invalidPlatforms = [];

  for (const currentPlatform of getPlatforms(platform)) {
    const assetsDir = path.join(
      SRC_DIR,
      currentPlatform,
      "_asar",
      "webview",
      "assets",
    );
    const files = fs
      .readdirSync(assetsDir)
      .filter((file) => /^zh-CN-.*\.js$/.test(file));

    if (files.length !== 1) {
      invalidPlatforms.push({ platform: currentPlatform, count: files.length });
      continue;
    }

    targets.push({
      platform: currentPlatform,
      path: path.join(assetsDir, files[0]),
    });
  }

  return { invalidPlatforms, targets };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((item) => PLATFORMS.includes(item));
  const { invalidPlatforms, targets } = findTargets(platform);
  let failed = invalidPlatforms.length;
  let changed = 0;

  for (const item of invalidPlatforms) {
    console.log(
      `  [x] ${item.platform}: expected 1 zh-CN bundle, found ${item.count}`,
    );
  }

  if (targets.length === 0 && invalidPlatforms.length === 0) {
    console.log("  [skip] No generated platform sources found");
    return;
  }

  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf-8");
    const result = patchSource(source);
    const label = relPath(target.path);

    if (result.status === "already-patched") {
      console.log(`  [ok] ${label}: already patched`);
      continue;
    }

    if (result.status === "unexpected-entry-count") {
      for (const entry of result.invalidEntries) {
        const reason = entry.unterminated
          ? "unterminated template literal"
          : `expected 1 entry, found ${entry.count}`;
        console.log(`  [x] ${label}: ${entry.messageId}: ${reason}`);
      }
      failed++;
      continue;
    }

    if (result.status === "parse-failed") {
      console.log(`  [x] ${label}: post-patch parse failed: ${result.error.message}`);
      failed++;
      continue;
    }

    if (isCheck) {
      console.log(
        `  [?] ${label}: would update ${result.patches.length} translation(s)`,
      );
    } else {
      fs.writeFileSync(target.path, result.source, "utf-8");
      console.log(
        `  [ok] ${label}: updated ${result.patches.length} translation(s)`,
      );
    }
    changed++;
  }

  console.log(
    `  [done] ${isCheck ? "would patch" : "patched"} ${changed} file(s)`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { TRANSLATIONS, findTargets, patchSource };
