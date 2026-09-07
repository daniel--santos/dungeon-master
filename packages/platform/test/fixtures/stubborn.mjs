// Processo que ignora SIGTERM, para provar a escalada para SIGKILL no POSIX.
//
// Um agente que trava no shutdown se comporta assim: recebe o pedido educado e
// não sai. `terminateProcessTree` precisa esperar o grace, escalar e confirmar.

process.on("SIGTERM", () => {
  // De propósito: recebe e ignora.
});

setInterval(() => {}, 1_000);

process.stdout.write("ready\n");
