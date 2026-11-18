export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** null when the browser cannot say. */
export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage || typeof navigator.storage.persisted !== 'function') return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
