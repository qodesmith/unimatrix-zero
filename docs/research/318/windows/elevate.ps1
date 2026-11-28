# Test for #318, route A: the AI's own command asks Windows for admin rights.
# Runs one command elevated through UAC and prints its output and exit code.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File elevate.ps1 net session
#
# The command is every argument, joined, so it needs no quotes: nested quotes
# got lost on the way from the AI's shell. An elevated process can't share this
# one's output, so it writes to a file, and adds its integrity level (High is
# S-1-16-12288).
param([Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$Words)

$Command = $Words -join ' '

$out = Join-Path $env:TEMP "uz318-$PID-$(Get-Random).txt"
$inner = "& { $Command } *> '$out'; `"uz318 inner exit: `$LASTEXITCODE`" >> '$out'; " +
  "whoami /groups | findstr S-1-16 >> '$out'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
$started = Get-Date

try {
  $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded `
    -ErrorAction Stop
} catch {
  Write-Output "uz318 elevate: not started after $([int]((Get-Date) - $started).TotalSeconds)s: $($_.Exception.Message)"
  exit 1223
}

if (Test-Path $out) {
  Get-Content $out
  Remove-Item $out
} else {
  Write-Output "uz318 elevate: the elevated command left no output file at $out"
}
Write-Output "uz318 elevate: process exit code [$($process.ExitCode)] after $([int]((Get-Date) - $started).TotalSeconds)s"
