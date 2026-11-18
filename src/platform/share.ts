export type DeliverResult = 'shared' | 'downloaded' | 'cancelled';

const pad = (n: number) => String(n).padStart(2, '0');

export const backupFileName = (now: Date): string =>
  `gym-plan-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;

async function tryShare(name: string, text: string, type: string): Promise<DeliverResult | null> {
  const file = new File([text], name, { type });
  if (!navigator.canShare?.({ files: [file] })) return null;
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    return null;
  }
}

/** The JSON MIME type is unconfirmed on iOS: try application/json, then text/plain, then a download. */
export async function deliverFile(
  name: string,
  text: string,
  { preferShare }: { preferShare: boolean },
): Promise<DeliverResult> {
  if (preferShare) {
    for (const type of ['application/json', 'text/plain']) {
      const r = await tryShare(name, text, type);
      if (r) return r;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
