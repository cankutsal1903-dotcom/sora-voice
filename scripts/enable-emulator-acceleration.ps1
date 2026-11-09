$ErrorActionPreference = "Stop"

$logPath = Join-Path $PSScriptRoot "android-emulator-acceleration.log"
Start-Transcript -Path $logPath -Append

try {
  & dism.exe /Online /Enable-Feature /FeatureName:HypervisorPlatform /All /NoRestart
  & dism.exe /Online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart
  & bcdedit.exe /set hypervisorlaunchtype auto

  Write-Host "Android emulator acceleration is enabled. Restart Windows to apply the changes."
  exit 0
}
finally {
  Stop-Transcript
}
