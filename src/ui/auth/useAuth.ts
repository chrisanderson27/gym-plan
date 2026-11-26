import { useEffect, useState } from 'preact/hooks';
import { auth, type AuthState } from '../../sync/auth';

export function useAuth(): AuthState {
  const [state, setState] = useState(auth.getState());
  useEffect(() => {
    const read = () => setState(auth.getState());
    const unsubscribe = auth.subscribe(read);
    read();
    return unsubscribe;
  }, []);
  return state;
}
