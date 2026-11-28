# Test for #318: one Reply from `claude`, with the PowerShell tool the app
# names on Windows and no dev app. Prints each command with its output, and
# the AI's text.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File claude-reply.ps1 `
#     -Claude <claude.exe> -ConfigDir <folder> -Prompt "..." [-Mode supervised]
#
# -Mode full skips permissions, as the app's Full access does. -Mode supervised
# has no one to answer a card here, so a command that needs one is refused.
param(
  [Parameter(Mandatory)][string]$Claude,
  [Parameter(Mandatory)][string]$ConfigDir,
  [Parameter(Mandatory)][string]$Prompt,
  [ValidateSet('full', 'supervised')][string]$Mode = 'full',
  [string]$Model = 'claude-fable-5-2'
)

$env:CLAUDE_CONFIG_DIR = $ConfigDir
$access = if ($Mode -eq 'full') { @('--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions') } else { @('--permission-mode', 'default') }

& $Claude -p $Prompt --model $Model --tools 'PowerShell,Read,Write,Edit,Glob,Grep' `
  --output-format stream-json --verbose @access 2>$null | ForEach-Object {
  $message = $_ | ConvertFrom-Json
  if ($message.type -eq 'assistant') {
    foreach ($block in $message.message.content) {
      if ($block.type -eq 'tool_use') { "> [$($block.name)] $($block.input.command)" }
      if ($block.type -eq 'text') { "[AI] $($block.text)" }
    }
  } elseif ($message.type -eq 'user') {
    foreach ($block in $message.message.content) {
      if ($block.type -eq 'tool_result') {
        $text = if ($block.content -is [string]) { $block.content } else { ($block.content | ForEach-Object text) -join "`n" }
        "$text"
        "[error: $([bool]$block.is_error)]"
      }
    }
  } elseif ($message.type -eq 'result') {
    "[turn] $($message.subtype)"
  }
}
