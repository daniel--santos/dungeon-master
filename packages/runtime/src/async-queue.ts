/**
 * Fila assíncrona de item único produtor → consumidor.
 *
 * Um processo filho produz três fluxos ao mesmo tempo (linhas do stdout,
 * pedaços do stderr, e o evento de saída) e o adapter precisa consumi-los como
 * uma sequência só, na ordem em que chegaram. `for await` sobre três streams
 * não faz isso; uma fila com espera faz.
 *
 * A fila é ilimitada de propósito. Aplicar contrapressão em cima de `stdout` de
 * um processo que não sabe pausar só moveria o acúmulo para o buffer do
 * sistema operacional; o que limita a memória aqui é a `BoundedTail` de quem
 * consome, não a fila.
 */

export interface AsyncQueue<T> extends AsyncIterable<T> {
  /** Enfileira um item. Ignorado depois de {@link close}. */
  push(item: T): void;
  /** Fecha a fila. O consumidor ainda recebe o que já estava enfileirado. */
  close(): void;
  /** A fila já foi fechada? */
  readonly closed: boolean;
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = [];
  const waiters: ((result: IteratorResult<T>) => void)[] = [];
  let closed = false;

  const push = (item: T): void => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: item, done: false });
      return;
    }
    items.push(item);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    // Quem já estava esperando recebe o fim agora; quem chegar depois vai
    // encontrar `items` vazio e `closed`, e termina sozinho.
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter({ value: undefined, done: true });
    }
  };

  const next = (): Promise<IteratorResult<T>> => {
    if (items.length > 0) {
      const value = items.shift() as T;
      return Promise.resolve({ value, done: false });
    }
    if (closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
  };

  return {
    push,
    close,
    get closed() {
      return closed;
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next,
        return: () => {
          close();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
