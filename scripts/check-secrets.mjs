import fs from "node:fs";
import { execFileSync } from "node:child_process";
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
const localSecrets = [];
if (fs.existsSync(".env.local"))
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]*(?:TOKEN|SECRET|KEY)[^=]*)=(.+)$/);
    if (m) {
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (value.length >= 24) localSecrets.push(value);
    }
  }
const problems = [];
for (const file of files) {
  if (
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory() ||
    /\.(mp3|wav|jpe?g|png|woff2?)$/i.test(file)
  )
    continue;
  const text = fs.readFileSync(file, "utf8");
  if (
    patterns.some((p) => p.test(text)) ||
    localSecrets.some((s) => text.includes(s))
  )
    problems.push(file);
  if (/(^|\/)\.env(\.|$)/.test(file) && file !== ".env.example")
    problems.push(file);
}
if (problems.length) {
  console.error(
    "Possible credential files: " + [...new Set(problems)].join(", "),
  );
  process.exit(1);
}
console.log(
  `Secret scan passed: ${files.length} publishable files; local credentials excluded.`,
);
