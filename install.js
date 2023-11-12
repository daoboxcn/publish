"use strict";
const Downloader = require("nodejs-file-downloader");
// const decompress = require("decompress");

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};

// lib/npm/node-platform.ts
var fs = require("fs");
var os = require("os");
var path = require("path");

var knownWindowsPackages = {
  //   "win32 arm64": "@esbuild/win32-arm64",
  //   "win32 ia32": "@esbuild/win32-ia32",
  "win32 x64": "windows-amd64.zip",
};
var knownUnixlikePackages = {
  //   "android arm64": "@esbuild/android-arm64",
  //   "darwin arm64": "@esbuild/darwin-arm64",
  "darwin arm64": "darwin-universal.zip",
  "darwin x64": "darwin-universal.zip",
  //   "freebsd arm64": "@esbuild/freebsd-arm64",
  //   "freebsd x64": "@esbuild/freebsd-x64",
  //   "linux arm": "@esbuild/linux-arm",
  //   "linux arm64": "@esbuild/linux-arm64",
  //   "linux ia32": "@esbuild/linux-ia32",
  //   "linux mips64el": "@esbuild/linux-mips64el",
  //   "linux ppc64": "@esbuild/linux-ppc64",
  //   "linux riscv64": "@esbuild/linux-riscv64",
  //   "linux s390x BE": "@esbuild/linux-s390x",
  "linux x64": "linux-amd64.zip",
  //   "linux loong64": "@esbuild/linux-loong64",
  //   "netbsd x64": "@esbuild/netbsd-x64",
  //   "openbsd x64": "@esbuild/openbsd-x64",
  //   "sunos x64": "@esbuild/sunos-x64",
};

// 返回可执行文件信息
function pkgAndSubpathForCurrentPlatform() {
  let pkg;
  let binName;
  let platformKey = `${process.platform} ${os.arch()}`;
  if (platformKey in knownWindowsPackages) {
    pkg = knownWindowsPackages[platformKey];
    binName = "everkm-publish.exe";
  } else if (platformKey in knownUnixlikePackages) {
    pkg = knownUnixlikePackages[platformKey];
    binName = "everkm-publish.bin";
  } else {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }
  return { pkg, binName };
}

// lib/npm/node-install.ts
var fs2 = require("fs");
var os2 = require("os");
var path2 = require("path");
var zlib = require("zlib");
var AdmZip = require("adm-zip");
const tar = require("tar");
var https = require("https");
var http = require("http");
var child_process = require("child_process");
var versionFromPackageJSON = require(path2.join(
  __dirname,
  "package.json"
)).version;
var toPath = path2.join(
  __dirname,
  "bin",
  pkgAndSubpathForCurrentPlatform().binName
);

function validateBinaryVersion(...command) {
  command.push("--version");
  let stdout;
  try {
    stdout = child_process
      .execFileSync(command.shift(), command, {
        // Without this, this install script strangely crashes with the error
        // "EACCES: permission denied, write" but only on Ubuntu Linux when node is
        // installed from the Snap Store. This is not a problem when you download
        // the official version of node. The problem appears to be that stderr
        // (i.e. file descriptor 2) isn't writable?
        //
        // More info:
        // - https://snapcraft.io/ (what the Snap Store is)
        // - https://nodejs.org/dist/ (download the official version of node)
        // - https://github.com/evanw/esbuild/issues/1711#issuecomment-1027554035
        //
        stdio: "pipe",
      })
      .toString()
      .trim()
      .split(" ")[1];
  } catch (err) {
    if (
      os2.platform() === "darwin" &&
      /_SecTrustEvaluateWithError/.test(err + "")
    ) {
      let os3 = "this version of macOS";
      try {
        os3 =
          "macOS " +
          child_process
            .execFileSync("sw_vers", ["-productVersion"])
            .toString()
            .trim();
      } catch {}
      throw new Error(`The "everkm-publish" package cannot be installed because ${os3} is too outdated.

The "everkm-publish" binary executable can't be run. 
`);
    }
    throw err;
  }

  if (stdout !== versionFromPackageJSON) {
    throw new Error(
      `Expected ${JSON.stringify(
        versionFromPackageJSON
      )} but got ${JSON.stringify(stdout)}`
    );
  }
}

function isYarn() {
  const { npm_config_user_agent } = process.env;
  if (npm_config_user_agent) {
    return /\byarn\//.test(npm_config_user_agent);
  }
  return false;
}

function deleteDirectory(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach((file, index) => {
      const currentPath = path + "/" + file;
      if (fs.lstatSync(currentPath).isDirectory()) {
        // 递归删除子目录
        deleteDirectory(currentPath);
      } else {
        // 删除文件
        fs.unlinkSync(currentPath);
      }
    });
    // 删除目录本身
    fs.rmdirSync(path);
    console.log(`Successfully removed directory ${path}`);
  } else {
    console.log(`Directory ${path} does not exist`);
  }
}

