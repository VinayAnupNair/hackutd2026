/**
 * Next.js calls os.networkInterfaces() to print a LAN URL. On some macOS /
 * sandboxed environments that syscall throws and kills `next dev`.
 * Wrap it so startup keeps working on localhost.
 */
const fs = require("fs");
const path = require("path");

const targets = [
  "node_modules/next/dist/lib/get-network-host.js",
  "node_modules/next/dist/esm/lib/get-network-host.js",
];

const MARKER = "/* clash-agents-network-patch */";

const PATCHED = `${MARKER}
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "getNetworkHost", {
  enumerable: true,
  get: function () {
    return getNetworkHost;
  },
});
const _os = /*#__PURE__*/ require("os");
function getNetworkHosts(family) {
  let interfaces;
  try {
    interfaces = (_os.default || _os).networkInterfaces();
  } catch {
    return family === "IPv4" ? ["127.0.0.1"] : [];
  }
  const hosts = [];
  if (!interfaces) {
    return family === "IPv4" ? ["127.0.0.1"] : [];
  }
  Object.keys(interfaces).forEach((key) => {
    var _interfaces_key;
    (_interfaces_key = interfaces[key]) == null
      ? void 0
      : _interfaces_key
          .filter((networkInterface) => {
            switch (networkInterface.family) {
              case "IPv6":
                return (
                  family === "IPv6" &&
                  networkInterface.scopeid === 0 &&
                  networkInterface.address !== "::1"
                );
              case "IPv4":
                return (
                  family === "IPv4" &&
                  networkInterface.address !== "127.0.0.1"
                );
              default:
                return false;
            }
          })
          .forEach((networkInterface) => {
            if (networkInterface.address) {
              hosts.push(networkInterface.address);
            }
          });
  });
  if (!hosts.length && family === "IPv4") return ["127.0.0.1"];
  return hosts;
}
function getNetworkHost(family) {
  const hosts = getNetworkHosts(family);
  return hosts[0] ?? null;
}
`;

const PATCHED_ESM = `${MARKER}
import os from "os";
function getNetworkHosts(family) {
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return family === "IPv4" ? ["127.0.0.1"] : [];
  }
  const hosts = [];
  if (!interfaces) {
    return family === "IPv4" ? ["127.0.0.1"] : [];
  }
  Object.keys(interfaces).forEach((key) => {
    interfaces[key]
      ?.filter((networkInterface) => {
        switch (networkInterface.family) {
          case "IPv6":
            return (
              family === "IPv6" &&
              networkInterface.scopeid === 0 &&
              networkInterface.address !== "::1"
            );
          case "IPv4":
            return (
              family === "IPv4" && networkInterface.address !== "127.0.0.1"
            );
          default:
            return false;
        }
      })
      .forEach((networkInterface) => {
        if (networkInterface.address) {
          hosts.push(networkInterface.address);
        }
      });
  });
  if (!hosts.length && family === "IPv4") return ["127.0.0.1"];
  return hosts;
}
export function getNetworkHost(family) {
  const hosts = getNetworkHosts(family);
  return hosts[0] ?? null;
}
`;

for (const rel of targets) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) continue;
  const current = fs.readFileSync(file, "utf8");
  if (current.includes(MARKER)) continue;
  const isEsm = rel.includes(`${path.sep}esm${path.sep}`) || rel.includes("/esm/");
  fs.writeFileSync(file, isEsm ? PATCHED_ESM : PATCHED);
  console.log(`patched ${rel}`);
}
