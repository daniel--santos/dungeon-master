# Envia um CTRL_BREAK_EVENT real ao console de outro processo, no Windows.
#
# POR QUE EXISTE
#
# No Windows, `process.kill(pid, 'SIGINT')` disparado de outro processo não
# entrega sinal nenhum: a libuv traduz SIGINT, SIGTERM e SIGKILL em
# `TerminateProcess`, que mata o alvo na hora. O handler de shutdown do
# processo nunca roda, então testar encerramento gracioso com `process.kill`
# no Windows dá um falso verde: o processo some, mas por execução forçada.
#
# O caminho de verdade é o do console: anexar-se ao console do processo alvo
# com `AttachConsole` e gerar o evento de controle com
# `GenerateConsoleCtrlEvent`. O Node entrega CTRL_BREAK_EVENT como SIGBREAK,
# que é o sinal que `apps/api` e `apps/worker` tratam junto com SIGINT e
# SIGTERM justamente por causa disto.
#
# Usado na Fase 0 para provar o shutdown gracioso da API e do Worker no
# Windows. Vira fixture de teste de `packages/platform`, que na Fase 2 é dona
# do kill de árvore de processos com confirmação de término.
#
# COMO USAR
#
# O alvo precisa ter console próprio. Um processo iniciado por
# `Start-Process` com redirecionamento de saída ganha um; um processo criado
# com DETACHED_PROCESS, não, e neste caso o evento não chega.
#
#   $p = Start-Process node -ArgumentList "dist/main.js" `
#          -WorkingDirectory apps/worker `
#          -RedirectStandardOutput worker.log -RedirectStandardError worker.err `
#          -PassThru
#   powershell -NoProfile -ExecutionPolicy Bypass `
#     -File tooling/windows/send-ctrl-break.ps1 -TargetPid $p.Id
#
# Rode sempre em um PowerShell separado e descartável. O script solta o
# próprio console para se anexar ao do alvo, e não o recupera: o processo que
# o executa fica sem stdout de console depois disso. Por isso ele não imprime
# nada de útil no chamador; quem prova o resultado é o log do alvo.
#
# Só faz sentido no Windows. Em macOS e Linux, `kill -INT <pid>` já entrega o
# sinal de verdade e o handler roda.

param(
    [Parameter(Mandatory = $true)]
    [int]$TargetPid
)

$signature = @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
'@

$k32 = Add-Type -MemberDefinition $signature -Name 'K32' -Namespace 'CtrlSender' -PassThru

# Um processo só pode estar anexado a um console por vez.
[void]$k32::FreeConsole()

if (-not $k32::AttachConsole([uint32]$TargetPid)) {
    Write-Error "AttachConsole falhou para o pid $TargetPid. O alvo tem console proprio?"
    exit 1
}

# Sem isto, o evento gerado abaixo mata este próprio PowerShell antes de o
# alvo terminar o shutdown.
[void]$k32::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

# 0 = CTRL_C_EVENT, 1 = CTRL_BREAK_EVENT. Grupo 0 significa todos os processos
# do console ao qual acabamos de nos anexar, que é só o alvo.
$sent = $k32::GenerateConsoleCtrlEvent(1, 0)

# Dá tempo de o handler do alvo rodar e escrever no log antes de soltarmos o
# console. Sem a espera, a saída do processo pode se perder.
Start-Sleep -Milliseconds 2500

[void]$k32::FreeConsole()

if (-not $sent) { exit 1 }