// 对指定目录进行遍历
function traverseDirectory(directory) {
  const fileList = [];
  const files = fs.readdirSync(directory);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fileList.push(...traverseDirectory(filePath));
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

async function downloadBinary(pkg, binName) {
  const binaryDist = (process.env.EVERKM_PUBLISH_BINARY || "").replace(
    /\/$/,
    ""
  );
  let fileUrl = `https://github.com/everkm/publish/releases/download/everkm-publish%40v${versionFromPackageJSON}/EverkmPublish_${versionFromPackageJSON}_${pkg}`;
  if (binaryDist) {
    // fileUrl = `https://assets.daobox.cc/everkm-publish/stable/${versionFromPackageJSON}/EverkmPublish_${versionFromPackageJSON}_${pkg}`;
    fileUrl = `${binaryDist}/${versionFromPackageJSON}/EverkmPublish_${versionFromPackageJSON}_${pkg}`;
  }
  // const fileUrl = "http://localhost:8000/daobox/everkm-publish.zip";
  const filename = path.join(__dirname, "bin", pkg);
  const dest = path.dirname(filename);
  console.log("download everkm publish binary:", fileUrl);

  const proxy =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;
  console.log("use proxy", proxy);

  const params = {
    url: fileUrl,
    directory: dest,
    cloneFiles: false,
  };
  if (proxy) {
    params.proxy = proxy;
  }
  const downloader = new Downloader(params);

  try {
    const { filePath, downloadStatus } = await downloader.download(); //Downloader.download() resolves with some useful properties.
    const stats = fs.statSync(filePath);

    console.log(`File saved as ${filePath}, size: ${stats.size} bytes`);
    const filename = filePath;

    return new Promise((resolve, reject) => {
      const extractDir = path.join(dest, "download");
      // 判断目录是否存在，不存在则创建
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true }, function (err) {
          if (err) {
            return reject(err);
          }
        });
      }

      const extractFinish = () => {
        // 最终BIN文件名
        const binFile = path.join(dest, binName);
        //   console.log("final bin name", binFile);
        //   console.log("extract dir", extractDir);

        // 迁移bin文件到可执行目录
        const files = traverseDirectory(extractDir);

        // 打印所有文件
        console.log("files", files);

        files.some(function (file) {
          const arr = file.split("/");
          if (!/^everkm\-publish/.test(arr[arr.length - 1])) {
            return false;
          }

          // 使用 fs.rename 方法将文件从源路径移动到目标路径
          fs.renameSync(file, binFile, function (err) {
            if (err) {
              throw err;
            }
          });

          return true;
        });

        deleteDirectory(extractDir);
        fs2.unlinkSync(filename);

        fs2.chmodSync(binFile, 493);
      };

      // 解压缩
      // decompress(filename, extractDir)
      //   .then((files) => {
      //     console.log("extract done,", files);
      //     extractFinish();
      //   })
      //   .catch((err) => {
      //     reject(err);
      //   });

      // if (/\.tar\.gz$/.test(filename)) {
      //   const readStream = fs.createReadStream(filename);
      //   const unzip = zlib.createGunzip(); // 创建 gunzip 解压缩流
      //   const untar = tar.x({
      //     sync: true,
      //     C: extractDir, // alias for cwd:'some-dir', also ok
      //   }); // 创建 tar 解压缩流

      //   readStream
      //     .pipe(unzip) // 使用 gunzip 解压缩流
      //     .pipe(untar) // 使用 tar 解压缩流
      //     .on("error", (err) => {
      //       console.error(err);
      //     })
      //     .on("finish", () => {
      //       //   console.log("解压缩完成", filename, extractDir);

      //       try {
      //         extractFinish();
      //         resolve();
      //       } catch (err) {
      //         reject(err);
      //       }
      //     });
      // } else if (/\.zip$/.test(filename)) {
      const zip = new AdmZip(filename); // 指定 ZIP 文件路径
      zip.extractAllTo(extractDir, true); // 解压 ZIP 文件到指定目录
      try {
        extractFinish();
        resolve();
      } catch (err) {
        reject(err);
      }
      // } else {
      //   reject(`not support archive package: ${pkg}`);
      // }
    });
  } catch (error) {
    //IMPORTANT: Handle a possible error. An error is thrown in case of network errors, or status codes of 400 and above.
    //Note that if the maxAttempts is set to higher than 1, the error is thrown only if all attempts fail.
    console.error("download failed", error);
  }

  return new Promise((resolve, reject) => {
    https.get(fileUrl, (response) => {
      const fileStream = fs.createWriteStream(filename);
      response.pipe(fileStream);
      fileStream.on("finish", () => {});
      fileStream.on("error", (e) => {
        reject(e);
      });
    });
  });
}

async function checkAndPreparePackage() {
  const { pkg, binName } = pkgAndSubpathForCurrentPlatform();
  try {
    await downloadBinary(pkg, binName);
  } catch (e3) {
    console.error("error", e3);
    throw new Error(`Failed to install package "${pkg}"`);
  }
}

checkAndPreparePackage().then(() => {
  validateBinaryVersion(toPath);
});
