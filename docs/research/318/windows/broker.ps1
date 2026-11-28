# Test for #318, route B: stands in for the app. Run it yourself in a normal
# (not elevated) PowerShell window, outside any Sandbox, and leave it open:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File broker.ps1
#
# ask.ps1, run by the AI, sends one command over a named pipe. The broker shows
# a Yes/No box (the stand-in for the app's card), then runs the command through
# elevate.ps1, so UAC comes second, and sends the output back.
Add-Type -AssemblyName System.Windows.Forms
$elevate = Join-Path $PSScriptRoot 'elevate.ps1'

while ($true) {
  $pipe = New-Object System.IO.Pipes.NamedPipeServerStream('uz318', 'InOut')
  Write-Host "$(Get-Date -Format HH:mm:ss) waiting on \\.\pipe\uz318"
  $pipe.WaitForConnection()
  $reader = New-Object System.IO.StreamReader($pipe)
  $writer = New-Object System.IO.StreamWriter($pipe)
  $command = $reader.ReadLine()
  Write-Host "$(Get-Date -Format HH:mm:ss) asked: $command"

  $answer = [System.Windows.Forms.MessageBox]::Show(
    "The AI wants to run this command with full control of this computer:`n`n$command",
    'Unimatrix Zero #318 test card', 'YesNo', 'Warning')

  if ($answer -eq 'Yes') {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $elevate -Command $command | Out-String
  } else {
    $output = "uz318 broker: denied on the card`n"
  }

  Write-Host "$(Get-Date -Format HH:mm:ss) card: $answer"
  $writer.Write($output)
  $writer.Flush()
  $pipe.Dispose()
}
