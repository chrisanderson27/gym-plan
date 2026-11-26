import { useEffect, useState } from 'preact/hooks';
import { sync, type SyncStatus } from '../../sync/engine';

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(sync.getStatus());
  useEffect(() => {
    const read = () => setStatus(sync.getStatus());
    const unsubscribe = sync.subscribe(read);
    read();
    return unsubscribe;
  }, []);
  return status;
}
