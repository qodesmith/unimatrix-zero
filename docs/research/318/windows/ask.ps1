# Test for #318, route B: the AI's command asks the broker (broker.ps1) to run
# one command with admin rights, and prints what comes back.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ask.ps1 -Command "net session"
param([Parameter(Mandatory)][string]$Command)

$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'uz318', 'InOut')
try {
  $pipe.Connect(5000)
} catch {
  Write-Output "uz318 ask: can't reach the broker: $($_.Exception.Message)"
  exit 1
}

$writer = New-Object System.IO.StreamWriter($pipe)
$writer.WriteLine($Command)
$writer.Flush()
Write-Output (New-Object System.IO.StreamReader($pipe)).ReadToEnd()
$pipe.Dispose()
