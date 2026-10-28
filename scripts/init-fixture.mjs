import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "fixture-repo");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

if (!existsSync(path.join(root, ".git"))) {
  git("init", "-q");
  git("config", "user.name", "Spur Fixture");
  git("config", "user.email", "fixture@spur.local");
}

git("add", ".");
const hasHead = (() => {
  try {
    git("rev-parse", "--verify", "HEAD");
    return true;
  } catch {
    return false;
  }
})();

if (!hasHead || git("status", "--porcelain")) {
  git("commit", "-q", "-m", hasHead ? "Update fixture" : "Add business-rule fixture");
}

console.log(`Fixture ready at ${git("rev-parse", "--short", "HEAD")}`);
