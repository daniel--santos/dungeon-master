import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Os toasts da interface.
 *
 * O tema visual é fixo em `dark` porque `index.html` marca a raiz com `.dark`:
 * a web ainda não tem modo claro, e o interruptor de Settings troca vocabulário,
 * não cores.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
