const { existsSync } = require("fs");
const { spawn } = require("child_process");
const { join } = require("path");

const localAppData = process.env.LOCALAPPDATA;
const androidSdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(localAppData || "", "Android", "Sdk");
const emulatorPath = join(androidSdkPath, "emulator", "emulator.exe");
const adbPath = join(androidSdkPath, "platform-tools", "adb.exe");
const expoCliPath = join(process.cwd(), "node_modules", "expo", "bin", "cli");

if (!existsSync(emulatorPath) || !existsSync(adbPath) || !existsSync(expoCliPath)) {
  console.error("Android SDK tools were not found.");
  console.error(`Expected SDK location: ${androidSdkPath}`);
  console.error("Install Android Emulator and Android SDK Platform-Tools from Android Studio > SDK Manager.");
  process.exit(1);
}

const pathEntries = [join(androidSdkPath, "emulator"), join(androidSdkPath, "platform-tools"), process.env.PATH].filter(Boolean);
const child = spawn(process.execPath, [expoCliPath, "start", "--android"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ANDROID_HOME: androidSdkPath,
    ANDROID_SDK_ROOT: androidSdkPath,
    PATH: pathEntries.join(";"),
  },
  shell: false,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code || 0));
