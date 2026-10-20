/** `scheduler.yield()` (Chrome 129+, Firefox 142+); TypeScript's DOM types lack it so far. */
interface Scheduler {
  yield(): Promise<void>;
}

/**
 * Ends the current task and resumes in a new one, so the browser can paint
 * and handle input in between: the "yield to the main thread" pattern for
 * splitting long work.
 *
 * Uses `scheduler.yield()` where it exists: it resumes ahead of other queued
 * tasks, so a long parse that yields hundreds of times is not slowed by
 * unrelated work queued behind it. Elsewhere it falls back to a
 * `MessageChannel` message, which starts a new task without the 4 ms clamp
 * that nested `setTimeout(0)` calls get, and to `setTimeout` where there is
 * no `MessageChannel` either.
 */
export function yieldToMain(): Promise<void> {
  const { scheduler } = globalThis as typeof globalThis & {
    scheduler?: Partial<Scheduler>;
  };
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
