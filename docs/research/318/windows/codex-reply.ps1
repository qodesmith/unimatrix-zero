# Test for #318: one Reply from Codex's app-server, started with the app's own
# arguments, with no dev app. Prints each command the AI runs with its output,
# and the AI's text. Approval requests are accepted and printed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File codex-reply.ps1 `
#     -Server <codex-app-server.exe> -CodexHome <folder> -Prompt "..." [-Mode supervised]
#
# -Mode full is the app's Full access. -Mode supervised is what the app sends
# where its Sandbox profile isn't built: workspace-write, approvals untrusted.
param(
  [Parameter(Mandatory)][string]$Server,
  [Parameter(Mandatory)][string]$CodexHome,
  [Parameter(Mandatory)][string]$Prompt,
  [ValidateSet('full', 'supervised')][string]$Mode = 'full',
  [string]$Model = 'gpt-6.1-terra',
  [string]$Folder = (Get-Location).Path,
  [int]$TimeoutSeconds = 420
)

$env:CODEX_HOME = $CodexHome
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $Server
$start.Arguments = '-c check_for_update_on_startup=false -c project_doc_max_bytes=0 ' +
  '-c cli_auth_credentials_store=\"file\" -c features.multi_agent=false -c agents.enabled=false'
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.WorkingDirectory = $Folder
$process = [System.Diagnostics.Process]::Start($start)
$nextId = 0

function Send($message) {
  $process.StandardInput.WriteLine(($message | ConvertTo-Json -Depth 20 -Compress))
  $process.StandardInput.Flush()
}

function Request($method, $params) {
  $script:nextId++
  Send @{ id = $script:nextId; method = $method; params = $params }
  return $script:nextId
}

# Reads until the response to $id, handling what arrives before it.
function Await($id) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $line = $process.StandardOutput.ReadLine()
    if ($null -eq $line) { Write-Host 'uz318: the app-server exited'; exit 1 }
    if ($env:UZ318_RAW) { Write-Host "RAW $($line.Substring(0, [Math]::Min(400, $line.Length)))" }
    $message = $line | ConvertFrom-Json
    if ($message.id -eq $id -and -not $message.method) {
      if ($message.error) { Write-Host "uz318: error: $($message.error | ConvertTo-Json -Compress)"; exit 1 }
      return $message.result
    }
    Handle $message
    if ($id -eq 'turn' -and $message.method -eq 'turn/completed') { return $message.params }
  }
  Write-Host 'uz318: timed out'
  $process.Kill()
  exit 1
}

function Handle($message) {
  if ($message.method -like '*requestApproval') {
    Write-Host "[approval asked: $($message.method)] $($message.params | ConvertTo-Json -Depth 6 -Compress)"
    Send @{ id = $message.id; result = @{ decision = 'accept' } }
  } elseif ($message.method -eq 'item/completed') {
    $item = $message.params.item
    if ($item.type -eq 'commandExecution') {
      Write-Host "> [command] $($item.command)"
      Write-Host "$($item.aggregatedOutput)"
      Write-Host "[exit code: $($item.exitCode), status: $($item.status)]"
    } elseif ($item.type -eq 'agentMessage') {
      Write-Host "[AI] $($item.text)"
    }
  } elseif ($message.method -eq 'error') {
    Write-Host "[error] $($message.params | ConvertTo-Json -Depth 6 -Compress)"
  }
}

$null = Await (Request 'initialize' @{
    clientInfo = @{ name = 'unimatrix_zero'; title = 'Unimatrix Zero'; version = '0.0.0' }
    capabilities = $null
  })
Send @{ method = 'initialized' }

$access = if ($Mode -eq 'full') {
  @{ sandbox = 'danger-full-access'; approvalPolicy = 'never' }
} else {
  @{ sandbox = 'workspace-write'; approvalPolicy = 'untrusted' }
}
$thread = Await (Request 'thread/start' (@{ cwd = $Folder; model = $Model; developerInstructions = $null } + $access))

$turnAccess = if ($Mode -eq 'full') {
  @{ sandboxPolicy = @{ type = 'dangerFullAccess' } }
} else {
  @{ sandboxPolicy = @{ type = 'workspaceWrite'; writableRoots = @($Folder); networkAccess = $false
      excludeTmpdirEnvVar = $false; excludeSlashTmp = $false } }
}
$null = Await (Request 'turn/start' (@{
      threadId = $thread.thread.id
      input = @(@{ type = 'text'; text = $Prompt; text_elements = @() })
      model = $Model
      cwd = $Folder
      approvalPolicy = $access.approvalPolicy
    } + $turnAccess))

$done = Await 'turn'
Write-Host "[turn] $($done.turn.status)"
$process.Kill()
