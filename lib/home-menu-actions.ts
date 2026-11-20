export type HomeMenuAction = 'prefs' | 'about' | 'feedback';

type Listener = (action: HomeMenuAction) => void;

const listeners = new Set<Listener>();

export function requestHomeMenuAction(action: HomeMenuAction) {
  for (const listener of listeners) listener(action);
}

export function subscribeHomeMenuActions(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
