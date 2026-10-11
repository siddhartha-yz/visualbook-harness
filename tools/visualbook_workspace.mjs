/* Frozen tools keep one owning repository's ignored output boundary. */
import fs from "node:fs";
import path from "node:path";
export function workspaceRoot(toolRoot) {
  toolRoot = path.resolve(toolRoot);
  const manifest = path.join(toolRoot, "toolchain.json");
  if (!fs.existsSync(manifest)) return toolRoot;
  const data = JSON.parse(fs.readFileSync(manifest));
  const owner = path.resolve(data.workspace ?? toolRoot);
  if (owner === toolRoot) return toolRoot;
  if (!toolRoot.startsWith(owner + path.sep + "work" + path.sep) || !fs.existsSync(owner + "/.git"))
    throw Error("Frozen tools must be inside the recorded repository work/ directory");
  return owner;
}
