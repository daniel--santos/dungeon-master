# Orquestra o teste de CTRL_BREAK do Windows e devolve o código de saída do alvo.
#
# POR QUE PRECISA DE POWERSHELL
#
# O emissor (`tooling/windows/send-ctrl-break.ps1`) só funciona contra um
# processo que tenha console próprio, porque ele se anexa a esse console com
# `AttachConsole`. Um processo criado por `child_process.spawn` do Node não
# ganha console, então o Node não consegue montar o alvo sozinho:
# `Start-Process` com redirecionamento de saída, sim.
#
# Manter a orquestração aqui também é o que dá acesso ao código de saída. O
# objeto devolvido por `Start-Process -PassThru` é quem guarda o `ExitCode`, e
# ele não sobrevive ao fim deste processo.
#
# Imprime no stdout uma linha JSON com o pid e o código de saída do alvo.

param(
    [Parameter(Mandatory = $true)][string]$TargetScript,
    [Parameter(Mandatory = $true)][string]$MarkerPath,
    [Parameter(Mandatory = $true)][string]$SenderScript,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$ErrorPath
)

$ErrorActionPreference = 'Stop'

$node = (Get-Command node).Source

$target = Start-Process -FilePath $node `
    -ArgumentList @($TargetScript, $MarkerPath) `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError $ErrorPath `
    -PassThru

# Tocar em `.Handle` faz o .NET guardar o handle do processo. Sem isso,
# `ExitCode` vem vazio depois da saída, porque o objeto perde o acesso ao
# processo já encerrado.
$null = $target.Handle

# Só mandar o evento depois de o handler de SIGBREAK estar registrado.
$deadline = (Get-Date).AddSeconds(20)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if (Test-Path $LogPath) {
        $log = Get-Content -Raw -ErrorAction SilentlyContinue $LogPath
        if ($log -and $log.Contains('ready')) { $ready = $true; break }
    }
    Start-Sleep -Milliseconds 100
}

if (-not $ready) {
    if (-not $target.HasExited) { $target.Kill() }
    [Console]::Error.WriteLine('o alvo nao ficou pronto a tempo')
    exit 2
}

# O emissor solta o proprio console para se anexar ao do alvo e nao o recupera,
# entao roda em um PowerShell separado e descartavel.
#
# Ele costuma morrer no proprio evento que gerou: `SetConsoleCtrlHandler(NULL,
# TRUE)` ignora CTRL_C, nao CTRL_BREAK, e o evento vai para todos os processos
# anexados aquele console, o emissor incluido. Por isso o `Start-Sleep` de 2,5s
# de dentro dele quase nunca roda, e esta chamada volta em menos de um segundo.
# Nao e problema: o evento ja foi entregue, e quem prova o resultado e o codigo
# de saida do alvo, esperado logo abaixo.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SenderScript -TargetPid $target.Id | Out-Null

if (-not $target.WaitForExit(20000)) {
    $target.Kill()
    [Console]::Error.WriteLine('o alvo nao saiu depois do CTRL_BREAK')
    exit 3
}

Write-Output (ConvertTo-Json -Compress @{ pid = $target.Id; exitCode = $target.ExitCode })
