param(
    [int]$Port = 8188,
    [Int64]$JobMemoryLimitGiB = 40
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = "E:\OSTORY-GPU\ComfyUI-Music3"
$PythonExe = Join-Path $Root "python_embeded\python.exe"
$MainPy = Join-Path $Root "ComfyUI\main.py"
$CleanupScript = Join-Path $PSScriptRoot "windows_gpu_cleanup_port.ps1"
$PreferredLogRoot = "D:\OSTORY-GPU-Logs"
$FallbackLogRoot = "E:\OSTORY-GPU\logs"
$LogRoot = if (Test-Path -LiteralPath "D:\") { $PreferredLogRoot } else { $FallbackLogRoot }
$StdoutLog = Join-Path $LogRoot ("comfyui-music3-{0}.log" -f $Port)
$StderrLog = Join-Path $LogRoot ("comfyui-music3-{0}.error.log" -f $Port)
$LlamaSource = Join-Path $Root "ComfyUI\comfy\text_encoders\llama.py"

if (-not (Test-Path -LiteralPath $PythonExe)) { throw "Missing Music3 Python: $PythonExe" }
if (-not (Test-Path -LiteralPath $MainPy)) { throw "Missing Music3 ComfyUI: $MainPy" }
if (-not (Test-Path -LiteralPath $CleanupScript)) { throw "Missing cleanup script: $CleanupScript" }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
if (-not (Select-String -LiteralPath $LlamaSource -SimpleMatch "OSTORY_MUSIC3_DISABLE_FLASH_DECODE" -Quiet)) {
    throw "Music3 Flash-Attention compatibility patch is not installed: $LlamaSource"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CleanupScript `
    -Port $Port -PythonExe $PythonExe -CommandMatch $MainPy -LogFile $StdoutLog
if ($LASTEXITCODE -ne 0) { throw "Port $Port cannot be prepared safely (exit $LASTEXITCODE)" }

if (-not ("Ostory.JobMemory" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Ostory {
    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public Int64 PerProcessUserTimeLimit;
        public Int64 PerJobUserTimeLimit;
        public UInt32 LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public UInt32 ActiveProcessLimit;
        public UIntPtr Affinity;
        public UInt32 PriorityClass;
        public UInt32 SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public UInt64 ReadOperationCount;
        public UInt64 WriteOperationCount;
        public UInt64 OtherOperationCount;
        public UInt64 ReadTransferCount;
        public UInt64 WriteTransferCount;
        public UInt64 OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    public static class JobMemory {
        const UInt32 JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
        const UInt32 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr info, UInt32 length);
        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        public static IntPtr CreateAndAssign(IntPtr processHandle, UInt64 limitBytes) {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            info.JobMemoryLimit = (UIntPtr)limitBytes;
            int size = Marshal.SizeOf(info);
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(info, ptr, false);
                if (!SetInformationJobObject(job, 9, ptr, (UInt32)size))
                    throw new System.ComponentModel.Win32Exception();
                if (!AssignProcessToJobObject(job, processHandle))
                    throw new System.ComponentModel.Win32Exception();
                return job;
            } catch {
                CloseHandle(job);
                throw;
            } finally {
                Marshal.FreeHGlobal(ptr);
            }
        }

        public static void Close(IntPtr handle) {
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }
}
"@
}

$arguments = @(
    "-s", $MainPy,
    "--listen", "0.0.0.0",
    "--port", "$Port",
    "--lowvram",
    "--preview-method", "none",
    "--disable-auto-launch"
)
$env:OSTORY_MUSIC3_DISABLE_FLASH_DECODE = "1"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$stamp] Starting Music3 runtime on port=$Port with job_limit=${JobMemoryLimitGiB}GiB" |
    Out-File -FilePath $StdoutLog -Append -Encoding UTF8
$process = Start-Process -FilePath $PythonExe -ArgumentList $arguments -WorkingDirectory $Root `
    -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
$job = [Ostory.JobMemory]::CreateAndAssign($process.Handle, [UInt64]($JobMemoryLimitGiB * 1GB))
try {
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    [Ostory.JobMemory]::Close($job)
}
